import { CASES, type CaseDefinition, type RegressionConfig, DEFAULT_CONFIG } from "./config";
import { createOrder } from "./flows/orderFlow";
import { assertOrderShape } from "./verification/assertions";

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
  config: RegressionConfig = DEFAULT_CONFIG,
  caseDef: CaseDefinition,
): Promise<CaseResult> {
  const startedAt = Date.now();
  const order = await createOrder(config, { demo_sku: 1 });
  assertOrderShape(order);
  const elapsedMs = Date.now() - startedAt;

  return {
    case: caseDef.name,
    store: config.store,
    description: caseDef.description,
    passed: true,
    orderId: order.orderId,
    orderName: order.orderName,
    stages: [{ name: "create_order", elapsed: round(elapsedMs / 1000) }],
  };
}

export async function run(config: RegressionConfig = DEFAULT_CONFIG): Promise<RunSummary> {
  const results = [] as CaseResult[];
  for (const caseDef of CASES) {
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
