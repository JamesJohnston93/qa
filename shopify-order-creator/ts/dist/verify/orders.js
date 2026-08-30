"use strict";
/** Shopify order <-> staging-orders-v2 alignment checks. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertShopifyOrder = assertShopifyOrder;
exports.assertOrdersTableAlignment = assertOrdersTableAlignment;
exports.assertPaymentsSumToGrandTotal = assertPaymentsSumToGrandTotal;
exports.assertBothAddressesPresent = assertBothAddressesPresent;
exports.assertItemDelivery = assertItemDelivery;
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
/**
 * paymentMethod (singular, an array of {method, amount} — there is no
 * paymentMethods) sums to grandTotal exactly (TAA-52). grandTotal is already
 * net of any discount (see OrderItemRow's discountInfo doc comment) so this
 * needs no separate discount handling.
 *
 * This is ONLY true for a fully-paid order. It legitimately throws on an
 * order held for OUTSTANDING_PAYMENT (verify/holds.ts) — confirmed live,
 * order #9998 (`ts/fixtures/orders-v2/US-hold-outstanding-edit-9998.json`)
 * carries grandTotal 119 against paymentMethod summing to only 70, which is
 * the same underlying fact that put it on hold in the first place (an edit
 * added an unpaid item). A caller that wants to assert "fully paid" should
 * pair this with assertNotOnHold/assertHoldReasonAbsent(OUTSTANDING_PAYMENT)
 * first; a caller investigating an OUTSTANDING_PAYMENT hold can equally read
 * this throw's expected-vs-actual as the size of the shortfall.
 */
function assertPaymentsSumToGrandTotal(record, orderName) {
    const sum = record.paymentMethod.reduce((total, entry) => total + entry.amount, 0);
    if (sum !== record.grandTotal) {
        throw new index_1.VerificationError("orders_table.payments_sum", record.grandTotal, sum, `order ${orderName}: paymentMethod=${JSON.stringify(record.paymentMethod)}`);
    }
}
/** Both ADDRESS#SHIPPING and ADDRESS#BILLING rows are present for the order (TAA-52). */
function assertBothAddressesPresent(addresses, orderName) {
    const types = new Set(addresses.map((address) => address.type));
    if (!types.has("SHIPPING") || !types.has("BILLING")) {
        throw new index_1.VerificationError("orders_table.addresses_present", ["SHIPPING", "BILLING"], Array.from(types).sort(), `order ${orderName}`);
    }
}
/**
 * An ITEM# row's deliveryMethod and clickCollectStore match exactly (TAA-52).
 * clickCollectStore is expected null for STANDARD delivery, and the store
 * number string (e.g. "251") for CLICKCOLLECT — confirmed live present only
 * on the CLICKCOLLECT row, absent (null) on STANDARD rows (order #9997,
 * ts/fixtures/orders-v2/US-clickcollect-9997.json). The item's own sku is
 * the caller's correlation key; it is not asserted here (assertOrdersTable
 * Alignment already owns sku/quantity content).
 */
function assertItemDelivery(item, expectedDeliveryMethod, expectedClickCollectStore, orderName) {
    if (item.deliveryMethod !== expectedDeliveryMethod) {
        throw new index_1.VerificationError("orders_table.item_delivery_method", expectedDeliveryMethod, item.deliveryMethod, `order ${orderName}, sku ${item.sku}`);
    }
    if (item.clickCollectStore !== expectedClickCollectStore) {
        throw new index_1.VerificationError("orders_table.item_click_collect_store", expectedClickCollectStore, item.clickCollectStore, `order ${orderName}, sku ${item.sku}`);
    }
}
