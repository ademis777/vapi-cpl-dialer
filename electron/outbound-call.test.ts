import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RUSSIAN_SYSTEM_PROMPT_PLACEHOLDER,
  assertSelectedAssistantMatchesPayload,
  buildOutboundCallPayload,
} from './outbound-call.js';

function build(options: { contactName?: string; systemPrompt?: string; assistantId?: string } = {}) {
  return buildOutboundCallPayload({
    assistantId: options.assistantId ?? 'assistant-selected-in-ui',
    phoneNumberId: 'phone-number-id',
    contact: { company: 'Example Roofing', phone: '+12125550126', contactName: options.contactName },
    campaignSystemPrompt: options.systemPrompt ?? 'You are an English-speaking sales assistant.',
    hotLeadRules: '',
    analysisPlan: { structuredDataPlan: { enabled: true } },
    assistantVoice: { provider: 'vapi', voiceId: 'Elliot' },
    inlineVoice: { provider: 'vapi', voiceId: 'Elliot' },
  });
}

test('Russian UI placeholder never enters the Vapi payload', () => {
  const { payload } = build({ systemPrompt: RUSSIAN_SYSTEM_PROMPT_PLACEHOLDER });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(RUSSIAN_SYSTEM_PROMPT_PLACEHOLDER), false);
  assert.equal(Object.hasOwn(payload.assistantOverrides.model, 'messages'), false);
});

test('campaign prompt adds neither call-level firstMessage nor model messages', () => {
  const { payload } = build({ contactName: 'John', systemPrompt: 'Ты русскоязычный помощник.' });
  assert.equal(Object.hasOwn(payload.assistantOverrides, 'firstMessage'), false);
  assert.equal(Object.hasOwn(payload.assistantOverrides.model, 'messages'), false);
});

test('outbound payload never overrides the saved Vapi Assistant firstMessage', () => {
  const legacy = build({ contactName: 'John' }).payload;
  const variablesOnly = buildOutboundCallPayload({
    assistantId: 'assistant',
    phoneNumberId: 'phone',
    contact: { company: 'Carter', phone: '+1', contactName: 'John' },
    campaignSystemPrompt: '',
    hotLeadRules: '',
    analysisPlan: {},
    inlineVoice: { provider: 'vapi', voiceId: 'Elliot' },
    legacyAssistantOverrides: false,
    dynamicVariables: { company: 'Carter' },
  }).payload;
  assert.equal(Object.hasOwn(legacy.assistantOverrides, 'firstMessage'), false);
  assert.equal(Object.hasOwn(variablesOnly.assistantOverrides, 'firstMessage'), false);
});

test('transcriber uses the supported Deepgram structure with language en', () => {
  const { payload, debug } = build();
  assert.deepEqual(payload.assistantOverrides.transcriber, { provider: 'deepgram', model: 'nova-3', language: 'en' });
  assert.equal(debug.transcriberLanguage, 'en');
});

test('payload uses the Assistant ID selected in the UI', () => {
  const { payload } = build({ assistantId: 'assistant-from-ui' });
  assert.equal(payload.assistantId, 'assistant-from-ui');
  assert.doesNotThrow(() => assertSelectedAssistantMatchesPayload('assistant-from-ui', payload));
  assert.throws(() => assertSelectedAssistantMatchesPayload('assistant-from-ui', { assistantId: 'different-assistant' }), /does not match call payload/);
});

test('payload applies Vapi hard duration, silence and goodbye safeguards', () => {
  const { payload } = build();
  assert.equal(payload.assistantOverrides.maxDurationSeconds, 300);
  assert.equal(payload.assistantOverrides.silenceTimeoutSeconds, 30);
  assert.ok(payload.assistantOverrides.endCallPhrases.includes('goodbye'));
  assert.deepEqual(payload.assistantOverrides.model.tools, [{ type: 'dtmf' }, { type: 'endCall' }]);
});

test('payload preserves the enabled legacy summary plan', () => {
  const { payload } = buildOutboundCallPayload({
    assistantId: 'assistant',
    phoneNumberId: 'phone',
    contact: { company: 'Carter', phone: '+1' },
    campaignSystemPrompt: '',
    hotLeadRules: '',
    analysisPlan: { summaryPlan: { enabled: true } },
    inlineVoice: { provider: 'vapi', voiceId: 'Elliot' },
  });
  assert.deepEqual(payload.assistantOverrides.analysisPlan.summaryPlan, { enabled: true });
});

test('existing Assistant tools are preserved and DTMF/endCall are added once', () => {
  const { payload } = buildOutboundCallPayload({ assistantId: 'assistant', phoneNumberId: 'phone', contact: { company: 'Carter', phone: '+1' }, campaignSystemPrompt: '', hotLeadRules: '', analysisPlan: {}, assistantTools: [{ type: 'transferCall', destinations: [] }, { type: 'endCall' }], inlineVoice: { provider: 'vapi', voiceId: 'Elliot' } });
  assert.deepEqual(payload.assistantOverrides.model.tools.map((tool: { type: string }) => tool.type), ['transferCall', 'dtmf', 'endCall']);
});

test('unnamed contact payload contains no fixed customer name', () => {
  const { payload } = build();
  assert.equal(Object.hasOwn(payload.assistantOverrides, 'firstMessage'), false);
  assert.equal(payload.customer.name, '');
});
