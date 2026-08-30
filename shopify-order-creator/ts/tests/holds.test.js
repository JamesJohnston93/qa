const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderRecordFromRows, transactionRowsFromRows } = require('../dist/readers/dynamoReader.js');
const {
  assertOnHold,
  assertNotOnHold,
  assertHoldReasonAbsent,
  assertHoldTransactionCount,
  assertUnholdTransactionCount,
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

// --- assertHoldTransactionCount / assertUnholdTransactionCount (TAA-54) ----

test('assertHoldTransactionCount passes: exactly one HOLD_ORDER row names POTENTIAL_FRAUD (US #10007, round trip)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-taa57-hold-fraud-10007.json'));
  assert.doesNotThrow(() => assertHoldTransactionCount(transactions, POTENTIAL_FRAUD, 1, '#10007'));
});

test('assertUnholdTransactionCount passes: exactly one UNHOLD_ORDER row names POTENTIAL_FRAUD (US #10007, round trip)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-taa57-hold-fraud-10007.json'));
  assert.doesNotThrow(() => assertUnholdTransactionCount(transactions, POTENTIAL_FRAUD, 1, '#10007'));
});

test('assertHoldTransactionCount and assertUnholdTransactionCount pass for OUTSTANDING_PAYMENT on both stores (PS #3332, US #10008)', () => {
  for (const [fixture, orderName] of [
    ['PS-taa57-hold-outstanding-3332.json', '#3332'],
    ['US-taa57-hold-outstanding-10008.json', '#10008'],
  ]) {
    const transactions = transactionRowsFromRows(loadFixture(fixture));
    assert.doesNotThrow(() => assertHoldTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, orderName));
    assert.doesNotThrow(() => assertUnholdTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, orderName));
  }
});

test('assertHoldTransactionCount throws orders_table.hold_transaction_count on a mismatched count (PS #3326: three HOLD_ORDER rows, not one)', () => {
  const transactions = transactionRowsFromRows(loadFixture('PS-taa52-hold-outstanding-dup-3326.json'));
  assert.throws(() => assertHoldTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, '#3326'), (err) => {
    assert.match(err.message, /orders_table\.hold_transaction_count/);
    assert.equal(err.expected, 1);
    assert.equal(err.actual, 3);
    return true;
  });
});

test('assertHoldTransactionCount throws when the reason never fired at all (0 HOLD_ORDER rows)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertHoldTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, '#9994'), (err) => {
    assert.match(err.message, /orders_table\.hold_transaction_count/);
    assert.equal(err.actual, 0);
    return true;
  });
});

test('os_hold_multi (TC9) shape: both reasons present, exactly one HOLD_ORDER row each (synthesized fixture)', () => {
  const rows = loadFixture('US-taa54-hold-multi-synth.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.doesNotThrow(() => assertOnHold(record, [POTENTIAL_FRAUD, OUTSTANDING_PAYMENT], '#90001'));
  assert.doesNotThrow(() => assertHoldTransactionCount(transactions, POTENTIAL_FRAUD, 1, '#90001'));
  assert.doesNotThrow(() => assertHoldTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, '#90001'));
});

test('os_hold_partial_release (TC12) shape: fraud released, outstanding remains, no UNHOLD_ORDER for outstanding (synthesized fixture)', () => {
  const rows = loadFixture('US-taa54-hold-partial-release-synth.json');
  const record = orderRecordFromRows(rows);
  const transactions = transactionRowsFromRows(rows);
  assert.doesNotThrow(() => assertOnHold(record, [OUTSTANDING_PAYMENT], '#90002'));
  assert.doesNotThrow(() => assertUnholdTransactionCount(transactions, POTENTIAL_FRAUD, 1, '#90002'));
  assert.doesNotThrow(() => assertUnholdTransactionCount(transactions, OUTSTANDING_PAYMENT, 0, '#90002'));
});

test('assertUnholdTransactionCount throws orders_table.unhold_transaction_count when a release is asserted but never happened', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertUnholdTransactionCount(transactions, POTENTIAL_FRAUD, 1, '#9994'), (err) => {
    assert.match(err.message, /orders_table\.unhold_transaction_count/);
    assert.equal(err.expected, 1);
    assert.equal(err.actual, 0);
    return true;
  });
});
