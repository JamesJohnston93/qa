const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { skuQuantities, orderIdTail, fulfilmentSkuQuantities } = require('../dist/readers/shopifyReader.js');
const {
  assertShopifyOrder,
  assertOrdersTableAlignment,
  assertPaymentsSumToGrandTotal,
  assertBothAddressesPresent,
  assertItemDelivery,
} = require('../dist/verify/orders.js');
const { orderRecordFromRows, addressRowsFromRows, orderItemRowsFromRows } = require('../dist/readers/dynamoReader.js');

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

function fulfilment(items, overrides = {}) {
  return { id: 'gid://shopify/Fulfillment/1', status: 'SUCCESS', locationId: null, locationName: null, items, ...overrides };
}

test('fulfilmentSkuQuantities merges a duplicate line item within one fulfilment (same Shopify merge as order-level line items)', () => {
  const f = fulfilment([{ sku: 'sku1', quantity: 3 }]);
  assert.deepEqual(fulfilmentSkuQuantities(f), { sku1: 3 });
});

test('fulfilmentSkuQuantities sums separate fulfillmentLineItems for the same sku', () => {
  const f = fulfilment([
    { sku: 'sku1', quantity: 1 },
    { sku: 'sku1', quantity: 2 },
  ]);
  assert.deepEqual(fulfilmentSkuQuantities(f), { sku1: 3 });
});

test('fulfilmentSkuQuantities ignores a line item with no sku (e.g. a deleted variant) rather than keying on "null"', () => {
  const f = fulfilment([
    { sku: null, quantity: 1 },
    { sku: 'sku1', quantity: 1 },
  ]);
  assert.deepEqual(fulfilmentSkuQuantities(f), { sku1: 1 });
});

// TAA-52 additions — fixture-driven, same fixtures as tests/dynamoReader.test.js and tests/holds.test.js.
{
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
  const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

  test('assertPaymentsSumToGrandTotal passes when paymentMethod amounts sum to grandTotal (order #9994: 60 = 60)', () => {
    const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
    assert.doesNotThrow(() => assertPaymentsSumToGrandTotal(record, '#9994'));
  });

  // FINDING, confirmed live (not just this fixture): this is ONLY true for a
  // fully-paid order. Order #9998 is held for OUTSTANDING_PAYMENT precisely
  // because grandTotal (119) exceeds what's been paid (70) — the assertion
  // legitimately throws here, and that throw IS the same fact the hold
  // reports. See verify/orders.ts's doc comment on this function.
  test('assertPaymentsSumToGrandTotal throws on order #9998, which is genuinely under-paid (held for OUTSTANDING_PAYMENT)', () => {
    const record = orderRecordFromRows(loadFixture('US-hold-outstanding-edit-9998.json'));
    assert.throws(() => assertPaymentsSumToGrandTotal(record, '#9998'), (err) => {
      assert.match(err.message, /orders_table\.payments_sum/);
      assert.equal(err.expected, 119);
      assert.equal(err.actual, 70);
      return true;
    });
  });

  test('assertPaymentsSumToGrandTotal throws orders_table.payments_sum on a mismatched sum', () => {
    const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
    const broken = { ...record, grandTotal: record.grandTotal + 1 };
    assert.throws(() => assertPaymentsSumToGrandTotal(broken, '#9994'), (err) => {
      assert.match(err.message, /orders_table\.payments_sum/);
      assert.equal(err.expected, record.grandTotal + 1);
      assert.equal(err.actual, record.grandTotal);
      return true;
    });
  });

  test('assertBothAddressesPresent passes when both SHIPPING and BILLING rows exist (order #9997)', () => {
    const addresses = addressRowsFromRows(loadFixture('US-clickcollect-9997.json'));
    assert.doesNotThrow(() => assertBothAddressesPresent(addresses, '#9997'));
  });

  test('assertBothAddressesPresent throws orders_table.addresses_present when one address type is missing', () => {
    const addresses = addressRowsFromRows(loadFixture('US-clickcollect-9997.json')).filter((a) => a.type !== 'BILLING');
    assert.throws(() => assertBothAddressesPresent(addresses, '#9997'), /orders_table\.addresses_present/);
  });

  test('assertItemDelivery passes for a CLICKCOLLECT item with its store number (order #9997)', () => {
    const [item] = orderItemRowsFromRows(loadFixture('US-clickcollect-9997.json'));
    assert.doesNotThrow(() => assertItemDelivery(item, 'CLICKCOLLECT', '251', '#9997'));
  });

  test('assertItemDelivery passes for a STANDARD item with a null clickCollectStore (order #9994)', () => {
    const items = orderItemRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
    const [item] = items;
    assert.doesNotThrow(() => assertItemDelivery(item, 'STANDARD', null, '#9994'));
  });

  test('assertItemDelivery throws orders_table.item_delivery_method on a deliveryMethod mismatch', () => {
    const [item] = orderItemRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
    assert.throws(() => assertItemDelivery(item, 'CLICKCOLLECT', null, '#9994'), /orders_table\.item_delivery_method/);
  });

  test('assertItemDelivery throws orders_table.item_click_collect_store when the store number is wrong', () => {
    const [item] = orderItemRowsFromRows(loadFixture('US-clickcollect-9997.json'));
    assert.throws(
      () => assertItemDelivery(item, 'CLICKCOLLECT', '999', '#9997'),
      /orders_table\.item_click_collect_store/,
    );
  });
}
