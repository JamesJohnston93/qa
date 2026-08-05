#!/usr/bin/env node
/**
 * Resolves a plain-text list of SKUs (one per line) to their Shopify
 * ProductVariant GID + title + price via the Admin GraphQL API — turns
 * sku-lists/<store>-skus.txt into sku-lists/<store>-skus.json for TAA-14
 * Phase B's staging SKU pool.
 *
 * Standalone dev script — not part of the harness build (tsconfig only
 * includes src/**\/*.ts) — but reuses the compiled `ShopifyClient` (TAA-22)
 * rather than its own raw-fetch/token logic, so it gets US's static token
 * and PS's OAuth client-credentials grant for free and stays in sync with
 * the harness's auth (throttle retry included). Requires
 * US_ACCESS_TOKEN/(PS_CLIENT_ID+PS_CLIENT_SECRET) in the environment, same
 * as the harness itself. Read-only (GraphQL query only, no mutations) —
 * safe to re-run any time the SKU list changes.
 *
 * Usage: node fetch-sku-gids.js <US|PS>
 */

const fs = require("fs");
const path = require("path");
const { ShopifyClient } = require("../dist/clients/shopify.js");

const BATCH_SIZE = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function queryBatch(client, skus) {
  const searchQuery = skus.map((sku) => `sku:${sku}`).join(" OR ");
  const result = await client.execute(
    `
      query variantsBySku($searchQuery: String!) {
        productVariants(first: ${BATCH_SIZE}, query: $searchQuery) {
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
  // Defensive: only keep nodes whose sku was actually in this batch —
  // Shopify's search query can match more loosely than an exact sku:
  // lookup implies, and silently trusting every returned node risks
  // mislabelling an unrelated variant as one of ours.
  return result.data.productVariants.edges.map((edge) => edge.node).filter((node) => skus.includes(node.sku));
}

async function main() {
  const store = process.argv[2];
  if (store !== "US" && store !== "PS") {
    console.error("Usage: node fetch-sku-gids.js <US|PS>");
    process.exit(1);
  }
  const client = new ShopifyClient(store);

  const skuListsDir = path.join(__dirname, "..", "..", "sku-lists");
  const listPath = path.join(skuListsDir, `${store.toLowerCase()}-skus.txt`);
  const outPath = path.join(skuListsDir, `${store.toLowerCase()}-skus.json`);

  const rawSkus = fs
    .readFileSync(listPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const skus = [...new Set(rawSkus)];
  if (skus.length !== rawSkus.length) {
    console.warn(`Note: ${rawSkus.length - skus.length} duplicate SKU(s) in ${listPath} were deduplicated.`);
  }

  console.log(`Resolving ${skus.length} SKUs for ${store}...`);

  const found = new Map(); // sku -> variant node
  const batches = chunk(skus, BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const nodes = await queryBatch(client, batch);
    for (const node of nodes) {
      found.set(node.sku, node);
    }
    console.log(`  batch ${index + 1}/${batches.length}: ${nodes.length}/${batch.length} resolved`);
    if (index < batches.length - 1) {
      await sleep(500); // stay well clear of the Admin API's cost-based rate limit
    }
  }

  const results = [];
  const missing = [];
  for (const sku of skus) {
    const node = found.get(sku);
    if (!node) {
      missing.push(sku);
      continue;
    }
    results.push({ sku: node.sku, gid: node.id, title: `${node.product.title} - ${node.title}`, price: node.price });
  }

  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Wrote ${results.length} entries to ${outPath}`);
  if (missing.length > 0) {
    console.warn(`WARNING: ${missing.length} SKU(s) not found in ${store} staging:\n  ${missing.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
