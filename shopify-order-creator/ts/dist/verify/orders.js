"use strict";
/** Shopify order <-> staging-orders-v2 alignment checks. Ports regression/verify/orders.py. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertShopifyOrder = assertShopifyOrder;
exports.assertOrdersTableAlignment = assertOrdersTableAlignment;
const shopifyReader_1 = require("../readers/shopifyReader");
const index_1 = require("./index");
function mapsEqual(a, b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    return aKeys.every((key) => a[key] === b[key]);
}
/**
 * The Shopify order exists, is paid, and its line items exactly match the
 * requested {sku: quantity} map (duplicate-line-item safe).
 */
function assertShopifyOrder(snapshot, expectedSkus) {
    if (snapshot.financialStatus !== "PAID") {
        throw new index_1.VerificationError("shopify.financial_status", "PAID", snapshot.financialStatus, `order ${snapshot.name}`);
    }
    const actual = (0, shopifyReader_1.skuQuantities)(snapshot);
    if (!mapsEqual(actual, expectedSkus)) {
        throw new index_1.VerificationError("shopify.line_items", expectedSkus, actual, `order ${snapshot.name}`);
    }
}
/** staging-orders-v2 item content matches the order exactly. */
function assertOrdersTableAlignment(awsSkuQuantities, expectedSkus, orderName) {
    if (!mapsEqual(awsSkuQuantities, expectedSkus)) {
        throw new index_1.VerificationError("orders_table.items", expectedSkus, awsSkuQuantities, `order ${orderName}`);
    }
}
