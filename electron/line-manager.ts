export const MAX_LINES = 4 as const;

export type LineId = 'line-1' | 'line-2' | 'line-3' | 'line-4';
export type LineState = 'disabled' | 'idle' | 'calling' | 'error';

export type VapiLineConfig = {
  id: LineId;
  name: string;
  enabled: boolean;
  vapiApiKey: string;
  assistantId: string;
  phoneNumberId: string;
};

export type VapiLineRuntime = {
  id: LineId;
  state: LineState;
  activeContactId?: string;
  activeCallId?: string;
  lastError?: string;
  callsStarted: number;
};

export type FourLineConfig = {
  lines: VapiLineConfig[];
};

export function createEmptyFourLineConfig(): FourLineConfig {
  return {
    lines: Array.from({ length: MAX_LINES }, (_, index) => ({
      id: `line-${index + 1}` as LineId,
      name: `Line ${index + 1}`,
      enabled: index === 0,
      vapiApiKey: '',
      assistantId: '',
      phoneNumberId: '',
    })),
  };
}

export function normalizeFourLineConfig(value: unknown): FourLineConfig {
  const fallback = createEmptyFourLineConfig();
  const incoming = Array.isArray((value as any)?.lines) ? (value as any).lines : [];
  return {
    lines: fallback.lines.map((base, index) => {
      const source = incoming[index] || {};
      return {
        ...base,
        name: String(source.name || base.name),
        enabled: source.enabled === undefined ? base.enabled : Boolean(source.enabled),
        vapiApiKey: String(source.vapiApiKey || ''),
        assistantId: String(source.assistantId || ''),
        phoneNumberId: String(source.phoneNumberId || ''),
      };
    }),
  };
}

export function lineReady(line: VapiLineConfig) {
  return Boolean(line.enabled && line.vapiApiKey.trim() && line.assistantId.trim() && line.phoneNumberId.trim());
}

export class FourLineRuntimeManager {
  private readonly runtime = new Map<LineId, VapiLineRuntime>();

  constructor(private config: FourLineConfig) {
    this.config = normalizeFourLineConfig(config);
    this.resetRuntime();
  }

  updateConfig(config: FourLineConfig) {
    this.config = normalizeFourLineConfig(config);
    for (const line of this.config.lines) {
      const current = this.runtime.get(line.id);
      if (!current) {
        this.runtime.set(line.id, { id: line.id, state: line.enabled ? 'idle' : 'disabled', callsStarted: 0 });
        continue;
      }
      if (current.state !== 'calling') current.state = line.enabled ? 'idle' : 'disabled';
    }
  }

  resetRuntime() {
    this.runtime.clear();
    for (const line of this.config.lines) {
      this.runtime.set(line.id, {
        id: line.id,
        state: line.enabled ? 'idle' : 'disabled',
        callsStarted: 0,
      });
    }
  }

  snapshot() {
    return this.config.lines.map(line => ({
      config: { ...line, vapiApiKey: line.vapiApiKey ? '••••••••' : '' },
      runtime: { ...(this.runtime.get(line.id) || { id: line.id, state: 'disabled', callsStarted: 0 }) },
      ready: lineReady(line),
    }));
  }

  configuredLines() {
    return this.config.lines.filter(lineReady);
  }

  acquire(contactId: string): VapiLineConfig | undefined {
    for (const line of this.configuredLines()) {
      const state = this.runtime.get(line.id);
      if (!state || state.state !== 'idle') continue;
      state.state = 'calling';
      state.activeContactId = contactId;
      state.activeCallId = undefined;
      state.lastError = undefined;
      state.callsStarted += 1;
      return line;
    }
    return undefined;
  }

  attachCall(lineId: LineId, callId?: string) {
    const state = this.runtime.get(lineId);
    if (!state) return;
    state.activeCallId = callId;
  }

  release(lineId: LineId) {
    const line = this.config.lines.find(item => item.id === lineId);
    const state = this.runtime.get(lineId);
    if (!state) return;
    state.state = line?.enabled ? 'idle' : 'disabled';
    state.activeContactId = undefined;
    state.activeCallId = undefined;
    state.lastError = undefined;
  }

  fail(lineId: LineId, error: unknown) {
    const state = this.runtime.get(lineId);
    if (!state) return;
    state.state = 'error';
    state.lastError = String(error);
    state.activeContactId = undefined;
    state.activeCallId = undefined;
  }

  recover(lineId: LineId) {
    const line = this.config.lines.find(item => item.id === lineId);
    const state = this.runtime.get(lineId);
    if (!state || state.state === 'calling') return;
    state.state = line?.enabled ? 'idle' : 'disabled';
    state.lastError = undefined;
  }

  activeCount() {
    return [...this.runtime.values()].filter(item => item.state === 'calling').length;
  }
}
