/**
 * Runner for the `orders` subcommand (TAA-54) — hold lifecycle cases
 * TC7-12. Deliberately separate from runner.ts (owned by TAA-59 this wave,
 * not to be edited) and from its progress tracker: six cases run
 * sequentially, one order each, holds never touch staging-inventory-v2 so
 * there's no wave-scheduling problem to solve. Same "no tracker, plain
 * per-stage console timing" choice runner.ts's own runNewStoreCase already
 * makes for NS cases, for the same reason (short, linear, nothing to
 * schedule concurrently).
 *
 * Each case: place one order (flows/orderFlow.ts's placeOrder, reused as-is)
 * -> drive the hold(s) via flows/holdFlow.ts (each call already polls until
 * its own two-part settle predicate holds) -> ONE fresh
 * DynamoReader.getOrderRows fetch -> assert via verify/holds.ts +
 * verify/transactions.ts. No extra polling wrapper around the final assert:
 * holdFlow.ts's predicates (onHold contains reason AND a matching
 * HOLD_ORDER/UNHOLD_ORDER row) are a strict subset of what's asserted here
 * (exact reason set / exact row count) and nothing else touches these
 * QA-only orders concurrently, so re-fetching immediately after a settled
 * poll is not a race in practice — a mismatch here is a real anomaly worth
 * surfacing immediately, not silently retrying away.
 */

import { defaultConfig, customerFor, type RegressionConfig, type Store } from "./config";
import { DynamoClient } from "./clients/dynamo";
import { DynamoReader, orderRecordFromRows, transactionRowsFromRows, type TransactionRow } from "./readers/dynamoReader";
import { ShopifyClient } from "./clients/shopify";
import { orderIdTail } from "./readers/shopifyReader";
import { ShopifyAdminClient } from "./clients/shopifyAdmin";
import { variantsFor } from "./variants";
import {
  applyFraudHold,
  releaseFraudHold,
  applyOutstandingPaymentHold,
  releaseOutstandingPaymentHold,
  shopifyFulfillmentOrderResolver,
  type HoldFlowDeps,
} from "./flows/holdFlow";
import { placeOrder } from "./flows/orderFlow";
import {
  assertOnHold,
  assertHoldReasonAbsent,
  assertHoldTransactionCount,
  assertUnholdTransactionCount,
  POTENTIAL_FRAUD,
  OUTSTANDING_PAYMENT,
} from "./verify/holds";
import { assertTransactionPresent } from "./verify/transactions";
import { buildOrdersCases, ORDERS_CASE_NAMES, type OrdersCaseDefinition } from "./cases/ordersCases";

export interface OrdersCaseResult {
  case: string;
  store: Store;
  description: string;
  passed: boolean;
  orderId: string;
  orderName: string;
  stages: { name: string; elapsed: number }[];
  error: string | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `itemChanges.added[].sku` off one TRANSACTION# row — deliberately duplicated from flows/editFlow.ts's private helper of the same shape/reasoning (see that file's doc comment on why flows and callers each keep their own copy). */
function addedSkusFrom(transaction: TransactionRow): string[] {
  const itemChanges = (transaction.raw as Record<string, unknown>).itemChanges as
    | { added?: Array<{ sku?: unknown }> }
    | undefined;
  if (!itemChanges || !Array.isArray(itemChanges.added)) {
    return [];
  }
  return itemChanges.added.map((entry) => String(entry.sku ?? ""));
}

export async function runOrdersCase(config: RegressionConfig, caseDef: OrdersCaseDefinition): Promise<OrdersCaseResult> {
  const result: OrdersCaseResult = {
    case: caseDef.name,
    store: config.store,
    description: caseDef.description,
    passed: false,
    orderId: "",
    orderName: "",
    stages: [],
    error: null,
  };

  const stageDone = (name: string, elapsed: number): void => {
    result.stages.push({ name, elapsed: Number(elapsed.toFixed(1)) });
    if (config.verbose) {
      console.log(`    [stage] ${name}: ok (${elapsed.toFixed(1)}s)`);
    }
  };

  try {
    const placed = await placeOrder(config, { [caseDef.baseSku]: 1 });
    result.orderId = placed.orderId;
    result.orderName = placed.orderName;
    const idTail = orderIdTail(placed.orderId);

    const shopify = new ShopifyClient(config.store);
    const admin = new ShopifyAdminClient(shopify);
    const reader = new DynamoReader(new DynamoClient(config), config);
    const fulfillmentOrders = shopifyFulfillmentOrderResolver(shopify);
    const deps: HoldFlowDeps = { admin, reader, fulfillmentOrders, verbose: config.verbose };
    const addItemVariantId = caseDef.addItemSku ? variantsFor(config.store)[caseDef.addItemSku] : null;

    switch (caseDef.variant) {
      case "fraud": {
        const applied = await applyFraudHold(deps, config.store, placed.orderId, idTail);
        stageDone("apply_fraud_hold", applied.settledElapsedSeconds);
        const rows = await reader.getOrderRows(config.store, idTail);
        const record = orderRecordFromRows(rows);
        assertOnHold(record, [POTENTIAL_FRAUD], placed.orderName);
        assertHoldTransactionCount(transactionRowsFromRows(rows), POTENTIAL_FRAUD, 1, placed.orderName);
        break;
      }
      case "outstanding": {
        const applied = await applyOutstandingPaymentHold(deps, config.store, placed.orderId, idTail, addItemVariantId!, caseDef.addItemSku!);
        stageDone("apply_outstanding_hold", applied.settledElapsedSeconds);
        const rows = await reader.getOrderRows(config.store, idTail);
        const record = orderRecordFromRows(rows);
        const transactions = transactionRowsFromRows(rows);
        assertOnHold(record, [OUTSTANDING_PAYMENT], placed.orderName);
        assertHoldTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, placed.orderName);
        assertTransactionPresent(transactions, "ADD_ITEM", placed.orderName, (t) => addedSkusFrom(t).includes(caseDef.addItemSku!));
        break;
      }
      case "multi": {
        const fraud = await applyFraudHold(deps, config.store, placed.orderId, idTail);
        stageDone("apply_fraud_hold", fraud.settledElapsedSeconds);
        const outstanding = await applyOutstandingPaymentHold(deps, config.store, placed.orderId, idTail, addItemVariantId!, caseDef.addItemSku!);
        stageDone("apply_outstanding_hold", outstanding.settledElapsedSeconds);
        const rows = await reader.getOrderRows(config.store, idTail);
        const record = orderRecordFromRows(rows);
        const transactions = transactionRowsFromRows(rows);
        assertOnHold(record, [POTENTIAL_FRAUD, OUTSTANDING_PAYMENT], placed.orderName);
        assertHoldTransactionCount(transactions, POTENTIAL_FRAUD, 1, placed.orderName);
        assertHoldTransactionCount(transactions, OUTSTANDING_PAYMENT, 1, placed.orderName);
        break;
      }
      case "release_fraud": {
        const applied = await applyFraudHold(deps, config.store, placed.orderId, idTail);
        stageDone("apply_fraud_hold", applied.settledElapsedSeconds);
        const released = await releaseFraudHold(deps, config.store, idTail, applied.fulfillmentOrderId);
        stageDone("release_fraud_hold", released.settledElapsedSeconds);
        const rows = await reader.getOrderRows(config.store, idTail);
        const record = orderRecordFromRows(rows);
        assertHoldReasonAbsent(record, POTENTIAL_FRAUD, placed.orderName);
        assertUnholdTransactionCount(transactionRowsFromRows(rows), POTENTIAL_FRAUD, 1, placed.orderName);
        break;
      }
      case "release_payment": {
        const applied = await applyOutstandingPaymentHold(deps, config.store, placed.orderId, idTail, addItemVariantId!, caseDef.addItemSku!);
        stageDone("apply_outstanding_hold", applied.settledElapsedSeconds);
        const released = await releaseOutstandingPaymentHold(deps, config.store, placed.orderId, idTail);
        stageDone("release_outstanding_hold", released.settledElapsedSeconds);
        const rows = await reader.getOrderRows(config.store, idTail);
        const record = orderRecordFromRows(rows);
        assertHoldReasonAbsent(record, OUTSTANDING_PAYMENT, placed.orderName);
        assertUnholdTransactionCount(transactionRowsFromRows(rows), OUTSTANDING_PAYMENT, 1, placed.orderName);
        break;
      }
      case "partial_release": {
        const fraud = await applyFraudHold(deps, config.store, placed.orderId, idTail);
        stageDone("apply_fraud_hold", fraud.settledElapsedSeconds);
        const outstanding = await applyOutstandingPaymentHold(deps, config.store, placed.orderId, idTail, addItemVariantId!, caseDef.addItemSku!);
        stageDone("apply_outstanding_hold", outstanding.settledElapsedSeconds);
        const released = await releaseFraudHold(deps, config.store, idTail, fraud.fulfillmentOrderId);
        stageDone("release_fraud_hold", released.settledElapsedSeconds);
        const rows = await reader.getOrderRows(config.store, idTail);
        const record = orderRecordFromRows(rows);
        const transactions = transactionRowsFromRows(rows);
        assertOnHold(record, [OUTSTANDING_PAYMENT], placed.orderName);
        assertUnholdTransactionCount(transactions, POTENTIAL_FRAUD, 1, placed.orderName);
        assertUnholdTransactionCount(transactions, OUTSTANDING_PAYMENT, 0, placed.orderName);
        break;
      }
    }

    result.passed = true;
  } catch (error) {
    result.error = describeError(error);
  }

  return result;
}

export interface OrdersRunResult {
  store: Store;
  cases: OrdersCaseResult[];
  passed: boolean;
}

function customerLine(config: RegressionConfig): string {
  const customer = customerFor(config);
  return `${customer.firstName} ${customer.lastName} <${customer.email}>`;
}

/**
 * Runs the six hold-lifecycle cases sequentially (never the wave-scheduled
 * concurrency runner.ts's pipeline cases use — see file header). `caseNames`
 * filters to a subset, same `--cases` convention as the main regression CLI.
 */
export async function runOrdersSuite(store: Store, caseNames?: string[], verbose = true): Promise<OrdersRunResult> {
  const config = defaultConfig();
  config.store = store;
  config.verbose = verbose;

  const allCases = buildOrdersCases(store);
  const names = caseNames && caseNames.length > 0 ? caseNames : ORDERS_CASE_NAMES;
  const unknown = names.filter((name) => !(name in allCases));
  if (unknown.length > 0) {
    throw new Error(`Unknown orders case(s): ${unknown.join(", ")}. Known: ${ORDERS_CASE_NAMES.join(", ")}`);
  }

  console.log(`Running ${names.length} orders case(s) on ${store} as ${customerLine(config)}`);

  const results: OrdersCaseResult[] = [];
  for (const name of names) {
    console.log(`\n[case] ${name} — ${allCases[name].description}`);
    const result = await runOrdersCase(config, allCases[name]);
    if (result.passed) {
      console.log(`  PASS (order ${result.orderName})`);
    } else {
      console.log(`  FAIL (order ${result.orderName || "(none)"}): ${result.error}`);
    }
    results.push(result);
  }

  return { store, cases: results, passed: results.every((r) => r.passed) };
}
