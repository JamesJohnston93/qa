const test = require('node:test');
const assert = require('node:assert/strict');
const { assertRefundForSkus, assertNoRefund } = require('../dist/verify/refunds.js');

function snapshot(refunds) {
  return { id: 'gid://shopify/Order/1', name: '#1', financialStatus: 'PAID', lineItems: [], refunds };
}

test('assertRefundForSkus passes when the refund exactly covers the expected skus/quantities', () => {
  const snap = snapshot([{ id: 'r1', total: 50, items: [{ sku: 'sku1', quantity: 1 }] }]);
  assert.doesNotThrow(() => assertRefundForSkus(snap, { sku1: 1 }));
});

test('assertRefundForSkus sums quantities across multiple refunds for the same sku', () => {
  const snap = snapshot([
    { id: 'r1', total: 25, items: [{ sku: 'sku1', quantity: 1 }] },
    { id: 'r2', total: 25, items: [{ sku: 'sku1', quantity: 1 }] },
  ]);
  assert.doesNotThrow(() => assertRefundForSkus(snap, { sku1: 2 }));
});

test('assertRefundForSkus throws shopify.refund when no refund exists yet (still polling)', () => {
  assert.throws(() => assertRefundForSkus(snapshot([]), { sku1: 1 }), /shopify\.refund/);
});

test('assertRefundForSkus throws shopify.refund when the refunded skus do not match', () => {
  const snap = snapshot([{ id: 'r1', total: 50, items: [{ sku: 'sku2', quantity: 1 }] }]);
  assert.throws(() => assertRefundForSkus(snap, { sku1: 1 }), /shopify\.refund/);
});

test('assertNoRefund passes for a fully-allocated order with no refunds', () => {
  assert.doesNotThrow(() => assertNoRefund(snapshot([])));
});

test('assertNoRefund throws shopify.no_refund if a refund unexpectedly exists', () => {
  const snap = snapshot([{ id: 'r1', total: 50, items: [{ sku: 'sku1', quantity: 1 }] }]);
  assert.throws(() => assertNoRefund(snap), /shopify\.no_refund/);
});
