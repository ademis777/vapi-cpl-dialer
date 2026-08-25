import test from 'node:test';
import assert from 'node:assert/strict';
import { updateNoAnswerRetryCsv, type RetryContact } from './no-answer-retry.js';
import { importCsvRows } from './csv-import.js';
import Papa from 'papaparse';

const contact = (status: string, overrides: Partial<RetryContact> = {}): RetryContact => ({
  status, company: 'Acme', phone: '+1 555 0100', callId: `call-${status}`, callEndedAt: '2026-08-08T10:00:00.000Z', ...overrides,
});

test('No Answer is added to the retry CSV', () => {
  assert.deepEqual(updateNoAnswerRetryCsv('', [contact('No Answer')]).rows, [{ Company: 'Acme', Phone: '+1 555 0100', LastCallAt: '2026-08-08T10:00:00.000Z', Attempts: 1 }]);
});

for (const status of ['Completed', 'IVR', 'Failed']) {
  test(`${status} is excluded from the retry CSV`, () => assert.deepEqual(updateNoAnswerRetryCsv('', [contact(status)]).rows, []));
}

test('repeated No Answer increments Attempts without duplicates', () => {
  const first = updateNoAnswerRetryCsv('', [contact('No Answer', { callId: 'call-1' })]);
  const second = updateNoAnswerRetryCsv(first.csv, [contact('No Answer', { callId: 'call-2', phone: '+15550100', callEndedAt: '2026-08-09T11:00:00.000Z' })]);
  assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].Attempts, 2);
  assert.equal(second.rows[0].LastCallAt, '2026-08-09T11:00:00.000Z');
});

test('the same finalized call is not counted twice', () => {
  const item = contact('No Answer', { callId: 'call-1' });
  const first = updateNoAnswerRetryCsv('', [item]);
  item.noAnswerRetryRecordedCallId = first.recorded.get(item);
  assert.equal(updateNoAnswerRetryCsv(first.csv, [item]).rows[0].Attempts, 1);
});

test('retry CSV can be imported back without manual editing', () => {
  const exported = updateNoAnswerRetryCsv('', [contact('No Answer')]);
  const parsed = Papa.parse<Record<string, string>>(exported.csv, { header: true, skipEmptyLines: true });
  assert.deepEqual(importCsvRows(parsed.data, parsed.meta.fields), [{ company: 'Acme', phone: '+1 555 0100', contactName: '' }]);
});
