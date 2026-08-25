export type CallTimeoutSettings = {
  initialSilenceTimeoutSeconds: number;
  conversationSilenceTimeoutSeconds: number;
  goodbyeTimeoutSeconds: number;
  maximumCallDurationSeconds: number;
};

export const DEFAULT_CALL_TIMEOUTS: CallTimeoutSettings = {
  initialSilenceTimeoutSeconds: 20,
  conversationSilenceTimeoutSeconds: 30,
  goodbyeTimeoutSeconds: 3,
  maximumCallDurationSeconds: 300,
};

export type VapiSpeechMessage = { role?: string; message?: string; content?: string; time?: number; endTime?: number; secondsFromStart?: number; duration?: number };
export type CallTiming = { firstAudioAt?: string; firstCustomerSpeechAt?: string; lastCustomerSpeechAt?: string; lastAssistantSpeechAt?: string; talkTimeSeconds: number; goodbyeDetectedAt?: string };
export type ConversationState = 'active' | 'ending' | 'ended';
export type EndableCallState = { callLifecycleState?: ConversationState; endRequestReason?: string; hasStartedConversation?: boolean };

export function beginEnding(state: EndableCallState, reason: string) {
  if (state.callLifecycleState === 'ending' || state.callLifecycleState === 'ended' || state.endRequestReason) return false;
  state.callLifecycleState = 'ending'; state.endRequestReason = reason;
  return true;
}

export function shouldProcessConversationEvents(state: EndableCallState) { return state.callLifecycleState !== 'ending' && state.callLifecycleState !== 'ended'; }
export function canPlayFirstMessage(state: EndableCallState) { return state.callLifecycleState === 'active' && !state.hasStartedConversation; }

function textOf(message: VapiSpeechMessage) { return String(message.message || message.content || '').trim(); }
function atOf(message: VapiSpeechMessage, startedAtMs: number) {
  if (Number.isFinite(message.time)) return Number(message.time);
  return startedAtMs + Number(message.secondsFromStart || 0) * 1000;
}
function isCustomer(role: string) { return role === 'user' || role === 'customer'; }
function isAssistant(role: string) { return role === 'bot' || role === 'assistant'; }
const GOODBYE = /\b(goodbye|good bye|bye(?:-bye)?|have a (?:good|great|nice) (?:day|evening|weekend)|take care|talk to you (?:soon|later))\b/i;
const CUSTOMER_CLOSING = /\b(bye|goodbye|talk to you later|thanks|thank you|take care|you too)\b/i;
const FULL_ASSISTANT_INTRODUCTION = /\b(this is alex|my name is alex)\b/i;

export function conversationGuard(messages: VapiSpeechMessage[]) {
  const speech = messages.filter(message => (isCustomer(String(message.role)) || isAssistant(String(message.role))) && textOf(message));
  const introductionIndexes = speech.map((message, index) => isAssistant(String(message.role)) && FULL_ASSISTANT_INTRODUCTION.test(textOf(message)) ? index : -1).filter(index => index >= 0);
  let firstGoodbyeIndex = -1;
  for (let index = 0; index < speech.length; index += 1) {
    if (!isAssistant(String(speech[index].role)) || !GOODBYE.test(textOf(speech[index]))) continue;
    const customerReply = speech.slice(index + 1).findIndex(message => isCustomer(String(message.role)) && CUSTOMER_CLOSING.test(textOf(message)));
    if (customerReply >= 0) { firstGoodbyeIndex = index + 1 + customerReply; break; }
  }
  return {
    hasStartedConversation: introductionIndexes.length > 0 || speech.some(message => isCustomer(String(message.role))),
    repeatedIntroduction: introductionIndexes.length > 1,
    firstGoodbyeIndex,
    shouldEnd: firstGoodbyeIndex >= 0 || introductionIndexes.length > 1,
    reason: introductionIndexes.length > 1 ? 'repeated_introduction_lifecycle_error' : firstGoodbyeIndex >= 0 ? 'goodbye_timeout' : undefined,
  } as const;
}

export function trimMessagesToFirstConversation(messages: VapiSpeechMessage[]) {
  const guard = conversationGuard(messages);
  if (guard.firstGoodbyeIndex < 0) return messages;
  const speech = messages.filter(message => (isCustomer(String(message.role)) || isAssistant(String(message.role))) && textOf(message));
  const cutoff = speech[guard.firstGoodbyeIndex];
  const cutoffTime = Number(cutoff.endTime || cutoff.time || 0);
  return messages.filter(message => !cutoffTime || Number(message.time || 0) <= cutoffTime);
}

export function deriveCallTiming(messages: VapiSpeechMessage[], startedAt: string): CallTiming {
  const startedAtMs = Date.parse(startedAt);
  const speech = messages.filter(message => (isCustomer(String(message.role)) || isAssistant(String(message.role))) && textOf(message));
  const customer = speech.filter(message => isCustomer(String(message.role)));
  const assistant = speech.filter(message => isAssistant(String(message.role)));
  const sumMs = speech.reduce((total, message) => total + Math.max(0, Number(message.duration || (Number(message.endTime) - Number(message.time)) || 0)), 0);
  const customerGoodbye = [...customer].reverse().find(message => GOODBYE.test(textOf(message)));
  const assistantGoodbye = [...assistant].reverse().find(message => GOODBYE.test(textOf(message)));
  const mutualGoodbyeAt = customerGoodbye && assistantGoodbye ? Math.max(atOf(customerGoodbye, startedAtMs), atOf(assistantGoodbye, startedAtMs)) : undefined;
  return {
    firstAudioAt: speech[0] ? new Date(atOf(speech[0], startedAtMs)).toISOString() : undefined,
    firstCustomerSpeechAt: customer[0] ? new Date(atOf(customer[0], startedAtMs)).toISOString() : undefined,
    lastCustomerSpeechAt: customer.at(-1) ? new Date(atOf(customer.at(-1)!, startedAtMs) + Number(customer.at(-1)!.duration || 0)).toISOString() : undefined,
    lastAssistantSpeechAt: assistant.at(-1) ? new Date(atOf(assistant.at(-1)!, startedAtMs) + Number(assistant.at(-1)!.duration || 0)).toISOString() : undefined,
    talkTimeSeconds: Math.round(sumMs / 100) / 10,
    goodbyeDetectedAt: mutualGoodbyeAt ? new Date(mutualGoodbyeAt).toISOString() : undefined,
  };
}

export type EndReason = 'initial_silence_timeout' | 'conversation_silence_timeout' | 'goodbye_timeout' | 'maximum_duration_reached';
export function timeoutReason(nowMs: number, startedAt: string, timing: CallTiming, settings: CallTimeoutSettings): EndReason | undefined {
  const start = Date.parse(startedAt);
  if (nowMs - start >= settings.maximumCallDurationSeconds * 1000) return 'maximum_duration_reached';
  if (!timing.firstCustomerSpeechAt && nowMs - start >= settings.initialSilenceTimeoutSeconds * 1000) return 'initial_silence_timeout';
  if (timing.goodbyeDetectedAt && nowMs - Date.parse(timing.goodbyeDetectedAt) >= settings.goodbyeTimeoutSeconds * 1000) return 'goodbye_timeout';
  const lastSpeech = Math.max(Date.parse(timing.lastCustomerSpeechAt || '') || 0, Date.parse(timing.lastAssistantSpeechAt || '') || 0);
  if (timing.firstCustomerSpeechAt && lastSpeech && nowMs - lastSpeech >= settings.conversationSilenceTimeoutSeconds * 1000) return 'conversation_silence_timeout';
  return undefined;
}

export function timeoutReasonWithTelemetry(nowMs: number, startedAt: string, timing: CallTiming, settings: CallTimeoutSettings, hasLiveSpeechTelemetry: boolean) {
  if (hasLiveSpeechTelemetry) return timeoutReason(nowMs, startedAt, timing, settings);
  return nowMs - Date.parse(startedAt) >= settings.maximumCallDurationSeconds * 1000 ? 'maximum_duration_reached' : undefined;
}
