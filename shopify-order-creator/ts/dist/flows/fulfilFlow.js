"use strict";
/**
 * Whole-order fulfilment — TAA-36, slice C of the TAA-21 fulfilment
 * workstream. Wires the lookup chain slices A/B already proved (order id ->
 * order PK -> shipment rows -> grouped items -> payload) into one flow that
 * takes a Shopify order identifier and fulfils every shipment on it, with no
 * hand-supplied ids.
 *
 * Two settle waits, kept deliberately separate (do not collapse them):
 *
 *   1. Item-count settle, BEFORE fulfil. Allocation writes the SHIPMENT# row
 *      first, then ITEM# rows one at a time (readers/dynamoReader.ts) — a
 *      shipment id can be visible while its items are still landing.
 *      Fulfilling at that moment would send a short payload. Settled once
 *      every unit on the order (staging-orders-v2's ITEM# count) has a
 *      landed ITEM# row in staging-shipments, allocated or UNDELIVERABLE.
 *   2. Fulfilment settle, AFTER fulfil. The SHIPMENT# row lags the 200
 *      response (measured live, TAA-41: 6.5-9.0s, n=2) and trackingNumber /
 *      status do not land together — trackingNumber arrives first in both
 *      measured runs, status flips later. Both conditions must hold together.
 *
 * Poll windows below are local to this slice, not RegressionConfig.PollWindows
 * — config.ts is TAA-37's file this session, and until this slice nobody had
 * measured either wait. See the TAA-36 sign-off for what was actually
 * measured; move these into PollWindows once the numbers are agreed.
 *
 * Mandatory (TAA-41, confirmed live 2026-08-23): the backend does not guard
 * against re-fulfilling an already-FULFILLED shipment at all — a shipment
 * settled for two full days still returned 200 and silently issued a fresh
 * Auspost label. This flow reads the shipment row and refuses to call
 * /staging/fulfil on anything already FULFILLED; there is no backend
 * protection to fall back on.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FULFILMENT_SETTLE_INTERVAL_SECONDS = exports.FULFILMENT_SETTLE_WINDOW_SECONDS = exports.ITEM_SETTLE_INTERVAL_SECONDS = exports.ITEM_SETTLE_WINDOW_SECONDS = exports.FULFILLED_STATUS = void 0;
exports.parseOrderIdentifier = parseOrderIdentifier;
exports.resolveOrderIdTail = resolveOrderIdTail;
exports.totalOrderUnits = totalOrderUnits;
exports.itemCountsSettled = itemCountsSettled;
exports.isAlreadyFulfilled = isAlreadyFulfilled;
exports.isFulfilmentSettled = isFulfilmentSettled;
exports.fulfilOrder = fulfilOrder;
const shopifyReader_1 = require("../readers/shopifyReader");
const dynamoReader_1 = require("../readers/dynamoReader");
const fulfilment_1 = require("../clients/fulfilment");
const polling_1 = require("../polling");
exports.FULFILLED_STATUS = "FULFILLED";
/**
 * Local poll windows (TAA-36) — see the file header for why these aren't on
 * RegressionConfig.PollWindows yet. Fulfilment-settle numbers match the
 * measured TAA-41 range (6.5-9.0s against a 90s window); item-settle had
 * never been measured before this slice — see the sign-off for what a live
 * run actually showed before trusting this window unchanged.
 */
exports.ITEM_SETTLE_WINDOW_SECONDS = 60;
exports.ITEM_SETTLE_INTERVAL_SECONDS = 2;
exports.FULFILMENT_SETTLE_WINDOW_SECONDS = 90;
exports.FULFILMENT_SETTLE_INTERVAL_SECONDS = 2;
/**
 * Real order-name lengths observed in this shop are ~4 digits (e.g. "9928");
 * real order-id-GID numeric tails are ~13 digits (e.g. "7772060320017") — a
 * wide enough margin that a length threshold safely tells them apart without
 * a Shopify round trip for the common case (a numeric id already known from
 * a prior read).
 */
const ORDER_ID_TAIL_MIN_LENGTH = 8;
/** Classifies a user-supplied `--order` value. Pure — offline-testable. */
function parseOrderIdentifier(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("order identifier must not be empty");
    }
    if (trimmed.startsWith("gid://")) {
        return { kind: "tail", value: (0, shopifyReader_1.orderIdTail)(trimmed) };
    }
    const stripped = trimmed.replace(/^#/, "");
    if (!/^\d+$/.test(stripped)) {
        throw new Error(`order identifier must be a Shopify order name (e.g. "#9928") or numeric id, got "${raw}"`);
    }
    if (stripped.length >= ORDER_ID_TAIL_MIN_LENGTH) {
        return { kind: "tail", value: stripped };
    }
    return { kind: "name", value: `#${stripped}` };
}
/** Resolves a user-supplied `--order` value to the numeric id tail origin_index needs, hitting Shopify only when given a name. */
async function resolveOrderIdTail(shopify, raw) {
    const identifier = parseOrderIdentifier(raw);
    if (identifier.kind === "tail") {
        return identifier.value;
    }
    const tail = await shopify.findOrderIdTailByName(identifier.value);
    if (!tail) {
        throw new Error(`No Shopify order found with name "${identifier.value}"`);
    }
    return tail;
}
/** Total units on the order per staging-orders-v2 (one ITEM# row per unit). Pure. */
function totalOrderUnits(orderRows) {
    return Object.values((0, dynamoReader_1.orderSkuQuantitiesFromRows)(orderRows)).reduce((sum, qty) => sum + qty, 0);
}
/**
 * True once every unit on the order has BOTH a landed ITEM# row in
 * staging-shipments AND a resolved outcome (a shipmentId, or terminal
 * UNDELIVERABLE). Pure — this is the settle signal a poll loop checks on
 * each tick.
 *
 * Row count alone is NOT enough — confirmed live (TAA-36, 2026-08-23, order
 * #9937, 3x same SKU): all 3 ITEM# rows landed at 4.1s with every one of
 * them still carrying shipmentId=null. A predicate that stopped at row count
 * would have called groupItemsByShipment on a fully "settled" order and
 * gotten zero groups back — the whole order would have silently gone
 * through the loop with nothing fulfilled and no error, which is worse than
 * the short-payload risk this wait exists to prevent. Row creation and
 * shipment assignment are evidently two separate write steps, not one.
 */
function itemCountsSettled(shipmentItems, expectedTotalUnits) {
    if (expectedTotalUnits <= 0 || shipmentItems.length < expectedTotalUnits) {
        return false;
    }
    return shipmentItems.every((item) => item.shipmentId !== null || item.status === dynamoReader_1.UNDELIVERABLE);
}
/** True if the shipment row already shows FULFILLED — the mandatory pre-fulfil check (TAA-41). Pure. */
function isAlreadyFulfilled(summary) {
    return summary?.status === exports.FULFILLED_STATUS;
}
/** True once BOTH status===FULFILLED and trackingNumber are present — never treat either alone as sufficient (TAA-41). Pure. */
function isFulfilmentSettled(summary) {
    return summary?.status === exports.FULFILLED_STATUS && Boolean(summary.trackingNumber);
}
/**
 * Fulfils every shipment on one order. Item-count settle runs once for the
 * whole order (it's an order-level signal); the FULFILLED pre-check and the
 * fulfilment-settle wait run per shipment, and one shipment's failure
 * doesn't stop the others — every shipment gets its own reported outcome.
 */
async function fulfilOrder(deps, store, idTail) {
    const { reader, fulfilmentClient, verbose = false } = deps;
    const orderRows = await reader.getOrderRows(store, idTail);
    const orderPk = (0, dynamoReader_1.orderPkFromRows)(orderRows);
    if (!orderPk) {
        throw new Error(`Order ${idTail} has not landed in staging-orders-v2 yet`);
    }
    const totalUnits = totalOrderUnits(orderRows);
    if (totalUnits === 0) {
        throw new Error(`Order ${idTail} (PK ${orderPk}) has no ITEM# rows in staging-orders-v2`);
    }
    const { value: shipmentItems, elapsed: itemSettleElapsedSeconds } = await (0, polling_1.pollUntil)(() => reader.getShipmentItemsByPk(orderPk), (items) => itemCountsSettled(items, totalUnits), exports.ITEM_SETTLE_WINDOW_SECONDS, exports.ITEM_SETTLE_INTERVAL_SECONDS, "item_count_settle", verbose);
    const grouped = (0, dynamoReader_1.groupItemsByShipment)(shipmentItems);
    const shipments = [];
    for (const [shipmentId, items] of grouped) {
        shipments.push(await fulfilOneShipment(reader, fulfilmentClient, orderPk, shipmentId, items, verbose));
    }
    return { orderIdTail: idTail, orderPk, totalUnits, itemSettleElapsedSeconds, shipments };
}
async function fulfilOneShipment(reader, fulfilmentClient, orderPk, shipmentId, items, verbose) {
    const summaries = await reader.getShipmentsByPk(orderPk);
    const currentSummary = summaries.find((s) => s.shipmentId === shipmentId);
    if (isAlreadyFulfilled(currentSummary)) {
        return {
            shipmentId,
            itemCount: items.length,
            status: "SKIPPED_ALREADY_FULFILLED",
            trackingNumber: currentSummary?.trackingNumber ?? null,
            detail: "shipment already FULFILLED — refusing to re-fire (TAA-41: backend provides no guard against this)",
        };
    }
    try {
        const payloadItems = items.map((item) => ({
            shipmentItemId: item.shipmentItemId,
            shipmentId: item.shipmentId,
        }));
        const payload = (0, fulfilment_1.buildFulfilPayloadForShipment)(payloadItems, fulfilment_1.FULFILLER, (0, fulfilment_1.formatFulfilledAt)(new Date()));
        await fulfilmentClient.fulfil(payload);
        const { value: settled } = await (0, polling_1.pollUntil)(async () => {
            const rows = await reader.getShipmentsByPk(orderPk);
            return rows.find((s) => s.shipmentId === shipmentId);
        }, isFulfilmentSettled, exports.FULFILMENT_SETTLE_WINDOW_SECONDS, exports.FULFILMENT_SETTLE_INTERVAL_SECONDS, `fulfilment_settle:${shipmentId}`, verbose);
        return {
            shipmentId,
            itemCount: items.length,
            status: "FULFILLED",
            trackingNumber: settled?.trackingNumber ?? null,
        };
    }
    catch (error) {
        return {
            shipmentId,
            itemCount: items.length,
            status: "FAILED",
            trackingNumber: null,
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}
