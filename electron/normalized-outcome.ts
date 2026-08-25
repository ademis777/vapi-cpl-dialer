import type { LeadIntelligenceSource } from './lead-intelligence-resolution.js';
import type { WiseStructuredOutputs } from './wise-structured-output.js';

export type BusinessOutcome = 'HOT' | 'WARM' | 'CALLBACK' | 'COLD' | 'DNC' | 'UNKNOWN';
export type OperationalOutcome = 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'VOICEMAIL' | 'IVR' | 'WRONG_NUMBER' | 'TECHNICAL_ERROR' | 'CANCELLED';
export type NormalizedSource = 'wise_structured_output' | 'dmnt_structured_output' | 'legacy_transcript_analysis' | 'legacy_vapi_analysis' | 'empty_fallback';

export type NormalizedCallResult = {
  outcomeVersion: 1;
  businessOutcome: BusinessOutcome;
  operationalOutcome: OperationalOutcome;
  source: NormalizedSource;
  decisionMakerReached: boolean | null;
  interested: boolean | null;
  doNotContact: boolean;
  wrongNumber: boolean;
  callbackRequested: boolean;
  callbackAt: string;
  callbackTimezone: string;
  preferredContactMethod: 'whatsapp' | 'sms' | 'email' | 'phone' | null;
  email: string;
  mobilePhone: string;
  demoInterest: boolean | null;
  permissionToSendDemo: boolean | null;
  demoViewDate: string;
  demoViewTime: string;
  demoViewTimezone: string;
  objection: string;
  objectionCategory: string;
  summary: string;
  nextAction: string;
  endedReason: string;
  callId: string;
  recordingUrl: string;
  analysisSource: string;
};

const text = (value: unknown) => String(value ?? '').trim();
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

function business(value: unknown): BusinessOutcome {
  const candidate = text(value).toUpperCase();
  return ['HOT','WARM','CALLBACK','COLD','DNC'].includes(candidate) ? candidate as BusinessOutcome : 'UNKNOWN';
}

function operational(value: unknown, endedReason: string, legacyStatus: string): OperationalOutcome {
  const candidate = text(value).toUpperCase();
  if (candidate === 'VOICEMAIL') return 'VOICEMAIL';
  if (candidate === 'IVR') return 'IVR';
  if (candidate === 'NO_ANSWER') return 'NO_ANSWER';
  if (candidate === 'BUSY') return 'BUSY';
  if (candidate === 'WRONG_NUMBER') return 'WRONG_NUMBER';
  if (candidate === 'TECHNICAL_ERROR') return 'TECHNICAL_ERROR';
  const reason = endedReason.toLowerCase();
  if (reason.includes('busy')) return 'BUSY';
  if (reason.includes('not-answer') || reason.includes('no-answer') || reason.includes('unavailable')) return 'NO_ANSWER';
  if (reason.includes('cancel') || legacyStatus === 'stopped') return 'CANCELLED';
  if (reason.includes('error') || reason.includes('fail')) return 'TECHNICAL_ERROR';
  if (legacyStatus === 'Voicemail') return 'VOICEMAIL';
  if (legacyStatus === 'IVR') return 'IVR';
  if (legacyStatus === 'No Answer') return 'NO_ANSWER';
  if (legacyStatus === 'Failed') return 'TECHNICAL_ERROR';
  return 'COMPLETED';
}

function callbackAt(details: Record<string, any>) {
  const date = text(details.callback_date), time = text(details.callback_time);
  return date ? `${date}${time ? `T${time}` : ''}` : '';
}

export function normalizedFromWise(wise: WiseStructuredOutputs, context: { endedReason?: string; callId?: string; recordingUrl?: string; legacyStatus?: string }): NormalizedCallResult {
  const classification = wise.callClassification || {};
  const details = wise.leadDetails || {};
  const callOutcome = text(classification.call_outcome).toUpperCase();
  const doNotContact = classification.do_not_contact === true || callOutcome === 'DNC';
  const wrongNumber = classification.wrong_number === true || callOutcome === 'WRONG_NUMBER';
  return {
    outcomeVersion: 1,
    businessOutcome: doNotContact ? 'DNC' : business(callOutcome),
    operationalOutcome: wrongNumber ? 'WRONG_NUMBER' : operational(callOutcome, text(context.endedReason), text(context.legacyStatus)),
    source: 'wise_structured_output',
    decisionMakerReached: bool(classification.decision_maker_reached),
    interested: bool(classification.interested),
    doNotContact,
    wrongNumber,
    callbackRequested: details.callback_requested === true || callOutcome === 'CALLBACK',
    callbackAt: callbackAt(details),
    callbackTimezone: text(details.callback_timezone),
    preferredContactMethod: ['whatsapp','sms','email','phone'].includes(text(details.preferred_contact_method)) ? details.preferred_contact_method as NormalizedCallResult['preferredContactMethod'] : null,
    email: text(details.email), mobilePhone: text(details.mobile_phone), demoInterest: bool(details.demo_interest),
    permissionToSendDemo: bool(details.permission_to_send_demo), demoViewDate: text(details.demo_view_date), demoViewTime: text(details.demo_view_time),
    demoViewTimezone: text(details.demo_view_timezone), objection: text(details.objection), objectionCategory: text(details.objection_category),
    summary: text(details.summary), nextAction: text(details.next_action), endedReason: text(context.endedReason), callId: text(context.callId),
    recordingUrl: text(context.recordingUrl), analysisSource: 'wise_structured_output',
  };
}

export function normalizedFromLegacy(input: { lead?: unknown; summary?: unknown; status?: string; endedReason?: string; callId?: string; recordingUrl?: string; analysisSource?: LeadIntelligenceSource }): NormalizedCallResult {
  const source: NormalizedSource = input.analysisSource === 'vapi_structured_output' ? 'dmnt_structured_output'
    : input.analysisSource === 'transcript_fallback_analysis' ? 'legacy_transcript_analysis'
      : input.lead || input.summary ? 'legacy_vapi_analysis' : 'empty_fallback';
  return {
    outcomeVersion: 1, businessOutcome: business(input.lead), operationalOutcome: operational('', text(input.endedReason), text(input.status)), source,
    decisionMakerReached: null, interested: null, doNotContact: false, wrongNumber: false, callbackRequested: false, callbackAt: '', callbackTimezone: '',
    preferredContactMethod: null, email: '', mobilePhone: '', demoInterest: null, permissionToSendDemo: null, demoViewDate: '', demoViewTime: '', demoViewTimezone: '',
    objection: '', objectionCategory: '', summary: text(input.summary), nextAction: '', endedReason: text(input.endedReason), callId: text(input.callId),
    recordingUrl: text(input.recordingUrl), analysisSource: input.analysisSource || source,
  };
}

export function formatNormalizedResult(result: NormalizedCallResult, identity: { company: string; phone: string; contactName?: string }) {
  return [
    `Outcome: ${result.businessOutcome}`,
    `Operational: ${result.operationalOutcome}`,
    `Company: ${identity.company}`,
    `Contact Name: ${identity.contactName || 'Unknown'}`,
    `Phone: ${identity.phone}`,
    `Summary: ${result.summary || 'Unknown'}`,
    `Next Action: ${result.nextAction || 'Unknown'}`,
    ...(result.callbackAt ? [`Callback: ${result.callbackAt}${result.callbackTimezone ? ` (${result.callbackTimezone})` : ''}`] : []),
    ...(result.recordingUrl ? [`Recording URL: ${result.recordingUrl}`] : []),
  ].join('\n');
}
