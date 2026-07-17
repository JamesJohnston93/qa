const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDecrements } = require('../dist/verify/inventory.js');

test('assertDecrements accepts the expected decrement map', () => {
  assert.doesNotThrow(() => {
    assertDecrements(
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 98 } },
      { demo_sku: { 'ATP#100': 1 } },
      '#1234',
    );
  });
});

test('assertDecrements rejects unexpected inventory change', () => {
  assert.throws(() => {
    assertDecrements(
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 1 } },
      '#1234',
    );
  }, /inventory\.decrement/);
});

test('assertDecrements ignores aggregate/pool locations that mirror stock asynchronously (e.g. ATP#INTERNATIONAL)', () => {
  // Observed live: ATP#INTERNATIONAL appeared with the seeded ATP#100 quantity
  // ~30-60s after seeding, though nothing in the seed plan or order touched it.
  assert.doesNotThrow(() => {
    assertDecrements(
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 98, 'ATP#INTERNATIONAL': 99 } },
      { demo_sku: { 'ATP#100': 1 } },
      '#1234',
    );
  });
});
