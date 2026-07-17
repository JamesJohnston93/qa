const test = require('node:test');
const assert = require('node:assert/strict');
const { assertInventoryDecrements } = require('../dist/verification/verification.js');

test('assertInventoryDecrements accepts the expected decrement map', () => {
  assert.doesNotThrow(() => {
    assertInventoryDecrements(
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 98 } },
      { demo_sku: { 'ATP#100': 1 } },
      '#1234',
    );
  });
});

test('assertInventoryDecrements rejects unexpected inventory change', () => {
  assert.throws(() => {
    assertInventoryDecrements(
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 99 } },
      { demo_sku: { 'ATP#100': 1 } },
      '#1234',
    );
  }, /inventory\.decrement/);
});
