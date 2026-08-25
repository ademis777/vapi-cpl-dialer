import { createEmptyFourLineConfig, normalizeFourLineConfig, type FourLineConfig } from './line-manager.js';

export type LineConfigStore = {
  lines: FourLineConfig;
};

export function loadLineConfig(value: unknown): FourLineConfig {
  return normalizeFourLineConfig(value || createEmptyFourLineConfig());
}

export function lineConfigForPersistence(config: FourLineConfig): LineConfigStore {
  return {
    lines: normalizeFourLineConfig(config),
  };
}

export function maskLineSecrets(config: FourLineConfig) {
  return {
    lines: config.lines.map((line) => ({
      ...line,
      vapiApiKey: line.vapiApiKey ? '••••••••' : '',
    })),
  };
}
