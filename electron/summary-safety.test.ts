import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCustomerName, sanitizeSummaryIdentity } from './summary-safety.js';

test('Assistant Alex can never become the customer name', () => {
  assert.equal(sanitizeCustomerName('Alex', 'Hannah'), 'Hannah');
  assert.equal(sanitizeCustomerName('Alex'), 'Unknown');
});

test('replaces assistant name used as customer identity in Summary', () => {
  assert.equal(sanitizeSummaryIdentity('The customer, Alex, ended the call.', 'Hannah'), 'Hannah ended the call.');
  assert.equal(sanitizeSummaryIdentity('The customer, Alex, ended the call.'), 'the customer ended the call.');
  assert.doesNotMatch(sanitizeSummaryIdentity('The customer Alex declined.', 'Hannah'), /customer\s*,?\s*Alex/i);
});

test('does not replace the real customer Hannah', () => {
  assert.equal(sanitizeSummaryIdentity('The customer, Hannah, ended the call.', 'Hannah'), 'The customer, Hannah, ended the call.');
});
