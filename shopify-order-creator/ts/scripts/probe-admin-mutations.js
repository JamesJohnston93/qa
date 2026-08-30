#!/usr/bin/env node
/**
 * TAA-53 — hand-driven probe for six Shopify Admin GraphQL contracts this
 * harness does not yet drive: the order-edit chain, refundCreate, the
 * fulfillment-order hold/release/move mutations, returnCreate/returnClose,
 * and orderMarkAsPaid. Asserts nothing. Not wired into cli.ts/index.ts/
 * --help. See ts/signoffs/TAA-53-probe.md for findings.
 *
 * Exact mutation/input/payload shapes below were confirmed live via Admin
 * GraphQL introspection against API 2025-10 before writing any mutation
 * call (not guessed from docs, which the ticket flags as unreliable for
 * this exact class of question) — see the sign-off for the introspection
 * transcript.
 *
 * Reuses ShopifyClient (auth/throttle-retry/API-version), DynamoReader's
 * existing getOrderRows/orderPkFromRows (order PK resolution, not new
 * reader code), and DynamoClient's public .doc for a raw TRANSACTION# row
 * dump on staging-orders-v2 — the same "read raw, don't build a reader"
 * pattern probe-reject.ts used for staging-shipments (TAA-48 owns the real
 * orders-v2 transaction reader).
 *
 * Usage: node probe-admin-mutations.js <action> --store <US|PS> [flags]
 * Actions: scopes, create, dump, edit, refund, refund-idempotency, hold,
 *          release-hold, move, fulfil-for-return, return-flow, mark-paid,
 *          dump-tx
 * Run `node probe-admin-mutations.js help` for per-action flags.
 */

const { ShopifyClient } = require("../dist/clients/shopify.js");
const { DynamoClient } = require("../dist/clients/dynamo.js");
const { DynamoReader, orderPkFromRows } = require("../dist/readers/dynamoReader.js");
const { orderIdTail } = require("../dist/readers/shopifyReader.js");
const { defaultConfig, customerFor } = require("../dist/config.js");
const { variantsFor } = require("../dist/variants.js");
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");

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

function orderGid(tail) {
  return `gid://shopify/Order/${tail}`;
}

async function execOrThrow(shopify, label, query, variables) {
  const result = await shopify.execute(query, variables);
  if (result.errors && result.errors.length > 0) {
    throw new Error(`${label} GraphQL errors: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}

/** Resolves an order name ("#9999" or "9999") to its numeric id tail via ShopifyClient.findOrderIdTailByName (reused). */
async function resolveTail(shopify, orderArg) {
  if (/^\d+$/.test(orderArg) && orderArg.length >= 8) {
    return orderArg; // already a numeric tail
  }
  const name = orderArg.startsWith("#") ? orderArg : `#${orderArg}`;
  const tail = await shopify.findOrderIdTailByName(name);
  if (!tail) {
    throw new Error(`No Shopify order found with name "${name}"`);
  }
  return tail;
}

const ORDER_DUMP_QUERY = `
  query DumpOrder($id: ID!) {
    order(id: $id) {
      id
      name
      displayFinancialStatus
      edited
      returnStatus
      merchantEditable
      merchantEditableErrors
      lineItems(first: 20) {
        edges { node { id sku name quantity refundableQuantity unfulfilledQuantity } }
      }
      fulfillmentOrders(first: 10) {
        edges {
          node {
            id
            status
            assignedLocation { location { id name } }
            fulfillmentHolds { id reason reasonNotes handle }
            lineItems(first: 20) { edges { node { id remainingQuantity totalQuantity lineItem { sku } } } }
          }
        }
      }
      fulfillments(first: 10) {
        id
        status
        fulfillmentLineItems(first: 20) { edges { node { id quantity lineItem { sku } } } }
      }
      transactions {
        id
        kind
        status
        gateway
        parentTransaction { id }
        amountSet { shopMoney { amount currencyCode } }
      }
      returns(first: 10) {
        edges { node { id name status } }
      }
    }
  }
`;

async function dumpOrder(shopify, tail, label) {
  const data = await execOrThrow(shopify, "order dump", ORDER_DUMP_QUERY, { id: orderGid(tail) });
  console.log(`\n--- ORDER DUMP (${label}) ---`);
  console.log(JSON.stringify(data.order, null, 2));
  return data.order;
}

/** Raw TRANSACTION# row dump on staging-orders-v2 — deliberately not a reader, see file header. */
async function dumpTransactionRows(dynamoClient, table, pk, label) {
  const result = await dynamoClient.doc.send(
    new QueryCommand({ TableName: table, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": pk } }),
  );
  const rows = (result.Items ?? []).filter((row) => String(row.SK ?? "").startsWith("TRANSACTION#"));
  console.log(`\n--- TRANSACTION# rows on ${table} (${label}), ${rows.length} row(s) ---`);
  for (const row of rows) {
    console.log(`  ${row.SK}: ${JSON.stringify(row)}`);
  }
  return rows;
}

async function resolveOrderPk(reader, store, tail) {
  const rows = await reader.getOrderRows(store, tail);
  const pk = orderPkFromRows(rows);
  if (!pk) {
    throw new Error(`Order ${tail} has no staging-orders-v2 rows yet (origin_index not landed)`);
  }
  return pk;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function actionScopes(flags) {
  const { shopify } = buildContext(flags.store);
  const data = await execOrThrow(
    shopify,
    "scopes",
    `query { currentAppInstallation { app { title } accessScopes { handle } } }`,
    {},
  );
  const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle).sort();
  console.log(`App: ${data.currentAppInstallation.app.title} (${flags.store})`);
  console.log(`Scopes (${scopes.length}): ${scopes.join(", ")}`);
  for (const wanted of ["write_order_edits", "write_returns", "write_orders", "write_fulfillments", "write_merchant_managed_fulfillment_orders"]) {
    console.log(`  ${wanted}: ${scopes.includes(wanted) ? "PRESENT" : "MISSING"}`);
  }
}

async function actionCreate(flags) {
  const { config, shopify } = buildContext(flags.store);
  const customer = customerFor(config);
  const variants = variantsFor(flags.store);
  const items = flags.items.split(",").map((pair) => {
    const [sku, qtyStr] = pair.split("x");
    const gid = variants[sku];
    if (!gid) throw new Error(`SKU "${sku}" not in ${flags.store} variant pool`);
    return { variantId: gid, quantity: Number(qtyStr) };
  });
  const t0 = Date.now();
  const result = await shopify.createDraftOrder(customer.email, items, customer.firstName, customer.lastName);
  console.log(`Created order ${result.orderName} (${result.orderId}) in ${(Date.now() - t0) / 1000}s`);
  console.log(JSON.stringify(result, null, 2));
  await dumpOrder(shopify, orderIdTail(result.orderId), "immediately after create");
}

const DRAFT_ORDER_CREATE_UNPAID = `
  mutation CreateUnpaidDraft($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;
const DRAFT_ORDER_COMPLETE_RAW = `
  mutation CompleteDraft($id: ID!) {
    draftOrderComplete(id: $id) {
      draftOrder { createdAt order { id name } }
      userErrors { field message }
    }
  }
`;
/** NET 30 payment-terms template — leaves the completed order genuinely unpaid (no paymentPending arg exists on draftOrderComplete in this API version). */
const NET_30_TEMPLATE_ID = "gid://shopify/PaymentTermsTemplate/4";

async function actionCreateUnpaid(flags) {
  const { config, shopify } = buildContext(flags.store);
  const customer = customerFor(config);
  const variants = variantsFor(flags.store);
  const items = flags.items.split(",").map((pair) => {
    const [sku, qtyStr] = pair.split("x");
    const gid = variants[sku];
    if (!gid) throw new Error(`SKU "${sku}" not in ${flags.store} variant pool`);
    return { variantId: gid, quantity: Number(qtyStr) };
  });
  const input = {
    note: "TAA-53 probe — unpaid draft (payment-priming sequence)",
    email: customer.email,
    taxExempt: false,
    tags: ["foo", "bar"],
    billingAddress: {
      firstName: customer.firstName,
      lastName: customer.lastName,
      address1: "42 William Farrior Place",
      city: "Eagle Farm",
      zip: "4009",
      province: "Queensland",
      provinceCode: "QLD",
      country: "Australia",
      countryCode: "AU",
      phone: "0414 697 063",
    },
    shippingAddress: {
      firstName: customer.firstName,
      lastName: customer.lastName,
      address1: "42 William Farrior Place",
      city: "Eagle Farm",
      zip: "4009",
      province: "Queensland",
      provinceCode: "QLD",
      country: "Australia",
      countryCode: "AU",
      phone: "0414 697 063",
    },
    lineItems: items,
    paymentTerms: { paymentTermsTemplateId: NET_30_TEMPLATE_ID },
  };

  const t0 = Date.now();
  const created = await execOrThrow(shopify, "draftOrderCreate(unpaid)", DRAFT_ORDER_CREATE_UNPAID, { input });
  const draftOrderId = created.draftOrderCreate.draftOrder?.id;
  if (!draftOrderId) throw new Error(`draftOrderCreate returned no draft order: ${JSON.stringify(created)}`);
  const completed = await execOrThrow(shopify, "draftOrderComplete(unpaid)", DRAFT_ORDER_COMPLETE_RAW, { id: draftOrderId });
  console.log(`Created unpaid-terms order in ${(Date.now() - t0) / 1000}s`);
  console.log(JSON.stringify(completed.draftOrderComplete, null, 2));
  const orderId = completed.draftOrderComplete.draftOrder?.order?.id;
  if (orderId) {
    await dumpOrder(shopify, orderIdTail(orderId), "immediately after unpaid create");
  }
}

const ORDER_CREATE_PENDING = `
  mutation CreatePendingOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

/**
 * `orderCreate` (financialStatus: PENDING, no transactions) — a distinct
 * Admin API order-creation path from draftOrderCreate/Complete (which
 * always lands PAID in this shop, confirmed above; draftOrderComplete has
 * no paymentPending arg in this API version, and DraftOrderInput.paymentTerms
 * is blocked by a missing scope, see the sign-off). Used here ONLY to get a
 * genuinely-unpaid scratch order to test orderMarkAsPaid against — NOT a
 * replacement for the harness's normal order-placement path.
 */
async function actionCreatePending(flags) {
  const { config, shopify } = buildContext(flags.store);
  const customer = customerFor(config);
  const variants = variantsFor(flags.store);
  const items = flags.items.split(",").map((pair) => {
    const [sku, qtyStr] = pair.split("x");
    const gid = variants[sku];
    if (!gid) throw new Error(`SKU "${sku}" not in ${flags.store} variant pool`);
    return { variantId: gid, quantity: Number(qtyStr), sku };
  });
  const address = {
    firstName: customer.firstName,
    lastName: customer.lastName,
    address1: "42 William Farrior Place",
    city: "Eagle Farm",
    zip: "4009",
    province: "Queensland",
    provinceCode: "QLD",
    country: "Australia",
    countryCode: "AU",
    phone: "0414 697 063",
  };
  const order = {
    email: customer.email,
    financialStatus: "PENDING",
    lineItems: items,
    billingAddress: address,
    shippingAddress: address,
    note: "TAA-53 probe — orderCreate(financialStatus: PENDING) for markAsPaid contract",
    tags: ["foo", "bar"],
  };

  const t0 = Date.now();
  const data = await execOrThrow(shopify, "orderCreate", ORDER_CREATE_PENDING, {
    order,
    options: { sendReceipt: false, sendFulfillmentReceipt: false },
  });
  console.log(`orderCreate(PENDING) result, ${(Date.now() - t0) / 1000}s:`);
  console.log(JSON.stringify(data.orderCreate, null, 2));
  const orderId = data.orderCreate.order?.id;
  if (orderId) {
    await dumpOrder(shopify, orderIdTail(orderId), "immediately after pending create");
  }
}

async function actionDump(flags) {
  const { shopify } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  await dumpOrder(shopify, tail, "dump");
}

const EDIT_BEGIN = `
  mutation Begin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder { id lineItems(first: 20) { edges { node { id quantity variant { sku } } } } }
      userErrors { field message }
    }
  }
`;
const EDIT_ADD_VARIANT = `
  mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
      calculatedLineItem { id quantity }
      calculatedOrder { id }
      userErrors { field message }
    }
  }
`;
const EDIT_SET_QUANTITY = `
  mutation SetQty($id: ID!, $lineItemId: ID!, $quantity: Int!) {
    orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
      calculatedLineItem { id quantity editableQuantity }
      calculatedOrder { id }
      userErrors { field message }
    }
  }
`;
const EDIT_ADD_DISCOUNT = `
  mutation AddDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
      calculatedLineItem { id }
      calculatedOrder { id }
      userErrors { field message }
    }
  }
`;
const EDIT_COMMIT = `
  mutation Commit($id: ID!, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
      order { id name edited }
      successMessages
      userErrors { field message }
    }
  }
`;

async function actionEdit(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const variants = variantsFor(flags.store);
  const addGid = variants[flags["add-sku"]];
  if (!addGid) throw new Error(`SKU "${flags["add-sku"]}" not in ${flags.store} variant pool`);
  const addQty = Number(flags["add-qty"] ?? "1");

  const timings = {};
  const t0 = Date.now();

  console.log("\n[1/5] orderEditBegin...");
  const begin = await execOrThrow(shopify, "orderEditBegin", EDIT_BEGIN, { id: orderGid(tail) });
  timings.begin = (Date.now() - t0) / 1000;
  console.log(JSON.stringify(begin.orderEditBegin, null, 2));
  const calcId = begin.orderEditBegin.calculatedOrder.id;
  const existingLineItem = begin.orderEditBegin.calculatedOrder.lineItems.edges[0]?.node;

  console.log("\n[2/5] orderEditAddVariant...");
  const t1 = Date.now();
  const addVariant = await execOrThrow(shopify, "orderEditAddVariant", EDIT_ADD_VARIANT, {
    id: calcId,
    variantId: addGid,
    quantity: addQty,
  });
  timings.addVariant = (Date.now() - t1) / 1000;
  console.log(JSON.stringify(addVariant.orderEditAddVariant, null, 2));
  const newLineItemId = addVariant.orderEditAddVariant.calculatedLineItem.id;

  if (existingLineItem) {
    console.log("\n[3/5] orderEditSetQuantity (existing line item -> 1)...");
    const t2 = Date.now();
    const setQty = await execOrThrow(shopify, "orderEditSetQuantity", EDIT_SET_QUANTITY, {
      id: calcId,
      lineItemId: existingLineItem.id,
      quantity: 1,
    });
    timings.setQuantity = (Date.now() - t2) / 1000;
    console.log(JSON.stringify(setQty.orderEditSetQuantity, null, 2));
  } else {
    console.log("\n[3/5] skipped — no existing calculated line item found");
  }

  console.log("\n[4/5] orderEditAddLineItemDiscount (on the newly added line item, fixed $1 off)...");
  const t3 = Date.now();
  const discount = await execOrThrow(shopify, "orderEditAddLineItemDiscount", EDIT_ADD_DISCOUNT, {
    id: calcId,
    lineItemId: newLineItemId,
    discount: { description: "TAA-53 probe discount", fixedValue: { amount: "1.00", currencyCode: "AUD" } },
  });
  timings.addDiscount = (Date.now() - t3) / 1000;
  console.log(JSON.stringify(discount.orderEditAddLineItemDiscount, null, 2));

  console.log("\n[5/5] orderEditCommit...");
  const t4 = Date.now();
  const commit = await execOrThrow(shopify, "orderEditCommit", EDIT_COMMIT, {
    id: calcId,
    staffNote: "TAA-53 probe — admin mutation contract check",
  });
  timings.commit = (Date.now() - t4) / 1000;
  console.log(JSON.stringify(commit.orderEditCommit, null, 2));
  timings.totalToCommit = (Date.now() - t0) / 1000;
  console.log(`\nTimings (s): ${JSON.stringify(timings, null, 2)}`);

  await dumpOrder(shopify, tail, "after edit commit");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

const REFUND_CREATE = `
  mutation CreateRefund($input: RefundInput!) {
    refundCreate(input: $input) {
      order { id }
      refund { id note totalRefundedSet { shopMoney { amount currencyCode } } }
      userErrors { field message }
    }
  }
`;

async function actionRefund(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before refund");

  let input;
  if (flags.mode === "targeted") {
    const lineItem = order.lineItems.edges.map((e) => e.node).find((li) => li.sku === flags["line-item-sku"]);
    if (!lineItem) throw new Error(`No line item with sku ${flags["line-item-sku"]} on order ${tail}`);
    input = {
      orderId: orderGid(tail),
      note: "TAA-53 probe — targeted refund",
      notify: false,
      refundLineItems: [{ lineItemId: lineItem.id, quantity: Number(flags.qty ?? "1"), restockType: "NO_RESTOCK" }],
    };
  } else if (flags.mode === "untargeted") {
    const saleTx = order.transactions.find((tx) => tx.kind === "SALE");
    if (!saleTx) throw new Error(`No SALE transaction found on order ${tail}`);
    input = {
      orderId: orderGid(tail),
      note: "TAA-53 probe — untargeted/appeasement refund",
      notify: false,
      transactions: [
        {
          orderId: orderGid(tail),
          amount: flags.amount ?? "1.00",
          gateway: saleTx.gateway,
          kind: "REFUND",
          parentId: saleTx.id,
        },
      ],
    };
  } else {
    throw new Error('--mode must be "targeted" or "untargeted"');
  }

  const t0 = Date.now();
  const data = await execOrThrow(shopify, "refundCreate", REFUND_CREATE, { input });
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\nrefundCreate (${flags.mode}) result, ${elapsed}s:`);
  console.log(JSON.stringify(data.refundCreate, null, 2));

  await dumpOrder(shopify, tail, "after refund");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

/** Fires the identical targeted-refund mutation twice with the same Idempotency-Key header (raw fetch, US only, static token). */
async function actionRefundIdempotency(flags) {
  if (flags.store !== "US") throw new Error("refund-idempotency is US-only in this probe (static token, simpler auth path)");
  const { shopify } = buildContext("US");
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before idempotency test");
  const lineItem = order.lineItems.edges.map((e) => e.node).find((li) => li.sku === flags["line-item-sku"]);
  if (!lineItem) throw new Error(`No line item with sku ${flags["line-item-sku"]} on order ${tail}`);

  const input = {
    orderId: orderGid(tail),
    note: "TAA-53 probe — idempotency-key double-fire",
    notify: false,
    refundLineItems: [{ lineItemId: lineItem.id, quantity: Number(flags.qty ?? "1"), restockType: "NO_RESTOCK" }],
  };
  const key = flags.key ?? `taa-53-${Date.now()}`;
  console.log(`Using Idempotency-Key: ${key}`);

  const token = process.env.US_ACCESS_TOKEN;
  if (!token) throw new Error("Missing US_ACCESS_TOKEN");
  const endpoint = "https://universal-store-staging.myshopify.com/admin/api/2025-10/graphql.json";

  async function fireOnce(label) {
    const t0 = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ query: REFUND_CREATE, variables: { input } }),
    });
    const body = await response.json();
    console.log(`\n${label} (${(Date.now() - t0) / 1000}s, HTTP ${response.status}):`);
    console.log(JSON.stringify(body, null, 2));
    return body;
  }

  await fireOnce("Call #1");
  await fireOnce("Call #2 (same Idempotency-Key)");

  await dumpOrder(shopify, tail, "after both calls");
}

const HOLD_MUTATION = `
  mutation Hold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
    fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
      fulfillmentHold { id reason reasonNotes }
      fulfillmentOrder { id status fulfillmentHolds { id reason } }
      userErrors { field message code }
    }
  }
`;

async function actionHold(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before hold");
  const foId = order.fulfillmentOrders.edges[0]?.node.id;
  if (!foId) throw new Error(`Order ${tail} has no fulfillment orders`);

  const t0 = Date.now();
  const data = await execOrThrow(shopify, "fulfillmentOrderHold", HOLD_MUTATION, {
    id: foId,
    fulfillmentHold: { reason: flags.reason ?? "OTHER", reasonNotes: flags.notes ?? "TAA-53 probe hold", notifyMerchant: false },
  });
  console.log(`\nfulfillmentOrderHold result, ${(Date.now() - t0) / 1000}s:`);
  console.log(JSON.stringify(data.fulfillmentOrderHold, null, 2));

  await dumpOrder(shopify, tail, "after hold");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

const RELEASE_HOLD_MUTATION = `
  mutation ReleaseHold($id: ID!) {
    fulfillmentOrderReleaseHold(id: $id) {
      fulfillmentOrder { id status fulfillmentHolds { id reason } }
      userErrors { field message code }
    }
  }
`;

async function actionReleaseHold(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before release");
  const foId = order.fulfillmentOrders.edges[0]?.node.id;
  if (!foId) throw new Error(`Order ${tail} has no fulfillment orders`);

  const t0 = Date.now();
  const data = await execOrThrow(shopify, "fulfillmentOrderReleaseHold", RELEASE_HOLD_MUTATION, { id: foId });
  console.log(`\nfulfillmentOrderReleaseHold result, ${(Date.now() - t0) / 1000}s:`);
  console.log(JSON.stringify(data.fulfillmentOrderReleaseHold, null, 2));

  await dumpOrder(shopify, tail, "after release");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

const MOVE_MUTATION = `
  mutation Move($id: ID!, $newLocationId: ID!) {
    fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
      movedFulfillmentOrder { id status assignedLocation { location { id name } } }
      originalFulfillmentOrder { id status }
      remainingFulfillmentOrder { id status }
      userErrors { field message }
    }
  }
`;

async function actionMove(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before move");
  const foId = order.fulfillmentOrders.edges[0]?.node.id;
  if (!foId) throw new Error(`Order ${tail} has no fulfillment orders`);

  let targetId = flags["to-location-id"];
  if (!targetId) {
    const locations = await shopify.fetchPickupLocations();
    console.log(`\nAvailable locations (first 20 only): ${JSON.stringify(locations)}`);
    const target = locations.find((l) => l.name === flags["to-location"] || l.id === flags["to-location"]);
    if (!target) throw new Error(`Location "${flags["to-location"]}" not found in first 20. Pass --to-location-id <gid> instead. Available: ${JSON.stringify(locations)}`);
    targetId = target.id;
  }

  const t0 = Date.now();
  const data = await execOrThrow(shopify, "fulfillmentOrderMove", MOVE_MUTATION, { id: foId, newLocationId: targetId });
  console.log(`\nfulfillmentOrderMove result, ${(Date.now() - t0) / 1000}s:`);
  console.log(JSON.stringify(data.fulfillmentOrderMove, null, 2));

  await dumpOrder(shopify, tail, "after move");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

const FULFILLMENT_CREATE = `
  mutation FulfilForReturn($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status fulfillmentLineItems(first: 20) { edges { node { id quantity lineItem { sku } } } } }
      userErrors { field message }
    }
  }
`;

/** Shopify-side merchant fulfil, purely to get a real FulfillmentLineItem to probe returnCreate against — NOT the project's staging /staging/fulfil backend call. */
async function actionFulfilForReturn(flags) {
  const { shopify } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before Shopify-side fulfil");
  const foId = order.fulfillmentOrders.edges[0]?.node.id;
  if (!foId) throw new Error(`Order ${tail} has no fulfillment orders`);

  const data = await execOrThrow(shopify, "fulfillmentCreate", FULFILLMENT_CREATE, {
    fulfillment: { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: foId }], notifyCustomer: false },
  });
  console.log("\nfulfillmentCreate result:");
  console.log(JSON.stringify(data.fulfillmentCreate, null, 2));
}

const RETURN_CREATE = `
  mutation CreateReturn($returnInput: ReturnInput!) {
    returnCreate(returnInput: $returnInput) {
      return { id name status }
      userErrors { field message code }
    }
  }
`;
const RETURN_CLOSE = `
  mutation CloseReturn($id: ID!) {
    returnClose(id: $id) {
      return { id name status closedAt }
      userErrors { field message code }
    }
  }
`;

async function actionReturnFlow(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const order = await dumpOrder(shopify, tail, "before return");
  const fulfillmentLineItem = order.fulfillments
    .flatMap((f) => f.fulfillmentLineItems.edges.map((e) => e.node))
    .find((li) => li.lineItem.sku === flags["line-item-sku"]);
  if (!fulfillmentLineItem) {
    throw new Error(
      `No fulfillment line item with sku ${flags["line-item-sku"]} on order ${tail} — run fulfil-for-return first`,
    );
  }

  const t0 = Date.now();
  const created = await execOrThrow(shopify, "returnCreate", RETURN_CREATE, {
    returnInput: {
      orderId: orderGid(tail),
      returnLineItems: [
        {
          fulfillmentLineItemId: fulfillmentLineItem.id,
          quantity: Number(flags.qty ?? "1"),
          returnReason: flags.reason ?? "UNWANTED",
        },
      ],
    },
  });
  console.log(`\nreturnCreate result, ${(Date.now() - t0) / 1000}s:`);
  console.log(JSON.stringify(created.returnCreate, null, 2));

  const returnId = created.returnCreate.return?.id;
  if (returnId) {
    const t1 = Date.now();
    const closed = await execOrThrow(shopify, "returnClose", RETURN_CLOSE, { id: returnId });
    console.log(`\nreturnClose result, ${(Date.now() - t1) / 1000}s:`);
    console.log(JSON.stringify(closed.returnClose, null, 2));
  } else {
    console.log("\nreturnClose skipped — returnCreate produced no return id");
  }

  await dumpOrder(shopify, tail, "after return+close");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

const MARK_AS_PAID = `
  mutation MarkPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order { id name displayFinancialStatus }
      userErrors { field message }
    }
  }
`;

async function actionMarkPaid(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  await dumpOrder(shopify, tail, "before markAsPaid");

  const t0 = Date.now();
  const data = await execOrThrow(shopify, "orderMarkAsPaid", MARK_AS_PAID, { input: { id: orderGid(tail) } });
  console.log(`\norderMarkAsPaid result, ${(Date.now() - t0) / 1000}s:`);
  console.log(JSON.stringify(data.orderMarkAsPaid, null, 2));

  await dumpOrder(shopify, tail, "after markAsPaid");
  const pk = await resolveOrderPk(reader, flags.store, tail);
  console.log(`\nOrder PK: ${pk}. Polling TRANSACTION# rows every 5s for up to 60s...`);
  await pollAndDumpTransactions(dynamoClient, "staging-orders-v2", pk, 60, 5);
}

async function actionDumpTx(flags) {
  const { shopify, dynamoClient, reader } = buildContext(flags.store);
  const tail = await resolveTail(shopify, flags.order);
  const pk = await resolveOrderPk(reader, flags.store, tail);
  await dumpTransactionRows(dynamoClient, "staging-orders-v2", pk, "on demand");
}

async function pollAndDumpTransactions(dynamoClient, table, pk, windowSeconds, intervalSeconds) {
  const deadline = Date.now() + windowSeconds * 1000;
  let lastCount = -1;
  while (Date.now() < deadline) {
    const rows = await dumpTransactionRows(dynamoClient, table, pk, `poll t+${windowSeconds - Math.round((deadline - Date.now()) / 1000)}s`);
    if (rows.length > lastCount) {
      lastCount = rows.length;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

// ---------------------------------------------------------------------------

const ACTIONS = {
  scopes: actionScopes,
  create: actionCreate,
  "create-unpaid": actionCreateUnpaid,
  "create-pending": actionCreatePending,
  dump: actionDump,
  edit: actionEdit,
  refund: actionRefund,
  "refund-idempotency": actionRefundIdempotency,
  hold: actionHold,
  "release-hold": actionReleaseHold,
  move: actionMove,
  "fulfil-for-return": actionFulfilForReturn,
  "return-flow": actionReturnFlow,
  "mark-paid": actionMarkPaid,
  "dump-tx": actionDumpTx,
};

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  if (!action || action === "help" || !ACTIONS[action]) {
    console.log(`Usage: node probe-admin-mutations.js <action> --store <US|PS> [flags]\nActions: ${Object.keys(ACTIONS).join(", ")}`);
    return;
  }
  const flags = parseFlags(rest);
  if (!flags.store) throw new Error("--store US|PS is required");
  await ACTIONS[action](flags);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
