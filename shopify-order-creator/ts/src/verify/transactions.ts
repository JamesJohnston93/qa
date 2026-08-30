/**
 * General-purpose TRANSACTION# assertions over staging-orders-v2 (TAA-52).
 * Sibling to verify/rejects.ts's assertRejectTransactions (staging-shipments)
 * — this file is table-agnostic in the same way transactionRowsByEvent is,
 * but named/checked for the orders_table source this ticket owns.
 */

import type { TransactionRow } from "../readers/dynamoReader";
import { transactionRowsByEvent } from "../readers/dynamoReader";
import { VerificationError } from "./index";

/** Optional extra predicate a matching transaction must also satisfy, e.g. checking a payload field. */
export type TransactionMatcher = (transaction: TransactionRow) => boolean;

function matching(transactions: TransactionRow[], event: string, matcher?: TransactionMatcher): TransactionRow[] {
  const byEvent = transactionRowsByEvent(transactions, event);
  return matcher ? byEvent.filter(matcher) : byEvent;
}

/** At least one transaction with the given event (and, if supplied, satisfying matcher) is present. */
export function assertTransactionPresent(
  transactions: TransactionRow[],
  event: string,
  orderName: string,
  matcher?: TransactionMatcher,
): void {
  const byEvent = transactionRowsByEvent(transactions, event);
  const matches = matcher ? byEvent.filter(matcher) : byEvent;
  if (matches.length === 0) {
    throw new VerificationError(
      "orders_table.transaction_present",
      `at least one ${event} transaction${matcher ? " matching predicate" : ""}`,
      `0 found (${byEvent.length} ${event} row(s) total, before predicate)`,
      `order ${orderName}`,
    );
  }
}

/** No transaction with the given event (and, if supplied, satisfying matcher) is present. */
export function assertTransactionAbsent(
  transactions: TransactionRow[],
  event: string,
  orderName: string,
  matcher?: TransactionMatcher,
): void {
  const matches = matching(transactions, event, matcher);
  if (matches.length > 0) {
    throw new VerificationError(
      "orders_table.transaction_absent",
      `no ${event} transaction${matcher ? " matching predicate" : ""}`,
      `${matches.length} found`,
      `order ${orderName}`,
    );
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
export function assertTransactionOrder(transactions: TransactionRow[], expectedEvents: string[], orderName: string): void {
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
    throw new VerificationError(
      "orders_table.transaction_order",
      expectedEvents,
      transactions.map((t) => t.event),
      `order ${orderName}: matched ${cursor} of ${expectedEvents.length} expected events in order`,
    );
  }
}
