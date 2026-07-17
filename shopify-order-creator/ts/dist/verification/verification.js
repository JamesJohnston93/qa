"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationError = void 0;
exports.assertShopifyOrder = assertShopifyOrder;
exports.assertOrdersTableAlignment = assertOrdersTableAlignment;
exports.assertUnitCounts = assertUnitCounts;
exports.assertAllocation = assertAllocation;
exports.assertInventoryDecrements = assertInventoryDecrements;
class VerificationError extends Error {
    failure;
    constructor(failure) {
        super(`${failure.check}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`);
        this.failure = failure;
    }
}
exports.VerificationError = VerificationError;
function assertShopifyOrder(snapshot, expected) {
    if (snapshot.financialStatus !== "PAID") {
        throw new VerificationError({
            check: "shopify.financial_status",
            expected: "PAID",
            actual: snapshot.financialStatus,
            detail: "The Shopify order must be paid",
        });
    }
    const actual = snapshot.lineItems.reduce((acc, item) => {
        acc[item.sku] = (acc[item.sku] ?? 0) + item.quantity;
        return acc;
    }, {});
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new VerificationError({
            check: "shopify.line_items",
            expected,
            actual,
            detail: "Line items do not match the expected order quantities",
        });
    }
}
function assertOrdersTableAlignment(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new VerificationError({
            check: "orders_table.items",
            expected,
            actual,
            detail: "staging-orders-v2 items do not match the expected quantities",
        });
    }
}
function assertUnitCounts(summary, expected) {
    if (JSON.stringify(summary.skuUnits) !== JSON.stringify(expected)) {
        throw new VerificationError({
            check: "shipments.unit_counts",
            expected,
            actual: summary.skuUnits,
            detail: "One ITEM row per unit is required",
        });
    }
}
function assertAllocation(summary, expected) {
    if (summary.unallocated > 0) {
        throw new VerificationError({
            check: "shipments.allocated",
            expected: "all items allocated or undeliverable",
            actual: `${summary.unallocated} item(s) with no store value`,
        });
    }
    for (const [sku, store] of Object.entries(expected)) {
        const stores = Object.entries(summary.byStore).filter(([, skus]) => skus.includes(sku)).map(([storeKey]) => storeKey);
        if (stores.length !== 1 || stores[0] !== store) {
            throw new VerificationError({
                check: "shipments.allocation",
                expected: { [sku]: store },
                actual: { [sku]: stores },
            });
        }
    }
}
function assertInventoryDecrements(before, after, expectedDecrements, orderName) {
    for (const [sku, beforeLocations] of Object.entries(before)) {
        const expected = expectedDecrements[sku] ?? {};
        const locations = new Set([...Object.keys(beforeLocations), ...Object.keys(after[sku] ?? {})]);
        for (const location of Array.from(locations).sort()) {
            const beforeQty = beforeLocations[location] ?? 0;
            const afterQty = after[sku]?.[location] ?? 0;
            const expectedAfter = beforeQty - (expected[location] ?? 0);
            if (afterQty !== expectedAfter) {
                throw new VerificationError({
                    check: "inventory.decrement",
                    expected: { [`${sku}@${location}`]: expectedAfter },
                    actual: { [`${sku}@${location}`]: afterQty },
                    detail: `order ${orderName}: before=${beforeQty}, expected decrement=${expected[location] ?? 0}`,
                });
            }
        }
    }
}
