import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone } from './phone-normalization.js';

export type DncEntry = { normalizedPhone: string; originalPhone: string; createdAt: string; reason: string; sourceCallId: string; company: string };
export type PhoneIndexEntry = { normalizedPhone: string; originalPhone: string; firstSeenAt: string; lastSeenAt: string; company: string; contactId?: string };

type RegistryFiles = { dnc: string; index: string };

function readArray<T>(file: string): T[] { try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; } }
function writeAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

export class PersistentPhoneRegistry {
  constructor(private readonly files: RegistryFiles) {}
  listDnc() { return readArray<DncEntry>(this.files.dnc); }
  listIndex() { return readArray<PhoneIndexEntry>(this.files.index); }
  dncPhones() { return new Set(this.listDnc().map(item => item.normalizedPhone)); }
  indexedPhones() { return new Set(this.listIndex().map(item => item.normalizedPhone)); }
  isDnc(phone: unknown) { const normalized = normalizePhone(phone); return Boolean(normalized && this.listDnc().some(item => item.normalizedPhone === normalized)); }
  hasPhone(phone: unknown) { const normalized = normalizePhone(phone); return Boolean(normalized && this.listIndex().some(item => item.normalizedPhone === normalized)); }
  removePhone(phone: unknown) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) throw new Error('Cannot remove empty phone from deduplication');
    const entries = this.listIndex();
    const kept = entries.filter(item => item.normalizedPhone !== normalizedPhone);
    if (kept.length !== entries.length) writeAtomic(this.files.index, kept);
    return { normalizedPhone, removed: entries.length - kept.length };
  }
  removePhones(phones: unknown[]) {
    const normalizedPhones = new Set(phones.map(phone => normalizePhone(phone)).filter(Boolean));
    const entries = this.listIndex();
    const kept = entries.filter(item => !normalizedPhones.has(item.normalizedPhone));
    if (kept.length !== entries.length) writeAtomic(this.files.index, kept);
    return { requested: normalizedPhones.size, removed: entries.length - kept.length };
  }
  addDnc(input: { phone: string; reason: string; sourceCallId?: string; company?: string }) {
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone) throw new Error('Cannot add empty phone to DNC');
    const entries = this.listDnc();
    const existing = entries.find(item => item.normalizedPhone === normalizedPhone);
    if (existing) return existing;
    const entry: DncEntry = { normalizedPhone, originalPhone: input.phone, createdAt: new Date().toISOString(), reason: input.reason, sourceCallId: input.sourceCallId || '', company: input.company || '' };
    entries.push(entry); writeAtomic(this.files.dnc, entries); return entry;
  }
  recordPhone(input: { phone: string; company?: string; contactId?: string }) {
    const normalizedPhone = normalizePhone(input.phone);
    if (!normalizedPhone) throw new Error('Cannot index empty phone');
    const entries = this.listIndex(); const now = new Date().toISOString();
    const existing = entries.find(item => item.normalizedPhone === normalizedPhone);
    if (existing) { existing.lastSeenAt = now; writeAtomic(this.files.index, entries); return existing; }
    const entry: PhoneIndexEntry = { normalizedPhone, originalPhone: input.phone, firstSeenAt: now, lastSeenAt: now, company: input.company || '', contactId: input.contactId };
    entries.push(entry); writeAtomic(this.files.index, entries); return entry;
  }
  recordPhones(inputs: Array<{ phone: string; company?: string; contactId?: string }>) {
    const entries = this.listIndex(), byPhone = new Map(entries.map(item => [item.normalizedPhone, item])); const now = new Date().toISOString();
    for (const input of inputs) { const normalizedPhone = normalizePhone(input.phone); if (!normalizedPhone) continue; const existing = byPhone.get(normalizedPhone); if (existing) { existing.lastSeenAt = now; continue; } const entry: PhoneIndexEntry = { normalizedPhone, originalPhone: input.phone, firstSeenAt: now, lastSeenAt: now, company: input.company || '', contactId: input.contactId }; entries.push(entry); byPhone.set(normalizedPhone, entry); }
    writeAtomic(this.files.index, entries);
  }
  seed(contacts: Array<{ phone?: string; company?: string; id?: string }>) {
    const entries = this.listIndex(); const seen = new Set(entries.map(item => item.normalizedPhone)); let added = 0; const now = new Date().toISOString();
    for (const contact of contacts) { const normalizedPhone = normalizePhone(contact.phone); if (!normalizedPhone || seen.has(normalizedPhone)) continue; seen.add(normalizedPhone); entries.push({ normalizedPhone, originalPhone: String(contact.phone || ''), firstSeenAt: now, lastSeenAt: now, company: contact.company || '', contactId: contact.id }); added += 1; }
    if (added || !fs.existsSync(this.files.index)) writeAtomic(this.files.index, entries);
    if (!fs.existsSync(this.files.dnc)) writeAtomic(this.files.dnc, []);
    return added;
  }
}
