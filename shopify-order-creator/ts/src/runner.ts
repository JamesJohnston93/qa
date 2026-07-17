/**
 * Case execution: seed -> order -> poll each pipeline stage -> assert. Ports
 * regression/runner.py.
 *
 * Every stage records its elapsed time (feeds PollWindows tuning); every
 * assertion failure carries expected-vs-actual from the systems involved.
 */

import { defaultConfig, validateConfig, type RegressionConfig } from "./config";
import { buildCases, type CaseDefinition } from "./cases/baselineCases";
import { prepareInventory, placeOrder } from "./flows/orderFlow";
import { DynamoClient } from "./clients/dynamo";
import { ShopifyClient } from "./clients/shopify";
import { DynamoReader, allocationSummary, type ShipmentItem } from "./readers/dynamoReader";
import * as shopifyReader from "./readers/shopifyReader";
import { pollUntil, StageTimeout } from "./polling";
import { VerificationError } from "./verify/index";
import { assertOrdersTableAlignment, assertShopifyOrder } from "./verify/orders";
import { assertAllocation, assertItemsRemoved, assertUnitCounts } from "./verify/shipments";
import { assertNoRefund, assertRefundForSkus } from "./verify/refunds";
import { assertDecrements } from "./verify/inventory";

export interface StageTiming {
  name: string;
  elapsed: number;
}

export interface ErrorDetail {
  check: string;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

export interface CaseResult {
  case: string;
  store: string;
  description: string;
  passed: boolean;
  orderId: string;
  orderName: string;
  stages: StageTiming[];
  error: ErrorDetail | null;
}

export interface RunSummary {
  store: string;
  cases: CaseResult[];
  passed: boolean;
}

/**
 * Polls until verifyFn(value) stops throwing VerificationError. On timeout,
 * re-throws the final VerificationError (full evidence) rather than a bare
 * timeout.
 */
async function pollVerify<T>(
  fetch: () => Promise<T> | T,
  verifyFn: (value: T) => void,
  timeout: number,
  interval: number,
  stage: string,
  verbose: boolean,
) {
  const predicate = (value: T): boolean => {
    try {
      verifyFn(value);
      return true;
    } catch (error) {
      if (error instanceof VerificationError) {
        return false;
      }
      throw error;
    }
  };

  try {
    return await pollUntil(fetch, predicate, timeout, interval, stage, verbose);
  } catch (error) {
    if (error instanceof StageTimeout) {
      verifyFn(error.lastValue as T); // raises the detailed VerificationError
    }
    throw error; // unreachable unless state changed between last poll and here
  }
}

function round(value: number): number {
  return Number(value.toFixed(1));
}

/** Executes one CaseDefinition. Returns a result (never throws). */
export async function runCase(config: RegressionConfig, caseDef: CaseDefinition): Promise<CaseResult> {
  const result: CaseResult = {
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
    result.stages.push({ name, elapsed: round(elapsed) });
    if (config.verbose) {
      console.log(`    [stage] ${name}: ok (${elapsed.toFixed(1)}s)`);
    }
  };

  const dynamo = new DynamoClient(config);
  const dynamoReader = new DynamoReader(dynamo, config);
  const shopify = new ShopifyClient(config.store);
  const poll = config.poll;

  try {
    // --- 1. Seed inventory deterministically -------------------------------
    let t0 = Date.now();
    const skus = Object.keys(caseDef.skuQuantities);
    const before = await prepareInventory(config, caseDef.skuQuantities, caseDef.seedPlan);
    stageDone("seed_inventory", (Date.now() - t0) / 1000);

    // --- 2. Create the Shopify order ---------------------------------------
    t0 = Date.now();
    const record = await placeOrder(config, caseDef.skuQuantities);
    result.orderId = record.orderId;
    result.orderName = record.orderName;
    stageDone("create_order", (Date.now() - t0) / 1000);

    const oidTail = shopifyReader.orderIdTail(record.orderId);
    const oname = record.orderName;

    // --- 3. Shopify read-back: exists, paid, items match --------------------
    const readback = await pollVerify(
      () => shopifyReader.getOrder(shopify, record.orderId),
      (snap) => assertShopifyOrder(snap, caseDef.skuQuantities),
      60,
      poll.interval,
      "shopify_readback",
      config.verbose,
    );
    stageDone("shopify_readback", readback.elapsed);

    // --- 4. staging-orders-v2 row lands and matches -------------------------
    const ordersTable = await pollVerify(
      () => dynamoReader.getOrderSkuQuantities(config.store, oidTail),
      (q) => assertOrdersTableAlignment(q, caseDef.skuQuantities, oname),
      poll.ordersTable,
      poll.interval,
      "orders_table",
      config.verbose,
    );
    stageDone("orders_table", ordersTable.elapsed);

    // --- 5. Shipment ITEM# rows: unit counts, then terminal allocation ------
    const checkAllocation = (items: ShipmentItem[]): void => {
      const summary = allocationSummary(items);
      assertUnitCounts(summary, caseDef.skuQuantities, oname);
      assertAllocation(summary, caseDef.expectedAllocation, oname);
    };
    const allocation = await pollVerify(
      () => dynamoReader.getShipmentItems(config.store, oidTail),
      checkAllocation,
      poll.shipmentsTable + poll.allocation,
      poll.interval,
      "allocation",
      config.verbose,
    );
    stageDone("allocation", allocation.elapsed);

    // --- 6. Refund path (undeliverable cases) or no-refund check ------------
    if (Object.keys(caseDef.expectedRefundSkus).length > 0) {
      const refund = await pollVerify(
        () => shopifyReader.getOrder(shopify, record.orderId),
        (snap) => assertRefundForSkus(snap, caseDef.expectedRefundSkus),
        poll.refund,
        poll.interval,
        "refund",
        config.verbose,
      );
      stageDone("refund", refund.elapsed);

      const cleanup = await pollVerify(
        () => dynamoReader.getShipmentItems(config.store, oidTail),
        (items) => assertItemsRemoved(items, caseDef.cleanupSkus, oname),
        poll.cleanup,
        poll.interval,
        "cleanup",
        config.verbose,
      );
      stageDone("cleanup", cleanup.elapsed);
    } else {
      const snap = await shopifyReader.getOrder(shopify, record.orderId);
      assertNoRefund(snap);
      stageDone("no_refund", 0);
    }

    // --- 7. Inventory decremented exactly as expected -----------------------
    const inventory = await pollVerify(
      () => dynamo.snapshotInventory(skus),
      (after) => assertDecrements(before, after, caseDef.expectedDecrements, oname),
      poll.inventory,
      poll.interval,
      "inventory",
      config.verbose,
    );
    stageDone("inventory", inventory.elapsed);

    result.passed = true;
  } catch (error) {
    if (error instanceof VerificationError) {
      result.error = error.toDict();
    } else if (error instanceof StageTimeout) {
      result.error = {
        check: `timeout.${error.stage}`,
        expected: `state within ${error.timeout.toFixed(0)}s`,
        actual: JSON.stringify(error.lastValue),
        detail: "",
      };
    } else {
      const err = error as Error;
      result.error = {
        check: "unexpected_error",
        expected: "",
        actual: `${err.name ?? "Error"}: ${err.message}`,
        detail: err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : "",
      };
    }
  }

  return result;
}

/** Runs the selected cases (default: all) sequentially. */
export async function run(config: RegressionConfig = defaultConfig()): Promise<RunSummary> {
  validateConfig(config);
  const allCases = buildCases(config.store);
  const names = config.caseNames?.length ? config.caseNames : Object.keys(allCases);
  const unknown = names.filter((name) => !(name in allCases));
  if (unknown.length > 0) {
    throw new Error(`unknown case(s): ${JSON.stringify(unknown)}. Available: ${JSON.stringify(Object.keys(allCases))}`);
  }

  const results: CaseResult[] = [];
  for (const name of names) {
    if (config.verbose) {
      console.log(`\n=== case: ${name} (${config.store}) ===`);
    }
    results.push(await runCase(config, allCases[name]));
  }

  return {
    store: config.store,
    cases: results,
    passed: results.every((r) => r.passed),
  };
}
