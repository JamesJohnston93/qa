export interface ShopifyLineItem {
  sku: string;
  quantity: number;
  unitPrice?: number;
}

export interface ShopifyOrderSnapshot {
  id: string;
  name: string;
  financialStatus?: string;
  lineItems: ShopifyLineItem[];
  refunds: Array<{ id: string; total: number; items: Array<{ sku: string; quantity: number }> }>;
}

export function skuQuantities(snapshot: ShopifyOrderSnapshot): Record<string, number> {
  return snapshot.lineItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.sku] = (acc[item.sku] ?? 0) + item.quantity;
    return acc;
  }, {});
}
