const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stageSequenceFor,
  buildRunPlan,
  flattenPlan,
  recordStageAverage,
  averageFor,
  createProgressTracker,
  estimateRemainingSeconds,
  formatDuration,
  formatProgressLine,
  STAGE_FALLBACK_SECONDS,
} = require('../dist/progress.js');

test('stageSequenceFor: no-refund cases get a 7-stage sequence ending in no_refund', () => {
  assert.deepEqual(stageSequenceFor(false), [
    'seed_inventory', 'create_order', 'shopify_readback', 'orders_table',
    'allocation', 'no_refund', 'inventory',
  ]);
});

test('stageSequenceFor: refund cases get an 8-stage sequence with refund+cleanup', () => {
  assert.deepEqual(stageSequenceFor(true), [
    'seed_inventory', 'create_order', 'shopify_readback', 'orders_table',
    'allocation', 'refund', 'cleanup', 'inventory',
  ]);
});

test('buildRunPlan repeats the full case list once per repeat, tagging refund vs not', () => {
  const plan = buildRunPlan(['single', 'undeliverable'], (name) => name === 'undeliverable', 2);
  assert.equal(plan.length, 4); // 2 cases x 2 repeats
  assert.equal(plan[0].repeatIndex, 0);
  assert.equal(plan[0].stages.length, 7); // single: no-refund
  assert.equal(plan[1].stages.length, 8); // undeliverable: refund
  assert.equal(plan[2].repeatIndex, 1);
  assert.equal(plan[3].caseName, 'undeliverable');
});

test('flattenPlan concatenates every case-repeat entry\'s stages in order', () => {
  const plan = buildRunPlan(['single'], () => false, 1);
  assert.deepEqual(flattenPlan(plan), stageSequenceFor(false));
});

test('recordStageAverage/averageFor: rolling average across samples, falls back before any samples', () => {
  const averages = {};
  assert.equal(averageFor(averages, 'allocation'), STAGE_FALLBACK_SECONDS);
  recordStageAverage(averages, 'allocation', 10);
  recordStageAverage(averages, 'allocation', 20);
  assert.equal(averageFor(averages, 'allocation'), 15);
});

test('estimateRemainingSeconds: sums the rest of the current stage + every pending stage, all at fallback with no samples', () => {
  const plan = buildRunPlan(['single'], () => false, 1); // 7 stages, all fallback (9s)
  const tracker = createProgressTracker(plan, 1, 1, 0);
  tracker.completedStages = 3; // orders_table is the current (4th) stage, 0-based index 3
  const eta = estimateRemainingSeconds(tracker, 4); // 4s already spent in orders_table
  // remaining: orders_table (9-4=5) + allocation(9) + no_refund(9) + inventory(9) = 32
  assert.equal(eta, 32);
});

test('estimateRemainingSeconds: never goes negative for the current stage even if it overran its average', () => {
  const plan = buildRunPlan(['single'], () => false, 1);
  const tracker = createProgressTracker(plan, 1, 1, 0);
  tracker.completedStages = 6; // inventory is the last stage
  const eta = estimateRemainingSeconds(tracker, 999); // way over the 9s fallback
  assert.equal(eta, 0);
});

test('estimateRemainingSeconds: zero once every stage in the run is complete', () => {
  const plan = buildRunPlan(['single'], () => false, 1);
  const tracker = createProgressTracker(plan, 1, 1, 0);
  tracker.completedStages = tracker.flatPlan.length;
  assert.equal(estimateRemainingSeconds(tracker, 0), 0);
});

test('formatDuration renders M:SS, floored at 0', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(-5), '0:00');
});

test('formatProgressLine renders the full line matching the TAA-14 ticket example shape', () => {
  const line = formatProgressLine({
    repeatIndex: 1, totalRepeats: 3,
    caseIndex: 3, totalCases: 6, caseName: 'split',
    stageIndex: 4, totalCaseStages: 7, stageName: 'allocation',
    secondsInStage: 14, completedStages: 29, totalStages: 50,
    elapsedSeconds: 130, etaSeconds: 100,
  });
  assert.equal(line, '[repeat 2/3 · case 4/6 split · stage 5/7 allocation · 14s in stage · run 58% · 2:10/3:50]');
});
