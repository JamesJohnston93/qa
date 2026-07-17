"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skuQuantities = skuQuantities;
function skuQuantities(snapshot) {
    return snapshot.lineItems.reduce((acc, item) => {
        acc[item.sku] = (acc[item.sku] ?? 0) + item.quantity;
        return acc;
    }, {});
}
