import { findStructuredOutput } from './lead-intelligence.js';

export type ActiveCallContact = {
  phone: string;
  status: string;
  callId?: string;
  finalizedCallId?: string;
};

export type CallEventSource = 'polling' | 'webhook';

export type CallRecord = Record<string, any>;

type LifecycleDependencies<T extends ActiveCallContact> = {
  fetchCallRecord: (callId: string) => Promise<CallRecord>;
  finalizeCall: (contact: T, confirmedTerminalCall: CallRecord) => Promise<void>;
  log: (event: string, details: { callId: string; phone: string; [key: string]: unknown }) => void;
  terminalConfirmed?: (contact: T, callId: string) => void;
  terminalRejected?: (contact: T, callId: string) => void;
  finalCallFetched?: (call: CallRecord) => void;
  wait?: (milliseconds: number) => Promise<void>;
  analysisAttempts?: number;
  analysisDelayMs?: number;
};

export function callIdFromEvent(event: CallRecord, source: CallEventSource) {
  if (source === 'polling') return typeof event.id === 'string' ? event.id : '';
  return typeof event.call?.id === 'string' ? event.call.id : typeof event.callId === 'string' ? event.callId : '';
}

export function isConfirmedTerminalCall(event: CallRecord, source: CallEventSource) {
  const status = String(source === 'webhook' ? event.call?.status || event.status || '' : event.status || '').toLowerCase();
  if (['ended', 'failed', 'canceled', 'cancelled'].includes(status)) return true;
  return source === 'webhook' && event.type === 'end-of-call-report';
}

export function hasStructuredAnalysis(call: CallRecord) {
  return Boolean(findStructuredOutput(call));
}

function mergeFinalCall(base: CallRecord, fresh: CallRecord) {
  return {
    ...base,
    ...fresh,
    analysis: fresh.analysis || base.analysis,
    artifact: { ...(base.artifact || {}), ...(fresh.artifact || {}) },
  };
}

export class CallLifecycleCoordinator<T extends ActiveCallContact> {
  private readonly finalizing = new Map<string, Promise<boolean>>();
  private readonly finalized = new Set<string>();
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly analysisAttempts: number;
  private readonly analysisDelayMs: number;
  private readonly nonTerminalDiagnostics = new Set<string>();

  constructor(private readonly dependencies: LifecycleDependencies<T>) {
    this.wait = dependencies.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.analysisAttempts = dependencies.analysisAttempts ?? 4;
    this.analysisDelayMs = dependencies.analysisDelayMs ?? 1500;
  }

  reset() {
    if (this.finalizing.size) throw new Error('Cannot reset call lifecycle while finalization is active');
    this.finalized.clear();
    this.nonTerminalDiagnostics.clear();
  }

  async handle(contact: T, event: CallRecord, source: CallEventSource) {
    const incomingCallId = callIdFromEvent(event, source);
    const expectedCallId = contact.callId || '';
    const details = { callId: incomingCallId || 'missing', phone: contact.phone };

    if (incomingCallId && (this.finalized.has(incomingCallId) || contact.finalizedCallId === incomingCallId || this.finalizing.has(incomingCallId))) {
      this.dependencies.log('duplicate_finalization_ignored', details);
      return this.finalizing.get(incomingCallId) || false;
    }
    if (!incomingCallId || incomingCallId !== expectedCallId || contact.status !== 'Calling') {
      this.dependencies.log('ignored_stale_call_event', { ...details, expectedCallId: expectedCallId || 'missing', source });
      return false;
    }
    if (!isConfirmedTerminalCall(event, source)) {
      const type = String(event.type || '');
      const status = String(event.status || event.call?.status || '');
      const diagnosticKey = `${incomingCallId}|${source}|${type}|${status}`;
      if (!this.nonTerminalDiagnostics.has(diagnosticKey)) {
        this.nonTerminalDiagnostics.add(diagnosticKey);
        this.dependencies.log('call_event_ignored_non_terminal', { ...details, source, type, status });
      }
      return false;
    }

    this.dependencies.log('call_terminal_status_confirmed', { ...details, source, type: event.type || '', status: event.status || event.call?.status || '' });
    this.dependencies.terminalConfirmed?.(contact, incomingCallId);
    const finalization = this.runFinalization(contact, incomingCallId, event, source);
    this.finalizing.set(incomingCallId, finalization);
    return finalization;
  }

  private async runFinalization(contact: T, callId: string, terminalEvent: CallRecord, source: CallEventSource) {
    const details = { callId, phone: contact.phone };
    this.dependencies.log('call_finalization_started', details);
    this.dependencies.log('final_analysis_wait_started', details);
    let finalCall = terminalEvent;
    let analysisReceived = false;
    let currentRecordTerminalConfirmed = source === 'webhook';

    for (let attempt = 1; attempt <= this.analysisAttempts; attempt += 1) {
      this.dependencies.log('final_analysis_attempt', { ...details, attempt });
      try {
        const fresh = await this.dependencies.fetchCallRecord(callId);
        this.dependencies.finalCallFetched?.(fresh);
        const responseCallId = callIdFromEvent(fresh, 'polling');
        if (responseCallId !== callId) {
          this.dependencies.log('ignored_stale_call_event', { callId: responseCallId || 'missing', phone: contact.phone, expectedCallId: callId, source: 'polling' });
        } else {
          finalCall = mergeFinalCall(finalCall, fresh);
          if (isConfirmedTerminalCall(fresh, 'polling')) currentRecordTerminalConfirmed = true;
          if (currentRecordTerminalConfirmed && hasStructuredAnalysis(finalCall)) {
            analysisReceived = true;
            this.dependencies.log('final_analysis_received', { ...details, attempt });
            break;
          }
          if (currentRecordTerminalConfirmed) this.dependencies.log('final_analysis_missing', { ...details, attempt });
        }
      } catch (error) {
        // A bounded retry below handles temporary API failures without finalizing early.
      }
      if (attempt < this.analysisAttempts) await this.wait(this.analysisDelayMs);
    }

    if (!currentRecordTerminalConfirmed) {
      this.dependencies.log('call_event_ignored_non_terminal', { ...details, source: 'polling', phase: 'terminal_recheck' });
      this.dependencies.terminalRejected?.(contact, callId);
      this.finalizing.delete(callId);
      return false;
    }

    if (!analysisReceived && hasStructuredAnalysis(finalCall)) {
      analysisReceived = true;
      this.dependencies.log('final_analysis_received', { ...details, source: 'terminal_event' });
    }
    if (!analysisReceived) this.dependencies.log('final_analysis_timeout', { ...details, attempts: this.analysisAttempts });

    try {
      await this.dependencies.finalizeCall(contact, finalCall);
      contact.finalizedCallId = callId;
      this.finalized.add(callId);
      for (const key of this.nonTerminalDiagnostics) if (key.startsWith(`${callId}|`)) this.nonTerminalDiagnostics.delete(key);
      this.dependencies.log('call_finalization_completed', details);
      return true;
    } finally {
      this.finalizing.delete(callId);
    }
  }
}
