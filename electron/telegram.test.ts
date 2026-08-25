import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHotLeadPolicy, notifyTelegramAfterIntelligenceReady, notifyTelegramIfNeeded, requireTelegramCredentials, shouldNotifyTelegram } from './telegram.js';
import { extractLegacyCallAnalysis, resolveLeadIntelligence } from './lead-intelligence-resolution.js';

async function notificationWasSent(testMode: boolean, status: string, lead: string) {
  let calls = 0;
  const contact = { status, lead };
  const notified = await notifyTelegramIfNeeded(shouldNotifyTelegram(testMode, contact), contact, async () => { calls += 1; });
  return { calls, notified };
}

test('production mode sends Telegram for Hot', async () => {
  assert.deepEqual(await notificationWasSent(false, 'Completed', 'Hot'), { calls: 1, notified: true });
});

test('production mode does not send Telegram for Warm', async () => {
  assert.deepEqual(await notificationWasSent(false, 'Completed', 'Warm'), { calls: 0, notified: false });
});

test('production mode does not send Telegram for Cold', async () => {
  assert.deepEqual(await notificationWasSent(false, 'Completed', 'Cold'), { calls: 0, notified: false });
});

test('test mode sends Telegram for a completed Warm call', async () => {
  assert.deepEqual(await notificationWasSent(true, 'Completed', 'Warm'), { calls: 1, notified: true });
});

test('test mode sends Telegram for a completed Cold call', async () => {
  assert.deepEqual(await notificationWasSent(true, 'Completed', 'Cold'), { calls: 1, notified: true });
});

test('test mode does not send Telegram for an unfinished call', async () => {
  assert.deepEqual(await notificationWasSent(true, 'Calling', 'Warm'), { calls: 0, notified: false });
});

test('IVR is never sent to Telegram as a regular lead, including test mode', async () => {
  let calls = 0;
  const contact = { status: 'IVR', lead: '', summary: 'IVR: Press 1 required' };
  assert.equal(await notifyTelegramAfterIntelligenceReady(true, contact, async () => { calls += 1; }, () => undefined), false);
  assert.equal(await notifyTelegramAfterIntelligenceReady(false, contact, async () => { calls += 1; }, () => undefined), false);
  assert.equal(calls, 0);
});

test('missing Telegram token produces a clear error', () => {
  assert.throws(() => requireTelegramCredentials('', 'chat-id'), /Telegram Bot Token is missing/);
});

test('missing Telegram Chat ID produces a clear error', () => {
  assert.throws(() => requireTelegramCredentials('bot-token', ''), /Telegram Chat ID is missing/);
});

test('three Hot leads pause the queue independently of test mode', () => {
  for (const testMode of [false, true]) {
    let hotCount = 0;
    let shouldPause = false;
    for (let index = 0; index < 3; index += 1) ({ hotCount, shouldPause } = applyHotLeadPolicy(hotCount, 'Hot'));
    assert.equal(hotCount, 3, `hotCount in testMode=${testMode}`);
    assert.equal(shouldPause, true, `pause in testMode=${testMode}`);
  }
});

const readyIntelligence = {
  currentSituation: ['No website'],
  painPoints: ['No online presence'],
  questionsAsked: ['Price'],
  customerSummary: ['Asked about pricing.'],
};

test('testMode does not send while Lead Intelligence analysis is still running', async () => {
  let calls = 0;
  const events: string[] = [];
  const sent = await notifyTelegramAfterIntelligenceReady(true, { callId: 'call-1', status: 'Completed', lead: '' }, async () => { calls += 1; }, event => events.push(event));
  assert.equal(sent, false);
  assert.equal(calls, 0);
  assert.ok(events.includes('telegram_skipped_intelligence_not_ready'));
});

test('empty fallback intelligence is not sent in test mode', async () => {
  let sent = 0; const events: string[] = [];
  const contact = { callId: 'call-empty', status: 'Completed', lead: 'Warm', analysisSource: 'empty_fallback', leadIntelligence: { currentSituation: [], painPoints: [], questionsAsked: [], customerSummary: [] } };
  const result = await notifyTelegramAfterIntelligenceReady(true, contact, async () => { sent += 1; }, event => events.push(event));
  assert.equal(result, false); assert.equal(sent, 0); assert.ok(events.includes('telegram_skipped_intelligence_not_ready'));
});

test('legacy terminal Summary and Lead are sent when structured data and POST chat are unavailable', async () => {
  const call = { analysis: { summary: 'Customer is interested and agreed to receive a demo.', successEvaluation: 'Warm' }, transcript: 'Customer agreed to receive a demo.' };
  const resolved = await resolveLeadIntelligence(call, { company: 'Example Roofing', phone: '+1' }, { analyzeTranscript: async () => { throw new Error('Vapi Chat HTTP 402'); }, log: () => undefined });
  assert.equal(resolved.source, 'empty_fallback');
  const legacy = extractLegacyCallAnalysis(call);
  let receivedSummary = '';
  const sent = await notifyTelegramAfterIntelligenceReady(true, { callId: 'legacy-call', status: 'Completed', lead: String(legacy.lead), summary: legacy.summary, analysisSource: resolved.source }, async value => { receivedSummary = value.summary || ''; }, () => undefined);
  assert.equal(sent, true);
  assert.equal(receivedSummary, legacy.summary);
});

test('testMode sends a ready populated Lead Intelligence card', async () => {
  let received: typeof readyIntelligence | undefined;
  const contact = { callId: 'call-1', status: 'Completed', lead: 'Warm', leadIntelligence: readyIntelligence, analysisSource: 'transcript_fallback_analysis' };
  const sent = await notifyTelegramAfterIntelligenceReady(true, contact, async value => { received = value.leadIntelligence; }, () => undefined);
  assert.equal(sent, true);
  assert.strictEqual(received, readyIntelligence);
});

test('production Hot behavior remains unchanged when intelligence is ready', async () => {
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(false, { callId: 'call-hot', status: 'Completed', lead: 'Hot', leadIntelligence: readyIntelligence, analysisSource: 'vapi_structured_output' }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, true);
  assert.equal(calls, 1);
});

test('test mode sends a meaningful legacy Summary when Lead is unavailable', async () => {
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(true, { status: 'Completed', lead: '', summary: 'Customer agreed to review a website demo.', analysisSource: 'empty_fallback' }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, true);
  assert.equal(calls, 1);
});

test('test mode blocks an empty legacy Summary with unavailable Lead', async () => {
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(true, { status: 'Completed', lead: '', summary: '', recordingUrl: 'https://recording.example/call.wav', analysisSource: 'empty_fallback' }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, false);
  assert.equal(calls, 0);
});

test('production blocks a meaningful legacy Summary when Lead is unavailable', async () => {
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(false, { status: 'Completed', lead: '', summary: 'Customer agreed to review a website demo.' }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, false);
  assert.equal(calls, 0);
});

test('production sends a meaningful legacy Summary for Hot', async () => {
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(false, { status: 'Completed', lead: 'Hot', summary: 'Customer requested a follow-up call.' }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, true);
  assert.equal(calls, 1);
});

test('successEvaluation true is not treated as a classified Lead', async () => {
  const legacy = extractLegacyCallAnalysis({ analysis: { summary: 'Customer agreed to review a demo.', successEvaluation: 'true' } });
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(false, { status: 'Completed', lead: String(legacy.lead), summary: legacy.summary }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, false);
  assert.equal(calls, 0);
});

test('recording URL without Summary is not a ready legacy card', async () => {
  let calls = 0;
  const sent = await notifyTelegramAfterIntelligenceReady(true, { status: 'Completed', lead: '', recordingUrl: 'https://recording.example/call.wav', analysisSource: 'empty_fallback' }, async () => { calls += 1; }, () => undefined);
  assert.equal(sent, false);
  assert.equal(calls, 0);
});

test('Unknown and technical endedReason are not meaningful legacy summaries', async () => {
  for (const summary of ['Unknown', 'assistant-said-end-call-phrase']) {
    let calls = 0;
    const sent = await notifyTelegramAfterIntelligenceReady(true, { status: 'Completed', lead: '', summary, analysisSource: 'empty_fallback' }, async () => { calls += 1; }, () => undefined);
    assert.equal(sent, false);
    assert.equal(calls, 0);
  }
});
