import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIvrNavigation, executedDtmfCalls, extractUsZip, shouldSendDtmf } from './ivr-navigation.js';

const call = (message: string) => ({ messages: [{ time: 4, role: 'customer', message }] });

test('selects Press 1 for sales', () => assert.equal((detectIvrNavigation(call('Press 1 for sales, press 2 for billing')) as any).digits, '1'));
test('selects Press 2 for service', () => assert.equal((detectIvrNavigation(call('For service press 2')) as any).digits, '2'));
test('selects Press 0 for operator', () => assert.equal((detectIvrNavigation(call('Press 0 for operator')) as any).digits, '0'));
test('prioritizes sales over a generic earlier option', () => assert.equal((detectIvrNavigation(call('Press 2 for billing. Press 3 for sales.')) as any).digits, '3'));
test('extracts US ZIP from parser address', () => assert.equal(extractUsZip('3214 Bishop St, Little Rock, AR 72206, United States'), '72206'));
test('sends known lead ZIP when IVR requests it', () => assert.equal((detectIvrNavigation(call('Please enter your ZIP code'), { zipCode: '72206' }) as any).digits, '72206'));
test('does not invent ZIP when lead metadata has none', () => assert.equal((detectIvrNavigation(call('Please enter your ZIP code')) as any).kind, 'missing-data'));

test('handled prompts are not repeated but sequential menus are allowed', () => {
  const first = detectIvrNavigation(call('Press 1 for sales'))!;
  assert.equal(shouldSendDtmf({}, first), true);
  assert.equal(shouldSendDtmf({ attempts: 1, handledPromptKeys: [first.promptKey] }, first), false);
  assert.equal(shouldSendDtmf({ attempts: 1, handledPromptKeys: [first.promptKey] }, { ...first, promptKey: 'second-menu' }), true);
  assert.equal(shouldSendDtmf({ attempts: 6 }, { ...first, promptKey: 'seventh-menu' }), false);
});

test('system prompt cannot manufacture an IVR decision', () => {
  assert.equal(detectIvrNavigation({ messages: [{ role: 'system', time: 0, message: 'Press 1 and enter ZIP code with dtmf' }] }, { zipCode: '77041' }), undefined);
});

test('DTMF is reported only when a native Vapi tool call exists', () => {
  assert.deepEqual(executedDtmfCalls({ messages: [{ role: 'system', message: 'use dtmf 1' }] }), []);
  assert.deepEqual(executedDtmfCalls({ messages: [{ role: 'tool_calls', time: 10, toolCalls: [{
    id: 'tool-1', type: 'function', function: { name: 'dtmf', arguments: '{"keys":"1"}' },
  }] }] }), [{ id: 'tool-1', digits: '1' }]);
});
