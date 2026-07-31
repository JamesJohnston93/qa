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
import {
  DynamoReader,
  allocationSummary,
  orderPkFromRows,
  orderSkuQuantitiesFromRows,
  type ShipmentItem,
} from "./readers/dynamoReader";
import * as shopifyReader from "./readers/shopifyReader";
import { pollUntil, resolveInterval, sleep, StageTimeout, type PollIntervalConfig } from "./polling";
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
  interval: number | PollIntervalConfig,
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
  // TAA-14 Phase A step 2: ramp 1s->2s->3s->cap poll.interval instead of a
  // fixed sleep every tick. Shopify-touching stages keep a 2s floor even on
  // the first poll to stay clear of rate limits.
  const dynamoInterval: PollIntervalConfig = { cap: poll.interval };
  const shopifyInterval: PollIntervalConfig = { cap: poll.interval, min: 2 };

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
      shopifyInterval,
      "shopify_readback",
      config.verbose,
    );
    stageDone("shopify_readback", readback.elapsed);

    // --- 4+5. orders-v2 row + shipment ITEM# rows: composite poll -----------
    // TAA-14 Phase A step 3: both checks key off the same staging-orders-v2
    // rows (allocation needs the order's PK, which lives there too), so one
    // tick fetches those rows once and advances whichever of orders_table /
    // allocation now passes — a stage that becomes true while the other is
    // still pending is caught immediately instead of waiting for a fresh,
    // separately-ramped poll cycle to start once the first stage finishes.
    const checkAllocation = (items: ShipmentItem[]): void => {
      const summary = allocationSummary(items);
      assertUnitCounts(summary, caseDef.skuQuantities, oname);
      assertAllocation(summary, caseDef.expectedAllocation, oname);
    };
    const ordersTimeout = poll.ordersTable;
    const allocationTimeout = poll.shipmentsTable + poll.allocation;
    const compositeStart = Date.now();
    let compositeAttempts = 0;
    let ordersDone: { elapsed: number } | null = null;
    let allocationDone: { elapsed: number } | null = null;
    let resolvedPk: string | null = null;
    let lastSkuQuantities: Record<string, number> = {};
    let lastItems: ShipmentItem[] = [];

    for (;;) {
      const rows = await dynamoReader.getOrderRows(config.store, oidTail);
      compositeAttempts += 1;
      const elapsed = (Date.now() - compositeStart) / 1000;

      if (!ordersDone) {
        lastSkuQuantities = orderSkuQuantitiesFromRows(rows);
        try {
          assertOrdersTableAlignment(lastSkuQuantities, caseDef.skuQuantities, oname);
          ordersDone = { elapsed };
          if (config.verbose) {
            console.log(`    [poll] orders_table: ok after ${elapsed.toFixed(1)}s (${compositeAttempts} checks)`);
          }
        } catch (error) {
          if (!(error instanceof VerificationError)) {
            throw error;
          }
        }
      }

      resolvedPk = resolvedPk ?? orderPkFromRows(rows);
      if (!allocationDone && resolvedPk) {
        lastItems = await dynamoReader.getShipmentItemsByPk(resolvedPk);
        try {
          checkAllocation(lastItems);
          allocationDone = { elapsed };
          if (config.verbose) {
            console.log(`    [poll] allocation: ok after ${elapsed.toFixed(1)}s (${compositeAttempts} checks)`);
          }
        } catch (error) {
          if (!(error instanceof VerificationError)) {
            throw error;
          }
        }
      }

      if (ordersDone && allocationDone) {
        break;
      }

      if (!ordersDone && elapsed >= ordersTimeout) {
        assertOrdersTableAlignment(lastSkuQuantities, caseDef.skuQuantities, oname); // raises the detailed error
      }
      if (!allocationDone && elapsed >= allocationTimeout) {
        checkAllocation(lastItems); // raises the detailed error
      }

      if (config.verbose) {
        console.log(
          `    [poll] orders_table+allocation: waiting... (${elapsed.toFixed(0)}s) ` +
            `orders=${ordersDone ? "done" : "pending"} allocation=${allocationDone ? "done" : "pending"}`,
        );
      }
      await sleep(resolveInterval(compositeAttempts, dynamoInterval) * 1000);
    }

    stageDone("orders_table", ordersDone.elapsed);
    stageDone("allocation", allocationDone.elapsed);

    // --- 6. Refund path (undeliverable cases) or no-refund check ------------
    if (Object.keys(caseDef.expectedRefundSkus).length > 0) {
      const refund = await pollVerify(
        () => shopifyReader.getOrder(shopify, record.orderId),
        (snap) => assertRefundForSkus(snap, caseDef.expectedRefundSkus),
        poll.refund,
        shopifyInterval,
        "refund",
        config.verbose,
      );
      stageDone("refund", refund.elapsed);

      const cleanup = await pollVerify(
        () => dynamoReader.getShipmentItems(config.store, oidTail),
        (items) => assertItemsRemoved(items, caseDef.cleanupSkus, oname),
        poll.cleanup,
        dynamoInterval,
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
      dynamoInterval,
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
