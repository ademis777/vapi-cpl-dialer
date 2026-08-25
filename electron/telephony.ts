import crypto from 'node:crypto';

export type TelephonyProviderId = 'zadarma' | 'manualSip' | 'genericSip';
export type SipLine = { id: string; displayName: string; lines: number };
export type PhoneNumber = { number: string; name: string };
export type SipCredentials = { username: string; password: string; sipDomain: string; outboundProxy?: string };

export type ZadarmaConfig = {
  apiKey: string; apiSecret: string; sipLine: string; sipPassword: string; selectedNumber: string;
  sipLines: SipLine[]; phoneNumbers: PhoneNumber[];
};
export type GenericSipConfig = {
  displayName: string; sipUri: string; sipDomain: string; username: string; password: string;
  outboundProxy: string; callerId: string; phoneNumber: string;
};
export type ManualSipConfig = { sipHost: string; username: string; password: string; callerId: string };
export type TelephonyConfig = { provider: TelephonyProviderId; zadarma: ZadarmaConfig; manualSip: ManualSipConfig; genericSip: GenericSipConfig };

export type TelephonyProviderDependencies = {
  diagnostic: (event: string, details: unknown) => void;
  provisionForVapi: (provider: TelephonyProvider, validateExisting?: boolean) => Promise<void>;
};

export interface TelephonyProvider {
  readonly id: TelephonyProviderId;
  readonly displayName: string;
  readonly implemented: boolean;
  testConnection(): Promise<{ sipLines: SipLine[]; phoneNumbers: PhoneNumber[] }>;
  listPhoneNumbers(): Promise<PhoneNumber[]>;
  listSipLines(): Promise<SipLine[]>;
  getSelectedNumber(): PhoneNumber | undefined;
  setCallerId(): Promise<void>;
  getSipCredentials(): SipCredentials;
  provisionForVapi(validateExisting?: boolean): Promise<void>;
  validateConfiguration(): void;
}

export const emptyTelephonyConfig: TelephonyConfig = {
  provider: 'zadarma',
  zadarma: { apiKey: '', apiSecret: '', sipLine: '', sipPassword: '', selectedNumber: '', sipLines: [], phoneNumbers: [] },
  manualSip: { sipHost: '', username: '', password: '', callerId: '' },
  genericSip: { displayName: '', sipUri: '', sipDomain: '', username: '', password: '', outboundProxy: '', callerId: '', phoneNumber: '' }
};

export function migrateTelephonyConfig(raw: Record<string, any>): TelephonyConfig {
  const nested = raw.telephony || {};
  return {
    provider: nested.provider === 'manualSip' || nested.provider === 'genericSip' ? nested.provider : 'zadarma',
    zadarma: {
      ...emptyTelephonyConfig.zadarma,
      ...(nested.zadarma || {}),
      apiKey: nested.zadarma?.apiKey || raw.zadarmaKey || '',
      apiSecret: nested.zadarma?.apiSecret || raw.zadarmaSecret || '',
      sipLine: nested.zadarma?.sipLine || raw.zadarmaSipLine || '',
      sipPassword: nested.zadarma?.sipPassword || raw.zadarmaSipPassword || '',
      selectedNumber: nested.zadarma?.selectedNumber || raw.zadarmaPhoneNumber || '',
      sipLines: nested.zadarma?.sipLines || raw.zadarmaSipLines || [],
      phoneNumbers: nested.zadarma?.phoneNumbers || raw.zadarmaPhoneNumbers || []
    },
    manualSip: { ...emptyTelephonyConfig.manualSip, ...(nested.manualSip || {}) },
    genericSip: { ...emptyTelephonyConfig.genericSip, ...(nested.genericSip || {}) }
  };
}

export function zadarmaSignature(method: string, params: string, secret: string) {
  const md5 = crypto.createHash('md5').update(params).digest('hex');
  const hmacHex = crypto.createHmac('sha1', secret).update(`${method}${params}${md5}`).digest('hex');
  return Buffer.from(hmacHex, 'utf8').toString('base64');
}

export class ZadarmaProvider implements TelephonyProvider {
  readonly id = 'zadarma'; readonly displayName = 'Zadarma'; readonly implemented = true;
  constructor(private readonly value: ZadarmaConfig, private readonly dependencies: TelephonyProviderDependencies) {}

  private async request(endpoint: string, httpMethod: 'GET' | 'PUT' = 'GET', params: Record<string, string> = {}) {
    const rawKey = this.value.apiKey || ''; const rawSecret = this.value.apiSecret || '';
    const key = rawKey.trim(); const secret = rawSecret.trim();
    if (!key || !secret) throw new Error('Zadarma API Key и Secret обязательны');
    const paramsString = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
    const diagnostic = { endpoint, httpMethod, keySuffix: key.slice(-4), keyLength: key.length, secretLength: secret.length, keyHadWhitespace: rawKey !== key, secretHadWhitespace: rawSecret !== secret, keyHadLineBreak: /[\r\n]/.test(rawKey), secretHadLineBreak: /[\r\n]/.test(rawSecret) };
    this.dependencies.diagnostic('zadarma_api_request', diagnostic);
    const response = await fetch(`https://api.zadarma.com${endpoint}${httpMethod === 'GET' && paramsString ? `?${paramsString}` : ''}`, { method: httpMethod, headers: { Authorization: `${key}:${zadarmaSignature(endpoint, paramsString, secret)}`, ...(httpMethod === 'PUT' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: httpMethod === 'PUT' ? paramsString : undefined, signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => null) as { status?: string; message?: string; [key: string]: unknown } | null;
    this.dependencies.diagnostic('zadarma_api_response', { ...diagnostic, httpStatus: response.status, zadarmaStatus: payload?.status || null, zadarmaMessage: payload?.message || null });
    if (!response.ok || payload?.status !== 'success') throw new Error(`Zadarma ${response.status}: ${payload?.message || 'Unknown API error'}`);
    return payload;
  }

  async testConnection() { const [sipLines, phoneNumbers] = await Promise.all([this.listSipLines(), this.listPhoneNumbers()]); return { sipLines, phoneNumbers }; }
  async listSipLines() {
    const payload = await this.request('/v1/sip/') as { sips?: Array<{ id?: string | number; display_name?: string; lines?: number }> };
    return (payload.sips || []).map(line => ({ id: String(line.id || ''), displayName: line.display_name || String(line.id || ''), lines: Number(line.lines || 0) })).filter(line => line.id);
  }
  async listPhoneNumbers() {
    const payload = await this.request('/v1/direct_numbers/') as { info?: Array<{ number?: string | number; description?: string; country?: string; number_name?: string }> };
    return (Array.isArray(payload.info) ? payload.info : []).map(item => { const digits = String(item.number || '').trim(); return { number: digits && !digits.startsWith('+') ? `+${digits}` : digits, name: String(item.description || item.number_name || item.country || 'Phone Number').trim() }; }).filter(item => item.number);
  }
  getSelectedNumber() { return this.value.phoneNumbers.find(item => item.number === this.value.selectedNumber) || (this.value.selectedNumber ? { number: this.value.selectedNumber, name: this.value.selectedNumber } : undefined); }
  async setCallerId() {
    if (!this.value.sipLine) throw new Error('Select a SIP Line first');
    if (!this.value.selectedNumber) throw new Error('Select Caller ID / Phone Number');
    if (this.value.phoneNumbers.length && !this.value.phoneNumbers.some(item => item.number === this.value.selectedNumber)) throw new Error('Selected Caller ID is no longer available in Zadarma');
    await this.request('/v1/sip/callerid/', 'PUT', { id: this.value.sipLine, number: this.value.selectedNumber.replace(/^\+/, '') });
  }
  getSipCredentials() { return { username: this.value.sipLine, password: this.value.sipPassword, sipDomain: 'sip.zadarma.com' }; }
  provisionForVapi(validateExisting = false) { return this.dependencies.provisionForVapi(this, validateExisting); }
  validateConfiguration() {
    if (!this.value.apiKey.trim() || !this.value.apiSecret.trim()) throw new Error('Zadarma API Key и Secret обязательны');
    if (!this.value.sipLine || !this.value.sipPassword) throw new Error('Выберите SIP-линию и укажите SIP Password');
    if (!this.value.selectedNumber) throw new Error('Выберите Caller ID / Phone Number');
  }
}

export class GenericSipProvider implements TelephonyProvider {
  readonly id = 'genericSip'; readonly displayName: string; readonly implemented = false;
  constructor(private readonly value: GenericSipConfig) { this.displayName = value.displayName || 'Generic SIP'; }
  private unavailable(): never { throw new Error('Generic SIP provider is not implemented yet'); }
  async testConnection(): Promise<{ sipLines: SipLine[]; phoneNumbers: PhoneNumber[] }> { return this.unavailable(); }
  async listPhoneNumbers(): Promise<PhoneNumber[]> { return this.unavailable(); }
  async listSipLines(): Promise<SipLine[]> { return this.unavailable(); }
  getSelectedNumber() { return this.value.phoneNumber ? { number: this.value.phoneNumber, name: this.value.displayName || this.value.phoneNumber } : undefined; }
  async setCallerId() { this.unavailable(); }
  getSipCredentials() { return { username: this.value.username, password: this.value.password, sipDomain: this.value.sipDomain || this.value.sipUri, outboundProxy: this.value.outboundProxy || undefined }; }
  async provisionForVapi() { this.unavailable(); }
  validateConfiguration() { this.unavailable(); }
}

export class ManualSipProvider implements TelephonyProvider {
  readonly id = 'manualSip'; readonly displayName = 'Manual SIP'; readonly implemented = true;
  constructor(private readonly value: ManualSipConfig, private readonly dependencies: TelephonyProviderDependencies) {}
  private normalizedHost() { return this.value.sipHost.trim().replace(/^sips?:\/\//i, '').replace(/\/$/, ''); }
  async testConnection() { this.validateConfiguration(); return { sipLines: await this.listSipLines(), phoneNumbers: await this.listPhoneNumbers() }; }
  async listPhoneNumbers() { return this.value.callerId.trim() ? [{ number: this.value.callerId.trim(), name: 'Manual Caller ID' }] : []; }
  async listSipLines() { return this.value.username.trim() ? [{ id: this.value.username.trim(), displayName: this.value.username.trim(), lines: 1 }] : []; }
  getSelectedNumber() { const number = this.value.callerId.trim(); return number ? { number, name: 'Manual Caller ID' } : undefined; }
  async setCallerId() { this.validateConfiguration(); }
  getSipCredentials() { return { username: this.value.username.trim(), password: this.value.password, sipDomain: this.normalizedHost() }; }
  provisionForVapi(validateExisting = false) { return this.dependencies.provisionForVapi(this, validateExisting); }
  validateConfiguration() {
    if (!this.normalizedHost()) throw new Error('SIP Host is required');
    if (!this.value.username.trim()) throw new Error('SIP Username is required');
    if (!this.value.password) throw new Error('SIP Password is required');
    if (!this.value.callerId.trim()) throw new Error('Caller ID is required');
  }
}

export class TelephonyProviderFactory {
  static create(provider: TelephonyProviderId, config: TelephonyConfig, dependencies: TelephonyProviderDependencies): TelephonyProvider {
    if (provider === 'zadarma') return new ZadarmaProvider(config.zadarma, dependencies);
    if (provider === 'manualSip') return new ManualSipProvider(config.manualSip, dependencies);
    if (provider === 'genericSip') return new GenericSipProvider(config.genericSip);
    throw new Error(`Unsupported telephony provider: ${String(provider)}`);
  }
}
