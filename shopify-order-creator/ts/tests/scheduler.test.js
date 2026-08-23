const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWaves, runBounded } = require('../dist/scheduler.js');

function caseOf(name, skus) {
  return { name, skuQuantities: Object.fromEntries(skus.map((s) => [s, 1])) };
}

test('buildWaves puts fully disjoint cases all in one wave', () => {
  const cases = [caseOf('a', ['s1']), caseOf('b', ['s2']), caseOf('c', ['s3'])];
  const waves = buildWaves(cases);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].length, 3);
});

test('buildWaves separates cases that share a sku into different waves', () => {
  const cases = [caseOf('a', ['s1']), caseOf('b', ['s1']), caseOf('c', ['s2'])];
  const waves = buildWaves(cases);
  assert.equal(waves.length, 2);
  assert.deepEqual(waves[0].map((c) => c.name), ['a', 'c']); // c has no overlap, joins wave 1
  assert.deepEqual(waves[1].map((c) => c.name), ['b']);
});

test('buildWaves handles a case whose skus overlap multiple earlier, already-placed cases', () => {
  const cases = [caseOf('a', ['s1']), caseOf('b', ['s2']), caseOf('c', ['s1', 's2'])];
  const waves = buildWaves(cases);
  assert.equal(waves.length, 2);
  assert.deepEqual(waves[0].map((c) => c.name), ['a', 'b']);
  assert.deepEqual(waves[1].map((c) => c.name), ['c']);
});

test('buildWaves matches the real TAA-14/TAA-39 US case set: all 8 fully disjoint, one wave', () => {
  // single=0, multi=1, unique=2-4, split=5-6, undeliverable=7, partial_undeliverable=8-9,
  // fulfil_single=10, fulfil_split=11-12 (slot 13 free for TAA-31)
  const cases = [
    caseOf('single', ['0']),
    caseOf('multi', ['1']),
    caseOf('unique', ['2', '3', '4']),
    caseOf('split', ['5', '6']),
    caseOf('undeliverable', ['7']),
    caseOf('partial_undeliverable', ['8', '9']),
    caseOf('fulfil_single', ['10']),
    caseOf('fulfil_split', ['11', '12']),
  ];
  const waves = buildWaves(cases);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].length, 8);
});

test('runBounded never runs more than the concurrency cap at once', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  const results = await runBounded(items, 3, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item * 2;
  });
  assert.ok(maxActive <= 3, `max concurrent was ${maxActive}`);
  assert.deepEqual(results, items.map((i) => i * 2));
});

test('runBounded preserves input order in results regardless of completion order', async () => {
  const items = [30, 10, 20]; // deliberately slowest-first so completion order differs from input order
  const results = await runBounded(items, 3, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ms;
  });
  assert.deepEqual(results, [30, 10, 20]);
});

test('runBounded with concurrency 1 runs strictly sequentially', async () => {
  const order = [];
  await runBounded([1, 2, 3], 1, async (item) => {
    order.push(item);
    return item;
  });
  assert.deepEqual(order, [1, 2, 3]);
});

test('runBounded clamps an oversized concurrency down to the item count without erroring', async () => {
  const results = await runBounded([1, 2], 10, async (item) => item);
  assert.deepEqual(results, [1, 2]);
});
