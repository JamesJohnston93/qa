/**
 * Case execution: seed -> order -> poll each pipeline stage -> assert. Ports
 * regression/runner.py.
 *
 * Every stage records its elapsed time (feeds PollWindows tuning); every
 * assertion failure carries expected-vs-actual from the systems involved.
 */

import { defaultConfig, validateConfig, type RegressionConfig } from "./config";
import { buildCases, type CaseDefinition } from "./cases/baselineCases";
import { buildNewStoreCases, type NewStoreCaseDefinition } from "./cases/newstoreCases";
import { buildWaves, runBounded } from "./scheduler";
import { prepareInventory, placeOrder } from "./flows/orderFlow";
import { injectSfsOrder, injectOtcOrder } from "./flows/newstoreOrders";
import { DynamoClient } from "./clients/dynamo";
import { ShopifyClient } from "./clients/shopify";
import { NewStoreClient } from "./clients/newstore";
import {
  DynamoReader,
  allocationSummary,
  orderPkFromRows,
  orderSkuQuantitiesFromRows,
  type ShipmentItem,
} from "./readers/dynamoReader";
import * as shopifyReader from "./readers/shopifyReader";
import * as newstoreReader from "./readers/newstoreReader";
import { pollUntil, resolveInterval, sleep, StageTimeout, type PollIntervalConfig } from "./polling";
import {
  buildRunPlan,
  createProgressTracker,
  estimateRemainingSeconds,
  formatProgressLine,
  recordStageAverage,
  stageSequenceFor,
  type ProgressTracker,
} from "./progress";
import { VerificationError } from "./verify/index";
import { assertOrdersTableAlignment, assertShopifyOrder } from "./verify/orders";
import { assertAllocation, assertItemsRemoved, assertUnitCounts } from "./verify/shipments";
import { assertNoRefund, assertRefundForSkus } from "./verify/refunds";
import { assertDecrements } from "./verify/inventory";
import { assertNewStoreOrder } from "./verify/newstore";

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
  onWaiting?: (elapsed: number, attempts: number) => void,
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
    return await pollUntil(fetch, predicate, timeout, interval, stage, verbose, onWaiting);
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

export interface ProgressPosition {
  tracker: ProgressTracker;
  repeatIndex: number; // 0-based
  caseIndex: number; // 0-based, within this repeat's case list
  totalCases: number;
}

/** Converts a thrown error into the report's ErrorDetail shape (shared by every case runner). */
function describeError(error: unknown): ErrorDetail {
  if (error instanceof VerificationError) {
    return error.toDict();
  }
  if (error instanceof StageTimeout) {
    return {
      check: `timeout.${error.stage}`,
      expected: `state within ${error.timeout.toFixed(0)}s`,
      actual: JSON.stringify(error.lastValue),
      detail: "",
    };
  }
  const err = error as Error;
  return {
    check: "unexpected_error",
    expected: "",
    actual: `${err.name ?? "Error"}: ${err.message}`,
    detail: err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : "",
  };
}

/** Executes one CaseDefinition. Returns a result (never throws). */
export async function runCase(
  config: RegressionConfig,
  caseDef: CaseDefinition,
  progress?: ProgressPosition,
): Promise<CaseResult> {
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

  // TAA-14 Phase A step 4: live progress line, updated per poll tick.
  const hasRefund = Object.keys(caseDef.expectedRefundSkus).length > 0;
  const caseStages = stageSequenceFor(hasRefund);
  const printProgress = (stageName: string, secondsInStage: number): void => {
    if (!config.verbose || !progress) {
      return;
    }
    const { tracker, repeatIndex, caseIndex, totalCases } = progress;
    const stageIndex = caseStages.indexOf(stageName);
    console.log(
      `    ${formatProgressLine({
        repeatIndex,
        totalRepeats: tracker.totalRepeats,
        caseIndex,
        totalCases,
        caseName: caseDef.name,
        stageIndex: stageIndex < 0 ? 0 : stageIndex,
        totalCaseStages: caseStages.length,
        stageName,
        secondsInStage,
        completedStages: tracker.completedStages,
        totalStages: tracker.flatPlan.length,
        elapsedSeconds: (Date.now() - tracker.runStart) / 1000,
        etaSeconds: estimateRemainingSeconds(tracker, secondsInStage),
      })}`,
    );
  };

  const stageDone = (name: string, elapsed: number): void => {
    result.stages.push({ name, elapsed: round(elapsed) });
    if (progress) {
      recordStageAverage(progress.tracker.averages, name, elapsed);
      progress.tracker.completedStages += 1;
    }
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
      (elapsed) => printProgress("shopify_readback", elapsed),
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

      printProgress(ordersDone ? "allocation" : "orders_table", elapsed);
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
        (elapsed) => printProgress("refund", elapsed),
      );
      stageDone("refund", refund.elapsed);

      const cleanup = await pollVerify(
        () => dynamoReader.getShipmentItems(config.store, oidTail),
        (items) => assertItemsRemoved(items, caseDef.cleanupSkus, oname),
        poll.cleanup,
        dynamoInterval,
        "cleanup",
        config.verbose,
        (elapsed) => printProgress("cleanup", elapsed),
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
      (elapsed) => printProgress("inventory", elapsed),
    );
    stageDone("inventory", inventory.elapsed);

    result.passed = true;
  } catch (error) {
    result.error = describeError(error);
  }

  return result;
}

/**
 * Executes one NewStore SFS/OTC injection case (design doc cases 7-8).
 * Unlike runCase, there's no Shopify order or Dynamo allocation to seed/poll
 * — the whole round trip is inject -> read back -> confirm SKUs/quantities.
 * `orderId`/`orderName` are repurposed for the NewStore order UUID and
 * external_id respectively, so reports/diffing (report.ts) need no changes.
 */
export async function runNewStoreCase(config: RegressionConfig, caseDef: NewStoreCaseDefinition): Promise<CaseResult> {
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

  const poll = config.poll;
  const inject = caseDef.orderType === "SFS" ? injectSfsOrder : injectOtcOrder;

  try {
    // --- 1. Inject the order into NewStore staging --------------------------
    let t0 = Date.now();
    const injected = await inject(config.store, Object.keys(caseDef.skuQuantities));
    result.orderName = injected.externalId;
    const response = injected.response as Record<string, unknown>;
    result.orderId = typeof response.id === "string" ? response.id : "";
    stageDone("inject", (Date.now() - t0) / 1000);

    // --- 2. Read back via GET /v0/d/external_orders/{external_id} ----------
    const newstore = new NewStoreClient();
    const readback = await pollVerify(
      () => newstoreReader.getOrderByExternalId(newstore, injected.externalId),
      (snap) => assertNewStoreOrder(snap, caseDef.skuQuantities, injected.externalId),
      poll.newstoreReadback,
      poll.newstoreInterval,
      "newstore_readback",
      config.verbose,
    );
    stageDone("newstore_readback", readback.elapsed);

    result.passed = true;
  } catch (error) {
    result.error = describeError(error);
  }

  return result;
}

/**
 * Runs the selected cases (default: all baseline + NewStore cases).
 *
 * Cases are partitioned by their `kind` discriminator, not by hardcoded name
 * lists or map membership — `"pipeline"` cases (today's 6 baseline cases,
 * and any future Shopify/Dynamo-shaped case such as TAA-21's
 * fulfilment/rejection cases) route through the TAA-14 progress tracker and
 * `--parallel` wave scheduler exactly as before; `"newstore"` cases route
 * through the plain `runNewStoreCase` loop (TAA-17) and always run
 * sequentially, since they're a 2-stage NewStore-only round trip with no
 * Shopify/Dynamo state for the wave scheduler to reason about. Both result
 * sets are concatenated before returning, so `--repeat`'s variance diff
 * (report.ts, keyed by case name) still catches NS variance across the
 * whole set.
 *
 * `tracker`/`repeatIndex`/`totalRepeats` carry the live-progress-line state
 * across repeats (TAA-14 Phase A step 4) — the CLI builds one tracker for
 * the whole `--repeat N` run and passes it into every call so "run %" and
 * the rolling per-stage-average ETA span the entire run, not just one
 * repeat. Omit them to run standalone (e.g. a single one-off run) — a
 * tracker scoped to just this call's pipeline cases is built automatically.
 */
export async function run(
  config: RegressionConfig = defaultConfig(),
  tracker?: ProgressTracker,
  repeatIndex = 0,
  totalRepeats = 1,
): Promise<RunSummary> {
  validateConfig(config);
  const allCases = buildCases(config.store);
  const allNewStoreCases = buildNewStoreCases(config.store);
  const allDefs: Record<string, CaseDefinition | NewStoreCaseDefinition> = { ...allCases, ...allNewStoreCases };
  const names = config.caseNames?.length ? config.caseNames : Object.keys(allDefs);
  const unknown = names.filter((name) => !(name in allDefs));
  if (unknown.length > 0) {
    throw new Error(`unknown case(s): ${JSON.stringify(unknown)}. Available: ${JSON.stringify(Object.keys(allDefs))}`);
  }

  const pipelineNames = names.filter((name) => allDefs[name].kind === "pipeline");
  const newStoreNames = names.filter((name) => allDefs[name].kind === "newstore");

  const resolvedTracker =
    tracker ??
    createProgressTracker(
      buildRunPlan(pipelineNames, (name) => Object.keys(allCases[name].expectedRefundSkus).length > 0, totalRepeats),
      totalRepeats,
      pipelineNames.length,
      Date.now(),
    );

  const pipelineResults: CaseResult[] = config.parallel
    ? await runCasesInWaves(config, pipelineNames, allCases, resolvedTracker, repeatIndex)
    : await runCasesSequentially(config, pipelineNames, allCases, resolvedTracker, repeatIndex);

  const newStoreResults: CaseResult[] = [];
  if (newStoreNames.length > 0) {
    if (config.parallel && config.verbose) {
      console.log(`\n(NewStore case(s) ${newStoreNames.join(", ")} always run sequentially — not part of --parallel waves)`);
    }
    for (const name of newStoreNames) {
      if (config.verbose) {
        console.log(`\n=== case: ${name} (${config.store}) ===`);
      }
      newStoreResults.push(await runNewStoreCase(config, allNewStoreCases[name]));
    }
  }

  const results = [...pipelineResults, ...newStoreResults];

  return {
    store: config.store,
    cases: results,
    passed: results.every((r) => r.passed),
  };
}

async function runCasesSequentially(
  config: RegressionConfig,
  names: string[],
  allCases: Record<string, CaseDefinition>,
  tracker: ProgressTracker,
  repeatIndex: number,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (let caseIndex = 0; caseIndex < names.length; caseIndex += 1) {
    const name = names[caseIndex];
    if (config.verbose) {
      console.log(`\n=== case: ${name} (${config.store}) ===`);
    }
    results.push(await runCase(config, allCases[name], { tracker, repeatIndex, caseIndex, totalCases: names.length }));
  }
  return results;
}

/**
 * TAA-14 Phase B step 3: runs cases in SKU-disjoint waves, each wave bounded
 * to config.parallelConcurrency simultaneous cases. Repeats are NOT handled
 * here — the caller (cli.ts) keeps repeats serial by calling run() once per
 * repeat; this only parallelizes the cases *within* one repeat.
 */
async function runCasesInWaves(
  config: RegressionConfig,
  names: string[],
  allCases: Record<string, CaseDefinition>,
  tracker: ProgressTracker,
  repeatIndex: number,
): Promise<CaseResult[]> {
  const caseDefs = names.map((name) => allCases[name]);
  const waves = buildWaves(caseDefs);
  if (config.verbose) {
    console.log(
      `\n=== parallel run: ${names.length} case(s) in ${waves.length} wave(s), concurrency cap ${config.parallelConcurrency} ===`,
    );
  }

  const resultByName = new Map<string, CaseResult>();
  for (const [waveIndex, wave] of waves.entries()) {
    if (config.verbose) {
      console.log(`--- wave ${waveIndex + 1}/${waves.length}: ${wave.map((c) => c.name).join(", ")} ---`);
    }
    const waveResults = await runBounded(wave, config.parallelConcurrency, (caseDef) =>
      runCase(config, caseDef, {
        tracker,
        repeatIndex,
        caseIndex: names.indexOf(caseDef.name),
        totalCases: names.length,
      }),
    );
    waveResults.forEach((result) => resultByName.set(result.case, result));
  }

  return names.map((name) => resultByName.get(name)!);
}
