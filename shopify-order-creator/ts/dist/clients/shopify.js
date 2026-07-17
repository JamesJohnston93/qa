"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyClient = void 0;
class ShopifyClient {
    store;
    constructor(store) {
        this.store = store;
    }
    async createDraftOrder(_customerId, _lineItems) {
        return {
            orderId: `gid://shopify/Order/${Date.now()}`,
            orderName: `#${Math.floor(Math.random() * 100000)}`,
            createdAt: new Date().toISOString(),
        };
    }
}
exports.ShopifyClient = ShopifyClient;
