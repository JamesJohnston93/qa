"use strict";
/**
 * TAA-31 slice E — hand-driven probe for the reject -> undeliverable case.
 *
 * ONE-SHOT RESEARCH/LIVE-CONFIRM TOOL. Not wired into index.ts/cli.ts, not in
 * --help, no cases/ entry, no regression wiring — matches slices A/D's
 * precedent (see ts/signoffs/TAA-31-slice-a.md, -slice-d.md). Wiring both new
 * reject cases into cases/runner.ts/cli.ts is slice F/G's job.
 *
 * Implements slice A's "audited targeted-zero" proposal verbatim:
 *   1. Read-only audit of every existing location row for the pool-13 SKU
 *      (DynamoClient.getAllLocationsForSku).
 *   2. Zero only the nonzero locations the audit finds, except one
 *      designated store (CHERMSIDE_US for US / PS_STORE for PS, per the
 *      proposal — deliberately not WEB_DC/STORE_99, which every other case
 *      already seeds), which is set to 2 units (DynamoClient.zeroExceptStore,
 *      new this slice).
 *   3. Place a real 2-unit order for that SKU — with only the designated
 *      store holding stock, initial allocation has nowhere else to land.
 *   4. Wait for the shipment to settle, then reject EVERY item on it in one
 *      call (not just one, per the proposal: an unlisted item would remain
 *      eligible to return to its own store and the shipment would stay
 *      allocated instead of going undeliverable).
 *   5. Confirm every item resolves UNDELIVERABLE via rejectShipment()
 *      (flows/rejectFlow.ts, slice D) — its predicate already treats
 *      UNDELIVERABLE as a terminal outcome, so no new flow logic is needed
 *      for this slice, only the case design around it.
 *   6. Zero the designated store back to 0 afterward — same leak lesson as
 *      slice D (a leftover backup seed perturbs a later run's initial
 *      allocation).
 *
 * Usage:
 *   node dist/probe-reject-undeliverable.js --store US
 */
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const dynamo_1 = require("./clients/dynamo");
const dynamoReader_1 = require("./readers/dynamoReader");
const shopifyReader_1 = require("./readers/shopifyReader");
const reject_1 = require("./clients/reject");
const rejectFlow_1 = require("./flows/rejectFlow");
const orderFlow_1 = require("./flows/orderFlow");
const fulfilFlow_1 = require("./flows/fulfilFlow");
const polling_1 = require("./polling");
const variants_1 = require("./variants");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const POOL_SLOT_13 = 13;
const SEED_QUANTITY = 2;
const DESIGNATED_STORE = {
    US: config_1.CHERMSIDE_US,
    PS: config_1.PS_STORE,
};
async function dumpTransactionRows(dynamo, table, pk) {
    const result = await dynamo.doc.send(new lib_dynamodb_1.QueryCommand({ TableName: table, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": pk } }));
    const rows = (result.Items ?? []).filter((row) => String(row.SK ?? "").startsWith("TRANSACTION#"));
    console.log(`\n--- TRANSACTION# rows, ${rows.length} row(s) ---`);
    for (const row of rows) {
        console.log(`  ${row.SK}: ${JSON.stringify(row)}`);
    }
}
function parseStore(argv) {
    const idx = argv.indexOf("--store");
    const value = idx >= 0 ? argv[idx + 1] : "US";
    if (value !== "US" && value !== "PS") {
        throw new Error(`--store must be US or PS, got "${value}"`);
    }
    return value;
}
async function main() {
    const store = parseStore(process.argv.slice(2));
    const config = (0, config_1.defaultConfig)();
    config.store = store;
    const pool = (0, variants_1.skuPoolFor)(store);
    const sku = pool[POOL_SLOT_13];
    const designatedStore = DESIGNATED_STORE[store];
    console.log(`Store ${store}, SKU ${sku} (pool slot ${POOL_SLOT_13}), designated store ${designatedStore}`);
    const dynamo = new dynamo_1.DynamoClient(config);
    const reader = new dynamoReader_1.DynamoReader(dynamo, config);
    console.log("\nAuditing existing locations for this SKU...");
    const before = await dynamo.getAllLocationsForSku(sku);
    console.log(`  ${before.length} location row(s), ${before.filter((l) => l.quantity > 0).length} nonzero`);
    console.log(`\nApplying audited targeted-zero: keep ${designatedStore} @ ${SEED_QUANTITY}, zero everything else nonzero...`);
    const plan = await dynamo.zeroExceptStore(sku, designatedStore, SEED_QUANTITY);
    console.log(`  Zeroed: ${plan.zero.length ? plan.zero.join(", ") : "(nothing else was nonzero)"}`);
    try {
        console.log(`\nPlacing order: ${sku} x${SEED_QUANTITY}...`);
        const record = await (0, orderFlow_1.placeOrder)(config, { [sku]: SEED_QUANTITY });
        console.log(`Order ${record.orderName} (${record.orderId})`);
        const oidTail = (0, shopifyReader_1.orderIdTail)(record.orderId);
        const { value: orderRows } = await (0, polling_1.pollUntil)(() => reader.getOrderRows(store, oidTail), (rows) => {
            const quantities = (0, dynamoReader_1.orderSkuQuantitiesFromRows)(rows);
            return quantities[sku] === SEED_QUANTITY;
        }, 60, 2, "probe_order_row_settle", true);
        const orderPk = (0, dynamoReader_1.orderPkFromRows)(orderRows);
        if (!orderPk) {
            throw new Error(`Order ${oidTail} has no resolvable PK yet`);
        }
        const totalUnits = (0, fulfilFlow_1.totalOrderUnits)(orderRows);
        console.log("\nWaiting for shipment item counts to settle...");
        const { value: items } = await (0, polling_1.pollUntil)(() => reader.getShipmentItemsByPk(orderPk), (candidate) => (0, fulfilFlow_1.itemCountsSettled)(candidate, totalUnits), 60, 2, "probe_item_settle", true);
        const grouped = (0, dynamoReader_1.groupItemsByShipment)(items);
        if (grouped.size !== 1) {
            throw new Error(`Expected exactly one shipment, got ${grouped.size}: ${[...grouped.keys()].join(", ")}`);
        }
        const [shipmentId, shipmentItems] = [...grouped.entries()][0];
        const shipments = await reader.getShipmentsByPk(orderPk);
        const shipment = shipments.find((s) => s.shipmentId === shipmentId);
        console.log(`Shipment ${shipmentId} allocated to store ${shipment?.allocatedStore} (expected ${designatedStore.split("#").pop()})`);
        const itemIds = shipmentItems.map((i) => i.shipmentItemId);
        console.log(`\nRejecting ALL ${itemIds.length} item(s) on shipment ${shipmentId} in one call...`);
        const result = await (0, rejectFlow_1.rejectShipment)({ reader, rejectClient: new reject_1.RejectClient(), verbose: true }, orderPk, shipmentId, itemIds);
        console.log(`\nResolved after ${result.elapsedSeconds.toFixed(1)}s:`);
        let allUndeliverable = true;
        for (const outcome of result.items) {
            console.log(`  ${outcome.shipmentItemId}: status=${outcome.status} newShipmentId=${outcome.newShipmentId ?? "(none)"}`);
            if (outcome.status !== "UNDELIVERABLE") {
                allUndeliverable = false;
            }
        }
        await dumpTransactionRows(dynamo, config.shipmentsTable, orderPk);
        console.log(allUndeliverable ? "\nPASS: every item resolved UNDELIVERABLE." : "\nFAIL: not every item resolved UNDELIVERABLE.");
        if (!allUndeliverable) {
            process.exitCode = 1;
        }
    }
    finally {
        console.log(`\nZeroing ${designatedStore} back down for ${sku}...`);
        await dynamo.setStock(sku, 0, designatedStore);
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
