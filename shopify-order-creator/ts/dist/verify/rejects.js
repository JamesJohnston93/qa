"use strict";
/**
 * Reject-outcome assertions (TAA-31 slice F/G). Pure — offline-testable,
 * same pattern as verify/shipments.ts's assertAllocation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAllUndeliverable = assertAllUndeliverable;
exports.assertReallocatedOrUndeliverable = assertReallocatedOrUndeliverable;
const dynamoReader_1 = require("../readers/dynamoReader");
const index_1 = require("./index");
/** reject_undeliverable: every item must have resolved UNDELIVERABLE. */
function assertAllUndeliverable(items, orderName) {
    const bad = items.filter((item) => item.status !== dynamoReader_1.UNDELIVERABLE);
    if (bad.length > 0) {
        throw new index_1.VerificationError("reject.outcome", dynamoReader_1.UNDELIVERABLE, bad, `order ${orderName}: ${bad.length} of ${items.length} item(s) did not resolve ${dynamoReader_1.UNDELIVERABLE}`);
    }
}
/**
 * reject_reallocate: every item must have landed on a genuinely new
 * shipment (not the rejected one), or gone UNDELIVERABLE — matches slice A's
 * proposal item 3, which tolerates either terminal outcome.
 */
function assertReallocatedOrUndeliverable(items, originalShipmentId, orderName) {
    const bad = items.filter((item) => item.status !== dynamoReader_1.UNDELIVERABLE && (item.newShipmentId === null || item.newShipmentId === originalShipmentId));
    if (bad.length > 0) {
        throw new index_1.VerificationError("reject.outcome", "new shipmentId or UNDELIVERABLE", bad, `order ${orderName}: ${bad.length} of ${items.length} item(s) neither reallocated nor went ${dynamoReader_1.UNDELIVERABLE}`);
    }
}
