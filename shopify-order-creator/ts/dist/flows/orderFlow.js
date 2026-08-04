"use strict";
/**
 * Order lifecycle orchestration: inventory seeding and headless order
 * creation that returns every identifier verification needs. No input(),
 * no CLI/module globals — everything needed is passed in via config.
 *
 * NewStore is intentionally not called here: this flow is Shopify-only. NS
 * SFS/OTC cases run through a separate path (cases/newstoreCases.ts +
 * runner.ts's runNewStoreCase) since NS orders never touch Shopify at all.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareInventory = prepareInventory;
exports.placeOrder = placeOrder;
const config_1 = require("../config");
const shopify_1 = require("../clients/shopify");
const dynamo_1 = require("../clients/dynamo");
const variants_1 = require("../variants");
const inventoryFlow_1 = require("./inventoryFlow");
async function prepareInventory(config, skuQuantities, seedPlan = {}) {
    const dynamo = new dynamo_1.DynamoClient(config);
    return (0, inventoryFlow_1.prepareInventoryForCase)(dynamo, Object.keys(skuQuantities), seedPlan);
}
async function placeOrder(config, skuQuantities) {
    const variants = (0, variants_1.variantsFor)(config.store);
    const unknown = Object.keys(skuQuantities).filter((sku) => !(sku in variants));
    if (unknown.length > 0) {
        throw new Error(`SKUs not in ${config.store} variant map: ${JSON.stringify(unknown)}. Known: ${Object.keys(variants)}`);
    }
    const lineItems = Object.entries(skuQuantities).map(([sku, quantity]) => ({
        variantId: variants[sku],
        quantity,
    }));
    const customer = (0, config_1.customerFor)(config);
    const shopify = new shopify_1.ShopifyClient(config.store);
    const result = await shopify.createDraftOrder(customer.email, lineItems, customer.firstName, customer.lastName);
    return {
        orderId: result.orderId,
        orderName: result.orderName,
        createdAt: result.createdAt,
        skus: { ...skuQuantities },
    };
}
