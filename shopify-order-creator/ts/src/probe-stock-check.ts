/**
 * TAA-31 slice D prep — one-shot, READ-ONLY stock-health check.
 *
 * Not wired into index.ts/cli.ts, not in --help. Answers a question slice
 * C's sign-off raised but didn't confirm: does repeated live reject/
 * reallocation on the same SKU actually decrement real per-store stock
 * (attrition), or was order #9952's all-UNDELIVERABLE outcome coincidence?
 * `DynamoClient.getAllLocationsForSku` is read-only — no writes here.
 *
 * Usage: node dist/probe-stock-check.js <sku>
 */
import { defaultConfig } from "./config";
import { DynamoClient } from "./clients/dynamo";

async function main(): Promise<void> {
  const sku = process.argv[2];
  if (!sku) {
    throw new Error("usage: node dist/probe-stock-check.js <sku>");
  }
  const dynamo = new DynamoClient(defaultConfig());
  const locations = await dynamo.getAllLocationsForSku(sku);
  const nonzero = locations.filter((l) => l.quantity > 0);

  console.log(`SKU ${sku}: ${locations.length} location row(s) total, ${nonzero.length} with nonzero stock`);
  console.log("\nNonzero locations:");
  for (const loc of nonzero.sort((a, b) => Number(a.store) - Number(b.store))) {
    console.log(`  store ${loc.store}: qty ${loc.quantity}`);
  }

  // Stores this SKU landed on across today's slice A/B/C live trials — the
  // shipments table's allocatedStore is a bare number, but staging-inventory-v2
  // keys carry a network prefix (ATP#/ABS#/etc, confirmed by this run's dump),
  // so match on the numeric suffix, not an exact string.
  const observed = ["100", "412", "419", "371", "406", "218", "223", "302", "304", "404", "407"];
  console.log("\nStores observed landing this SKU today (slices A-C), matched by numeric suffix:");
  for (const store of observed) {
    const matches = locations.filter((l) => l.store.split("#").pop() === store);
    if (matches.length === 0) {
      console.log(`  store ${store}: (no row under any prefix)`);
    } else {
      for (const m of matches) {
        console.log(`  store ${store} (${m.store}): qty ${m.quantity}`);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
