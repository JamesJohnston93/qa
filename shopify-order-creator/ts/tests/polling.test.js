const test = require('node:test');
const assert = require('node:assert/strict');
const { pollUntil, StageTimeout, resolveInterval } = require('../dist/polling.js');

test('pollUntil resolves once the predicate holds and records elapsed/attempts', async () => {
  let calls = 0;
  const result = await pollUntil(
    () => { calls += 1; return calls; },
    (value) => value >= 3,
    5, // timeout seconds
    0.01, // interval seconds (fast for the test)
    'test_stage',
  );
  assert.equal(result.value, 3);
  assert.equal(result.attempts, 3);
  assert.ok(result.elapsed >= 0);
});

test('pollUntil throws StageTimeout carrying the last observed value', async () => {
  await assert.rejects(
    () => pollUntil(
      () => 'never-matches',
      (value) => value === 'expected',
      0.05, // timeout seconds — expires almost immediately
      0.02, // interval seconds
      'flaky_stage',
    ),
    (error) => {
      assert.ok(error instanceof StageTimeout);
      assert.equal(error.stage, 'flaky_stage');
      assert.equal(error.lastValue, 'never-matches');
      return true;
    },
  );
});

test('pollUntil propagates fetch() errors instead of swallowing them', async () => {
  await assert.rejects(
    () => pollUntil(
      () => { throw new Error('reader exploded'); },
      () => true,
      1,
      0.01,
      'erroring_stage',
    ),
    /reader exploded/,
  );
});

test('resolveInterval treats a plain number as a fixed interval (no ramp)', () => {
  assert.equal(resolveInterval(1, 5), 5);
  assert.equal(resolveInterval(4, 5), 5);
});

test('resolveInterval ramps 1s -> 2s -> 3s -> cap by default', () => {
  const config = { cap: 5 };
  assert.equal(resolveInterval(1, config), 1);
  assert.equal(resolveInterval(2, config), 2);
  assert.equal(resolveInterval(3, config), 3);
  assert.equal(resolveInterval(4, config), 5);
  assert.equal(resolveInterval(9, config), 5);
});

test('resolveInterval floors the ramp at min (Shopify rate-limit case)', () => {
  const config = { cap: 5, min: 2 };
  assert.equal(resolveInterval(1, config), 2); // ramp step 1 < min, floored
  assert.equal(resolveInterval(2, config), 2); // ramp step 2 == min
  assert.equal(resolveInterval(3, config), 3); // ramp step 3 > min, unaffected
  assert.equal(resolveInterval(4, config), 5); // past the ramp, at cap
});

test('resolveInterval never exceeds cap even with a custom ramp overshooting it', () => {
  const config = { cap: 5, ramp: [1, 2, 10] };
  assert.equal(resolveInterval(3, config), 5);
});

test('pollUntil ramps its sleep between attempts per a PollIntervalConfig', async () => {
  let calls = 0;
  const result = await pollUntil(
    () => { calls += 1; return calls; },
    (value) => value >= 3,
    5,
    { cap: 0.05, ramp: [0.001, 0.001] }, // fast ramp so the test stays quick
    'ramped_stage',
  );
  assert.equal(result.value, 3);
  assert.equal(result.attempts, 3);
});
