const test = require('node:test');
const assert = require('node:assert/strict');
const { orderSkuQuantitiesFromRows, orderPkFromRows } = require('../dist/readers/dynamoReader.js');

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
