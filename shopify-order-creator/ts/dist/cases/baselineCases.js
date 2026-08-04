"use strict";
/**
 * Baseline case set v1 — "these always need to work and behave exactly the
 * same way." Ports regression/cases.py. Declarative: each case states its
 * inputs (SKUs, seed plan) and its expected state in every system. The
 * runner turns these into orders and assertions.
 *
 * SKU isolation (TAA-14 Phase B, 2026-07-31): US now has a 14-SKU pool
 * (variants.ts), and the 6 cases below use 10 fully disjoint pool slots
 * (single=0, multi=1, unique=2-4, split=5-6, undeliverable=7,
 * partial_undeliverable=8-9, slots 10-13 unused headroom) — no two cases
 * touch the same SKU, which is what makes the TAA-14 Phase B `--parallel`
 * scheduler safe to run cases concurrently. PS is still on the old 4-SKU
 * pool (blocked on a token scope fix) and reuses indices as before.
 *
 * NewStore SFS/OTC cases (7-8 in the design) are not wired into the runner:
 * order injection exists, but the NewStore read-back endpoint needs
 * confirming first. Tracked in TAA-3.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNDELIVERABLE = void 0;
exports.buildCases = buildCases;
const config_1 = require("../config");
const variants_1 = require("../variants");
exports.UNDELIVERABLE = "UNDELIVERABLE";
function storeNumber(location) {
    // 'ATP#100' -> '100'. Expected-allocation values use plain store numbers.
    const parts = location.split("#");
    return parts[1];
}
/** Builds the case set for the given store from its real variant pool (mirrors cases.build_cases). */
function buildCases(store) {
    const pool = (0, variants_1.skuPoolFor)(store);
    if (pool.length < 4) {
        throw new Error(`variant pool for ${store} too small: ${JSON.stringify(pool)}`);
    }
    const sku = (i) => pool[i % pool.length];
    const primary = config_1.WEB_DC;
    const secondary = config_1.STORE_99;
    const pNum = storeNumber(primary);
    const sNum = storeNumber(secondary);
    const TOP_UP = 99;
    const cases = [
        {
            kind: "pipeline",
            name: "single",
            description: "Single item, stock at one location -> one shipment there",
            skuQuantities: { [sku(0)]: 1 },
            seedPlan: { [sku(0)]: { [primary]: TOP_UP } },
            expectedAllocation: { [sku(0)]: pNum },
            expectedDecrements: { [sku(0)]: { [primary]: 1 } },
            expectedRefundSkus: {},
            cleanupSkus: [],
        },
        {
            kind: "pipeline",
            name: "multi",
            description: "3x same SKU -> one shipment, three ITEM# rows (Shopify merges duplicate line items; Dynamo does not)",
            skuQuantities: { [sku(1)]: 3 },
            seedPlan: { [sku(1)]: { [primary]: TOP_UP } },
            expectedAllocation: { [sku(1)]: pNum },
            expectedDecrements: { [sku(1)]: { [primary]: 3 } },
            expectedRefundSkus: {},
            cleanupSkus: [],
        },
        {
            kind: "pipeline",
            name: "unique",
            description: "3 different SKUs all stocked at one location -> one combined shipment",
            skuQuantities: { [sku(2)]: 1, [sku(3)]: 1, [sku(4)]: 1 },
            seedPlan: {
                [sku(2)]: { [primary]: TOP_UP },
                [sku(3)]: { [primary]: TOP_UP },
                [sku(4)]: { [primary]: TOP_UP },
            },
            expectedAllocation: { [sku(2)]: pNum, [sku(3)]: pNum, [sku(4)]: pNum },
            expectedDecrements: {
                [sku(2)]: { [primary]: 1 },
                [sku(3)]: { [primary]: 1 },
                [sku(4)]: { [primary]: 1 },
            },
            expectedRefundSkus: {},
            cleanupSkus: [],
        },
        {
            kind: "pipeline",
            name: "split",
            description: "Each SKU stocked at a different store only -> one shipment per store",
            skuQuantities: { [sku(5)]: 1, [sku(6)]: 1 },
            seedPlan: {
                [sku(5)]: { [primary]: TOP_UP },
                [sku(6)]: { [secondary]: TOP_UP },
            },
            expectedAllocation: { [sku(5)]: pNum, [sku(6)]: sNum },
            expectedDecrements: {
                [sku(5)]: { [primary]: 1 },
                [sku(6)]: { [secondary]: 1 },
            },
            expectedRefundSkus: {},
            cleanupSkus: [],
        },
        {
            kind: "pipeline",
            name: "undeliverable",
            description: "Zero stock everywhere -> UNDELIVERABLE, Shopify refund, rows removed from both AWS tables",
            skuQuantities: { [sku(7)]: 1 },
            seedPlan: {}, // zeroing everywhere IS the seed
            expectedAllocation: { [sku(7)]: exports.UNDELIVERABLE },
            expectedDecrements: { [sku(7)]: {} }, // nothing to decrement
            expectedRefundSkus: { [sku(7)]: 1 },
            cleanupSkus: [sku(7)],
        },
        {
            kind: "pipeline",
            name: "partial_undeliverable",
            description: "One SKU stocked, one zero everywhere -> mixed: allocated shipment + refunded undeliverable",
            skuQuantities: { [sku(8)]: 1, [sku(9)]: 1 },
            seedPlan: { [sku(8)]: { [primary]: TOP_UP } }, // sku(9) stays zeroed everywhere
            expectedAllocation: { [sku(8)]: pNum, [sku(9)]: exports.UNDELIVERABLE },
            expectedDecrements: { [sku(8)]: { [primary]: 1 } },
            expectedRefundSkus: { [sku(9)]: 1 },
            cleanupSkus: [sku(9)],
        },
    ];
    return Object.fromEntries(cases.map((c) => [c.name, c]));
}
