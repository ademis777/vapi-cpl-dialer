import { FourLineRuntimeManager, type LineId, type VapiLineConfig } from './line-manager.js';

export type DispatchState = 'idle' | 'running' | 'paused' | 'stopped';

export type DispatchContact = {
  id: string;
  status: string;
  lineId?: LineId;
};

export type FourLineDispatcherOptions<T extends DispatchContact> = {
  lineManager: FourLineRuntimeManager;
  contacts: () => T[];
  campaignState: () => DispatchState;
  dial: (contact: T, line: VapiLineConfig) => Promise<void>;
  onAssigned?: (contact: T, line: VapiLineConfig) => void;
  onReleased?: (contact: T, line: VapiLineConfig) => void;
  onError?: (contact: T, line: VapiLineConfig, error: unknown) => void;
  onDrained?: () => void | Promise<void>;
};

/**
 * Concurrency-safe dispatcher for the CPL dialer.
 *
 * It never allocates more calls than there are ready lines (maximum four), and
 * it guarantees that one line can own at most one contact at a time.
 */
export class FourLineDispatcher<T extends DispatchContact> {
  private pumping = false;
  private drainNotified = false;
  private readonly active = new Map<LineId, Promise<void>>();

  constructor(private readonly options: FourLineDispatcherOptions<T>) {}

  activeCount() {
    return this.active.size;
  }

  activeLineIds() {
    return [...this.active.keys()];
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.options.campaignState() === 'running') {
        const next = this.options.contacts().find(contact => contact.status === 'Waiting' && !contact.lineId);
        if (!next) {
          if (this.active.size === 0 && !this.drainNotified) {
            this.drainNotified = true;
            await this.options.onDrained?.();
          }
          return;
        }

        const line = this.options.lineManager.acquire(next.id);
        if (!line) return;

        this.drainNotified = false;
        next.lineId = line.id;
        this.options.onAssigned?.(next, line);

        const task = this.runOne(next, line);
        this.active.set(line.id, task);
        void task.finally(() => {
          this.active.delete(line.id);
          if (this.options.campaignState() === 'running') void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private async runOne(contact: T, line: VapiLineConfig) {
    try {
      await this.options.dial(contact, line);
    } catch (error) {
      this.options.onError?.(contact, line, error);
    } finally {
      contact.lineId = undefined;
      this.options.lineManager.release(line.id);
      this.options.onReleased?.(contact, line);
    }
  }

  async waitForIdle(timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.active.size && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled([...this.active.values()]),
        new Promise(resolve => setTimeout(resolve, 100)),
      ]);
    }
    return this.active.size === 0;
  }
}
