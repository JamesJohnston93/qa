"use strict";
/**
 * Hand-driven fulfil CLI — TAA-34, slice A of the TAA-21 fulfilment
 * workstream. Fulfils one shipment from hand-supplied IDs against real
 * staging. Deliberately narrow: no DynamoDB reads, no verification, no
 * regression cases — this exists to prove the /staging/fulfil endpoint
 * contract before slices B-F build on top of it.
 *
 * Fulfilment is irreversible on staging and a 200 produces a real Auspost
 * staging shipment — there is no dry-run mode.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.printFulfilHelp = printFulfilHelp;
exports.parseFulfilArgs = parseFulfilArgs;
exports.runFulfilCli = runFulfilCli;
const fulfilment_1 = require("./clients/fulfilment");
const TRACKING_NUMBER_FIELDS = ["tracking_number", "trackingNumber", "tracking_id", "consignment_number"];
function printFulfilHelp() {
    console.log(`Usage: node dist/index.js fulfil --shipment <uuid> --item ITEM#<uuid> [--item ITEM#<uuid> ...]

Fulfils one shipment against staging from hand-supplied IDs (TAA-34). Makes
no DynamoDB reads and asserts nothing beyond the HTTP response — it exists to
prove the /staging/fulfil endpoint contract before anything is built on top
of it.

Fulfilment is IRREVERSIBLE on staging and a 200 produces a real Auspost
staging shipment. Use a fresh, already-allocated shipment for each run.

  --shipment <uuid>       Bare shipment UUID — the SHIPMENT# sort key with
                          the prefix stripped. Do not include "SHIPMENT#".
  --item ITEM#<uuid>      One shipment item id, ITEM# prefix retained.
                          Repeatable: pass once per item on the shipment.
  --help, -h              Show this help text

Requires FULFIL_BASE_URL and FULFIL_API_KEY in the environment. The client
refuses to run against any host other than staging.
`);
}
function parseFulfilArgs(argv) {
    const config = { help: false, shipmentId: "", itemIds: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") {
            config.help = true;
        }
        else if (arg === "--shipment" && argv[index + 1]) {
            config.shipmentId = argv[index + 1];
            index += 1;
        }
        else if (arg === "--item" && argv[index + 1]) {
            config.itemIds.push(argv[index + 1]);
            index += 1;
        }
        else {
            throw new Error(`Unknown argument: "${arg}"`);
        }
    }
    if (config.help) {
        return config;
    }
    if (!config.shipmentId) {
        throw new Error("--shipment is required (bare shipment UUID, e.g. --shipment d4948c69-af52-488a-ad5c-48ac0fc38986)");
    }
    if (config.shipmentId.includes("SHIPMENT#")) {
        throw new Error(`--shipment must be the bare UUID with the "SHIPMENT#" prefix stripped, got "${config.shipmentId}"`);
    }
    if (config.itemIds.length === 0) {
        throw new Error("at least one --item is required (e.g. --item ITEM#f8f9e240-b89a-46db-92e8-1a1483249997)");
    }
    const badItems = config.itemIds.filter((itemId) => !itemId.startsWith("ITEM#"));
    if (badItems.length > 0) {
        throw new Error(`--item values must retain the "ITEM#" prefix, got: ${JSON.stringify(badItems)}`);
    }
    return config;
}
function extractTrackingNumber(body) {
    for (const field of TRACKING_NUMBER_FIELDS) {
        const value = body[field];
        if (typeof value === "string" && value) {
            return value;
        }
    }
    return undefined;
}
async function runFulfilCli(argv) {
    const config = parseFulfilArgs(argv);
    if (config.help) {
        printFulfilHelp();
        return;
    }
    const client = new fulfilment_1.FulfilmentClient();
    const fulfilledAt = (0, fulfilment_1.formatFulfilledAt)(new Date());
    const payload = (0, fulfilment_1.buildFulfilPayload)(config.shipmentId, config.itemIds, fulfilment_1.FULFILLER, fulfilledAt);
    console.log(`Fulfilling shipment ${config.shipmentId} (${config.itemIds.length} item(s)) at ${fulfilledAt} (Australia/Brisbane)...`);
    const body = await client.fulfil(payload);
    console.log("Status: 200");
    console.log(`Response body: ${JSON.stringify(body, null, 2)}`);
    const trackingNumber = extractTrackingNumber(body);
    if (trackingNumber) {
        console.log(`Tracking number: ${trackingNumber}`);
    }
    else {
        console.log(`Tracking number: not found under ${JSON.stringify(TRACKING_NUMBER_FIELDS)} — inspect the response body above and record the real field name for slice D.`);
    }
}
