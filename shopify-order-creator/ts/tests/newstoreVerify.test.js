const test = require('node:test');
const assert = require('node:assert/strict');
const { assertNewStoreOrder } = require('../dist/verify/newstore.js');

test('assertNewStoreOrder throws newstore.exists (retryable) when the snapshot is null', () => {
  assert.throws(
    () => assertNewStoreOrder(null, { A: 1 }, 'QASFS_1_abc'),
    (err) => err.name === 'VerificationError' && err.check === 'newstore.exists',
  );
});

test('assertNewStoreOrder passes when ordered_products exactly match the requested skus', () => {
  const snapshot = {
    orderUuid: 'uuid-1',
    orderId: 'ST1',
    orderedProducts: [{ productSku: 'A', quantity: 1, itemId: null }],
    raw: {},
  };
  assert.doesNotThrow(() => assertNewStoreOrder(snapshot, { A: 1 }, 'QASFS_1_abc'));
});

test('assertNewStoreOrder throws newstore.ordered_products on a sku/quantity mismatch', () => {
  const snapshot = {
    orderUuid: 'uuid-1',
    orderId: 'ST1',
    orderedProducts: [{ productSku: 'A', quantity: 2, itemId: null }],
    raw: {},
  };
  assert.throws(
    () => assertNewStoreOrder(snapshot, { A: 1 }, 'QASFS_1_abc'),
    (err) => err.name === 'VerificationError' && err.check === 'newstore.ordered_products',
  );
});
