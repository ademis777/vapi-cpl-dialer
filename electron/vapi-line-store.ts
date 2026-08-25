import fs from 'node:fs';
import path from 'node:path';
import { createEmptyFourLineConfig, normalizeFourLineConfig, type FourLineConfig } from './line-manager.js';

export class VapiLineStore {
  constructor(private readonly filename: string) {}

  load(): FourLineConfig {
    try {
      return normalizeFourLineConfig(JSON.parse(fs.readFileSync(this.filename, 'utf8')));
    } catch {
      return createEmptyFourLineConfig();
    }
  }

  save(config: FourLineConfig) {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(this.filename, JSON.stringify(normalizeFourLineConfig(config), null, 2));
  }
}
