export type ImportedContact = { company: string; phone: string; contactName: string };

const HEADER_ALIASES = {
  company: ['company', 'business', 'компания', 'бизнес', 'название'],
  phone: ['phone', 'mobile', 'телефон', 'мобильный'],
  name: ['name', 'contact name', 'customer name', 'имя'],
} as const;

function normalizeHeader(value: string) {
  return String(value || '').replace(/^\uFEFF/, '').trim().toLocaleLowerCase();
}

function findHeader(headers: string[], aliases: readonly string[]) {
  return headers.find(header => aliases.some(alias => alias === normalizeHeader(header)));
}

export function importCsvRows(rows: Array<Record<string, unknown>>, fields: string[] = []): ImportedContact[] {
  const headers = fields.length ? fields : Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const companyKey = findHeader(headers, HEADER_ALIASES.company);
  const phoneKey = findHeader(headers, HEADER_ALIASES.phone);
  const nameKey = findHeader(headers, HEADER_ALIASES.name);
  const missing = [!companyKey && 'Company', !phoneKey && 'Phone'].filter(Boolean);
  if (missing.length) throw new Error(`CSV must contain the following columns: ${missing.join(', ')}`);

  return rows.map(row => ({
    company: String(row[companyKey!] ?? '').trim(),
    phone: String(row[phoneKey!] ?? '').trim(),
    contactName: nameKey ? String(row[nameKey] ?? '').trim() : '',
  })).filter(contact => contact.phone);
}
