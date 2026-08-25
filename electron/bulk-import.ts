import { isValidNormalizedPhone, normalizePhone } from './phone-normalization.js';
import type { HubContactInput } from './hub-import.js';

export type ImportReport = { parsed: number; submitted: number; imported: number; duplicates: number; dnc: number; invalid: number; failed: number };
export type PreparedBulkContact = { company: string; phone: string; normalizedPhone: string; contactName: string; address?: string; location?: string; city?: string; state?: string; zipCode?: string; demoUrl?: string };

export function prepareBulkImport(items: HubContactInput[], existingPhones: Set<string>, dncPhones: Set<string>) {
  const seen = new Set(existingPhones); const contacts: PreparedBulkContact[] = [];
  const report: ImportReport = { parsed: items.length, submitted: items.length, imported: 0, duplicates: 0, dnc: 0, invalid: 0, failed: 0 };
  for (const item of items) {
    try {
      const company = String(item.company ?? '').trim(), phone = String(item.phone ?? '').trim(), normalizedPhone = normalizePhone(phone);
      if (!company || !phone || !isValidNormalizedPhone(normalizedPhone)) { report.invalid += 1; continue; }
      if (dncPhones.has(normalizedPhone)) { report.dnc += 1; continue; }
      if (seen.has(normalizedPhone)) { report.duplicates += 1; continue; }
      seen.add(normalizedPhone);
      const address = String(item.address ?? '').trim(), location = String(item.location ?? '').trim();
      const zipCode = String(item.zipCode ?? '').trim() || address.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || '';
      const value: PreparedBulkContact = { company, phone, normalizedPhone, contactName: String(item.contactName ?? '').trim() };
      if (address) value.address = address; if (location) value.location = location; if (zipCode) value.zipCode = zipCode;
      if (item.city) value.city = String(item.city).trim(); if (item.state) value.state = String(item.state).trim(); if (item.demoUrl) value.demoUrl = String(item.demoUrl).trim();
      contacts.push(value); report.imported += 1;
    } catch { report.failed += 1; }
  }
  return { contacts, report };
}

export function validImportAccounting(report: ImportReport) {
  return report.imported + report.duplicates + report.dnc + report.invalid + report.failed === report.submitted;
}
