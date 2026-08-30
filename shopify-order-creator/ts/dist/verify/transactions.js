"use strict";
/**
 * General-purpose TRANSACTION# assertions over staging-orders-v2 (TAA-52).
 * Sibling to verify/rejects.ts's assertRejectTransactions (staging-shipments)
 * — this file is table-agnostic in the same way transactionRowsByEvent is,
 * but named/checked for the orders_table source this ticket owns.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTransactionPresent = assertTransactionPresent;
exports.assertTransactionAbsent = assertTransactionAbsent;
exports.assertTransactionOrder = assertTransactionOrder;
const dynamoReader_1 = require("../readers/dynamoReader");
const index_1 = require("./index");
function matching(transactions, event, matcher) {
    const byEvent = (0, dynamoReader_1.transactionRowsByEvent)(transactions, event);
    return matcher ? byEvent.filter(matcher) : byEvent;
}
/** At least one transaction with the given event (and, if supplied, satisfying matcher) is present. */
function assertTransactionPresent(transactions, event, orderName, matcher) {
    const byEvent = (0, dynamoReader_1.transactionRowsByEvent)(transactions, event);
    const matches = matcher ? byEvent.filter(matcher) : byEvent;
    if (matches.length === 0) {
        throw new index_1.VerificationError("orders_table.transaction_present", `at least one ${event} transaction${matcher ? " matching predicate" : ""}`, `0 found (${byEvent.length} ${event} row(s) total, before predicate)`, `order ${orderName}`);
    }
}
/** No transaction with the given event (and, if supplied, satisfying matcher) is present. */
function assertTransactionAbsent(transactions, event, orderName, matcher) {
    const matches = matching(transactions, event, matcher);
    if (matches.length > 0) {
        throw new index_1.VerificationError("orders_table.transaction_absent", `no ${event} transaction${matcher ? " matching predicate" : ""}`, `${matches.length} found`, `order ${orderName}`);
    }
}
/**
 * Confirms expectedEvents appears, in order, as a (not necessarily
 * contiguous) subsequence of transactions' events. Rows are already
 * chronological (transactionRowsFromRows does not re-sort a Query's
 * ascending-sort-key result), so this is a genuine ordering check, not just
 * a presence check. Does not check count or adjacency — assertTransaction
 * Present/Absent and assertFinalisedExactlyOnce own count checks.
 */
function assertTransactionOrder(transactions, expectedEvents, orderName) {
    let cursor = 0;
    for (const transaction of transactions) {
        if (cursor >= expectedEvents.length) {
            break;
        }
        if (transaction.event === expectedEvents[cursor]) {
            cursor += 1;
        }
    }
    if (cursor < expectedEvents.length) {
        throw new index_1.VerificationError("orders_table.transaction_order", expectedEvents, transactions.map((t) => t.event), `order ${orderName}: matched ${cursor} of ${expectedEvents.length} expected events in order`);
    }
}
