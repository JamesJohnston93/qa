const test = require('node:test');
const assert = require('node:assert/strict');
const { chunk } = require('../dist/clients/dynamo.js');

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
