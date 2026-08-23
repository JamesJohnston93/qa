const test = require('node:test');
const assert = require('node:assert/strict');
const {
  orderSkuQuantitiesFromRows,
  orderPkFromRows,
  shipmentSummariesFromRows,
  groupItemsByShipment,
} = require('../dist/readers/dynamoReader.js');

function itemRow(pk, sku) {
  return { PK: pk, SK: `ITEM#${sku}-${Math.random()}`, sku };
}

test('orderSkuQuantitiesFromRows counts ITEM# rows per sku, ignoring other row kinds', () => {
  const rows = [
    { PK: 'pk1', SK: 'ORDER', shopifyExternalOrderId: 'x' },
    { PK: 'pk1', SK: 'ADDRESS#SHIPPING' },
    itemRow('pk1', 'sku1'),
    itemRow('pk1', 'sku1'),
    itemRow('pk1', 'sku2'),
    { PK: 'pk1', SK: 'TRANSACTION#1', event: 'CREATE_ORDER' },
  ];
  assert.deepEqual(orderSkuQuantitiesFromRows(rows), { sku1: 2, sku2: 1 });
});

test('orderSkuQuantitiesFromRows returns empty for no rows (order not landed yet)', () => {
  assert.deepEqual(orderSkuQuantitiesFromRows([]), {});
});

test('orderPkFromRows resolves PK from the ORDER row when present', () => {
  const rows = [itemRow('pk1', 'sku1'), { PK: 'pk1', SK: 'ORDER' }];
  assert.equal(orderPkFromRows(rows), 'pk1');
});

test('orderPkFromRows falls back to the first row if no ORDER row has landed yet', () => {
  const rows = [itemRow('pk1', 'sku1')];
  assert.equal(orderPkFromRows(rows), 'pk1');
});

test('orderPkFromRows returns null when nothing has landed', () => {
  assert.equal(orderPkFromRows([]), null);
});

function shipmentRow(overrides = {}) {
  return {
    PK: 'pk1',
    SK: 'SHIPMENT#9b88cde5-9ba0-40b5-96f3-b69f74411326',
    allocatedStore: '100',
    carrier: 'AUSPOST',
    pendingAction: 'MANIFEST',
    ...overrides,
  };
}

test('shipmentSummariesFromRows extracts SHIPMENT# rows, ignoring ITEM#/ORDER/TRANSACTION rows', () => {
  const rows = [
    shipmentRow(),
    { PK: 'pk1', SK: 'ITEM#abc', sku: 'sku1' },
    { PK: 'pk1', SK: 'TRANSACTION#1', event: 'SHIPMENT_CREATE' },
  ];
  const summaries = shipmentSummariesFromRows(rows);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].shipmentId, '9b88cde5-9ba0-40b5-96f3-b69f74411326', 'SHIPMENT# prefix stripped');
});

test('shipmentSummariesFromRows surfaces status/trackingNumber/carrier/pendingAction alongside allocatedStore', () => {
  const row = shipmentRow({ status: 'FULFILLED', trackingNumber: '111JD885255101000931502' });
  const [summary] = shipmentSummariesFromRows([row]);
  assert.equal(summary.allocatedStore, '100');
  assert.equal(summary.status, 'FULFILLED');
  assert.equal(summary.trackingNumber, '111JD885255101000931502');
  assert.equal(summary.carrier, 'AUSPOST');
  assert.equal(summary.pendingAction, 'MANIFEST');
});

test('shipmentSummariesFromRows reads trackingNumber as null in the pre-fulfilment state (the field is absent on the row)', () => {
  const row = shipmentRow({ status: 'OPEN' }); // no trackingNumber attribute at all
  const [summary] = shipmentSummariesFromRows([row]);
  assert.equal(summary.status, 'OPEN');
  assert.equal(summary.trackingNumber, null);
});

function shipmentItem(sku, shipmentItemId, shipmentId) {
  return { sku, store: null, status: 'ALLOCATED', rejectedStores: [], shipmentItemId, shipmentId, raw: {} };
}

test('groupItemsByShipment splits a mixed set of items by their shipmentId', () => {
  const items = [
    shipmentItem('sku1', 'ITEM#a', 'ship-1'),
    shipmentItem('sku2', 'ITEM#b', 'ship-1'),
    shipmentItem('sku3', 'ITEM#c', 'ship-2'),
  ];
  const grouped = groupItemsByShipment(items);
  assert.equal(grouped.size, 2);
  assert.deepEqual(grouped.get('ship-1').map((i) => i.sku), ['sku1', 'sku2']);
  assert.deepEqual(grouped.get('ship-2').map((i) => i.sku), ['sku3']);
});

test('groupItemsByShipment excludes items not yet allocated to a shipment (shipmentId === null)', () => {
  const items = [shipmentItem('sku1', 'ITEM#a', 'ship-1'), shipmentItem('sku2', 'ITEM#b', null)];
  const grouped = groupItemsByShipment(items);
  assert.equal(grouped.size, 1);
  assert.equal(grouped.get('ship-1').length, 1);
});
