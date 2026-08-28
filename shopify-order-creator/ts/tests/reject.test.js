const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RejectClient,
  buildRejectPayload,
  DEFAULT_REJECTION_REASON,
} = require('../dist/clients/reject.js');

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

test('DEFAULT_REJECTION_REASON is FAULTY, the only value the harness ever sends', () => {
  assert.equal(DEFAULT_REJECTION_REASON, 'FAULTY');
});

test('buildRejectPayload builds one rejected_items entry per item, defaulting the reason', () => {
  const payload = buildRejectPayload('0d351f7e-798e-4457-8db3-1dd61c08c0c1', [
    'ITEM#fd9d3268-9c29-41b0-8602-bf1ca6c0649e',
  ]);

  assert.equal(payload.shipment_id, '0d351f7e-798e-4457-8db3-1dd61c08c0c1');
  assert.equal(payload.rejected_items.length, 1);
  assert.equal(payload.rejected_items[0].shipment_item_id, 'ITEM#fd9d3268-9c29-41b0-8602-bf1ca6c0649e');
  assert.equal(payload.rejected_items[0].rejection_reason, 'FAULTY');
});

test('buildRejectPayload retains the ITEM# prefix on items while shipment_id stays bare (same asymmetry as fulfil)', () => {
  const shipmentId = '0d351f7e-798e-4457-8db3-1dd61c08c0c1'; // SHIPMENT# already stripped
  const itemId = 'ITEM#fd9d3268-9c29-41b0-8602-bf1ca6c0649e'; // ITEM# retained

  const payload = buildRejectPayload(shipmentId, [itemId]);

  assert.equal(payload.shipment_id, shipmentId);
  assert.ok(!payload.shipment_id.includes('SHIPMENT#'), 'shipment_id must not carry the SHIPMENT# prefix');
  assert.equal(payload.rejected_items[0].shipment_item_id, itemId, 'shipment_item_id must retain the ITEM# prefix verbatim');
});

test('buildRejectPayload supports multiple items in one call (needed to reject a whole shipment at once)', () => {
  const payload = buildRejectPayload('ship-1', ['ITEM#a', 'ITEM#b', 'ITEM#c']);

  assert.equal(payload.rejected_items.length, 3);
  assert.deepEqual(
    payload.rejected_items.map((item) => item.shipment_item_id),
    ['ITEM#a', 'ITEM#b', 'ITEM#c'],
  );
  assert.ok(payload.rejected_items.every((item) => item.rejection_reason === 'FAULTY'));
});

test('buildRejectPayload throws on an empty item list', () => {
  assert.throws(() => buildRejectPayload('ship-1', []), /requires at least one item/);
});

test('RejectClient throws at construction against a non-staging host', () => {
  assert.throws(
    () => new RejectClient({ baseUrl: 'https://not-staging.example.com', apiKey: 'k' }),
    /refuses to run against non-staging host/,
  );
});

test('RejectClient does not throw at construction against the real staging host', () => {
  assert.doesNotThrow(() => new RejectClient({ baseUrl: STAGING_BASE_URL, apiKey: 'k' }));
});

test('RejectClient.reject posts to /staging/reject, NOT /staging/fulfil (slice A: fulfil crashes 502 on a reject-shaped body)', async (t) => {
  let seenUrl;
  withFetch(t, async (url) => {
    seenUrl = url;
    return fakeResponse(200, JSON.stringify({ code: 200, message: 'success', data: { message: 'Shipment Item(s) rejected successfully.' } }));
  });

  const client = new RejectClient({ baseUrl: STAGING_BASE_URL, apiKey: 'k' });
  await client.reject(buildRejectPayload('ship-1', ['ITEM#a']));

  assert.equal(seenUrl, `${STAGING_BASE_URL}/staging/reject`);
});

test('RejectClient.reject surfaces a non-200 response message in the thrown error', async (t) => {
  withFetch(t, async () => fakeResponse(502, JSON.stringify({ message: 'Internal server error' })));

  const client = new RejectClient({ baseUrl: STAGING_BASE_URL, apiKey: 'k' });

  await assert.rejects(() => client.reject(buildRejectPayload('ship-1', ['ITEM#a'])), /Internal server error/);
});

test('RejectClient.reject returns the parsed body on 200, sending the X-API-KEY header', async (t) => {
  let seenHeaders;
  withFetch(t, async (url, init) => {
    seenHeaders = init.headers;
    return fakeResponse(
      200,
      JSON.stringify({ code: 200, message: 'success', data: { message: 'Shipment Item(s) rejected successfully.' } }),
    );
  });

  const client = new RejectClient({ baseUrl: STAGING_BASE_URL, apiKey: 'secret-key' });
  const result = await client.reject(buildRejectPayload('ship-1', ['ITEM#a']));

  assert.deepEqual(result, { code: 200, message: 'success', data: { message: 'Shipment Item(s) rejected successfully.' } });
  assert.equal(seenHeaders['X-API-KEY'], 'secret-key');
});

test('RejectClient.reject throws on a 200 with a non-JSON body', async (t) => {
  withFetch(t, async () => fakeResponse(200, 'not json'));

  const client = new RejectClient({ baseUrl: STAGING_BASE_URL, apiKey: 'k' });

  await assert.rejects(() => client.reject(buildRejectPayload('ship-1', ['ITEM#a'])), /not valid JSON/);
});
