import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinalStatus, hasMeaningfulHumanDialogue } from './conversation-classification.js';

test('recognizes a real customer conversation', () => {
  assert.equal(hasMeaningfulHumanDialogue({ messages: [
    { role: 'assistant', message: 'Hi, this is Alex with DMNT.' },
    { role: 'customer', message: 'Can you tell me what this is about?' },
  ] }), true);
});

test('greeting-only and immediate hangup are not meaningful conversations', () => {
  assert.equal(hasMeaningfulHumanDialogue({ messages: [{ role: 'assistant', message: 'Hi, this is Alex with DMNT.' }] }), false);
  assert.equal(hasMeaningfulHumanDialogue({ messages: [{ role: 'assistant', message: 'Hi' }, { role: 'customer', message: 'Hello' }] }), false);
  assert.equal(hasMeaningfulHumanDialogue({ transcript: '' }), false);
  assert.equal(hasMeaningfulHumanDialogue({ messages: [{ role: 'assistant', message: 'Hi, this is Alex...' }, { role: 'customer', message: 'Not interested.' }] }), false);
});

test('uses role-labelled transcript when message objects are unavailable', () => {
  assert.equal(hasMeaningfulHumanDialogue({ transcript: 'assistant: Hello\ncustomer: We need a new roof next month' }), true);
  assert.equal(hasMeaningfulHumanDialogue({ transcript: 'assistant: Hello\ncustomer: Goodbye' }), false);
});

test('IVR prompts alone are not treated as a human conversation', () => {
  assert.equal(hasMeaningfulHumanDialogue({ messages: [{ role: 'customer', message: 'Your call is important. Press 1 for sales.' }] }), false);
});

test('Hi from Alex followed only by Not interested ends as No Answer', () => {
  const meaningfulDialogue = hasMeaningfulHumanDialogue({ messages: [
    { role: 'assistant', message: 'Hi, this is Alex...' },
    { role: 'customer', message: 'Not interested.' },
  ] });
  assert.equal(classifyFinalStatus({ failed: false, noAnswer: false, ivr: false, meaningfulDialogue }), 'No Answer');
});

test('verified no-answer terminal reason maps to No Answer', () => {
  assert.equal(classifyFinalStatus({ failed: false, noAnswer: true, ivr: false, meaningfulDialogue: false }), 'No Answer');
});

test('verified failed terminal reason maps to Failed', () => {
  assert.equal(classifyFinalStatus({ failed: true, noAnswer: false, ivr: false, meaningfulDialogue: false }), 'Failed');
});

test('long ended call without customer speech is not Completed', () => {
  const meaningfulDialogue = hasMeaningfulHumanDialogue({
    startedAt: '2026-08-13T00:00:00Z',
    endedAt: '2026-08-13T00:02:14Z',
    messages: [{ role: 'system', message: 'Press a key when an IVR asks.' }],
  });
  assert.equal(meaningfulDialogue, false);
  assert.equal(classifyFinalStatus({ failed: false, noAnswer: false, ivr: false, meaningfulDialogue }), 'No Answer');
});
