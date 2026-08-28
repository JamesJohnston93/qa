const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk, planTargetedZero } = require('../dist/clients/dynamo.js');

test('chunk splits into fixed-size groups, preserving order', () => {
  const items = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(chunk(items, 3), [[0, 1, 2], [3, 4, 5], [6]]);
});

test('chunk on an exact multiple of size has no trailing partial group', () => {
  const items = Array.from({ length: 6 }, (_, i) => i);
  assert.deepEqual(chunk(items, 3), [[0, 1, 2], [3, 4, 5]]);
});

test('chunk on empty input returns no groups', () => {
  assert.deepEqual(chunk([], 25), []);
});

test('chunk on fewer items than the batch size returns one group', () => {
  assert.deepEqual(chunk([1, 2], 25), [[1, 2]]);
});

test('planTargetedZero zeroes only nonzero locations, excluding keepStore', () => {
  const locations = [
    { store: 'ATP#407', quantity: 3 },
    { store: 'ATP#412', quantity: 0 },
    { store: 'ATP#419', quantity: 7 },
  ];
  const plan = planTargetedZero(locations, 'ATP#407', 2);
  assert.deepEqual(plan.zero.sort(), ['ATP#419']);
  assert.deepEqual(plan.keep, { store: 'ATP#407', quantity: 2 });
});

test('planTargetedZero excludes keepStore from the zero list even if it is already nonzero', () => {
  const locations = [{ store: 'ATP#407', quantity: 5 }];
  const plan = planTargetedZero(locations, 'ATP#407', 2);
  assert.deepEqual(plan.zero, []);
  assert.deepEqual(plan.keep, { store: 'ATP#407', quantity: 2 });
});

test('planTargetedZero on an all-zero audit has nothing to zero', () => {
  const locations = [
    { store: 'ATP#100', quantity: 0 },
    { store: 'ATP#99', quantity: 0 },
  ];
  const plan = planTargetedZero(locations, 'ATP#407', 2);
  assert.deepEqual(plan.zero, []);
});

test('planTargetedZero on an empty audit has nothing to zero', () => {
  const plan = planTargetedZero([], 'ATP#407', 2);
  assert.deepEqual(plan.zero, []);
  assert.deepEqual(plan.keep, { store: 'ATP#407', quantity: 2 });
});
