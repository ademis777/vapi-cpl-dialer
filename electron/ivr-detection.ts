export type IvrDetection = { phrase: string; summary: string };

const IVR_PATTERNS: Array<{ pattern: RegExp; phrase: string; summary: string }> = [
  { pattern: /\bpress\s+1\b/i, phrase: 'press 1', summary: 'IVR: Press 1 required' },
  { pattern: /\bpress\s+2\b/i, phrase: 'press 2', summary: 'IVR: Press 2 required' },
  { pattern: /\bfor\s+sales\b/i, phrase: 'for sales', summary: 'IVR: Sales menu detected' },
  { pattern: /\bfor\s+service\b/i, phrase: 'for service', summary: 'IVR: Service menu detected' },
  { pattern: /\benter\s+your\s+zip\b/i, phrase: 'enter your zip', summary: 'IVR: ZIP code required' },
  { pattern: /\benter\s+(?:an?\s+|your\s+)?extension\b/i, phrase: 'enter extension', summary: 'IVR: Extension required' },
  { pattern: /\bmain\s+menu\b/i, phrase: 'main menu', summary: 'IVR: Main menu detected' },
  { pattern: /\bautomated\s+system\b/i, phrase: 'automated system', summary: 'IVR: Automated system detected' },
  { pattern: /\ball\s+agents\s+are\s+busy\b/i, phrase: 'all agents are busy', summary: 'IVR: All agents are busy' },
  { pattern: /\bplease\s+hold\b/i, phrase: 'please hold', summary: 'IVR: Asked to hold' },
  { pattern: /\byour\s+call\s+is\s+important\b/i, phrase: 'your call is important', summary: 'IVR: Call queue detected' },
  { pattern: /\bon\s+hold\b/i, phrase: 'on hold', summary: 'IVR: Call placed on hold' },
  { pattern: /\bconnecting\s+your\s+call\b/i, phrase: 'connecting your call', summary: 'IVR: Call transfer in progress' },
  { pattern: /\btransfer(?:ring)?\b/i, phrase: 'transfer', summary: 'IVR: Call transfer detected' },
  { pattern: /\bqueue\b/i, phrase: 'queue', summary: 'IVR: Call queue detected' },
  { pattern: /\bpress\b/i, phrase: 'press', summary: 'IVR: Key press required' },
];

function messageText(message: any) { return String(message?.message || message?.content || '').trim(); }
function isRemoteMessage(message: any) {
  const role = String(message?.role || '').toLowerCase();
  return !['system', 'assistant', 'bot', 'tool', 'function'].includes(role);
}

function secondsFromStart(message: any, startedAtMs: number) {
  if (Number.isFinite(message?.secondsFromStart)) return Number(message.secondsFromStart);
  if (!Number.isFinite(message?.time)) return 0;
  const time = Number(message.time);
  if (time < 1_000_000) return time;
  return startedAtMs ? (time - startedAtMs) / 1000 : Number.POSITIVE_INFINITY;
}

export function detectIvr(call: any, windowSeconds = 15): IvrDetection | undefined {
  const messages = Array.isArray(call?.artifact?.messages) ? call.artifact.messages : Array.isArray(call?.messages) ? call.messages : [];
  const startedAtMs = Date.parse(String(call?.startedAt || call?.createdAt || '')) || 0;
  const openingTranscript = messages.filter((message: any) => isRemoteMessage(message) && secondsFromStart(message, startedAtMs) <= windowSeconds).map(messageText).filter(Boolean).join(' ');
  if (!openingTranscript) return undefined;
  const match = IVR_PATTERNS.find(candidate => candidate.pattern.test(openingTranscript));
  return match ? { phrase: match.phrase, summary: match.summary } : undefined;
}
