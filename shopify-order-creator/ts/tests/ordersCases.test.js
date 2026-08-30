const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrdersCases, ORDERS_CASE_NAMES } = require('../dist/cases/ordersCases.js');
const { US_VARIANTS, PS_VARIANTS } = require('../dist/variants.js');

test('ORDERS_CASE_NAMES lists all six hold-lifecycle cases', () => {
  assert.deepEqual(ORDERS_CASE_NAMES, [
    'os_hold_fraud',
    'os_hold_outstanding',
    'os_hold_multi',
    'os_hold_release_fraud',
    'os_hold_release_payment',
    'os_hold_partial_release',
  ]);
});

test('buildOrdersCases(US): six cases at the fixed pool slots 18-23', () => {
  const cases = buildOrdersCases('US');
  assert.equal(Object.keys(cases).length, 6);
  assert.equal(cases.os_hold_fraud.baseSku, '33820354');
  assert.equal(cases.os_hold_outstanding.baseSku, '33939476');
  assert.equal(cases.os_hold_multi.baseSku, '33809786');
  assert.equal(cases.os_hold_release_fraud.baseSku, '33816326');
  assert.equal(cases.os_hold_release_payment.baseSku, '33996622');
  assert.equal(cases.os_hold_partial_release.baseSku, '33999944');
});

test('buildOrdersCases(PS): same fixed-slot pattern on the other store', () => {
  const cases = buildOrdersCases('PS');
  assert.equal(cases.os_hold_fraud.baseSku, '34011096');
  assert.equal(cases.os_hold_multi.baseSku, '34010884');
});

test('buildOrdersCases: every baseSku resolves to a real variant GID on both stores', () => {
  for (const store of ['US', 'PS']) {
    const variants = store === 'US' ? US_VARIANTS : PS_VARIANTS;
    const cases = buildOrdersCases(store);
    for (const name of ORDERS_CASE_NAMES) {
      assert.ok(variants[cases[name].baseSku], `${store} ${name} baseSku ${cases[name].baseSku} has no variant GID`);
    }
  }
});

test('buildOrdersCases: the four edit-driven variants share one add-item SKU (slot 74), the other two have none', () => {
  const cases = buildOrdersCases('US');
  const addItemSku = cases.os_hold_outstanding.addItemSku;
  assert.equal(addItemSku, '33966472');
  assert.equal(cases.os_hold_multi.addItemSku, addItemSku);
  assert.equal(cases.os_hold_release_payment.addItemSku, addItemSku);
  assert.equal(cases.os_hold_partial_release.addItemSku, addItemSku);
  assert.equal(cases.os_hold_fraud.addItemSku, null);
  assert.equal(cases.os_hold_release_fraud.addItemSku, null);
});

test('buildOrdersCases: variant discriminator matches each case name', () => {
  const cases = buildOrdersCases('US');
  assert.equal(cases.os_hold_fraud.variant, 'fraud');
  assert.equal(cases.os_hold_outstanding.variant, 'outstanding');
  assert.equal(cases.os_hold_multi.variant, 'multi');
  assert.equal(cases.os_hold_release_fraud.variant, 'release_fraud');
  assert.equal(cases.os_hold_release_payment.variant, 'release_payment');
  assert.equal(cases.os_hold_partial_release.variant, 'partial_release');
});

test('buildOrdersCases: no two cases share a base slot (18-23 all distinct)', () => {
  const cases = buildOrdersCases('US');
  const skus = ORDERS_CASE_NAMES.map((name) => cases[name].baseSku);
  assert.equal(new Set(skus).size, skus.length);
});
