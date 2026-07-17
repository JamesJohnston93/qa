"use strict";
/**
 * Case execution: seed -> order -> poll each pipeline stage -> assert. Ports
 * regression/runner.py.
 *
 * Every stage records its elapsed time (feeds PollWindows tuning); every
 * assertion failure carries expected-vs-actual from the systems involved.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCase = runCase;
exports.run = run;
const config_1 = require("./config");
const baselineCases_1 = require("./cases/baselineCases");
const orderFlow_1 = require("./flows/orderFlow");
const dynamo_1 = require("./clients/dynamo");
const shopify_1 = require("./clients/shopify");
const dynamoReader_1 = require("./readers/dynamoReader");
const shopifyReader = __importStar(require("./readers/shopifyReader"));
const polling_1 = require("./polling");
const index_1 = require("./verify/index");
const orders_1 = require("./verify/orders");
const shipments_1 = require("./verify/shipments");
const refunds_1 = require("./verify/refunds");
const inventory_1 = require("./verify/inventory");
/**
 * Polls until verifyFn(value) stops throwing VerificationError. On timeout,
 * re-throws the final VerificationError (full evidence) rather than a bare
 * timeout.
 */
async function pollVerify(fetch, verifyFn, timeout, interval, stage, verbose) {
    const predicate = (value) => {
        try {
            verifyFn(value);
            return true;
        }
        catch (error) {
            if (error instanceof index_1.VerificationError) {
                return false;
            }
            throw error;
        }
    };
    try {
        return await (0, polling_1.pollUntil)(fetch, predicate, timeout, interval, stage, verbose);
    }
    catch (error) {
        if (error instanceof polling_1.StageTimeout) {
            verifyFn(error.lastValue); // raises the detailed VerificationError
        }
        throw error; // unreachable unless state changed between last poll and here
    }
}
function round(value) {
    return Number(value.toFixed(1));
}
/** Executes one CaseDefinition. Returns a result (never throws). */
async function runCase(config, caseDef) {
    const result = {
        case: caseDef.name,
        store: config.store,
        description: caseDef.description,
        passed: false,
        orderId: "",
        orderName: "",
        stages: [],
        error: null,
    };
    const stageDone = (name, elapsed) => {
        result.stages.push({ name, elapsed: round(elapsed) });
        if (config.verbose) {
            console.log(`    [stage] ${name}: ok (${elapsed.toFixed(1)}s)`);
        }
    };
    const dynamo = new dynamo_1.DynamoClient(config);
    const dynamoReader = new dynamoReader_1.DynamoReader(dynamo, config);
    const shopify = new shopify_1.ShopifyClient(config.store);
    const poll = config.poll;
    try {
        // --- 1. Seed inventory deterministically -------------------------------
        let t0 = Date.now();
        const skus = Object.keys(caseDef.skuQuantities);
        const before = await (0, orderFlow_1.prepareInventory)(config, caseDef.skuQuantities, caseDef.seedPlan);
        stageDone("seed_inventory", (Date.now() - t0) / 1000);
        // --- 2. Create the Shopify order ---------------------------------------
        t0 = Date.now();
        const record = await (0, orderFlow_1.placeOrder)(config, caseDef.skuQuantities);
        result.orderId = record.orderId;
        result.orderName = record.orderName;
        stageDone("create_order", (Date.now() - t0) / 1000);
        const oidTail = shopifyReader.orderIdTail(record.orderId);
        const oname = record.orderName;
        // --- 3. Shopify read-back: exists, paid, items match --------------------
        const readback = await pollVerify(() => shopifyReader.getOrder(shopify, record.orderId), (snap) => (0, orders_1.assertShopifyOrder)(snap, caseDef.skuQuantities), 60, poll.interval, "shopify_readback", config.verbose);
        stageDone("shopify_readback", readback.elapsed);
        // --- 4. staging-orders-v2 row lands and matches -------------------------
        const ordersTable = await pollVerify(() => dynamoReader.getOrderSkuQuantities(config.store, oidTail), (q) => (0, orders_1.assertOrdersTableAlignment)(q, caseDef.skuQuantities, oname), poll.ordersTable, poll.interval, "orders_table", config.verbose);
        stageDone("orders_table", ordersTable.elapsed);
        // --- 5. Shipment ITEM# rows: unit counts, then terminal allocation ------
        const checkAllocation = (items) => {
            const summary = (0, dynamoReader_1.allocationSummary)(items);
            (0, shipments_1.assertUnitCounts)(summary, caseDef.skuQuantities, oname);
            (0, shipments_1.assertAllocation)(summary, caseDef.expectedAllocation, oname);
        };
        const allocation = await pollVerify(() => dynamoReader.getShipmentItems(config.store, oidTail), checkAllocation, poll.shipmentsTable + poll.allocation, poll.interval, "allocation", config.verbose);
        stageDone("allocation", allocation.elapsed);
        // --- 6. Refund path (undeliverable cases) or no-refund check ------------
        if (Object.keys(caseDef.expectedRefundSkus).length > 0) {
            const refund = await pollVerify(() => shopifyReader.getOrder(shopify, record.orderId), (snap) => (0, refunds_1.assertRefundForSkus)(snap, caseDef.expectedRefundSkus), poll.refund, poll.interval, "refund", config.verbose);
            stageDone("refund", refund.elapsed);
            const cleanup = await pollVerify(() => dynamoReader.getShipmentItems(config.store, oidTail), (items) => (0, shipments_1.assertItemsRemoved)(items, caseDef.cleanupSkus, oname), poll.cleanup, poll.interval, "cleanup", config.verbose);
            stageDone("cleanup", cleanup.elapsed);
        }
        else {
            const snap = await shopifyReader.getOrder(shopify, record.orderId);
            (0, refunds_1.assertNoRefund)(snap);
            stageDone("no_refund", 0);
        }
        // --- 7. Inventory decremented exactly as expected -----------------------
        const inventory = await pollVerify(() => dynamo.snapshotInventory(skus), (after) => (0, inventory_1.assertDecrements)(before, after, caseDef.expectedDecrements, oname), poll.inventory, poll.interval, "inventory", config.verbose);
        stageDone("inventory", inventory.elapsed);
        result.passed = true;
    }
    catch (error) {
        if (error instanceof index_1.VerificationError) {
            result.error = error.toDict();
        }
        else if (error instanceof polling_1.StageTimeout) {
            result.error = {
                check: `timeout.${error.stage}`,
                expected: `state within ${error.timeout.toFixed(0)}s`,
                actual: JSON.stringify(error.lastValue),
                detail: "",
            };
        }
        else {
            const err = error;
            result.error = {
                check: "unexpected_error",
                expected: "",
                actual: `${err.name ?? "Error"}: ${err.message}`,
                detail: err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : "",
            };
        }
    }
    return result;
}
/** Runs the selected cases (default: all) sequentially. */
async function run(config = (0, config_1.defaultConfig)()) {
    (0, config_1.validateConfig)(config);
    const allCases = (0, baselineCases_1.buildCases)(config.store);
    const names = config.caseNames?.length ? config.caseNames : Object.keys(allCases);
    const unknown = names.filter((name) => !(name in allCases));
    if (unknown.length > 0) {
        throw new Error(`unknown case(s): ${JSON.stringify(unknown)}. Available: ${JSON.stringify(Object.keys(allCases))}`);
    }
    const results = [];
    for (const name of names) {
        if (config.verbose) {
            console.log(`\n=== case: ${name} (${config.store}) ===`);
        }
        results.push(await runCase(config, allCases[name]));
    }
    return {
        store: config.store,
        cases: results,
        passed: results.every((r) => r.passed),
    };
}
