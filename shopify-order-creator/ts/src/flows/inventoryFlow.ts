import type { DynamoClient } from "../clients/dynamo";

/**
 * Deterministic inventory seeding for one case: zero every existing location
 * for each ordered SKU, then apply the case's explicit seed plan. Mirrors
 * regression/runner.py's stage 1 (seed_inventory / zero_everywhere) — never
 * rely on ambient staging stock.
 */
export async function prepareInventoryForCase(
  dynamo: DynamoClient,
  skus: string[],
  seedPlan: Record<string, Record<string, number>>,
): Promise<Record<string, Record<string, number>>> {
  for (const sku of skus) {
    await dynamo.zeroEverywhere(sku);
  }
  await dynamo.seedInventory(seedPlan);
  return dynamo.snapshotInventory(skus);
}

export async function snapshotInventoryForCase(
  dynamo: DynamoClient,
  skus: string[],
): Promise<Record<string, Record<string, number>>> {
  return dynamo.snapshotInventory(skus);
}
