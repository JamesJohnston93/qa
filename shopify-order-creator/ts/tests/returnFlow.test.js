const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { diffReturnSnapshots, runReturnProbe, RETURN_PROBE_WAIT_SECONDS } = require('../dist/flows/returnFlow.js');
const { orderItemRowsFromRows, orderRecordFromRows, transactionRowsFromRows } = require('../dist/readers/dynamoReader.js');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

function snapshotFromRows(rows) {
  return {
    order: orderRecordFromRows(rows),
    items: orderItemRowsFromRows(rows),
    transactions: transactionRowsFromRows(rows),
  };
}

// US-taa57-return-noop-10005.json is the REAL live capture (TAA-57, order
// #10005, US) of returnCreate + returnClose against a fulfilled order: the
// Shopify-side mutations succeeded (return closed) but staging-orders-v2 had
// ZERO row change afterward — the null result TAA-53's earlier probe also
// found, now reconfirmed with a full ORDER+ITEM#+TRANSACTION# diff rather
// than a TRANSACTION#-only poll. See ts/signoffs/TAA-57.md.

test('diffReturnSnapshots: nothingChanged is true against the real pre/post return rows (identical — the honest null result)', () => {
  const rows = loadFixture('US-taa57-return-noop-10005.json');
  const snapshot = snapshotFromRows(rows);

  const diff = diffReturnSnapshots(snapshot, snapshot);

  assert.equal(diff.nothingChanged, true);
  assert.equal(diff.orderChanged, false);
  assert.deepEqual(diff.orderFieldsChanged, []);
  assert.equal(diff.itemRowsChanged, false);
  assert.deepEqual(diff.newTransactionSks, []);
});

test('diffReturnSnapshots: detects a new TRANSACTION# row by SK', () => {
  const rows = loadFixture('US-taa57-return-noop-10005.json');
  const before = snapshotFromRows(rows);
  const after = snapshotFromRows(rows);
  after.transactions = [
    ...before.transactions,
    { pk: before.transactions[0].pk, sk: 'TRANSACTION#9999999999999', event: 'REFUND_ITEM', category: 'REFUND', origin: '', idempotencyId: '', shipmentItemInfo: [], raw: {} },
  ];

  const diff = diffReturnSnapshots(before, after);

  assert.equal(diff.nothingChanged, false);
  assert.deepEqual(diff.newTransactionSks, ['TRANSACTION#9999999999999']);
});

test('diffReturnSnapshots: detects an ORDER row field change (e.g. onHold)', () => {
  const rows = loadFixture('US-taa57-return-noop-10005.json');
  const before = snapshotFromRows(rows);
  const after = snapshotFromRows(rows);
  after.order = { ...before.order, onHold: ['OUTSTANDING_PAYMENT'] };

  const diff = diffReturnSnapshots(before, after);

  assert.equal(diff.nothingChanged, false);
  assert.equal(diff.orderChanged, true);
  assert.ok(diff.orderFieldsChanged.includes('onHold'));
});

test('diffReturnSnapshots: detects an ITEM# row set change', () => {
  const rows = loadFixture('US-taa57-return-noop-10005.json');
  const before = snapshotFromRows(rows);
  const after = snapshotFromRows(rows);
  after.items = [...before.items, { ...before.items[0], sku: 'NEW-SKU' }];

  const diff = diffReturnSnapshots(before, after);

  assert.equal(diff.nothingChanged, false);
  assert.equal(diff.itemRowsChanged, true);
  assert.equal(diff.itemCountBefore, before.items.length);
  assert.equal(diff.itemCountAfter, after.items.length);
});

test('diffReturnSnapshots: reports the order row appearing (before null, after landed)', () => {
  const rows = loadFixture('US-taa57-return-noop-10005.json');
  const after = snapshotFromRows(rows);
  const before = { ...after, order: null };

  const diff = diffReturnSnapshots(before, after);

  assert.deepEqual(diff.orderFieldsChanged, ['(order row appeared)']);
  assert.equal(diff.orderChanged, true);
});

// --- runReturnProbe (fake admin/reader — no real 120s wait) -----------------

test('runReturnProbe: fires createReturn then closeReturn, captures before/after, and diffs — asserts nothing itself', async () => {
  const rows = loadFixture('US-taa57-return-noop-10005.json');
  const calls = [];
  const admin = {
    createReturn: async (orderId, lineItems) => {
      calls.push(['createReturn', orderId, lineItems]);
      return { returnId: 'gid://shopify/Return/1', name: '#1-R1', status: 'OPEN' };
    },
    closeReturn: async (returnId) => {
      calls.push(['closeReturn', returnId]);
      return { returnId, status: 'CLOSED', closedAt: '2026-01-01T00:00:00Z' };
    },
  };
  const reader = { getOrderRows: async () => rows };

  const result = await runReturnProbe(
    { admin, reader },
    'US',
    'gid://shopify/Order/10005',
    '7899544912145',
    [{ fulfillmentLineItemId: 'gid://shopify/FulfillmentLineItem/1', quantity: 1 }],
    0, // no real wait in the offline test
  );

  assert.deepEqual(
    calls.map((c) => c[0]),
    ['createReturn', 'closeReturn'],
  );
  assert.equal(result.createReturn.returnId, 'gid://shopify/Return/1');
  assert.equal(result.closeReturn.status, 'CLOSED');
  assert.equal(result.diff.nothingChanged, true); // before === after here (same fixture both times)
  assert.equal(result.waitedSeconds, 0);
});

test('RETURN_PROBE_WAIT_SECONDS matches the ordersService settle window this ticket sized (120s) — not an arbitrarily different number', () => {
  assert.equal(RETURN_PROBE_WAIT_SECONDS, 120);
});
