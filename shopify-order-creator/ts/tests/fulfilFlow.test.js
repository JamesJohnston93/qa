const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOrderIdentifier,
  resolveOrderIdTail,
  totalOrderUnits,
  itemCountsSettled,
  isAlreadyFulfilled,
  isFulfilmentSettled,
  fulfilOrder,
} = require('../dist/flows/fulfilFlow.js');

// --- parseOrderIdentifier -----------------------------------------------

test('parseOrderIdentifier: a gid resolves straight to its numeric tail', () => {
  const result = parseOrderIdentifier('gid://shopify/Order/7772060320017');
  assert.deepEqual(result, { kind: 'tail', value: '7772060320017' });
});

test('parseOrderIdentifier: a long numeric string is treated as an id tail, not a name', () => {
  const result = parseOrderIdentifier('7772060320017');
  assert.deepEqual(result, { kind: 'tail', value: '7772060320017' });
});

test('parseOrderIdentifier: a short numeric string is treated as an order name', () => {
  const result = parseOrderIdentifier('9928');
  assert.deepEqual(result, { kind: 'name', value: '#9928' });
});

test('parseOrderIdentifier: a leading "#" on a short numeric string is normalized, not doubled', () => {
  const result = parseOrderIdentifier('#9928');
  assert.deepEqual(result, { kind: 'name', value: '#9928' });
});

test('parseOrderIdentifier: throws on an empty identifier', () => {
  assert.throws(() => parseOrderIdentifier('   '), /must not be empty/);
});

test('parseOrderIdentifier: throws on a non-numeric, non-gid identifier', () => {
  assert.throws(() => parseOrderIdentifier('not-an-order'), /must be a Shopify order name/);
});

// --- resolveOrderIdTail ---------------------------------------------------

test('resolveOrderIdTail: a tail identifier resolves without calling Shopify', async () => {
  const shopify = { findOrderIdTailByName: async () => { throw new Error('should not be called'); } };
  const tail = await resolveOrderIdTail(shopify, '7772060320017');
  assert.equal(tail, '7772060320017');
});

test('resolveOrderIdTail: a name identifier resolves via Shopify lookup', async () => {
  let seenName;
  const shopify = {
    findOrderIdTailByName: async (name) => {
      seenName = name;
      return '7772060320017';
    },
  };
  const tail = await resolveOrderIdTail(shopify, '9928');
  assert.equal(tail, '7772060320017');
  assert.equal(seenName, '#9928');
});

test('resolveOrderIdTail: throws when Shopify finds no matching order', async () => {
  const shopify = { findOrderIdTailByName: async () => null };
  await assert.rejects(() => resolveOrderIdTail(shopify, '9928'), /No Shopify order found/);
});

// --- pure predicates -------------------------------------------------------

function orderItemRow(sku) {
  return { PK: 'pk1', SK: `ITEM#${sku}-${Math.random()}`, sku };
}

test('totalOrderUnits sums ITEM# rows across skus', () => {
  const rows = [orderItemRow('sku1'), orderItemRow('sku1'), orderItemRow('sku2'), { SK: 'ORDER' }];
  assert.equal(totalOrderUnits(rows), 3);
});

function landedItem(shipmentId, status = 'ALLOCATED') {
  return { sku: 'sku1', store: null, status, rejectedStores: [], shipmentItemId: `ITEM#${Math.random()}`, shipmentId, raw: {} };
}

test('itemCountsSettled is false while fewer shipment items have landed than the order has units', () => {
  assert.equal(itemCountsSettled([landedItem('ship-1'), landedItem('ship-1')], 3), false);
});

test('itemCountsSettled is true once every landed row has a shipmentId and the count matches', () => {
  assert.equal(itemCountsSettled([landedItem('ship-1'), landedItem('ship-1'), landedItem('ship-2')], 3), true);
});

test('itemCountsSettled is false when the expected total is zero (nothing to settle against)', () => {
  assert.equal(itemCountsSettled([], 0), false);
});

test('itemCountsSettled is false while row count matches but a row has not been assigned a shipmentId yet (TAA-36 live finding, order #9937)', () => {
  const items = [landedItem('ship-1'), landedItem(null), landedItem(null)];
  assert.equal(itemCountsSettled(items, 3), false);
});

test('itemCountsSettled treats a terminal UNDELIVERABLE item (shipmentId never assigned) as resolved, not stuck', () => {
  const items = [landedItem('ship-1'), landedItem(null, 'UNDELIVERABLE')];
  assert.equal(itemCountsSettled(items, 2), true);
});

test('isAlreadyFulfilled is true only when status is exactly FULFILLED', () => {
  assert.equal(isAlreadyFulfilled({ status: 'FULFILLED' }), true);
  assert.equal(isAlreadyFulfilled({ status: 'OPEN' }), false);
  assert.equal(isAlreadyFulfilled(undefined), false);
});

test('isFulfilmentSettled requires BOTH status===FULFILLED and a present trackingNumber', () => {
  assert.equal(isFulfilmentSettled({ status: 'FULFILLED', trackingNumber: 'AP123' }), true);
  assert.equal(isFulfilmentSettled({ status: 'FULFILLED', trackingNumber: null }), false, 'tracking not yet landed');
  assert.equal(isFulfilmentSettled({ status: 'OPEN', trackingNumber: 'AP123' }), false, 'status not yet flipped');
  assert.equal(isFulfilmentSettled(undefined), false);
});

// --- fulfilOrder (fake reader/fulfilment client — no network) --------------

function fakeItem(shipmentItemId, shipmentId) {
  return { sku: 'sku1', store: null, status: 'ALLOCATED', rejectedStores: [], shipmentItemId, shipmentId, raw: {} };
}

function fakeSummary(shipmentId, overrides = {}) {
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

test('fulfilOrder: fulfils a single-shipment order end to end', async () => {
  const orderRows = [orderItemRow('sku1')];
  const shipmentItems = [fakeItem('ITEM#a', 'ship-1')];
  let fulfilCalls = 0;

  const reader = {
    getOrderRows: async () => orderRows,
    getShipmentItemsByPk: async () => shipmentItems,
    getShipmentsByPk: async () => [
      fulfilCalls > 0
        ? fakeSummary('ship-1', { status: 'FULFILLED', trackingNumber: 'AP123456789AU' })
        : fakeSummary('ship-1'),
    ],
  };
  const fulfilmentClient = {
    fulfil: async () => {
      fulfilCalls += 1;
      return { code: 200, message: 'success', data: {} };
    },
  };

  const result = await fulfilOrder({ reader, fulfilmentClient }, 'US', '7772060320017');

  assert.equal(result.orderPk, 'pk1');
  assert.equal(fulfilCalls, 1);
  assert.equal(result.totalUnits, 1);
  assert.equal(result.shipments.length, 1);
  assert.equal(result.shipments[0].status, 'FULFILLED');
  assert.equal(result.shipments[0].trackingNumber, 'AP123456789AU');
  assert.equal(result.shipments[0].itemCount, 1);
});

test('fulfilOrder: a split order fulfils every shipment independently', async () => {
  const orderRows = [orderItemRow('sku1'), orderItemRow('sku2')];
  const shipmentItems = [fakeItem('ITEM#a', 'ship-1'), fakeItem('ITEM#b', 'ship-2')];
  const fulfilledShipments = new Set();

  const reader = {
    getOrderRows: async () => orderRows,
    getShipmentItemsByPk: async () => shipmentItems,
    getShipmentsByPk: async () =>
      ['ship-1', 'ship-2'].map((id) =>
        fulfilledShipments.has(id)
          ? fakeSummary(id, { status: 'FULFILLED', trackingNumber: `TRACK-${id}` })
          : fakeSummary(id),
      ),
  };
  const fulfilmentClient = {
    fulfil: async (payload) => {
      fulfilledShipments.add(payload.shipment_id);
      return { code: 200, message: 'success', data: {} };
    },
  };

  const result = await fulfilOrder({ reader, fulfilmentClient }, 'US', '7772060320017');

  assert.equal(result.shipments.length, 2);
  const byId = Object.fromEntries(result.shipments.map((s) => [s.shipmentId, s]));
  assert.equal(byId['ship-1'].status, 'FULFILLED');
  assert.equal(byId['ship-1'].trackingNumber, 'TRACK-ship-1');
  assert.equal(byId['ship-2'].status, 'FULFILLED');
  assert.equal(byId['ship-2'].trackingNumber, 'TRACK-ship-2');
});

test('fulfilOrder: skips a shipment that is already FULFILLED without calling /staging/fulfil', async () => {
  const orderRows = [orderItemRow('sku1')];
  const shipmentItems = [fakeItem('ITEM#a', 'ship-1')];
  let fulfilCalls = 0;

  const reader = {
    getOrderRows: async () => orderRows,
    getShipmentItemsByPk: async () => shipmentItems,
    getShipmentsByPk: async () => [fakeSummary('ship-1', { status: 'FULFILLED', trackingNumber: 'OLD-TRACK' })],
  };
  const fulfilmentClient = { fulfil: async () => { fulfilCalls += 1; return {}; } };

  const result = await fulfilOrder({ reader, fulfilmentClient }, 'US', '7772060320017');

  assert.equal(fulfilCalls, 0, 'must never call /staging/fulfil on an already-FULFILLED shipment');
  assert.equal(result.shipments[0].status, 'SKIPPED_ALREADY_FULFILLED');
  assert.equal(result.shipments[0].trackingNumber, 'OLD-TRACK');
});

test('fulfilOrder: one shipment failing does not stop the others from being reported', async () => {
  const orderRows = [orderItemRow('sku1'), orderItemRow('sku2')];
  const shipmentItems = [fakeItem('ITEM#a', 'ship-1'), fakeItem('ITEM#b', 'ship-2')];

  const reader = {
    getOrderRows: async () => orderRows,
    getShipmentItemsByPk: async () => shipmentItems,
    getShipmentsByPk: async () => [
      fakeSummary('ship-1', { status: 'FULFILLED', trackingNumber: 'TRACK-1' }),
      fakeSummary('ship-2'),
    ],
  };
  const fulfilmentClient = {
    fulfil: async (payload) => {
      if (payload.shipment_id === 'ship-2') {
        throw new Error("can't fulfill shipment: contact dev support");
      }
      return {};
    },
  };

  const result = await fulfilOrder({ reader, fulfilmentClient }, 'US', '7772060320017');

  const byId = Object.fromEntries(result.shipments.map((s) => [s.shipmentId, s]));
  assert.equal(byId['ship-2'].status, 'FAILED');
  assert.match(byId['ship-2'].detail, /contact dev support/);
});

test('fulfilOrder: throws if the order has not landed in staging-orders-v2 yet', async () => {
  const reader = {
    getOrderRows: async () => [],
    getShipmentItemsByPk: async () => [],
    getShipmentsByPk: async () => [],
  };
  await assert.rejects(
    () => fulfilOrder({ reader, fulfilmentClient: { fulfil: async () => ({}) } }, 'US', '123'),
    /has not landed in staging-orders-v2/,
  );
});
