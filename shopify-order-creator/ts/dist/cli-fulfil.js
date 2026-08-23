"use strict";
/**
 * Order-driven fulfil CLI — TAA-36, slice C of the TAA-21 fulfilment
 * workstream. One command takes a Shopify order (name or numeric id) and
 * fulfils every shipment on it, with no hand-supplied ids: order -> order PK
 * -> shipment rows -> grouped items -> payload per shipment, via
 * flows/fulfilFlow.ts.
 *
 * Supersedes TAA-34's hand-driven `--shipment`/`--item` surface. That mode
 * could never read the shipments table (no DynamoDB access, by design, to
 * prove the endpoint contract in isolation) and so could only guess at a
 * tracking number by scraping response-body fields that don't exist. This
 * flow reads the real row instead of guessing — see fulfilFlow.ts.
 *
 * Fulfilment is irreversible on staging and a 200 produces a real Auspost
 * staging shipment — there is no dry-run mode. TAA-41 confirmed the backend
 * does not guard against re-fulfilling an already-FULFILLED shipment, so
 * this flow does that check itself before ever calling the endpoint.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.printFulfilHelp = printFulfilHelp;
exports.parseFulfilArgs = parseFulfilArgs;
exports.runFulfilCli = runFulfilCli;
const config_1 = require("./config");
const dynamo_1 = require("./clients/dynamo");
const dynamoReader_1 = require("./readers/dynamoReader");
const shopify_1 = require("./clients/shopify");
const fulfilment_1 = require("./clients/fulfilment");
const fulfilFlow_1 = require("./flows/fulfilFlow");
function printFulfilHelp() {
    console.log(`Usage: node dist/index.js fulfil --order <name|id> --store <US|PS>

Fulfils every shipment on one order against real staging (TAA-36) — resolves
the order to its DynamoDB rows, waits for shipment item counts to settle,
checks each shipment isn't already FULFILLED, then fulfils it and waits for
the row to settle before reporting.

Fulfilment is IRREVERSIBLE on staging and a 200 produces a real Auspost
staging shipment per shipment on the order. There is no backend guard
against re-fulfilling an already-FULFILLED shipment (TAA-41) — this command
checks the shipment row itself and skips anything already fulfilled.

  --order <name|id>       Shopify order display name (e.g. 9928 or "#9928")
                          or the numeric tail of its GID.
  --store <US|PS>         Target store (default: US)
  --help, -h              Show this help text

Requires FULFIL_BASE_URL, FULFIL_API_KEY, and the usual Shopify/AWS
environment (see CLAUDE.md). The fulfilment client refuses to run against
any host other than staging.
`);
}
function parseFulfilArgs(argv) {
    const config = { help: false, order: "", store: "US" };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") {
            config.help = true;
        }
        else if (arg === "--order" && argv[index + 1]) {
            config.order = argv[index + 1];
            index += 1;
        }
        else if (arg === "--store" && argv[index + 1]) {
            const value = argv[index + 1];
            if (value !== "US" && value !== "PS") {
                throw new Error(`--store must be US or PS, got "${value}"`);
            }
            config.store = value;
            index += 1;
        }
        else {
            throw new Error(`Unknown argument: "${arg}"`);
        }
    }
    if (config.help) {
        return config;
    }
    if (!config.order) {
        throw new Error('--order is required (Shopify order name or id, e.g. --order 9928 or --order "#9928")');
    }
    return config;
}
function printOutcome(outcome) {
    const tracking = outcome.trackingNumber ?? "(none)";
    const detail = outcome.detail ? ` — ${outcome.detail}` : "";
    console.log(`  shipment ${outcome.shipmentId}: ${outcome.itemCount} item(s), ${outcome.status}, tracking ${tracking}${detail}`);
}
async function runFulfilCli(argv) {
    const config = parseFulfilArgs(argv);
    if (config.help) {
        printFulfilHelp();
        return;
    }
    const regressionConfig = (0, config_1.defaultConfig)();
    regressionConfig.store = config.store;
    const shopify = new shopify_1.ShopifyClient(config.store);
    const reader = new dynamoReader_1.DynamoReader(new dynamo_1.DynamoClient(regressionConfig), regressionConfig);
    const fulfilmentClient = new fulfilment_1.FulfilmentClient();
    const idTail = await (0, fulfilFlow_1.resolveOrderIdTail)(shopify, config.order);
    console.log(`Resolved order "${config.order}" (${config.store}) -> id tail ${idTail}`);
    const result = await (0, fulfilFlow_1.fulfilOrder)({ reader, fulfilmentClient, verbose: regressionConfig.verbose }, config.store, idTail);
    console.log(`Order PK ${result.orderPk}: ${result.totalUnits} unit(s) across ${result.shipments.length} shipment(s) ` +
        `(item-count settle took ${result.itemSettleElapsedSeconds.toFixed(1)}s)`);
    for (const outcome of result.shipments) {
        printOutcome(outcome);
    }
    if (result.shipments.some((outcome) => outcome.status === "FAILED")) {
        process.exitCode = 1;
    }
}
