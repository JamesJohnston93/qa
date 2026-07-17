/**
 * Order lifecycle orchestration: inventory seeding and headless order
 * creation that returns every identifier verification needs. Ports the
 * relevant parts of regression/flows.py. Bypasses main.py entirely — no
 * input(), no CLI globals.
 *
 * NewStore is intentionally not called here: cases 1-6 are Shopify-only
 * (matching flows.create_shopify_order). NS SFS/OTC cases (7-8) are not yet
 * wired into the runner — see cases/baselineCases.ts.
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
