const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNewStoreCases } = require('../dist/cases/newstoreCases.js');
const { US_SKU_ORDER, PS_SKU_ORDER } = require('../dist/variants.js');

test('buildNewStoreCases: US ns_sfs and ns_otc use distinct SKUs from each other', () => {
  const cases = buildNewStoreCases('US');
  const sfsSku = Object.keys(cases.ns_sfs.skuQuantities)[0];
  const otcSku = Object.keys(cases.ns_otc.skuQuantities)[0];
  assert.notEqual(sfsSku, otcSku);
  assert.equal(cases.ns_sfs.orderType, 'SFS');
  assert.equal(cases.ns_otc.orderType, 'OTC');
});

test('buildNewStoreCases: US/PS ns_sfs and ns_otc are pinned to slots 14/15 (TAA-46), not the pool tail', () => {
  const usCases = buildNewStoreCases('US');
  assert.equal(Object.keys(usCases.ns_sfs.skuQuantities)[0], US_SKU_ORDER[14]);
  assert.equal(Object.keys(usCases.ns_otc.skuQuantities)[0], US_SKU_ORDER[15]);

  const psCases = buildNewStoreCases('PS');
  assert.equal(Object.keys(psCases.ns_sfs.skuQuantities)[0], PS_SKU_ORDER[14]);
  assert.equal(Object.keys(psCases.ns_otc.skuQuantities)[0], PS_SKU_ORDER[15]);
});

test('buildNewStoreCases: each case orders exactly one unit of its SKU', () => {
  const cases = buildNewStoreCases('US');
  assert.deepEqual(Object.values(cases.ns_sfs.skuQuantities), [1]);
  assert.deepEqual(Object.values(cases.ns_otc.skuQuantities), [1]);
});
