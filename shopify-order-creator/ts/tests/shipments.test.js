const test = require('node:test');
const assert = require('node:assert/strict');
const { allocationSummary } = require('../dist/readers/dynamoReader.js');
const { assertUnitCounts, assertAllocation, assertItemsRemoved } = require('../dist/verify/shipments.js');

function item(sku, store, status = 'ALLOCATED') {
  return { sku, store, status, rejectedStores: [], raw: {} };
}

test('allocationSummary counts one unit per ITEM# row (Dynamo does not merge duplicates like Shopify)', () => {
  const items = [item('sku1', '100'), item('sku1', '100'), item('sku1', '100')];
  const summary = allocationSummary(items);
  assert.equal(summary.totalUnits, 3);
  assert.deepEqual(summary.skuUnits, { sku1: 3 });
  assert.deepEqual(summary.byStore, { '100': ['sku1', 'sku1', 'sku1'] });
  assert.equal(summary.unallocated, 0);
});

test('allocationSummary treats null/empty store as unallocated', () => {
  const summary = allocationSummary([item('sku1', null, 'OPEN')]);
  assert.equal(summary.unallocated, 1);
  assert.deepEqual(summary.byStore, { '(unallocated)': ['sku1'] });
});

test('assertUnitCounts passes when unit totals match the ordered quantities', () => {
  const summary = allocationSummary([item('sku1', '100'), item('sku1', '100'), item('sku2', '100')]);
  assert.doesNotThrow(() => assertUnitCounts(summary, { sku1: 2, sku2: 1 }, '#1'));
});

test('assertUnitCounts throws shipments.unit_counts when totals disagree', () => {
  const summary = allocationSummary([item('sku1', '100')]);
  assert.throws(() => assertUnitCounts(summary, { sku1: 3 }, '#1'), /shipments\.unit_counts/);
});

test('assertAllocation passes for a split allocation across two stores', () => {
  const summary = allocationSummary([item('sku1', '100'), item('sku2', '99')]);
  assert.doesNotThrow(() => assertAllocation(summary, { sku1: '100', sku2: '99' }, '#1'));
});

test('assertAllocation throws shipments.allocated when an item has no store yet', () => {
  const summary = allocationSummary([item('sku1', null, 'OPEN')]);
  assert.throws(() => assertAllocation(summary, { sku1: '100' }, '#1'), /shipments\.allocated/);
});

test('assertAllocation throws shipments.allocation when a sku lands at the wrong store', () => {
  const summary = allocationSummary([item('sku1', '99')]);
  assert.throws(() => assertAllocation(summary, { sku1: '100' }, '#1'), /shipments\.allocation/);
});

test('assertAllocation accepts UNDELIVERABLE as an expected terminal state', () => {
  const summary = allocationSummary([item('sku1', 'UNDELIVERABLE', 'UNDELIVERABLE')]);
  assert.doesNotThrow(() => assertAllocation(summary, { sku1: 'UNDELIVERABLE' }, '#1'));
});

test('assertItemsRemoved passes when the refunded sku has no rows at all', () => {
  assert.doesNotThrow(() => assertItemsRemoved([item('sku2', '100')], ['sku1'], '#1'));
});

test('assertItemsRemoved passes once the row exists but its status has flipped to REMOVED (the row is never deleted, confirmed live)', () => {
  const removedRow = item('sku1', 'UNDELIVERABLE', 'REMOVED');
  assert.doesNotThrow(() => assertItemsRemoved([removedRow], ['sku1'], '#1'));
});

test('assertItemsRemoved throws shipments.cleanup while the row is still UNDELIVERABLE (not yet REMOVED)', () => {
  const stillUndeliverable = item('sku1', 'UNDELIVERABLE', 'UNDELIVERABLE');
  assert.throws(() => assertItemsRemoved([stillUndeliverable], ['sku1'], '#1'), /shipments\.cleanup/);
});
