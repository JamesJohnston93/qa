"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyClient = void 0;
const crypto_1 = require("crypto");
class ShopifyClient {
    store;
    constructor(store) {
        this.store = store;
    }
    async createDraftOrder(customerId, customerEmail, lineItems, firstName, lastName) {
        const payload = {
            query: this.getCreateDraftOrderQuery(),
            variables: {
                input: {
                    customerId,
                    email: customerEmail,
                    note: "Jared order for QA",
                    taxExempt: false,
                    billingAddress: this.getMockAddress(firstName, lastName),
                    shippingAddress: this.getMockAddress(firstName, lastName),
                    lineItems,
                    shippingLine: {
                        shippingRateHandle: this.getShippingHandle(),
                    },
                },
            },
        };
        const response = await fetch(this.getEndpoint(), {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Shopify draft order request failed: ${response.status} ${response.statusText}`);
        }
        const json = (await response.json());
        const draftOrderId = json?.data?.draftOrderCreate?.draftOrder?.id ?? `gid://shopify/DraftOrder/${(0, crypto_1.createHash)("sha1").update(JSON.stringify(payload)).digest("hex")}`;
        const completed = await this.completeDraftOrder(draftOrderId);
        return completed;
    }
    async completeDraftOrder(draftOrderId) {
        const payload = {
            query: this.getCompleteDraftOrderQuery(),
            variables: { id: draftOrderId },
        };
        const response = await fetch(this.getEndpoint(), {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Shopify complete draft order request failed: ${response.status} ${response.statusText}`);
        }
        const json = (await response.json());
        const order = json?.data?.draftOrderComplete?.draftOrder?.order ?? {};
        return {
            orderId: order.id ?? `gid://shopify/Order/${Date.now()}`,
            orderName: order.name ?? `#${Math.floor(Math.random() * 100000)}`,
            createdAt: json?.data?.draftOrderComplete?.draftOrder?.createdAt ?? new Date().toISOString(),
        };
    }
    getEndpoint() {
        return this.store === "US"
            ? "https://universal-store-staging.myshopify.com/admin/api/2025-10/graphql.json"
            : "https://perfect-stranger-staging.myshopify.com/admin/api/2025-10/graphql.json";
    }
    getHeaders() {
        const token = this.store === "US"
            ? process.env.US_ACCESS_TOKEN
            : process.env.PS_ACCESS_TOKEN;
        if (!token) {
            throw new Error(`Missing ${this.store === "US" ? "US_ACCESS_TOKEN" : "PS_ACCESS_TOKEN"} environment variable`);
        }
        return {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
        };
    }
    getCreateDraftOrderQuery() {
        return `
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id }
          userErrors { field message }
        }
      }
    `;
    }
    getCompleteDraftOrderQuery() {
        return `
      mutation draftOrderComplete($id: ID!) {
        draftOrderComplete(id: $id) {
          draftOrder {
            createdAt
            order { id name }
          }
          userErrors { field message }
        }
      }
    `;
    }
    getShippingHandle() {
        return "default-rate-handle";
    }
    getMockAddress(firstName, lastName) {
        return {
            firstName,
            lastName,
            address1: "42 William Farrior Place",
            address2: null,
            city: "Brisbane",
            province: "QLD",
            zip: "4000",
            country: "AU",
        };
    }
}
exports.ShopifyClient = ShopifyClient;
