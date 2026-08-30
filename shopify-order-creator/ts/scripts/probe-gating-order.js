#!/usr/bin/env node
/**
 * TAA-46 slice B — one live order attempted on a deliberately non-compliant
 * SKU, to settle whether channel publication gates Admin-API order creation
 * or only storefront visibility.
 *
 * Standalone dev script, same shape as fetch-sku-gids.js/dump-availability.js:
 * not part of the harness build, reuses the compiled ShopifyClient/config
 * rather than re-porting auth. Not wired into cli-order.ts's `order`
 * subcommand deliberately — that command validates SKUs against the pool
 * (US_VARIANTS/PS_VARIANTS) before it will build a line item, and the whole
 * point of this slice is to order a SKU that is NOT in the pool. Calls
 * ShopifyClient.createDraftOrder directly with a GID read from
 * sku-lists/us-skus.json instead, per the plan's "no code changes at all"
 * instruction for this slice.
 *
 * SKU 33860138, chosen in slice A's sign-off: DRAFT, unpublished on every
 * publication, real stock of 5 (so a failure can't be blamed on being out of
 * stock). US only, per the plan's preference (simpler static token).
 *
 * Usage: node probe-gating-order.js
 */

const { ShopifyClient } = require("../dist/clients/shopify.js");
const { defaultConfig, customerFor } = require("../dist/config.js");

const CANDIDATE_SKU = "33860138";
const CANDIDATE_GID = "gid://shopify/ProductVariant/51754459463953";

async function main() {
  const config = defaultConfig();
  config.store = "US";
  const customer = customerFor(config);
  const shopify = new ShopifyClient("US");

  console.log(`Attempting order: SKU ${CANDIDATE_SKU} (${CANDIDATE_GID}) x1, store US`);
  try {
    const result = await shopify.createDraftOrder(
      customer.email,
      [{ variantId: CANDIDATE_GID, quantity: 1 }],
      customer.firstName,
      customer.lastName,
    );
    console.log("RESULT: SUCCESS");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log("RESULT: FAILURE");
    console.log(err instanceof Error ? err.message : String(err));
    process.exitCode = 0; // a failure here is a valid, expected experimental outcome, not a script bug
  }
}

main();
