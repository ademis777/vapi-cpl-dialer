export type IvrNavigationDecision =
  | { kind: 'dtmf'; digits: string; label: string; promptKey: string }
  | { kind: 'missing-data'; summary: string; promptKey: string };

const PRIORITIES = [
  { label: 'Sales', pattern: /sales/i },
  { label: 'New Customer', pattern: /new\s+customer/i },
  { label: 'Estimates', pattern: /estimates?/i },
  { label: 'Roofing Service', pattern: /roofing\s+service/i },
  { label: 'Service', pattern: /service/i },
  { label: 'Operator', pattern: /operator/i },
  { label: 'Representative', pattern: /representative|speak\s+with\s+someone|talk\s+to\s+someone/i },
];

function openingTranscript(call: any, windowSeconds: number) {
  const messages = Array.isArray(call?.artifact?.messages) ? call.artifact.messages : Array.isArray(call?.messages) ? call.messages : [];
  const startedAtMs = Date.parse(String(call?.startedAt || call?.createdAt || '')) || 0;
  return messages.filter((message: any) => {
    const role = String(message?.role || '').toLowerCase();
    if (['system', 'assistant', 'bot', 'tool', 'function'].includes(role)) return false;
    if (Number.isFinite(message?.secondsFromStart)) return Number(message.secondsFromStart) <= windowSeconds;
    if (!Number.isFinite(message?.time)) return true;
    const time = Number(message.time);
    return time < 1_000_000 ? time <= windowSeconds : Boolean(startedAtMs && (time - startedAtMs) / 1000 <= windowSeconds);
  }).map((message: any) => String(message?.message || message?.content || '').trim()).filter(Boolean).join(' ');
}

function digitForLabel(text: string, pattern: RegExp) {
  const label = pattern.source;
  return text.match(new RegExp(`press\\s*([0-9#*])[^,.;]{0,45}(?:${label})`, 'i'))?.[1]
    || text.match(new RegExp(`(?:${label})[^,.;]{0,45}?press\\s*([0-9#*])`, 'i'))?.[1];
}

function promptKey(text: string, label: string, digits: string) {
  const tail = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(-260);
  return `${label.toLowerCase()}:${digits}:${tail}`;
}

export function extractUsZip(value: unknown) {
  return String(value || '').match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || '';
}

export function detectIvrNavigation(call: any, context: { zipCode?: string } = {}, windowSeconds = 90): IvrNavigationDecision | undefined {
  const text = openingTranscript(call, windowSeconds);
  if (!text) return undefined;
  const zipRequest = /\b(?:enter|provide|key\s+in|type\s+in)\s+(?:your\s+|the\s+)?(?:zip(?:\s+code)?|postal\s+code)\b/i.test(text)
    || /\b(?:zip|postal)\s+code\b[^.?!]{0,50}\b(?:enter|please|required)\b/i.test(text);
  if (zipRequest) {
    const zip = extractUsZip(context.zipCode);
    return zip
      ? { kind: 'dtmf', digits: zip, label: 'ZIP code', promptKey: promptKey(text, 'ZIP code', zip) }
      : { kind: 'missing-data', summary: 'IVR: ZIP code required but lead ZIP is unavailable', promptKey: promptKey(text, 'ZIP missing', '') };
  }
  if (/\b(?:enter|provide)\s+(?:an?\s+|your\s+)?extension\b/i.test(text)) return { kind: 'missing-data', summary: 'IVR: Extension required', promptKey: promptKey(text, 'Extension', '') };
  if (/\b(?:enter|provide)\s+(?:an?\s+|your\s+)?account\s+(?:number|id)\b/i.test(text)) return { kind: 'missing-data', summary: 'IVR: Account number required', promptKey: promptKey(text, 'Account', '') };

  for (const priority of PRIORITIES) {
    const digit = digitForLabel(text, priority.pattern);
    if (digit) return { kind: 'dtmf', digits: digit, label: priority.label, promptKey: promptKey(text, priority.label, digit) };
  }
  const digit = text.match(/\bpress\s*([0-9#*])\b/i)?.[1];
  return digit ? { kind: 'dtmf', digits: digit, label: `Option ${digit}`, promptKey: promptKey(text, `Option ${digit}`, digit) } : undefined;
}

export type IvrDtmfState = { attempts?: number; handledPromptKeys?: string[] };

export function shouldSendDtmf(state: IvrDtmfState, decision: IvrNavigationDecision) {
  return decision.kind === 'dtmf'
    && Number(state.attempts || 0) < 6
    && !(state.handledPromptKeys || []).includes(decision.promptKey);
}

export type ExecutedDtmf = { id: string; digits: string };

export function executedDtmfCalls(call: any): ExecutedDtmf[] {
  const messages = Array.isArray(call?.artifact?.messages) ? call.artifact.messages : Array.isArray(call?.messages) ? call.messages : [];
  const results: ExecutedDtmf[] = [];
  for (const message of messages) {
    const calls = Array.isArray(message?.toolCalls) ? message.toolCalls : message?.toolCall ? [message.toolCall] : [];
    for (const toolCall of calls) {
      if (String(toolCall?.function?.name || toolCall?.name || '').toLowerCase() !== 'dtmf') continue;
      let args: any = toolCall?.function?.arguments ?? toolCall?.arguments ?? {};
      if (typeof args === 'string') try { args = JSON.parse(args); } catch { args = {}; }
      const digits = String(args?.keys ?? args?.digits ?? '').trim();
      if (digits) results.push({ id: String(toolCall?.id || `${message?.time || message?.secondsFromStart || ''}:${digits}`), digits });
    }
  }
  return results;
}
