"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETURN_PROBE_WAIT_SECONDS = void 0;
exports.captureReturnSnapshot = captureReturnSnapshot;
exports.diffReturnSnapshots = diffReturnSnapshots;
exports.runReturnProbe = runReturnProbe;
const dynamoReader_1 = require("../readers/dynamoReader");
const polling_1 = require("../polling");
/**
 * A fixed wait after returnCreate+returnClose before capturing the "after"
 * snapshot — NOT a poll predicate, because nothing observable to poll on has
 * been proven to exist yet (that is the open question this probe answers).
 * Sized against the same orders-service pipeline editFlow.ts/holdFlow.ts
 * poll against (config.ts's DEFAULT_POLL_WINDOWS.ordersService, 120s) so a
 * genuinely slow-but-real effect isn't missed by a shorter, arbitrarily
 * chosen wait.
 */
exports.RETURN_PROBE_WAIT_SECONDS = 120;
/** One fetch, composed off getOrderRows (a single Dynamo query) — same pattern editFlow.ts/holdFlow.ts use for their own row-state fetches. */
async function captureReturnSnapshot(reader, store, orderIdTail) {
    const rows = await reader.getOrderRows(store, orderIdTail);
    return {
        order: (0, dynamoReader_1.orderRecordFromRows)(rows),
        items: (0, dynamoReader_1.orderItemRowsFromRows)(rows),
        transactions: (0, dynamoReader_1.transactionRowsFromRows)(rows),
    };
}
const ORDER_RECORD_FIELDS = ["status", "onHold", "paymentMethod", "subtotal", "grandTotal", "currency"];
/**
 * Pure diff of two snapshots of the same order. Deliberately does not
 * interpret or judge the diff (that would be an assertion) — it only
 * reports what changed, for a human (or a future predicate author) to read.
 */
function diffReturnSnapshots(before, after) {
    const orderFieldsChanged = [];
    if (before.order === null && after.order !== null) {
        orderFieldsChanged.push("(order row appeared)");
    }
    else if (before.order !== null && after.order === null) {
        orderFieldsChanged.push("(order row disappeared)");
    }
    else if (before.order !== null && after.order !== null) {
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
/**
 * Fires returnCreate then returnClose against an already-placed, already-
 * fulfilled order (a return needs a real FulfillmentLineItem to target — the
 * caller resolves `lineItems` off a Shopify fulfilment read-back, same
 * `readers/shopifyReader.ts` surface holdFlow.ts's fulfillment-order
 * resolver uses). Captures before/after and diffs them. Asserts nothing —
 * the caller decides what the diff means.
 */
async function runReturnProbe(deps, store, orderId, orderIdTail, lineItems, waitSeconds = exports.RETURN_PROBE_WAIT_SECONDS) {
    const { admin, reader } = deps;
    const before = await captureReturnSnapshot(reader, store, orderIdTail);
    const createReturn = await admin.createReturn(orderId, lineItems);
    const closeReturn = await admin.closeReturn(createReturn.returnId);
    await (0, polling_1.sleep)(waitSeconds * 1000);
    const after = await captureReturnSnapshot(reader, store, orderIdTail);
    const diff = diffReturnSnapshots(before, after);
    return { orderId, orderIdTail, createReturn, closeReturn, before, after, diff, waitedSeconds: waitSeconds };
}
