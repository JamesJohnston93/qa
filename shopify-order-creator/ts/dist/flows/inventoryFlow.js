"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedInventoryForCase = seedInventoryForCase;
exports.zeroInventoryForCase = zeroInventoryForCase;
async function seedInventoryForCase(dynamo, sku, store, quantity) {
    await dynamo.setInventory(sku, store, quantity);
}
async function zeroInventoryForCase(dynamo, sku) {
    const locations = await dynamo.getInventory(sku);
    for (const location of locations) {
        await dynamo.setInventory(sku, location.store, 0);
    }
}
