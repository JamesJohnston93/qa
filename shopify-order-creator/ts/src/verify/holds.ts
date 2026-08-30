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
 */

import type { OrderRecord } from "../readers/dynamoReader";
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
