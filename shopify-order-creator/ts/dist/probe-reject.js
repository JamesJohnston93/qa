"use strict";
/**
 * TAA-31 slice A — hand-driven probe for the reject endpoint's contract.
 *
 * ONE-SHOT RESEARCH TOOL. Not wired into index.ts/cli.ts, not in --help, no
 * verify/ module, no cases/, no regression wiring, no formal poll window.
 * Everything here is observation: dump the current shipment/item state for
 * an order, optionally fire a real reject call against one item, then poll
 * and print what actually happens. See ts/signoffs/TAA-31-slice-a.md for the
 * findings this produced.
 *
 * CORRECTION TO THE GIVEN CONTRACT, confirmed live (2026-08-23): JJ's brief
 * said reject goes to "the same endpoint as fulfil". It does not. POST
 * /staging/fulfil with a `rejected_items` body (no `package_composition`)
 * returns 502 `{"message": "Internal server error"}` — the handler behind
 * /staging/fulfil doesn't branch on body shape, it unconditionally expects
 * `package_composition` and throws on its absence (confirmed: adding an
 * empty `package_composition: []` alongside `rejected_items` turns the crash
 * into a clean 400 "There's been an error fulfilling this shipment"). Reject
 * is a genuine SIBLING PATH: POST /staging/reject, same host/auth, returns
 * 200 `{code:200, message:"success", data:{message:"Shipment Item(s)
 * rejected successfully."}}` for the exact payload in the brief. See
 * ts/signoffs/TAA-31-slice-a.md for the full discovery trail.
 *
 * SLICE B UPDATE (2026-08-23): the real client this slice's finding called
 * for now exists, `clients/reject.ts` (`RejectClient`/`buildRejectPayload`).
 * This probe was rewritten to call it instead of the raw `fetch` slice A
 * used for discovery — dogfooding the real client live is this slice's
 * required hand-fed confirmation call.
 *
 * SLICE D UPDATE (2026-08-23): now calls the promoted `rejectShipment()`
 * flow (`flows/rejectFlow.ts`) instead of building the payload and firing
 * the client itself. Also gained `--seed-store99`: this SKU's ambient real
 * per-store stock turned out thin and mostly exhausted (confirmed via
 * `probe-stock-check.ts` — several stores this session's trials landed on
 * now sit at exactly 0, one went negative), so a real "reject -> reallocate"
 * case can't rely on the wider network having a valid next-best store.
 * Topping up STORE_99 (a location this harness fully controls) immediately
 * before rejecting gave a reliably reproducible non-undeliverable outcome
 * (order #9953) — see ts/signoffs/TAA-31-slice-d.md.
 *
 * Usage:
 *   node dist/probe-reject.js --store US --order 9930
 *     -> resolves the order, waits for shipment item counts to settle,
 *        prints every item/shipment row. Dump-only, no reject fired.
 *   node dist/probe-reject.js --store US --order 9930 --reject-item "ITEM#<uuid>"
 *     -> same dump, then rejects exactly that one item, prints the raw
 *        response, then polls staging-shipments for up to 120s (2s interval)
 *        logging every tick until the state stabilizes, and prints the
 *        final state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const config_1 = require("./config");
const dynamo_1 = require("./clients/dynamo");
const dynamoReader_1 = require("./readers/dynamoReader");
const shopify_1 = require("./clients/shopify");
const reject_1 = require("./clients/reject");
const rejectFlow_1 = require("./flows/rejectFlow");
const fulfilFlow_1 = require("./flows/fulfilFlow");
const polling_1 = require("./polling");
/**
 * Read-only TRANSACTION# row dump on staging-shipments — dynamoReader.ts's
 * public surface only exposes ITEM#/SHIPMENT# rows (queryShipmentRows is
 * private), so this queries the same table directly via the DynamoClient's
 * public `.doc`. Answers the ticket's "Depends on TAA-21" note that
 * rejection appends transactions the same way fulfilment does.
 */
async function dumpTransactionRows(dynamo, table, pk, label) {
    const result = await dynamo.doc.send(new lib_dynamodb_1.QueryCommand({ TableName: table, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": pk } }));
    const rows = (result.Items ?? []).filter((row) => String(row.SK ?? "").startsWith("TRANSACTION#"));
    console.log(`\n--- TRANSACTION# rows (${label}), ${rows.length} row(s) ---`);
    for (const row of rows) {
        console.log(`  ${row.SK}: ${JSON.stringify(row)}`);
    }
}
function parseArgs(argv) {
    const args = { store: "US", order: "", seedStore99: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--store" && argv[i + 1]) {
            const value = argv[i + 1];
            if (value !== "US" && value !== "PS") {
                throw new Error(`--store must be US or PS, got "${value}"`);
            }
            args.store = value;
            i += 1;
        }
        else if (arg === "--order" && argv[i + 1]) {
            args.order = argv[i + 1];
            i += 1;
        }
        else if (arg === "--reject-item" && argv[i + 1]) {
            args.rejectItem = argv[i + 1];
            i += 1;
        }
        else if (arg === "--seed-store99") {
            args.seedStore99 = true;
        }
        else {
            throw new Error(`Unknown argument: "${arg}"`);
        }
    }
    if (!args.order) {
        throw new Error('--order is required (e.g. --order 9930)');
    }
    return args;
}
function printState(label, items, shipments) {
    console.log(`\n--- ${label} (${items.length} item row(s), ${shipments.length} shipment row(s)) ---`);
    for (const item of items) {
        console.log(`  item ${item.shipmentItemId} sku=${item.sku} status=${item.status} ` +
            `shipmentId=${item.shipmentId ?? "(none)"} store=${item.store ?? "(none)"} ` +
            `rejectedStores=${JSON.stringify(item.rejectedStores)}`);
    }
    for (const shipment of shipments) {
        console.log(`  shipment ${shipment.shipmentId} status=${shipment.status} allocatedStore=${shipment.allocatedStore} ` +
            `trackingNumber=${shipment.trackingNumber} pendingAction=${shipment.pendingAction}`);
    }
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const regressionConfig = (0, config_1.defaultConfig)();
    regressionConfig.store = args.store;
    const shopify = new shopify_1.ShopifyClient(args.store);
    const dynamoClient = new dynamo_1.DynamoClient(regressionConfig);
    const reader = new dynamoReader_1.DynamoReader(dynamoClient, regressionConfig);
    const idTail = await (0, fulfilFlow_1.resolveOrderIdTail)(shopify, args.order);
    console.log(`Resolved order "${args.order}" (${args.store}) -> id tail ${idTail}`);
    const orderRows = await reader.getOrderRows(args.store, idTail);
    const orderPk = (0, dynamoReader_1.orderPkFromRows)(orderRows);
    if (!orderPk) {
        throw new Error(`Order ${idTail} has not landed in staging-orders-v2 yet`);
    }
    const totalUnits = (0, fulfilFlow_1.totalOrderUnits)(orderRows);
    console.log(`Order PK ${orderPk}, ${totalUnits} unit(s) total`);
    console.log("Waiting for shipment item counts to settle...");
    const { value: items, elapsed: settleElapsed } = await (0, polling_1.pollUntil)(() => reader.getShipmentItemsByPk(orderPk), (candidate) => (0, fulfilFlow_1.itemCountsSettled)(candidate, totalUnits), 60, 2, "probe_item_settle", true);
    console.log(`Item counts settled after ${settleElapsed.toFixed(1)}s`);
    const shipments = await reader.getShipmentsByPk(orderPk);
    printState("BEFORE", items, shipments);
    await dumpTransactionRows(dynamoClient, regressionConfig.shipmentsTable, orderPk, "BEFORE");
    const grouped = (0, dynamoReader_1.groupItemsByShipment)(items);
    console.log(`\n${grouped.size} shipment(s) with allocated items.`);
    if (!args.rejectItem) {
        console.log("\nNo --reject-item given — dump only, exiting.");
        return;
    }
    const target = items.find((item) => item.shipmentItemId === args.rejectItem);
    if (!target) {
        throw new Error(`"${args.rejectItem}" not found among this order's item rows. Known: ${items.map((i) => i.shipmentItemId).join(", ")}`);
    }
    if (!target.shipmentId) {
        throw new Error(`"${args.rejectItem}" is not yet allocated to a shipment`);
    }
    const originalShipmentId = target.shipmentId;
    if (args.seedStore99) {
        // This SKU's ambient real per-store stock is thin/exhausted (probe-stock-check.ts) —
        // give the reallocator a guaranteed, harness-controlled candidate. Seeded
        // AFTER initial allocation already settled, so it can't perturb the
        // starting shipment shape.
        console.log(`\nTopping up ${config_1.STORE_99} for ${target.sku} before rejecting...`);
        await dynamoClient.setStock(target.sku, 99, config_1.STORE_99);
    }
    console.log(`\nRejecting ${target.shipmentItemId} from shipment ${originalShipmentId}...`);
    const rejectClient = new reject_1.RejectClient();
    const result = await (0, rejectFlow_1.rejectShipment)({ reader, rejectClient, verbose: true }, orderPk, originalShipmentId, [
        target.shipmentItemId,
    ]);
    console.log(`\nResolved after ${result.elapsedSeconds.toFixed(1)}s:`);
    for (const outcome of result.items) {
        console.log(`  ${outcome.shipmentItemId} (${outcome.wasListed ? "listed" : "unlisted"}): ` +
            `status=${outcome.status} newShipmentId=${outcome.newShipmentId ?? "(none)"} store=${outcome.store ?? "(none)"}`);
    }
    const afterShipments = await reader.getShipmentsByPk(orderPk);
    await dumpTransactionRows(dynamoClient, regressionConfig.shipmentsTable, orderPk, "AFTER");
    console.log(`\nOriginal shipment status: ${afterShipments.find((s) => s.shipmentId === originalShipmentId)?.status}`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
