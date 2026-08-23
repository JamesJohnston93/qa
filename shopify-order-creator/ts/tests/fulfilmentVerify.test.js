const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertShipmentItemsFulfilled,
  assertShipmentTrackingNumber,
  assertOrderItemsFulfilled,
  FULFILLED,
} = require('../dist/verify/fulfilment.js');

const SHIPMENT_ID = '9b88cde5-9ba0-40b5-96f3-b69f74411326';
const ORDER_NAME = '#9930';

function shipmentItem(overrides) {
  return {
    sku: '32625134',
    store: '100',
    status: FULFILLED,
    rejectedStores: [],
    shipmentItemId: 'ITEM#aaa',
    shipmentId: SHIPMENT_ID,
    raw: {},
    ...overrides,
  };
}

function checkOf(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw, none occurred');
}

// --- assertShipmentItemsFulfilled -------------------------------------------

test('assertShipmentItemsFulfilled passes when every item on the shipment is FULFILLED', () => {
  const items = [shipmentItem(), shipmentItem({ shipmentItemId: 'ITEM#bbb', sku: '33006246' })];
  assert.doesNotThrow(() => assertShipmentItemsFulfilled(items, SHIPMENT_ID, ORDER_NAME));
});

test('assertShipmentItemsFulfilled throws shipments.items_fulfilled (retryable) when no items match the shipment yet', () => {
  const items = [shipmentItem({ shipmentId: 'some-other-shipment' })];
  const err = checkOf(() => assertShipmentItemsFulfilled(items, SHIPMENT_ID, ORDER_NAME));
  assert.equal(err.name, 'VerificationError');
  assert.equal(err.check, 'shipments.items_fulfilled');
  assert.equal(err.actual, 'not found yet');
});

test('assertShipmentItemsFulfilled throws with expected-vs-actual when an item has not settled', () => {
  const items = [shipmentItem(), shipmentItem({ shipmentItemId: 'ITEM#bbb', status: 'OPEN' })];
  const err = checkOf(() => assertShipmentItemsFulfilled(items, SHIPMENT_ID, ORDER_NAME));
  assert.equal(err.check, 'shipments.items_fulfilled');
  assert.equal(err.expected, FULFILLED);
  assert.deepEqual(err.actual, { 'ITEM#bbb': 'OPEN' });
});

test('assertShipmentItemsFulfilled ignores items belonging to a different shipment on the same order', () => {
  const items = [shipmentItem(), shipmentItem({ shipmentItemId: 'ITEM#other', shipmentId: 'other-ship', status: 'OPEN' })];
  assert.doesNotThrow(() => assertShipmentItemsFulfilled(items, SHIPMENT_ID, ORDER_NAME));
});

// --- assertShipmentTrackingNumber -------------------------------------------

function shipmentSummary(overrides) {
  return {
    shipmentId: SHIPMENT_ID,
    allocatedStore: '100',
    status: FULFILLED,
    trackingNumber: '111JD885253001000931507',
    carrier: 'AUSPOST',
    pendingAction: null,
    raw: {},
    ...overrides,
  };
}

test('assertShipmentTrackingNumber passes when status is FULFILLED and trackingNumber is present', () => {
  assert.doesNotThrow(() => assertShipmentTrackingNumber(shipmentSummary(), SHIPMENT_ID, ORDER_NAME));
});

test('assertShipmentTrackingNumber throws shipments.tracking_number (retryable) when the row is not found yet', () => {
  const err = checkOf(() => assertShipmentTrackingNumber(null, SHIPMENT_ID, ORDER_NAME));
  assert.equal(err.check, 'shipments.tracking_number');
  assert.equal(err.actual, 'not found yet');
});

test('assertShipmentTrackingNumber throws when trackingNumber is present but status has not flipped yet (measured live: this ordering happens)', () => {
  const summary = shipmentSummary({ status: 'OPEN' });
  const err = checkOf(() => assertShipmentTrackingNumber(summary, SHIPMENT_ID, ORDER_NAME));
  assert.equal(err.check, 'shipments.tracking_number');
  assert.equal(err.actual.status, 'OPEN');
  assert.equal(err.actual.trackingNumber, summary.trackingNumber);
});

test('assertShipmentTrackingNumber throws when status is FULFILLED but trackingNumber is still null', () => {
  const summary = shipmentSummary({ trackingNumber: null });
  const err = checkOf(() => assertShipmentTrackingNumber(summary, SHIPMENT_ID, ORDER_NAME));
  assert.equal(err.check, 'shipments.tracking_number');
  assert.equal(err.actual.trackingNumber, null);
});

// --- assertOrderItemsFulfilled -----------------------------------------------

function orderItemRow(sk, sku, status) {
  return { SK: sk, sku, status };
}

test('assertOrderItemsFulfilled passes when every matching orders-v2 ITEM# row is FULFILLED', () => {
  const items = [shipmentItem({ sku: '32625134' }), shipmentItem({ shipmentItemId: 'ITEM#bbb', sku: '33006246' })];
  const rows = [
    { SK: 'ORDER' },
    orderItemRow('ITEM#o1', '32625134', FULFILLED),
    orderItemRow('ITEM#o2', '33006246', FULFILLED),
  ];
  assert.doesNotThrow(() => assertOrderItemsFulfilled(rows, items, ORDER_NAME));
});

test('assertOrderItemsFulfilled throws orders_table.fulfilled (retryable) when no matching rows exist yet', () => {
  const items = [shipmentItem({ sku: '32625134' })];
  const rows = [{ SK: 'ORDER' }];
  const err = checkOf(() => assertOrderItemsFulfilled(rows, items, ORDER_NAME));
  assert.equal(err.check, 'orders_table.fulfilled');
  assert.equal(err.actual, 'not found yet');
});

test('assertOrderItemsFulfilled throws with expected-vs-actual when a matching row has not propagated yet', () => {
  const items = [shipmentItem({ sku: '32625134' }), shipmentItem({ shipmentItemId: 'ITEM#bbb', sku: '33006246' })];
  const rows = [orderItemRow('ITEM#o1', '32625134', FULFILLED), orderItemRow('ITEM#o2', '33006246', 'ALLOCATED')];
  const err = checkOf(() => assertOrderItemsFulfilled(rows, items, ORDER_NAME));
  assert.equal(err.check, 'orders_table.fulfilled');
  assert.equal(err.expected, FULFILLED);
  assert.deepEqual(err.actual, { 'ITEM#o2': 'ALLOCATED' });
});

test('assertOrderItemsFulfilled ignores orders-v2 rows for SKUs not on this shipment', () => {
  const items = [shipmentItem({ sku: '32625134' })];
  const rows = [orderItemRow('ITEM#o1', '32625134', FULFILLED), orderItemRow('ITEM#o2', 'unrelated-sku', 'OPEN')];
  assert.doesNotThrow(() => assertOrderItemsFulfilled(rows, items, ORDER_NAME));
});
