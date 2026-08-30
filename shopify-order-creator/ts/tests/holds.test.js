const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderRecordFromRows } = require('../dist/readers/dynamoReader.js');
const {
  assertOnHold,
  assertNotOnHold,
  assertHoldReasonAbsent,
  POTENTIAL_FRAUD,
  OUTSTANDING_PAYMENT,
} = require('../dist/verify/holds.js');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

test('assertOnHold passes for a fraud hold (order #9994) against POTENTIAL_FRAUD', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertOnHold(record, [POTENTIAL_FRAUD], '#9994'));
});

test('assertOnHold passes for an outstanding-payment hold (order #9998) against OUTSTANDING_PAYMENT', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-outstanding-edit-9998.json'));
  assert.doesNotThrow(() => assertOnHold(record, [OUTSTANDING_PAYMENT], '#9998'));
});

test('assertOnHold throws orders_table.on_hold with expected-vs-actual reasons when the wrong reason is asserted', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertOnHold(record, [OUTSTANDING_PAYMENT], '#9994'), (err) => {
    assert.match(err.message, /orders_table\.on_hold/);
    assert.deepEqual(err.expected, [OUTSTANDING_PAYMENT]);
    assert.deepEqual(err.actual, [POTENTIAL_FRAUD]);
    return true;
  });
});

test('assertOnHold throws orders_table.exists on a null record (order not landed yet)', () => {
  assert.throws(() => assertOnHold(null, [POTENTIAL_FRAUD], '#9999'), /orders_table\.exists/);
});

test('assertNotOnHold passes for a never-held order (order #9997, click & collect)', () => {
  const record = orderRecordFromRows(loadFixture('US-clickcollect-9997.json'));
  assert.doesNotThrow(() => assertNotOnHold(record, '#9997'));
});

test('assertNotOnHold throws orders_table.not_on_hold for a held order', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertNotOnHold(record, '#9994'), /orders_table\.not_on_hold/);
});

test('assertHoldReasonAbsent passes when the named reason is not present, even if another reason is active', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertHoldReasonAbsent(record, OUTSTANDING_PAYMENT, '#9994'));
});

test('assertHoldReasonAbsent throws orders_table.hold_reason_absent when the named reason is present', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-outstanding-edit-9998.json'));
  assert.throws(() => assertHoldReasonAbsent(record, OUTSTANDING_PAYMENT, '#9998'), /orders_table\.hold_reason_absent/);
});

// FINDING: onHold is an accumulating log, not a deduplicated set (PS #3326,
// three separate HOLD_ORDER triggers, no dedup on the backend's side) — see
// verify/holds.ts's module doc comment. assertOnHold must tolerate this.
test('assertOnHold passes against a duplicated-reason onHold array (PS #3326: three OUTSTANDING_PAYMENT entries)', () => {
  const record = orderRecordFromRows(loadFixture('PS-taa52-hold-outstanding-dup-3326.json'));
  assert.deepEqual(record.onHold, [OUTSTANDING_PAYMENT, OUTSTANDING_PAYMENT, OUTSTANDING_PAYMENT]);
  assert.doesNotThrow(() => assertOnHold(record, [OUTSTANDING_PAYMENT], '#3326'));
});

test('assertOnHold still throws on a duplicated-reason record when the wrong reason is asserted', () => {
  const record = orderRecordFromRows(loadFixture('PS-taa52-hold-outstanding-dup-3326.json'));
  assert.throws(() => assertOnHold(record, [POTENTIAL_FRAUD], '#3326'), (err) => {
    assert.match(err.message, /orders_table\.on_hold/);
    assert.deepEqual(err.expected, [POTENTIAL_FRAUD]);
    assert.deepEqual(err.actual, [OUTSTANDING_PAYMENT]); // deduplicated, not [OUTSTANDING_PAYMENT x3]
    return true;
  });
});
