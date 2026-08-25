import { findWiseStructuredOutputs, type WiseStructuredOutputs } from './wise-structured-output.js';

export async function resolveWiseFirst<T>(payload: unknown, legacyFallback: () => Promise<T>): Promise<{ wise?: WiseStructuredOutputs; legacy?: T }> {
  const wise = findWiseStructuredOutputs(payload);
  if (wise) return { wise };
  return { legacy: await legacyFallback() };
}
