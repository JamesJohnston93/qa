"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocationSummary = allocationSummary;
function allocationSummary(items) {
    const byStore = {};
    const skuUnits = {};
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
