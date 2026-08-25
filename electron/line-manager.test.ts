import assert from 'node:assert/strict';
import test from 'node:test';
import { FourLineRuntimeManager, createEmptyFourLineConfig, lineReady, normalizeFourLineConfig } from './line-manager.js';

test('creates exactly four independent line slots', () => {
  const config = createEmptyFourLineConfig();
  assert.equal(config.lines.length, 4);
  assert.deepEqual(config.lines.map(line => line.id), ['line-1', 'line-2', 'line-3', 'line-4']);
});

test('a line is ready only with key, assistant and phone number', () => {
  const config = createEmptyFourLineConfig();
  const line = config.lines[0];
  assert.equal(lineReady(line), false);
  line.vapiApiKey = 'test-key';
  line.assistantId = 'assistant-test';
  line.phoneNumberId = 'phone-test';
  assert.equal(lineReady(line), true);
});

test('normalization never allows more than four lines', () => {
  const config = normalizeFourLineConfig({
    lines: Array.from({ length: 10 }, (_, index) => ({
      name: `Custom ${index}`,
      enabled: true,
      vapiApiKey: 'x',
      assistantId: 'y',
      phoneNumberId: 'z',
    })),
  });
  assert.equal(config.lines.length, 4);
});

test('manager allocates one contact per line and caps concurrency at four', () => {
  const config = createEmptyFourLineConfig();
  for (const line of config.lines) {
    line.enabled = true;
    line.vapiApiKey = `key-${line.id}`;
    line.assistantId = `assistant-${line.id}`;
    line.phoneNumberId = `phone-${line.id}`;
  }
  const manager = new FourLineRuntimeManager(config);
  const allocated = [1, 2, 3, 4].map(index => manager.acquire(`contact-${index}`));
  assert.equal(allocated.filter(Boolean).length, 4);
  assert.equal(manager.activeCount(), 4);
  assert.equal(manager.acquire('contact-5'), undefined);
});

test('releasing one line makes only that line available again', () => {
  const config = createEmptyFourLineConfig();
  for (const line of config.lines) {
    line.enabled = true;
    line.vapiApiKey = 'key';
    line.assistantId = 'assistant';
    line.phoneNumberId = 'phone';
  }
  const manager = new FourLineRuntimeManager(config);
  const first = manager.acquire('a');
  manager.acquire('b');
  manager.acquire('c');
  manager.acquire('d');
  assert.ok(first);
  manager.release(first.id);
  const replacement = manager.acquire('e');
  assert.equal(replacement?.id, first.id);
  assert.equal(manager.activeCount(), 4);
});

test('snapshot masks Vapi keys', () => {
  const config = createEmptyFourLineConfig();
  config.lines[0].vapiApiKey = 'secret-value';
  const manager = new FourLineRuntimeManager(config);
  const snapshot = manager.snapshot();
  assert.equal(snapshot[0].config.vapiApiKey, '••••••••');
  assert.equal(JSON.stringify(snapshot).includes('secret-value'), false);
});
