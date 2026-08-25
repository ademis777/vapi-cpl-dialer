import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Papa from 'papaparse';

export type HistoryCampaign = { campaignId?: string; campaignName: string; createdAt?: string; startedAt?: string; finishedAt?: string; assistantId?: string; contacts: any[] };
export type HistorySummary = { campaignId: string; campaignName: string; createdAt: string; startedAt: string; finishedAt: string; contactCount: number; assistantId: string; configVersion: string; hot: number; warm: number; callback: number; dnc: number; noAnswer: number; voicemail: number; failed: number };

function atomic(file: string, value: unknown) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp=`${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value,null,2)); fs.renameSync(tmp,file); }
function read<T>(file: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
const cleanId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');

export function historyRecord(contact: any) {
  const result = contact.normalizedResult || {};
  const callback = String(result.callbackAt || ''); const split = callback.includes('T') ? callback.split('T') : [callback, ''];
  return { recordId: contact.currentAttemptId || contact.callId || contact.id, contactId: contact.id, attemptNumber: contact.attemptNumber || 1, isTest: Boolean(contact.isTest), company: contact.company || '', phone: contact.phone || '', contactName: contact.contactName || '', city: contact.city || '', state: contact.state || '', zip: contact.zipCode || '', status: contact.status || '', businessOutcome: result.businessOutcome || '', operationalOutcome: result.operationalOutcome || '', lead: contact.lead || '', decisionMaker: result.decisionMakerReached ?? contact.leadIntelligence?.decisionMaker ?? '', summary: result.summary || contact.summary || '', nextAction: result.nextAction || '', callbackDate: split[0] || '', callbackTime: split[1] || '', callbackTimezone: result.callbackTimezone || '', preferredContact: result.preferredContactMethod || '', email: result.email || '', mobilePhone: result.mobilePhone || '', demoUrl: contact.demoUrl || '', objection: result.objection || '', dnc: Boolean(result.doNotContact), callId: contact.callId || '', endedReason: contact.endedReason || '', recordingUrl: contact.recordingUrl || '', analysisSource: contact.analysisSource || '', createdAt: contact.callCreatedAt || '', startedAt: contact.callStartedAt || '', endedAt: contact.callEndedAt || '' };
}

export class CampaignHistoryStore {
  private readonly recordCache = new Map<string, Map<string, any>>();
  constructor(private readonly dir: string) { fs.mkdirSync(path.join(dir,'campaigns'),{recursive:true}); }
  private catalogFile(){return path.join(this.dir,'catalog.json');}
  private resultsFile(id:string){return path.join(this.dir,'campaigns',`${cleanId(id)}.ndjson`);}
  list(){return read<HistorySummary[]>(this.catalogFile(),[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  ensure(campaign: HistoryCampaign, assistantId = '', configVersion='phase-1.5') {
    if (!campaign.campaignId) campaign.campaignId = crypto.randomUUID();
    if (!campaign.createdAt) campaign.createdAt = new Date().toISOString();
    const catalog=this.list(); let item=catalog.find(x=>x.campaignId===campaign.campaignId);
    if(!item){item={campaignId:campaign.campaignId,campaignName:campaign.campaignName||'Untitled Campaign',createdAt:campaign.createdAt,startedAt:campaign.startedAt||'',finishedAt:campaign.finishedAt||'',contactCount:0,assistantId,configVersion,hot:0,warm:0,callback:0,dnc:0,noAnswer:0,voicemail:0,failed:0};catalog.push(item);atomic(this.catalogFile(),catalog);}
    return campaign.campaignId;
  }
  append(campaign: HistoryCampaign, contacts: any[], assistantId='') { const id=this.ensure(campaign,assistantId); if(!contacts.length)return; const records=contacts.map(historyRecord); const lines=records.map(record=>JSON.stringify({at:new Date().toISOString(),record})).join('\n')+'\n'; fs.appendFileSync(this.resultsFile(id),lines,'utf8'); const cache=this.recordMap(id); for(const record of records)if(record.recordId||record.contactId)cache.set(record.recordId||record.contactId,record); this.refresh(campaign,assistantId); }
  initialize(campaign: HistoryCampaign, assistantId='') { const id=this.ensure(campaign,assistantId); const file=this.resultsFile(id); if(!fs.existsSync(file)||fs.statSync(file).size===0)this.append(campaign,campaign.contacts,assistantId); else this.refresh(campaign,assistantId); }
  private recordMap(id:string){const existing=this.recordCache.get(id);if(existing)return existing;const latest=new Map<string,any>();try{for(const line of fs.readFileSync(this.resultsFile(id),'utf8').split(/\r?\n/)){if(!line.trim())continue;try{const event=JSON.parse(line);const record=event.record;if(record?.recordId||record?.contactId)latest.set(record.recordId||record.contactId,record);}catch{/* ignore a partial final append */}}}catch{}this.recordCache.set(id,latest);return latest;}
  records(id:string){return [...this.recordMap(id).values()];}
  findContact(contactId:string){for(const campaign of this.list()){const matches=this.records(campaign.campaignId).filter(record=>record.contactId===contactId);if(matches.length)return matches[matches.length-1];}return undefined;}
  refresh(campaign:HistoryCampaign,assistantId=''){const catalog=this.list(),item=catalog.find(x=>x.campaignId===campaign.campaignId);if(!item)return;const records=this.records(item.campaignId);Object.assign(item,{campaignName:campaign.campaignName||item.campaignName,startedAt:campaign.startedAt||item.startedAt,finishedAt:campaign.finishedAt||item.finishedAt,contactCount:records.length,assistantId:assistantId||item.assistantId,hot:records.filter(x=>x.businessOutcome==='HOT').length,warm:records.filter(x=>x.businessOutcome==='WARM').length,callback:records.filter(x=>x.businessOutcome==='CALLBACK').length,dnc:records.filter(x=>x.businessOutcome==='DNC'||x.dnc).length,noAnswer:records.filter(x=>x.operationalOutcome==='NO_ANSWER'||x.status==='No Answer').length,voicemail:records.filter(x=>x.operationalOutcome==='VOICEMAIL'||x.status==='Voicemail').length,failed:records.filter(x=>x.operationalOutcome==='TECHNICAL_ERROR'||x.status==='Failed').length});atomic(this.catalogFile(),catalog);}
  finish(campaign:HistoryCampaign,assistantId=''){campaign.finishedAt=campaign.finishedAt||new Date().toISOString();this.append(campaign,campaign.contacts,assistantId);this.refresh(campaign,assistantId);}
  removeCampaign(campaignId: string) {
    const id = cleanId(campaignId);
    if (!id) return { removedCampaigns: 0, removedResults: 0 };
    const catalog = this.list();
    const removedResults = this.records(id).length;
    const kept = catalog.filter(item => item.campaignId !== id);
    if (kept.length === catalog.length && !fs.existsSync(this.resultsFile(id))) return { removedCampaigns: 0, removedResults: 0 };
    atomic(this.catalogFile(), kept);
    try { fs.unlinkSync(this.resultsFile(id)); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
    this.recordCache.delete(id);
    return { removedCampaigns: catalog.length - kept.length, removedResults };
  }
  page(id:string,offset=0,limit=200){const records=this.records(id);return{total:records.length,offset,limit,items:records.slice(offset,offset+limit)};}
  clearTestData() {
    const catalog = this.list(); let removedCampaigns = 0, removedResults = 0;
    const kept: HistorySummary[] = [];
    for (const item of catalog) {
      const testCampaign = /(^|[\s_-])test([\s_-]|$)/i.test(item.campaignName || '');
      if (testCampaign) { removedResults += this.records(item.campaignId).length; try { fs.unlinkSync(this.resultsFile(item.campaignId)); } catch {} this.recordCache.delete(item.campaignId); removedCampaigns++; continue; }
      const records = this.records(item.campaignId), retained = records.filter(record => !record.isTest);
      removedResults += records.length - retained.length;
      if (retained.length !== records.length) { const lines=retained.map(record=>JSON.stringify({at:new Date().toISOString(),record})).join('\n'); fs.writeFileSync(this.resultsFile(item.campaignId),lines+(lines?'\n':''),'utf8'); this.recordCache.delete(item.campaignId); item.contactCount=retained.length; }
      kept.push(item);
    }
    atomic(this.catalogFile(), kept); return { removedCampaigns, removedResults };
  }
  csv(id:string){const meta=this.list().find(x=>x.campaignId===id);if(!meta)throw new Error('Historical campaign not found');const rows=this.records(id).map(r=>({'Campaign ID':id,'Campaign':meta.campaignName,'Company':r.company,'Phone':r.phone,'Contact Name':r.contactName,'City':r.city,'State':r.state,'ZIP':r.zip,'Status':r.status,'Business Outcome':r.businessOutcome,'Operational Outcome':r.operationalOutcome,'Lead':r.lead,'Decision Maker':r.decisionMaker,'Summary':r.summary,'Next Action':r.nextAction,'Callback Date':r.callbackDate,'Callback Time':r.callbackTime,'Callback Timezone':r.callbackTimezone,'Preferred Contact':r.preferredContact,'Email':r.email,'Mobile Phone':r.mobilePhone,'Demo URL':r.demoUrl,'Objection':r.objection,'DNC':r.dnc?'Yes':'No','Call ID':r.callId,'Ended Reason':r.endedReason,'Recording URL':r.recordingUrl,'Analysis Source':r.analysisSource,'Created At':r.createdAt,'Started At':r.startedAt,'Ended At':r.endedAt}));return '\uFEFF'+Papa.unparse(rows);}
}
