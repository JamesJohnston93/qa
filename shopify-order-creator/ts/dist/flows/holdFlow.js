"use strict";
/**
 * Hold on/off round trip — TAA-57. Two independent reasons, two independent
 * mechanisms, one shared settle shape:
 *
 *   - POTENTIAL_FRAUD, driven by fulfillmentOrderHold/ReleaseHold. TAA-53
 *     measured this landing in DynamoDB about 6.7s after the mutation. The
 *     GraphQL enum sent is HIGH_RISK_OF_FRAUD; the DynamoDB reason string
 *     that lands is POTENTIAL_FRAUD — different strings for the same hold,
 *     confirmed live (order #9994, US-hold-fraud-9994.json). Only the
 *     DynamoDB string belongs in a predicate over DynamoDB rows.
 *   - OUTSTANDING_PAYMENT, driven through the EDIT route (adding an unpaid
 *     item to an already-paid order), which flows/editFlow.ts already
 *     builds — composed here, not re-ported. Deliberately NOT driven through
 *     unpaid-order creation: TAA-50 tried that and got no orders-v2 row at
 *     all after six minutes despite the order existing in Shopify (US #9996,
 *     the burned spare) — an intermittent route, not a foundation for a
 *     terminal condition. US-hold-outstanding-edit-9998.json is the real
 *     fixture this reason's predicate is built against.
 *
 * Both reasons settle on the SAME two-part positive condition: the ORDER
 * row's `onHold` contains (or no longer contains) the reason string, AND a
 * matching HOLD_ORDER/UNHOLD_ORDER TRANSACTION# row is present naming it.
 * Neither alone is trusted, same reasoning as fulfilFlow.ts's
 * isFulfilmentSettled (status + trackingNumber together) — no measured
 * ordering between the two fields exists for holds the way TAA-41 pinned one
 * down for fulfilment, so both are required rather than assumed safe alone.
 *
 * TAA-52 (verify/holds.ts, a parallel session, not on this branch) will
 * encode the identical "onHold contains reason X" check as an assertion.
 * That duplication is deliberate and correct under this project's
 * conventions (JJ) — flows assert nothing, verify/** asserts; sharing the
 * check would couple two modules that need to stay independently owned.
 *
 * `onHoldChanges` is not on TransactionRow's typed surface
 * (readers/dynamoReader.ts, read-only to this ticket) — read off
 * `TransactionRow.raw`, the reader's documented escape hatch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAUD_HOLD_GRAPHQL_REASON = exports.OUTSTANDING_PAYMENT_REASON = exports.POTENTIAL_FRAUD_REASON = void 0;
exports.holdApplied = holdApplied;
exports.holdReleased = holdReleased;
exports.waitForHoldApplied = waitForHoldApplied;
exports.waitForHoldReleased = waitForHoldReleased;
exports.shopifyFulfillmentOrderResolver = shopifyFulfillmentOrderResolver;
exports.applyFraudHold = applyFraudHold;
exports.releaseFraudHold = releaseFraudHold;
exports.applyOutstandingPaymentHold = applyOutstandingPaymentHold;
exports.releaseOutstandingPaymentHold = releaseOutstandingPaymentHold;
const dynamoReader_1 = require("../readers/dynamoReader");
const shopifyReader_1 = require("../readers/shopifyReader");
const polling_1 = require("../polling");
const editFlow_1 = require("./editFlow");
/** DynamoDB reason string for a fulfillmentOrderHold(reason: HIGH_RISK_OF_FRAUD) call — confirmed live, order #9994. NOT a valid GraphQL FulfillmentHoldReason input. */
exports.POTENTIAL_FRAUD_REASON = "POTENTIAL_FRAUD";
/** DynamoDB reason string raised automatically by an order edit that adds an unpaid item — confirmed live, order #9998. Never sent as a mutation input. */
exports.OUTSTANDING_PAYMENT_REASON = "OUTSTANDING_PAYMENT";
/** GraphQL enum sent to fulfillmentOrderHold to raise POTENTIAL_FRAUD_REASON — see file header for why these two strings differ. */
exports.FRAUD_HOLD_GRAPHQL_REASON = "HIGH_RISK_OF_FRAUD";
function onHoldChangesFrom(transaction, key) {
    const onHoldChanges = transaction.raw.onHoldChanges;
    const values = onHoldChanges?.[key];
    if (!Array.isArray(values)) {
        return [];
    }
    return values.map(String);
}
/** True once the ORDER row's onHold contains `reason` AND a HOLD_ORDER row's onHoldChanges.added names it. Pure — offline-testable. */
function holdApplied(record, transactions, reason) {
    if (!record || !record.onHold.includes(reason)) {
        return false;
    }
    return transactions.some((t) => t.event === "HOLD_ORDER" && onHoldChangesFrom(t, "added").includes(reason));
}
/** True once the ORDER row's onHold no longer contains `reason` AND an UNHOLD_ORDER row's onHoldChanges.removed names it. Pure — offline-testable. */
function holdReleased(record, transactions, reason) {
    if (!record || record.onHold.includes(reason)) {
        return false;
    }
    return transactions.some((t) => t.event === "UNHOLD_ORDER" && onHoldChangesFrom(t, "removed").includes(reason));
}
/** One fetch, composed off getOrderRows (a single Dynamo query) — same "derive both views from one row set" pattern editFlow.ts's fetchEditRowState uses. */
async function fetchHoldRowState(reader, store, orderIdTail) {
    const rows = await reader.getOrderRows(store, orderIdTail);
    return { record: (0, dynamoReader_1.orderRecordFromRows)(rows), transactions: (0, dynamoReader_1.transactionRowsFromRows)(rows) };
}
async function waitForHoldApplied(reader, store, orderIdTail, reason, verbose = false) {
    return (0, polling_1.pollUntil)(() => fetchHoldRowState(reader, store, orderIdTail), (state) => holdApplied(state.record, state.transactions, reason), editFlow_1.ORDERS_SERVICE_SETTLE_WINDOW_SECONDS, editFlow_1.ORDERS_SERVICE_SETTLE_INTERVAL_SECONDS, `hold_applied:${reason}`, verbose);
}
async function waitForHoldReleased(reader, store, orderIdTail, reason, verbose = false) {
    return (0, polling_1.pollUntil)(() => fetchHoldRowState(reader, store, orderIdTail), (state) => holdReleased(state.record, state.transactions, reason), editFlow_1.ORDERS_SERVICE_SETTLE_WINDOW_SECONDS, editFlow_1.ORDERS_SERVICE_SETTLE_INTERVAL_SECONDS, `hold_released:${reason}`, verbose);
}
/** Live adapter over readers/shopifyReader.ts's getOrder (read-only to this ticket, reused as-is). */
function shopifyFulfillmentOrderResolver(shopify) {
    return {
        async resolveFulfillmentOrderId(orderGid) {
            const snapshot = await (0, shopifyReader_1.getOrder)(shopify, orderGid);
            const fulfillmentOrder = snapshot.fulfillmentOrders[0];
            if (!fulfillmentOrder) {
                throw new Error(`order ${orderGid} has no fulfillmentOrders to hold`);
            }
            return fulfillmentOrder.id;
        },
    };
}
async function applyFraudHold(deps, store, orderGid, orderIdTail, reasonNotes) {
    const { admin, reader, fulfillmentOrders, verbose = false } = deps;
    const fulfillmentOrderId = await fulfillmentOrders.resolveFulfillmentOrderId(orderGid);
    const hold = await admin.holdFulfillmentOrder(fulfillmentOrderId, exports.FRAUD_HOLD_GRAPHQL_REASON, reasonNotes);
    const { elapsed } = await waitForHoldApplied(reader, store, orderIdTail, exports.POTENTIAL_FRAUD_REASON, verbose);
    return {
        fulfillmentOrderId: hold.fulfillmentOrderId,
        fulfillmentHoldId: hold.fulfillmentHoldId,
        reason: exports.POTENTIAL_FRAUD_REASON,
        settledElapsedSeconds: elapsed,
    };
}
async function releaseFraudHold(deps, store, orderIdTail, fulfillmentOrderId) {
    const { admin, reader, verbose = false } = deps;
    const released = await admin.releaseHold(fulfillmentOrderId);
    const { elapsed } = await waitForHoldReleased(reader, store, orderIdTail, exports.POTENTIAL_FRAUD_REASON, verbose);
    return {
        fulfillmentOrderId: released.fulfillmentOrderId,
        reason: exports.POTENTIAL_FRAUD_REASON,
        settledElapsedSeconds: elapsed,
    };
}
/** Adds an unpaid item to an already-paid order (composing editFlow.ts's addItemToOrder, not re-porting it) and waits for the automatic OUTSTANDING_PAYMENT hold this triggers. `discount` is not needed for this route — the fixture this predicate was built against (order #9998) carried one only because TAA-53's probe was also proving the discount contract at the same time. */
async function applyOutstandingPaymentHold(deps, store, orderId, orderIdTail, variantId, sku, discount) {
    const { admin, reader, verbose = false } = deps;
    const edit = await (0, editFlow_1.addItemToOrder)({ admin, reader, verbose }, store, orderId, orderIdTail, variantId, sku, 1, discount);
    const { elapsed } = await waitForHoldApplied(reader, store, orderIdTail, exports.OUTSTANDING_PAYMENT_REASON, verbose);
    return { edit, reason: exports.OUTSTANDING_PAYMENT_REASON, settledElapsedSeconds: elapsed };
}
/** orderMarkAsPaid — TAA-53 measured the automatic pre-existing hold clearing ~27s after this call, UNHOLD_ORDER removing OUTSTANDING_PAYMENT. */
async function releaseOutstandingPaymentHold(deps, store, orderId, orderIdTail) {
    const { admin, reader, verbose = false } = deps;
    const marked = await admin.markAsPaid(orderId);
    const { elapsed } = await waitForHoldReleased(reader, store, orderIdTail, exports.OUTSTANDING_PAYMENT_REASON, verbose);
    return { orderId: marked.orderId, reason: exports.OUTSTANDING_PAYMENT_REASON, settledElapsedSeconds: elapsed };
}
