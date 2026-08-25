import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const initialConfig: Config = { vapiApiKey: '', vapiAssistantId: '', vapiAssistants: [], vapiVoiceOverrideEnabled: false, vapiVoiceProvider: '', vapiVoiceId: '', telephony: { provider: 'zadarma', zadarma: { apiKey: '', apiSecret: '', sipLine: '', sipPassword: '', selectedNumber: '', sipLines: [], phoneNumbers: [] }, manualSip: { sipHost: '', username: '', password: '', callerId: '' }, genericSip: { displayName: '', sipUri: '', sipDomain: '', username: '', password: '', outboundProxy: '', callerId: '', phoneNumber: '' } }, telegramBotToken: '', telegramChatId: '', testMode: false };
const initialCampaign: Campaign = { contacts: [], campaignName: '', systemPrompt: '', assistantId: '', voice: 'Elliot', phoneNumber: '', hotLeadRules: '', state: 'idle', hotCount: 0, initialSilenceTimeoutSeconds: 20, conversationSilenceTimeoutSeconds: 30, goodbyeTimeoutSeconds: 3, maximumCallDurationSeconds: 300 };

function formatDuration(seconds = 0) { const value = Math.max(0, Math.floor(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }

function IntelligenceList({ items }: { items: string[] }) {
  return items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <span className="unknown">Unknown</span>;
}

function LeadIntelligenceCard({ intelligence }: { intelligence: LeadIntelligence }) {
  return <div className="intelligenceCard">
    <div className="intelligenceTop"><span className={`lead ${intelligence.lead.toLowerCase()}`}>{intelligence.lead}</span><span><b>Interest</b>{intelligence.interestLevel}</span></div>
    <div><b>Current Situation</b><IntelligenceList items={intelligence.currentSituation} /></div>
    <div><b>Pain Points</b><IntelligenceList items={intelligence.painPoints} /></div>
    <div><b>Questions</b><IntelligenceList items={intelligence.questionsAsked} /></div>
    <div><b>Objections</b><IntelligenceList items={intelligence.objections} /></div>
    <div><b>Next Step</b><span>{intelligence.nextStep}</span></div>
    <div><b>Recommendation</b><span>{intelligence.followUpRecommendation}</span></div>
    <div className="customerSummary"><b>Customer Summary</b><IntelligenceList items={intelligence.customerSummary} /></div>
  </div>;
}

function App() {
  const [config, setConfig] = useState(initialConfig);
  const [campaign, setCampaign] = useState(initialCampaign);
  const [message, setMessage] = useState('');
  const [campaignNames, setCampaignNames] = useState<string[]>([]);
  const [filter, setFilter] = useState('All');
  const [logs, setLogs] = useState<CampaignLogEntry[]>([]);
  const [advancedAssistant, setAdvancedAssistant] = useState(false);
  const [advancedVoice, setAdvancedVoice] = useState(false);
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dmnt.load().then(s => { setConfig(s.config); setCampaign(s.campaign); setLogs(s.logs); }).catch(error => setMessage(String(error)));
    window.dmnt.listCampaigns().then(setCampaignNames).catch(error => setMessage(String(error)));
    return window.dmnt.onUpdate(s => { setConfig(s.config); setCampaign(s.campaign); setLogs(s.logs); });
  }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = 0; }, [logs]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const updateConfig = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(v => ({ ...v, [key]: value }));
  const updateZadarma = (key: keyof ZadarmaConfig, value: string) => setConfig(v => ({ ...v, telephony: { ...v.telephony, zadarma: { ...v.telephony.zadarma, [key]: value } } }));
  const updateManualSip = (key: keyof ManualSipConfig, value: string) => setConfig(v => ({ ...v, telephony: { ...v.telephony, manualSip: { ...v.telephony.manualSip, [key]: value } } }));
  const updateGenericSip = (key: keyof GenericSipConfig, value: string) => setConfig(v => ({ ...v, telephony: { ...v.telephony, genericSip: { ...v.telephony.genericSip, [key]: value } } }));
  const selectTelephonyProvider = async (provider: TelephonyConfig['provider']) => { const next = { ...config, telephony: { ...config.telephony, provider } }; setConfig(next); try { await window.dmnt.saveConfig(next); setMessage(`Telephony provider selected: ${provider === 'zadarma' ? 'Auto Zadarma' : provider === 'manualSip' ? 'Manual SIP' : 'Generic SIP (Coming Soon)'}`); } catch (error) { setMessage(String(error)); } };
  const updateCampaign = <K extends keyof Campaign>(key: K, value: Campaign[K]) => setCampaign(v => ({ ...v, [key]: value }));
  const saveConfig = async () => { try { await window.dmnt.saveConfig(config); setMessage('Настройки сохранены'); } catch (error) { setMessage(String(error)); } };
  const saveCampaign = () => window.dmnt.saveCampaign({ campaignName: campaign.campaignName, systemPrompt: campaign.systemPrompt, assistantId: campaign.assistantId, voice: campaign.voice, hotLeadRules: campaign.hotLeadRules, initialSilenceTimeoutSeconds: campaign.initialSilenceTimeoutSeconds, conversationSilenceTimeoutSeconds: campaign.conversationSilenceTimeoutSeconds, goodbyeTimeoutSeconds: campaign.goodbyeTimeoutSeconds, maximumCallDurationSeconds: campaign.maximumCallDurationSeconds });
  const saveCampaignSafely = () => { void saveCampaign().catch(error => setMessage(String(error))); };
  const selectAssistant = async (assistantId: string) => {
    const nextConfig = { ...config, vapiAssistantId: assistantId };
    setConfig(nextConfig); setCampaign(current => ({ ...current, assistantId }));
    try { await window.dmnt.saveConfig(nextConfig); await window.dmnt.saveCampaign({ assistantId }); }
    catch (error) { setMessage(String(error)); }
  };
  const saveVoiceOverride = async (changes: Partial<Pick<Config, 'vapiVoiceOverrideEnabled' | 'vapiVoiceProvider' | 'vapiVoiceId'>>) => {
    const nextConfig = { ...config, ...changes }; setConfig(nextConfig);
    try { await window.dmnt.saveConfig(nextConfig); } catch (error) { setMessage(String(error)); }
  };
  const control = async (action: 'start' | 'pause' | 'resume' | 'stop') => { try { await saveCampaign(); await window.dmnt.control(action); setMessage(''); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } };
  const profile = (): CampaignProfile => ({ campaignName: campaign.campaignName, systemPrompt: campaign.systemPrompt, assistantId: campaign.assistantId, voiceId: campaign.voice, hotLeadRules: campaign.hotLeadRules, initialSilenceTimeoutSeconds: campaign.initialSilenceTimeoutSeconds, conversationSilenceTimeoutSeconds: campaign.conversationSilenceTimeoutSeconds, goodbyeTimeoutSeconds: campaign.goodbyeTimeoutSeconds, maximumCallDurationSeconds: campaign.maximumCallDurationSeconds });
  const loadProfile = async (name: string) => { try { const loaded = await window.dmnt.loadCampaignProfile(name); setCampaign(loaded); setMessage(`Кампания загружена: ${loaded.campaignName}`); } catch (error) { setMessage(`Ошибка загрузки кампании: ${String(error)}`); } };
  const stats = {
    Total: campaign.contacts.length,
    Waiting: campaign.contacts.filter(c => c.status === 'Waiting').length,
    Calling: campaign.contacts.filter(c => c.status === 'Calling').length,
    Completed: campaign.contacts.filter(c => c.status === 'Completed').length,
    IVR: campaign.contacts.filter(c => c.status === 'IVR').length,
    Hot: campaign.contacts.filter(c => c.lead === 'Hot').length,
    Warm: campaign.contacts.filter(c => c.lead === 'Warm').length,
    Cold: campaign.contacts.filter(c => c.lead === 'Cold').length,
    'No Answer': campaign.contacts.filter(c => c.status === 'No Answer').length,
    Failed: campaign.contacts.filter(c => c.status === 'Failed').length
  };
  const visibleContacts = campaign.contacts.filter(contact => filter === 'All' || (['Hot', 'Warm', 'Cold'].includes(filter) ? contact.lead === filter : contact.status === filter));
  const selectedAssistant = config.vapiAssistants.find(item => item.id === (campaign.assistantId || config.vapiAssistantId));

  if (new URLSearchParams(window.location.search).get('settings') === '1') return <main className="settingsPage">
    <header><div><h1>Settings</h1><p>Integrations and connection tests</p></div></header>
    <div className="panel settingsPanel">
      <h2>Vapi</h2>
      <label>Vapi API Key<input type="password" value={config.vapiApiKey} onChange={e => updateConfig('vapiApiKey', e.target.value)} /></label>
      <button className="upload" onClick={async () => { try { setMessage('Проверка Vapi...'); const result = await window.dmnt.testVapi(config); setMessage(result.messages.join('\n')); } catch (error) { setMessage(String(error)); } }}>Test Vapi</button>
      <div className="divider" />
      <h2>Telephony</h2>
      <label>Telephony Mode<select value={config.telephony.provider} onChange={e => void selectTelephonyProvider(e.target.value as TelephonyConfig['provider'])}><option value="zadarma">Auto Zadarma</option><option value="manualSip">Manual SIP</option><option value="genericSip">Generic SIP (Coming Soon)</option></select></label>
      {config.telephony.provider === 'zadarma' ? <div className="providerFields"><label>Zadarma Key<input value={config.telephony.zadarma.apiKey} onChange={e => updateZadarma('apiKey', e.target.value)} /></label><label>Zadarma Secret<input type="password" value={config.telephony.zadarma.apiSecret} onChange={e => updateZadarma('apiSecret', e.target.value)} /></label><label>SIP Password<input type="password" value={config.telephony.zadarma.sipPassword} onChange={e => updateZadarma('sipPassword', e.target.value)} placeholder="Password выбранной SIP-линии" /></label><button className="upload" onClick={async () => { try { setMessage('Проверка Zadarma...'); const result = await window.dmnt.testZadarma(config); setConfig(current => ({ ...current, telephony: { ...current.telephony, zadarma: { ...current.telephony.zadarma, sipLines: result.lines, sipLine: result.selected, phoneNumbers: result.numbers, selectedNumber: result.selectedNumber } } })); setMessage(result.message); } catch (error) { setMessage(`❌ Zadarma: ${String(error)}`); } }}>Test Zadarma</button>{config.telephony.zadarma.sipLines.length > 0 && <label className="sipSelect">SIP Line<select value={config.telephony.zadarma.sipLine} onChange={async e => { const next = { ...config, telephony: { ...config.telephony, zadarma: { ...config.telephony.zadarma, sipLine: e.target.value } } }; setConfig(next); try { setMessage('Подключение SIP...'); const result = await window.dmnt.selectZadarmaSip(next); setMessage(result.message); } catch (error) { setMessage(`❌ SIP: ${String(error)}`); } }}>{config.telephony.zadarma.sipLines.map(line => <option key={line.id} value={line.id}>{line.displayName} — {line.id} ({line.lines} lines)</option>)}</select></label>}<div className="fieldHeader"><span>Caller ID / Phone Number</span><button onClick={async () => { try { setMessage('Refreshing Zadarma numbers...'); const result = await window.dmnt.refreshZadarmaNumbers(config); setConfig(current => ({ ...current, telephony: { ...current.telephony, zadarma: { ...current.telephony.zadarma, phoneNumbers: result.numbers, selectedNumber: result.selected } } })); setMessage(result.message); } catch (error) { setMessage(`❌ Numbers: ${String(error)}`); } }}>Refresh Numbers</button></div>{config.telephony.zadarma.phoneNumbers.length > 0 ? <label><select value={config.telephony.zadarma.selectedNumber} onChange={async e => { const next = { ...config, telephony: { ...config.telephony, zadarma: { ...config.telephony.zadarma, selectedNumber: e.target.value } } }; setConfig(next); try { const result = await window.dmnt.selectZadarmaNumber(next); setMessage(result.message); } catch (error) { setMessage(`❌ Caller ID: ${String(error)}`); } }}><option value="">Select phone number...</option>{config.telephony.zadarma.phoneNumbers.map(item => <option key={item.number} value={item.number}>{item.name} — {item.number}</option>)}</select></label> : <div className="emptyChoice">No phone numbers loaded. Click Refresh Numbers.</div>}</div> : config.telephony.provider === 'manualSip' ? <div className="providerFields"><div className="comingSoon manualReady">Manual SIP uses these values directly for Vapi BYO SIP. Zadarma API is not called.</div><label>SIP Host<input value={config.telephony.manualSip.sipHost} onChange={e => updateManualSip('sipHost', e.target.value)} placeholder="sip.provider.com" /></label><label>Username<input value={config.telephony.manualSip.username} onChange={e => updateManualSip('username', e.target.value)} /></label><label>Password<input type="password" value={config.telephony.manualSip.password} onChange={e => updateManualSip('password', e.target.value)} /></label><label>Caller ID<input value={config.telephony.manualSip.callerId} onChange={e => updateManualSip('callerId', e.target.value)} placeholder="+12125550123" /></label><button className="upload" onClick={async () => { try { setMessage('Testing Manual SIP configuration...'); const result = await window.dmnt.testTelephony(config); setMessage(result.message); } catch (error) { setMessage(`❌ Manual SIP: ${String(error)}`); } }}>Test Manual SIP</button></div> : <div className="providerFields genericSip"><div className="comingSoon">Generic SIP provider is not implemented yet. Campaign Start and Resume are disabled by validation.</div><label>Display Name<input value={config.telephony.genericSip.displayName} onChange={e => updateGenericSip('displayName', e.target.value)} /></label><label>SIP URI<input value={config.telephony.genericSip.sipUri} onChange={e => updateGenericSip('sipUri', e.target.value)} /></label><label>SIP Domain<input value={config.telephony.genericSip.sipDomain} onChange={e => updateGenericSip('sipDomain', e.target.value)} /></label><label>Username<input value={config.telephony.genericSip.username} onChange={e => updateGenericSip('username', e.target.value)} /></label><label>Password<input type="password" value={config.telephony.genericSip.password} onChange={e => updateGenericSip('password', e.target.value)} /></label><label>Outbound Proxy (optional)<input value={config.telephony.genericSip.outboundProxy} onChange={e => updateGenericSip('outboundProxy', e.target.value)} /></label><label>Caller ID<input value={config.telephony.genericSip.callerId} onChange={e => updateGenericSip('callerId', e.target.value)} /></label><label>Phone Number<input value={config.telephony.genericSip.phoneNumber} onChange={e => updateGenericSip('phoneNumber', e.target.value)} /></label></div>}
      <div className="divider" />
      <h2>Telegram</h2>
      <label>Telegram Bot Token<input type="password" value={config.telegramBotToken} onChange={e => updateConfig('telegramBotToken', e.target.value)} /></label>
      <label>Telegram Chat ID<input value={config.telegramChatId} onChange={e => updateConfig('telegramChatId', e.target.value)} /></label>
      <label className="testModeToggle"><span><input type="checkbox" checked={config.testMode} onChange={e => updateConfig('testMode', e.target.checked)} />Test Mode</span><small>Send Telegram notification after every completed call</small></label>
      <button className="upload" onClick={async () => { try { setMessage('Отправка сообщения...'); const result = await window.dmnt.testTelegram(config); setMessage(result.message); } catch (error) { setMessage(String(error)); } }}>Send Test Message</button>
      {message && <div className="message multiline">{message}</div>}
      <button className="primary settingsSave" onClick={saveConfig}>Save Settings</button>
    </div>
  </main>;

  return <main>
    <header><div><h1>DMNT Dialer</h1><p>AI company calling MVP</p></div><div className="headerActions"><button className="settingsButton" onClick={() => { void window.dmnt.openSettings().catch(error => setMessage(String(error))); }}>Settings</button><div className={`state ${campaign.state}`}>{campaign.state}</div></div></header>
    <section className="layout">
      <div className="panel left">
        <h2>Campaign</h2>
        <label>Campaign<select value={campaignNames.includes(campaign.campaignName) ? campaign.campaignName : ''} onChange={e => { if (e.target.value) void loadProfile(e.target.value); }}><option value="">Select campaign...</option>{campaignNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>Campaign Name<input value={campaign.campaignName} onChange={e => updateCampaign('campaignName', e.target.value)} placeholder="Roofing USA" /></label>
        <div className="profileButtons"><button onClick={async () => { try { const name = await window.dmnt.saveCampaignProfile(profile()); setCampaignNames(await window.dmnt.listCampaigns()); setMessage(`Кампания сохранена: ${name}`); } catch (error) { setMessage(`Ошибка сохранения кампании: ${String(error)}`); } }}>Save Campaign</button><button disabled={!campaign.campaignName} onClick={() => loadProfile(campaign.campaignName)}>Load Campaign</button></div>
        <div className="divider" />
        <button className="upload" onClick={async () => { try { const count = await window.dmnt.importCsv(); if (count !== null) setMessage(`Загружено контактов: ${count}`); } catch (error) { setMessage(String(error)); } }}>Upload CSV</button>
        <div className="counter"><strong>{campaign.contacts.length}</strong><span>contacts loaded</span></div>
        <label className="prompt">System Prompt<textarea value={campaign.systemPrompt} onChange={e => updateCampaign('systemPrompt', e.target.value)} onBlur={saveCampaignSafely} placeholder="Опишите роль ассистента, цель звонка и критерии Hot / Warm / Cold..." /></label>
        {config.vapiAssistants.length > 0 ? <label>Assistant<select value={campaign.assistantId || config.vapiAssistantId} onChange={e => void selectAssistant(e.target.value)} title={campaign.assistantId || config.vapiAssistantId}><option value="">Select Assistant...</option>{config.vapiAssistants.map(assistant => <option key={assistant.id} value={assistant.id} title={assistant.id}>{assistant.name}</option>)}</select>{(campaign.assistantId || config.vapiAssistantId) && <small className="assistantId">ID: {campaign.assistantId || config.vapiAssistantId}</small>}</label> : <div className="assistantAdvanced"><button onClick={() => setAdvancedAssistant(value => !value)}>Advanced</button>{advancedAssistant && <label>Assistant ID<input value={campaign.assistantId || config.vapiAssistantId} onChange={e => { updateCampaign('assistantId', e.target.value); updateConfig('vapiAssistantId', e.target.value); }} onBlur={() => void selectAssistant(campaign.assistantId || config.vapiAssistantId)} placeholder="Optional Vapi Assistant ID" /></label>}</div>}
        <label>Hot Lead Rules<textarea className="rules" value={campaign.hotLeadRules} onChange={e => updateCampaign('hotLeadRules', e.target.value)} onBlur={saveCampaignSafely} placeholder="Критерии Hot lead..." /></label>
        <div className="timeoutSettings"><h3>Call limits (seconds)</h3><label>Initial silence timeout<input type="number" min="5" value={campaign.initialSilenceTimeoutSeconds} onChange={e => updateCampaign('initialSilenceTimeoutSeconds', Number(e.target.value))} onBlur={saveCampaignSafely} /></label><label>Conversation silence timeout<input type="number" min="5" value={campaign.conversationSilenceTimeoutSeconds} onChange={e => updateCampaign('conversationSilenceTimeoutSeconds', Number(e.target.value))} onBlur={saveCampaignSafely} /></label><label>Goodbye timeout<input type="number" min="1" value={campaign.goodbyeTimeoutSeconds} onChange={e => updateCampaign('goodbyeTimeoutSeconds', Number(e.target.value))} onBlur={saveCampaignSafely} /></label><label>Maximum Call Duration<input type="number" min="10" value={campaign.maximumCallDurationSeconds} onChange={e => updateCampaign('maximumCallDurationSeconds', Number(e.target.value))} onBlur={saveCampaignSafely} /></label></div>
      </div>
      <div className="content">
        <div className="panel controls">
          <div className="voiceControl"><div className="fieldHeader"><span>Assistant Voice</span><button onClick={() => setAdvancedVoice(value => !value)}>Advanced</button></div><div className="voiceReadOnly"><strong>{selectedAssistant?.voice?.name || selectedAssistant?.voice?.voiceId || 'Not configured'}</strong><span>Provider: {selectedAssistant?.voice?.provider || '—'}</span><span>Voice ID: {selectedAssistant?.voice?.voiceId || '—'}</span>{selectedAssistant?.voice?.model && <span>Model: {selectedAssistant.voice.model}</span>}</div><small className="voiceHint">Voice comes from the selected Vapi Assistant. Change it in the Assistant configuration, or enable an explicit call override below.</small>{advancedVoice && <div className="voiceAdvanced"><label className="overrideToggle"><input type="checkbox" checked={config.vapiVoiceOverrideEnabled} onChange={e => void saveVoiceOverride({ vapiVoiceOverrideEnabled: e.target.checked })} />Override Assistant voice for calls</label><label>Provider<input value={config.vapiVoiceProvider} onChange={e => updateConfig('vapiVoiceProvider', e.target.value)} onBlur={() => void saveVoiceOverride({ vapiVoiceProvider: config.vapiVoiceProvider })} placeholder="vapi, 11labs, openai..." /></label><label>Voice ID<input value={config.vapiVoiceId} onChange={e => updateConfig('vapiVoiceId', e.target.value)} onBlur={() => void saveVoiceOverride({ vapiVoiceId: config.vapiVoiceId })} placeholder="Provider voiceId" /></label></div>}</div>
          <div className="buttons"><button className="start" disabled={config.telephony.provider === 'genericSip'} title={config.telephony.provider === 'genericSip' ? 'Generic SIP provider is not implemented yet' : undefined} onClick={() => control('start')}>Start</button><button onClick={() => control('pause')}>Pause</button><button className="resume" disabled={config.telephony.provider === 'genericSip'} title={config.telephony.provider === 'genericSip' ? 'Generic SIP provider is not implemented yet' : undefined} onClick={() => control('resume')}>Resume</button><button className="stop" onClick={() => control('stop')}>Stop</button><button onClick={async () => { try { const path = await window.dmnt.exportCsv(); if (path) setMessage(`CSV сохранён: ${path}`); } catch (error) { setMessage(`Ошибка экспорта: ${String(error)}`); } }}>Export CSV</button><button onClick={async () => { try { const path = await window.dmnt.exportNoAnswer(); setMessage(`No Answer CSV сохранён: ${path}`); } catch (error) { setMessage(`Ошибка экспорта No Answer: ${String(error)}`); } }}>Export No Answer</button></div>
          <div className="hot">Hot leads <strong>{campaign.hotCount} / 3</strong></div>
        </div>
        {message && <div className="message">{message}</div>}
        <div className="dashboard">{Object.entries(stats).map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <div className="tableTools"><label>Filter<select value={filter} onChange={e => setFilter(e.target.value)}>{['All','Hot','Warm','Cold','Completed','Failed','No Answer'].map(value => <option key={value}>{value}</option>)}</select></label><button onClick={async () => { try { const count = await window.dmnt.retryFailed(); setMessage(`Повторно поставлено в очередь: ${count}`); } catch (error) { setMessage(String(error)); } }}>Retry Failed</button></div>
        {campaign.contacts.filter(c => c.status === 'Calling').map(c => <div className="liveCallTiming" key={`timing-${c.id}`}><strong>{c.company}</strong><span>Live Duration: {formatDuration(c.callStartedAt ? (now - Date.parse(c.callStartedAt)) / 1000 : 0)}</span><span>Talk Time: {formatDuration(c.talkTimeSeconds)}</span></div>)}
        <div className="tableWrap"><table><thead><tr><th>Company</th><th>Phone</th><th>Status</th><th>Summary</th><th>Lead</th></tr></thead><tbody>
          {visibleContacts.length === 0 ? <tr><td colSpan={5} className="empty">{campaign.contacts.length ? 'No contacts match this filter' : 'Upload a CSV with Company and Phone columns'}</td></tr> : visibleContacts.map(c => <tr key={c.id}><td>{c.company}</td><td>{c.phone}</td><td><span className={`badge ${c.status.replace(' ','-').toLowerCase()}`}>{c.status}</span></td><td className="summary">{c.status === 'Calling' ? <span className="callProgress">{c.analysisState === 'waiting' ? 'Analyzing after call completion…' : 'Call in progress'}</span> : c.leadIntelligence ? <LeadIntelligenceCard intelligence={c.leadIntelligence} /> : (c.summary || '—')}{c.recordingUrl && <button className="recording" onClick={async () => { try { await window.dmnt.openRecording(c.recordingUrl!); } catch (error) { setMessage(`Ошибка открытия записи: ${String(error)}`); } }}>Open Recording</button>}</td><td><span className={`lead ${c.lead.toLowerCase()}`}>{c.lead || '—'}</span></td></tr>)}
        </tbody></table></div>
      </div>
    </section>
    <section className="campaignLog panel"><h2>Campaign Log</h2><div className="logList" ref={logRef}>{logs.length === 0 ? <div className="logEmpty">Campaign events will appear here</div> : logs.map((entry, index) => <div className={`logEntry ${entry.tone || 'info'}`} key={`${entry.at}-${index}`}><time>[{new Date(entry.at).toLocaleTimeString([], { hour12: false })}]</time><div><strong>{entry.message}</strong>{entry.details && <span>{entry.details}</span>}</div></div>)}</div></section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
