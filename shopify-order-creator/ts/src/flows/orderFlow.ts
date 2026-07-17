import type { RegressionConfig } from "../config";
import { ShopifyClient } from "../clients/shopify";
import { DynamoClient } from "../clients/dynamo";
import { NewStoreClient } from "../clients/newstore";
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
  const shopify = new ShopifyClient(config.store);
  const newstore = new NewStoreClient();
  const lineItems = Object.entries(skuQuantities).map(([variantId, quantity]) => ({ variantId, quantity }));
  const result = await shopify.createDraftOrder(
    "customer-1",
    "jared.davis@universalstore.com.au",
    lineItems,
    "Jared",
    "Davis",
  );
  await newstore.createOrder({ store: config.store, skus: skuQuantities });

  return {
    orderId: result.orderId,
    orderName: result.orderName,
    createdAt: result.createdAt,
    skus: skuQuantities,
  };
}

export async function createOrder(
  config: RegressionConfig,
  skuQuantities: Record<string, number>,
  seedPlan: Record<string, Record<string, number>> = {},
): Promise<OrderRecord> {
  await prepareInventory(config, skuQuantities, seedPlan);
  return placeOrder(config, skuQuantities);
}
