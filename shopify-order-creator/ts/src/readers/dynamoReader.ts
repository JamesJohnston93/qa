export interface ShipmentItem {
  sku: string;
  quantity?: number;
  store?: string;
  status?: string;
  rejectedStores?: string[];
}

export interface ShipmentSummary {
  totalUnits: number;
  byStore: Record<string, string[]>;
  skuUnits: Record<string, number>;
  unallocated: number;
  undeliverableKey: string;
}

export function allocationSummary(items: ShipmentItem[]): ShipmentSummary {
  const byStore: Record<string, string[]> = {};
  const skuUnits: Record<string, number> = {};
  let unallocated = 0;
  for (const item of items) {
    const store = item.store ?? "(unallocated)";
    const quantity = item.quantity ?? 1;
    if (!item.store) {
      unallocated += 1;
    }
    byStore[store] = byStore[store] ?? [];
    for (let idx = 0; idx < quantity; idx += 1) {
      byStore[store].push(item.sku);
    }
    skuUnits[item.sku] = (skuUnits[item.sku] ?? 0) + quantity;
  }

  return {
    totalUnits: items.length,
    byStore,
    skuUnits,
    unallocated,
    undeliverableKey: "UNDELIVERABLE",
  };
}
