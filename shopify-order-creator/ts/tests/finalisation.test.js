const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderRecordFromRows } = require('../dist/readers/dynamoReader.js');
const { assertOrderStatus, assertNotFinalised, assertFinalisedExactlyOnce, FULFILLED } = require('../dist/verify/finalisation.js');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

test('assertOrderStatus passes for a matching status (order #9994, OPEN)', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertOrderStatus(record, 'OPEN', '#9994'));
});

test('assertOrderStatus throws orders_table.status with expected-vs-actual on mismatch', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertOrderStatus(record, FULFILLED, '#9994'), (err) => {
    assert.match(err.message, /orders_table\.status/);
    assert.equal(err.expected, FULFILLED);
    assert.equal(err.actual, 'OPEN');
    return true;
  });
});

test('assertOrderStatus throws orders_table.exists on a null record', () => {
  assert.throws(() => assertOrderStatus(null, 'OPEN', '#9999'), /orders_table\.exists/);
});

// FINDING (see verify/finalisation.ts module doc comment): the finalisation
// signal is ORDER.status -> FULFILLED, not a TRANSACTION# event — no
// finalisation transaction row exists in any fixture, including this one.
// PS #3329 is a single-item digital gift-card order that auto-fulfils on
// creation; its TRANSACTION# log holds only the original CREATE_ORDER row.
test('a fully-fulfilled order (PS #3329) reads ORDER.status FULFILLED with only its original CREATE_ORDER transaction, no finalisation event of any kind', () => {
  const rows = loadFixture('PS-taa52-finalised-3329.json');
  const record = orderRecordFromRows(rows);
  assert.equal(record.status, FULFILLED);
  const transactionEvents = rows.filter((r) => String(r.SK ?? '').startsWith('TRANSACTION#')).map((r) => r.event);
  assert.deepEqual(transactionEvents, ['CREATE_ORDER']);
});

test('assertNotFinalised passes for an OPEN order (order #9994)', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertNotFinalised(record, '#9994'));
});

test('assertNotFinalised throws orders_table.not_finalised for a FULFILLED order (PS #3329)', () => {
  const record = orderRecordFromRows(loadFixture('PS-taa52-finalised-3329.json'));
  assert.throws(() => assertNotFinalised(record, '#3329'), /orders_table\.not_finalised/);
});

test('assertNotFinalised throws orders_table.exists on a null record', () => {
  assert.throws(() => assertNotFinalised(null, '#9999'), /orders_table\.exists/);
});

test('assertFinalisedExactlyOnce passes for a FULFILLED order (PS #3329)', () => {
  const record = orderRecordFromRows(loadFixture('PS-taa52-finalised-3329.json'));
  assert.doesNotThrow(() => assertFinalisedExactlyOnce(record, '#3329'));
});

test('assertFinalisedExactlyOnce throws orders_table.finalised_exactly_once with expected-vs-actual for a not-yet-finalised order (order #9994)', () => {
  const record = orderRecordFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertFinalisedExactlyOnce(record, '#9994'), (err) => {
    assert.match(err.message, /orders_table\.finalised_exactly_once/);
    assert.equal(err.expected, FULFILLED);
    assert.equal(err.actual, 'OPEN');
    return true;
  });
});
