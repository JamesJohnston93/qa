const test = require('node:test');
const assert = require('node:assert/strict');
const { reallocationResolved, waitForReallocation, rejectShipment } = require('../dist/flows/rejectFlow.js');

function item(shipmentItemId, shipmentId, status = 'ALLOCATED') {
  return { sku: '33775371', store: null, status, rejectedStores: [], shipmentItemId, shipmentId, raw: {} };
}

// Fixtures below are the REAL observed rows from order #9949 (TAA-31 slice A,
// see ts/signoffs/TAA-31-slice-a.md) — the order whose naive "unchanged for
// N ticks" heuristic falsely declared settlement while both items were still
// sitting unallocated.
const ORIGINAL_SHIPMENT_ID = 'f65fa9d6-f805-4b82-99f8-40168a802d1d';
const ITEM_A = 'ITEM#1bfa3c31-9f14-4002-9a53-bd28f8322c8f';
const ITEM_B = 'ITEM#847c820c-7ca2-444d-859a-8c88ed664dc9';
const ORIGINAL_ITEM_IDS = [ITEM_A, ITEM_B];

const INTERMEDIATE_SNAPSHOT_9949 = [
  item(ITEM_A, null, 'OPEN'),
  item(ITEM_B, null, 'OPEN'),
];

const RESOLVED_SNAPSHOT_9949 = [
  item(ITEM_A, 'a725e9a3-9390-4314-8865-5b2078b62b30'),
  item(ITEM_B, '45553295-9a55-4c95-9f14-8a1a17f92686'),
];

test('reallocationResolved: false against the real order #9949 intermediate snapshot (both items returned to the allocator, not yet re-picked-up)', () => {
  assert.equal(reallocationResolved(INTERMEDIATE_SNAPSHOT_9949, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), false);
});

test('reallocationResolved: true against the real order #9949 final resolved snapshot', () => {
  assert.equal(reallocationResolved(RESOLVED_SNAPSHOT_9949, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), true);
});

test('reallocationResolved: false if only one of the two original items has resolved', () => {
  const partial = [item(ITEM_A, 'a725e9a3-9390-4314-8865-5b2078b62b30'), item(ITEM_B, null, 'OPEN')];
  assert.equal(reallocationResolved(partial, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), false);
});

test('reallocationResolved: false if an item still points at the rejected shipment itself', () => {
  const stale = [item(ITEM_A, ORIGINAL_SHIPMENT_ID), item(ITEM_B, '45553295-9a55-4c95-9f14-8a1a17f92686')];
  assert.equal(reallocationResolved(stale, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), false);
});

test('reallocationResolved: false if an original item row is missing entirely', () => {
  const missing = [item(ITEM_A, 'a725e9a3-9390-4314-8865-5b2078b62b30')];
  assert.equal(reallocationResolved(missing, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), false);
});

test('reallocationResolved: UNDELIVERABLE counts as resolved even with shipmentId null (no valid store remains)', () => {
  const undeliverable = [
    item(ITEM_A, null, 'UNDELIVERABLE'),
    item(ITEM_B, '45553295-9a55-4c95-9f14-8a1a17f92686'),
  ];
  assert.equal(reallocationResolved(undeliverable, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), true);
});

test('reallocationResolved: ignores unrelated items on the same order', () => {
  const withExtra = [...RESOLVED_SNAPSHOT_9949, item('ITEM#unrelated', 'some-other-shipment')];
  assert.equal(reallocationResolved(withExtra, ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID), true);
});

// --- waitForReallocation (fake reader — no network) -------------------------
//
// Only a same-tick wiring check here: does it plug reallocationResolved and
// getShipmentItemsByPk into pollUntil correctly? The retry/timeout mechanics
// of pollUntil itself (including the real-sleep-driven "keeps polling past a
// false result" case) already have their own fast, dedicated tests in
// tests/polling.test.js with tiny injected windows — REALLOCATION_SETTLE_
// WINDOW_SECONDS (240s) is a real module constant here, not test-injectable,
// so re-proving retry behaviour through this wrapper would cost real wall
// time for no new coverage.

test('waitForReallocation: resolves via the reader, returning the settled items when already resolved', async () => {
  const reader = { getShipmentItemsByPk: async () => RESOLVED_SNAPSHOT_9949 };

  const result = await waitForReallocation(reader, 'pk1', ORIGINAL_ITEM_IDS, ORIGINAL_SHIPMENT_ID);

  assert.deepEqual(result.value, RESOLVED_SNAPSHOT_9949);
});

// --- rejectShipment (fake reader/reject client — no network) ---------------
//
// Fixtures mirror the REAL live-confirmed happy path (TAA-31 slice D, order
// #9953): two items on one shipment @ store 100, one rejected, both resolve
// onto a single new shipment @ store 99 (a harness-controlled backup store
// topped up fresh immediately before the reject call — see
// ts/signoffs/TAA-31-slice-d.md for why ambient real stock can't be relied
// on for this SKU).

function summary(shipmentId, overrides = {}) {
  return {
    shipmentId,
    allocatedStore: '100',
    status: 'OPEN',
    trackingNumber: null,
    carrier: 'AUSPOST',
    pendingAction: null,
    raw: {},
    ...overrides,
  };
}

const SHIP_ORIGINAL = 'f92ffc14-fe54-4406-8661-71021be15a4c';
const SHIP_NEW = 'c6d6701f-dd2b-4220-983b-b25f82440bf0';
const ITEM_LISTED = 'ITEM#90041928-fc6b-4520-9866-f15638a88ca1';
const ITEM_UNLISTED = 'ITEM#ea5f7075-98f6-490f-8c7d-7483b106bd07';

function makeHappyPathReader() {
  let itemCalls = 0;
  return {
    getShipmentItemsByPk: async () => {
      itemCalls += 1;
      if (itemCalls === 1) {
        return [item(ITEM_LISTED, SHIP_ORIGINAL), item(ITEM_UNLISTED, SHIP_ORIGINAL)];
      }
      const resolved = [
        { ...item(ITEM_LISTED, SHIP_NEW), store: '99', rejectedStores: ['100'] },
        { ...item(ITEM_UNLISTED, SHIP_NEW), store: '99' },
      ];
      return resolved;
    },
    getShipmentsByPk: async () => [summary(SHIP_ORIGINAL, { status: 'OPEN' })],
  };
}

test('rejectShipment: happy path rejects the listed item, both original items resolve onto the new shipment', async () => {
  const reader = makeHappyPathReader();
  let rejectPayload;
  const rejectClient = {
    reject: async (payload) => {
      rejectPayload = payload;
      return { code: 200, message: 'success', data: { message: 'Shipment Item(s) rejected successfully.' } };
    },
  };

  const result = await rejectShipment({ reader, rejectClient }, 'pk1', SHIP_ORIGINAL, [ITEM_LISTED]);

  assert.equal(rejectPayload.shipment_id, SHIP_ORIGINAL);
  assert.deepEqual(rejectPayload.rejected_items, [{ shipment_item_id: ITEM_LISTED, rejection_reason: 'FAULTY' }]);
  assert.equal(result.items.length, 2);

  const listed = result.items.find((i) => i.shipmentItemId === ITEM_LISTED);
  const unlisted = result.items.find((i) => i.shipmentItemId === ITEM_UNLISTED);
  assert.equal(listed.wasListed, true);
  assert.equal(unlisted.wasListed, false);
  assert.equal(listed.newShipmentId, SHIP_NEW);
  assert.equal(unlisted.newShipmentId, SHIP_NEW);
  assert.notEqual(listed.newShipmentId, SHIP_ORIGINAL);
});

test('rejectShipment: throws and never calls reject() against an already-FULFILLED shipment (JJ: never valid post-fulfilment)', async () => {
  const reader = {
    getShipmentItemsByPk: async () => [item(ITEM_LISTED, SHIP_ORIGINAL), item(ITEM_UNLISTED, SHIP_ORIGINAL)],
    getShipmentsByPk: async () => [summary(SHIP_ORIGINAL, { status: 'FULFILLED', trackingNumber: 'AP123' })],
  };
  let rejectCalled = false;
  const rejectClient = { reject: async () => { rejectCalled = true; } };

  await assert.rejects(
    () => rejectShipment({ reader, rejectClient }, 'pk1', SHIP_ORIGINAL, [ITEM_LISTED]),
    /never valid on a fulfilled shipment/,
  );
  assert.equal(rejectCalled, false, 'must not call reject() against a fulfilled shipment');
});

test('rejectShipment: throws if no items are found on the given shipment', async () => {
  const reader = {
    getShipmentItemsByPk: async () => [item(ITEM_LISTED, 'some-other-shipment')],
    getShipmentsByPk: async () => [],
  };
  const rejectClient = { reject: async () => ({ code: 200, message: 'success', data: { message: '' } }) };

  await assert.rejects(
    () => rejectShipment({ reader, rejectClient }, 'pk1', SHIP_ORIGINAL, [ITEM_LISTED]),
    /No items found on shipment/,
  );
});

test('rejectShipment: reports UNDELIVERABLE outcomes when no valid store remains', async () => {
  let itemCalls = 0;
  const reader = {
    getShipmentItemsByPk: async () => {
      itemCalls += 1;
      if (itemCalls === 1) {
        return [item(ITEM_LISTED, SHIP_ORIGINAL), item(ITEM_UNLISTED, SHIP_ORIGINAL)];
      }
      return [item(ITEM_LISTED, null, 'UNDELIVERABLE'), item(ITEM_UNLISTED, null, 'UNDELIVERABLE')];
    },
    getShipmentsByPk: async () => [summary(SHIP_ORIGINAL, { status: 'OPEN' })],
  };
  const rejectClient = { reject: async () => ({ code: 200, message: 'success', data: { message: '' } }) };

  const result = await rejectShipment({ reader, rejectClient }, 'pk1', SHIP_ORIGINAL, [ITEM_LISTED]);

  assert.ok(result.items.every((i) => i.status === 'UNDELIVERABLE'));
  assert.ok(result.items.every((i) => i.newShipmentId === null));
});
