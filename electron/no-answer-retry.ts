import Papa from 'papaparse';

export type NoAnswerRetryEntry = { Company: string; Phone: string; LastCallAt: string; Attempts: number };
export type RetryContact = {
  status: string;
  company: string;
  phone: string;
  callId?: string;
  callEndedAt?: string;
  finalizedAt?: string;
  noAnswerRetryRecordedCallId?: string;
};

function phoneKey(phone: string) {
  return String(phone || '').replace(/\D/g, '') || String(phone || '').trim().toLowerCase();
}

function later(left: string, right: string) {
  return (Date.parse(right) || 0) >= (Date.parse(left) || 0) ? right : left;
}

export function updateNoAnswerRetryCsv(existingCsv: string, contacts: RetryContact[]) {
  const existing = existingCsv.trim()
    ? Papa.parse<Record<string, string>>(existingCsv, { header: true, skipEmptyLines: true }).data
    : [];
  const entries = new Map<string, NoAnswerRetryEntry>();
  for (const row of existing) {
    const phone = String(row.Phone || '').trim();
    if (!phone) continue;
    const key = phoneKey(phone);
    const previous = entries.get(key);
    const attempts = Math.max(0, Number(row.Attempts) || 0);
    entries.set(key, previous
      ? { ...previous, Company: String(row.Company || previous.Company).trim(), LastCallAt: later(previous.LastCallAt, String(row.LastCallAt || '')), Attempts: previous.Attempts + attempts }
      : { Company: String(row.Company || '').trim(), Phone: phone, LastCallAt: String(row.LastCallAt || '').trim(), Attempts: attempts });
  }

  const recorded = new Map<RetryContact, string>();
  for (const contact of contacts) {
    if (contact.status !== 'No Answer' || !String(contact.phone || '').trim()) continue;
    const eventId = String(contact.callId || contact.finalizedAt || contact.callEndedAt || '').trim();
    if (!eventId || contact.noAnswerRetryRecordedCallId === eventId) continue;
    const key = phoneKey(contact.phone);
    const previous = entries.get(key);
    const lastCallAt = String(contact.callEndedAt || contact.finalizedAt || new Date().toISOString());
    entries.set(key, previous
      ? { ...previous, Company: contact.company || previous.Company, Phone: contact.phone || previous.Phone, LastCallAt: later(previous.LastCallAt, lastCallAt), Attempts: previous.Attempts + 1 }
      : { Company: contact.company, Phone: contact.phone, LastCallAt: lastCallAt, Attempts: 1 });
    recorded.set(contact, eventId);
  }

  const rows = [...entries.values()].sort((a, b) => a.Company.localeCompare(b.Company) || a.Phone.localeCompare(b.Phone));
  return { csv: `\uFEFF${Papa.unparse(rows, { columns: ['Company', 'Phone', 'LastCallAt', 'Attempts'] })}`, rows, recorded };
}
