import test from 'node:test';
import assert from 'node:assert/strict';
import { importCsvRows } from './csv-import.js';

test('imports legacy Name, Company, Phone CSV', () => {
  assert.deepEqual(importCsvRows([{ Name: 'Jane', Company: 'Acme', Phone: '+1' }], ['Name', 'Company', 'Phone']), [{ contactName: 'Jane', company: 'Acme', phone: '+1' }]);
});

test('imports Company, Phone CSV and stores an empty name', () => {
  assert.deepEqual(importCsvRows([{ Company: 'Acme', Phone: '+1' }], ['Company', 'Phone']), [{ contactName: '', company: 'Acme', phone: '+1' }]);
});

test('matches headers case-insensitively and ignores extra columns', () => {
  assert.deepEqual(importCsvRows([{ COMPANY: 'Acme', phone: '+1', ADDRESS: 'Ignored' }], ['COMPANY', 'phone', 'ADDRESS']), [{ contactName: '', company: 'Acme', phone: '+1' }]);
});

test('requires Company and Phone but not Name', () => {
  assert.throws(() => importCsvRows([{ Company: 'Acme' }], ['Company']), /Phone/);
  assert.throws(() => importCsvRows([{ Phone: '+1' }], ['Phone']), /Company/);
});
