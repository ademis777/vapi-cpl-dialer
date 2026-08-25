import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import Papa from 'papaparse';
import { importCsvRows } from './csv-import.js';
import type { HubContactInput } from './hub-import.js';
import { detectIvr } from './ivr-detection.js';
import { classifyFinalStatus, hasMeaningfulHumanDialogue } from './conversation-classification.js';
import { detectIvrNavigation, executedDtmfCalls, shouldSendDtmf } from './ivr-navigation.js';
import { sanitizeSummaryIdentity } from './summary-safety.js';
import { updateNoAnswerRetryCsv } from './no-answer-retry.js';
import { TelephonyProviderFactory, emptyTelephonyConfig, migrateTelephonyConfig, type TelephonyConfig, type TelephonyProvider } from './telephony.js';
import { notifyTelegramAfterIntelligenceReady, requireTelegramCredentials } from './telegram.js';
import { extractFinalTranscript, findStructuredOutput, formatLeadIntelligence, leadIntelligenceSchema, LEAD_INTELLIGENCE_EXTRACTION_PROMPT, type LeadIntelligence } from './lead-intelligence.js';
import { CallLifecycleCoordinator, callIdFromEvent, type CallRecord } from './call-lifecycle.js';
import { buildOutboundCallPayload } from './outbound-call.js';
import { extractLegacyCallAnalysis, resolveLeadIntelligence, type LeadIntelligenceSource } from './lead-intelligence-resolution.js';
import { DEFAULT_CALL_TIMEOUTS, beginEnding, conversationGuard, deriveCallTiming, shouldProcessConversationEvents, timeoutReasonWithTelemetry, trimMessagesToFirstConversation, type CallTimeoutSettings, type ConversationState } from './call-duration.js';
import { userVisibleCallEvents } from './user-call-events.js';
import { mergeBridgeCampaign, mergeBridgeConfig } from './settings-bridge.js';
import { findWiseStructuredOutputs } from './wise-structured-output.js';
import { formatNormalizedResult, normalizedFromLegacy, normalizedFromWise, type NormalizedCallResult } from './normalized-outcome.js';
import { PersistentPhoneRegistry } from './phone-registry.js';
import { normalizePhone } from './phone-normalization.js';
import { buildWiseDynamicVariables } from './dynamic-variables.js';
import { buildWhatsAppUrl, DEFAULT_WHATSAPP_TEMPLATE } from './whatsapp.js';
import { migrateCampaignProfiles } from './campaign-profiles.js';
import { resolveWiseFirst } from './call-result-resolution.js';
import { phoneEligibility } from './phone-eligibility.js';
import { prepareBulkImport, validImportAccounting } from './bulk-import.js';
import { CampaignHistoryStore } from './campaign-history.js';

type Status = 'Waiting' | 'Calling' | 'Completed' | 'Failed' | 'No Answer' | 'IVR' | 'Voicemail' | 'Busy';
type Lead = '' | 'Hot' | 'Warm' | 'Cold';
type Contact = { id: string; company: string; phone: string; contactName?: string; address?: string; location?: string; city?: string; state?: string; zipCode?: string; demoUrl?: string; status: Status; summary: string; lead: Lead; isTest?: boolean; attemptNumber?: number; currentAttemptId?: string; callAttempts?: any[]; leadIntelligence?: LeadIntelligence; analysisSource?: LeadIntelligenceSource | string; normalizedResult?: NormalizedCallResult; rawStructuredOutput?: Record<string, unknown>; endedReason?: string; recordingUrl?: string; callId?: string; controlUrl?: string; analysisState?: 'waiting'; finalizedCallId?: string; finalizedAt?: string; callCreatedAt?: string; callStartedAt?: string; callEndedAt?: string; firstAudioAt?: string; firstCustomerSpeechAt?: string; lastCustomerSpeechAt?: string; lastAssistantSpeechAt?: string; talkTimeSeconds?: number; endRequestReason?: string; callLifecycleState?: ConversationState; hasStartedConversation?: boolean; telegramSentAt?: string; telegramMessageId?: string };
type AssistantVoice = { provider: string; voiceId: string; name?: string; model?: string };
type VapiAssistant = { id: string; name: string; voice?: AssistantVoice };
type Config = { vapiApiKey: string; vapiAssistantId: string; vapiAssistants: VapiAssistant[]; vapiVoiceOverrideEnabled: boolean; vapiVoiceProvider: string; vapiVoiceId: string; telephony: TelephonyConfig; telegramBotToken: string; telegramChatId: string; testMode: boolean; legacyAssistantOverrides: boolean; legacyTelegramPolicy: boolean; whatsappTemplate: string; agentName: string };
type StoredConfig = Config & { vapiSipCredentialId: string; vapiSipPhoneNumberId: string; vapiSipFingerprint: string };
type Campaign = { contacts: Contact[]; campaignId?: string; createdAt?: string; startedAt?: string; finishedAt?: string; campaignName: string; systemPrompt: string; assistantId: string; voice: string; phoneNumber: string; hotLeadRules: string; state: 'idle' | 'running' | 'paused' | 'stopped'; hotCount: number } & CallTimeoutSettings;
type CampaignProfile = { campaignName: string; systemPrompt: string; assistantId: string; voiceId: string; hotLeadRules: string } & CallTimeoutSettings;
type CampaignLogEntry = { at: string; event: 'campaign_log'; message: string; tone?: 'hot' | 'warm' | 'cold' | 'failed' | 'no-answer' | 'info'; details?: string };
type RuntimeLogEntry = { at?: string; event?: string; details?: any; message?: string };
function isVoicemail(call: any) { const text = JSON.stringify(call?.artifact?.messages || call?.messages || '') + ' ' + String(call?.artifact?.transcript || call?.transcript || ''); return /(?:voicemail|voice mail|leave (?:a|your) message|after the (?:tone|beep)|record your message|mailbox is full|not available.*leave)/i.test(text); }

const emptyConfig: StoredConfig = { vapiApiKey: '', vapiAssistantId: '', vapiAssistants: [], vapiVoiceOverrideEnabled: false, vapiVoiceProvider: '', vapiVoiceId: '', telephony: emptyTelephonyConfig, telegramBotToken: '', telegramChatId: '', testMode: false, legacyAssistantOverrides: true, legacyTelegramPolicy: true, whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE, agentName: 'Alex', vapiSipCredentialId: '', vapiSipPhoneNumberId: '', vapiSipFingerprint: '' };
const emptyCampaign: Campaign = { contacts: [], campaignName: '', systemPrompt: '', assistantId: '', voice: 'Elliot', phoneNumber: '', hotLeadRules: '', state: 'idle', hotCount: 0, ...DEFAULT_CALL_TIMEOUTS };
let config: StoredConfig = emptyConfig;
let campaign = emptyCampaign;
let win: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let processing = false;
let webhookServer: http.Server | null = null;
let hubBridgeServer: http.Server | null = null;
const headlessMode = process.env.VAPI_CPL_HEADLESS === '1';
const serviceHost = process.env.VAPI_CPL_SERVICE_HOST || '127.0.0.1';
let closingMainWindow = false;

function dataDir() { return process.env.VAPI_CPL_DATA_DIR || path.join(app.getPath('userData'), 'data'); }
function campaignsDir() { return path.join(dataDir(), 'campaigns'); }
function legacyCampaignsDir() { return path.join(app.getAppPath(), 'campaigns'); }
function file(name: string) { return path.join(dataDir(), name); }
function writeTextAtomic(target: string, value: string) {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, value);
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* temporary file may not exist */ }
    throw error;
  }
}
function readJson<T>(name: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name: string, value: unknown) {
  fs.mkdirSync(dataDir(), { recursive: true });
  writeTextAtomic(file(name), JSON.stringify(value, null, 2));
}
async function readJsonBody(req: http.IncomingMessage, limitBytes = 2 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > limitBytes) throw Object.assign(new Error(`Request body exceeds ${limitBytes} bytes`), { statusCode: 413 });
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as any;
}
function log(event: string, details: unknown = {}) {
  const logs = readJson<unknown[]>('logs.json', []);
  logs.push({ at: new Date().toISOString(), event, details });
  writeJson('logs.json', logs.slice(-500));
}
function campaignLogs() { return readJson<CampaignLogEntry[]>('logs.json', []).filter(entry => entry.event === 'campaign_log').slice(-500).reverse(); }
function campaignLog(message: string, tone: CampaignLogEntry['tone'] = 'info', details?: string) {
  const logs = readJson<unknown[]>('logs.json', []);
  logs.push({ at: new Date().toISOString(), event: 'campaign_log', message, tone, details } satisfies CampaignLogEntry);
  writeJson('logs.json', logs.slice(-500)); broadcast();
}
function persist() { writeJson('campaign.json', campaign); broadcast(); }
function phoneRegistry() { return new PersistentPhoneRegistry({ dnc: file('dnc.json'), index: file('phone-index.json') }); }
let persistentHistoryStore: CampaignHistoryStore | undefined;
function historyStore() { return persistentHistoryStore ||= new CampaignHistoryStore(path.join(dataDir(), 'history')); }
const isTestName = (value: unknown) => /(^|[\s_-])test([\s_-]|$)/i.test(String(value || ''));
function backupMaintenanceData(reason: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dataDir(), 'backups', `${reason}-${stamp}`); fs.mkdirSync(target, { recursive: true });
  for (const name of ['campaign.json','logs.json','phone-index.json','dnc.json','no-answer-retry.csv','history']) { const source=file(name); if(fs.existsSync(source)) fs.cpSync(source,path.join(target,name),{recursive:true}); }
  return target;
}
function queueAnotherAttempt(contact: Contact) {
  const allowed: Status[] = ['Completed','Failed','No Answer','Voicemail','IVR','Busy'];
  if (!allowed.includes(contact.status)) throw Object.assign(new Error(`Call Again is not available for status ${contact.status}`), { statusCode: 409 });
  if (phoneRegistry().isDnc(contact.phone)) throw Object.assign(new Error('Call Again blocked: number is in DNC'), { statusCode: 409 });
  const prior = { attemptId: contact.currentAttemptId || contact.callId || `${contact.id}-attempt-${contact.attemptNumber || 1}`, attemptNumber: contact.attemptNumber || 1, status: contact.status, summary: contact.summary, lead: contact.lead, callId: contact.callId, recordingUrl: contact.recordingUrl, normalizedResult: contact.normalizedResult, callCreatedAt: contact.callCreatedAt, callStartedAt: contact.callStartedAt, callEndedAt: contact.callEndedAt, talkTimeSeconds: contact.talkTimeSeconds };
  contact.callAttempts = [...(contact.callAttempts || []), prior]; contact.attemptNumber = prior.attemptNumber + 1; contact.currentAttemptId = crypto.randomUUID();
  Object.assign(contact,{status:'Waiting',summary:'',lead:'',leadIntelligence:undefined,analysisSource:undefined,normalizedResult:undefined,rawStructuredOutput:undefined,endedReason:undefined,recordingUrl:undefined,callId:undefined,controlUrl:undefined,analysisState:undefined,finalizedCallId:undefined,finalizedAt:undefined,callCreatedAt:undefined,callStartedAt:undefined,callEndedAt:undefined,firstAudioAt:undefined,firstCustomerSpeechAt:undefined,lastCustomerSpeechAt:undefined,lastAssistantSpeechAt:undefined,talkTimeSeconds:undefined,endRequestReason:undefined,callLifecycleState:undefined,hasStartedConversation:undefined,telegramSentAt:undefined,telegramMessageId:undefined});
}
function contactFromHistory(record: any): Contact {
  const status=String(record.status||'') as Status; const allowed:Status[]=['Completed','Failed','No Answer','Voicemail','IVR','Busy'];
  if(!allowed.includes(status))throw Object.assign(new Error(`Call Again is not available for status ${status||'Unknown'}`),{statusCode:409});
  if(phoneRegistry().isDnc(record.phone))throw Object.assign(new Error('Call Again blocked: number is in DNC'),{statusCode:409});
  return {id:record.contactId,company:record.company||'',phone:record.phone||'',contactName:record.contactName||'',city:record.city||'',state:record.state||'',zipCode:record.zip||'',demoUrl:record.demoUrl||'',status:'Waiting',summary:'',lead:'',isTest:Boolean(record.isTest),attemptNumber:Number(record.attemptNumber||1)+1,currentAttemptId:crypto.randomUUID(),callAttempts:[{attemptId:record.recordId||record.callId||`${record.contactId}-attempt-${record.attemptNumber||1}`,attemptNumber:record.attemptNumber||1,status:record.status,summary:record.summary,lead:record.lead,callId:record.callId,recordingUrl:record.recordingUrl,callCreatedAt:record.createdAt,callStartedAt:record.startedAt,callEndedAt:record.endedAt}]};
}

function saveNoAnswerRetryFile() {
  const target = file('no-answer-retry.csv');
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const result = updateNoAnswerRetryCsv(existing, campaign.contacts);
  fs.mkdirSync(dataDir(), { recursive: true });
  writeTextAtomic(target, result.csv);
  result.recorded.forEach((eventId, contact) => { contact.noAnswerRetryRecordedCallId = eventId; });
  log('no_answer_retry_exported', { path: target, contacts: result.rows.length });
  return { path: target, count: result.rows.length };
}
function importContactsFromHub(items: HubContactInput[]) {
  if (processing || campaign.contacts.some(contact => contact.status === 'Calling')) throw new Error('Cannot import leads during an active call');
  const registry = phoneRegistry();
  const prepared = prepareBulkImport(items, registry.indexedPhones(), registry.dncPhones());
  if (!validImportAccounting(prepared.report)) throw new Error('Import accounting invariant failed');
  const imported = prepared.contacts.map<Contact>((contact, index) => ({
    id: `${Date.now()}-hub-${index}`,
    ...contact,
    status: 'Waiting',
    summary: '',
    lead: '',
    isTest: config.testMode || isTestName(campaign.campaignName), attemptNumber: 1, currentAttemptId: crypto.randomUUID(), callAttempts: [],
  }));
  campaign.contacts.push(...imported);
  registry.recordPhones(imported.map(contact => ({ phone: contact.phone, company: contact.company, contactId: contact.id })));
  if (imported.length) {
    campaign.hotCount = campaign.contacts.filter(contact => contact.lead === 'Hot').length;
    campaign.state = 'idle';
  }
  persist();
  historyStore().append(campaign, imported, campaign.assistantId || config.vapiAssistantId);
  const result = { ...prepared.report, requested: prepared.report.submitted, rejected: prepared.report.invalid, totalContacts: campaign.contacts.length };
  log('hub_imported', result);
  campaignLog('HUB leads imported', 'info', `${result.imported} imported · ${result.duplicates} duplicates · ${result.dnc} DNC · ${result.invalid} invalid · ${result.failed} failed · ${campaign.contacts.length} total`);
  return result;
}

function startHubBridge() {
  if (hubBridgeServer) return;
  hubBridgeServer = http.createServer(async (req, res) => {
    const send = (status: number, payload: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(payload)); };
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1:8789');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, service: 'vapi-cpl-dialer', state: campaign.state, contacts: campaign.contacts.length });
      if (req.method === 'GET' && url.pathname === '/settings') return send(200, { ok: true, config: publicConfig(), campaign: { campaignName: campaign.campaignName, systemPrompt: campaign.systemPrompt, assistantId: campaign.assistantId, voice: campaign.voice, hotLeadRules: campaign.hotLeadRules, initialSilenceTimeoutSeconds: campaign.initialSilenceTimeoutSeconds, conversationSilenceTimeoutSeconds: campaign.conversationSilenceTimeoutSeconds, goodbyeTimeoutSeconds: campaign.goodbyeTimeoutSeconds, maximumCallDurationSeconds: campaign.maximumCallDurationSeconds } });
      if (req.method === 'POST' && url.pathname === '/settings') {
        const body = await readJsonBody(req) as { config?: Partial<Config>; campaign?: Partial<Campaign> };
        if (body.config) {
          config = mergeBridgeConfig<StoredConfig>(config, body.config as Partial<StoredConfig>);
        }
        if (body.campaign) campaign = mergeBridgeCampaign(campaign, body.campaign);
        writeJson('config.json', config); persist(); broadcast();
        const provider = activeTelephonyProvider();
        const zadarma = config.telephony.zadarma;
        const manualSip = config.telephony.manualSip;
        const readyForProvisioning = config.vapiApiKey && ((provider.id === 'zadarma' && zadarma.apiKey && zadarma.apiSecret && zadarma.sipLine && zadarma.sipPassword && zadarma.selectedNumber) || (provider.id === 'manualSip' && manualSip.sipHost && manualSip.username && manualSip.password && manualSip.callerId));
        if (body.config && readyForProvisioning) await provider.provisionForVapi();
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/settings/test-vapi') {
        const body = await readJsonBody(req);
        const apiKey=String(body.vapiApiKey||config.vapiApiKey||'').trim(); if(!apiKey) return send(400,{ok:false,error:'Vapi API Key is empty'});
        const response=await fetch('https://api.vapi.ai/assistant',{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(15000)}); if(!response.ok)return send(response.status,{ok:false,error:`Vapi HTTP ${response.status}`});
        const assistants=await response.json() as any[]; return send(200,{ok:true,assistants:assistants.filter(x=>x?.id).map(x=>({id:x.id,name:x.name||'Unnamed Assistant',voice:x.voice}))});
      }
      if (req.method === 'POST' && url.pathname === '/settings/test-telegram') {
        const body = await readJsonBody(req);
        const credentials=requireTelegramCredentials(String(body.telegramBotToken||config.telegramBotToken||''),String(body.telegramChatId||config.telegramChatId||''));
        const response=await fetch(`https://api.telegram.org/bot${credentials.botToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:credentials.chatId,text:'DMNT HUB successfully connected.'}),signal:AbortSignal.timeout(15000)}); if(!response.ok)return send(response.status,{ok:false,error:`Telegram HTTP ${response.status}`}); return send(200,{ok:true});
      }
      if (req.method === 'POST' && url.pathname === '/settings/test-telephony') {
        const body = await readJsonBody(req) as { telephony?: Partial<TelephonyConfig> };
        const incoming = body.telephony || {};
        const candidate: TelephonyConfig = {
          ...config.telephony,
          ...incoming,
          zadarma: { ...config.telephony.zadarma, ...(incoming.zadarma || {}) },
          manualSip: { ...config.telephony.manualSip, ...(incoming.manualSip || {}) },
          genericSip: { ...config.telephony.genericSip, ...(incoming.genericSip || {}) },
        };
        const provider = TelephonyProviderFactory.create(candidate.provider, candidate, {
          diagnostic: (event, details) => { console.info(`[Telephony test] ${event}`, details); log(event, details); },
          provisionForVapi: async () => undefined,
        });
        const result = await provider.testConnection();
        return send(200, { ok: true, provider: provider.id, message: `✓ ${provider.displayName} connection OK`, ...result });
      }
      if (req.method === 'GET' && url.pathname === '/state') {
        const runtimeLogs = readJson<RuntimeLogEntry[]>('logs.json', []);
        return send(200, { ok: true, campaign: { campaignName: campaign.campaignName, state: campaign.state, hotCount: campaign.hotCount, contacts: campaign.contacts.map(({ id, company, phone, contactName, status, lead, summary, isTest, attemptNumber, callAttempts, leadIntelligence, analysisSource, normalizedResult, endedReason, recordingUrl, callId, callCreatedAt, callStartedAt, callEndedAt, talkTimeSeconds, endRequestReason, callLifecycleState, hasStartedConversation, telegramSentAt, telegramMessageId }) => ({ id, company, phone, contactName, status, lead, summary, isTest, attemptNumber, callAttempts, leadIntelligence, analysisSource, normalizedResult, endedReason, recordingUrl, callId, callCreatedAt, callStartedAt, callEndedAt, talkTimeSeconds, endRequestReason, callLifecycleState, hasStartedConversation, telegramSentAt, telegramMessageId, events: callId ? userVisibleCallEvents(runtimeLogs, callId) : [] })) } });
      }
      if (req.method === 'GET' && url.pathname === '/history') return send(200, { ok: true, campaigns: historyStore().list(), currentCampaignId: campaign.campaignId || '' });
      const historyResults = url.pathname.match(/^\/history\/([a-zA-Z0-9_-]+)\/results$/);
      if (req.method === 'GET' && historyResults) { const offset=Math.max(0,Number(url.searchParams.get('offset'))||0),limit=Math.max(1,Math.min(500,Number(url.searchParams.get('limit'))||200)); return send(200,{ok:true,...historyStore().page(historyResults[1],offset,limit)}); }
      const historyExport = url.pathname.match(/^\/history\/([a-zA-Z0-9_-]+)\/export$/);
      if (req.method === 'GET' && historyExport) { const csv=historyStore().csv(historyExport[1]); res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="dmnt-call-log-${historyExport[1]}.csv"`);res.end(csv);return; }
      if (req.method === 'POST' && url.pathname === '/retry') {
        const body = await readJsonBody(req) as { statuses?: string[] };
        if (processing || campaign.contacts.some(c => c.status === 'Calling')) return send(409, { ok:false, error:'Cannot retry while a call is active' });
        const allowed = new Set((body.statuses || ['Failed','No Answer','IVR','Voicemail']).filter(x => ['Failed','No Answer','IVR','Voicemail'].includes(x))); let count=0;
        campaign.contacts.forEach(contact => { if (allowed.has(contact.status) && !phoneRegistry().isDnc(contact.phone)) { Object.assign(contact,{status:'Waiting',summary:'',lead:'',leadIntelligence:undefined,analysisSource:undefined,normalizedResult:undefined,rawStructuredOutput:undefined,endedReason:undefined,recordingUrl:undefined,callId:undefined,controlUrl:undefined,analysisState:undefined,finalizedCallId:undefined,finalizedAt:undefined,telegramSentAt:undefined,telegramMessageId:undefined}); count++; } });
        if (count) campaign.state='idle'; persist(); campaignLog('Contacts queued for retry','info',`${count} contacts`); return send(200,{ok:true,count,totalContacts:campaign.contacts.length});
      }
      const callAgain = url.pathname.match(/^\/contacts\/([^/]+)\/call-again$/);
      if (req.method === 'POST' && callAgain) {
        if (processing || campaign.contacts.some(c=>c.status==='Calling')) return send(409,{ok:false,error:'Cannot queue Call Again while a call is active'});
        const contactId=decodeURIComponent(callAgain[1]); let contact=campaign.contacts.find(c=>c.id===contactId);
        if(contact)queueAnotherAttempt(contact);else{const historical=historyStore().findContact(contactId);if(!historical)return send(404,{ok:false,error:'Contact not found'});contact=contactFromHistory(historical);campaign.contacts.push(contact);}
        campaign.state='idle'; persist(); campaignLog('Call Again queued','info',`${contact.company} · attempt ${contact.attemptNumber}`); return send(200,{ok:true,contactId:contact.id,attemptId:contact.currentAttemptId,attemptNumber:contact.attemptNumber,status:contact.status,historyPreserved:contact.callAttempts?.length||0});
      }
      const removeDedup = url.pathname.match(/^\/contacts\/([^/]+)\/remove-deduplication$/);
      if (req.method === 'POST' && removeDedup) {
        const contactId=decodeURIComponent(removeDedup[1]); const contact=campaign.contacts.find(c=>c.id===contactId)||historyStore().findContact(contactId); if(!contact)return send(404,{ok:false,error:'Contact not found'});
        const backupPath=backupMaintenanceData('remove-deduplication'); const result=phoneRegistry().removePhone(contact.phone); log('dedup_entry_removed',{contactId,normalizedPhone:result.normalizedPhone,backupPath}); return send(200,{ok:true,...result,contactId,historyPreserved:true,dncPreserved:phoneRegistry().isDnc(contact.phone),backupPath});
      }
      if (req.method === 'POST' && url.pathname === '/maintenance/clear-test-data') {
        const body=await readJsonBody(req); if(body.confirm!=='CLEAR TEST DATA')return send(400,{ok:false,error:'Confirmation is required'});
        if(processing||campaign.contacts.some(c=>c.status==='Calling'))return send(409,{ok:false,error:'Cannot clear test data while a call is active'});
        const backupPath=backupMaintenanceData('clear-test-data'); const testCampaign=isTestName(campaign.campaignName); const removedContactIds=new Set(campaign.contacts.filter(c=>testCampaign||c.isTest).map(c=>c.id)); const before=campaign.contacts.length; campaign.contacts=campaign.contacts.filter(c=>!removedContactIds.has(c.id));
        const history=historyStore().clearTestData(); const logs=readJson<RuntimeLogEntry[]>('logs.json',[]); const retainedLogs=logs.filter(entry=>{const text=JSON.stringify(entry);return !(entry.details?.isTest===true||isTestName(entry.details?.campaignName)||(testCampaign&&text.includes(String(campaign.campaignId||'')))||[...removedContactIds].some(id=>text.includes(id)));}); writeJson('logs.json',retainedLogs);
        if(testCampaign){campaign.campaignId=undefined;campaign.createdAt=undefined;campaign.startedAt=undefined;campaign.finishedAt=undefined;} campaign.hotCount=campaign.contacts.filter(c=>c.lead==='Hot').length;campaign.state='idle';persist(); return send(200,{ok:true,removedContacts:before-campaign.contacts.length,removedAttempts:history.removedResults,removedCampaigns:history.removedCampaigns,removedLogs:logs.length-retainedLogs.length,backupPath,dncPreserved:true,settingsPreserved:true});
      }
      if (req.method === 'POST' && (url.pathname === '/maintenance/clear-campaign-data' || url.pathname === '/clear')) {
        const body=await readJsonBody(req); if(body.confirm!=='CLEAR CAMPAIGN DATA')return send(400,{ok:false,error:'Confirmation is required'});
        const calling=campaign.contacts.filter(c=>c.status==='Calling').length;
        if(campaign.state==='running'||processing||calling)return send(409,{ok:false,error:'Clear Campaign Data is blocked while the campaign or an outbound call is active'});
        const removedContacts=campaign.contacts.length, removedQueue=campaign.contacts.filter(c=>c.status==='Waiting').length, campaignId=campaign.campaignId||'';
        const backupPath=backupMaintenanceData('campaign-before-clear');
        const dedupe=phoneRegistry().removePhones(campaign.contacts.map(c=>c.phone));
        const history=campaignId?historyStore().removeCampaign(campaignId):{removedCampaigns:0,removedResults:0};
        const removedLogs=readJson<RuntimeLogEntry[]>('logs.json',[]).length;
        writeJson('logs.json',[]);
        const retryFile=file('no-answer-retry.csv'); if(fs.existsSync(retryFile))fs.unlinkSync(retryFile);
        callLifecycle.reset();
        campaign={...campaign,contacts:[],campaignId:undefined,createdAt:undefined,startedAt:undefined,finishedAt:undefined,state:'idle',hotCount:0};
        persist();
        return send(200,{ok:true,removedContacts,removedQueue,removedCalling:calling,removedDeduplicationEntries:dedupe.removed,removedAttempts:history.removedResults,removedCampaigns:history.removedCampaigns,removedLogs,totalContacts:0,queue:0,calling:0,state:'idle',backupPath,dncPreserved:true,settingsPreserved:true});
      }
      if (req.method === 'POST' && url.pathname === '/control') {
        const body = await readJsonBody(req) as { action?: 'start' | 'pause' | 'resume' | 'stop' };
        if (!body.action || !['start','pause','resume','stop'].includes(body.action)) return send(400, { ok: false, error: 'action must be start, pause, resume, or stop' });
        await controlCampaign(body.action);
        return send(200, { ok: true, action: body.action, state: campaign.state, totalContacts: campaign.contacts.length });
      }
      if (req.method === 'POST' && url.pathname === '/import') {
        const body = await readJsonBody(req) as { contacts?: HubContactInput[] };
        if (!Array.isArray(body.contacts)) return send(400, { ok: false, error: 'contacts array is required' });
        const result = importContactsFromHub(body.contacts); return send(200, { ok: true, ...result });
      }
      return send(404, { ok: false, error: 'Not found' });
    } catch (error: any) { return send(error?.statusCode === 413 ? 413 : 500, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
  hubBridgeServer.listen(8789, serviceHost, () => console.log(`DMNT HUB Dialer bridge listening on ${serviceHost}:8789`));
}

function publicConfig(): Config {
  const { vapiSipCredentialId: _credential, vapiSipPhoneNumberId: _phone, vapiSipFingerprint: _fingerprint, ...visible } = config;
  return visible;
}
function broadcast() {
  const state = { config: publicConfig(), campaign, logs: campaignLogs(), dataDir: dataDir() };
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('state-update', state);
  if (settingsWin && !settingsWin.isDestroyed() && !settingsWin.webContents.isDestroyed()) settingsWin.webContents.send('state-update', state);
}

async function vapiRequest(endpoint: string, init: RequestInit) {
  const response = await fetch(`https://api.vapi.ai${endpoint}`, { ...init, headers: { Authorization: `Bearer ${config.vapiApiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const payload = await response.json().catch(() => null) as { id?: string; message?: string; error?: string } | null;
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Vapi HTTP ${response.status}`);
  return payload;
}

async function vapiResourceExists(endpoint: string) {
  const response = await fetch(`https://api.vapi.ai${endpoint}`, { headers: { Authorization: `Bearer ${config.vapiApiKey}` }, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Vapi resource check HTTP ${response.status}: ${await response.text()}`);
  return true;
}

function activeTelephonyProvider() {
  return TelephonyProviderFactory.create(config.telephony.provider, config.telephony, {
    diagnostic: (event, details) => { console.info(`[Telephony] ${event}`, details); log(event, details); },
    provisionForVapi: ensureVapiProvisioning
  });
}

async function validateTelephony(provider = activeTelephonyProvider()) {
  campaignLog('Telephony validation started', 'info', provider.displayName);
  try { provider.validateConfiguration(); campaignLog('Telephony validation completed', 'info', provider.displayName); }
  catch (error) { campaignLog('Telephony validation failed', 'failed', `${provider.displayName}: ${String(error)}`); throw error; }
}

async function ensureVapiProvisioning(provider: TelephonyProvider, validateExisting = false) {
  if (!config.vapiApiKey.trim()) throw new Error('Vapi API Key обязателен');
  provider.validateConfiguration();
  const sip = provider.getSipCredentials(); const selectedNumber = provider.getSelectedNumber();
  if (!selectedNumber) throw new Error('Select Caller ID / Phone Number');
  const fingerprint = crypto.createHash('sha256').update(`${config.vapiApiKey}|${provider.id}|${sip.username}|${sip.password}|${sip.sipDomain}|${sip.outboundProxy || ''}|${selectedNumber.number}`).digest('hex');
  const legacyFingerprints = provider.id === 'zadarma' ? [
    crypto.createHash('sha256').update(`${config.vapiApiKey}|${sip.username}|${sip.password}`).digest('hex'),
    crypto.createHash('sha256').update(`${config.vapiApiKey}|${sip.username}|${sip.password}|${selectedNumber.number}`).digest('hex'),
  ] : [];
  const migratedFingerprint = legacyFingerprints.includes(config.vapiSipFingerprint);
  const sameSettings = config.vapiSipFingerprint === fingerprint || migratedFingerprint;
  const hasSavedResources = Boolean(config.vapiSipCredentialId && config.vapiSipPhoneNumberId);
  let restoring = false;
  if (sameSettings && hasSavedResources) {
    if (migratedFingerprint) { config.vapiSipFingerprint = fingerprint; writeJson('config.json', config); }
    if (!validateExisting) return;
    try {
      const [credentialExists, phoneExists] = await Promise.all([vapiResourceExists(`/credential/${config.vapiSipCredentialId}`), vapiResourceExists(`/phone-number/${config.vapiSipPhoneNumberId}`)]);
      if (credentialExists && phoneExists) return;
      restoring = true;
    } catch (error) {
      campaignLog('Provisioning failed', 'failed', String(error));
      throw error;
    }
  }
  const oldCredentialId = config.vapiSipCredentialId; const oldPhoneNumberId = config.vapiSipPhoneNumberId;
  let newCredentialId = '';
  campaignLog(`Vapi provisioning through ${provider.displayName} started`, 'info', `SIP ${sip.username}`);
  try {
    const credential = await vapiRequest('/credential', { method: 'POST', body: JSON.stringify({ provider: 'byo-sip-trunk', name: `DMNT ${provider.displayName} ${sip.username}`.slice(0, 40), gateways: [{ ip: sip.outboundProxy || sip.sipDomain, outboundEnabled: true, inboundEnabled: false }], outboundLeadingPlusEnabled: true, outboundAuthenticationPlan: { authUsername: sip.username, authPassword: sip.password } }) });
    if (!credential?.id) throw new Error('Vapi не вернул Credential ID');
    newCredentialId = credential.id;
    const phone = await vapiRequest('/phone-number', { method: 'POST', body: JSON.stringify({ provider: 'byo-phone-number', name: `${provider.displayName} ${selectedNumber.number}`.slice(0, 40), number: selectedNumber.number, numberE164CheckEnabled: false, credentialId: credential.id }) });
    if (!phone?.id) throw new Error('Vapi не вернул Phone Number ID');
    config.vapiSipCredentialId = credential.id; config.vapiSipPhoneNumberId = phone.id; config.vapiSipFingerprint = fingerprint;
    writeJson('config.json', config); broadcast();
    if (restoring) campaignLog('Provisioning restored', 'info', `SIP ${sip.username}`);
    campaignLog(`Vapi provisioning through ${provider.displayName} completed`, 'info', `SIP ${sip.username}`);
    if (oldPhoneNumberId) void vapiRequest(`/phone-number/${oldPhoneNumberId}`, { method: 'DELETE' }).catch(error => log('old_vapi_phone_cleanup_error', String(error)));
    if (oldCredentialId) void vapiRequest(`/credential/${oldCredentialId}`, { method: 'DELETE' }).catch(error => log('old_vapi_credential_cleanup_error', String(error)));
  } catch (error) {
    if (newCredentialId) void vapiRequest(`/credential/${newCredentialId}`, { method: 'DELETE' }).catch(cleanupError => log('new_vapi_credential_cleanup_error', String(cleanupError)));
    campaignLog('Provisioning failed', 'failed', String(error));
    throw error;
  }
}

async function sendTelegram(contact: Contact) {
  const { botToken, chatId } = requireTelegramCredentials(config.telegramBotToken, config.telegramChatId);
  const text = contact.normalizedResult?.source === 'wise_structured_output'
    ? formatNormalizedResult(contact.normalizedResult, contact)
    : contact.leadIntelligence ? formatLeadIntelligence(contact.leadIntelligence)
    : contact.summary.trim()
      ? [`Company: ${contact.company}`, `Phone: ${contact.phone}`, `Summary: ${contact.summary}`, `Lead: ${contact.lead || 'Unknown'}`, ...(contact.recordingUrl ? [`Recording URL: ${contact.recordingUrl}`] : [])].join('\n')
      : '';
  if (!text) throw new Error('Telegram Lead Intelligence or legacy Summary is not ready');
  const business = contact.normalizedResult?.businessOutcome || contact.lead.toUpperCase();
  const whatsappPhone = contact.normalizedResult?.mobilePhone || contact.phone;
  const whatsappUrl = ['HOT', 'WARM', 'CALLBACK'].includes(business) ? buildWhatsAppUrl(whatsappPhone, config.whatsappTemplate, {
    company: contact.company, contact_name: contact.contactName || '', agent_name: config.agentName || 'Alex', demo_url: contact.demoUrl || '', phone: contact.phone, next_action: contact.normalizedResult?.nextAction || '',
  }) : '';
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, ...(whatsappUrl ? { reply_markup: { inline_keyboard: [[{ text: '💬 Open WhatsApp', url: whatsappUrl }]] } } : {}) }), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Telegram: ${response.status} ${await response.text()}`);
  const payload = await response.json().catch(() => null) as { result?: { message_id?: number } } | null;
  contact.telegramSentAt = new Date().toISOString();
  contact.telegramMessageId = payload?.result?.message_id === undefined ? undefined : String(payload.result.message_id);
  persist();
}

function normalizeLead(value: unknown): Lead {
  const text = String(value || '').toLowerCase();
  if (text.includes('hot')) return 'Hot';
  if (text.includes('warm')) return 'Warm';
  if (text.includes('cold')) return 'Cold';
  return '';
}

function callMessages(call: CallRecord) {
  return Array.isArray(call.artifact?.messages) ? call.artifact.messages : Array.isArray(call.messages) ? call.messages : [];
}

function callRecordForFirstConversation(call: CallRecord): CallRecord {
  const messages = callMessages(call);
  const guard = conversationGuard(messages);
  if (!guard.repeatedIntroduction) return call;
  const trimmed = trimMessagesToFirstConversation(messages);
  const transcript = trimmed.filter((message: any) => ['user', 'customer', 'bot', 'assistant'].includes(String(message.role)) && String(message.message || message.content || '').trim()).map((message: any) => `${message.role === 'bot' ? 'assistant' : message.role}: ${String(message.message || message.content).trim()}`).join('\n');
  log('lead_intelligence_transcript_trimmed', { callId: call.id, originalMessages: messages.length, retainedMessages: trimmed.length, reason: 'repeated_introduction_lifecycle_error' });
  return { ...call, transcript, summary: undefined, structuredData: undefined, structuredOutput: undefined, analysis: undefined, artifact: { ...(call.artifact || {}), messages: trimmed, transcript, analysis: undefined, structuredData: undefined, structuredOutput: undefined } };
}

function logLatencyMetrics(call: CallRecord, contact: Contact) {
  const messages = callMessages(call).filter((message: any) => ['user', 'customer', 'bot', 'assistant'].includes(String(message.role)));
  messages.forEach((message: any, index: number) => {
    const details = { callId: contact.callId, phone: contact.phone, turn: index, at: message.endTime || message.time };
    if (message.role === 'user' || message.role === 'customer') log('customer_speech_ended_at', details);
    else log('assistant_audio_started_at', { ...details, at: message.time });
  });
  const metrics = call.artifact?.performanceMetrics;
  if (metrics) log('call_latency_metrics', { callId: contact.callId, phone: contact.phone, transcriptionLatencyMs: metrics.transcriberLatencyAverage, llmLatencyMs: metrics.modelLatencyAverage, ttsLatencyMs: metrics.voiceLatencyAverage, endpointingLatencyMs: metrics.endpointingLatencyAverage, totalResponseLatencyMs: metrics.turnLatencyAverage });
  log('latency_timestamp_unavailable', { callId: contact.callId, phone: contact.phone, fields: ['model_request_started_at', 'model_first_token_at', 'tts_started_at'], reason: 'Vapi final call record exposes aggregate/per-turn latency durations but not these absolute timestamps' });
}
async function finalizeCall(contact: Contact, confirmedTerminalCall: CallRecord) {
  const endedReason = String(confirmedTerminalCall.endedReason || confirmedTerminalCall.status || '').toLowerCase();
  contact.endedReason = String(confirmedTerminalCall.endedReason || confirmedTerminalCall.status || '');
  if (endedReason === 'exceeded-max-duration' && contact.endRequestReason !== 'maximum_duration_reached') log('maximum_duration_reached', { callId: contact.callId, phone: contact.phone, source: 'vapi' });
  if (endedReason === 'silence-timed-out' && !contact.endRequestReason) log('silence_timeout', { callId: contact.callId, phone: contact.phone, source: 'vapi' });
  const noAnswer = endedReason.includes('not-answer') || endedReason.includes('no-answer') || endedReason.includes('no_answer') || endedReason.includes('busy') || endedReason.includes('unavailable');
  const failed = endedReason.includes('error') || endedReason.includes('fail') || endedReason.includes('pipeline-error') || endedReason.includes('transport-error');
  const ivrState = contact as Contact & { ivrDtmfAttempts?: number; ivrHandledPromptKeys?: string[]; ivrUnresolvedSummary?: string };
  const voicemail = !failed && !noAnswer && isVoicemail(confirmedTerminalCall);
  const meaningfulDialogue = !failed && !noAnswer && !voicemail && hasMeaningfulHumanDialogue(confirmedTerminalCall);
  const finalNavigation = !failed && !meaningfulDialogue ? detectIvrNavigation(confirmedTerminalCall, { zipCode: contact.zipCode }) : undefined;
  const detectedIvr = !failed && !meaningfulDialogue ? detectIvr(confirmedTerminalCall) : undefined;
  const missingDataSummary = ivrState.ivrUnresolvedSummary || (finalNavigation?.kind === 'missing-data' ? finalNavigation.summary : '');
  const ivr = missingDataSummary
    ? { phrase: 'missing required IVR data', summary: missingDataSummary }
    : detectedIvr;
  contact.status = voicemail ? 'Voicemail' : classifyFinalStatus({ failed, noAnswer, ivr: Boolean(ivr), meaningfulDialogue });
  if (voicemail) {
    contact.leadIntelligence = undefined; contact.analysisSource = undefined; contact.summary = 'Voicemail detected'; contact.lead = ''; log('voicemail_detected',{callId:contact.callId,phone:contact.phone});
  } else if (ivr) {
    contact.leadIntelligence = undefined;
    contact.analysisSource = undefined;
    contact.summary = ivr.summary;
    contact.lead = '';
    log('ivr_detected', { callId: contact.callId, phone: contact.phone, phrase: ivr.phrase });
  } else if (meaningfulDialogue || noAnswer || failed) {
    const analysisCall = callRecordForFirstConversation(confirmedTerminalCall);
    const legacyAnalysis = extractLegacyCallAnalysis(analysisCall);
    const resolution = await resolveWiseFirst(analysisCall, () => resolveLeadIntelligence(analysisCall, contact, {
      analyzeTranscript: analyzeTranscriptWithVapi,
      log: (event, details) => log(event, { callId: contact.callId, phone: contact.phone, ...details }),
    }));
    if (resolution.wise) {
      const wise = resolution.wise;
      contact.rawStructuredOutput = wise.raw;
      contact.analysisSource = 'wise_structured_output';
      contact.leadIntelligence = undefined;
      contact.summary = sanitizeSummaryIdentity(String(wise.leadDetails?.summary || legacyAnalysis.summary || ''), contact.contactName);
      const wiseOutcome = String(wise.callClassification?.call_outcome || '').toUpperCase();
      contact.lead = normalizeLead(wiseOutcome);
      log('lead_intelligence_source', { callId: contact.callId, phone: contact.phone, source: 'wise_structured_output', paths: wise.paths });
    } else {
      contact.rawStructuredOutput = findStructuredOutput(analysisCall)?.value;
      const resolved = resolution.legacy!;
      const leadIntelligence = resolved.intelligence;
      const hasSubstantiveIntelligence = Boolean(leadIntelligence.currentSituation.length || leadIntelligence.painPoints.length || leadIntelligence.questionsAsked.length || leadIntelligence.objections.length || leadIntelligence.customerSummary.length);
      contact.leadIntelligence = hasSubstantiveIntelligence ? leadIntelligence : undefined;
      contact.analysisSource = resolved.source;
      contact.summary = sanitizeSummaryIdentity(legacyAnalysis.summary, contact.contactName);
      contact.lead = normalizeLead(leadIntelligence.lead) || normalizeLead(legacyAnalysis.lead);
    }
  } else {
    contact.leadIntelligence = undefined;
    contact.analysisSource = undefined;
    contact.summary = '';
    contact.lead = '';
    log('call_without_meaningful_dialogue', { callId: contact.callId, phone: contact.phone, endedReason });
  }
  contact.recordingUrl = confirmedTerminalCall.recordingUrl || confirmedTerminalCall.artifact?.recordingUrl || confirmedTerminalCall.artifact?.recording?.stereoUrl || confirmedTerminalCall.artifact?.recording?.mono?.combinedUrl || confirmedTerminalCall.recording?.url;
  const wise = findWiseStructuredOutputs(confirmedTerminalCall);
  contact.normalizedResult = wise
    ? normalizedFromWise(wise, { endedReason: contact.endedReason, callId: contact.callId, recordingUrl: contact.recordingUrl, legacyStatus: contact.status })
    : normalizedFromLegacy({ lead: contact.lead, summary: contact.summary, status: contact.status, endedReason: contact.endedReason, callId: contact.callId, recordingUrl: contact.recordingUrl, analysisSource: contact.analysisSource as LeadIntelligenceSource | undefined });
  if (contact.normalizedResult.doNotContact || contact.normalizedResult.businessOutcome === 'DNC') {
    phoneRegistry().addDnc({ phone: contact.phone, reason: contact.normalizedResult.summary || 'Vapi Structured Output: DNC', sourceCallId: contact.callId, company: contact.company });
    log('dnc_added', { callId: contact.callId, normalizedPhone: normalizePhone(contact.phone), source: contact.normalizedResult.source });
  }
  contact.analysisState = undefined;
  contact.finalizedCallId = contact.callId;
  contact.finalizedAt = new Date().toISOString();
  contact.callEndedAt = String((confirmedTerminalCall as any).endedAt || contact.finalizedAt);
  if (!contact.talkTimeSeconds || contact.talkTimeSeconds <= 0) { const a=Date.parse(String(contact.callStartedAt||contact.callCreatedAt||'')), b=Date.parse(String(contact.callEndedAt||'')); if (a && b && b>a) contact.talkTimeSeconds=Math.round((b-a)/1000); }
  contact.callLifecycleState = 'ended';
  logLatencyMetrics(confirmedTerminalCall, contact);
  log('call_ended', { callId: contact.callId, phone: contact.phone, endedReason: confirmedTerminalCall.endedReason, endedAt: contact.callEndedAt });
  campaignLog(contact.status === 'Completed' ? 'Call completed' : 'Call finalized', 'info', contact.company);
  if (contact.status === 'No Answer') campaignLog('No Answer', 'no-answer', contact.company);
  else if (contact.status === 'Failed') campaignLog('Failed', 'failed', contact.company);
  else if (contact.status === 'IVR') campaignLog('IVR detected', 'info', `${contact.company}: ${contact.summary}`);
  else if (contact.status === 'Voicemail') campaignLog('Voicemail', 'info', contact.company);
  if (contact.lead) campaignLog(`Lead: ${contact.lead}`, contact.lead.toLowerCase() as 'hot' | 'warm' | 'cold', contact.company);
  if (contact.recordingUrl) campaignLog('Recording URL received', 'info', contact.company);
  persist();
  historyStore().append(campaign, [contact], campaign.assistantId || config.vapiAssistantId);
  try {
    const sent = await notifyTelegramAfterIntelligenceReady(config.testMode, contact, sendTelegram, (event, details) => log(event, details), config.legacyTelegramPolicy);
    if (sent) { log('telegram_sent_after_finalization', { contact: contact.id, callId: contact.callId, phone: contact.phone }); campaignLog('Telegram notification sent', 'hot', contact.company); }
  } catch (error) {
    log('telegram_error', String(error)); campaignLog('Telegram error', 'failed', String(error));
  }
  if (contact.lead === 'Hot') {
    campaign.hotCount += 1;
    if (campaign.hotCount >= 3) { campaign.state = 'paused'; campaignLog('Queue paused', 'hot', 'Reason: 3 Hot Leads'); }
  }
  log('call_completed', { contact: contact.id, callId: contact.callId, status: contact.status, lead: contact.lead });
  persist();
}

async function fetchVapiCallRecord(callId: string) {
  const response = await fetch(`https://api.vapi.ai/call/${callId}`, { headers: { Authorization: `Bearer ${config.vapiApiKey}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json() as Promise<CallRecord>;
}

function finalCallShape(call: CallRecord) {
  const structured = findStructuredOutput(call);
  const structuredData = structured?.value;
  const analysis = call.analysis;
  return {
    callId: String(call.id || 'missing'),
    status: String(call.status || ''),
    endedReason: String(call.endedReason || ''),
    transcriptLength: extractFinalTranscript(call).length,
    messagesCount: Array.isArray(call.artifact?.messages) ? call.artifact.messages.length : 0,
    analysisExists: Boolean(analysis),
    analysisKeys: analysis && typeof analysis === 'object' ? Object.keys(analysis) : [],
    structuredDataExists: Boolean(structured),
    structuredDataKeys: structuredData ? Object.keys(structuredData) : [],
    artifactExists: Boolean(call.artifact),
    summaryExists: Boolean(call.analysis?.summary || call.summary),
    recordingUrlExists: Boolean(call.recordingUrl || call.artifact?.recordingUrl || call.artifact?.recording),
  };
}

function redactVapiCallForDebug(value: unknown, key = ''): unknown {
  if (/api.?key|token|secret|password|credential/i.test(key)) return '[REDACTED]';
  if (/(recording|presigned|log).*(url|path)/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item, index) => redactVapiCallForDebug(item, `${key}.${index}`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactVapiCallForDebug(childValue, key ? `${key}.${childKey}` : childKey)]));
  return value;
}

function writeVapiCallDebug(call: CallRecord) {
  const callId = String(call.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!callId) return;
  const debugDir = path.join(dataDir(), 'debug');
  fs.mkdirSync(debugDir, { recursive: true });
  writeTextAtomic(path.join(debugDir, `vapi-call-${callId}.json`), JSON.stringify(redactVapiCallForDebug(call), null, 2));
}

function chatOutputValue(chat: Record<string, any>) {
  const outputs = Array.isArray(chat.output) ? chat.output : [];
  const last = [...outputs].reverse().find(item => item?.role === 'assistant') || outputs.at(-1);
  const content = last?.content ?? last?.message ?? chat.content;
  if (Array.isArray(content)) return content.map(item => typeof item === 'string' ? item : item?.text || item?.content || '').join('');
  return content;
}

async function analyzeTranscriptWithVapi(transcript: string, contact: { company: string; phone: string; contactName?: string }) {
  const response = await fetch('https://api.vapi.ai/chat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.vapiApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      input: [`Company: ${contact.company || 'Unknown'}`, `Contact Name: ${contact.contactName || 'Unknown'}`, `Phone: ${contact.phone || 'Unknown'}`, 'Final Transcript:', transcript].join('\n'),
      assistant: {
        name: 'DMNT Lead Intelligence Analyzer',
        model: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'system', content: `${LEAD_INTELLIGENCE_EXTRACTION_PROMPT}\nReturn only valid JSON matching this schema:\n${JSON.stringify(leadIntelligenceSchema)}` }] },
      },
    }),
  });
  if (!response.ok) throw new Error(`Vapi transcript analysis: ${response.status} ${await response.text()}`);
  const chat = await response.json() as Record<string, any>;
  const output = chatOutputValue(chat);
  if (!output) throw new Error('Vapi transcript analysis returned no assistant output');
  return output;
}

const callLifecycle = new CallLifecycleCoordinator<Contact>({
  fetchCallRecord: fetchVapiCallRecord,
  finalizeCall,
  log: (event, details) => log(event, details),
  terminalConfirmed: contact => { contact.analysisState = 'waiting'; persist(); },
  terminalRejected: contact => { contact.analysisState = undefined; persist(); },
  finalCallFetched: call => { log('vapi_final_call_shape', finalCallShape(call)); writeVapiCallDebug(call); },
});

async function pollCall(contact: Contact) {
  let consecutiveErrors = 0;
  let reconciliationRequestedAt = 0;
  while (campaign.state !== 'stopped' && contact.status === 'Calling' && contact.callId) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const call = await fetchVapiCallRecord(contact.callId);
      consecutiveErrors = 0;
      await updateCallTimingAndTimeouts(contact, call);
      const finalized = await callLifecycle.handle(contact, call, 'polling');
      if (finalized) { campaignLog('Polling completed', 'info', contact.company); return; }
      const referenceTime = Date.parse(contact.callStartedAt || contact.callCreatedAt || '');
      const staleAfterMs = (campaign.maximumCallDurationSeconds + 30) * 1000;
      if (Number.isFinite(referenceTime) && Date.now() - referenceTime >= staleAfterMs) {
        if (!reconciliationRequestedAt) {
          reconciliationRequestedAt = Date.now();
          log('stale_call_reconciliation_started', { callId: contact.callId, phone: contact.phone, vapiStatus: call.status });
          try { await endRemoteCall(contact); log('stale_call_end_requested', { callId: contact.callId, phone: contact.phone }); }
          catch (error) { log('stale_call_end_request_failed', { callId: contact.callId, phone: contact.phone, error: String(error) }); }
        } else if (Date.now() - reconciliationRequestedAt >= 30000) {
          const verified = await fetchVapiCallRecord(contact.callId);
          if (await callLifecycle.handle(contact, verified, 'polling')) return;
          log('stale_call_reconciliation_failed', { callId: contact.callId, phone: contact.phone, vapiStatus: verified.status });
          await finalizeCall(contact, { ...verified, status: 'ended', endedReason: 'stale-call-reconciliation-failed' });
          contact.finalizedCallId = contact.callId;
          persist();
          return;
        }
      }
    } catch (error) {
      consecutiveErrors += 1;
      log('poll_error', { callId: contact.callId, attempt: consecutiveErrors, error: String(error) });
      if (consecutiveErrors >= 12) throw new Error(`Vapi polling остановлен после ${consecutiveErrors} ошибок: ${String(error)}`);
    }
  }
}

async function updateCallTimingAndTimeouts(contact: Contact, call: CallRecord) {
  if (call.status === 'ended') return;
  const startedAt = String((call as any).startedAt || contact.callStartedAt || contact.callCreatedAt || '');
  if (!startedAt) return;
  if (!contact.callStartedAt && (call as any).startedAt) contact.callStartedAt = String((call as any).startedAt);
  const messages = Array.isArray((call as any).artifact?.messages) ? (call as any).artifact.messages : Array.isArray((call as any).messages) ? (call as any).messages : [];
  if (!shouldProcessConversationEvents(contact)) return;
  await handleLiveIvr(contact, call);
  const timing = deriveCallTiming(messages, startedAt);
  const guard = conversationGuard(messages);
  contact.hasStartedConversation ||= guard.hasStartedConversation;
  const newly = (field: keyof typeof timing, event: string) => {
    const value = timing[field];
    if (value && !(contact as any)[field]) log(event, { callId: contact.callId, phone: contact.phone, at: value });
  };
  newly('firstAudioAt', 'first_audio_received'); newly('firstCustomerSpeechAt', 'first_customer_speech');
  if (timing.lastCustomerSpeechAt && timing.lastCustomerSpeechAt !== contact.lastCustomerSpeechAt) log('last_customer_speech', { callId: contact.callId, phone: contact.phone, at: timing.lastCustomerSpeechAt });
  if (timing.lastAssistantSpeechAt && timing.lastAssistantSpeechAt !== contact.lastAssistantSpeechAt) log('last_assistant_speech', { callId: contact.callId, phone: contact.phone, at: timing.lastAssistantSpeechAt });
  if (timing.goodbyeDetectedAt && !contact.endRequestReason) log('goodbye_detected', { callId: contact.callId, phone: contact.phone, at: timing.goodbyeDetectedAt });
  Object.assign(contact, timing);
  const reason = guard.shouldEnd
    ? guard.reason
    : timeoutReasonWithTelemetry(Date.now(), startedAt, timing, campaign, messages.length > 0);
  if (reason && beginEnding(contact, reason)) {
    if (reason === 'repeated_introduction_lifecycle_error') log('repeated_introduction_lifecycle_error', { callId: contact.callId, phone: contact.phone });
    log(reason === 'maximum_duration_reached' ? 'maximum_duration_reached' : reason === 'goodbye_timeout' ? 'goodbye_detected' : 'silence_timeout', { callId: contact.callId, phone: contact.phone, reason });
    log('call_end_requested', { callId: contact.callId, phone: contact.phone, reason });
    persist();
    await endRemoteCall(contact);
  } else persist();
}

async function handleLiveIvr(contact: Contact, call: CallRecord) {
  const ivrState = contact as Contact & { ivrDtmfAttempts?: number; ivrHandledPromptKeys?: string[]; ivrUnresolvedSummary?: string; ivrObservedToolCallIds?: string[] };
  const observedIds = new Set(ivrState.ivrObservedToolCallIds || []);
  for (const executed of executedDtmfCalls(call)) {
    if (observedIds.has(executed.id)) continue;
    observedIds.add(executed.id);
    log('ivr_dtmf_sent', { callId: contact.callId, phone: contact.phone, digits: executed.digits, toolCallId: executed.id });
    campaignLog('DTMF sent', 'info', `DTMF ${executed.digits} sent`);
  }
  ivrState.ivrObservedToolCallIds = [...observedIds].slice(-12);
  const decision = detectIvrNavigation(call, { zipCode: contact.zipCode });
  if (!decision) return;
  if (decision.kind === 'missing-data') {
    if (ivrState.ivrUnresolvedSummary !== decision.summary) {
      ivrState.ivrUnresolvedSummary = decision.summary;
      log('ivr_detected', { callId: contact.callId, phone: contact.phone, reason: decision.summary });
      campaignLog('IVR detected', 'info', `${contact.company}: ${decision.summary}`);
      persist();
    }
    return;
  }
  if (!contact.controlUrl || !shouldSendDtmf({ attempts: ivrState.ivrDtmfAttempts, handledPromptKeys: ivrState.ivrHandledPromptKeys }, decision)) return;

  log('ivr_detected', { callId: contact.callId, phone: contact.phone, digits: decision.digits });
  log('ivr_option_selected', { callId: contact.callId, phone: contact.phone, option: decision.label, digits: decision.digits });
  campaignLog('IVR detected', 'info', contact.company);
  campaignLog('IVR option selected', 'info', `${decision.label}: ${decision.digits}`);
  ivrState.ivrDtmfAttempts = Number(ivrState.ivrDtmfAttempts || 0) + 1;
  ivrState.ivrHandledPromptKeys = [...(ivrState.ivrHandledPromptKeys || []), decision.promptKey].slice(-12);
  persist();
  try {
    const response = await fetch(contact.controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'add-message',
        message: { role: 'system', content: `The remote IVR just requested keypad input. Immediately call the native dtmf tool with {"keys":"${decision.digits}"}. Say nothing before the tool call. Stay on this call and listen for the next menu.` },
        triggerResponseEnabled: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    log('ivr_dtmf_requested', { callId: contact.callId, phone: contact.phone, digits: decision.digits, attempt: ivrState.ivrDtmfAttempts });
    campaignLog(decision.label === 'ZIP code' ? 'ZIP requested' : 'IVR navigation requested', 'info', `${decision.label}: ${decision.digits}`);
  } catch (error) {
    log('ivr_dtmf_error', { callId: contact.callId, phone: contact.phone, digits: decision.digits, error: String(error) });
    campaignLog('DTMF error', 'failed', String(error));
  }
}

async function endRemoteCall(contact: Contact) {
  if (!contact.controlUrl) return;
  const response = await fetch(contact.controlUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'end-call' }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

async function callContact(contact: Contact) {
  if (!phoneEligibility(phoneRegistry(), contact.phone, false).allowed) {
    contact.status = 'Failed'; contact.summary = 'Skipped: global DNC';
    contact.normalizedResult = normalizedFromLegacy({ status: 'stopped', summary: contact.summary, callId: contact.callId });
    contact.normalizedResult.businessOutcome = 'DNC'; contact.normalizedResult.doNotContact = true;
    log('call_skipped', { reason: 'dnc', normalizedPhone: normalizePhone(contact.phone) }); persist(); return;
  }
  contact.status = 'Calling'; contact.callLifecycleState = 'active'; contact.hasStartedConversation = false; contact.endRequestReason = undefined;
  Object.assign(contact, { ivrDtmfAttempts: 0, ivrHandledPromptKeys: [], ivrUnresolvedSummary: undefined, ivrObservedToolCallIds: [] });
  persist();
  campaignLog('Calling', 'info', contact.company);
  const assistantId = campaign.assistantId || config.vapiAssistantId;
  const selectedAssistant = config.vapiAssistants.find(item => item.id === assistantId);
  const voiceOverride = config.vapiVoiceOverrideEnabled && config.vapiVoiceProvider.trim() && config.vapiVoiceId.trim()
    ? { provider: config.vapiVoiceProvider.trim(), voiceId: config.vapiVoiceId.trim() }
    : undefined;
  let outboundCall;
  try {
    const selectedAssistantRecord: any = assistantId ? await vapiRequest(`/assistant/${assistantId}`, { method: 'GET' }) : undefined;
    outboundCall = buildOutboundCallPayload({
      assistantId,
      phoneNumberId: config.vapiSipPhoneNumberId,
      contact,
      campaignSystemPrompt: campaign.systemPrompt,
      hotLeadRules: campaign.hotLeadRules,
      analysisPlan: { summaryPlan: { enabled: true }, minMessagesThreshold: 1, structuredDataPlan: { enabled: true, messages: [{ role: 'system', content: LEAD_INTELLIGENCE_EXTRACTION_PROMPT }], schema: leadIntelligenceSchema, timeoutSeconds: 15 } },
      voiceOverride,
      assistantVoice: selectedAssistant?.voice ? { provider: selectedAssistant.voice.provider, voiceId: selectedAssistant.voice.voiceId } : undefined,
      inlineVoice: { provider: 'vapi', voiceId: campaign.voice || 'Elliot' },
      assistantTools: Array.isArray(selectedAssistantRecord?.model?.tools) ? selectedAssistantRecord.model.tools : [],
      maximumCallDurationSeconds: campaign.maximumCallDurationSeconds,
      silenceTimeoutSeconds: Math.max(campaign.initialSilenceTimeoutSeconds, campaign.conversationSilenceTimeoutSeconds),
      legacyAssistantOverrides: config.legacyAssistantOverrides,
      dynamicVariables: buildWiseDynamicVariables(contact, config.agentName || 'Alex'),
    });
  } catch (error) {
    log('assistant_selection_mismatch', { assistantId: assistantId || 'inline-assistant', company: contact.company, contactName: contact.contactName || '', error: String(error) });
    throw error;
  }
  const { payload, debug } = outboundCall;
  log('vapi_call_payload_debug', debug);
  const response = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.vapiApiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Vapi: ${response.status} ${await response.text()}`);
  const call: any = await response.json();
  contact.callId = call.id;
  contact.controlUrl = call.monitor?.controlUrl;
  contact.callCreatedAt = call.createdAt || new Date().toISOString();
  contact.callStartedAt = call.startedAt;
  log('call_started', { contact: contact.id, callId: call.id, phone: contact.phone, createdAt: contact.callCreatedAt, startedAt: contact.callStartedAt }); persist();
  if (campaign.state === 'stopped') {
    try { await endRemoteCall(contact); } catch (error) { log('stop_call_error', { callId: contact.callId, error: String(error) }); }
    contact.status = 'Failed'; contact.summary = 'Остановлено пользователем'; persist(); return;
  }
  await pollCall(contact);
}

async function runQueue() {
  if (processing) return;
  processing = true;
  try {
    while (campaign.state === 'running') {
      const contact = campaign.contacts.find(item => item.status === 'Waiting');
      if (!contact) {
        campaign.state = 'idle';
        campaign.finishedAt = new Date().toISOString();
        try {
          const exported = saveNoAnswerRetryFile();
          campaignLog('No Answer retry CSV updated', 'info', `${exported.count} contacts`);
        } catch (error) { log('no_answer_retry_export_error', String(error)); }
        persist();
        historyStore().finish(campaign, campaign.assistantId || config.vapiAssistantId);
        break;
      }
      if (!phoneEligibility(phoneRegistry(), contact.phone, false).allowed) {
        contact.status = 'Failed'; contact.summary = 'Skipped: global DNC';
        contact.normalizedResult = normalizedFromLegacy({ status: 'stopped', summary: contact.summary });
        contact.normalizedResult.businessOutcome = 'DNC'; contact.normalizedResult.doNotContact = true;
        log('queue_skipped', { reason: 'dnc', normalizedPhone: normalizePhone(contact.phone) }); persist(); continue;
      }
      try { await callContact(contact); }
      catch (error) { contact.status = 'Failed'; contact.summary = String(error); log('call_error', String(error)); campaignLog('Vapi error', 'failed', `${contact.company}: ${String(error)}`); campaignLog('Failed', 'failed', contact.company); persist(); }
    }
  } finally {
    processing = false;
  }
}

async function recoverActiveCalls() {
  const active = campaign.contacts.filter(contact => contact.status === 'Calling' && contact.callId);
  if (!active.length) return;
  processing = true;
  try {
    await Promise.all(active.map(async contact => {
      try { await pollCall(contact); }
      catch (error) { contact.status = 'Failed'; contact.summary = String(error); campaignLog('Vapi error', 'failed', `${contact.company}: ${String(error)}`); persist(); }
    }));
  } finally {
    processing = false;
    if (campaign.state === 'running') await runQueue();
  }
}

async function stopCampaign() {
  if (campaign.state === 'stopped') return;
  campaign.state = 'stopped';
  const active = campaign.contacts.filter(contact => contact.status === 'Calling');
  active.forEach(contact => { contact.status = 'Failed'; contact.summary = 'Остановлено пользователем'; });
  campaign.contacts.filter(contact => contact.status === 'Waiting').forEach(contact => { contact.status = 'Failed'; contact.summary = 'Остановлено пользователем'; });
  persist(); campaignLog('Campaign stopped');
  await Promise.all(active.map(async contact => {
    try { await endRemoteCall(contact); }
    catch (error) { log('stop_call_error', { callId: contact.callId, error: String(error) }); }
  }));
}

async function waitForQueueIdle() {
  const deadline = Date.now() + 45000;
  while (processing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
}

function startWebhook() {
  webhookServer = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook') { res.writeHead(404).end(); return; }
    let body = '';
    let bodyBytes = 0;
    let bodyTooLarge = false;
    req.on('data', chunk => {
      if (bodyTooLarge) return;
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > 2 * 1024 * 1024) {
        bodyTooLarge = true;
        res.writeHead(413).end('Webhook body too large');
        return;
      }
      body += chunk;
    });
    req.on('end', async () => {
      if (bodyTooLarge) return;
      try {
        const payload = JSON.parse(body || '{}');
        const message = payload.message || payload;
        campaignLog('Webhook received', 'info', message.type || 'Vapi event');
        const callId = callIdFromEvent(message, 'webhook');
        const contact = campaign.contacts.find(item => item.status === 'Calling' && item.callId === callId);
        if (contact) await callLifecycle.handle(contact, message, 'webhook');
        else log('ignored_stale_call_event', { callId: callId || 'missing', phone: message.call?.customer?.number || message.customer?.number || 'Unknown', source: 'webhook' });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      } catch (error) { res.writeHead(400).end(String(error)); }
    });
  });
  webhookServer.listen(8787, serviceHost);
  webhookServer.on('error', error => log('webhook_server_error', String(error)));
}

function createWindow() {
  win = new BrowserWindow({ width: 1400, height: 900, minWidth: 1050, minHeight: 700, backgroundColor: '#0b0d12', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = devUrl ? win.loadURL(devUrl) : win.loadFile(path.join(__dirname, '../dist/index.html'));
  load.catch(error => log('main_window_load_error', String(error)));
  win.webContents.on('did-finish-load', broadcast);
  win.on('close', event => {
    if (!closingMainWindow && campaign.contacts.some(contact => contact.status === 'Calling')) {
      event.preventDefault(); closingMainWindow = true;
      void stopCampaign().then(waitForQueueIdle).catch(error => log('close_stop_error', String(error))).finally(() => { settingsWin?.destroy(); win?.destroy(); });
    } else if (!closingMainWindow) {
      settingsWin?.destroy();
    }
  });
  win.on('closed', () => { win = null; });
}

function openSettingsWindow() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width: 620, height: 760, minWidth: 520, minHeight: 650, parent: win || undefined, backgroundColor: '#0b0d12', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const load = devUrl ? settingsWin.loadURL(`${devUrl}?settings=1`) : settingsWin.loadFile(path.join(__dirname, '../dist/index.html'), { query: { settings: '1' } });
  load.catch(error => log('settings_window_load_error', String(error)));
  settingsWin.webContents.on('did-finish-load', broadcast);
  settingsWin.on('closed', () => { settingsWin = null; });
}

app.whenReady().then(() => {
  console.info('[DMNT main]', { filename: __filename });
  const rawConfig = readJson<Record<string, any>>('config.json', {});
  const { zadarmaKey: _key, zadarmaSecret: _secret, zadarmaSipPassword: _password, zadarmaSipLine: _line, zadarmaSipLines: _lines, zadarmaPhoneNumber: _number, zadarmaPhoneNumbers: _numbers, ...currentConfig } = rawConfig;
  config = { ...emptyConfig, ...currentConfig, telephony: migrateTelephonyConfig(rawConfig) };
  campaign = { ...emptyCampaign, ...readJson('campaign.json', emptyCampaign) };
  if (campaign.state === 'running') campaign.state = 'paused';
  campaign.contacts.filter(contact => contact.status === 'Calling' && !contact.callId).forEach(contact => { contact.status = 'Waiting'; });
  const profileMigration = migrateCampaignProfiles(legacyCampaignsDir(), campaignsDir());
  const seededPhones = phoneRegistry().seed(campaign.contacts);
  if (campaign.contacts.length || campaign.campaignId) historyStore().initialize(campaign, campaign.assistantId || config.vapiAssistantId);
  writeJson('config.json', config); writeJson('campaign.json', campaign); writeJson('logs.json', readJson('logs.json', []));
  campaignLog(`Telephony provider selected: ${activeTelephonyProvider().displayName}`);
  if (profileMigration.migrated) campaignLog('Campaign profiles migrated', 'info', `${profileMigration.migrated} profiles copied to persistent storage`);
  if (seededPhones) campaignLog('Phone index initialized', 'info', `${seededPhones} historical phones indexed`);
  startWebhook(); startHubBridge();
  if (!headlessMode) createWindow();
  else console.log('DMNT Dialer running headless for HUB (no Electron window).');
  void recoverActiveCalls().catch(error => { log('recovery_error', String(error)); campaignLog('Vapi error', 'failed', `Recovery: ${String(error)}`); });
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => { if (!headlessMode && process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { webhookServer?.close(); hubBridgeServer?.close(); });

ipcMain.handle('load', () => ({ config: publicConfig(), campaign, logs: campaignLogs(), dataDir: dataDir() }));
ipcMain.handle('save-config', async (_event, value: Config) => {
  const previousProvider = config.telephony.provider;
  config = { ...config, ...value };
  writeJson('config.json', config); broadcast();
  const provider = activeTelephonyProvider();
  if (previousProvider !== provider.id) campaignLog(`Telephony provider selected: ${provider.displayName}`);
  const zadarma = config.telephony.zadarma;
  const manualSip = config.telephony.manualSip;
  const readyForProvisioning = config.vapiApiKey && ((provider.id === 'zadarma' && zadarma.apiKey && zadarma.apiSecret
    && zadarma.sipLine && zadarma.sipPassword && zadarma.selectedNumber) || (provider.id === 'manualSip'
    && manualSip.sipHost && manualSip.username && manualSip.password && manualSip.callerId));
  if (readyForProvisioning) await provider.provisionForVapi();
  return { ok: true };
});
ipcMain.handle('open-settings', () => { openSettingsWindow(); return { ok: true }; });
ipcMain.handle('test-telephony', async (_event, value: Config) => {
  config = { ...config, ...value }; writeJson('config.json', config); broadcast();
  const provider = activeTelephonyProvider();
  await validateTelephony(provider);
  const result = await provider.testConnection();
  if (config.vapiApiKey) await provider.provisionForVapi(true);
  return { ok: true, message: `✓ ${provider.displayName} configuration OK`, ...result };
});
ipcMain.handle('test-zadarma', async (_event, value: Config) => {
  config = { ...config, ...value };
  const provider = activeTelephonyProvider();
  campaignLog('Telephony validation started', 'info', provider.displayName);
  let result;
  try { result = await provider.testConnection(); campaignLog('Telephony validation completed', 'info', provider.displayName); }
  catch (error) { campaignLog('Telephony validation failed', 'failed', `${provider.displayName}: ${String(error)}`); throw error; }
  if (provider.id !== 'zadarma') throw new Error('Generic SIP provider is not implemented yet');
  const zadarma = config.telephony.zadarma; const lines = result.sipLines; const numbers = result.phoneNumbers;
  const selected = lines.some(line => line.id === zadarma.sipLine) ? zadarma.sipLine : (lines[0]?.id || '');
  const selectedNumber = numbers.some(item => item.number === zadarma.selectedNumber) ? zadarma.selectedNumber : '';
  config.telephony.zadarma = { ...zadarma, sipLines: lines, sipLine: selected, phoneNumbers: numbers, selectedNumber };
  writeJson('config.json', config); broadcast();
  const updatedProvider = activeTelephonyProvider();
  if (selected && selectedNumber) await updatedProvider.setCallerId();
  if (selected && config.telephony.zadarma.sipPassword && config.vapiApiKey && selectedNumber) await updatedProvider.provisionForVapi();
  return { ok: true, lines, selected, numbers, selectedNumber, message: `✓ Zadarma OK. SIP Lines: ${lines.length}. Phone Numbers: ${numbers.length}.` };
});
ipcMain.handle('refresh-zadarma-numbers', async (_event, value: Config) => {
  config = { ...config, ...value }; const provider = activeTelephonyProvider();
  const numbers = await provider.listPhoneNumbers(); const zadarma = config.telephony.zadarma;
  const selected = numbers.some(item => item.number === zadarma.selectedNumber) ? zadarma.selectedNumber : '';
  config.telephony.zadarma = { ...zadarma, phoneNumbers: numbers, selectedNumber: selected };
  writeJson('config.json', config); broadcast();
  if (selected && config.telephony.zadarma.sipLine) await activeTelephonyProvider().setCallerId();
  return { ok: true, numbers, selected, message: numbers.length ? `✓ Found ${numbers.length} Zadarma phone numbers` : 'No phone numbers are available in this Zadarma account' };
});
ipcMain.handle('select-zadarma-sip', async (_event, value: Config) => {
  const zadarma = value.telephony.zadarma;
  if (!zadarma.sipLines.some(line => line.id === zadarma.sipLine)) throw new Error('Выбранная SIP-линия отсутствует в аккаунте Zadarma');
  config = { ...config, ...value };
  writeJson('config.json', config); broadcast();
  const provider = activeTelephonyProvider();
  if (config.telephony.zadarma.selectedNumber) await provider.setCallerId();
  if (config.telephony.zadarma.selectedNumber) await provider.provisionForVapi();
  return { ok: true, message: `✓ SIP ${config.telephony.zadarma.sipLine} подключён` };
});
ipcMain.handle('select-zadarma-number', async (_event, value: Config) => {
  const zadarma = value.telephony.zadarma;
  if (!zadarma.phoneNumbers.some(item => item.number === zadarma.selectedNumber)) throw new Error('Selected phone number is not available in Zadarma');
  config = { ...config, ...value };
  const provider = activeTelephonyProvider(); await provider.setCallerId();
  writeJson('config.json', config); broadcast();
  if (config.vapiApiKey && config.telephony.zadarma.sipPassword) await provider.provisionForVapi();
  return { ok: true, message: `✓ Caller ID ${config.telephony.zadarma.selectedNumber} selected` };
});
ipcMain.handle('test-vapi', async (_event, value: Config) => {
  const apiKey = value.vapiApiKey?.trim();
  if (!apiKey) return { ok: false, messages: ['❌ Vapi API Key is empty'] };
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const assistantsResponse = await fetch('https://api.vapi.ai/assistant', { headers, signal: AbortSignal.timeout(15000) });
    if (assistantsResponse.status === 401 || assistantsResponse.status === 403) return { ok: false, messages: ['❌ Invalid Vapi API Key'] };
    if (!assistantsResponse.ok) throw new Error(`Assistants: ${assistantsResponse.status} ${await assistantsResponse.text()}`);
    const assistantsRaw = await assistantsResponse.json() as Array<{ id?: unknown; name?: unknown; voice?: { provider?: unknown; voiceId?: unknown; name?: unknown; model?: unknown } }>;
    const assistants = assistantsRaw.filter(item => typeof item.id === 'string').map(item => ({ id: item.id as string, name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Unnamed Assistant', ...(item.voice && typeof item.voice.provider === 'string' && typeof item.voice.voiceId === 'string' ? { voice: { provider: item.voice.provider, voiceId: item.voice.voiceId, ...(typeof item.voice.name === 'string' ? { name: item.voice.name } : {}), ...(typeof item.voice.model === 'string' ? { model: item.voice.model } : {}) } } : {}) }));
    const phoneResponse = await fetch('https://api.vapi.ai/phone-number', { headers, signal: AbortSignal.timeout(15000) });
    if (!phoneResponse.ok) throw new Error(`Phone Numbers: ${phoneResponse.status} ${await phoneResponse.text()}`);
    const phoneNumbers = await phoneResponse.json() as unknown[];
    const messages = ['✓ API Key OK', `✓ Найдено Phone Numbers: ${phoneNumbers.length}`, `✓ Найдено Assistants: ${assistants.length}`];
    const savedAssistantId = assistants.some(item => item.id === value.vapiAssistantId) ? value.vapiAssistantId : (assistants.some(item => item.id === config.vapiAssistantId) ? config.vapiAssistantId : (assistants[0]?.id || ''));
    const selectedAssistant = assistants.find(item => item.id === savedAssistantId);
    messages.push(selectedAssistant?.voice ? `✓ Assistant Voice: ${selectedAssistant.voice.provider} / ${selectedAssistant.voice.voiceId}` : 'ℹ Selected Assistant has no voice configuration');
    config = { ...config, ...value, vapiApiKey: apiKey, vapiAssistants: assistants, vapiAssistantId: savedAssistantId };
    writeJson('config.json', config); broadcast();
    const provider = activeTelephonyProvider();
    if (provider.implemented && provider.getSipCredentials().username && provider.getSipCredentials().password && provider.getSelectedNumber()) {
      await provider.provisionForVapi(true);
      messages.push(`✓ ${provider.displayName} BYO SIP verified`);
    }
    return { ok: true, messages };
  } catch (error) { return { ok: false, messages: [`❌ ${String(error)}`] }; }
});
ipcMain.handle('test-telegram', async (_event, value: Config) => {
  const token = value.telegramBotToken?.trim(); const chatId = value.telegramChatId?.trim();
  try {
    const credentials = requireTelegramCredentials(token || '', chatId || '');
    const response = await fetch(`https://api.telegram.org/bot${credentials.botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: credentials.chatId, text: 'DMNT Dialer MVP successfully connected.' }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { description?: string } | null;
      throw new Error(error?.description || `HTTP ${response.status}`);
    }
    log('telegram_test_sent');
    return { ok: true, message: '✓ Telegram OK' };
  } catch (error) { log('telegram_test_error', String(error)); return { ok: false, message: `❌ Telegram: ${String(error)}` }; }
});
ipcMain.handle('save-campaign', (_event, value: Partial<Campaign>) => { campaign = { ...campaign, ...value, contacts: campaign.contacts }; persist(); return { ok: true }; });
ipcMain.handle('list-campaigns', () => {
  fs.mkdirSync(campaignsDir(), { recursive: true });
  return fs.readdirSync(campaignsDir()).filter(name => name.toLowerCase().endsWith('.json')).map(name => path.basename(name, '.json')).sort();
});
ipcMain.handle('save-campaign-profile', (_event, profile: CampaignProfile) => {
  const name = profile.campaignName.trim();
  if (!name) throw new Error('Campaign Name обязателен');
  const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
  fs.mkdirSync(campaignsDir(), { recursive: true });
  writeTextAtomic(path.join(campaignsDir(), `${safeName}.json`), JSON.stringify({ ...profile, campaignName: safeName }, null, 2));
  campaign = { ...campaign, ...profile, campaignName: safeName, voice: profile.voiceId, contacts: campaign.contacts };
  persist(); log('campaign_profile_saved', { name }); campaignLog('Campaign saved', 'info', safeName); return safeName;
});
ipcMain.handle('load-campaign-profile', (_event, name: string) => {
  const safeName = path.basename(name);
  const profile = JSON.parse(fs.readFileSync(path.join(campaignsDir(), `${safeName}.json`), 'utf8')) as CampaignProfile;
  campaign = { ...campaign, ...DEFAULT_CALL_TIMEOUTS, ...profile, campaignName: profile.campaignName || safeName, systemPrompt: profile.systemPrompt || '', assistantId: profile.assistantId || '', voice: profile.voiceId || 'Elliot', hotLeadRules: profile.hotLeadRules || '', contacts: campaign.contacts };
  persist(); log('campaign_profile_loaded', { name: safeName }); campaignLog('Campaign loaded', 'info', safeName); return campaign;
});
ipcMain.handle('retry-failed', () => {
  if (processing || campaign.contacts.some(contact => contact.status === 'Calling')) throw new Error('Нельзя повторно ставить контакты в очередь во время активного звонка');
  let count = 0;
  campaign.contacts.forEach(contact => {
    if ((contact.status === 'Failed' || contact.status === 'No Answer') && !phoneRegistry().isDnc(contact.phone)) {
      contact.status = 'Waiting'; contact.summary = ''; contact.lead = ''; contact.leadIntelligence = undefined; contact.analysisSource = undefined; contact.normalizedResult = undefined; contact.rawStructuredOutput = undefined; contact.endedReason = undefined; contact.recordingUrl = undefined; contact.callId = undefined; contact.controlUrl = undefined; contact.analysisState = undefined; contact.finalizedCallId = undefined; contact.finalizedAt = undefined; contact.telegramSentAt = undefined; contact.telegramMessageId = undefined; count += 1;
    }
  });
  if (count) campaign.state = 'idle';
  persist(); log('contacts_retried', { count }); campaignLog('Retry Failed', 'info', `${count} contacts queued`); return count;
});
ipcMain.handle('open-recording', async (_event, url: string) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Некорректный Recording URL');
  await shell.openExternal(parsed.toString()); return { ok: true };
});
ipcMain.handle('import-csv', async () => {
  if (processing || campaign.contacts.some(contact => contact.status === 'Calling')) throw new Error('Нельзя импортировать CSV во время активного звонка');
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const parsed = Papa.parse<Record<string, string>>(fs.readFileSync(result.filePaths[0], 'utf8'), { header: true, skipEmptyLines: true });
  const registry = phoneRegistry();
  campaign.contacts = importCsvRows(parsed.data, parsed.meta.fields).filter(contact => {
    if (registry.isDnc(contact.phone)) { log('csv_import_skipped', { reason: 'dnc', normalizedPhone: normalizePhone(contact.phone) }); return false; }
    if (registry.hasPhone(contact.phone)) { log('csv_import_skipped', { reason: 'duplicate', normalizedPhone: normalizePhone(contact.phone) }); return false; }
    return true;
  }).map<Contact>((contact, index) => ({
    id: `${Date.now()}-${index}`,
    ...contact,
    status: 'Waiting',
    summary: '',
    lead: '',
  }));
  campaign.contacts.forEach(contact => registry.recordPhone({ phone: contact.phone, company: contact.company, contactId: contact.id }));
  campaign.hotCount = 0; campaign.state = 'idle'; persist(); log('csv_imported', { count: campaign.contacts.length, errors: parsed.errors });
  campaignLog('CSV imported', 'info', `${campaign.contacts.length} contacts`);
  return campaign.contacts.length;
});
ipcMain.handle('export-csv', async () => {
  const result = await dialog.showSaveDialog({ defaultPath: `dmnt-campaign-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (result.canceled || !result.filePath) return null;
  const csv = Papa.unparse(campaign.contacts.map(contact => {
    const intelligence = contact.leadIntelligence;
    return {
      Company: contact.company,
      Phone: contact.phone,
      Status: contact.status,
      Lead: intelligence?.lead || contact.lead,
      'Customer Name': intelligence?.customerName || '',
      'Interest Level': intelligence?.interestLevel || '',
      'Current Situation': intelligence?.currentSituation.join('; ') || '',
      'Pain Points': intelligence?.painPoints.join('; ') || '',
      'Questions Asked': intelligence?.questionsAsked.join('; ') || '',
      Objections: intelligence?.objections.join('; ') || '',
      'Decision Maker': intelligence?.decisionMaker || '',
      'Budget Signals': intelligence?.budgetSignals || '',
      Urgency: intelligence?.urgency || '',
      'Next Step': intelligence?.nextStep || '',
      'Follow Up Recommendation': intelligence?.followUpRecommendation || '',
      'Customer Summary': intelligence?.customerSummary.join('\n') || '',
      'Legacy Summary': intelligence ? '' : contact.summary,
      'Recording URL': contact.recordingUrl || '',
    };
  }));
  fs.writeFileSync(result.filePath, `\uFEFF${csv}`, 'utf8');
  log('csv_exported', { path: result.filePath, count: campaign.contacts.length });
  campaignLog('Export completed', 'info', `${campaign.contacts.length} contacts`);
  return result.filePath;
});
ipcMain.handle('export-no-answer', () => {
  const exported = saveNoAnswerRetryFile();
  persist();
  campaignLog('No Answer retry CSV updated', 'info', `${exported.count} contacts`);
  return exported.path;
});
async function controlCampaign(action: 'start' | 'pause' | 'resume' | 'stop') {
  if (action === 'start' || action === 'resume') {
    if (campaign.state === 'running') return { ok: true, state: campaign.state };
    if (!config.vapiApiKey || !campaign.systemPrompt) throw new Error('Подключите телефонию в Settings и заполните System Prompt');
    if (config.vapiVoiceOverrideEnabled && (!config.vapiVoiceProvider.trim() || !config.vapiVoiceId.trim())) throw new Error('Voice override requires both Provider and Voice ID');
    const provider = activeTelephonyProvider(); await validateTelephony(provider);
    await provider.setCallerId();
    await provider.provisionForVapi(true);
    campaign.state = 'running'; campaign.startedAt ||= new Date().toISOString(); campaign.finishedAt = undefined; historyStore().initialize(campaign, campaign.assistantId || config.vapiAssistantId); persist(); campaignLog(action === 'start' ? 'Campaign started' : 'Campaign resumed');
    void runQueue().catch(error => { log('queue_error', String(error)); campaignLog('Vapi error', 'failed', `Queue: ${String(error)}`); });
  }
  if (action === 'pause' && campaign.state !== 'paused') { campaign.state = 'paused'; persist(); campaignLog('Campaign paused'); }
  if (action === 'stop') await stopCampaign();
  return { ok: true, state: campaign.state };
}
ipcMain.handle('control', async (_event, action: 'start' | 'pause' | 'resume' | 'stop') => controlCampaign(action));
