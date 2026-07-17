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
