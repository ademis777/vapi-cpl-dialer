import { importCsvRows } from './csv-import.js';

export type HubContactInput = { company?: unknown; phone?: unknown; contactName?: unknown; address?: unknown; location?: unknown; city?: unknown; state?: unknown; zipCode?: unknown; demoUrl?: unknown };
export type ExistingContactIdentity = { company: string; phone: string };

export type HubImportPreparation = {
  contacts: Array<{ company: string; phone: string; contactName: string; address?: string; location?: string; zipCode?: string }>;
  requested: number;
  imported: number;
  duplicates: number;
  rejected: number;
  errors: string[];
};

function contactKey(contact: ExistingContactIdentity) {
  return `${contact.company}|${contact.phone}`.trim().toLocaleLowerCase();
}

export function prepareHubImport(existing: ExistingContactIdentity[], items: HubContactInput[]): HubImportPreparation {
  const rows = items.map(item => ({
    Company: item.company,
    Phone: item.phone,
    Name: item.contactName,
  }));
  const normalized = importCsvRows(rows, ['Company', 'Phone', 'Name']);
  const errors: string[] = [];
  items.forEach((item, index) => {
    if (!String(item.phone ?? '').trim()) errors.push(`Contact ${index + 1}: Phone is required`);
  });

  const seen = new Set(existing.map(contactKey));
  const contacts: HubImportPreparation['contacts'] = [];
  let duplicates = 0;
  for (const contact of normalized) {
    const key = contactKey(contact);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const source = items.find(item => contactKey({ company: String(item.company ?? '').trim(), phone: String(item.phone ?? '').trim() }) === key);
    const address = String(source?.address ?? '').trim();
    const location = String(source?.location ?? '').trim();
    const zipCode = String(source?.zipCode ?? '').trim() || address.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || '';
    contacts.push({ ...contact, ...(address ? { address } : {}), ...(location ? { location } : {}), ...(zipCode ? { zipCode } : {}) });
  }

  return {
    contacts,
    requested: items.length,
    imported: contacts.length,
    duplicates,
    rejected: errors.length,
    errors,
  };
}
