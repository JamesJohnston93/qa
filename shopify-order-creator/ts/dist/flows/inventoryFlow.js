"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareInventoryForCase = prepareInventoryForCase;
exports.snapshotInventoryForCase = snapshotInventoryForCase;
/**
 * Deterministic inventory seeding for one case: zero every existing location
 * for each ordered SKU, then apply the case's explicit seed plan. Mirrors
 * regression/runner.py's stage 1 (seed_inventory / zero_everywhere) — never
 * rely on ambient staging stock.
 */
async function prepareInventoryForCase(dynamo, skus, seedPlan) {
    for (const sku of skus) {
        await dynamo.zeroEverywhere(sku);
    }
    await dynamo.seedInventory(seedPlan);
    return dynamo.snapshotInventory(skus);
}
async function snapshotInventoryForCase(dynamo, skus) {
    return dynamo.snapshotInventory(skus);
}
