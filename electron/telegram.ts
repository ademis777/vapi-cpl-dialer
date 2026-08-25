export type TelegramContact = {
  status: string;
  lead: string;
};

export type TelegramIntelligenceContact = TelegramContact & {
  callId?: string;
  summary?: string;
  recordingUrl?: string;
  leadIntelligence?: {
    currentSituation: string[];
    painPoints: string[];
    questionsAsked: string[];
    customerSummary: string[];
  };
  analysisSource?: string;
  telegramSentAt?: string;
  telegramMessageId?: string;
  normalizedResult?: { businessOutcome?: string; operationalOutcome?: string };
};

export function telegramNotificationPolicy(testMode: boolean, contact: TelegramIntelligenceContact, legacyPolicy = true) {
  if (contact.telegramSentAt) return false;
  if (testMode) return contact.status === 'Completed';
  if (legacyPolicy) return contact.lead === 'Hot';
  const business = contact.normalizedResult?.businessOutcome;
  const operational = contact.normalizedResult?.operationalOutcome;
  return ['HOT', 'WARM', 'CALLBACK'].includes(String(business || '')) || operational === 'TECHNICAL_ERROR';
}

export function shouldNotifyTelegram(testMode: boolean, contact: TelegramContact) {
  return telegramNotificationPolicy(testMode, contact, true);
}

export function isMeaningfulLegacySummary(summary: unknown) {
  const value = typeof summary === 'string' ? summary.trim() : '';
  if (!value || /^unknown$/i.test(value)) return false;
  const normalized = value.toLowerCase().replace(/[ _]+/g, '-');
  return !/^(ended|end-of-call-report|assistant-said-end-call-phrase|customer-ended-call|customer-did-not-answer|silence-timed-out|exceeded-max-duration|call-(?:ended|failed)|pipeline-error|transport-error)$/.test(normalized);
}

export async function notifyTelegramIfNeeded<T extends TelegramContact>(
  shouldNotify: boolean,
  contact: T,
  send: (contact: T) => Promise<void>,
) {
  if (!shouldNotify) return false;
  await send(contact);
  return true;
}

export async function notifyTelegramAfterIntelligenceReady<T extends TelegramIntelligenceContact>(
  testMode: boolean,
  contact: T,
  send: (contact: T) => Promise<void>,
  log: (event: string, details: Record<string, unknown>) => void,
  legacyPolicy = true,
) {
  const shouldNotifyTelegram = telegramNotificationPolicy(testMode, contact, legacyPolicy);
  if (!shouldNotifyTelegram) return false;

  const intelligence = contact.leadIntelligence;
  const hasLegacySummary = isMeaningfulLegacySummary(contact.summary);
  const debug = {
    callId: contact.callId || 'missing',
    status: contact.status,
    lead: contact.lead || 'Unknown',
    hasLeadIntelligence: Boolean(intelligence),
    intelligenceSource: contact.analysisSource || 'missing',
    currentSituationCount: intelligence?.currentSituation.length || 0,
    painPointsCount: intelligence?.painPoints.length || 0,
    questionsCount: intelligence?.questionsAsked.length || 0,
    customerSummaryCount: intelligence?.customerSummary.length || 0,
    hasLegacySummary,
  };
  log('telegram_payload_debug', debug);
  const hasSubstantiveIntelligence = Boolean(intelligence && (
    intelligence.currentSituation.length
    || intelligence.painPoints.length
    || intelligence.questionsAsked.length
    || intelligence.customerSummary.length
  ));
  const intelligenceReady = Boolean(intelligence && contact.analysisSource && contact.analysisSource !== 'empty_fallback' && hasSubstantiveIntelligence);
  if (!intelligenceReady && !hasLegacySummary) {
    log('telegram_skipped_intelligence_not_ready', debug);
    return false;
  }

  await send(contact);
  return true;
}

export function requireTelegramCredentials(botToken: string, chatId: string) {
  if (!botToken.trim()) throw new Error('Telegram Bot Token is missing');
  if (!chatId.trim()) throw new Error('Telegram Chat ID is missing');
  return { botToken: botToken.trim(), chatId: chatId.trim() };
}

export function applyHotLeadPolicy(hotCount: number, lead: string) {
  const nextHotCount = lead === 'Hot' ? hotCount + 1 : hotCount;
  return { hotCount: nextHotCount, shouldPause: lead === 'Hot' && nextHotCount >= 3 };
}
