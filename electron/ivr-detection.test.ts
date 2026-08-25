import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIvr } from './ivr-detection.js';

test('detects IVR phrases during the first 15 seconds', () => {
  assert.deepEqual(detectIvr({ messages: [{ time: 4, message: 'For sales, press 1 now.' }] }), { phrase: 'press 1', summary: 'IVR: Press 1 required' });
  assert.equal(detectIvr({ messages: [{ secondsFromStart: 15, content: 'Welcome to the MAIN MENU' }] })?.summary, 'IVR: Main menu detected');
});

test('does not classify matching text after the first 15 seconds', () => {
  assert.equal(detectIvr({ messages: [{ time: 15.1, message: 'Press 2' }] }), undefined);
});

test('does not change ordinary calls', () => {
  assert.equal(detectIvr({ messages: [{ time: 3, message: 'Hello, I am interested in your service.' }] }), undefined);
});

test('never detects IVR phrases from the assistant system prompt', () => {
  assert.equal(detectIvr({ messages: [
    { role: 'system', secondsFromStart: 0, message: 'When an automated menu says press a key, use the dtmf tool.' },
  ] }), undefined);
});

test('supports epoch timestamps relative to call start', () => {
  assert.equal(detectIvr({ startedAt: '2026-08-08T10:00:00.000Z', messages: [{ time: Date.parse('2026-08-08T10:00:08.000Z'), message: 'Enter your zip' }] })?.phrase, 'enter your zip');
});

test('detects hold, queue and transfer IVR announcements', () => {
  for (const phrase of ['all agents are busy', 'please hold', 'your call is important', 'queue', 'on hold', 'transfer', 'connecting your call']) {
    assert.ok(detectIvr({ messages: [{ time: 2, message: phrase }] }), phrase);
  }
});
