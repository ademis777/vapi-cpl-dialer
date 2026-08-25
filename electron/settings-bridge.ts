import type { TelephonyConfig } from './telephony.js';

export type BridgeConfig = { telephony: TelephonyConfig } & Record<string, any>;
export type BridgeCampaign = { contacts: unknown[] } & Record<string, any>;

export function mergeBridgeConfig<T extends BridgeConfig>(current: T, incoming: Partial<T>): T {
  const incomingTelephony = incoming.telephony as Partial<TelephonyConfig> | undefined;
  return {
    ...current,
    ...incoming,
    telephony: incomingTelephony ? {
      ...current.telephony,
      ...incomingTelephony,
      zadarma: { ...current.telephony.zadarma, ...(incomingTelephony.zadarma || {}) },
      manualSip: { ...current.telephony.manualSip, ...(incomingTelephony.manualSip || {}) },
      genericSip: { ...current.telephony.genericSip, ...(incomingTelephony.genericSip || {}) },
    } : current.telephony,
  } as T;
}

export function mergeBridgeCampaign<T extends BridgeCampaign>(current: T, incoming: Partial<T>): T {
  return { ...current, ...incoming, contacts: current.contacts };
}
