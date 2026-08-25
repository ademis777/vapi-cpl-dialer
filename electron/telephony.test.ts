import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GenericSipProvider,
  ManualSipProvider,
  TelephonyProviderFactory,
  migrateTelephonyConfig,
  type TelephonyConfig,
} from './telephony.js';

const dependencies = {
  diagnostic: () => undefined,
  provisionForVapi: async () => undefined,
};

test('legacy Zadarma settings migrate without data loss', () => {
  const migrated = migrateTelephonyConfig({
    zadarmaKey: 'legacy-key',
    zadarmaSecret: 'legacy-secret',
    zadarmaSipLine: '1001',
    zadarmaSipPassword: 'sip-password',
    zadarmaPhoneNumber: '+12125550123',
  });

  assert.equal(migrated.provider, 'zadarma');
  assert.deepEqual(
    {
      apiKey: migrated.zadarma.apiKey,
      apiSecret: migrated.zadarma.apiSecret,
      sipLine: migrated.zadarma.sipLine,
      sipPassword: migrated.zadarma.sipPassword,
      selectedNumber: migrated.zadarma.selectedNumber,
    },
    {
      apiKey: 'legacy-key',
      apiSecret: 'legacy-secret',
      sipLine: '1001',
      sipPassword: 'sip-password',
      selectedNumber: '+12125550123',
    },
  );
});

test('nested config wins and selected provider is restored', () => {
  const migrated = migrateTelephonyConfig({
    zadarmaKey: 'old-key',
    telephony: {
      provider: 'genericSip',
      zadarma: { apiKey: 'nested-key' },
      genericSip: { displayName: 'Carrier' },
    },
  });

  assert.equal(migrated.provider, 'genericSip');
  assert.equal(migrated.zadarma.apiKey, 'nested-key');
  assert.equal(migrated.genericSip.displayName, 'Carrier');
});

test('factory creates Zadarma provider and preserves API endpoints and Caller ID request', async () => {
  const config = migrateTelephonyConfig({
    telephony: {
      provider: 'zadarma',
      zadarma: {
        apiKey: 'test-key', apiSecret: 'test-secret', sipLine: '1001', sipPassword: 'pw', selectedNumber: '+12125550123',
      },
    },
  });
  const provider = TelephonyProviderFactory.create('zadarma', config, dependencies);
  assert.equal(provider.id, 'zadarma');

  const requests: Array<{ url: string; method: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const method = init?.method || 'GET'; const body = String(init?.body || '');
    requests.push({ url, method, body });
    if (url.endsWith('/v1/sip/')) return new Response(JSON.stringify({ status: 'success', sips: [{ id: '1001' }] }), { status: 200 });
    if (url.endsWith('/v1/direct_numbers/')) return new Response(JSON.stringify({ status: 'success', info: [{ number: '+12125550123', description: 'Dallas' }] }), { status: 200 });
    return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
  }) as typeof fetch;

  try {
    const tested = await provider.testConnection();
    assert.equal(tested.sipLines[0]?.id, '1001');
    assert.equal(tested.phoneNumbers[0]?.number, '+12125550123');
    await provider.setCallerId();
    assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/v1/sip/', '/v1/direct_numbers/', '/v1/sip/callerid/']);
    assert.equal(requests[2]?.method, 'PUT');
    assert.equal(requests[2]?.body, 'id=1001&number=12125550123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Generic SIP is constructible but blocks unsupported campaign validation', () => {
  const config: TelephonyConfig = migrateTelephonyConfig({ telephony: { provider: 'genericSip' } });
  const provider = TelephonyProviderFactory.create(config.provider, config, dependencies);
  assert.ok(provider instanceof GenericSipProvider);
  assert.equal(provider.implemented, false);
  assert.throws(() => provider.validateConfiguration(), /Generic SIP provider is not implemented yet/);
});

test('Manual SIP validates locally and provisions without calling Zadarma API', async () => {
  const config = migrateTelephonyConfig({ telephony: { provider: 'manualSip', manualSip: {
    sipHost: 'sip://sip.carrier.example/', username: 'agent-1', password: 'secret', callerId: '+12125550123',
  } } });
  let provisioned = 0; let fetched = false;
  const provider = TelephonyProviderFactory.create(config.provider, config, {
    diagnostic: () => undefined,
    provisionForVapi: async () => { provisioned += 1; },
  });
  assert.ok(provider instanceof ManualSipProvider);
  assert.equal(provider.implemented, true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetched = true; throw new Error('Unexpected network request'); }) as typeof fetch;
  try {
    const result = await provider.testConnection();
    assert.equal(result.sipLines[0]?.id, 'agent-1');
    assert.equal(result.phoneNumbers[0]?.number, '+12125550123');
    assert.deepEqual(provider.getSipCredentials(), { username: 'agent-1', password: 'secret', sipDomain: 'sip.carrier.example' });
    await provider.setCallerId();
    await provider.provisionForVapi(true);
    assert.equal(fetched, false);
    assert.equal(provisioned, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Manual SIP reports missing required fields clearly', () => {
  const config = migrateTelephonyConfig({ telephony: { provider: 'manualSip', manualSip: {} } });
  const provider = TelephonyProviderFactory.create(config.provider, config, dependencies);
  assert.throws(() => provider.validateConfiguration(), /SIP Host is required/);
});
