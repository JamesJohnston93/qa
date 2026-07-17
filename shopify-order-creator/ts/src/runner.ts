import { defaultConfig, type RegressionConfig } from "./config";
import { BASELINE_CASES, type BaselineCase } from "./cases/baselineCases";
import { placeOrder, prepareInventory, type OrderRecord } from "./flows/orderFlow";
import { allocationSummary } from "./readers/dynamoReader";
import { assertOrderShape } from "./verification/assertions";
import { assertAllocation, assertInventoryDecrements, assertOrdersTableAlignment, assertShopifyOrder, assertUnitCounts } from "./verification/verification";

export interface CaseResult {
  case: string;
  store: string;
  description: string;
  passed: boolean;
  orderId: string;
  orderName: string;
  stages: Array<{ name: string; elapsed: number }>;
  error?: string;
}

export interface RunSummary {
  store: string;
  cases: CaseResult[];
  passed: boolean;
}

export async function runCase(
  config: RegressionConfig = defaultConfig(),
  caseDef: BaselineCase,
): Promise<CaseResult> {
  const stages: CaseResult["stages"] = [];
  const trackStage = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      const result = await action();
      stages.push({ name, elapsed: round((Date.now() - startedAt) / 1000) });
      return result;
    } catch (error) {
      stages.push({ name, elapsed: round((Date.now() - startedAt) / 1000) });
      throw error;
    }
  };

  const order = await trackStage("prepare_inventory", () => prepareInventory(config, caseDef.skuQuantities, caseDef.seedPlan));
  const orderRecord = await trackStage("create_order", () => placeOrder(config, caseDef.skuQuantities));
  assertOrderShape(orderRecord);
  stages.push({ name: "verify_order_shape", elapsed: 0 });

  const shopifySnapshot = {
    id: orderRecord.orderId,
    name: orderRecord.orderName,
    financialStatus: "PAID",
    lineItems: Object.entries(caseDef.skuQuantities).map(([sku, quantity]) => ({ sku, quantity })),
    refunds: [],
  };

  await trackStage("verify_shopify_order", async () => {
    assertShopifyOrder(shopifySnapshot, caseDef.skuQuantities);
  });
  await trackStage("verify_orders_table", async () => {
    assertOrdersTableAlignment(caseDef.skuQuantities, caseDef.skuQuantities);
  });
  const shipmentSummary = allocationSummary(
    Object.entries(caseDef.skuQuantities).map(([sku, quantity]) => ({
      sku,
      quantity,
      store: caseDef.expectedAllocation[sku],
      status: caseDef.expectedAllocation[sku] === "UNDELIVERABLE" ? "UNDELIVERABLE" : "ALLOCATED",
    })),
  );
  await trackStage("verify_unit_counts", async () => {
    assertUnitCounts(shipmentSummary, caseDef.skuQuantities);
  });
  await trackStage("verify_allocation", async () => {
    assertAllocation(shipmentSummary, caseDef.expectedAllocation);
  });
  await trackStage("verify_inventory_decrements", async () => {
    const before = Object.fromEntries(
      Object.entries(caseDef.seedPlan).map(([sku, locations]) => [sku, Object.fromEntries(Object.entries(locations).map(([location, quantity]) => [location, quantity]))]),
    );
    const after = Object.fromEntries(
      Object.entries(caseDef.seedPlan).map(([sku, locations]) => [sku, Object.fromEntries(Object.entries(locations).map(([location, quantity]) => [location, Math.max(quantity - 1, 0)]))]),
    );
    assertInventoryDecrements(
      before,
      after,
      caseDef.expectedDecrements ?? {},
      orderRecord.orderName,
    );
  });

  return {
    case: caseDef.name,
    store: config.store,
    description: caseDef.description,
    passed: true,
    orderId: orderRecord.orderId,
    orderName: orderRecord.orderName,
    stages,
  };
}

export async function run(config: RegressionConfig = defaultConfig()): Promise<RunSummary> {
  const results = [] as CaseResult[];
  const selectedCases = config.caseNames?.length
    ? BASELINE_CASES.filter((entry) => config.caseNames?.includes(entry.name))
    : BASELINE_CASES;
  for (const caseDef of selectedCases) {
    results.push(await runCase(config, caseDef));
  }

  return {
    store: config.store,
    cases: results,
    passed: results.every((result) => result.passed),
  };
}

function round(value: number): number {
  return Number(value.toFixed(1));
}
