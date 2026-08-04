#!/usr/bin/env node
/**
 * Resolves a plain-text list of SKUs (one per line) to their Shopify
 * ProductVariant GID + title + price via the Admin GraphQL API — turns
 * sku-lists/<store>-skus.txt into sku-lists/<store>-skus.json for TAA-14
 * Phase B's staging SKU pool.
 *
 * Standalone dev script — not part of the harness build (tsconfig only
 * includes src/**\/*.ts). Requires US_ACCESS_TOKEN/PS_ACCESS_TOKEN in the
 * environment, same as the harness itself. Read-only (GraphQL query only,
 * no mutations) — safe to re-run any time the SKU list changes.
 *
 * Usage: node fetch-sku-gids.js <US|PS>
 */

const fs = require("fs");
const path = require("path");

const STORE_CONFIG = {
  US: { domain: "universal-store-staging.myshopify.com", tokenEnv: "US_ACCESS_TOKEN" },
  PS: { domain: "perfect-stranger-staging.myshopify.com", tokenEnv: "PS_ACCESS_TOKEN" },
};

const BATCH_SIZE = 50;
const API_VERSION = "2025-10";

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

async function queryBatch(domain, token, skus) {
  const searchQuery = skus.map((sku) => `sku:${sku}`).join(" OR ");
  const body = JSON.stringify({
    query: `
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
    variables: { searchQuery },
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body,
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "2");
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Shopify request failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    if (json.errors) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    // Defensive: only keep nodes whose sku was actually in this batch —
    // Shopify's search query can match more loosely than an exact sku:
    // lookup implies, and silently trusting every returned node risks
    // mislabelling an unrelated variant as one of ours.
    return json.data.productVariants.edges.map((edge) => edge.node).filter((node) => skus.includes(node.sku));
  }
  throw new Error("Shopify request failed after 3 retries (rate limited)");
}

async function main() {
  const store = process.argv[2];
  if (!STORE_CONFIG[store]) {
    console.error("Usage: node fetch-sku-gids.js <US|PS>");
    process.exit(1);
  }
  const { domain, tokenEnv } = STORE_CONFIG[store];
  const token = process.env[tokenEnv];
  if (!token) {
    console.error(`Missing ${tokenEnv} environment variable`);
    process.exit(1);
  }

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
    const nodes = await queryBatch(domain, token, batch);
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
