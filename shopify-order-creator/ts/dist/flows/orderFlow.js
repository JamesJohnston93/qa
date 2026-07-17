"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
const shopify_1 = require("../clients/shopify");
const dynamo_1 = require("../clients/dynamo");
const newstore_1 = require("../clients/newstore");
async function createOrder(config, skuQuantities) {
    const shopify = new shopify_1.ShopifyClient(config.store);
    const dynamo = new dynamo_1.DynamoClient();
    const newstore = new newstore_1.NewStoreClient();
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
