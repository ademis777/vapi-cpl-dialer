import { createEmptyFourLineConfig, normalizeFourLineConfig, type FourLineConfig } from './line-manager.js';

export type LegacySingleLineConfig = {
  vapiApiKey?: string;
  vapiAssistantId?: string;
  vapiSipPhoneNumberId?: string;
};

/**
 * Migrates the donor single-line settings into line 1 exactly once while
 * keeping lines 2-4 empty. Existing four-line settings always win.
 */
export function migrateLineSettings(existing: unknown, legacy: LegacySingleLineConfig): FourLineConfig {
  if (Array.isArray((existing as any)?.lines)) return normalizeFourLineConfig(existing);

  const result = createEmptyFourLineConfig();
  const first = result.lines[0];
  first.enabled = true;
  first.vapiApiKey = String(legacy.vapiApiKey || '');
  first.assistantId = String(legacy.vapiAssistantId || '');
  first.phoneNumberId = String(legacy.vapiSipPhoneNumberId || '');
  return result;
}

export function maskLineSettings(config: FourLineConfig) {
  return {
    lines: config.lines.map(line => ({
      ...line,
      vapiApiKey: line.vapiApiKey ? '••••••••' : '',
      hasVapiApiKey: Boolean(line.vapiApiKey),
    })),
  };
}

/** Keep an already stored key when the UI sends the masked placeholder. */
export function mergeLineSettings(current: FourLineConfig, incoming: unknown): FourLineConfig {
  const normalized = normalizeFourLineConfig(incoming);
  return {
    lines: normalized.lines.map((line, index) => ({
      ...line,
      vapiApiKey: line.vapiApiKey === '••••••••'
        ? current.lines[index]?.vapiApiKey || ''
        : line.vapiApiKey,
    })),
  };
}
