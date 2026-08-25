import test from 'node:test';
import assert from 'node:assert/strict';
import { userVisibleCallEvents } from './user-call-events.js';

test('technical non-terminal diagnostics never enter user-visible call events', () => {
  const entries = Array.from({ length: 100 }, () => ({ event: 'call_event_ignored_non_terminal', details: { callId: 'call-1' } }));
  assert.deepEqual(userVisibleCallEvents(entries, 'call-1'), []);
});

test('user-visible call events are deduplicated and bounded', () => {
  const entries = [
    { event: 'call_started', details: { callId: 'call-1' } },
    { event: 'call_started', details: { callId: 'call-1' } },
    { event: 'ivr_dtmf_sent', details: { callId: 'call-1', digits: '1' } },
    { event: 'ivr_dtmf_sent', details: { callId: 'call-1', digits: '1' } },
    { event: 'call_ended', details: { callId: 'call-1' } },
  ];
  assert.deepEqual(userVisibleCallEvents(entries, 'call-1', 2).map(entry => entry.event), ['DTMF sent', 'Call ended']);
});
