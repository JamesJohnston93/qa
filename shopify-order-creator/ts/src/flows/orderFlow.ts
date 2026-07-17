import type { RegressionConfig } from "../config";
import { ShopifyClient } from "../clients/shopify";
import { DynamoClient } from "../clients/dynamo";
import { NewStoreClient } from "../clients/newstore";

export interface OrderRecord {
  orderId: string;
  orderName: string;
  createdAt: string;
  skus: Record<string, number>;
}

export async function createOrder(
  config: RegressionConfig,
  skuQuantities: Record<string, number>,
): Promise<OrderRecord> {
  const shopify = new ShopifyClient(config.store);
  const dynamo = new DynamoClient();
  const newstore = new NewStoreClient();

  const result = await shopify.createDraftOrder("customer-1", Object.entries(skuQuantities).map(([variantId, quantity]) => ({ variantId, quantity })));
  await dynamo.setInventory("demo-sku", "ATP#100", 99);
  await newstore.createOrder({ store: config.store, skus: skuQuantities });

  return {
    orderId: result.orderId,
    orderName: result.orderName,
    createdAt: result.createdAt,
    skus: skuQuantities,
  };
}
