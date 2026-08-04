const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrderByExternalId, skuQuantities } = require('../dist/readers/newstoreReader.js');

function fakeClient(impl) {
  return { get: impl };
}

test('getOrderByExternalId returns null on a 404 (order not propagated yet)', async () => {
  const client = fakeClient(async () => {
    throw new Error('NewStore request failed: 404 STATUS_404 — {"error_code":"invalid_external_id"}');
  });

  const snapshot = await getOrderByExternalId(client, 'QASFS_1_abc');
  assert.equal(snapshot, null);
});

test('getOrderByExternalId re-throws a non-404 error (real failure, not propagation delay)', async () => {
  const client = fakeClient(async () => {
    throw new Error('NewStore request failed: 500 STATUS_500 — {"error":"broken"}');
  });

  await assert.rejects(() => getOrderByExternalId(client, 'QASFS_1_abc'), /500/);
});

test('getOrderByExternalId parses ordered_products into the normalized snapshot shape', async () => {
  const client = fakeClient(async () => ({
    order_uuid: 'uuid-1',
    order_id: 'ST123',
    ordered_products: [
      { product_sku: '32625134', quantity: 1, item_id: 'item-1' },
      { product_sku: '32357875', quantity: 2 },
    ],
  }));

  const snapshot = await getOrderByExternalId(client, 'QASFS_1_abc');
  assert.equal(snapshot.orderUuid, 'uuid-1');
  assert.equal(snapshot.orderId, 'ST123');
  assert.deepEqual(snapshot.orderedProducts, [
    { productSku: '32625134', quantity: 1, itemId: 'item-1' },
    { productSku: '32357875', quantity: 2, itemId: null },
  ]);
});

test('getOrderByExternalId throws if the response has no order_uuid (malformed, not a propagation delay)', async () => {
  const client = fakeClient(async () => ({ ordered_products: [] }));

  await assert.rejects(() => getOrderByExternalId(client, 'QASFS_1_abc'), /missing order_uuid/);
});

test('getOrderByExternalId throws on a malformed ordered_products entry', async () => {
  const client = fakeClient(async () => ({
    order_uuid: 'uuid-1',
    ordered_products: [{ quantity: 1 }], // missing product_sku
  }));

  await assert.rejects(() => getOrderByExternalId(client, 'QASFS_1_abc'), /malformed ordered_products/);
});

test('skuQuantities sums quantity per SKU (NewStore does not merge duplicate entries like Shopify)', () => {
  const snapshot = {
    orderUuid: 'uuid-1',
    orderId: 'ST123',
    orderedProducts: [
      { productSku: 'A', quantity: 1, itemId: null },
      { productSku: 'A', quantity: 2, itemId: null },
      { productSku: 'B', quantity: 1, itemId: null },
    ],
    raw: {},
  };
  assert.deepEqual(skuQuantities(snapshot), { A: 3, B: 1 });
});
