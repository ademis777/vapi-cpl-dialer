import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHubImport } from './hub-import.js';

test('uses CSV normalization and appends only unique HUB contacts', () => {
  const result = prepareHubImport(
    [{ company: 'Existing Co', phone: '+1 555 0100' }],
    [
      { company: ' Existing Co ', phone: ' +1 555 0100 ' },
      { company: 'HUB Test Alpha', phone: ' +1 816 555 0101 ' },
      { company: 'HUB Test Alpha', phone: ' +1 816 555 0101 ' },
      { company: 'Missing Phone', phone: ' ' },
    ],
  );
  assert.deepEqual(result.contacts, [{ company: 'HUB Test Alpha', phone: '+1 816 555 0101', contactName: '' }]);
  assert.deepEqual(
    { requested: result.requested, imported: result.imported, duplicates: result.duplicates, rejected: result.rejected },
    { requested: 4, imported: 1, duplicates: 2, rejected: 1 },
  );
  assert.match(result.errors[0], /Phone is required/);
});
