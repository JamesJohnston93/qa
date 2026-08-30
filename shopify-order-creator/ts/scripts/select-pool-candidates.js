#!/usr/bin/env node
/**
 * TAA-46 slice C — selects 66 new pool candidates per store from the
 * resolved staging SKU lists, filtered by slice B's settled rule: real
 * stock somewhere is the only thing that matters (status/publication/
 * catalog membership don't gate Admin-API order creation at all, see
 * ts/signoffs/TAA-46-slice-b.md). No status/publication read needed here,
 * unlike slice A's dump-availability.js.
 *
 * Standalone dev script, same shape as fetch-sku-gids.js/dump-availability.js:
 * not part of the harness build, reuses the compiled DynamoClient/config/
 * variants. Read-only (getAllLocationsForSku only, no writes).
 *
 * Usage: node select-pool-candidates.js <US|PS> [count]
 */

const fs = require("fs");
const path = require("path");
const { DynamoClient, chunk } = require("../dist/clients/dynamo.js");
const { defaultConfig, AGGREGATE_LOCATIONS } = require("../dist/config.js");
const { variantsFor } = require("../dist/variants.js");

const DEFAULT_COUNT = 66;
const STOCK_CHECK_CONCURRENCY = 15;

async function realStockFor(dynamoClient, sku) {
  const locations = await dynamoClient.getAllLocationsForSku(sku);
  const real = locations.filter((loc) => !AGGREGATE_LOCATIONS.includes(loc.store));
  return real.reduce((sum, loc) => sum + loc.quantity, 0);
}

async function main() {
  const store = process.argv[2];
  if (store !== "US" && store !== "PS") {
    console.error("Usage: node select-pool-candidates.js <US|PS> [count]");
    process.exit(1);
  }
  const count = Number(process.argv[3]) || DEFAULT_COUNT;

  const config = defaultConfig();
  config.store = store;
  const dynamoClient = new DynamoClient(config);

  const skuListsDir = path.join(__dirname, "..", "..", "sku-lists");
  const listPath = path.join(skuListsDir, `${store.toLowerCase()}-skus.json`);
  const entries = JSON.parse(fs.readFileSync(listPath, "utf8"));

  const pool = variantsFor(store);
  const poolSet = new Set(Object.keys(pool));
  const notInPool = entries.filter((e) => !poolSet.has(e.sku));

  const selected = [];
  const zeroStockSkipped = [];
  for (const batch of chunk(notInPool, STOCK_CHECK_CONCURRENCY)) {
    if (selected.length >= count) break;
    const results = await Promise.all(
      batch.map(async (entry) => ({ entry, stock: await realStockFor(dynamoClient, entry.sku) })),
    );
    for (const { entry, stock } of results) {
      if (selected.length >= count) break;
      if (stock > 0) {
        selected.push({ ...entry, realStock: stock });
      } else {
        zeroStockSkipped.push({ sku: entry.sku, realStock: stock });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        store,
        requested: count,
        selectedCount: selected.length,
        checkedCount: selected.length + zeroStockSkipped.length,
        candidatePoolSize: notInPool.length,
        selected,
        zeroStockSkipped,
      },
      null,
      2,
    ),
  );

  if (selected.length < count) {
    console.error(`WARNING: only found ${selected.length}/${count} in-stock candidates for ${store}`);
    process.exitCode = 1;
  }
}

main();
