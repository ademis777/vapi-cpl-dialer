import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findWiseStructuredOutputs } from './wise-structured-output.js';
import { normalizedFromWise } from './normalized-outcome.js';
import { normalizePhone } from './phone-normalization.js';
import { PersistentPhoneRegistry } from './phone-registry.js';
import { buildWhatsAppUrl } from './whatsapp.js';
import { buildWiseDynamicVariables } from './dynamic-variables.js';
import { migrateCampaignProfiles } from './campaign-profiles.js';
import { resolveWiseFirst } from './call-result-resolution.js';
import { telegramNotificationPolicy } from './telegram.js';
import { buildOutboundCallPayload } from './outbound-call.js';
import { phoneEligibility } from './phone-eligibility.js';
import { prepareBulkImport, validImportAccounting } from './bulk-import.js';
import { CampaignHistoryStore } from './campaign-history.js';

function wiseFixture(outcome: string, details: Record<string, unknown> = {}) {
  return { artifact: { structuredOutputs: {
    classification: { name: 'call_classification', result: { human_answered: true, decision_maker_reached: true, call_outcome: outcome, interested: ['HOT','WARM','CALLBACK'].includes(outcome), do_not_contact: outcome === 'DNC', wrong_number: outcome === 'WRONG_NUMBER' } },
    details: { name: 'lead_details', result: { company: 'Acme', summary: `${outcome} summary`, next_action: 'Follow up', ...details } },
    qa: { name: 'agent_qa', result: { goal_achieved: true, conversation_quality: 'good', agent_mistakes: [], customer_sentiment: 'neutral' } },
  } } };
}

for (const expected of ['HOT','WARM','CALLBACK','COLD','DNC'] as const) test(`normalizes Wise ${expected}`, () => {
  const wise = findWiseStructuredOutputs(wiseFixture(expected)); assert.ok(wise);
  assert.equal(normalizedFromWise(wise, {}).businessOutcome, expected);
});

for (const expected of ['VOICEMAIL','IVR','NO_ANSWER','BUSY','WRONG_NUMBER','TECHNICAL_ERROR'] as const) test(`normalizes operational ${expected}`, () => {
  const wise = findWiseStructuredOutputs(wiseFixture(expected)); assert.ok(wise);
  assert.equal(normalizedFromWise(wise, {}).operationalOutcome, expected);
});

test('Wise output has precedence and skips legacy transcript analysis', async () => {
  let fallbackCalls = 0;
  const result = await resolveWiseFirst(wiseFixture('HOT'), async () => { fallbackCalls += 1; return 'legacy'; });
  assert.ok(result.wise); assert.equal(fallbackCalls, 0);
});

test('missing Wise output gracefully uses legacy fallback', async () => {
  const result = await resolveWiseFirst({ analysis: { summary: 'legacy' } }, async () => 'legacy');
  assert.equal(result.legacy, 'legacy');
});

test('normalizes US and Canada phone numbers', () => {
  assert.equal(normalizePhone('(212) 555-0100'), '12125550100');
  assert.equal(normalizePhone('+1 416 555 0100'), '14165550100');
});

test('DNC persists and phone index prevents duplicates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmnt-registry-'));
  const files = { dnc: path.join(dir, 'dnc.json'), index: path.join(dir, 'phone-index.json') };
  const registry = new PersistentPhoneRegistry(files); registry.seed([]);
  registry.recordPhone({ phone: '212-555-0100', company: 'Acme' });
  assert.equal(new PersistentPhoneRegistry(files).hasPhone('+1 212 555 0100'), true);
  registry.addDnc({ phone: '(212) 555-0100', reason: 'requested', sourceCallId: 'call-1', company: 'Acme' });
  assert.equal(new PersistentPhoneRegistry(files).isDnc('+12125550100'), true);
});

test('removing a dedup entry preserves DNC independently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmnt-registry-remove-'));
  const files = { dnc: path.join(dir, 'dnc.json'), index: path.join(dir, 'phone-index.json') };
  const registry = new PersistentPhoneRegistry(files); registry.seed([]); registry.recordPhone({ phone: '+12125550100', contactId: 'lead-1' }); registry.addDnc({ phone: '+12125550100', reason: 'requested' });
  assert.deepEqual(registry.removePhone('(212) 555-0100'), { normalizedPhone: '12125550100', removed: 1 });
  assert.equal(registry.hasPhone('+12125550100'), false); assert.equal(registry.isDnc('+12125550100'), true);
});

test('campaign cleanup removes only matching dedupe entries and preserves DNC', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmnt-registry-campaign-clear-'));
  const files = { dnc: path.join(dir, 'dnc.json'), index: path.join(dir, 'phone-index.json') };
  const registry = new PersistentPhoneRegistry(files); registry.seed([]);
  registry.recordPhones([{ phone: '+12125550100' }, { phone: '+12125550101' }, { phone: '+12125550102' }]);
  registry.addDnc({ phone: '+12125550101', reason: 'requested' });
  assert.deepEqual(registry.removePhones(['(212) 555-0100', '+1 212 555 0101']), { requested: 2, removed: 2 });
  assert.equal(registry.hasPhone('+12125550100'), false); assert.equal(registry.hasPhone('+12125550101'), false);
  assert.equal(registry.hasPhone('+12125550102'), true); assert.equal(registry.isDnc('+12125550101'), true);
});

test('DNC prevents queue eligibility and has priority over duplicate', () => {
  const registry = { isDnc: () => true, hasPhone: () => true };
  assert.deepEqual(phoneEligibility(registry, '+12125550100', false), { allowed: false, reason: 'dnc' });
  assert.deepEqual(phoneEligibility(registry, '+12125550100', true), { allowed: false, reason: 'dnc' });
});

test('phone eligibility rejects a global duplicate without company key', () => {
  assert.deepEqual(phoneEligibility({ isDnc: () => false, hasPhone: () => true }, '+12125550100'), { allowed: false, reason: 'duplicate' });
});

test('Telegram policy is idempotent', () => {
  assert.equal(telegramNotificationPolicy(false, { status: 'Completed', lead: 'Hot' }), true);
  assert.equal(telegramNotificationPolicy(false, { status: 'Completed', lead: 'Hot', telegramSentAt: '2026-01-01T00:00:00Z' }), false);
});

test('WhatsApp URL uses normalized phone and encoded message', () => {
  const url = buildWhatsAppUrl('(212) 555-0100', 'Hi {{company}} {{demo_url}}', { company: 'A & B', demo_url: 'https://demo.test/x' });
  assert.match(url, /^https:\/\/wa\.me\/12125550100\?text=/); assert.ok(url.includes('%26'));
});

test('missing demo_url never renders undefined or an invalid link', () => {
  const url = buildWhatsAppUrl('2125550100', 'Hi {{company}} {{demo_url}}', { company: 'Acme' });
  const message = new URL(url).searchParams.get('text') || '';
  assert.ok(!message.includes('undefined')); assert.ok(!message.includes('http://')); assert.ok(!message.includes('https://'));
});

test('dynamic variables include required values and omit absent optional values', () => {
  assert.deepEqual(buildWiseDynamicVariables({ company: 'Acme', phone: '+12125550100' }), { company: 'Acme', phone: '+12125550100', agent_name: 'Alex' });
});

test('old campaign profile is copied once to persistent storage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmnt-profiles-')), legacy = path.join(root, 'app'), persistent = path.join(root, 'data');
  fs.mkdirSync(legacy); fs.writeFileSync(path.join(legacy, 'old.json'), JSON.stringify({ campaignName: 'old', systemPrompt: 'legacy' }));
  assert.equal(migrateCampaignProfiles(legacy, persistent).migrated, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(persistent, 'old.json'), 'utf8')).systemPrompt, 'legacy');
  assert.equal(migrateCampaignProfiles(legacy, persistent).migrated, 0);
});

test('legacy assistant overrides remain enabled by default', () => {
  const result = buildOutboundCallPayload({ assistantId: 'a', phoneNumberId: 'p', contact: { company: 'Acme', phone: '+1' }, campaignSystemPrompt: 'prompt', hotLeadRules: '', analysisPlan: {}, inlineVoice: { provider: 'vapi', voiceId: 'Elliot' } });
  assert.equal(result.debug.legacyAssistantOverrides, true); assert.equal(result.payload.assistantOverrides.model.model, 'gpt-4o-mini'); assert.equal(Object.hasOwn(result.payload.assistantOverrides, 'firstMessage'), false);
});

test('Wise payload only carries dynamic variables when legacy override flag is off', () => {
  const result = buildOutboundCallPayload({ assistantId: 'a', phoneNumberId: 'p', contact: { company: 'Acme', phone: '+1' }, campaignSystemPrompt: 'prompt', hotLeadRules: '', analysisPlan: {}, inlineVoice: { provider: 'vapi', voiceId: 'Elliot' }, legacyAssistantOverrides: false, dynamicVariables: { company: 'Acme', phone: '+1' } });
  assert.deepEqual(result.payload.assistantOverrides, { variableValues: { company: 'Acme', phone: '+1' } });
});

for (const size of [40, 500, 1000, 5000]) test(`bulk import preserves all ${size} unique valid contacts`, () => {
  const items = Array.from({ length: size }, (_, index) => ({ company: `Company ${index}`, phone: `+1202${String(index).padStart(7, '0')}` }));
  const result = prepareBulkImport(items, new Set(), new Set());
  assert.equal(result.report.imported, size); assert.equal(result.contacts.length, size); assert.equal(validImportAccounting(result.report), true);
});

test('5000-contact mixed fixture has exact accounting', () => {
  const unique = Array.from({ length: 4700 }, (_, index) => ({ company: `Company ${index}`, phone: `+1202${String(index).padStart(7, '0')}` }));
  const duplicates = unique.slice(0, 200).map(item => ({ ...item, company: `${item.company} duplicate` }));
  const dnc = Array.from({ length: 50 }, (_, index) => ({ company: `DNC ${index}`, phone: `+1303${String(8000 + index).padStart(7, '0')}` }));
  const invalid = Array.from({ length: 50 }, (_, index) => ({ company: `Invalid ${index}`, phone: index % 2 ? '' : '123' }));
  const dncPhones = new Set(dnc.map(item => normalizePhone(item.phone)));
  const result = prepareBulkImport([...unique, ...duplicates, ...dnc, ...invalid], new Set(), dncPhones);
  assert.deepEqual(result.report, { parsed: 5000, submitted: 5000, imported: 4700, duplicates: 200, dnc: 50, invalid: 50, failed: 0 });
  assert.equal(validImportAccounting(result.report), true);
});

test('campaign history survives store recreation and exports BOM CSV without secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmnt-history-')), campaign:any = { campaignName: 'History Test', contacts: [] };
  const contact:any = { id: 'lead-1', company: 'Acme', phone: '+12125550100', status: 'Completed', lead: 'Hot', callId: 'call-1', normalizedResult: { businessOutcome: 'HOT', operationalOutcome: 'COMPLETED', summary: 'Interested', nextAction: 'Send demo' } };
  const first = new CampaignHistoryStore(dir); first.append(campaign, [contact], 'assistant-1');
  const second = new CampaignHistoryStore(dir); assert.equal(second.records(campaign.campaignId).length, 1); const csv=second.csv(campaign.campaignId);
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv,/Campaign ID/); assert.match(csv,/Send demo/); assert.ok(!/api.?key|secret/i.test(csv));
});

test('campaign history preserves multiple attempts for one contact', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dmnt-attempt-history-')),campaign:any={campaignName:'Production',contacts:[]};
  const store=new CampaignHistoryStore(dir); store.append(campaign,[{id:'lead-1',currentAttemptId:'attempt-1',attemptNumber:1,phone:'+12125550100',status:'Completed'}]); store.append(campaign,[{id:'lead-1',currentAttemptId:'attempt-2',attemptNumber:2,phone:'+12125550100',status:'No Answer'}]);
  assert.deepEqual(store.records(campaign.campaignId).map(x=>x.attemptNumber),[1,2]);
});

test('campaign cleanup removes only the selected campaign history', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dmnt-remove-campaign-history-')),store=new CampaignHistoryStore(dir);
  const current:any={campaignName:'Current',contacts:[]},other:any={campaignName:'Other',contacts:[]};
  store.append(current,[{id:'current',phone:'+12125550100',status:'Completed'}]); store.append(other,[{id:'other',phone:'+12125550101',status:'Completed'}]);
  assert.deepEqual(store.removeCampaign(current.campaignId),{removedCampaigns:1,removedResults:1});
  assert.equal(store.list().some(x=>x.campaignId===current.campaignId),false); assert.equal(store.records(other.campaignId).length,1);
});

test('clear test history keeps production campaigns and records', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dmnt-clear-test-')),store=new CampaignHistoryStore(dir); const prod:any={campaignName:'August Production',contacts:[]},testCampaign:any={campaignName:'August Test Campaign',contacts:[]};
  store.append(prod,[{id:'prod',currentAttemptId:'prod-1',phone:'+12125550100',status:'Completed'},{id:'test',currentAttemptId:'test-1',phone:'+12125550101',status:'Completed',isTest:true}]); store.append(testCampaign,[{id:'test-campaign',currentAttemptId:'test-2',phone:'+12125550102',status:'Completed'}]);
  assert.deepEqual(store.clearTestData(),{removedCampaigns:1,removedResults:2}); assert.equal(store.records(prod.campaignId).length,1); assert.equal(store.list().some(x=>x.campaignId===testCampaign.campaignId),false);
});
