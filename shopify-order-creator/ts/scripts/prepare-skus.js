#!/usr/bin/env node
/**
 * TAA-47 — stock-based SKU readiness reporter. Given an arbitrary SKU list
 * (JJ's own candidates, not just the resolved sku-lists/*.json pool) and a
 * store, reports PASS/FAIL per SKU and can emit the paste-ready block for
 * adding the passing ones to the pool in src/variants.ts.
 *
 * Generalises select-pool-candidates.js's stock rule (real stock somewhere,
 * aggregate/mirror locations excluded — config.ts's AGGREGATE_LOCATIONS,
 * ts/signoffs/TAA-46-slice-b.md) to: an arbitrary supplied list rather than
 * only the existing sku-lists JSON, a PASS/FAIL report with a reason per
 * SKU rather than a silent skip, the whole list rather than stopping at a
 * count, and an optional pool-ready output block.
 *
 * GID resolution reuses fetch-sku-gids.js's *path* (ShopifyClient, batches
 * of 50, same productVariants query) but not its file directly — that
 * script has no exports (its top-level main() runs as a side effect of
 * require()), so the batch-query logic is duplicated here rather than
 * editing a file this lane doesn't own. Small duplication beats a
 * premature shared module for ~25 lines of query logic.
 *
 * Read-only: getAllLocationsForSku and a GraphQL query only. No seeding, no
 * mutation, no pool/variants.ts writes — this only prints a block for JJ to
 * paste by hand.
 *
 * Usage: node prepare-skus.js <US|PS> <input-file> [--emit-block]
 *   input-file: a .json file (already-resolved [{sku, gid, title, price}],
 *     e.g. sku-lists/<store>-skus.json) or any other extension, read as
 *     plain text, one SKU per line (the form JJ actually supplies).
 */

const fs = require("fs");
const { ShopifyClient } = require("../dist/clients/shopify.js");
const { DynamoClient, chunk } = require("../dist/clients/dynamo.js");
const { defaultConfig, AGGREGATE_LOCATIONS } = require("../dist/config.js");

const GID_BATCH_SIZE = 50;
const STOCK_CHECK_CONCURRENCY = 15; // matches select-pool-candidates.js against the same Dynamo table

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadInput(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  if (inputPath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${inputPath}: expected a JSON array of {sku, gid, title, price} entries`);
    }
    return parsed.map((entry) => {
      if (!entry.sku) {
        throw new Error(`${inputPath}: entry missing "sku": ${JSON.stringify(entry)}`);
      }
      return { sku: String(entry.sku), gid: entry.gid ?? null, title: entry.title ?? null, price: entry.price ?? null };
    });
  }
  const skus = [
    ...new Set(
      raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  return skus.map((sku) => ({ sku, gid: null, title: null, price: null }));
}

async function queryGidBatch(client, skus) {
  const searchQuery = skus.map((sku) => `sku:${sku}`).join(" OR ");
  const result = await client.execute(
    `
      query variantsBySku($searchQuery: String!) {
        productVariants(first: ${GID_BATCH_SIZE}, query: $searchQuery) {
          edges {
            node {
              id
              sku
              price
              title
              product { title }
            }
          }
        }
      }
    `,
    { searchQuery },
  );
  if (result.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(result.errors)}`);
  }
  return result.data.productVariants.edges.map((edge) => edge.node).filter((node) => skus.includes(node.sku));
}

async function resolveGids(store, skus) {
  const client = new ShopifyClient(store);
  const found = new Map();
  const batches = chunk(skus, GID_BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const nodes = await queryGidBatch(client, batch);
    for (const node of nodes) found.set(node.sku, node);
    console.log(`  GID batch ${index + 1}/${batches.length}: ${nodes.length}/${batch.length} resolved`);
    if (index < batches.length - 1) {
      await sleep(500); // stay well clear of the Admin API's cost-based rate limit
    }
  }
  return new Map(
    skus.map((sku) => {
      const node = found.get(sku);
      return node
        ? [sku, { gid: node.id, title: `${node.product.title} - ${node.title}`, price: node.price }]
        : [sku, { gid: null, title: null, price: null }];
    }),
  );
}

async function realStockFor(dynamoClient, sku) {
  const locations = await dynamoClient.getAllLocationsForSku(sku);
  const real = locations.filter((loc) => !AGGREGATE_LOCATIONS.includes(loc.store));
  return real.reduce((sum, loc) => sum + loc.quantity, 0);
}

/** Pure: PASS/FAIL + reason for one SKU, given its resolved GID (or null) and real stock (or null if unresolved). */
function classifySku({ sku, gid, title, price, realStock }) {
  if (!gid) {
    return { sku, gid: null, title: null, price: null, realStock: null, status: "FAIL", reason: "no matching variant GID found in Shopify" };
  }
  if (realStock > 0) {
    return { sku, gid, title: title ?? null, price: price ?? null, realStock, status: "PASS", reason: `real stock ${realStock} across non-aggregate locations` };
  }
  return {
    sku,
    gid,
    title: title ?? null,
    price: price ?? null,
    realStock: realStock ?? 0,
    status: "FAIL",
    reason: "zero real stock across non-aggregate locations",
  };
}

/** Pure: the paste-ready block for src/variants.ts — both halves, same order, matching the file's own formatting. */
function formatPoolBlock(passing, store) {
  if (passing.length === 0) {
    throw new Error("formatPoolBlock: no PASS entries to emit");
  }
  const varName = store === "US" ? "US_VARIANTS" : "PS_VARIANTS";
  const orderName = store === "US" ? "US_SKU_ORDER" : "PS_SKU_ORDER";
  const variantLines = passing.map((entry) => `  "${entry.sku}": "${entry.gid}",`).join("\n");
  const orderLines = passing.map((entry) => `  "${entry.sku}",`).join("\n");
  return [
    `// ${varName} additions (TAA-47 prepare-skus, ${passing.length} SKU${passing.length === 1 ? "" : "s"}) — paste into the ${varName} object in src/variants.ts`,
    variantLines,
    "",
    `// ${orderName} additions — append to ${orderName} in the SAME order as above (declaration order is load-bearing, see variants.ts)`,
    orderLines,
  ].join("\n");
}

async function main() {
  const store = process.argv[2];
  const inputPath = process.argv[3];
  const emitBlock = process.argv.includes("--emit-block");
  if ((store !== "US" && store !== "PS") || !inputPath) {
    console.error("Usage: node prepare-skus.js <US|PS> <input-file> [--emit-block]");
    process.exit(1);
  }

  const entries = loadInput(inputPath);
  console.log(`Loaded ${entries.length} SKU(s) from ${inputPath} for ${store}`);

  const unresolvedSkus = entries.filter((entry) => !entry.gid).map((entry) => entry.sku);
  let resolvedByGid = new Map();
  if (unresolvedSkus.length > 0) {
    console.log(`Resolving ${unresolvedSkus.length} SKU(s) via Shopify Admin API...`);
    resolvedByGid = await resolveGids(store, unresolvedSkus);
  }

  const withResolution = entries.map((entry) => {
    if (entry.gid) return entry;
    const resolved = resolvedByGid.get(entry.sku);
    return { sku: entry.sku, gid: resolved.gid, title: resolved.title, price: resolved.price };
  });

  const config = defaultConfig();
  config.store = store;
  const dynamoClient = new DynamoClient(config);

  const toStockCheck = withResolution.filter((entry) => entry.gid);
  const noGid = withResolution.filter((entry) => !entry.gid);

  const results = noGid.map((entry) => classifySku({ ...entry, realStock: null }));

  let checked = 0;
  for (const batch of chunk(toStockCheck, STOCK_CHECK_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const realStock = await realStockFor(dynamoClient, entry.sku);
        return classifySku({ ...entry, realStock });
      }),
    );
    results.push(...batchResults);
    checked += batch.length;
    console.log(`  stock-checked ${checked}/${toStockCheck.length}...`);
  }

  const bySku = new Map(results.map((result) => [result.sku, result]));
  const ordered = entries.map((entry) => bySku.get(entry.sku));

  console.log("");
  for (const result of ordered) {
    console.log(`${result.status}  ${result.sku}  ${result.reason}`);
  }
  const passCount = ordered.filter((result) => result.status === "PASS").length;
  console.log(`\n${passCount}/${ordered.length} PASS for ${store}`);

  if (emitBlock) {
    const passing = ordered.filter((result) => result.status === "PASS");
    if (passing.length === 0) {
      console.log("\nNo PASS entries — nothing to emit.");
    } else {
      console.log(`\n${formatPoolBlock(passing, store)}`);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { classifySku, formatPoolBlock, loadInput };
