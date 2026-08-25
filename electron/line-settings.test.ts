import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyFourLineConfig } from './line-manager.js';
import { maskLineSettings, mergeLineSettings, migrateLineSettings } from './line-settings.js';

test('legacy single-line Vapi settings migrate into line 1', () => {
  const migrated = migrateLineSettings(undefined, {
    vapiApiKey: 'legacy-key',
    vapiAssistantId: 'legacy-assistant',
    vapiSipPhoneNumberId: 'legacy-phone',
  });
  assert.equal(migrated.lines[0].vapiApiKey, 'legacy-key');
  assert.equal(migrated.lines[0].assistantId, 'legacy-assistant');
  assert.equal(migrated.lines[0].phoneNumberId, 'legacy-phone');
  assert.equal(migrated.lines[1].vapiApiKey, '');
});

test('existing four-line configuration wins over legacy values', () => {
  const existing = createEmptyFourLineConfig();
  existing.lines[0].vapiApiKey = 'new-key';
  const migrated = migrateLineSettings(existing, { vapiApiKey: 'legacy-key' });
  assert.equal(migrated.lines[0].vapiApiKey, 'new-key');
});

test('public line settings never expose API keys', () => {
  const config = createEmptyFourLineConfig();
  config.lines[0].vapiApiKey = 'private-value';
  const masked = maskLineSettings(config);
  assert.equal(masked.lines[0].vapiApiKey, '••••••••');
  assert.equal(masked.lines[0].hasVapiApiKey, true);
  assert.equal(JSON.stringify(masked).includes('private-value'), false);
});

test('masked key round-trip preserves the stored secret', () => {
  const current = createEmptyFourLineConfig();
  current.lines[0].vapiApiKey = 'stored-key';
  const incoming = maskLineSettings(current);
  const merged = mergeLineSettings(current, incoming);
  assert.equal(merged.lines[0].vapiApiKey, 'stored-key');
});
