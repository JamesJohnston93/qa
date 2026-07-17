const test = require('node:test');
const assert = require('node:assert/strict');
const { stableSignature, diffRepeats } = require('../dist/report.js');

function fakeRun(store, cases) {
  return {
    store,
    passed: cases.every((c) => c.passed),
    cases: cases.map((c) => ({
      case: c.name,
      store,
      description: '',
      passed: c.passed,
      orderId: c.orderId ?? 'gid://shopify/Order/1',
      orderName: c.orderName ?? '#1',
      stages: [],
      error: c.passed ? null : { check: c.failedCheck ?? 'some.check', expected: 'x', actual: 'y' },
    })),
  };
}

test('stableSignature excludes volatile fields (order ids) and keeps pass/fail + failing check', () => {
  const run = fakeRun('US', [{ name: 'single', passed: true, orderId: 'gid://shopify/Order/111', orderName: '#111' }]);
  const sig = stableSignature(run);
  assert.deepEqual(sig, { single: { passed: true, failedCheck: null } });
});

test('diffRepeats reports consistent when identical runs produce identical signatures', () => {
  const runA = fakeRun('US', [
    { name: 'single', passed: true, orderId: 'gid://shopify/Order/1', orderName: '#1' },
    { name: 'undeliverable', passed: false, failedCheck: 'shipments.allocation', orderId: 'gid://shopify/Order/2', orderName: '#2' },
  ]);
  const runB = fakeRun('US', [
    { name: 'single', passed: true, orderId: 'gid://shopify/Order/9', orderName: '#9' }, // different order id/name - volatile, must not cause variance
    { name: 'undeliverable', passed: false, failedCheck: 'shipments.allocation', orderId: 'gid://shopify/Order/10', orderName: '#10' },
  ]);

  const diff = diffRepeats([runA, runB]);
  assert.equal(diff.consistent, true);
  assert.deepEqual(diff.variance, {});
});

test('diffRepeats flags variance when a case flips pass/fail across identical repeats (race-condition signal)', () => {
  const runA = fakeRun('US', [{ name: 'undeliverable', passed: false, failedCheck: 'shipments.allocation' }]);
  const runB = fakeRun('US', [{ name: 'undeliverable', passed: true }]);

  const diff = diffRepeats([runA, runB]);
  assert.equal(diff.consistent, false);
  assert.ok('undeliverable' in diff.variance);
  assert.equal(diff.variance.undeliverable.length, 2);
});

test('diffRepeats flags variance when the failing check differs across identical repeats', () => {
  const runA = fakeRun('US', [{ name: 'partial_undeliverable', passed: false, failedCheck: 'shipments.allocation' }]);
  const runB = fakeRun('US', [{ name: 'partial_undeliverable', passed: false, failedCheck: 'inventory.decrement' }]);

  const diff = diffRepeats([runA, runB]);
  assert.equal(diff.consistent, false);
  assert.ok('partial_undeliverable' in diff.variance);
});
