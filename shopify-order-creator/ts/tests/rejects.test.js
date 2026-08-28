const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertAllUndeliverable,
  assertReallocatedOrUndeliverable,
  assertRejectTransactions,
} = require('../dist/verify/rejects.js');

function outcome(status, newShipmentId = null) {
  return { shipmentItemId: 'ITEM#1', wasListed: true, newShipmentId, store: null, status };
}

function transaction(event, shipmentItemInfo = []) {
  return { sortKey: `TRANSACTION#${Math.random()}`, event, shipmentItemInfo, raw: {} };
}

test('assertAllUndeliverable passes when every item resolved UNDELIVERABLE', () => {
  assert.doesNotThrow(() => assertAllUndeliverable([outcome('UNDELIVERABLE'), outcome('UNDELIVERABLE')], '#1'));
});

test('assertAllUndeliverable throws reject.outcome when any item did not resolve UNDELIVERABLE', () => {
  assert.throws(
    () => assertAllUndeliverable([outcome('UNDELIVERABLE'), outcome('ALLOCATED', 'ship-2')], '#1'),
    /reject\.outcome/,
  );
});

test('assertReallocatedOrUndeliverable passes when an item lands on a genuinely new shipment', () => {
  assert.doesNotThrow(() => assertReallocatedOrUndeliverable([outcome('ALLOCATED', 'ship-2')], 'ship-1', '#1'));
});

test('assertReallocatedOrUndeliverable passes when an item goes UNDELIVERABLE instead', () => {
  assert.doesNotThrow(() => assertReallocatedOrUndeliverable([outcome('UNDELIVERABLE')], 'ship-1', '#1'));
});

test('assertReallocatedOrUndeliverable throws when an item has no new shipment at all', () => {
  assert.throws(() => assertReallocatedOrUndeliverable([outcome('OPEN', null)], 'ship-1', '#1'), /reject\.outcome/);
});

test('assertReallocatedOrUndeliverable throws when an item is still on the rejected shipment', () => {
  assert.throws(() => assertReallocatedOrUndeliverable([outcome('ALLOCATED', 'ship-1')], 'ship-1', '#1'), /reject\.outcome/);
});

// reject_reallocate shape: one item listed, one SHIPMENT_REJECTED, one SHIPMENT_ITEM_REJECTED.
test('assertRejectTransactions passes for a single-listed-item reject (reject_reallocate shape)', () => {
  const transactions = [
    transaction('SHIPMENT_ITEM_CREATE'),
    transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }, { id: 'ITEM#b' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a', shipmentId: 'ship-1' }]),
    transaction('REALLOCATION'),
  ];
  assert.doesNotThrow(() => assertRejectTransactions(transactions, ['ITEM#a'], '#1'));
});

// reject_undeliverable shape: every item listed, one SHIPMENT_ITEM_REJECTED per item.
test('assertRejectTransactions passes for an every-item reject (reject_undeliverable shape)', () => {
  const transactions = [
    transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }, { id: 'ITEM#b' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#b' }]),
  ];
  assert.doesNotThrow(() => assertRejectTransactions(transactions, ['ITEM#a', 'ITEM#b'], '#1'));
});

test('assertRejectTransactions throws reject.transactions.shipment_rejected when SHIPMENT_REJECTED is missing', () => {
  const transactions = [transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a' }])];
  assert.throws(
    () => assertRejectTransactions(transactions, ['ITEM#a'], '#1'),
    /reject\.transactions\.shipment_rejected/,
  );
});

test('assertRejectTransactions throws reject.transactions.shipment_rejected when SHIPMENT_REJECTED appears more than once', () => {
  const transactions = [
    transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }]),
    transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a' }]),
  ];
  assert.throws(
    () => assertRejectTransactions(transactions, ['ITEM#a'], '#1'),
    /reject\.transactions\.shipment_rejected/,
  );
});

test('assertRejectTransactions throws reject.transactions.item_rejected when a listed item has no SHIPMENT_ITEM_REJECTED row', () => {
  const transactions = [transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }, { id: 'ITEM#b' }])];
  assert.throws(
    () => assertRejectTransactions(transactions, ['ITEM#a', 'ITEM#b'], '#1'),
    /reject\.transactions\.item_rejected/,
  );
});

test('assertRejectTransactions throws reject.transactions.item_rejected when a listed item has a duplicate SHIPMENT_ITEM_REJECTED row', () => {
  const transactions = [
    transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a' }]),
  ];
  assert.throws(
    () => assertRejectTransactions(transactions, ['ITEM#a'], '#1'),
    /reject\.transactions\.item_rejected/,
  );
});

test('assertRejectTransactions ignores SHIPMENT_ITEM_REJECTED rows for items that were not listed', () => {
  // Whole-shipment reject with only one item listed — an unlisted item's
  // SHIPMENT_ITEM_REJECTED row (if the backend ever fired one) must not be
  // required or counted against the listed item's own count.
  const transactions = [
    transaction('SHIPMENT_REJECTED', [{ id: 'ITEM#a' }, { id: 'ITEM#b' }]),
    transaction('SHIPMENT_ITEM_REJECTED', [{ id: 'ITEM#a' }]),
  ];
  assert.doesNotThrow(() => assertRejectTransactions(transactions, ['ITEM#a'], '#1'));
});
