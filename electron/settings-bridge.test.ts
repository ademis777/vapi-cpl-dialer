import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyTelephonyConfig } from './telephony.js';
import { mergeBridgeCampaign, mergeBridgeConfig } from './settings-bridge.js';

test('HUB config merge updates canonical fields without erasing nested telephony settings', () => {
  const current = { vapiApiKey: 'real-key', telegramChatId: '1', telephony: { ...emptyTelephonyConfig, zadarma: { ...emptyTelephonyConfig.zadarma, apiKey: 'z-key', apiSecret: 'z-secret' } } };
  const merged = mergeBridgeConfig(current, { telegramChatId: '2', telephony: { ...current.telephony, zadarma: { ...current.telephony.zadarma, sipLine: '100' } } });
  assert.equal(merged.vapiApiKey, 'real-key');
  assert.equal(merged.telegramChatId, '2');
  assert.equal(merged.telephony.zadarma.apiSecret, 'z-secret');
  assert.equal(merged.telephony.zadarma.sipLine, '100');
});

test('HUB campaign merge preserves the live contact queue', () => {
  const contacts = [{ id: 'lead-1' }];
  const current = { contacts, systemPrompt: 'old', maximumCallDurationSeconds: 600 };
  const merged = mergeBridgeCampaign(current, { systemPrompt: 'new', maximumCallDurationSeconds: 420, contacts: [] });
  assert.equal(merged.systemPrompt, 'new');
  assert.equal(merged.maximumCallDurationSeconds, 420);
  assert.strictEqual(merged.contacts, contacts);
});
