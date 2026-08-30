/**
 * returnCreate + returnClose probe — TAA-57. Highest-risk piece of this
 * ticket, built FIRST per the ticket's own instruction, and deliberately NOT
 * a settle predicate until a live run proves there is something to settle
 * on.
 *
 * TAA-53's probe (ts/scripts/probe-admin-mutations.js's `return-flow`
 * action, read-only evidence) already found returnCreate+returnClose
 * succeeding on Shopify's side while producing ZERO TRANSACTION# rows on
 * staging-orders-v2 after 5+ minutes, and closing with no money movement at
 * all (see the TAA-53 sign-off's contract table). That probe only polled
 * TRANSACTION# rows on one table, for 60s. This module repeats the
 * experiment more thoroughly — a full ORDER + ITEM# + TRANSACTION# row dump
 * on staging-orders-v2, before and after, diffed field-by-field — to answer
 * the question TAA-58 (which owns the return cases) needs settled before it
 * can design around this: is there ANY positive terminal condition a
 * poll predicate could wait on, anywhere in this row set?
 *
 * `captureReturnSnapshot`/`diffReturnSnapshots` are pure and offline-testable
 * against the live-captured before/after fixtures this ticket's probe run
 * produces (or, if no real run had landed yet, would produce — see the
 * sign-off for which). `runReturnProbe` is the live orchestrator: it places
 * no order itself (the caller supplies an already-placed order, the same
 * ownership split fulfilFlow.ts/rejectFlow.ts use), fires returnCreate then
 * returnClose, waits a FIXED window (not a predicate — there is nothing
 * proven to poll on yet), and returns the before/after/diff for the caller
 * to record. Asserts nothing, matching every other flow in this file: no
 * import from src/verify/**, no pass/fail judgement.
 */

import type { Store } from "../config";
import type { DynamoReader, OrderItemRow, OrderRecord, TransactionRow } from "../readers/dynamoReader";
import { orderItemRowsFromRows, orderRecordFromRows, transactionRowsFromRows } from "../readers/dynamoReader";
import type { CreateReturnLineItem, CreateReturnResult, CloseReturnResult, ShopifyAdminClient } from "../clients/shopifyAdmin";
import { sleep } from "../polling";

/**
 * A fixed wait after returnCreate+returnClose before capturing the "after"
 * snapshot — NOT a poll predicate, because nothing observable to poll on has
 * been proven to exist yet (that is the open question this probe answers).
 * Sized against the same orders-service pipeline editFlow.ts/holdFlow.ts
 * poll against (config.ts's DEFAULT_POLL_WINDOWS.ordersService, 120s) so a
 * genuinely slow-but-real effect isn't missed by a shorter, arbitrarily
 * chosen wait.
 */
export const RETURN_PROBE_WAIT_SECONDS = 120;

export interface ReturnRowSnapshot {
  order: OrderRecord | null;
  items: OrderItemRow[];
  transactions: TransactionRow[];
}

/** One fetch, composed off getOrderRows (a single Dynamo query) — same pattern editFlow.ts/holdFlow.ts use for their own row-state fetches. */
export async function captureReturnSnapshot(reader: DynamoReader, store: Store, orderIdTail: string): Promise<ReturnRowSnapshot> {
  const rows = await reader.getOrderRows(store, orderIdTail);
  return {
    order: orderRecordFromRows(rows),
    items: orderItemRowsFromRows(rows),
    transactions: transactionRowsFromRows(rows),
  };
}

export interface ReturnSnapshotDiff {
  /** Whole-value diff of every OrderRecord field JJ has flagged as drift-prone in this project (status/onHold/grandTotal/subtotal), plus a raw-equality fallback so an unexpected field change is never silently missed. */
  orderChanged: boolean;
  orderFieldsChanged: string[];
  itemCountBefore: number;
  itemCountAfter: number;
  itemRowsChanged: boolean;
  /** New TRANSACTION# rows present after that were not present before, matched by SK (each TRANSACTION#<timestamp> sort key is unique per row). */
  newTransactionSks: string[];
  /** True if NOTHING observable changed anywhere in the row set — the honest null result this probe exists to detect. */
  nothingChanged: boolean;
}

const ORDER_RECORD_FIELDS: Array<keyof OrderRecord> = ["status", "onHold", "paymentMethod", "subtotal", "grandTotal", "currency"];

/**
 * Pure diff of two snapshots of the same order. Deliberately does not
 * interpret or judge the diff (that would be an assertion) — it only
 * reports what changed, for a human (or a future predicate author) to read.
 */
export function diffReturnSnapshots(before: ReturnRowSnapshot, after: ReturnRowSnapshot): ReturnSnapshotDiff {
  const orderFieldsChanged: string[] = [];
  if (before.order === null && after.order !== null) {
    orderFieldsChanged.push("(order row appeared)");
  } else if (before.order !== null && after.order === null) {
    orderFieldsChanged.push("(order row disappeared)");
  } else if (before.order !== null && after.order !== null) {
    for (const field of ORDER_RECORD_FIELDS) {
      if (JSON.stringify(before.order[field]) !== JSON.stringify(after.order[field])) {
        orderFieldsChanged.push(field);
      }
    }
  }

  const itemRowsChanged = JSON.stringify(before.items.map((i) => i.sku).sort()) !== JSON.stringify(after.items.map((i) => i.sku).sort())
    || JSON.stringify(before.items) !== JSON.stringify(after.items);

  const beforeSks = new Set(before.transactions.map((t) => t.sk));
  const newTransactionSks = after.transactions.filter((t) => !beforeSks.has(t.sk)).map((t) => t.sk);

  const orderChanged = orderFieldsChanged.length > 0;
  const nothingChanged = !orderChanged && !itemRowsChanged && newTransactionSks.length === 0;

  return {
    orderChanged,
    orderFieldsChanged,
    itemCountBefore: before.items.length,
    itemCountAfter: after.items.length,
    itemRowsChanged,
    newTransactionSks,
    nothingChanged,
  };
}

export interface ReturnProbeDeps {
  admin: ShopifyAdminClient;
  reader: DynamoReader;
  verbose?: boolean;
}

export interface ReturnProbeResult {
  orderId: string;
  orderIdTail: string;
  createReturn: CreateReturnResult;
  closeReturn: CloseReturnResult;
  before: ReturnRowSnapshot;
  after: ReturnRowSnapshot;
  diff: ReturnSnapshotDiff;
  waitedSeconds: number;
}

/**
 * Fires returnCreate then returnClose against an already-placed, already-
 * fulfilled order (a return needs a real FulfillmentLineItem to target — the
 * caller resolves `lineItems` off a Shopify fulfilment read-back, same
 * `readers/shopifyReader.ts` surface holdFlow.ts's fulfillment-order
 * resolver uses). Captures before/after and diffs them. Asserts nothing —
 * the caller decides what the diff means.
 */
export async function runReturnProbe(
  deps: ReturnProbeDeps,
  store: Store,
  orderId: string,
  orderIdTail: string,
  lineItems: CreateReturnLineItem[],
  waitSeconds: number = RETURN_PROBE_WAIT_SECONDS,
): Promise<ReturnProbeResult> {
  const { admin, reader } = deps;

  const before = await captureReturnSnapshot(reader, store, orderIdTail);

  const createReturn = await admin.createReturn(orderId, lineItems);
  const closeReturn = await admin.closeReturn(createReturn.returnId);

  await sleep(waitSeconds * 1000);
  const after = await captureReturnSnapshot(reader, store, orderIdTail);

  const diff = diffReturnSnapshots(before, after);

  return { orderId, orderIdTail, createReturn, closeReturn, before, after, diff, waitedSeconds: waitSeconds };
}
