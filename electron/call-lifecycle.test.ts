import assert from 'node:assert/strict';
import test from 'node:test';
import { CallLifecycleCoordinator, type CallRecord } from './call-lifecycle.js';

type TestContact = {
  phone: string;
  status: string;
  callId: string;
  finalizedCallId?: string;
  leadIntelligence?: { lead: string };
};

function structuredCall(id = 'call-current', lead = 'Warm'): CallRecord {
  return { id, status: 'ended', endedReason: 'customer-ended-call', analysis: { structuredData: { lead } } };
}

function harness(options: { testMode?: boolean; fetchResponses?: CallRecord[]; attempts?: number } = {}) {
  const contact: TestContact = { phone: '+12125550126', status: 'Calling', callId: 'call-current' };
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];
  const fetchResponses = [...(options.fetchResponses || [structuredCall()])];
  let finalizations = 0;
  let telegramCalls = 0;
  let fetchCalls = 0;
  const coordinator = new CallLifecycleCoordinator<TestContact>({
    fetchCallRecord: async () => {
      fetchCalls += 1;
      return fetchResponses.shift() || { id: 'call-current', status: 'ended' };
    },
    finalizeCall: async (current, call) => {
      finalizations += 1;
      current.status = 'Completed';
      const intelligence = call.analysis?.structuredData || { lead: 'Unknown' };
      current.leadIntelligence = intelligence;
      const lead = intelligence.lead;
      if (options.testMode ? current.status === 'Completed' : lead === 'Hot') telegramCalls += 1;
    },
    log: (event, details) => events.push({ event, details }),
    wait: async () => undefined,
    analysisAttempts: options.attempts ?? 3,
    analysisDelayMs: 0,
  });
  return { contact, coordinator, events, counts: () => ({ finalizations, telegramCalls, fetchCalls }) };
}

test('analysis during an active call keeps Calling and does not send Telegram', async () => {
  const app = harness({ testMode: true });
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'in-progress', analysis: { structuredData: { lead: 'Warm' } } }, 'polling');
  assert.equal(app.contact.status, 'Calling');
  assert.deepEqual(app.counts(), { finalizations: 0, telegramCalls: 0, fetchCalls: 0 });
});

test('recording URL during an active call keeps Calling', async () => {
  const app = harness();
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'in-progress', artifact: { recordingUrl: 'https://example.test/recording.wav' } }, 'polling');
  assert.equal(app.contact.status, 'Calling');
  assert.equal(app.counts().finalizations, 0);
});

test('non-terminal webhook does not start finalization', async () => {
  const app = harness();
  await app.coordinator.handle(app.contact, { type: 'status-update', call: { id: 'call-current', status: 'in-progress' }, endedReason: 'customer-ended-call' }, 'webhook');
  assert.equal(app.contact.status, 'Calling');
  assert.equal(app.counts().finalizations, 0);
  assert.ok(app.events.some(item => item.event === 'call_event_ignored_non_terminal'));
});

test('repeated non-terminal events produce one bounded diagnostic', async () => {
  const app = harness();
  for (let index = 0; index < 100; index += 1) {
    await app.coordinator.handle(app.contact, { id: 'call-current', type: 'outboundPhoneCall', status: 'in-progress' }, 'polling');
  }
  assert.equal(app.events.filter(item => item.event === 'call_event_ignored_non_terminal').length, 1);
  assert.equal(app.contact.status, 'Calling');
});

test('lifecycle runtime state can be reset between campaigns', async () => {
  const app = harness();
  await app.coordinator.handle(app.contact, structuredCall(), 'polling');
  app.coordinator.reset();
  app.contact.status = 'Calling'; app.contact.finalizedCallId = undefined;
  await app.coordinator.handle(app.contact, structuredCall(), 'polling');
  assert.equal(app.counts().finalizations, 2);
});

test('failed polling record is terminal and finalizes the contact', async () => {
  const app = harness({ fetchResponses: [{ id: 'call-current', status: 'failed', endedReason: 'pipeline-error' }] });
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'failed', endedReason: 'pipeline-error' }, 'polling');
  assert.equal(app.contact.status, 'Completed');
  assert.equal(app.counts().finalizations, 1);
});

test('no-answer terminal record is finalized once', async () => {
  const app = harness({ fetchResponses: [{ id: 'call-current', status: 'ended', endedReason: 'customer-did-not-answer' }] });
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'ended', endedReason: 'customer-did-not-answer' }, 'polling');
  assert.equal(app.counts().finalizations, 1);
});

test('IVR status update remains non-terminal while the call is live', async () => {
  const app = harness();
  await app.coordinator.handle(app.contact, { type: 'status-update', call: { id: 'call-current', status: 'in-progress' }, artifact: { transcript: 'Press 1 for sales' } }, 'webhook');
  assert.equal(app.contact.status, 'Calling');
  assert.equal(app.counts().finalizations, 0);
});

test('stale Calling reconciliation finalizes when Vapi reports ended', async () => {
  const app = harness({ fetchResponses: [structuredCall()] });
  await app.coordinator.handle(app.contact, structuredCall(), 'polling');
  assert.equal(app.contact.status, 'Completed');
  assert.equal(app.counts().finalizations, 1);
});

test('terminal event for current call finalizes with intelligence and Telegram once', async () => {
  const app = harness({ testMode: true });
  await app.coordinator.handle(app.contact, { type: 'end-of-call-report', call: { id: 'call-current' } }, 'webhook');
  assert.equal(app.contact.status, 'Completed');
  assert.deepEqual(app.contact.leadIntelligence, { lead: 'Warm' });
  assert.deepEqual(app.counts(), { finalizations: 1, telegramCalls: 1, fetchCalls: 1 });
});

test('terminal event for stale callId is ignored', async () => {
  const app = harness({ testMode: true });
  await app.coordinator.handle(app.contact, { type: 'end-of-call-report', call: { id: 'call-previous' } }, 'webhook');
  assert.equal(app.contact.status, 'Calling');
  assert.equal(app.counts().finalizations, 0);
  assert.ok(app.events.some(item => item.event === 'ignored_stale_call_event'));
});

test('simultaneous webhook and polling terminal confirmations finalize and notify once', async () => {
  const app = harness({ testMode: true });
  await Promise.all([
    app.coordinator.handle(app.contact, { type: 'end-of-call-report', call: { id: 'call-current' } }, 'webhook'),
    app.coordinator.handle(app.contact, structuredCall(), 'polling'),
  ]);
  assert.deepEqual(app.counts(), { finalizations: 1, telegramCalls: 1, fetchCalls: 1 });
  assert.ok(app.events.some(item => item.event === 'duplicate_finalization_ignored'));
});

test('terminal call waits until delayed structured analysis is available', async () => {
  const app = harness({ testMode: true, fetchResponses: [
    { id: 'call-current', status: 'ended' },
    structuredCall('call-current', 'Hot'),
  ] });
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'ended' }, 'polling');
  assert.deepEqual(app.contact.leadIntelligence, { lead: 'Hot' });
  assert.equal(app.counts().fetchCalls, 2);
  assert.ok(app.events.some(item => item.event === 'final_analysis_received' && item.details.attempt === 2));
});

test('polling terminal state is rechecked against the current call record', async () => {
  const app = harness({ testMode: true, fetchResponses: [
    { id: 'call-current', status: 'in-progress' },
    { id: 'call-current', status: 'in-progress' },
  ], attempts: 2 });
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'ended' }, 'polling');
  assert.equal(app.contact.status, 'Calling');
  assert.equal(app.counts().finalizations, 0);
  assert.ok(app.events.some(item => item.event === 'call_event_ignored_non_terminal' && item.details.phase === 'terminal_recheck'));
});

test('terminal call times out before creating Unknown fallback and notifying', async () => {
  const app = harness({ testMode: true, fetchResponses: [
    { id: 'call-current', status: 'ended' },
    { id: 'call-current', status: 'ended' },
  ], attempts: 2 });
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'ended' }, 'polling');
  assert.equal(app.contact.status, 'Completed');
  assert.deepEqual(app.contact.leadIntelligence, { lead: 'Unknown' });
  assert.equal(app.counts().telegramCalls, 1);
  assert.ok(app.events.some(item => item.event === 'final_analysis_timeout'));
});

test('active call never appears as Completed', async () => {
  const app = harness();
  await app.coordinator.handle(app.contact, { id: 'call-current', status: 'in-progress' }, 'polling');
  assert.equal(app.contact.status, 'Calling');
  assert.equal(app.counts().finalizations, 0);
});

test('testMode does not notify before terminal confirmation', async () => {
  const app = harness({ testMode: true });
  await app.coordinator.handle(app.contact, { type: 'status-update', call: { id: 'call-current', status: 'in-progress' }, analysis: { structuredData: { lead: 'Hot' } } }, 'webhook');
  assert.equal(app.counts().telegramCalls, 0);
  assert.equal(app.contact.status, 'Calling');
});
