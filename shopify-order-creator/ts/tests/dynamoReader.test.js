const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  orderSkuQuantitiesFromRows,
  orderPkFromRows,
  shipmentSummariesFromRows,
  groupItemsByShipment,
  transactionRowsFromRows,
  transactionRowsByEvent,
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

// TAA-31 slice G: fixtures shaped from the real order #9970/#9969 transaction
// dumps (ts/signoffs/TAA-31-slice-f.md) — not invented shapes.
test('transactionRowsFromRows extracts only TRANSACTION# rows, normalizing event/shipmentItemInfo', () => {
  const rows = [
    { PK: 'pk1', SK: 'ITEM#a', sku: 'sku1' },
    { PK: 'pk1', SK: 'SHIPMENT#s1', allocatedStore: '100' },
    {
      PK: 'pk1',
      SK: 'TRANSACTION#1787895359776',
      event: 'SHIPMENT_REJECTED',
      shipmentItemInfo: [{ id: 'ITEM#a', sku: 'sku1' }, { id: 'ITEM#b', sku: 'sku1' }],
    },
    {
      PK: 'pk1',
      SK: 'TRANSACTION#1787895360776',
      event: 'SHIPMENT_ITEM_REJECTED',
      shipmentItemInfo: [{ id: 'ITEM#a', shipmentId: 's1', rejectedStore: '100' }],
    },
  ];
  const transactions = transactionRowsFromRows(rows);
  assert.equal(transactions.length, 2);
  assert.deepEqual(
    transactions.map((t) => t.event),
    ['SHIPMENT_REJECTED', 'SHIPMENT_ITEM_REJECTED'],
  );
  assert.deepEqual(transactions[1].shipmentItemInfo, [{ id: 'ITEM#a', shipmentId: 's1', rejectedStore: '100' }]);
});

test('transactionRowsFromRows defaults shipmentItemInfo to [] for events that carry none (e.g. bare REALLOCATION rows)', () => {
  const rows = [{ PK: 'pk1', SK: 'TRANSACTION#1', event: 'REALLOCATION' }];
  assert.deepEqual(transactionRowsFromRows(rows), [
    { pk: 'pk1', sk: 'TRANSACTION#1', event: 'REALLOCATION', category: '', origin: '', idempotencyId: '', shipmentItemInfo: [], raw: rows[0] },
  ]);
});

// TAA-48: real envelope fields captured live from staging-orders-v2
// (ts/signoffs/TAA-48-slice-a.md, order #9947) — confirmed shared with
// staging-shipments, not orders-v2-specific.
test('transactionRowsFromRows extracts the shared envelope (pk/category/origin/idempotencyId), same fields on either table', () => {
  const row = {
    PK: '42343a00-379f-45ac-8128-40c5e38b61aa',
    SK: 'TRANSACTION#1787490999642',
    event: 'CREATE_ORDER',
    category: 'CHARGE',
    origin: 'US#SHOPIFY_ECOM#7881590669585',
    idempotencyId: 'ba7bbba2-a354-47a3-a80e-a3c35dec6eea',
  };
  const [transaction] = transactionRowsFromRows([row]);
  assert.equal(transaction.pk, '42343a00-379f-45ac-8128-40c5e38b61aa');
  assert.equal(transaction.sk, 'TRANSACTION#1787490999642');
  assert.equal(transaction.category, 'CHARGE');
  assert.equal(transaction.origin, 'US#SHOPIFY_ECOM#7881590669585');
  assert.equal(transaction.idempotencyId, 'ba7bbba2-a354-47a3-a80e-a3c35dec6eea');
  assert.deepEqual(transaction.shipmentItemInfo, []);
});

test('transactionRowsFromRows returns [] when there are no TRANSACTION# rows', () => {
  assert.deepEqual(transactionRowsFromRows([{ PK: 'pk1', SK: 'ITEM#a' }]), []);
});

test('transactionRowsByEvent filters a chronological list down to one event', () => {
  const rows = [
    { PK: 'pk1', SK: 'TRANSACTION#1', event: 'CREATE_ORDER' },
    { PK: 'pk1', SK: 'TRANSACTION#2', event: 'REFUND_ITEM' },
    { PK: 'pk1', SK: 'TRANSACTION#3', event: 'REFUND_ITEM' },
  ];
  const transactions = transactionRowsFromRows(rows);
  assert.deepEqual(
    transactionRowsByEvent(transactions, 'REFUND_ITEM').map((t) => t.sk),
    ['TRANSACTION#2', 'TRANSACTION#3'],
  );
  assert.deepEqual(transactionRowsByEvent(transactions, 'NO_SUCH_EVENT'), []);
});

// TAA-48 slice B — fixture-driven, against the real staging-orders-v2 rows
// captured in slice A (ts/signoffs/TAA-48-slice-a.md / fixtures/orders-v2/).
// Not invented shapes; these pin what staging actually returned.
{
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
  const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

  test('getOrderTransactions composition (getOrderRows + transactionRowsFromRows) on a fulfil-path order: CREATE_ORDER only', () => {
    const rows = loadFixture('US-fulfil-9929.json');
    const transactions = transactionRowsFromRows(rows);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].event, 'CREATE_ORDER');
    assert.equal(transactions[0].category, 'CHARGE');
    assert.equal(transactions[0].origin, 'US#SHOPIFY_ECOM#7881449210129');
    // Finding 1 (slice A): fulfilment produces NO staging-orders-v2 transaction,
    // even though this order is genuinely FULFILLED in staging-shipments.
    assert.deepEqual(
      transactions.map((t) => t.event),
      ['CREATE_ORDER'],
    );
  });

  test('a plain reject/reallocate order (no undeliverable outcome) also shows CREATE_ORDER only on staging-orders-v2', () => {
    const rows = loadFixture('US-reject-9947.json');
    const transactions = transactionRowsFromRows(rows);
    assert.deepEqual(
      transactions.map((t) => t.event),
      ['CREATE_ORDER'],
    );
  });

  test('a reject that resolves UNDELIVERABLE shows the refund it triggers (order #9952: CREATE_ORDER, REFUND_ITEM x2, REFUND_SHIPPING)', () => {
    const rows = loadFixture('US-reject-9952.json');
    const transactions = transactionRowsFromRows(rows);
    assert.deepEqual(
      transactions.map((t) => t.event),
      ['CREATE_ORDER', 'REFUND_ITEM', 'REFUND_SHIPPING', 'REFUND_ITEM'],
    );
    assert.equal(transactionRowsByEvent(transactions, 'REFUND_ITEM').length, 2);
    // chronological, not re-sorted: SK order as returned by the Query
    assert.deepEqual(
      transactions.map((t) => t.sk),
      [...transactions].sort((a, b) => (a.sk < b.sk ? -1 : 1)).map((t) => t.sk),
    );
  });

  test('a full undeliverable order (#9865) carries REFUND_SHIPPING; a partial one (#9866) does not', () => {
    const full = transactionRowsFromRows(loadFixture('US-undeliverable-9865.json'));
    const partial = transactionRowsFromRows(loadFixture('US-undeliverable-9866.json'));
    assert.deepEqual(transactionRowsByEvent(full, 'REFUND_SHIPPING').map((t) => t.category), ['REFUND']);
    assert.equal(transactionRowsByEvent(partial, 'REFUND_SHIPPING').length, 0);
    assert.equal(transactionRowsByEvent(partial, 'REFUND_ITEM').length, 1);
  });

  test('PS fixture parses with the same field names as US (no cross-store drift)', () => {
    const transactions = transactionRowsFromRows(loadFixture('PS-taa46-3321.json'));
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].event, 'CREATE_ORDER');
    assert.equal(transactions[0].category, 'CHARGE');
    assert.equal(transactions[0].origin, 'PS#SHOPIFY_ECOM#10875125727524');
  });
}
