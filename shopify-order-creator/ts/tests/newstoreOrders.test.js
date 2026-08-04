const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gstAmount,
  generateExternalId,
  buildSfsPayload,
  buildOtcPayload,
  injectSfsOrder,
  injectOtcOrder,
} = require('../dist/flows/newstoreOrders.js');

// Variant GIDs from variants.ts — used so lookupPrices' variant-map check passes.
const SKU_A = '32625134'; // US
const GID_A = 'gid://shopify/ProductVariant/51763546423569';
const SKU_PS = '33203669'; // PS
const GID_PS = 'gid://shopify/ProductVariant/50773867888932';

function fakePrices(pricesByGid) {
  return { fetchVariantPrices: async () => pricesByGid };
}

function fakeNewStore(response) {
  const calls = [];
  return {
    calls,
    post: async (path, payload) => {
      calls.push({ path, payload });
      return response;
    },
  };
}

test('gstAmount extracts the GST component from a tax-included price', () => {
  assert.equal(gstAmount(110), 10);
  assert.equal(gstAmount(9.99), 0.91); // 9.99 / 11 = 0.908... rounds to 0.91
});

test('generateExternalId produces unique, prefixed IDs for SFS and OTC', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) {
    ids.add(generateExternalId('SFS'));
    ids.add(generateExternalId('OTC'));
  }
  assert.equal(ids.size, 100, 'every generated ID must be unique');
  for (const id of ids) {
    assert.match(id, /^QA(SFS|OTC)_\d+_[0-9a-f]{10}$/);
  }
});

test('buildSfsPayload shapes an SFS order: not preconfirmed, ships to customer, charges shipping', () => {
  const payload = buildSfsPayload({
    store: 'US',
    skus: [SKU_A],
    prices: { [SKU_A]: 100 },
    externalId: 'QASFS_123_abc',
    placedAt: '2026-07-31T00:00:00Z',
  });

  assert.equal(payload.is_preconfirmed, false);
  assert.equal(payload.is_fulfilled, false);
  assert.equal(payload.channel_name, 'QA Ship From Store');
  assert.equal(payload.store_id, 'BRANCH_407');
  assert.equal(payload.shipping_address.address_line_1, '42 William Farrior Place');
  assert.equal(payload.shipments[0].shipping_option.price, 9.99);
  assert.equal(payload.shipments[0].shipping_option.tax, 0.91);
  // total = 100 (item) + 9.99 (shipping) = 109.99
  assert.equal(payload.payments[0].amount, 109.99);
});

test('buildOtcPayload shapes an OTC order: preconfirmed+fulfilled, ships to store, no shipping charge', () => {
  const payload = buildOtcPayload({
    store: 'US',
    skus: [SKU_A],
    prices: { [SKU_A]: 100 },
    externalId: 'QAOTC_123_abc',
    placedAt: '2026-07-31T00:00:00Z',
  });

  assert.equal(payload.is_preconfirmed, true);
  assert.equal(payload.is_fulfilled, true);
  assert.equal(payload.channel_name, 'BRANCH_407');
  assert.equal(payload.shipping_address.address_line_1, 'BRANCH_407, Westfield Chermside, 395 Hamilton Road');
  assert.equal(payload.shipments[0].shipping_option.price, 0);
  assert.equal(payload.shipments[0].shipping_option.tax, 0);
  // total = 100 (item only, no shipping) = 100
  assert.equal(payload.payments[0].amount, 100);
});

test('buildSfsPayload sums duplicate SKUs the correct number of times', () => {
  const payload = buildSfsPayload({
    store: 'US',
    skus: [SKU_A, SKU_A, SKU_A],
    prices: { [SKU_A]: 50 },
    externalId: 'QASFS_123_abc',
    placedAt: '2026-07-31T00:00:00Z',
  });

  assert.equal(payload.shipments[0].items.length, 3, 'Shopify merges duplicate line items; NewStore items must not');
  // total = 50*3 (items) + 9.99 (shipping) = 159.99
  assert.equal(payload.payments[0].amount, 159.99);
  assert.deepEqual(
    payload.shipments[0].items.map((i) => i.external_item_id),
    ['ITEM_1_32625134', 'ITEM_2_32625134', 'ITEM_3_32625134'],
  );
});

test('buildSfsPayload/buildOtcPayload attach a GST tax line per item', () => {
  const payload = buildSfsPayload({
    store: 'US',
    skus: [SKU_A],
    prices: { [SKU_A]: 110 },
    externalId: 'QASFS_1_a',
    placedAt: '2026-07-31T00:00:00Z',
  });
  const taxLine = payload.shipments[0].items[0].price.item_tax_lines[0];
  assert.equal(taxLine.name, 'GST');
  assert.equal(taxLine.amount, 10);
  assert.equal(taxLine.rate, 0.1);
  assert.equal(taxLine.country_code, 'AU');
});

test('injectSfsOrder looks up real prices, posts to fulfill_order, and returns the external id + response', async () => {
  const newstore = fakeNewStore({ id: 'ns-order-1', external_id: 'ignored-should-use-returned-external-id' });
  const shopify = fakePrices({ [GID_A]: 75 });

  const result = await injectSfsOrder('US', [SKU_A], { newstore, shopify });

  assert.match(result.externalId, /^QASFS_/);
  assert.equal(newstore.calls.length, 1);
  assert.equal(newstore.calls[0].path, '/v0/d/fulfill_order');
  assert.equal(newstore.calls[0].payload.external_id, result.externalId);
  assert.equal(newstore.calls[0].payload.shipments[0].items[0].price.item_price, 75);
  assert.deepEqual(result.response, { id: 'ns-order-1', external_id: 'ignored-should-use-returned-external-id' });
});

test('injectOtcOrder looks up real prices and posts a preconfirmed OTC payload', async () => {
  const newstore = fakeNewStore({ id: 'ns-order-2' });
  const shopify = fakePrices({ [GID_PS]: 40 });

  const result = await injectOtcOrder('PS', [SKU_PS], { newstore, shopify });

  assert.match(result.externalId, /^QAOTC_/);
  assert.equal(newstore.calls[0].payload.is_preconfirmed, true);
  assert.equal(newstore.calls[0].payload.store_id, 'BRANCH_640');
});

test('injection throws — no fallback — when a SKU is not in the store variant map', async () => {
  const newstore = fakeNewStore({});
  const shopify = fakePrices({});

  await assert.rejects(
    () => injectSfsOrder('US', ['00000000'], { newstore, shopify }),
    /not in US variant map/,
  );
  assert.equal(newstore.calls?.length ?? 0, 0, 'must not inject once pricing fails');
});

test('injection throws — no fallback — when Shopify has no price for a known SKU', async () => {
  const newstore = fakeNewStore({});
  const shopify = fakePrices({}); // GID_A resolves to nothing

  await assert.rejects(
    () => injectSfsOrder('US', [SKU_A], { newstore, shopify }),
    /Shopify returned no price for SKU 32625134/,
  );
});

test('injectSfsOrder/injectOtcOrder reject an empty SKU list', async () => {
  await assert.rejects(() => injectSfsOrder('US', []), /at least one SKU/);
  await assert.rejects(() => injectOtcOrder('US', []), /at least one SKU/);
});
