import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CALL_TIMEOUTS, beginEnding, canPlayFirstMessage, conversationGuard, deriveCallTiming, shouldProcessConversationEvents, timeoutReason, timeoutReasonWithTelemetry, trimMessagesToFirstConversation } from './call-duration.js';

const start = '2026-01-01T00:00:00.000Z';
const at = (seconds: number) => Date.parse(start) + seconds * 1000;
const message = (role: string, seconds: number, duration: number, text: string) => ({ role, secondsFromStart: seconds, time: at(seconds), endTime: at(seconds) + duration * 1000, duration: duration * 1000, message: text });

test('normal conversation measures speech only and has no timeout', () => {
  const timing = deriveCallTiming([message('bot', 1, 2, 'Hello'), message('user', 4, 3, 'Interested')], start);
  assert.equal(timing.talkTimeSeconds, 5);
  assert.equal(timeoutReason(at(10), start, timing, DEFAULT_CALL_TIMEOUTS), undefined);
});

test('silent customer hits initial silence timeout', () => {
  const timing = deriveCallTiming([message('bot', 1, 2, 'Hello')], start);
  assert.equal(timeoutReason(at(21), start, timing, DEFAULT_CALL_TIMEOUTS), 'initial_silence_timeout');
});

test('silent assistant after customer speech hits conversation silence timeout', () => {
  const timing = deriveCallTiming([message('user', 1, 1, 'Hello')], start);
  assert.equal(timeoutReason(at(33), start, timing, DEFAULT_CALL_TIMEOUTS), 'conversation_silence_timeout');
});

test('mutual goodbye ends after configured grace period', () => {
  const timing = deriveCallTiming([message('user', 2, 1, 'Goodbye'), message('bot', 4, 1, 'Take care')], start);
  assert.ok(timing.goodbyeDetectedAt);
  assert.equal(timeoutReason(at(8), start, timing, DEFAULT_CALL_TIMEOUTS), 'goodbye_timeout');
});

test('maximum duration is the hard limit', () => {
  const timing = deriveCallTiming([message('user', 290, 1, 'Still talking')], start);
  assert.equal(timeoutReason(at(300), start, timing, DEFAULT_CALL_TIMEOUTS), 'maximum_duration_reached');
});

test('long silence during conversation times out', () => {
  const timing = deriveCallTiming([message('bot', 1, 1, 'Hello'), message('user', 3, 1, 'Hello')], start);
  assert.equal(timeoutReason(at(35), start, timing, DEFAULT_CALL_TIMEOUTS), 'conversation_silence_timeout');
});

test('hung SIP is bounded by maximum duration even without new events', () => {
  assert.equal(timeoutReason(at(301), start, { talkTimeSeconds: 0 }, DEFAULT_CALL_TIMEOUTS), 'maximum_duration_reached');
});

test('missing live message telemetry is not treated as initial silence', () => {
  assert.equal(timeoutReasonWithTelemetry(at(21), start, { talkTimeSeconds: 0 }, DEFAULT_CALL_TIMEOUTS, false), undefined);
  assert.equal(timeoutReasonWithTelemetry(at(300), start, { talkTimeSeconds: 0 }, DEFAULT_CALL_TIMEOUTS, false), 'maximum_duration_reached');
});

test('agent goodbye followed by customer bye requests ending', () => {
  const messages = [message('bot', 1, 1, 'Thanks for your time. Have a great day.'), message('user', 3, 1, 'You too. Bye.')];
  assert.equal(conversationGuard(messages).shouldEnd, true);
});

test('ending transition is idempotent and ignores later transcripts', () => {
  const state = { callLifecycleState: 'active' as const, endRequestReason: undefined as string | undefined };
  assert.equal(beginEnding(state, 'goodbye_timeout'), true);
  assert.equal(beginEnding(state, 'goodbye_timeout'), false);
  assert.equal(shouldProcessConversationEvents(state), false);
});

test('first message is allowed only before conversation starts', () => {
  assert.equal(canPlayFirstMessage({ callLifecycleState: 'active', hasStartedConversation: false }), true);
  assert.equal(canPlayFirstMessage({ callLifecycleState: 'active', hasStartedConversation: true }), false);
  assert.equal(canPlayFirstMessage({ callLifecycleState: 'ending', hasStartedConversation: true }), false);
});

test('repeated assistant sales introduction is a lifecycle error', () => {
  const messages = [message('bot', 1, 1, 'Hi, Michael. This is Alex with DMNT.'), message('user', 3, 1, 'Hello'), message('bot', 10, 1, 'My name is Alex with DMNT and I will be brief.')];
  const guard = conversationGuard(messages);
  assert.equal(guard.repeatedIntroduction, true);
  assert.equal(guard.reason, 'repeated_introduction_lifecycle_error');
});

test('Lead Intelligence input can be limited to first real conversation', () => {
  const messages = [message('bot', 1, 1, 'This is Alex with DMNT.'), message('user', 3, 1, 'I need a website.'), message('bot', 5, 1, 'Have a great day.'), message('user', 7, 1, 'You too. Bye.'), message('bot', 10, 1, 'My name is Alex with DMNT.')];
  const trimmed = trimMessagesToFirstConversation(messages);
  assert.equal(trimmed.length, 4);
  assert.equal(trimmed.some(item => String(item.message || '').includes('My name is Alex')), false);
});
