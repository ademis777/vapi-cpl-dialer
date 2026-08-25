/// <reference types="vite/client" />

type SipLine = { id: string; displayName: string; lines: number };
type ZadarmaPhoneNumber = { number: string; name: string };
type AssistantVoice = { provider: string; voiceId: string; name?: string; model?: string };
type VapiAssistant = { id: string; name: string; voice?: AssistantVoice };
type ZadarmaConfig = { apiKey: string; apiSecret: string; sipLine: string; sipPassword: string; selectedNumber: string; sipLines: SipLine[]; phoneNumbers: ZadarmaPhoneNumber[] };
type GenericSipConfig = { displayName: string; sipUri: string; sipDomain: string; username: string; password: string; outboundProxy: string; callerId: string; phoneNumber: string };
type ManualSipConfig = { sipHost: string; username: string; password: string; callerId: string };
type TelephonyConfig = { provider: 'zadarma' | 'manualSip' | 'genericSip'; zadarma: ZadarmaConfig; manualSip: ManualSipConfig; genericSip: GenericSipConfig };
type Config = { vapiApiKey: string; vapiAssistantId: string; vapiAssistants: VapiAssistant[]; vapiVoiceOverrideEnabled: boolean; vapiVoiceProvider: string; vapiVoiceId: string; telephony: TelephonyConfig; telegramBotToken: string; telegramChatId: string; testMode: boolean };
type LeadIntelligence = { lead: 'Hot' | 'Warm' | 'Cold' | 'Unknown'; customerName: string; company: string; phone: string; interestLevel: 'High' | 'Medium' | 'Low' | 'Unknown'; currentSituation: string[]; painPoints: string[]; questionsAsked: string[]; objections: string[]; decisionMaker: 'Yes' | 'No' | 'Unknown'; budgetSignals: 'High' | 'Medium' | 'Low' | 'Unknown'; urgency: 'Hot' | 'Medium' | 'Low' | 'Unknown'; nextStep: string; followUpRecommendation: string; customerSummary: string[] };
type Contact = { id: string; company: string; phone: string; contactName?: string; status: string; summary: string; lead: string; leadIntelligence?: LeadIntelligence; analysisSource?: 'vapi_structured_output' | 'transcript_fallback_analysis' | 'empty_fallback'; recordingUrl?: string; analysisState?: 'waiting'; finalizedCallId?: string; finalizedAt?: string; callCreatedAt?: string; callStartedAt?: string; callEndedAt?: string; talkTimeSeconds?: number };
type CallTimeoutSettings = { initialSilenceTimeoutSeconds: number; conversationSilenceTimeoutSeconds: number; goodbyeTimeoutSeconds: number; maximumCallDurationSeconds: number };
type Campaign = { contacts: Contact[]; campaignName: string; systemPrompt: string; assistantId: string; voice: string; phoneNumber: string; hotLeadRules: string; state: string; hotCount: number } & CallTimeoutSettings;
type CampaignProfile = { campaignName: string; systemPrompt: string; assistantId: string; voiceId: string; hotLeadRules: string } & CallTimeoutSettings;
type CampaignLogEntry = { at: string; event: 'campaign_log'; message: string; tone?: 'hot' | 'warm' | 'cold' | 'failed' | 'no-answer' | 'info'; details?: string };
type AppState = { config: Config; campaign: Campaign; logs: CampaignLogEntry[]; dataDir: string };

interface Window { dmnt: {
  load(): Promise<AppState>;
  saveConfig(config: Config): Promise<{ ok: boolean }>;
  importCsv(): Promise<number | null>;
  saveCampaign(campaign: Partial<Campaign>): Promise<{ ok: boolean }>;
  control(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<{ ok: boolean }>;
  openSettings(): Promise<{ ok: boolean }>;
  testVapi(config: Config): Promise<{ ok: boolean; messages: string[] }>;
  testTelephony(config: Config): Promise<{ ok: boolean; message: string; sipLines: SipLine[]; phoneNumbers: ZadarmaPhoneNumber[] }>;
  testZadarma(config: Config): Promise<{ ok: boolean; lines: SipLine[]; selected: string; numbers: ZadarmaPhoneNumber[]; selectedNumber: string; message: string }>;
  refreshZadarmaNumbers(config: Config): Promise<{ ok: boolean; numbers: ZadarmaPhoneNumber[]; selected: string; message: string }>;
  selectZadarmaSip(config: Config): Promise<{ ok: boolean; message: string }>;
  selectZadarmaNumber(config: Config): Promise<{ ok: boolean; message: string }>;
  testTelegram(config: Config): Promise<{ ok: boolean; message: string }>;
  exportCsv(): Promise<string | null>;
  exportNoAnswer(): Promise<string>;
  listCampaigns(): Promise<string[]>;
  saveCampaignProfile(profile: CampaignProfile): Promise<string>;
  loadCampaignProfile(name: string): Promise<Campaign>;
  retryFailed(): Promise<number>;
  openRecording(url: string): Promise<{ ok: boolean }>;
  onUpdate(callback: (state: AppState) => void): () => void;
} }
