/**
 * Order-finalisation assertions over the staging-orders-v2 ORDER row
 * (TAA-52).
 *
 * FINDING, supersedes the ticket's framing: the finalisation signal is the
 * ORDER row's `status` field transitioning to FULFILLED, NOT a
 * TRANSACTION# event. No finalisation TRANSACTION# row of any spelling has
 * ever been observed, on any table — confirmed across FOUR independent
 * orders where the order's only/last open item reached a terminal
 * fulfilled state: US #9929, #9932, #9935 (already-committed TAA-37
 * fixtures, fully fulfilled via the real fulfil path) and PS #3329
 * (`ts/fixtures/orders-v2/PS-taa52-finalised-3329.json`, captured this
 * ticket — a single-item digital gift-card order that auto-fulfils on
 * creation). In every one of the four, `ORDER.status` reads `FULFILLED`
 * while the order's TRANSACTION# log holds ONLY its original CREATE_ORDER
 * row — no second transaction of any event name ever appears. This was
 * re-confirmed live (not just against the fixture) against PS #3329 via
 * the real DynamoReader before writing this file. TAA-33 (order-finalised
 * transaction) may still be watching for something that fires on a
 * different order shape than any of these four represent, but there is no
 * evidence for an event-shaped signal on this table today, and hardcoding
 * one would be exactly the guessed-spelling failure mode this project's
 * assert-observed-spellings convention exists to prevent. A status check
 * is also the right shape independent of that: it is a POSITIVE terminal
 * condition, the same rule this project's settle predicates already follow
 * (never "nothing changed for N ticks").
 */

import type { OrderRecord } from "../readers/dynamoReader";
import { VerificationError } from "./index";

/** The terminal ORDER.status value once every item has fulfilled. Same string as verify/fulfilment.ts's FULFILLED (staging-shipments ITEM#/SHIPMENT# rows) — coincidence, not a shared source; that constant is a different table's field and is not imported here. */
export const FULFILLED = "FULFILLED";

function requireRecord(record: OrderRecord | null, orderName: string): asserts record is OrderRecord {
  if (!record) {
    throw new VerificationError("orders_table.exists", "ORDER row present", "not found yet", `order ${orderName}`);
  }
}

/** The ORDER row's status field matches exactly. Generic — not finalisation-specific. */
export function assertOrderStatus(record: OrderRecord | null, expectedStatus: string, orderName: string): void {
  requireRecord(record, orderName);
  if (record.status !== expectedStatus) {
    throw new VerificationError("orders_table.status", expectedStatus, record.status, `order ${orderName}`);
  }
}

/** The order has NOT yet reached the FULFILLED terminal status. */
export function assertNotFinalised(record: OrderRecord | null, orderName: string): void {
  requireRecord(record, orderName);
  if (record.status === FULFILLED) {
    throw new VerificationError("orders_table.not_finalised", `status != ${FULFILLED}`, record.status, `order ${orderName}`);
  }
}

/**
 * The order has reached the FULFILLED terminal status — see module doc
 * comment for why this is a status check, not a transaction-count check.
 * A status is inherently single-valued, so "exactly once" collapses to "is
 * FULFILLED now"; there is no separate multiple-finalisation failure mode
 * to distinguish on this table the way there is for e.g. reject
 * transactions.
 */
export function assertFinalisedExactlyOnce(record: OrderRecord | null, orderName: string): void {
  requireRecord(record, orderName);
  if (record.status !== FULFILLED) {
    throw new VerificationError("orders_table.finalised_exactly_once", FULFILLED, record.status, `order ${orderName}`);
  }
}
