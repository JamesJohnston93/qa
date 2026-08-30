const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transactionRowsFromRows } = require('../dist/readers/dynamoReader.js');
const {
  assertTransactionPresent,
  assertTransactionAbsent,
  assertTransactionOrder,
  refundedSkuStatusMatcher,
} = require('../dist/verify/transactions.js');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'orders-v2');
const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));

test('assertTransactionPresent passes when the event exists (CREATE_ORDER, order #9994)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertTransactionPresent(transactions, 'CREATE_ORDER', '#9994'));
});

test('assertTransactionPresent throws orders_table.transaction_present when the event is absent', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertTransactionPresent(transactions, 'UNHOLD_ORDER', '#9994'), /orders_table\.transaction_present/);
});

test('assertTransactionPresent with a matcher only passes when a matching row exists (HOLD_ORDER carrying POTENTIAL_FRAUD, order #9994)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  const carriesFraud = (t) => Array.isArray(t.raw.onHoldChanges?.added) && t.raw.onHoldChanges.added.includes('POTENTIAL_FRAUD');
  assert.doesNotThrow(() => assertTransactionPresent(transactions, 'HOLD_ORDER', '#9994', carriesFraud));
});

test('assertTransactionPresent with a matcher throws when the event exists but no row satisfies the matcher', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  const carriesOutstanding = (t) => Array.isArray(t.raw.onHoldChanges?.added) && t.raw.onHoldChanges.added.includes('OUTSTANDING_PAYMENT');
  assert.throws(
    () => assertTransactionPresent(transactions, 'HOLD_ORDER', '#9994', carriesOutstanding),
    /orders_table\.transaction_present/,
  );
});

test('assertTransactionAbsent passes when the event never appears', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertTransactionAbsent(transactions, 'UNHOLD_ORDER', '#9994'));
});

test('assertTransactionAbsent throws orders_table.transaction_absent when the event is present', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(() => assertTransactionAbsent(transactions, 'CREATE_ORDER', '#9994'), /orders_table\.transaction_absent/);
});

test('assertTransactionOrder passes for the observed CREATE_ORDER -> HOLD_ORDER sequence (order #9994)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.doesNotThrow(() => assertTransactionOrder(transactions, ['CREATE_ORDER', 'HOLD_ORDER'], '#9994'));
});

test('assertTransactionOrder passes for the observed CREATE_ORDER -> ADD_ITEM -> HOLD_ORDER sequence (order #9998)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-outstanding-edit-9998.json'));
  assert.doesNotThrow(() => assertTransactionOrder(transactions, ['CREATE_ORDER', 'ADD_ITEM', 'HOLD_ORDER'], '#9998'));
});

test('assertTransactionOrder throws orders_table.transaction_order when the events are reversed', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(
    () => assertTransactionOrder(transactions, ['HOLD_ORDER', 'CREATE_ORDER'], '#9994'),
    /orders_table\.transaction_order/,
  );
});

test('assertTransactionOrder throws when an expected event never appears at all', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-hold-fraud-9994.json'));
  assert.throws(
    () => assertTransactionOrder(transactions, ['CREATE_ORDER', 'CLOSE_ORDER'], '#9994'),
    /orders_table\.transaction_order/,
  );
});

// TAA-59: refundedSkuStatusMatcher + the REFUND_SHIPPING presence/absence
// contract, using the two committed undeliverable fixtures.
test('refundedSkuStatusMatcher matches the REFUND_ITEM row carrying UNDELIVERABLE for the given sku (order #9865, fully undeliverable)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-undeliverable-9865.json'));
  assert.doesNotThrow(() =>
    assertTransactionPresent(transactions, 'REFUND_ITEM', '#9865', refundedSkuStatusMatcher('33788579', 'UNDELIVERABLE')),
  );
});

test('refundedSkuStatusMatcher throws when the sku/status pair does not match any refunded entry', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-undeliverable-9865.json'));
  assert.throws(
    () => assertTransactionPresent(transactions, 'REFUND_ITEM', '#9865', refundedSkuStatusMatcher('33788579', 'OPEN')),
    /orders_table\.transaction_present/,
  );
});

test('refundedSkuStatusMatcher matches on the partial-undeliverable order too (order #9866, one of two items)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-undeliverable-9866.json'));
  assert.doesNotThrow(() =>
    assertTransactionPresent(transactions, 'REFUND_ITEM', '#9866', refundedSkuStatusMatcher('33946269', 'UNDELIVERABLE')),
  );
});

test('assertTransactionPresent finds REFUND_SHIPPING on a fully-undeliverable order (order #9865)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-undeliverable-9865.json'));
  assert.doesNotThrow(() => assertTransactionPresent(transactions, 'REFUND_SHIPPING', '#9865'));
});

test('assertTransactionAbsent confirms no REFUND_SHIPPING on a partial-undeliverable order (order #9866)', () => {
  const transactions = transactionRowsFromRows(loadFixture('US-undeliverable-9866.json'));
  assert.doesNotThrow(() => assertTransactionAbsent(transactions, 'REFUND_SHIPPING', '#9866'));
});
