import type { Contact } from './types.js';

export type ExportFilter = {
  statuses?: string[];
  leads?: string[];
};

export function selectLeadsForExport<T extends { status: string; lead?: string }>(contacts: T[], filter: ExportFilter = {}) {
  return contacts.filter((contact) => {
    const statusMatch = !filter.statuses?.length || filter.statuses.includes(contact.status);
    const leadMatch = !filter.leads?.length || filter.leads.includes(contact.lead || '');
    return statusMatch && leadMatch;
  });
}

export function archiveExportedLeads<T extends { status: string }>(contacts: T[]) {
  return contacts.map((contact) => ({
    ...contact,
    status: 'Archived'
  }));
}

export function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
