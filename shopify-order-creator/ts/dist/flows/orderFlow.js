"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareInventory = prepareInventory;
exports.placeOrder = placeOrder;
exports.createOrder = createOrder;
const shopify_1 = require("../clients/shopify");
const dynamo_1 = require("../clients/dynamo");
const newstore_1 = require("../clients/newstore");
const inventoryFlow_1 = require("./inventoryFlow");
async function prepareInventory(config, skuQuantities, seedPlan = {}) {
    const dynamo = new dynamo_1.DynamoClient();
    for (const [sku] of Object.entries(skuQuantities)) {
        await (0, inventoryFlow_1.zeroInventoryForCase)(dynamo, sku);
        const locations = seedPlan[sku] ?? { "ATP#100": 99 };
        for (const [store, quantity] of Object.entries(locations)) {
            await (0, inventoryFlow_1.seedInventoryForCase)(dynamo, sku, store, quantity);
        }
    }
}
async function placeOrder(config, skuQuantities) {
    const shopify = new shopify_1.ShopifyClient(config.store);
    const newstore = new newstore_1.NewStoreClient();
    const lineItems = Object.entries(skuQuantities).map(([variantId, quantity]) => ({ variantId, quantity }));
    const result = await shopify.createDraftOrder("customer-1", "jared.davis@universalstore.com.au", lineItems, "Jared", "Davis");
    await newstore.createOrder({ store: config.store, skus: skuQuantities });
    return {
        orderId: result.orderId,
        orderName: result.orderName,
        createdAt: result.createdAt,
        skus: skuQuantities,
    };
}
async function createOrder(config, skuQuantities, seedPlan = {}) {
    await prepareInventory(config, skuQuantities, seedPlan);
    return placeOrder(config, skuQuantities);
}
