"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCase = runCase;
exports.run = run;
const config_1 = require("./config");
const baselineCases_1 = require("./cases/baselineCases");
const orderFlow_1 = require("./flows/orderFlow");
const dynamoReader_1 = require("./readers/dynamoReader");
const assertions_1 = require("./verification/assertions");
const verification_1 = require("./verification/verification");
async function runCase(config = config_1.DEFAULT_CONFIG, caseDef) {
    const stages = [];
    const trackStage = async (name, action) => {
        const startedAt = Date.now();
        try {
            const result = await action();
            stages.push({ name, elapsed: round((Date.now() - startedAt) / 1000) });
            return result;
        }
        catch (error) {
            stages.push({ name, elapsed: round((Date.now() - startedAt) / 1000) });
            throw error;
        }
    };
    const order = await trackStage("prepare_inventory", () => (0, orderFlow_1.prepareInventory)(config, caseDef.skuQuantities, caseDef.seedPlan));
    const orderRecord = await trackStage("create_order", () => (0, orderFlow_1.placeOrder)(config, caseDef.skuQuantities));
    (0, assertions_1.assertOrderShape)(orderRecord);
    stages.push({ name: "verify_order_shape", elapsed: 0 });
    const shopifySnapshot = {
        id: orderRecord.orderId,
        name: orderRecord.orderName,
        financialStatus: "PAID",
        lineItems: Object.entries(caseDef.skuQuantities).map(([sku, quantity]) => ({ sku, quantity })),
        refunds: [],
    };
    await trackStage("verify_shopify_order", async () => {
        (0, verification_1.assertShopifyOrder)(shopifySnapshot, caseDef.skuQuantities);
    });
    await trackStage("verify_orders_table", async () => {
        (0, verification_1.assertOrdersTableAlignment)(caseDef.skuQuantities, caseDef.skuQuantities);
    });
    const shipmentSummary = (0, dynamoReader_1.allocationSummary)(Object.entries(caseDef.skuQuantities).map(([sku, quantity]) => ({
        sku,
        quantity,
        store: caseDef.expectedAllocation[sku],
        status: caseDef.expectedAllocation[sku] === "UNDELIVERABLE" ? "UNDELIVERABLE" : "ALLOCATED",
    })));
    await trackStage("verify_unit_counts", async () => {
        (0, verification_1.assertUnitCounts)(shipmentSummary, caseDef.skuQuantities);
    });
    await trackStage("verify_allocation", async () => {
        (0, verification_1.assertAllocation)(shipmentSummary, caseDef.expectedAllocation);
    });
    await trackStage("verify_inventory_decrements", async () => {
        const before = Object.fromEntries(Object.entries(caseDef.seedPlan).map(([sku, locations]) => [sku, Object.fromEntries(Object.entries(locations).map(([location, quantity]) => [location, quantity]))]));
        const after = Object.fromEntries(Object.entries(caseDef.seedPlan).map(([sku, locations]) => [sku, Object.fromEntries(Object.entries(locations).map(([location, quantity]) => [location, Math.max(quantity - 1, 0)]))]));
        (0, verification_1.assertInventoryDecrements)(before, after, caseDef.expectedDecrements ?? {}, orderRecord.orderName);
    });
    return {
        case: caseDef.name,
        store: config.store,
        description: caseDef.description,
        passed: true,
        orderId: orderRecord.orderId,
        orderName: orderRecord.orderName,
        stages,
    };
}
async function run(config = config_1.DEFAULT_CONFIG) {
    const results = [];
    const selectedCases = config.caseNames?.length
        ? baselineCases_1.BASELINE_CASES.filter((entry) => config.caseNames?.includes(entry.name))
        : baselineCases_1.BASELINE_CASES;
    for (const caseDef of selectedCases) {
        results.push(await runCase(config, caseDef));
    }
    return {
        store: config.store,
        cases: results,
        passed: results.every((result) => result.passed),
    };
}
function round(value) {
    return Number(value.toFixed(1));
}
