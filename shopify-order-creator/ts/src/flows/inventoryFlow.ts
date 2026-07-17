import { DynamoClient } from "../clients/dynamo";

export async function seedInventoryForCase(
  dynamo: DynamoClient,
  sku: string,
  store: string,
  quantity: number,
): Promise<void> {
  await dynamo.setInventory(sku, store, quantity);
}

export async function zeroInventoryForCase(
  dynamo: DynamoClient,
  sku: string,
): Promise<void> {
  const locations = await dynamo.getInventory(sku);
  for (const location of locations) {
    await dynamo.setInventory(sku, location.store, 0);
  }
}
