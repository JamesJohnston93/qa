"use strict";
/** NewStore injected-order read-back checks (NS cases 7-8, TAA-17 step 3). No Python spec — see readers/newstoreReader.ts. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertNewStoreOrder = assertNewStoreOrder;
const newstoreReader_1 = require("../readers/newstoreReader");
const index_1 = require("./index");
function mapsEqual(a, b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}
/**
 * The injected order has propagated to the read-back endpoint and its
 * ordered_products exactly match the requested {sku: quantity} map.
 *
 * snapshot is null while NewStore hasn't indexed the order yet (expected
 * during the ~2s propagation window) — treated as "not found yet", not a
 * hard failure, so pollVerify keeps polling.
 */
function assertNewStoreOrder(snapshot, expectedSkus, externalId) {
    if (!snapshot) {
        throw new index_1.VerificationError("newstore.exists", "order present", "not found yet", `external_id ${externalId}`);
    }
    const actual = (0, newstoreReader_1.skuQuantities)(snapshot);
    if (!mapsEqual(actual, expectedSkus)) {
        throw new index_1.VerificationError("newstore.ordered_products", expectedSkus, actual, `external_id ${externalId}, order_uuid ${snapshot.orderUuid}`);
    }
}
