const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FulfilmentClient,
  buildFulfilPayload,
  formatFulfilledAt,
  FULFILLER,
} = require('../dist/clients/fulfilment.js');

const STAGING_BASE_URL = 'https://celmqip2md.execute-api.ap-southeast-2.amazonaws.com';

function fakeResponse(status, bodyText) {
  return {
    status,
    statusText: `STATUS_${status}`,
    text: async () => bodyText,
  };
}

function withFetch(t, impl) {
  const originalFetch = global.fetch;
  global.fetch = impl;
  t.after(() => {
    global.fetch = originalFetch;
  });
}

test('buildFulfilPayload builds one package per item with the given fulfiller/timestamp', () => {
  const payload = buildFulfilPayload(
    'd4948c69-af52-488a-ad5c-48ac0fc38986',
    ['ITEM#f8f9e240-b89a-46db-92e8-1a1483249997', 'ITEM#aaaa1111-b89a-46db-92e8-1a1483249997'],
    'QA auto fulfilment',
    '2026-06-30 01:00:00',
  );

  assert.equal(payload.shipment_id, 'd4948c69-af52-488a-ad5c-48ac0fc38986');
  assert.equal(payload.fulfiller, 'QA auto fulfilment');
  assert.equal(payload.fulfilled_at, '2026-06-30 01:00:00');
  assert.equal(payload.package_composition.length, 2, 'one package per item');
  for (const pkg of payload.package_composition) {
    assert.equal(pkg.shipment_items.length, 1);
    assert.equal(typeof pkg.final_weight, 'string');
    assert.equal(typeof pkg.packaging_weight, 'string');
    assert.equal(typeof pkg.shipment_items[0].weight, 'string');
  }
});

test('buildFulfilPayload retains the ITEM# prefix on items while shipment_id stays bare (the asymmetry is real, not a typo)', () => {
  const shipmentId = 'd4948c69-af52-488a-ad5c-48ac0fc38986'; // SHIPMENT# already stripped
  const itemIds = ['ITEM#f8f9e240-b89a-46db-92e8-1a1483249997']; // ITEM# retained

  const payload = buildFulfilPayload(shipmentId, itemIds, FULFILLER, '2026-06-30 01:00:00');

  assert.equal(payload.shipment_id, shipmentId);
  assert.ok(!payload.shipment_id.includes('SHIPMENT#'), 'shipment_id must not carry the SHIPMENT# prefix');
  assert.equal(
    payload.package_composition[0].shipment_items[0].shipment_item_id,
    'ITEM#f8f9e240-b89a-46db-92e8-1a1483249997',
    'shipment_item_id must retain the ITEM# prefix verbatim',
  );
});

test('formatFulfilledAt converts to Australia/Brisbane (UTC+10, no DST), matching the dev-doc reference example', () => {
  // 2026-06-29T15:00:00Z + 10h = 2026-06-30 01:00:00 Brisbane — the exact
  // example from the dev doc's reference payload.
  const result = formatFulfilledAt(new Date('2026-06-29T15:00:00.000Z'));
  assert.equal(result, '2026-06-30 01:00:00');
});

test('formatFulfilledAt is correct across a UTC-midnight boundary (uses Brisbane\'s date, not UTC\'s)', () => {
  // Both instants are the same UTC calendar day's boundary but land on the
  // same Brisbane calendar day, 1 hour apart — proves the date component
  // comes from the Brisbane-local calculation, not a naive UTC date slice.
  const beforeUtcMidnight = formatFulfilledAt(new Date('2026-06-29T23:30:00.000Z'));
  const afterUtcMidnight = formatFulfilledAt(new Date('2026-06-30T00:30:00.000Z'));

  assert.equal(beforeUtcMidnight, '2026-06-30 09:30:00');
  assert.equal(afterUtcMidnight, '2026-06-30 10:30:00');
});

test('FulfilmentClient throws at construction against a non-staging host', () => {
  assert.throws(
    () => new FulfilmentClient({ baseUrl: 'https://not-staging.example.com', apiKey: 'k' }),
    /refuses to run against non-staging host/,
  );
});

test('FulfilmentClient does not throw at construction against the real staging host', () => {
  assert.doesNotThrow(() => new FulfilmentClient({ baseUrl: STAGING_BASE_URL, apiKey: 'k' }));
});

test('FulfilmentClient.fulfil surfaces a 400 response message in the thrown error', async (t) => {
  withFetch(t, async () =>
    fakeResponse(400, JSON.stringify({ message: "can't fulfill shipment with status fulfilled" })),
  );

  const client = new FulfilmentClient({ baseUrl: STAGING_BASE_URL, apiKey: 'k' });
  const payload = buildFulfilPayload('d4948c69-af52-488a-ad5c-48ac0fc38986', ['ITEM#abc'], FULFILLER, '2026-06-30 01:00:00');

  await assert.rejects(
    () => client.fulfil(payload),
    /can't fulfill shipment with status fulfilled/,
  );
});

test('FulfilmentClient.fulfil returns the parsed body on 200, sending the X-API-KEY header', async (t) => {
  let seenHeaders;
  withFetch(t, async (url, init) => {
    seenHeaders = init.headers;
    return fakeResponse(200, JSON.stringify({ tracking_number: 'AP123456789AU' }));
  });

  const client = new FulfilmentClient({ baseUrl: STAGING_BASE_URL, apiKey: 'secret-key' });
  const payload = buildFulfilPayload('d4948c69-af52-488a-ad5c-48ac0fc38986', ['ITEM#abc'], FULFILLER, '2026-06-30 01:00:00');

  const result = await client.fulfil(payload);

  assert.deepEqual(result, { tracking_number: 'AP123456789AU' });
  assert.equal(seenHeaders['X-API-KEY'], 'secret-key');
});
