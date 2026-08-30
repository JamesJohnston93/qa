#!/usr/bin/env node
/**
 * TAA-52 — hand-run live probe: reads already-burned orders via the real
 * DynamoReader and runs the new verify/holds.ts, verify/finalisation.ts,
 * verify/transactions.ts and verify/orders.ts (additions) assertions
 * against them on both stores. Asserts nothing new itself — a thin harness
 * around functions already offline-tested; this just proves they also work
 * against a live DynamoDB read, and that a deliberately broken expectation
 * fails with a clear expected-vs-actual. Not wired into cli.ts/index.ts.
 * Throwaway, same posture as probe-admin-mutations.js.
 *
 * Usage: node scripts/probe-taa52-verify.js <action> --store <US|PS> [flags]
 * Actions:
 *   dump --tail <id>                 print ORDER/ADDRESS/ITEM/TRANSACTION rows
 *   resolve --order <#name>          resolve an order name to its id tail
 *   verify-good --tail <id> --hold <REASON>   known-good pass: hold + payments + addresses
 *   verify-good --tail <id>          known-good pass: not-on-hold + payments + addresses
 *   verify-broken --tail <id> --hold <REASON>   deliberately wrong hold assertion, expect throw
 */

const { ShopifyClient } = require("../dist/clients/shopify.js");
const { DynamoClient } = require("../dist/clients/dynamo.js");
const { DynamoReader } = require("../dist/readers/dynamoReader.js");
const { defaultConfig } = require("../dist/config.js");
const { assertOnHold, assertNotOnHold, POTENTIAL_FRAUD, OUTSTANDING_PAYMENT } = require("../dist/verify/holds.js");
const { assertPaymentsSumToGrandTotal, assertBothAddressesPresent, assertItemDelivery } = require("../dist/verify/orders.js");
const { assertTransactionPresent, assertTransactionOrder } = require("../dist/verify/transactions.js");
const { assertOrderStatus, assertNotFinalised, assertFinalisedExactlyOnce, FULFILLED } = require("../dist/verify/finalisation.js");

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    }
  }
  return flags;
}

function buildContext(store) {
  const config = defaultConfig();
  config.store = store;
  const shopify = new ShopifyClient(store);
  const dynamoClient = new DynamoClient(config);
  const reader = new DynamoReader(dynamoClient, config);
  return { config, shopify, dynamoClient, reader };
}

async function resolveTail(shopify, orderArg) {
  if (/^\d+$/.test(orderArg) && orderArg.length >= 8) {
    return orderArg;
  }
  const name = orderArg.startsWith("#") ? orderArg : `#${orderArg}`;
  const tail = await shopify.findOrderIdTailByName(name);
  if (!tail) {
    throw new Error(`No Shopify order found with name "${name}"`);
  }
  return tail;
}

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const store = flags.store || "US";
  const { shopify, reader } = buildContext(store);

  if (action === "resolve") {
    const tail = await resolveTail(shopify, flags.order);
    console.log(`${flags.order} -> tail ${tail}`);
    return;
  }

  const tail = flags.tail ? await resolveTail(shopify, flags.tail) : null;

  if (action === "dump") {
    const record = await reader.getOrderRecord(store, tail);
    const addresses = await reader.getAddressRows(store, tail);
    const items = await reader.getOrderItemRows(store, tail);
    const transactions = await reader.getOrderTransactions(store, tail);
    console.log(JSON.stringify({ record, addresses, items, transactions }, null, 2));
    return;
  }

  if (action === "verify-good") {
    const record = await reader.getOrderRecord(store, tail);
    const addresses = await reader.getAddressRows(store, tail);
    const items = await reader.getOrderItemRows(store, tail);
    const transactions = await reader.getOrderTransactions(store, tail);
    const orderName = `#${flags.tail}`;

    if (flags.hold) {
      assertOnHold(record, [flags.hold], orderName);
      console.log(`PASS assertOnHold([${flags.hold}])`);
    } else {
      assertNotOnHold(record, orderName);
      console.log("PASS assertNotOnHold");
    }
    if (flags.hold === OUTSTANDING_PAYMENT) {
      // Genuinely under-paid by design — see verify/orders.ts's doc comment.
      console.log("SKIP assertPaymentsSumToGrandTotal (order is held for OUTSTANDING_PAYMENT — expected to be under-paid)");
    } else {
      assertPaymentsSumToGrandTotal(record, orderName);
      console.log("PASS assertPaymentsSumToGrandTotal");
    }
    assertBothAddressesPresent(addresses, orderName);
    console.log("PASS assertBothAddressesPresent");
    for (const item of items) {
      assertItemDelivery(item, item.deliveryMethod, item.clickCollectStore, orderName);
    }
    console.log(`PASS assertItemDelivery x${items.length}`);
    assertOrderStatus(record, record.status, orderName);
    console.log(`PASS assertOrderStatus (${record.status})`);
    if (record.status === FULFILLED) {
      assertFinalisedExactlyOnce(record, orderName);
      console.log("PASS assertFinalisedExactlyOnce");
    } else {
      assertNotFinalised(record, orderName);
      console.log("PASS assertNotFinalised");
    }
    assertTransactionPresent(transactions, "CREATE_ORDER", orderName);
    console.log("PASS assertTransactionPresent(CREATE_ORDER)");
    assertTransactionOrder(transactions, ["CREATE_ORDER"], orderName);
    console.log("PASS assertTransactionOrder([CREATE_ORDER])");
    console.log(`ALL PASS for ${store} ${orderName} (tail ${tail})`);
    return;
  }

  if (action === "verify-broken") {
    const record = await reader.getOrderRecord(store, tail);
    const transactions = await reader.getOrderTransactions(store, tail);
    const orderName = `#${flags.tail}`;
    const check = flags.check || "hold";

    const attempt = () => {
      if (check === "hold") {
        const wrongReason = flags.hold === POTENTIAL_FRAUD ? OUTSTANDING_PAYMENT : POTENTIAL_FRAUD;
        assertOnHold(record, [wrongReason], orderName);
      } else if (check === "transaction") {
        assertTransactionPresent(transactions, "CLOSE_ORDER", orderName);
      } else if (check === "transaction-order") {
        assertTransactionOrder(transactions, ["HOLD_ORDER", "CREATE_ORDER"], orderName);
      } else if (check === "status") {
        assertOrderStatus(record, record.status === FULFILLED ? "OPEN" : FULFILLED, orderName);
      } else if (check === "payments") {
        assertPaymentsSumToGrandTotal({ ...record, grandTotal: record.grandTotal + 1 }, orderName);
      } else if (check === "finalised") {
        assertFinalisedExactlyOnce({ ...record, status: "OPEN" }, orderName);
      } else {
        throw new Error(`Unknown --check "${check}"`);
      }
    };

    try {
      attempt();
      console.log("UNEXPECTED PASS — this should have thrown");
      process.exitCode = 1;
    } catch (err) {
      console.log(`EXPECTED THROW: ${err.name}`);
      console.log(`  check:    ${err.check}`);
      console.log(`  expected: ${JSON.stringify(err.expected)}`);
      console.log(`  actual:   ${JSON.stringify(err.actual)}`);
      console.log(`  detail:   ${err.detail}`);
    }
    return;
  }

  console.error(`Unknown action "${action}". See file header for usage.`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
