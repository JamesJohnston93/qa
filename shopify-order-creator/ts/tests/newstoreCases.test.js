const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNewStoreCases } = require('../dist/cases/newstoreCases.js');

test('buildNewStoreCases: US ns_sfs and ns_otc use distinct SKUs from each other', () => {
  const cases = buildNewStoreCases('US');
  const sfsSku = Object.keys(cases.ns_sfs.skuQuantities)[0];
  const otcSku = Object.keys(cases.ns_otc.skuQuantities)[0];
  assert.notEqual(sfsSku, otcSku);
  assert.equal(cases.ns_sfs.orderType, 'SFS');
  assert.equal(cases.ns_otc.orderType, 'OTC');
});

test('buildNewStoreCases: PS (small pool) still returns both cases without throwing', () => {
  const cases = buildNewStoreCases('PS');
  assert.ok(Object.keys(cases.ns_sfs.skuQuantities)[0]);
  assert.ok(Object.keys(cases.ns_otc.skuQuantities)[0]);
});

test('buildNewStoreCases: each case orders exactly one unit of its SKU', () => {
  const cases = buildNewStoreCases('US');
  assert.deepEqual(Object.values(cases.ns_sfs.skuQuantities), [1]);
  assert.deepEqual(Object.values(cases.ns_otc.skuQuantities), [1]);
});
