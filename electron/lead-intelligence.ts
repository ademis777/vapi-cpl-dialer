import { sanitizeCustomerName, sanitizeSummaryIdentity } from './summary-safety.js';

export type LeadLevel = 'Hot' | 'Warm' | 'Cold' | 'Unknown';
export type InterestLevel = 'High' | 'Medium' | 'Low' | 'Unknown';
export type DecisionMaker = 'Yes' | 'No' | 'Unknown';
export type BudgetSignal = 'High' | 'Medium' | 'Low' | 'Unknown';
export type Urgency = 'Hot' | 'Medium' | 'Low' | 'Unknown';

export type LeadIntelligence = {
  lead: LeadLevel;
  customerName: string;
  company: string;
  phone: string;
  interestLevel: InterestLevel;
  currentSituation: string[];
  painPoints: string[];
  questionsAsked: string[];
  objections: string[];
  decisionMaker: DecisionMaker;
  budgetSignals: BudgetSignal;
  urgency: Urgency;
  nextStep: string;
  followUpRecommendation: string;
  customerSummary: string[];
};

export const LEAD_INTELLIGENCE_EXTRACTION_PROMPT = `Extract Lead Intelligence only from facts stated or confirmed by the customer.
Alex is always the DMNT AI assistant and is never the customer. Never assign the name Alex to the customer. If the customer's name is unknown, use Unknown and refer to them as "the customer", "the business owner", or "the recipient".
Do not summarize the conversation and do not describe the assistant, agent, DMNT, or anything the agent explained, offered, proposed, or can do.
Use Unknown or an empty array when the customer did not provide a field.
Customer Summary must contain at most five short customer-only facts.`;

type ContactIdentity = { company: string; phone: string; contactName?: string };

const forbiddenSummaryPatterns = [
  /\balex\s+(explained|offered|told|proposed)\b/i,
  /\b(our company|we)\s+(explained|offered|told|proposed|can|create)\b/i,
  /\bthe agent\s+(explained|offered|told|proposed)\b/i,
  /\b(алекс|агент)\s+(объяснил|предложил|сказал)\b/i,
  /\b(мы|наша компания)\s+(объяснили|предложили|сказали|можем|создаём|создаем)\b/i,
];

function text(value: unknown, fallback = 'Unknown') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function list(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n|;/) : [];
  return values.map(item => String(item).replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.find(item => item.toLowerCase() === normalized) || fallback;
}

function parseStructuredValue(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function pick(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
}

function structuredOutputCandidates(payload: unknown): Array<[string, unknown]> {
  const source = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  const artifactOutputs = source.artifact?.structuredOutputs && typeof source.artifact.structuredOutputs === 'object'
    ? Object.values(source.artifact.structuredOutputs).map((output: any) => output?.result)
    : [];
  const namedLeadOutput = artifactOutputs.find((output: any) => output && typeof output === 'object' && (
    output.lead !== undefined || output.interest_level !== undefined || output.customer_summary !== undefined
  ));
  return [
    ['call.analysis.structuredData', source.analysis?.structuredData],
    ['call.analysis.structuredOutput', source.analysis?.structuredOutput],
    ['call.structuredData', source.structuredData],
    ['call.artifact.analysis.structuredData', source.artifact?.analysis?.structuredData],
    ['webhook.message.analysis.structuredData', source.message?.analysis?.structuredData],
    ['webhook.message.analysis.structuredOutput', source.message?.analysis?.structuredOutput],
    ['webhook.message.artifact.analysis.structuredData', source.message?.artifact?.analysis?.structuredData],
    ['call.artifact.structuredOutputs.lead_intelligence.result', namedLeadOutput],
  ];
}

export function findStructuredOutput(payload: unknown): { value: Record<string, unknown>; path: string } | null {
  for (const [path, value] of structuredOutputCandidates(payload)) {
    const parsed = parseStructuredValue(value);
    if (parsed) return { value: parsed, path };
  }
  return null;
}

export function findInvalidStructuredOutputPath(payload: unknown) {
  for (const [path, value] of structuredOutputCandidates(payload)) {
    if (value !== undefined && value !== null && !parseStructuredValue(value)) return path;
  }
  return '';
}

export function extractFinalTranscript(payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  return text(source.artifact?.transcript || source.transcript || source.message?.artifact?.transcript, '');
}

export function extractLeadIntelligence(analysis: unknown, contact: ContactIdentity): LeadIntelligence {
  const source = parseStructuredValue(analysis);
  if (!source) throw new Error('Lead Intelligence structured output is not valid JSON object');
  const nestedValue = pick(source, 'leadIntelligence', 'lead_intelligence', 'Lead Intelligence');
  const nested = parseStructuredValue(nestedValue) || source;
  const recognized = ['lead', 'customerName', 'customer_name', 'interestLevel', 'interest_level', 'currentSituation', 'current_situation', 'customerSummary', 'customer_summary']
    .some(key => nested[key] !== undefined);
  if (!recognized) throw new Error('Lead Intelligence structured output contains no recognized fields');
  const customerSummary = list(pick(nested, 'customerSummary', 'customer_summary', 'Customer Summary'))
    .map(item => sanitizeSummaryIdentity(item, contact.contactName))
    .filter(item => !forbiddenSummaryPatterns.some(pattern => pattern.test(item)))
    .slice(0, 5);

  const lead = enumValue(pick(nested, 'lead', 'Lead', 'interest_level'), ['Hot', 'Warm', 'Cold', 'Unknown'] as const, 'Unknown');
  const explicitInterest = enumValue(pick(nested, 'interestLevel', 'interest_level', 'Interest Level'), ['High', 'Medium', 'Low', 'Unknown'] as const, 'Unknown');
  const interestLevel = explicitInterest === 'Unknown' && lead !== 'Unknown'
    ? ({ Hot: 'High', Warm: 'Medium', Cold: 'Low' } as const)[lead]
    : explicitInterest;

  return {
    lead,
    customerName: sanitizeCustomerName(pick(nested, 'customerName', 'customer_name', 'Customer Name'), contact.contactName),
    company: text(pick(nested, 'company', 'Company'), contact.company || 'Unknown'),
    phone: text(pick(nested, 'phone', 'Phone'), contact.phone || 'Unknown'),
    interestLevel,
    currentSituation: list(pick(nested, 'currentSituation', 'current_situation', 'Current Situation')),
    painPoints: list(pick(nested, 'painPoints', 'pain_points', 'Pain Points')),
    questionsAsked: list(pick(nested, 'questionsAsked', 'questions_asked', 'Questions Asked')),
    objections: list(pick(nested, 'objections', 'Objections')),
    decisionMaker: enumValue(pick(nested, 'decisionMaker', 'decision_maker', 'Decision Maker'), ['Yes', 'No', 'Unknown'] as const, 'Unknown'),
    budgetSignals: enumValue(pick(nested, 'budgetSignals', 'budget_signals', 'Budget Signals'), ['High', 'Medium', 'Low', 'Unknown'] as const, 'Unknown'),
    urgency: enumValue(pick(nested, 'urgency', 'Urgency'), ['Hot', 'Medium', 'Low', 'Unknown'] as const, 'Unknown'),
    nextStep: text(pick(nested, 'nextStep', 'next_step', 'Next Step')),
    followUpRecommendation: text(pick(nested, 'followUpRecommendation', 'follow_up_recommendation', 'Follow Up Recommendation')),
    customerSummary,
  };
}

export function extractLeadIntelligenceFromPayload(payload: unknown, contact: ContactIdentity) {
  const output = findStructuredOutput(payload);
  return output ? extractLeadIntelligence(output.value, contact) : extractLeadIntelligence({ lead: 'Unknown' }, contact);
}

export const leadIntelligenceSchema = {
  type: 'object',
  description: 'Extract only facts stated or confirmed by the customer. Never narrate the call or describe anything the assistant, agent, or our company said, explained, offered, proposed, or can do. Use Unknown or an empty array when the customer did not provide the information.',
  properties: {
    lead: { type: 'string', enum: ['Hot', 'Warm', 'Cold', 'Unknown'], description: 'Overall lead classification based only on customer statements and commitments.' },
    customerName: { type: 'string', description: 'Customer name, or Unknown. Alex is the DMNT AI assistant and can never be the customer name.' },
    company: { type: 'string', description: 'Customer company, or Unknown.' },
    phone: { type: 'string', description: 'Customer phone, or Unknown.' },
    interestLevel: { type: 'string', enum: ['High', 'Medium', 'Low', 'Unknown'] },
    currentSituation: { type: 'array', items: { type: 'string' }, description: 'Current customer situation, such as No website, Uses Google Business, or Gets customers from referrals.' },
    painPoints: { type: 'array', items: { type: 'string' }, description: 'Only real problems expressed or confirmed by the customer.' },
    questionsAsked: { type: 'array', items: { type: 'string' }, description: 'Topics of all questions asked by the customer, such as Price, Timeline, Contract, SEO, or Monthly cost.' },
    objections: { type: 'array', items: { type: 'string' }, description: 'Only objections expressed by the customer.' },
    decisionMaker: { type: 'string', enum: ['Yes', 'No', 'Unknown'] },
    budgetSignals: { type: 'string', enum: ['High', 'Medium', 'Low', 'Unknown'] },
    urgency: { type: 'string', enum: ['Hot', 'Medium', 'Low', 'Unknown'] },
    nextStep: { type: 'string', description: 'Agreed next step, or Unknown.' },
    followUpRecommendation: { type: 'string', description: 'One short actionable follow-up sentence based only on customer facts.' },
    customerSummary: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Maximum five short bullets containing only customer facts. Never mention Alex, the agent, our company, what we explained/offered/proposed, or what we can/create.' },
  },
  required: ['lead', 'customerName', 'company', 'phone', 'interestLevel', 'currentSituation', 'painPoints', 'questionsAsked', 'objections', 'decisionMaker', 'budgetSignals', 'urgency', 'nextStep', 'followUpRecommendation', 'customerSummary'],
} as const;

export function formatLeadIntelligence(intelligence: LeadIntelligence) {
  const showList = (items: string[]) => items.length ? items.join(', ') : 'Unknown';
  const bullets = intelligence.customerSummary.length
    ? intelligence.customerSummary.map(item => `• ${item}`).join('\n')
    : '• Unknown';
  return [
    `Lead: ${intelligence.lead}`,
    `Customer Name: ${intelligence.customerName}`,
    `Company: ${intelligence.company}`,
    `Phone: ${intelligence.phone}`,
    `Interest Level: ${intelligence.interestLevel}`,
    `Current Situation: ${showList(intelligence.currentSituation)}`,
    `Pain Points: ${showList(intelligence.painPoints)}`,
    `Questions Asked: ${showList(intelligence.questionsAsked)}`,
    `Objections: ${showList(intelligence.objections)}`,
    `Decision Maker: ${intelligence.decisionMaker}`,
    `Budget Signals: ${intelligence.budgetSignals}`,
    `Urgency: ${intelligence.urgency}`,
    `Next Step: ${intelligence.nextStep}`,
    `Follow Up Recommendation: ${intelligence.followUpRecommendation}`,
    `Customer Summary:\n${bullets}`,
  ].join('\n');
}
