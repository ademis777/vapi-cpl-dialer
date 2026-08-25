const ASSISTANT_NAMES = ['Alex'] as const;

export function isAssistantName(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return ASSISTANT_NAMES.some(name => name.toLowerCase() === normalized);
}

function safeCustomerReference(customerName?: string) {
  const name = String(customerName || '').trim();
  return name && !isAssistantName(name) ? name : 'the customer';
}

export function sanitizeCustomerName(value: unknown, knownCustomerName?: string) {
  const candidate = String(value || '').trim();
  if (!isAssistantName(candidate)) return candidate || 'Unknown';
  const known = String(knownCustomerName || '').trim();
  return known && !isAssistantName(known) ? known : 'Unknown';
}

export function sanitizeSummaryIdentity(value: unknown, knownCustomerName?: string) {
  let summary = String(value || '').trim();
  const replacement = safeCustomerReference(knownCustomerName);
  for (const assistantName of ASSISTANT_NAMES) {
    const escaped = assistantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    summary = summary
      .replace(new RegExp(`\\bthe customer\\s*,\\s*${escaped}\\s*,?`, 'gi'), replacement)
      .replace(new RegExp(`\\bthe customer\\s+${escaped}\\b`, 'gi'), replacement)
      .replace(new RegExp(`\\b${escaped}\\s*,?\\s+the customer\\b`, 'gi'), replacement);
  }
  return summary;
}
