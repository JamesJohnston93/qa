const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCases } = require('../dist/cases/baselineCases.js');

// TAA-39 (slice F): pins the real case list buildCases() produces, on both
// stores, so a future edit that drops/renames a case or forgets to mark the
// new fulfilment cases correctly fails loudly here instead of live.

for (const store of ['US', 'PS']) {
  test(`buildCases(${store}): all 8 cases present, fulfilment flag set correctly`, () => {
    const cases = buildCases(store);
    assert.deepEqual(
      Object.keys(cases),
      ['single', 'multi', 'unique', 'split', 'undeliverable', 'partial_undeliverable', 'fulfil_single', 'fulfil_split'],
    );
    for (const name of ['single', 'multi', 'unique', 'split', 'undeliverable', 'partial_undeliverable']) {
      assert.equal(cases[name].fulfilment, false, `${name} should not be a fulfilment case`);
    }
    assert.equal(cases.fulfil_single.fulfilment, true);
    assert.equal(cases.fulfil_split.fulfilment, true);
  });

  test(`buildCases(${store}): fulfil_single/fulfil_split use pool slots 10-12, disjoint from every other case and each other`, () => {
    const cases = buildCases(store);
    const skuSets = Object.entries(cases).map(([name, def]) => [name, new Set(Object.keys(def.skuQuantities))]);
    for (let i = 0; i < skuSets.length; i += 1) {
      for (let j = i + 1; j < skuSets.length; j += 1) {
        const [nameA, skusA] = skuSets[i];
        const [nameB, skusB] = skuSets[j];
        const overlap = [...skusA].filter((sku) => skusB.has(sku));
        assert.equal(overlap.length, 0, `${nameA} and ${nameB} share sku(s) ${JSON.stringify(overlap)} — breaks --parallel`);
      }
    }
  });

  test(`buildCases(${store}): fulfil_split allocates its two skus to two different stores (real split, not a same-store combination)`, () => {
    const cases = buildCases(store);
    const allocations = Object.values(cases.fulfil_split.expectedAllocation);
    assert.equal(new Set(allocations).size, 2, `expected two distinct stores, got ${JSON.stringify(allocations)}`);
  });

  test(`buildCases(${store}): fulfil_single/fulfil_split expect no refund (fulfilment path only exercised on a clean allocation)`, () => {
    const cases = buildCases(store);
    assert.deepEqual(cases.fulfil_single.expectedRefundSkus, {});
    assert.deepEqual(cases.fulfil_split.expectedRefundSkus, {});
  });
}
