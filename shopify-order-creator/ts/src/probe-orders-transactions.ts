/**
 * TAA-48 slice A — read-only capture of staging-orders-v2 TRANSACTION# rows
 * for already-burned orders, dumped to committed JSON fixtures.
 *
 * ONE-SHOT RESEARCH TOOL, same posture as probe-reject.ts: not wired into
 * index.ts/cli.ts, not in --help, no verify/ module, no cases/, no
 * regression wiring. Its whole job is to settle event-name spelling and the
 * category-vs-type field question EMPIRICALLY, from real staging rows,
 * before any parsing code is written against a guess.
 *
 * BURN NO NEW ORDERS — every order this probe reads is already burned
 * (placed by an earlier slice/session for other purposes). See
 * ts/signoffs/TAA-48-slice-a.md for the full drift table and which paths
 * this covered vs. an explicit recorded gap.
 *
 * Usage:
 *   node dist/probe-orders-transactions.js --store US --orders 9929,9932,9935 --label fulfil
 *     -> resolves each order name to its id tail, queries staging-orders-v2
 *        via origin_index, writes the full row set (not just TRANSACTION#
 *        rows -- ORDER/ITEM# rows give context for idempotencyId/category
 *        correlation) to fixtures/orders-v2/<store>-<label>-<order>.json,
 *        and prints every TRANSACTION# row's raw shape to stdout for
 *        manual/drift-table inspection.
 */

import * as fs from "fs";
import * as path from "path";
import { defaultConfig, type Store } from "./config";
import { DynamoClient } from "./clients/dynamo";
import { DynamoReader } from "./readers/dynamoReader";
import { ShopifyClient } from "./clients/shopify";
import { resolveOrderIdTail } from "./flows/fulfilFlow";

interface ProbeArgs {
  store: Store;
  orders: string[];
  label: string;
}

function parseArgs(argv: string[]): ProbeArgs {
  const args: ProbeArgs = { store: "US", orders: [], label: "capture" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--store" && argv[i + 1]) {
      const value = argv[i + 1];
      if (value !== "US" && value !== "PS") {
        throw new Error(`--store must be US or PS, got "${value}"`);
      }
      args.store = value;
      i += 1;
    } else if (arg === "--orders" && argv[i + 1]) {
      args.orders = argv[i + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === "--label" && argv[i + 1]) {
      args.label = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown argument: "${arg}"`);
    }
  }
  if (args.orders.length === 0) {
    throw new Error("--orders is required (e.g. --orders 9929,9932,9935)");
  }
  return args;
}

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "orders-v2");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const regressionConfig = defaultConfig();
  regressionConfig.store = args.store;

  const shopify = new ShopifyClient(args.store);
  const dynamoClient = new DynamoClient(regressionConfig);
  const reader = new DynamoReader(dynamoClient, regressionConfig);

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  for (const orderNumber of args.orders) {
    console.log(`\n=== order #${orderNumber} (${args.store}) ===`);
    const idTail = await resolveOrderIdTail(shopify, orderNumber);
    console.log(`  id tail: ${idTail}`);

    const rows = await reader.getOrderRows(args.store, idTail);
    console.log(`  ${rows.length} staging-orders-v2 row(s) total`);

    const transactionRows = rows.filter((row) => String(row.SK ?? "").startsWith("TRANSACTION#"));
    console.log(`  ${transactionRows.length} TRANSACTION# row(s):`);
    for (const row of transactionRows) {
      console.log(`    ${JSON.stringify(row)}`);
    }

    const outFile = path.join(FIXTURE_DIR, `${args.store}-${args.label}-${orderNumber}.json`);
    fs.writeFileSync(outFile, JSON.stringify(rows, null, 2) + "\n");
    console.log(`  written -> ${path.relative(process.cwd(), outFile)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
