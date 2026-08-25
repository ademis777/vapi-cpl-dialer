export function normalizePhone(value: unknown, defaultCountryCode = '1') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length === 10 && defaultCountryCode === '1') return `1${digits}`;
  if (raw.startsWith('+')) return digits;
  return digits;
}

export function isValidNormalizedPhone(value: unknown) {
  return /^\d{8,15}$/.test(String(value ?? ''));
}
