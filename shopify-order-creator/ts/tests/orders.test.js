const test = require('node:test');
const assert = require('node:assert/strict');
const { skuQuantities, orderIdTail } = require('../dist/readers/shopifyReader.js');
const { assertShopifyOrder, assertOrdersTableAlignment } = require('../dist/verify/orders.js');

function snapshot(lineItems, financialStatus = 'PAID') {
  return { id: 'gid://shopify/Order/123', name: '#123', financialStatus, lineItems, refunds: [] };
}

test('skuQuantities merges a duplicate line item (Shopify collapses 3x same SKU into one line)', () => {
  const snap = snapshot([{ sku: 'sku1', quantity: 3, unitPrice: 10 }]);
  assert.deepEqual(skuQuantities(snap), { sku1: 3 });
});

test('skuQuantities sums separate line items for the same sku (defensive - Dynamo never merges, Shopify usually does)', () => {
  const snap = snapshot([
    { sku: 'sku1', quantity: 1, unitPrice: 10 },
    { sku: 'sku1', quantity: 2, unitPrice: 10 },
  ]);
  assert.deepEqual(skuQuantities(snap), { sku1: 3 });
});

test('orderIdTail extracts the numeric id from a Shopify order GID', () => {
  assert.equal(orderIdTail('gid://shopify/Order/7772060320017'), '7772060320017');
});

test('assertShopifyOrder passes for a paid order whose merged line items match the order', () => {
  const snap = snapshot([{ sku: 'sku1', quantity: 3, unitPrice: 10 }]);
  assert.doesNotThrow(() => assertShopifyOrder(snap, { sku1: 3 }));
});

test('assertShopifyOrder throws shopify.financial_status for an unpaid order', () => {
  const snap = snapshot([{ sku: 'sku1', quantity: 1, unitPrice: 10 }], 'PENDING');
  assert.throws(() => assertShopifyOrder(snap, { sku1: 1 }), /shopify\.financial_status/);
});

test('assertShopifyOrder throws shopify.line_items when merged quantities disagree with the order', () => {
  const snap = snapshot([{ sku: 'sku1', quantity: 2, unitPrice: 10 }]);
  assert.throws(() => assertShopifyOrder(snap, { sku1: 3 }), /shopify\.line_items/);
});

test('assertOrdersTableAlignment passes when staging-orders-v2 sku/qty matches the order exactly', () => {
  assert.doesNotThrow(() => assertOrdersTableAlignment({ sku1: 3 }, { sku1: 3 }, '#123'));
});

test('assertOrdersTableAlignment throws orders_table.items on mismatch', () => {
  assert.throws(() => assertOrdersTableAlignment({ sku1: 2 }, { sku1: 3 }, '#123'), /orders_table\.items/);
});
