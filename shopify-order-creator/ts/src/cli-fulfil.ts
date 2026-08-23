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

import { defaultConfig, type Store } from "./config";
import { DynamoClient } from "./clients/dynamo";
import { DynamoReader } from "./readers/dynamoReader";
import { ShopifyClient } from "./clients/shopify";
import { FulfilmentClient } from "./clients/fulfilment";
import { resolveOrderIdTail, fulfilOrder, type ShipmentFulfilOutcome } from "./flows/fulfilFlow";

export interface FulfilCliConfig {
  help: boolean;
  order: string;
  store: Store;
}

export function printFulfilHelp(): void {
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

export function parseFulfilArgs(argv: string[]): FulfilCliConfig {
  const config: FulfilCliConfig = { help: false, order: "", store: "US" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
    } else if (arg === "--order" && argv[index + 1]) {
      config.order = argv[index + 1];
      index += 1;
    } else if (arg === "--store" && argv[index + 1]) {
      const value = argv[index + 1];
      if (value !== "US" && value !== "PS") {
        throw new Error(`--store must be US or PS, got "${value}"`);
      }
      config.store = value;
      index += 1;
    } else {
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

function printOutcome(outcome: ShipmentFulfilOutcome): void {
  const tracking = outcome.trackingNumber ?? "(none)";
  const detail = outcome.detail ? ` — ${outcome.detail}` : "";
  console.log(`  shipment ${outcome.shipmentId}: ${outcome.itemCount} item(s), ${outcome.status}, tracking ${tracking}${detail}`);
}

export async function runFulfilCli(argv: string[]): Promise<void> {
  const config = parseFulfilArgs(argv);
  if (config.help) {
    printFulfilHelp();
    return;
  }

  const regressionConfig = defaultConfig();
  regressionConfig.store = config.store;

  const shopify = new ShopifyClient(config.store);
  const reader = new DynamoReader(new DynamoClient(regressionConfig), regressionConfig);
  const fulfilmentClient = new FulfilmentClient();

  const idTail = await resolveOrderIdTail(shopify, config.order);
  console.log(`Resolved order "${config.order}" (${config.store}) -> id tail ${idTail}`);

  const result = await fulfilOrder({ reader, fulfilmentClient, verbose: regressionConfig.verbose }, config.store, idTail);

  console.log(
    `Order PK ${result.orderPk}: ${result.totalUnits} unit(s) across ${result.shipments.length} shipment(s) ` +
      `(item-count settle took ${result.itemSettleElapsedSeconds.toFixed(1)}s)`,
  );
  for (const outcome of result.shipments) {
    printOutcome(outcome);
  }

  if (result.shipments.some((outcome) => outcome.status === "FAILED")) {
    process.exitCode = 1;
  }
}
