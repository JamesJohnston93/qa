/**
 * Hold-state assertions over the staging-orders-v2 ORDER row's `onHold`
 * array (TAA-52). Two reason strings observed live to date (TAA-50):
 * POTENTIAL_FRAUD and OUTSTANDING_PAYMENT. HIGH_RISK_OF_FRAUD is the
 * GraphQL `fulfillmentOrderHold(reason:)` INPUT enum, which translates to
 * POTENTIAL_FRAUD on this row — never assert HIGH_RISK_OF_FRAUD against a
 * DynamoDB read, only against a GraphQL call site.
 *
 * `onHold` is an accumulating log, not a deduplicated set: PS #3326
 * (`ts/fixtures/orders-v2/PS-taa52-hold-outstanding-dup-3326.json`, captured
 * this ticket) shows `onHold: ["OUTSTANDING_PAYMENT", "OUTSTANDING_PAYMENT",
 * "OUTSTANDING_PAYMENT"]` — three separate HOLD_ORDER transaction rows, one
 * per trigger, each appending the same reason string with no dedup on the
 * backend's side. assertOnHold therefore compares unique reason sets, not
 * raw array equality — a caller asserting "on hold for OUTSTANDING_PAYMENT"
 * must not have to know or predict how many times the trigger fired.
 *
 * assertHoldTransactionCount/assertUnholdTransactionCount (TAA-54) close the
 * gap the dup-row finding above exposed: assertOnHold only ever compares
 * REASON SETS, so it cannot by itself distinguish "held for
 * OUTSTANDING_PAYMENT via one HOLD_ORDER row" from "...via three" — exactly
 * the distinction TAA-54's os_hold_multi (TC9) needs ("exactly one HOLD_ORDER
 * row per distinct reason") and os_hold_partial_release (TC12) needs (an
 * UNHOLD_ORDER row naming the released reason, and the deliberate ABSENCE of
 * one naming the reason still held). `onHoldChangesFrom` below is a
 * deliberate duplicate of flows/holdFlow.ts's private helper of the same
 * name/shape (both read `TransactionRow.raw.onHoldChanges` since the field
 * isn't on TransactionRow's typed surface) — see that file's own doc comment
 * for why flows and verify/** each keep their own copy rather than sharing
 * one: "flows assert nothing, verify/** asserts... duplication is deliberate
 * and correct... sharing the check would couple two modules that need to
 * stay independently owned."
 */

import type { OrderRecord, TransactionRow } from "../readers/dynamoReader";
import { VerificationError } from "./index";

export const POTENTIAL_FRAUD = "POTENTIAL_FRAUD";
export const OUTSTANDING_PAYMENT = "OUTSTANDING_PAYMENT";

function uniqueSorted(reasons: string[]): string[] {
  return [...new Set(reasons)].sort();
}

function sameReasons(a: string[], b: string[]): boolean {
  const uniqueA = uniqueSorted(a);
  const uniqueB = uniqueSorted(b);
  return uniqueA.length === uniqueB.length && uniqueA.every((reason, index) => reason === uniqueB[index]);
}

function requireRecord(record: OrderRecord | null, orderName: string): asserts record is OrderRecord {
  if (!record) {
    throw new VerificationError("orders_table.exists", "ORDER row present", "not found yet", `order ${orderName}`);
  }
}

/**
 * The order is currently on hold for exactly the given set of DISTINCT
 * reasons (order doesn't matter; duplicate entries in onHold are collapsed
 * on both sides before comparing — see module doc comment). Null record
 * (order not landed in staging-orders-v2 yet) throws so a caller's poll loop
 * keeps going, same convention as verify/newstore.ts's assertNewStoreOrder.
 */
export function assertOnHold(record: OrderRecord | null, expectedReasons: string[], orderName: string): void {
  requireRecord(record, orderName);
  if (!sameReasons(record.onHold, expectedReasons)) {
    throw new VerificationError(
      "orders_table.on_hold",
      uniqueSorted(expectedReasons),
      uniqueSorted(record.onHold),
      `order ${orderName}`,
    );
  }
}

/** The order carries no hold reasons at all. */
export function assertNotOnHold(record: OrderRecord | null, orderName: string): void {
  requireRecord(record, orderName);
  if (record.onHold.length > 0) {
    throw new VerificationError("orders_table.not_on_hold", [], record.onHold, `order ${orderName}`);
  }
}

/**
 * A specific reason is absent from onHold — weaker than assertNotOnHold, for
 * e.g. confirming a fraud hold cleared without assuming no other hold reason
 * could be active at the same time (only two reasons are observed live to
 * date, but this makes no assumption that only one can ever be active).
 */
export function assertHoldReasonAbsent(record: OrderRecord | null, reason: string, orderName: string): void {
  requireRecord(record, orderName);
  if (record.onHold.includes(reason)) {
    throw new VerificationError("orders_table.hold_reason_absent", `${reason} absent`, record.onHold, `order ${orderName}`);
  }
}

function onHoldChangesFrom(transaction: TransactionRow, key: "added" | "removed"): string[] {
  const onHoldChanges = (transaction.raw as Record<string, unknown>).onHoldChanges as
    | Record<string, unknown[] | undefined>
    | undefined;
  const values = onHoldChanges?.[key];
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map(String);
}

/**
 * Exactly `expectedCount` HOLD_ORDER transaction rows name `reason` in their
 * `onHoldChanges.added`. `expectedCount` covers both presence (1, the normal
 * single-trigger case) and — same shape as verify/rejects.ts's
 * assertRejectTransactions — a caller could pass a higher count to
 * deliberately confirm a known-duplicated trigger, though no case in this
 * project asserts that today.
 */
export function assertHoldTransactionCount(
  transactions: TransactionRow[],
  reason: string,
  expectedCount: number,
  orderName: string,
): void {
  const matches = transactions.filter((t) => t.event === "HOLD_ORDER" && onHoldChangesFrom(t, "added").includes(reason));
  if (matches.length !== expectedCount) {
    throw new VerificationError(
      "orders_table.hold_transaction_count",
      expectedCount,
      matches.length,
      `order ${orderName}: expected exactly ${expectedCount} HOLD_ORDER transaction(s) naming ${reason} (onHoldChanges.added), got ${matches.length}`,
    );
  }
}

/**
 * Exactly `expectedCount` UNHOLD_ORDER transaction rows name `reason` in
 * their `onHoldChanges.removed`. `expectedCount` of `0` is a deliberate,
 * first-class use — TAA-54's os_hold_partial_release (TC12) asserts the
 * ABSENCE of a release row for the reason still held, alongside a `1` for
 * the reason actually released on the same order.
 */
export function assertUnholdTransactionCount(
  transactions: TransactionRow[],
  reason: string,
  expectedCount: number,
  orderName: string,
): void {
  const matches = transactions.filter((t) => t.event === "UNHOLD_ORDER" && onHoldChangesFrom(t, "removed").includes(reason));
  if (matches.length !== expectedCount) {
    throw new VerificationError(
      "orders_table.unhold_transaction_count",
      expectedCount,
      matches.length,
      `order ${orderName}: expected exactly ${expectedCount} UNHOLD_ORDER transaction(s) naming ${reason} (onHoldChanges.removed), got ${matches.length}`,
    );
  }
}
