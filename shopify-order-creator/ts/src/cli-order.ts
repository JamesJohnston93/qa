/**
 * Ad-hoc order placement — TAA-15 step 1: the minimal TS replacement for
 * main.py's daily-use path (place a custom test order on demand). Not the
 * full TAA-15 operator-UX rework (settings menus, presets, stress-test,
 * fire-and-verify, GUI stay out of scope — see CLAUDE.md).
 *
 * Reuses the existing harness clients/flows as-is: Shopify draft->complete
 * (clients/shopify.ts), NewStore SFS/OTC injection + receipts
 * (flows/newstoreOrders.ts, flows/receipts.ts), Dynamo inventory seeding
 * (clients/dynamo.ts). No logic re-port — this file is orchestration + CLI
 * parsing only.
 */

import { defaultConfig, customerFor, type Store } from "./config";
import { WEB_DC, ALL_LOCATIONS } from "./config";
import { variantsFor } from "./variants";
import { DynamoClient } from "./clients/dynamo";
import { ShopifyClient, type DeliverySelection } from "./clients/shopify";
import { NewStoreClient } from "./clients/newstore";
import { injectSfsOrder, injectOtcOrder, lookupPrices, calculateTotal } from "./flows/newstoreOrders";
import { generateAndAttachReceipt } from "./flows/receipts";

export type SeedMode = "standard" | "split" | "zero" | "none";
const SEED_MODES: SeedMode[] = ["standard", "split", "zero", "none"];

// Thresholds for the "standard" seed mode: top up to 99 units if below 10.
const MIN_QUANTITY_THRESHOLD = 10;
const TOP_UP_QUANTITY = 99;

export type DeliverySpec = { type: "rate"; title: string } | { type: "pickup"; locationName: string };

export interface OrderCliConfig {
  help: boolean;
  ns?: "sfs" | "otc";
  store: Store;
  items: Record<string, number>;
  seed: SeedMode;
  delivery?: DeliverySpec;
  email?: string;
  saveReceipt: boolean;
}

/**
 * Parses one "--items" value into a {sku: quantity} map. Accepts a bare SKU
 * (implies quantity 1) or "SKUxQTY"; comma-separated; duplicate SKUs sum
 * their quantities. Pure — no I/O, fully offline-testable.
 */
export function parseItems(raw: string): Record<string, number> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("--items requires at least one SKU (e.g. 32625134x2,33006246x1)");
  }
  const result: Record<string, number> = {};
  for (const entryRaw of trimmed.split(",")) {
    const entry = entryRaw.trim();
    if (!entry) {
      continue;
    }
    const parts = entry.split(/x/i);
    let sku: string;
    let qty: number;
    if (parts.length === 1) {
      sku = parts[0].trim();
      qty = 1;
    } else if (parts.length === 2) {
      sku = parts[0].trim();
      const qtyRaw = parts[1].trim();
      qty = Number(qtyRaw);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(`invalid quantity in item "${entry}": "${qtyRaw}" must be a positive integer`);
      }
    } else {
      throw new Error(`invalid item "${entry}" — expected SKU or SKUxQTY`);
    }
    if (!sku) {
      throw new Error(`invalid item "${entry}" — missing SKU`);
    }
    result[sku] = (result[sku] ?? 0) + qty;
  }
  if (Object.keys(result).length === 0) {
    throw new Error("--items requires at least one SKU (e.g. 32625134x2,33006246x1)");
  }
  return result;
}

/** {sku: qty} -> flat SKU array with repeats — the shape NewStore injection (flows/newstoreOrders.ts) expects. */
export function expandSkuQuantities(items: Record<string, number>): string[] {
  return Object.entries(items).flatMap(([sku, qty]) => Array(qty).fill(sku));
}

function parseDelivery(raw: string): DeliverySpec {
  const match = raw.match(/^(rate|pickup):(.+)$/i);
  if (!match) {
    throw new Error(`--delivery must be "rate:<title>" or "pickup:<location name>", got "${raw}"`);
  }
  const kind = match[1].toLowerCase();
  const value = match[2].trim();
  if (!value) {
    throw new Error(`--delivery ${kind}: requires a non-empty title/name`);
  }
  return kind === "rate" ? { type: "rate", title: value } : { type: "pickup", locationName: value };
}

export function printOrderHelp(): void {
  console.log(`Usage: node dist/index.js order [options]

Places a single ad-hoc test order on staging (Shopify or NewStore SFS/OTC)
and prints the created identifiers immediately.

Shopify order (default):
  --store <US|PS>         Target store (default: US)
  --items <spec>          SKUxQTY,SKUxQTY,... e.g. 32625134x2,33006246x1
  --seed <mode>           Inventory seed mode (default: standard)
                            standard - top up stock at the default location if low
                            split    - qty=1 at each of 4 ATP locations (split-shipment test)
                            zero     - zero stock everywhere (forces UNDELIVERABLE)
                            none     - don't touch inventory
  --delivery <spec>       rate:<exact shipping rate title> or pickup:<exact location name>
                            (default: first available shipping rate)
  --email <email>         Optional override of the default QA-automation customer email

NewStore order:
  --ns <sfs|otc>          Place a NewStore Ship From Store or Over the Counter order instead
  --store <US|PS>         Target brand (default: US)
  --items <spec>          Same format as above
  --save-receipt          Also save the generated receipt PDF locally (default: off)

  --help, -h              Show this help text
`);
}

export function parseOrderArgs(argv: string[]): OrderCliConfig {
  const config: OrderCliConfig = {
    help: false,
    store: "US",
    items: {},
    seed: "standard",
    saveReceipt: false,
  };
  let itemsRaw: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
    } else if (arg === "--store" && argv[index + 1]) {
      const value = argv[index + 1];
      if (value !== "US" && value !== "PS") {
        throw new Error(`--store must be US or PS, got "${value}"`);
      }
      config.store = value;
      index += 1;
    } else if (arg === "--items" && argv[index + 1]) {
      itemsRaw = argv[index + 1];
      index += 1;
    } else if (arg === "--seed" && argv[index + 1]) {
      const value = argv[index + 1];
      if (!SEED_MODES.includes(value as SeedMode)) {
        throw new Error(`--seed must be one of ${SEED_MODES.join("|")}, got "${value}"`);
      }
      config.seed = value as SeedMode;
      index += 1;
    } else if (arg === "--delivery" && argv[index + 1]) {
      config.delivery = parseDelivery(argv[index + 1]);
      index += 1;
    } else if (arg === "--email" && argv[index + 1]) {
      config.email = argv[index + 1];
      index += 1;
    } else if (arg === "--ns" && argv[index + 1]) {
      const value = argv[index + 1];
      if (value !== "sfs" && value !== "otc") {
        throw new Error(`--ns must be sfs or otc, got "${value}"`);
      }
      config.ns = value;
      index += 1;
    } else if (arg === "--save-receipt") {
      config.saveReceipt = true;
    } else {
      throw new Error(`Unknown argument: "${arg}"`);
    }
  }

  if (config.help) {
    return config;
  }
  if (!itemsRaw) {
    throw new Error("--items is required (e.g. --items 32625134x2,33006246x1)");
  }
  config.items = parseItems(itemsRaw);

  if (config.ns && config.email) {
    throw new Error("--email is not supported for --ns orders (NewStore customer identity is fixed per store)");
  }
  if (config.ns && config.delivery) {
    throw new Error("--delivery is not supported for --ns orders (NewStore orders don't use Shopify shipping)");
  }
  if (config.ns && config.seed !== "standard") {
    throw new Error("--seed is not supported for --ns orders (NewStore injection never touches Shopify/Dynamo inventory)");
  }

  return config;
}

async function seedInventory(dynamo: DynamoClient, skus: string[], mode: SeedMode): Promise<void> {
  if (mode === "none") {
    return;
  }
  if (mode === "zero") {
    for (const sku of skus) {
      await dynamo.zeroEverywhere(sku);
    }
    return;
  }
  if (mode === "split") {
    for (const sku of skus) {
      for (const location of ALL_LOCATIONS) {
        await dynamo.setStock(sku, 1, location);
      }
    }
    return;
  }
  // standard: top up only if below threshold, else leave stock alone (no destructive zero).
  for (const sku of skus) {
    const locations = await dynamo.getAllLocationsForSku(sku);
    const current = locations.find((location) => location.store === WEB_DC)?.quantity ?? null;
    if (current === null || current < MIN_QUANTITY_THRESHOLD) {
      await dynamo.setStock(sku, TOP_UP_QUANTITY, WEB_DC);
    }
  }
}

async function runShopifyOrder(config: OrderCliConfig): Promise<void> {
  const regressionConfig = defaultConfig();
  regressionConfig.store = config.store;

  const variants = variantsFor(config.store);
  const skus = Object.keys(config.items);
  const unknown = skus.filter((sku) => !(sku in variants));
  if (unknown.length > 0) {
    throw new Error(
      `SKUs not in ${config.store} variant map: ${JSON.stringify(unknown)}. Known: ${Object.keys(variants).join(", ")}`,
    );
  }

  if (config.seed !== "none") {
    const dynamo = new DynamoClient(regressionConfig);
    await seedInventory(dynamo, skus, config.seed);
    console.log(`Inventory seeded (${config.seed}) for ${skus.join(", ")}`);
  }

  const baseCustomer = customerFor(regressionConfig);
  const customer = config.email ? { ...baseCustomer, email: config.email } : baseCustomer;
  const lineItems = skus.map((sku) => ({ variantId: variants[sku], quantity: config.items[sku] }));
  const shopify = new ShopifyClient(config.store);

  let delivery: DeliverySelection | undefined;
  if (config.delivery?.type === "rate") {
    delivery = { type: "rate", title: config.delivery.title };
  } else if (config.delivery?.type === "pickup") {
    const locationName = config.delivery.locationName;
    const locations = await shopify.fetchPickupLocations();
    const match = locations.find((location) => location.name === locationName);
    if (!match) {
      throw new Error(
        `Pickup location "${locationName}" not found. Available: ${JSON.stringify(locations.map((l) => l.name))}`,
      );
    }
    delivery = { type: "pickup", locationId: match.id };
  }

  const result = await shopify.createDraftOrder(customer.email, lineItems, customer.firstName, customer.lastName, delivery);

  console.log(`\nShopify order placed (${config.store}):`);
  console.log(`  Order name: ${result.orderName}`);
  console.log(`  Order id:   ${result.orderId}`);
}

async function runNewStoreOrder(config: OrderCliConfig): Promise<void> {
  const skuList = expandSkuQuantities(config.items);
  const shopify = new ShopifyClient(config.store);
  const newstore = new NewStoreClient();
  const inject = config.ns === "sfs" ? injectSfsOrder : injectOtcOrder;

  const injected = await inject(config.store, skuList, { shopify, newstore });
  const response = injected.response as Record<string, unknown>;
  const orderUuid = typeof response.id === "string" ? response.id : "";

  console.log(`\nNewStore ${config.ns?.toUpperCase()} order placed (${config.store}):`);
  console.log(`  External ID: ${injected.externalId}`);
  console.log(`  Order UUID:  ${orderUuid || "(not returned)"}`);

  if (!orderUuid) {
    console.log("  [receipt] no order UUID returned — skipping receipt (non-fatal)");
    return;
  }

  try {
    const prices = await lookupPrices(shopify, config.store, skuList);
    const total = calculateTotal(skuList, prices, config.ns === "sfs");
    await generateAndAttachReceipt({
      client: newstore,
      orderUuid,
      externalId: injected.externalId,
      store: config.store,
      skus: skuList,
      prices,
      total,
      orderType: config.ns === "sfs" ? "SFS" : "OTC",
      saveLocally: config.saveReceipt,
    });
  } catch (error) {
    console.log(`  [receipt] generation failed (non-fatal): ${(error as Error).message}`);
  }
}

export async function runOrderCli(argv: string[]): Promise<void> {
  const config = parseOrderArgs(argv);
  if (config.help) {
    printOrderHelp();
    return;
  }

  if (config.ns) {
    await runNewStoreOrder(config);
  } else {
    await runShopifyOrder(config);
  }
}
