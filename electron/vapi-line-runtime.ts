import { VapiLineStore, type VapiLine } from './vapi-line-store.js';

export function resolveVapiLine(store: VapiLineStore, requestedLineId?: string): VapiLine | undefined {
  if (requestedLineId) {
    return store.get(requestedLineId);
  }

  return store.list().find((line) => line.enabled);
}

export function buildVapiLineOverrides(line?: VapiLine) {
  if (!line) return {};

  return {
    apiKey: line.vapiApiKey,
    assistantId: line.assistantId,
    phoneNumberId: line.phoneNumberId,
  };
}
