"use strict";
/**
 * Fulfilment-state checks (TAA-37, slice D of the TAA-21 fulfilment
 * workstream). Slices A-C make a fulfil call happen; these assert the result
 * actually landed — in the shipments table (both the per-unit ITEM# rows and
 * the SHIPMENT# row's tracking number) and in the orders table. Order-
 * finalised is NOT asserted here — that's TAA-33.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FULFILLED = void 0;
exports.assertShipmentItemsFulfilled = assertShipmentItemsFulfilled;
exports.assertShipmentTrackingNumber = assertShipmentTrackingNumber;
exports.assertOrderItemsFulfilled = assertOrderItemsFulfilled;
const index_1 = require("./index");
/** Terminal status an ITEM#/SHIPMENT# row carries once a fulfil call has settled. */
exports.FULFILLED = "FULFILLED";
/**
 * Every ITEM# row belonging to the given shipment has settled to FULFILLED
 * in staging-shipments. `items` is the full per-order item list from
 * getShipmentItemsByPk — filtered here to the shipment under test, since one
 * order can carry items from other shipments not yet fulfilled.
 *
 * No items found for this shipmentId throws (not a special case) so
 * pollVerify keeps polling rather than passing vacuously on an empty set —
 * matches the existing null/not-yet-present convention (verify/newstore.ts).
 */
function assertShipmentItemsFulfilled(items, shipmentId, orderName) {
    const onShipment = items.filter((item) => item.shipmentId === shipmentId);
    if (onShipment.length === 0) {
        throw new index_1.VerificationError("shipments.items_fulfilled", "item(s) present", "not found yet", `order ${orderName}; shipment ${shipmentId}`);
    }
    const notFulfilled = {};
    for (const item of onShipment) {
        if (item.status !== exports.FULFILLED) {
            notFulfilled[item.shipmentItemId] = item.status;
        }
    }
    if (Object.keys(notFulfilled).length > 0) {
        throw new index_1.VerificationError("shipments.items_fulfilled", exports.FULFILLED, notFulfilled, `order ${orderName}; shipment ${shipmentId}`);
    }
}
/**
 * The SHIPMENT# row itself has settled: status === FULFILLED AND
 * trackingNumber is present, checked together. Measured live (TAA-41):
 * trackingNumber lands first (~2.4-3.0s) while status still reads OPEN —
 * either field alone is an unsettled, misleading read, so both are gated by
 * one check rather than two that could each individually "pass" early.
 *
 * A null summary (row not found yet) throws for the same reason as above —
 * pollVerify keeps polling instead of treating it as a hard failure.
 */
function assertShipmentTrackingNumber(summary, shipmentId, orderName) {
    if (!summary) {
        throw new index_1.VerificationError("shipments.tracking_number", "SHIPMENT# row present", "not found yet", `order ${orderName}; shipment ${shipmentId}`);
    }
    if (summary.status !== exports.FULFILLED || !summary.trackingNumber) {
        throw new index_1.VerificationError("shipments.tracking_number", { status: exports.FULFILLED, trackingNumber: "<non-empty>" }, { status: summary.status, trackingNumber: summary.trackingNumber }, `order ${orderName}; shipment ${shipmentId}`);
    }
}
/**
 * The fulfilled state has propagated to staging-orders-v2: every ITEM# row
 * there whose sku matches one on the fulfilled shipment also reads
 * FULFILLED. `orderRows` is the raw row set from DynamoReader.getOrderRows;
 * `shipmentItems` is the same shipment-filtered list used above, supplying
 * the SKUs to correlate against (staging-orders-v2 ITEM# rows carry no
 * shipment/shipment-item id of their own to join on directly).
 *
 * No matching rows (order not landed, or the skus haven't reached this table
 * yet) throws so pollVerify keeps polling.
 */
function assertOrderItemsFulfilled(orderRows, shipmentItems, orderName) {
    const skus = new Set(shipmentItems.map((item) => item.sku));
    const relevant = orderRows.filter((row) => String(row.SK ?? "").startsWith("ITEM#") && skus.has(String(row.sku ?? "")));
    if (relevant.length === 0) {
        throw new index_1.VerificationError("orders_table.fulfilled", "item row(s) present", "not found yet", `order ${orderName}`);
    }
    const notFulfilled = {};
    for (const row of relevant) {
        const status = String(row.status ?? "");
        if (status !== exports.FULFILLED) {
            notFulfilled[String(row.SK ?? "")] = status;
        }
    }
    if (Object.keys(notFulfilled).length > 0) {
        throw new index_1.VerificationError("orders_table.fulfilled", exports.FULFILLED, notFulfilled, `order ${orderName}`);
    }
}
