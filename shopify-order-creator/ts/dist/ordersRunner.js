"use strict";
/**
 * Runner for the `orders` subcommand (TAA-54) — hold lifecycle cases
 * TC7-12. Deliberately separate from runner.ts (owned by TAA-59 this wave,
 * not to be edited) and from its progress tracker: six cases run
 * sequentially, one order each, holds never touch staging-inventory-v2 so
 * there's no wave-scheduling problem to solve. Same "no tracker, plain
 * per-stage console timing" choice runner.ts's own runNewStoreCase already
 * makes for NS cases, for the same reason (short, linear, nothing to
 * schedule concurrently).
 *
 * Each case: place one order (flows/orderFlow.ts's placeOrder, reused as-is)
 * -> drive the hold(s) via flows/holdFlow.ts (each call already polls until
 * its own two-part settle predicate holds) -> ONE fresh
 * DynamoReader.getOrderRows fetch -> assert via verify/holds.ts +
 * verify/transactions.ts. No extra polling wrapper around the final assert:
 * holdFlow.ts's predicates (onHold contains reason AND a matching
 * HOLD_ORDER/UNHOLD_ORDER row) are a strict subset of what's asserted here
 * (exact reason set / exact row count) and nothing else touches these
 * QA-only orders concurrently, so re-fetching immediately after a settled
 * poll is not a race in practice — a mismatch here is a real anomaly worth
 * surfacing immediately, not silently retrying away.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOrdersCase = runOrdersCase;
exports.runOrdersSuite = runOrdersSuite;
const config_1 = require("./config");
const dynamo_1 = require("./clients/dynamo");
const dynamoReader_1 = require("./readers/dynamoReader");
const shopify_1 = require("./clients/shopify");
const shopifyReader_1 = require("./readers/shopifyReader");
const shopifyAdmin_1 = require("./clients/shopifyAdmin");
const variants_1 = require("./variants");
const holdFlow_1 = require("./flows/holdFlow");
const orderFlow_1 = require("./flows/orderFlow");
const holds_1 = require("./verify/holds");
const transactions_1 = require("./verify/transactions");
const ordersCases_1 = require("./cases/ordersCases");
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/** `itemChanges.added[].sku` off one TRANSACTION# row — deliberately duplicated from flows/editFlow.ts's private helper of the same shape/reasoning (see that file's doc comment on why flows and callers each keep their own copy). */
function addedSkusFrom(transaction) {
    const itemChanges = transaction.raw.itemChanges;
    if (!itemChanges || !Array.isArray(itemChanges.added)) {
        return [];
    }
    return itemChanges.added.map((entry) => String(entry.sku ?? ""));
}
async function runOrdersCase(config, caseDef) {
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
        result.stages.push({ name, elapsed: Number(elapsed.toFixed(1)) });
        if (config.verbose) {
            console.log(`    [stage] ${name}: ok (${elapsed.toFixed(1)}s)`);
        }
    };
    try {
        const placed = await (0, orderFlow_1.placeOrder)(config, { [caseDef.baseSku]: 1 });
        result.orderId = placed.orderId;
        result.orderName = placed.orderName;
        const idTail = (0, shopifyReader_1.orderIdTail)(placed.orderId);
        const shopify = new shopify_1.ShopifyClient(config.store);
        const admin = new shopifyAdmin_1.ShopifyAdminClient(shopify);
        const reader = new dynamoReader_1.DynamoReader(new dynamo_1.DynamoClient(config), config);
        const fulfillmentOrders = (0, holdFlow_1.shopifyFulfillmentOrderResolver)(shopify);
        const deps = { admin, reader, fulfillmentOrders, verbose: config.verbose };
        const addItemVariantId = caseDef.addItemSku ? (0, variants_1.variantsFor)(config.store)[caseDef.addItemSku] : null;
        switch (caseDef.variant) {
            case "fraud": {
                const applied = await (0, holdFlow_1.applyFraudHold)(deps, config.store, placed.orderId, idTail);
                stageDone("apply_fraud_hold", applied.settledElapsedSeconds);
                const rows = await reader.getOrderRows(config.store, idTail);
                const record = (0, dynamoReader_1.orderRecordFromRows)(rows);
                (0, holds_1.assertOnHold)(record, [holds_1.POTENTIAL_FRAUD], placed.orderName);
                (0, holds_1.assertHoldTransactionCount)((0, dynamoReader_1.transactionRowsFromRows)(rows), holds_1.POTENTIAL_FRAUD, 1, placed.orderName);
                break;
            }
            case "outstanding": {
                const applied = await (0, holdFlow_1.applyOutstandingPaymentHold)(deps, config.store, placed.orderId, idTail, addItemVariantId, caseDef.addItemSku);
                stageDone("apply_outstanding_hold", applied.settledElapsedSeconds);
                const rows = await reader.getOrderRows(config.store, idTail);
                const record = (0, dynamoReader_1.orderRecordFromRows)(rows);
                const transactions = (0, dynamoReader_1.transactionRowsFromRows)(rows);
                (0, holds_1.assertOnHold)(record, [holds_1.OUTSTANDING_PAYMENT], placed.orderName);
                (0, holds_1.assertHoldTransactionCount)(transactions, holds_1.OUTSTANDING_PAYMENT, 1, placed.orderName);
                (0, transactions_1.assertTransactionPresent)(transactions, "ADD_ITEM", placed.orderName, (t) => addedSkusFrom(t).includes(caseDef.addItemSku));
                break;
            }
            case "multi": {
                const fraud = await (0, holdFlow_1.applyFraudHold)(deps, config.store, placed.orderId, idTail);
                stageDone("apply_fraud_hold", fraud.settledElapsedSeconds);
                const outstanding = await (0, holdFlow_1.applyOutstandingPaymentHold)(deps, config.store, placed.orderId, idTail, addItemVariantId, caseDef.addItemSku);
                stageDone("apply_outstanding_hold", outstanding.settledElapsedSeconds);
                const rows = await reader.getOrderRows(config.store, idTail);
                const record = (0, dynamoReader_1.orderRecordFromRows)(rows);
                const transactions = (0, dynamoReader_1.transactionRowsFromRows)(rows);
                (0, holds_1.assertOnHold)(record, [holds_1.POTENTIAL_FRAUD, holds_1.OUTSTANDING_PAYMENT], placed.orderName);
                (0, holds_1.assertHoldTransactionCount)(transactions, holds_1.POTENTIAL_FRAUD, 1, placed.orderName);
                (0, holds_1.assertHoldTransactionCount)(transactions, holds_1.OUTSTANDING_PAYMENT, 1, placed.orderName);
                break;
            }
            case "release_fraud": {
                const applied = await (0, holdFlow_1.applyFraudHold)(deps, config.store, placed.orderId, idTail);
                stageDone("apply_fraud_hold", applied.settledElapsedSeconds);
                const released = await (0, holdFlow_1.releaseFraudHold)(deps, config.store, idTail, applied.fulfillmentOrderId);
                stageDone("release_fraud_hold", released.settledElapsedSeconds);
                const rows = await reader.getOrderRows(config.store, idTail);
                const record = (0, dynamoReader_1.orderRecordFromRows)(rows);
                (0, holds_1.assertHoldReasonAbsent)(record, holds_1.POTENTIAL_FRAUD, placed.orderName);
                (0, holds_1.assertUnholdTransactionCount)((0, dynamoReader_1.transactionRowsFromRows)(rows), holds_1.POTENTIAL_FRAUD, 1, placed.orderName);
                break;
            }
            case "release_payment": {
                const applied = await (0, holdFlow_1.applyOutstandingPaymentHold)(deps, config.store, placed.orderId, idTail, addItemVariantId, caseDef.addItemSku);
                stageDone("apply_outstanding_hold", applied.settledElapsedSeconds);
                const released = await (0, holdFlow_1.releaseOutstandingPaymentHold)(deps, config.store, placed.orderId, idTail);
                stageDone("release_outstanding_hold", released.settledElapsedSeconds);
                const rows = await reader.getOrderRows(config.store, idTail);
                const record = (0, dynamoReader_1.orderRecordFromRows)(rows);
                (0, holds_1.assertHoldReasonAbsent)(record, holds_1.OUTSTANDING_PAYMENT, placed.orderName);
                (0, holds_1.assertUnholdTransactionCount)((0, dynamoReader_1.transactionRowsFromRows)(rows), holds_1.OUTSTANDING_PAYMENT, 1, placed.orderName);
                break;
            }
            case "partial_release": {
                const fraud = await (0, holdFlow_1.applyFraudHold)(deps, config.store, placed.orderId, idTail);
                stageDone("apply_fraud_hold", fraud.settledElapsedSeconds);
                const outstanding = await (0, holdFlow_1.applyOutstandingPaymentHold)(deps, config.store, placed.orderId, idTail, addItemVariantId, caseDef.addItemSku);
                stageDone("apply_outstanding_hold", outstanding.settledElapsedSeconds);
                const released = await (0, holdFlow_1.releaseFraudHold)(deps, config.store, idTail, fraud.fulfillmentOrderId);
                stageDone("release_fraud_hold", released.settledElapsedSeconds);
                const rows = await reader.getOrderRows(config.store, idTail);
                const record = (0, dynamoReader_1.orderRecordFromRows)(rows);
                const transactions = (0, dynamoReader_1.transactionRowsFromRows)(rows);
                (0, holds_1.assertOnHold)(record, [holds_1.OUTSTANDING_PAYMENT], placed.orderName);
                (0, holds_1.assertUnholdTransactionCount)(transactions, holds_1.POTENTIAL_FRAUD, 1, placed.orderName);
                (0, holds_1.assertUnholdTransactionCount)(transactions, holds_1.OUTSTANDING_PAYMENT, 0, placed.orderName);
                break;
            }
        }
        result.passed = true;
    }
    catch (error) {
        result.error = describeError(error);
    }
    return result;
}
function customerLine(config) {
    const customer = (0, config_1.customerFor)(config);
    return `${customer.firstName} ${customer.lastName} <${customer.email}>`;
}
/**
 * Runs the six hold-lifecycle cases sequentially (never the wave-scheduled
 * concurrency runner.ts's pipeline cases use — see file header). `caseNames`
 * filters to a subset, same `--cases` convention as the main regression CLI.
 */
async function runOrdersSuite(store, caseNames, verbose = true) {
    const config = (0, config_1.defaultConfig)();
    config.store = store;
    config.verbose = verbose;
    const allCases = (0, ordersCases_1.buildOrdersCases)(store);
    const names = caseNames && caseNames.length > 0 ? caseNames : ordersCases_1.ORDERS_CASE_NAMES;
    const unknown = names.filter((name) => !(name in allCases));
    if (unknown.length > 0) {
        throw new Error(`Unknown orders case(s): ${unknown.join(", ")}. Known: ${ordersCases_1.ORDERS_CASE_NAMES.join(", ")}`);
    }
    console.log(`Running ${names.length} orders case(s) on ${store} as ${customerLine(config)}`);
    const results = [];
    for (const name of names) {
        console.log(`\n[case] ${name} — ${allCases[name].description}`);
        const result = await runOrdersCase(config, allCases[name]);
        if (result.passed) {
            console.log(`  PASS (order ${result.orderName})`);
        }
        else {
            console.log(`  FAIL (order ${result.orderName || "(none)"}): ${result.error}`);
        }
        results.push(result);
    }
    return { store, cases: results, passed: results.every((r) => r.passed) };
}
