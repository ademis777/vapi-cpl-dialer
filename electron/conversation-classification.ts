const NON_SUBSTANTIVE_CUSTOMER_SPEECH = /^(?:hi|hello|hey|yes|yeah|yep|no|okay|ok|speaking|this is (?:he|she)|not interested|no thanks|not now|don't call|do not call|bye|goodbye|thanks|thank you|you too)[.!?,\s]*$/i;
const IVR_SPEECH = /\b(?:press\s*[0-9]|main\s+menu|automated\s+system|all\s+agents\s+are\s+busy|please\s+hold|your\s+call\s+is\s+important|on\s+hold|connecting\s+your\s+call|enter\s+(?:your\s+)?(?:zip|extension|account\s+number))\b/i;

function textOf(message: any) { return String(message?.message || message?.content || '').trim(); }
function isCustomer(message: any) { return ['user', 'customer'].includes(String(message?.role || '').toLowerCase()); }

export function hasMeaningfulHumanDialogue(call: any) {
  const messages = Array.isArray(call?.artifact?.messages) ? call.artifact.messages : Array.isArray(call?.messages) ? call.messages : [];
  const customerSpeech = messages.filter(isCustomer).map(textOf).filter(Boolean);
  if (customerSpeech.some((text: string) => !NON_SUBSTANTIVE_CUSTOMER_SPEECH.test(text) && !IVR_SPEECH.test(text))) return true;
  if (customerSpeech.length) return false;

  const transcript = String(call?.artifact?.transcript || call?.transcript || '').trim();
  if (!transcript) return false;
  const customerLines = transcript.split(/\r?\n/).map((line: string) => line.match(/^\s*(?:user|customer)\s*:\s*(.+)$/i)?.[1]?.trim()).filter(Boolean) as string[];
  return customerLines.some(text => !NON_SUBSTANTIVE_CUSTOMER_SPEECH.test(text) && !IVR_SPEECH.test(text));
}

export function classifyFinalStatus(input: { failed: boolean; noAnswer: boolean; ivr: boolean; meaningfulDialogue: boolean }) {
  if (input.failed) return 'Failed' as const;
  if (input.ivr) return 'IVR' as const;
  if (input.noAnswer || !input.meaningfulDialogue) return 'No Answer' as const;
  return 'Completed' as const;
}
