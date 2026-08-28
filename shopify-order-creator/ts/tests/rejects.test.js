const test = require('node:test');
const assert = require('node:assert/strict');
const { assertAllUndeliverable, assertReallocatedOrUndeliverable } = require('../dist/verify/rejects.js');

function outcome(status, newShipmentId = null) {
  return { shipmentItemId: 'ITEM#1', wasListed: true, newShipmentId, store: null, status };
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
