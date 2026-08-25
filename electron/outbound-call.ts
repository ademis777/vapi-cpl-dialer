export const RUSSIAN_SYSTEM_PROMPT_PLACEHOLDER = 'Опишите роль ассистента, цель звонка и критерии Hot / Warm / Cold...';

export const LANGUAGE_REQUIREMENT = `LANGUAGE REQUIREMENT:
Speak only in natural American English.
Never speak Russian, Ukrainian, or another language unless the customer explicitly requests it.
Do not translate the first message.`;

export const SAFE_ENGLISH_SYSTEM_PROMPT = `You are Alex, an AI outbound calling assistant for DMNT.
Be brief, professional, respectful, and focused on understanding the customer's business needs.`;

export type OutboundContact = {
  company: string;
  phone: string;
  contactName?: string;
  zipCode?: string;
};

type Voice = { provider: string; voiceId: string };

type BuildOutboundCallOptions = {
  assistantId: string;
  phoneNumberId: string;
  contact: OutboundContact;
  campaignSystemPrompt: string;
  hotLeadRules: string;
  analysisPlan: unknown;
  voiceOverride?: Voice;
  assistantVoice?: Voice;
  inlineVoice: Voice;
  assistantTools?: Array<Record<string, unknown>>;
  maximumCallDurationSeconds?: number;
  silenceTimeoutSeconds?: number;
  legacyAssistantOverrides?: boolean;
  dynamicVariables?: Record<string, string>;
};

export function buildEffectiveSystemPrompt(systemPrompt: string, hotLeadRules: string) {
  const savedPrompt = String(systemPrompt || '').trim();
  const basePrompt = !savedPrompt || savedPrompt === RUSSIAN_SYSTEM_PROMPT_PLACEHOLDER
    ? SAFE_ENGLISH_SYSTEM_PROMPT
    : savedPrompt;
  const rules = String(hotLeadRules || '').trim();
  return `${basePrompt}${rules ? `\n\nHot Lead Rules:\n${rules}` : ''}\n\n${LANGUAGE_REQUIREMENT}\n\nCALL END REQUIREMENT:\nAfter the customer confirms goodbye, say at most \"Thank you. Goodbye.\" and immediately use the endCall tool. Never restart the introduction in the same call.\n\nIVR NAVIGATION REQUIREMENT:\nWhen an automated phone menu says to press a key, immediately use the dtmf tool with that key and wait for the next menu. Prefer Sales, New Customer, Estimates, Service, Operator, or Representative. Do not end the call merely because an IVR asks for a key.`;
}

export function detectPromptLanguage(prompt: string) {
  if (/[А-Яа-яЁёІіЇїЄєҐґ]/.test(prompt)) return 'contains-cyrillic';
  return 'en';
}

export function assertSelectedAssistantMatchesPayload(selectedAssistantId: string, payload: Record<string, any>) {
  if (selectedAssistantId && payload.assistantId !== selectedAssistantId) {
    throw new Error(`Selected Vapi Assistant ID does not match call payload Assistant ID (${selectedAssistantId} != ${payload.assistantId || 'missing'})`);
  }
}

export function buildOutboundCallPayload(options: BuildOutboundCallOptions) {
  const effectivePrompt = buildEffectiveSystemPrompt(options.campaignSystemPrompt, options.hotLeadRules) + (options.contact.zipCode ? `\n\nLEAD ZIP CODE FOR IVR ONLY: ${options.contact.zipCode}. If an IVR requests a ZIP code, enter these digits with the dtmf tool.` : '');
  const transcriber = { provider: 'deepgram', model: 'nova-3', language: 'en' };
  const tools = [...(options.assistantTools || []).filter(tool => tool?.type !== 'endCall' && tool?.type !== 'dtmf'), { type: 'dtmf' }, { type: 'endCall' }];
  const assistantOverrides = {
    model: { provider: 'openai', model: 'gpt-4o-mini', tools },
    ...(options.voiceOverride ? { voice: options.voiceOverride } : {}),
    transcriber,
    analysisPlan: options.analysisPlan,
    maxDurationSeconds: Math.max(10, Number(options.maximumCallDurationSeconds) || 300),
    silenceTimeoutSeconds: Math.max(10, Number(options.silenceTimeoutSeconds) || 30),
    endCallPhrases: ['goodbye', 'good bye', 'bye', 'bye-bye', 'have a great day', 'have a good day', 'take care', 'talk to you later', 'talk to you soon', 'thank you. goodbye'],
  };
  const legacyAssistantOverrides = options.legacyAssistantOverrides !== false;
  const payload: Record<string, any> = {
    phoneNumberId: options.phoneNumberId,
    customer: { number: options.contact.phone, name: String(options.contact.contactName ?? '') },
    ...(options.assistantId
      ? { assistantId: options.assistantId, assistantOverrides: legacyAssistantOverrides ? assistantOverrides : { variableValues: options.dynamicVariables || {} } }
      : { assistant: { name: 'DMNT Dialer', voice: options.inlineVoice, ...assistantOverrides } }),
  };
  assertSelectedAssistantMatchesPayload(options.assistantId, payload);
  const effectiveVoice = options.voiceOverride || options.assistantVoice || (!options.assistantId ? options.inlineVoice : undefined);

  return {
    payload,
    debug: {
      assistantId: options.assistantId || 'inline-assistant',
      company: options.contact.company,
      contactName: options.contact.contactName || '',
      effectivePromptLanguage: detectPromptLanguage(effectivePrompt),
      voiceProvider: effectiveVoice?.provider || 'assistant-default',
      voiceId: effectiveVoice?.voiceId || 'assistant-default',
      transcriberProvider: transcriber.provider,
      transcriberLanguage: transcriber.language,
      legacyAssistantOverrides,
      dynamicVariableKeys: Object.keys(options.dynamicVariables || {}).sort(),
    },
  };
}
