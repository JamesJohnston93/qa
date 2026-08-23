const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expectedShipmentAllocations,
  matchFulfilmentsToShipments,
  assertFulfilmentLocations,
  assertNoFulfilmentForUndeliverable,
  assertAllocationReflection,
} = require('../dist/verify/allocation.js');
const { US_STORE_LOCATIONS } = require('../dist/locations.js');

function item(sku, store, status, shipmentId, shipmentItemId) {
  return {
    sku,
    store,
    status,
    rejectedStores: [],
    shipmentItemId: shipmentItemId ?? `ITEM#${sku}-${store}`,
    shipmentId,
    raw: {},
  };
}

function fulfilment(items, overrides = {}) {
  return { id: 'gid://shopify/Fulfillment/1', status: 'SUCCESS', locationId: null, locationName: null, items, ...overrides };
}

// --- expectedShipmentAllocations ---

test('expectedShipmentAllocations groups items by shipmentId and sums units per sku', () => {
  const items = [
    item('sku1', '100', 'ALLOCATED', 'ship-a'),
    item('sku1', '100', 'ALLOCATED', 'ship-a'),
    item('sku2', '99', 'ALLOCATED', 'ship-b'),
  ];
  const expected = expectedShipmentAllocations(items);
  assert.equal(expected.length, 2);
  const shipA = expected.find((s) => s.shipmentId === 'ship-a');
  const shipB = expected.find((s) => s.shipmentId === 'ship-b');
  assert.deepEqual(shipA.skuUnits, { sku1: 2 });
  assert.equal(shipA.allocatedStore, '100');
  assert.deepEqual(shipB.skuUnits, { sku2: 1 });
  assert.equal(shipB.allocatedStore, '99');
});

test('expectedShipmentAllocations excludes undeliverable items (no shipmentId) — no shipment expected for them', () => {
  const items = [
    item('sku1', '100', 'ALLOCATED', 'ship-a'),
    item('sku2', 'UNDELIVERABLE', 'UNDELIVERABLE', null),
  ];
  const expected = expectedShipmentAllocations(items);
  assert.equal(expected.length, 1);
  assert.equal(expected[0].shipmentId, 'ship-a');
});

test('expectedShipmentAllocations throws on an impossible state — a shipmentId with no real allocatedStore', () => {
  const items = [item('sku1', null, 'ALLOCATED', 'ship-a')];
  assert.throws(() => expectedShipmentAllocations(items), /has a shipmentId but no real allocatedStore/);
});

// --- matchFulfilmentsToShipments ---

test('matchFulfilmentsToShipments matches a single shipment to its single fulfilment', () => {
  const expected = [{ shipmentId: 'ship-a', allocatedStore: '100', skuUnits: { sku1: 1 } }];
  const fulfilments = [fulfilment([{ sku: 'sku1', quantity: 1 }])];
  const matches = matchFulfilmentsToShipments(fulfilments, expected, '#1');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shipment.shipmentId, 'ship-a');
  assert.equal(matches[0].fulfilment, fulfilments[0]);
});

test('matchFulfilmentsToShipments matches a combination order (two SKU-disjoint shipments) to their own fulfilments — real captured shape, US order #9931', () => {
  const expected = [
    { shipmentId: '07d356a1-f5f7-49fa-9342-ef3c422a81c0', allocatedStore: '100', skuUnits: { '33006246': 1 } },
    { shipmentId: '554a8155-2fe3-4e8a-ad5a-0573f1f40e69', allocatedStore: '99', skuUnits: { '33660301': 1 } },
  ];
  const fulfilments = [
    fulfilment([{ sku: '33660301', quantity: 1 }], {
      id: 'gid://shopify/Fulfillment/7038652580113',
      locationId: 'gid://shopify/Location/93154410769',
      locationName: 'Perfect Stranger Distribution Centre',
    }),
    fulfilment([{ sku: '33006246', quantity: 1 }], {
      id: 'gid://shopify/Fulfillment/7038652481809',
      locationId: 'gid://shopify/Location/93156147473',
      locationName: 'Universal Store Distribution Centre',
    }),
  ];
  const matches = matchFulfilmentsToShipments(fulfilments, expected, '#9931');
  assert.equal(matches.length, 2);
  const byShipment = Object.fromEntries(matches.map((m) => [m.shipment.shipmentId, m.fulfilment.id]));
  assert.equal(byShipment['07d356a1-f5f7-49fa-9342-ef3c422a81c0'], 'gid://shopify/Fulfillment/7038652481809');
  assert.equal(byShipment['554a8155-2fe3-4e8a-ad5a-0573f1f40e69'], 'gid://shopify/Fulfillment/7038652580113');
});

test('matchFulfilmentsToShipments throws allocation.fulfilment_alignment when a shipment has no matching fulfilment', () => {
  const expected = [{ shipmentId: 'ship-a', allocatedStore: '100', skuUnits: { sku1: 2 } }];
  const fulfilments = [fulfilment([{ sku: 'sku1', quantity: 1 }])]; // wrong unit count
  assert.throws(() => matchFulfilmentsToShipments(fulfilments, expected, '#1'), /allocation\.fulfilment_alignment/);
});

test('matchFulfilmentsToShipments throws allocation.one_fulfilment_per_shipment when two fulfilments share one shipment\'s SKU signature', () => {
  const expected = [{ shipmentId: 'ship-a', allocatedStore: '100', skuUnits: { sku1: 1 } }];
  const fulfilments = [fulfilment([{ sku: 'sku1', quantity: 1 }]), fulfilment([{ sku: 'sku1', quantity: 1 }])];
  assert.throws(
    () => matchFulfilmentsToShipments(fulfilments, expected, '#1'),
    /allocation\.one_fulfilment_per_shipment/,
  );
});

test('matchFulfilmentsToShipments throws allocation.no_unexplained_fulfilments for a leftover fulfilment matching no real shipment', () => {
  const expected = [{ shipmentId: 'ship-a', allocatedStore: '100', skuUnits: { sku1: 1 } }];
  const fulfilments = [
    fulfilment([{ sku: 'sku1', quantity: 1 }]),
    fulfilment([{ sku: 'sku2', quantity: 1 }]), // e.g. wrongly raised for an undeliverable item
  ];
  assert.throws(
    () => matchFulfilmentsToShipments(fulfilments, expected, '#1'),
    /allocation\.no_unexplained_fulfilments/,
  );
});

// --- assertFulfilmentLocations ---

test('assertFulfilmentLocations passes when the matched fulfilment location maps to the allocated store', () => {
  const shipment = { shipmentId: 'ship-a', allocatedStore: '100', skuUnits: { sku1: 1 } };
  const matches = [{ shipment, fulfilment: fulfilment([{ sku: 'sku1', quantity: 1 }], { locationId: US_STORE_LOCATIONS['100'] }) }];
  assert.doesNotThrow(() => assertFulfilmentLocations(matches, 'US', '#1'));
});

test('assertFulfilmentLocations throws allocation.fulfilment_location when the fulfilment came from the wrong location', () => {
  const shipment = { shipmentId: 'ship-a', allocatedStore: '407', skuUnits: { sku1: 1 } };
  const matches = [{ shipment, fulfilment: fulfilment([{ sku: 'sku1', quantity: 1 }], { locationId: US_STORE_LOCATIONS['100'] }) }];
  assert.throws(() => assertFulfilmentLocations(matches, 'US', '#1'), /allocation\.fulfilment_location/);
});

// --- assertNoFulfilmentForUndeliverable ---

test('assertNoFulfilmentForUndeliverable passes when no fulfilment references an undeliverable sku', () => {
  const fulfilments = [fulfilment([{ sku: 'sku1', quantity: 1 }])];
  assert.doesNotThrow(() => assertNoFulfilmentForUndeliverable(fulfilments, ['sku2'], '#1'));
});

test('assertNoFulfilmentForUndeliverable is a no-op when there are no undeliverable skus at all', () => {
  const fulfilments = [fulfilment([{ sku: 'sku1', quantity: 1 }])];
  assert.doesNotThrow(() => assertNoFulfilmentForUndeliverable(fulfilments, [], '#1'));
});

test('assertNoFulfilmentForUndeliverable throws allocation.no_fulfilment_for_undeliverable when a fulfilment includes an undeliverable sku', () => {
  const fulfilments = [fulfilment([{ sku: 'sku1', quantity: 1 }, { sku: 'sku2', quantity: 1 }])];
  assert.throws(
    () => assertNoFulfilmentForUndeliverable(fulfilments, ['sku2'], '#1'),
    /allocation\.no_fulfilment_for_undeliverable/,
  );
});

// --- assertAllocationReflection (full composition, real captured shapes) ---

test('assertAllocationReflection passes end-to-end for a combination order — real captured shape, US order #9931', () => {
  const items = [
    item('33006246', '100', 'ALLOCATED', '07d356a1-f5f7-49fa-9342-ef3c422a81c0', 'ITEM#68f418cb-3db1-48f4-be24-e3965f898ef8'),
    item('33660301', '99', 'ALLOCATED', '554a8155-2fe3-4e8a-ad5a-0573f1f40e69', 'ITEM#85bb9034-df4f-4b18-9876-12bc50b3e5c9'),
  ];
  const fulfilments = [
    fulfilment([{ sku: '33660301', quantity: 1 }], {
      id: 'gid://shopify/Fulfillment/7038652580113',
      locationId: 'gid://shopify/Location/93154410769',
      locationName: 'Perfect Stranger Distribution Centre',
    }),
    fulfilment([{ sku: '33006246', quantity: 1 }], {
      id: 'gid://shopify/Fulfillment/7038652481809',
      locationId: 'gid://shopify/Location/93156147473',
      locationName: 'Universal Store Distribution Centre',
    }),
  ];
  assert.doesNotThrow(() => assertAllocationReflection(fulfilments, items, 'US', '#9931'));
});

test('assertAllocationReflection passes end-to-end for a partial_undeliverable order — real captured shape, US order #9934', () => {
  const items = [
    item('33898889', '100', 'ALLOCATED', '1fa54475-12fd-4e79-8a9e-15968cd43118', 'ITEM#4cbb949c-8bb2-4d45-8594-267d6552498e'),
    item('33992457', 'UNDELIVERABLE', 'UNDELIVERABLE', null, 'ITEM#913d576b-fcaf-4388-8164-0f9ec6d59bb6'),
  ];
  const fulfilments = [
    fulfilment([{ sku: '33898889', quantity: 1 }], {
      id: 'gid://shopify/Fulfillment/7038653333777',
      locationId: 'gid://shopify/Location/93156147473',
      locationName: 'Universal Store Distribution Centre',
    }),
  ];
  assert.doesNotThrow(() => assertAllocationReflection(fulfilments, items, 'US', '#9934'));
});

test('assertAllocationReflection throws allocation.no_fulfilment_for_undeliverable (checked before shipment-matching) when a fulfilment wrongly includes an undeliverable sku', () => {
  const items = [
    item('33898889', '100', 'ALLOCATED', 'ship-a', 'ITEM#a'),
    item('33992457', 'UNDELIVERABLE', 'UNDELIVERABLE', null, 'ITEM#b'),
  ];
  const fulfilments = [fulfilment([{ sku: '33898889', quantity: 1 }, { sku: '33992457', quantity: 1 }], { locationId: US_STORE_LOCATIONS['100'] })];
  assert.throws(
    () => assertAllocationReflection(fulfilments, items, 'US', '#1'),
    /allocation\.no_fulfilment_for_undeliverable/,
  );
});
