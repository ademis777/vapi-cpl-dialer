import type { FourLineRuntimeManager, VapiLineConfig } from './line-manager.js';

/**
 * Resolves which Vapi credentials should be used for a call.
 * Kept separate from call execution so the existing Vapi payload builder can
 * consume a selected line without knowing about queue management.
 */
export function resolveVapiLine(
  manager: FourLineRuntimeManager,
  contactId: string,
): VapiLineConfig {
  const line = manager.acquire(contactId);
  if (!line) {
    throw new Error('No available Vapi line');
  }
  return line;
}

export function releaseVapiLine(manager: FourLineRuntimeManager, lineId: VapiLineConfig['id']) {
  manager.release(lineId);
}
