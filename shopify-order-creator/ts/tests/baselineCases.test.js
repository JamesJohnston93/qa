const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCases } = require('../dist/cases/baselineCases.js');

// TAA-39 (slice F): pins the real case list buildCases() produces, on both
// stores, so a future edit that drops/renames a case or forgets to mark the
// new fulfilment cases correctly fails loudly here instead of live.

// TAA-31 (slice F/G): the one deliberate exception to "no two cases share a
// SKU" — reject_reallocate and reject_undeliverable both use pool slot 13.
// scheduler.ts's buildWaves separates same-SKU cases into different waves
// (sequential, never concurrent), and every case zeroes its SKU before
// reseeding, so this is safe — see baselineCases.ts's file header comment.
const ALLOWED_SKU_OVERLAP = [['reject_reallocate', 'reject_undeliverable']].map((pair) => pair.sort().join('+'));

for (const store of ['US', 'PS']) {
  test(`buildCases(${store}): all 10 cases present, fulfilment/rejectMode flags set correctly`, () => {
    const cases = buildCases(store);
    assert.deepEqual(Object.keys(cases), [
      'single', 'multi', 'unique', 'split', 'undeliverable', 'partial_undeliverable',
      'fulfil_single', 'fulfil_split', 'reject_reallocate', 'reject_undeliverable',
    ]);
    for (const name of ['single', 'multi', 'unique', 'split', 'undeliverable', 'partial_undeliverable']) {
      assert.equal(cases[name].fulfilment, false, `${name} should not be a fulfilment case`);
      assert.equal(cases[name].rejectMode, undefined, `${name} should not be a reject case`);
    }
    assert.equal(cases.fulfil_single.fulfilment, true);
    assert.equal(cases.fulfil_split.fulfilment, true);
    assert.equal(cases.reject_reallocate.rejectMode, 'reallocate');
    assert.equal(cases.reject_undeliverable.rejectMode, 'undeliverable');
  });

  test(`buildCases(${store}): every case pair is SKU-disjoint except the one allowed reject_reallocate/reject_undeliverable overlap`, () => {
    const cases = buildCases(store);
    const skuSets = Object.entries(cases).map(([name, def]) => [name, new Set(Object.keys(def.skuQuantities))]);
    for (let i = 0; i < skuSets.length; i += 1) {
      for (let j = i + 1; j < skuSets.length; j += 1) {
        const [nameA, skusA] = skuSets[i];
        const [nameB, skusB] = skuSets[j];
        const overlap = [...skusA].filter((sku) => skusB.has(sku));
        const pairKey = [nameA, nameB].sort().join('+');
        if (ALLOWED_SKU_OVERLAP.includes(pairKey)) {
          assert.equal(overlap.length, 1, `${nameA}/${nameB} should share exactly the one pool-13 SKU`);
          continue;
        }
        assert.equal(overlap.length, 0, `${nameA} and ${nameB} share sku(s) ${JSON.stringify(overlap)} — breaks --parallel`);
      }
    }
  });

  test(`buildCases(${store}): reject_reallocate/reject_undeliverable use pool slot 13, and share it with each other only`, () => {
    const cases = buildCases(store);
    const rejectSku = Object.keys(cases.reject_reallocate.skuQuantities)[0];
    assert.deepEqual(Object.keys(cases.reject_undeliverable.skuQuantities), [rejectSku]);
    for (const [name, def] of Object.entries(cases)) {
      if (name === 'reject_reallocate' || name === 'reject_undeliverable') {
        continue;
      }
      assert.ok(!(rejectSku in def.skuQuantities), `${name} should not touch the reject-reserved SKU ${rejectSku}`);
    }
  });

  test(`buildCases(${store}): reject_reallocate seeds a backup store fresh for the mid-flight reject`, () => {
    const cases = buildCases(store);
    assert.ok(cases.reject_reallocate.rejectSeedStore, 'rejectSeedStore must be set');
    assert.ok(cases.reject_reallocate.rejectSeedQuantity > 0, 'rejectSeedQuantity must be positive');
  });

  test(`buildCases(${store}): reject_undeliverable expects a refund, matching its forced UNDELIVERABLE outcome`, () => {
    const cases = buildCases(store);
    const sku = Object.keys(cases.reject_undeliverable.skuQuantities)[0];
    assert.deepEqual(cases.reject_undeliverable.expectedRefundSkus, { [sku]: 2 });
    assert.deepEqual(cases.reject_undeliverable.cleanupSkus, [sku]);
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
