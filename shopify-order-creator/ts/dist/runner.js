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
const progress_1 = require("./progress");
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
async function pollVerify(fetch, verifyFn, timeout, interval, stage, verbose, onWaiting) {
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
        return await (0, polling_1.pollUntil)(fetch, predicate, timeout, interval, stage, verbose, onWaiting);
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
async function runCase(config, caseDef, progress) {
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
    // TAA-14 Phase A step 4: live progress line, updated per poll tick.
    const hasRefund = Object.keys(caseDef.expectedRefundSkus).length > 0;
    const caseStages = (0, progress_1.stageSequenceFor)(hasRefund);
    const printProgress = (stageName, secondsInStage) => {
        if (!config.verbose || !progress) {
            return;
        }
        const { tracker, repeatIndex, caseIndex, totalCases } = progress;
        const stageIndex = caseStages.indexOf(stageName);
        console.log(`    ${(0, progress_1.formatProgressLine)({
            repeatIndex,
            totalRepeats: tracker.totalRepeats,
            caseIndex,
            totalCases,
            caseName: caseDef.name,
            stageIndex: stageIndex < 0 ? 0 : stageIndex,
            totalCaseStages: caseStages.length,
            stageName,
            secondsInStage,
            completedStages: tracker.completedStages,
            totalStages: tracker.flatPlan.length,
            elapsedSeconds: (Date.now() - tracker.runStart) / 1000,
            etaSeconds: (0, progress_1.estimateRemainingSeconds)(tracker, secondsInStage),
        })}`);
    };
    const stageDone = (name, elapsed) => {
        result.stages.push({ name, elapsed: round(elapsed) });
        if (progress) {
            (0, progress_1.recordStageAverage)(progress.tracker.averages, name, elapsed);
            progress.tracker.completedStages += 1;
        }
        if (config.verbose) {
            console.log(`    [stage] ${name}: ok (${elapsed.toFixed(1)}s)`);
        }
    };
    const dynamo = new dynamo_1.DynamoClient(config);
    const dynamoReader = new dynamoReader_1.DynamoReader(dynamo, config);
    const shopify = new shopify_1.ShopifyClient(config.store);
    const poll = config.poll;
    // TAA-14 Phase A step 2: ramp 1s->2s->3s->cap poll.interval instead of a
    // fixed sleep every tick. Shopify-touching stages keep a 2s floor even on
    // the first poll to stay clear of rate limits.
    const dynamoInterval = { cap: poll.interval };
    const shopifyInterval = { cap: poll.interval, min: 2 };
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
        const readback = await pollVerify(() => shopifyReader.getOrder(shopify, record.orderId), (snap) => (0, orders_1.assertShopifyOrder)(snap, caseDef.skuQuantities), 60, shopifyInterval, "shopify_readback", config.verbose, (elapsed) => printProgress("shopify_readback", elapsed));
        stageDone("shopify_readback", readback.elapsed);
        // --- 4+5. orders-v2 row + shipment ITEM# rows: composite poll -----------
        // TAA-14 Phase A step 3: both checks key off the same staging-orders-v2
        // rows (allocation needs the order's PK, which lives there too), so one
        // tick fetches those rows once and advances whichever of orders_table /
        // allocation now passes — a stage that becomes true while the other is
        // still pending is caught immediately instead of waiting for a fresh,
        // separately-ramped poll cycle to start once the first stage finishes.
        const checkAllocation = (items) => {
            const summary = (0, dynamoReader_1.allocationSummary)(items);
            (0, shipments_1.assertUnitCounts)(summary, caseDef.skuQuantities, oname);
            (0, shipments_1.assertAllocation)(summary, caseDef.expectedAllocation, oname);
        };
        const ordersTimeout = poll.ordersTable;
        const allocationTimeout = poll.shipmentsTable + poll.allocation;
        const compositeStart = Date.now();
        let compositeAttempts = 0;
        let ordersDone = null;
        let allocationDone = null;
        let resolvedPk = null;
        let lastSkuQuantities = {};
        let lastItems = [];
        for (;;) {
            const rows = await dynamoReader.getOrderRows(config.store, oidTail);
            compositeAttempts += 1;
            const elapsed = (Date.now() - compositeStart) / 1000;
            if (!ordersDone) {
                lastSkuQuantities = (0, dynamoReader_1.orderSkuQuantitiesFromRows)(rows);
                try {
                    (0, orders_1.assertOrdersTableAlignment)(lastSkuQuantities, caseDef.skuQuantities, oname);
                    ordersDone = { elapsed };
                    if (config.verbose) {
                        console.log(`    [poll] orders_table: ok after ${elapsed.toFixed(1)}s (${compositeAttempts} checks)`);
                    }
                }
                catch (error) {
                    if (!(error instanceof index_1.VerificationError)) {
                        throw error;
                    }
                }
            }
            resolvedPk = resolvedPk ?? (0, dynamoReader_1.orderPkFromRows)(rows);
            if (!allocationDone && resolvedPk) {
                lastItems = await dynamoReader.getShipmentItemsByPk(resolvedPk);
                try {
                    checkAllocation(lastItems);
                    allocationDone = { elapsed };
                    if (config.verbose) {
                        console.log(`    [poll] allocation: ok after ${elapsed.toFixed(1)}s (${compositeAttempts} checks)`);
                    }
                }
                catch (error) {
                    if (!(error instanceof index_1.VerificationError)) {
                        throw error;
                    }
                }
            }
            if (ordersDone && allocationDone) {
                break;
            }
            if (!ordersDone && elapsed >= ordersTimeout) {
                (0, orders_1.assertOrdersTableAlignment)(lastSkuQuantities, caseDef.skuQuantities, oname); // raises the detailed error
            }
            if (!allocationDone && elapsed >= allocationTimeout) {
                checkAllocation(lastItems); // raises the detailed error
            }
            printProgress(ordersDone ? "allocation" : "orders_table", elapsed);
            await (0, polling_1.sleep)((0, polling_1.resolveInterval)(compositeAttempts, dynamoInterval) * 1000);
        }
        stageDone("orders_table", ordersDone.elapsed);
        stageDone("allocation", allocationDone.elapsed);
        // --- 6. Refund path (undeliverable cases) or no-refund check ------------
        if (Object.keys(caseDef.expectedRefundSkus).length > 0) {
            const refund = await pollVerify(() => shopifyReader.getOrder(shopify, record.orderId), (snap) => (0, refunds_1.assertRefundForSkus)(snap, caseDef.expectedRefundSkus), poll.refund, shopifyInterval, "refund", config.verbose, (elapsed) => printProgress("refund", elapsed));
            stageDone("refund", refund.elapsed);
            const cleanup = await pollVerify(() => dynamoReader.getShipmentItems(config.store, oidTail), (items) => (0, shipments_1.assertItemsRemoved)(items, caseDef.cleanupSkus, oname), poll.cleanup, dynamoInterval, "cleanup", config.verbose, (elapsed) => printProgress("cleanup", elapsed));
            stageDone("cleanup", cleanup.elapsed);
        }
        else {
            const snap = await shopifyReader.getOrder(shopify, record.orderId);
            (0, refunds_1.assertNoRefund)(snap);
            stageDone("no_refund", 0);
        }
        // --- 7. Inventory decremented exactly as expected -----------------------
        const inventory = await pollVerify(() => dynamo.snapshotInventory(skus), (after) => (0, inventory_1.assertDecrements)(before, after, caseDef.expectedDecrements, oname), poll.inventory, dynamoInterval, "inventory", config.verbose, (elapsed) => printProgress("inventory", elapsed));
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
/**
 * Runs the selected cases (default: all) sequentially.
 *
 * `tracker`/`repeatIndex`/`totalRepeats` carry the live-progress-line state
 * across repeats (TAA-14 Phase A step 4) — the CLI builds one tracker for
 * the whole `--repeat N` run and passes it into every call so "run %" and
 * the rolling per-stage-average ETA span the entire run, not just one
 * repeat. Omit them to run standalone (e.g. a single one-off run) — a
 * tracker scoped to just this call's cases is built automatically.
 */
async function run(config = (0, config_1.defaultConfig)(), tracker, repeatIndex = 0, totalRepeats = 1) {
    (0, config_1.validateConfig)(config);
    const allCases = (0, baselineCases_1.buildCases)(config.store);
    const names = config.caseNames?.length ? config.caseNames : Object.keys(allCases);
    const unknown = names.filter((name) => !(name in allCases));
    if (unknown.length > 0) {
        throw new Error(`unknown case(s): ${JSON.stringify(unknown)}. Available: ${JSON.stringify(Object.keys(allCases))}`);
    }
    const resolvedTracker = tracker ??
        (0, progress_1.createProgressTracker)((0, progress_1.buildRunPlan)(names, (name) => Object.keys(allCases[name].expectedRefundSkus).length > 0, totalRepeats), totalRepeats, names.length, Date.now());
    const results = [];
    for (let caseIndex = 0; caseIndex < names.length; caseIndex += 1) {
        const name = names[caseIndex];
        if (config.verbose) {
            console.log(`\n=== case: ${name} (${config.store}) ===`);
        }
        results.push(await runCase(config, allCases[name], {
            tracker: resolvedTracker,
            repeatIndex,
            caseIndex,
            totalCases: names.length,
        }));
    }
    return {
        store: config.store,
        cases: results,
        passed: results.every((r) => r.passed),
    };
}
