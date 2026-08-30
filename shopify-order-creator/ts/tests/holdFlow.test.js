const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  holdApplied,
  holdReleased,
  waitForHoldApplied,
  waitForHoldReleased,
  applyFraudHold,
  releaseFraudHold,
  applyOutstandingPaymentHold,
  releaseOutstandingPaymentHold,
  shopifyFulfillmentOrderResolver,
  POTENTIAL_FRAUD_REASON,
  OUTSTANDING_PAYMENT_REASON,
  FRAUD_HOLD_GRAPHQL_REASON,
} = require('../dist/flows/holdFlow.js');
const { orderRecordFromRows, transactionRowsFromRows } = require('../dist/readers/dynamoReader.js');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

// "Applied" fixtures are TAA-50's pre-existing, committed evidence (read-only
// to this ticket) — orders #9994 (fraud) and #9998 (outstanding payment),
// each snapshotted WHILE held. "Released" fixtures are captured live THIS
// ticket (TAA-57) — orders #10007 (US) and #10008 (US), each snapshotted
// AFTER the full on-to-off round trip. See ts/signoffs/TAA-57.md.

test('holdApplied: true against the real fraud-hold order #9994 (onHold + HOLD_ORDER row both present)', () => {
  const rows = loadFixture('US-hold-fraud-9994.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.equal(holdApplied(record, transactions, POTENTIAL_FRAUD_REASON), true);
});

test('holdApplied: true against the real outstanding-payment order #9998', () => {
  const rows = loadFixture('US-hold-outstanding-edit-9998.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.equal(holdApplied(record, transactions, OUTSTANDING_PAYMENT_REASON), true);
});

test('holdApplied: false if onHold contains the reason but no matching HOLD_ORDER row is present yet', () => {
  const rows = loadFixture('US-hold-fraud-9994.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows).filter((t) => t.event !== 'HOLD_ORDER');
  assert.equal(holdApplied(record, transactions, POTENTIAL_FRAUD_REASON), false);
});

test('holdApplied: false against an order not on hold at all', () => {
  const record = { status: 'OPEN', onHold: [], paymentMethod: [], subtotal: 0, grandTotal: 0, currency: null, customerId: '', raw: {} };
  assert.equal(holdApplied(record, [], POTENTIAL_FRAUD_REASON), false);
});

test('holdApplied: false against a null record (order not landed yet)', () => {
  assert.equal(holdApplied(null, [], POTENTIAL_FRAUD_REASON), false);
});

test('holdReleased: true against the real released fraud-hold order #10007 (onHold empty + UNHOLD_ORDER row present)', () => {
  const rows = loadFixture('US-taa57-hold-fraud-10007.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.deepEqual(record.onHold, []);
  assert.equal(holdReleased(record, transactions, POTENTIAL_FRAUD_REASON), true);
});

test('holdReleased: true against the real released outstanding-payment order #10008', () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.equal(holdReleased(record, transactions, OUTSTANDING_PAYMENT_REASON), true);
});

test('holdReleased: false while onHold still contains the reason (order #9994, never released)', () => {
  const rows = loadFixture('US-hold-fraud-9994.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.equal(holdReleased(record, transactions, POTENTIAL_FRAUD_REASON), false);
});

test('holdReleased: false if onHold no longer contains the reason but no UNHOLD_ORDER row names it yet', () => {
  const rows = loadFixture('US-taa57-hold-fraud-10007.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows).filter((t) => t.event !== 'UNHOLD_ORDER');
  assert.equal(holdReleased(record, transactions, POTENTIAL_FRAUD_REASON), false);
});

test('FRAUD_HOLD_GRAPHQL_REASON and POTENTIAL_FRAUD_REASON are deliberately different strings (GraphQL input vs DynamoDB reason, TAA-53)', () => {
  assert.equal(FRAUD_HOLD_GRAPHQL_REASON, 'HIGH_RISK_OF_FRAUD');
  assert.equal(POTENTIAL_FRAUD_REASON, 'POTENTIAL_FRAUD');
  assert.notEqual(FRAUD_HOLD_GRAPHQL_REASON, POTENTIAL_FRAUD_REASON);
});

// --- waitForHoldApplied/Released (fake reader — no network) ----------------

test('waitForHoldApplied: resolves via the reader, deriving record/transactions off one getOrderRows call', async () => {
  const rows = loadFixture('US-hold-fraud-9994.json');
  let calls = 0;
  const reader = { getOrderRows: async () => { calls += 1; return rows; } };

  const result = await waitForHoldApplied(reader, 'US', '7899319173393', POTENTIAL_FRAUD_REASON);

  assert.equal(calls, 1);
  assert.deepEqual(result.value.record.onHold, ['POTENTIAL_FRAUD']);
});

test('waitForHoldReleased: resolves via the reader for an already-released order', async () => {
  const rows = loadFixture('US-taa57-hold-fraud-10007.json');
  const reader = { getOrderRows: async () => rows };

  const result = await waitForHoldReleased(reader, 'US', '7899547533585', POTENTIAL_FRAUD_REASON);

  assert.deepEqual(result.value.record.onHold, []);
});

// --- shopifyFulfillmentOrderResolver (fake ShopifyClient — no network) -----

test('shopifyFulfillmentOrderResolver: resolves the first fulfillmentOrders entry via getOrder', async () => {
  // getOrder() only touches shopify.execute() — a fake exposing just that
  // method is enough, same duck-typing fulfilFlow.ts's own tests use for reader fakes.
  const fakeShopify = {
    execute: async () => ({
      data: {
        node: {
          id: 'gid://shopify/Order/1',
          name: '#1',
          displayFinancialStatus: 'PAID',
          lineItems: { edges: [] },
          refunds: [],
          fulfillments: [],
          fulfillmentOrders: { edges: [{ node: { id: 'gid://shopify/FulfillmentOrder/99', status: 'OPEN', fulfillmentHolds: [] } }] },
        },
      },
    }),
  };

  const resolver = shopifyFulfillmentOrderResolver(fakeShopify);
  const id = await resolver.resolveFulfillmentOrderId('gid://shopify/Order/1');
  assert.equal(id, 'gid://shopify/FulfillmentOrder/99');
});

test('shopifyFulfillmentOrderResolver: throws if the order has no fulfillmentOrders', async () => {
  const fakeShopify = {
    execute: async () => ({
      data: {
        node: {
          id: 'gid://shopify/Order/1',
          name: '#1',
          displayFinancialStatus: 'PAID',
          lineItems: { edges: [] },
          refunds: [],
          fulfillments: [],
          fulfillmentOrders: { edges: [] },
        },
      },
    }),
  };

  const resolver = shopifyFulfillmentOrderResolver(fakeShopify);
  await assert.rejects(() => resolver.resolveFulfillmentOrderId('gid://shopify/Order/1'), /no fulfillmentOrders/);
});

// --- applyFraudHold / releaseFraudHold (fake admin/reader — no network) ----

test('applyFraudHold: sends the GraphQL enum HIGH_RISK_OF_FRAUD and waits for the DynamoDB POTENTIAL_FRAUD state', async () => {
  const rows = loadFixture('US-hold-fraud-9994.json');
  let holdCall;
  const admin = {
    holdFulfillmentOrder: async (fulfillmentOrderId, reason, reasonNotes) => {
      holdCall = { fulfillmentOrderId, reason, reasonNotes };
      return { fulfillmentHoldId: 'fh1', fulfillmentOrderId, status: 'ON_HOLD' };
    },
  };
  const reader = { getOrderRows: async () => rows };
  const fulfillmentOrders = { resolveFulfillmentOrderId: async () => 'gid://shopify/FulfillmentOrder/1' };

  const result = await applyFraudHold({ admin, reader, fulfillmentOrders }, 'US', 'gid://shopify/Order/9994', '7899319173393', 'note');

  assert.equal(holdCall.reason, 'HIGH_RISK_OF_FRAUD');
  assert.equal(holdCall.reasonNotes, 'note');
  assert.equal(result.reason, POTENTIAL_FRAUD_REASON);
  assert.equal(result.fulfillmentHoldId, 'fh1');
});

test('releaseFraudHold: calls releaseHold and waits for the released state', async () => {
  const rows = loadFixture('US-taa57-hold-fraud-10007.json');
  let releaseCalledWith;
  const admin = {
    releaseHold: async (fulfillmentOrderId) => {
      releaseCalledWith = fulfillmentOrderId;
      return { fulfillmentOrderId, status: 'OPEN' };
    },
  };
  const reader = { getOrderRows: async () => rows };

  const result = await releaseFraudHold({ admin, reader }, 'US', '7899547533585', 'gid://shopify/FulfillmentOrder/1');

  assert.equal(releaseCalledWith, 'gid://shopify/FulfillmentOrder/1');
  assert.equal(result.reason, POTENTIAL_FRAUD_REASON);
});

// --- applyOutstandingPaymentHold / release (fake admin/reader) --------------

test('applyOutstandingPaymentHold: composes editFlow.addItemToOrder then waits for the automatic hold', async () => {
  // US-taa57-hold-outstanding-10008.json is the FINAL live-captured state
  // (already released, onHold: []) — using it as-is here would make
  // holdApplied never observe the reason and burn the full real poll
  // timeout (caught by this test itself failing that way on the first
  // write). Reconstructing the mid-hold intermediate state (onHold still
  // set, UNHOLD_ORDER not yet landed) is the correct fixture-derived input
  // for THIS predicate; US-hold-fraud-9994.json's sibling
  // US-hold-outstanding-edit-9998.json fixture (TAA-50, a different order)
  // already covers the real "applied" snapshot directly, see holdApplied's
  // own tests above.
  const finalRows = loadFixture('US-taa57-hold-outstanding-10008.json');
  const rows = finalRows
    .filter((row) => row.SK !== 'TRANSACTION#1788069733100') // the real UNHOLD_ORDER row — not yet landed at this point in the flow
    .map((row) => (row.SK === 'ORDER' ? { ...row, onHold: ['OUTSTANDING_PAYMENT'] } : row));
  const calls = [];
  const admin = {
    beginEdit: async () => ({ calculatedOrderId: 'calc1', lineItems: [] }),
    editAddVariant: async () => {
      calls.push('editAddVariant');
      return { calculatedLineItemId: 'cli1', quantity: 1 };
    },
    commitEdit: async () => {
      calls.push('commitEdit');
      return { orderId: 'gid://shopify/Order/10008', orderName: '#10008', edited: true };
    },
  };
  const reader = { getOrderRows: async () => rows };

  const result = await applyOutstandingPaymentHold(
    { admin, reader },
    'US',
    'gid://shopify/Order/10008',
    '7899548811537',
    'gid://shopify/ProductVariant/1',
    '33773476',
  );

  assert.deepEqual(calls, ['editAddVariant', 'commitEdit']);
  assert.equal(result.edit.addedSku, '33773476');
  assert.equal(result.reason, OUTSTANDING_PAYMENT_REASON);
});

test('releaseOutstandingPaymentHold: calls markAsPaid and waits for the released state', async () => {
  const rows = loadFixture('US-taa57-hold-outstanding-10008.json');
  let markPaidCalledWith;
  const admin = {
    markAsPaid: async (orderId) => {
      markPaidCalledWith = orderId;
      return { orderId, name: '#10008', financialStatus: 'PAID' };
    },
  };
  const reader = { getOrderRows: async () => rows };

  const result = await releaseOutstandingPaymentHold({ admin, reader }, 'US', 'gid://shopify/Order/10008', '7899548811537');

  assert.equal(markPaidCalledWith, 'gid://shopify/Order/10008');
  assert.equal(result.reason, OUTSTANDING_PAYMENT_REASON);
});
