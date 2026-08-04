/**
 * Order lifecycle orchestration: inventory seeding and headless order
 * creation that returns every identifier verification needs. No input(),
 * no CLI/module globals — everything needed is passed in via config.
 *
 * NewStore is intentionally not called here: this flow is Shopify-only. NS
 * SFS/OTC cases run through a separate path (cases/newstoreCases.ts +
 * runner.ts's runNewStoreCase) since NS orders never touch Shopify at all.
 */

import type { RegressionConfig } from "../config";
import { customerFor } from "../config";
import { ShopifyClient } from "../clients/shopify";
import { DynamoClient } from "../clients/dynamo";
import { variantsFor } from "../variants";
import { prepareInventoryForCase } from "./inventoryFlow";

export interface OrderRecord {
  orderId: string;
  orderName: string;
  createdAt: string;
  skus: Record<string, number>;
}

export async function prepareInventory(
  config: RegressionConfig,
  skuQuantities: Record<string, number>,
  seedPlan: Record<string, Record<string, number>> = {},
): Promise<Record<string, Record<string, number>>> {
  const dynamo = new DynamoClient(config);
  return prepareInventoryForCase(dynamo, Object.keys(skuQuantities), seedPlan);
}

export async function placeOrder(
  config: RegressionConfig,
  skuQuantities: Record<string, number>,
): Promise<OrderRecord> {
  const variants = variantsFor(config.store);
  const unknown = Object.keys(skuQuantities).filter((sku) => !(sku in variants));
  if (unknown.length > 0) {
    throw new Error(`SKUs not in ${config.store} variant map: ${JSON.stringify(unknown)}. Known: ${Object.keys(variants)}`);
  }

  const lineItems = Object.entries(skuQuantities).map(([sku, quantity]) => ({
    variantId: variants[sku],
    quantity,
  }));

  const customer = customerFor(config);
  const shopify = new ShopifyClient(config.store);
  const result = await shopify.createDraftOrder(customer.email, lineItems, customer.firstName, customer.lastName);

  return {
    orderId: result.orderId,
    orderName: result.orderName,
    createdAt: result.createdAt,
    skus: { ...skuQuantities },
  };
}
