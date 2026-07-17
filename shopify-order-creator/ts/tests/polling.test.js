const test = require('node:test');
const assert = require('node:assert/strict');
const { pollUntil, StageTimeout } = require('../dist/polling.js');

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
