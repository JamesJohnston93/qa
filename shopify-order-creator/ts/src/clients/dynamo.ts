export interface InventoryLocation { store: string; quantity: number; }

export class DynamoClient {
  async getInventory(_sku: string): Promise<InventoryLocation[]> {
    return [];
  }

  async setInventory(_sku: string, _store: string, _quantity: number): Promise<void> {
    return;
  }
}
