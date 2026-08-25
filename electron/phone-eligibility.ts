export type PhoneEligibilityRegistry = { isDnc(phone: unknown): boolean; hasPhone(phone: unknown): boolean };

export function phoneEligibility(registry: PhoneEligibilityRegistry, phone: unknown, checkDuplicate = true): { allowed: boolean; reason?: 'dnc' | 'duplicate' } {
  if (registry.isDnc(phone)) return { allowed: false, reason: 'dnc' };
  if (checkDuplicate && registry.hasPhone(phone)) return { allowed: false, reason: 'duplicate' };
  return { allowed: true };
}
