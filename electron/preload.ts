import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dmnt', {
  load: () => ipcRenderer.invoke('load'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('save-config', config),
  importCsv: () => ipcRenderer.invoke('import-csv'),
  saveCampaign: (campaign: unknown) => ipcRenderer.invoke('save-campaign', campaign),
  control: (action: 'start' | 'pause' | 'resume' | 'stop') => ipcRenderer.invoke('control', action),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  testVapi: (config: unknown) => ipcRenderer.invoke('test-vapi', config),
  testTelephony: (config: unknown) => ipcRenderer.invoke('test-telephony', config),
  testZadarma: (config: unknown) => ipcRenderer.invoke('test-zadarma', config),
  refreshZadarmaNumbers: (config: unknown) => ipcRenderer.invoke('refresh-zadarma-numbers', config),
  selectZadarmaSip: (config: unknown) => ipcRenderer.invoke('select-zadarma-sip', config),
  selectZadarmaNumber: (config: unknown) => ipcRenderer.invoke('select-zadarma-number', config),
  testTelegram: (config: unknown) => ipcRenderer.invoke('test-telegram', config),
  exportCsv: () => ipcRenderer.invoke('export-csv'),
  exportNoAnswer: () => ipcRenderer.invoke('export-no-answer'),
  listCampaigns: () => ipcRenderer.invoke('list-campaigns'),
  saveCampaignProfile: (profile: unknown) => ipcRenderer.invoke('save-campaign-profile', profile),
  loadCampaignProfile: (name: string) => ipcRenderer.invoke('load-campaign-profile', name),
  retryFailed: () => ipcRenderer.invoke('retry-failed'),
  openRecording: (url: string) => ipcRenderer.invoke('open-recording', url),
  onUpdate: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('state-update', listener);
    return () => ipcRenderer.removeListener('state-update', listener);
  }
});
