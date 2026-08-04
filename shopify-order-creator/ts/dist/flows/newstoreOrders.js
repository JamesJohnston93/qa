"use strict";
/**
 * NewStore order injection — Ship From Store (SFS) and Over the Counter (OTC)
 * — via POST /v0/d/fulfill_order.
 *
 * External IDs are collision-free (timestamp + random suffix), not a
 * sequential counter: a file-based counter scheme was tried and dropped
 * after a confirmed staging bug — reusing a stale/reset counter value makes
 * NewStore silently return an existing, unrelated order instead of creating
 * a new one or erroring (see CLAUDE.md, 2026-07-22).
 *
 * Strict by design: a SKU with no Shopify price is a hard failure, never a
 * synthetic fallback price. No module-global brand/store toggle either —
 * store is an explicit parameter on every call.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NS_SHIPPING_PRICE = exports.NS_SHOP_LOCALE = void 0;
exports.shopIdFor = shopIdFor;
exports.customerNameFor = customerNameFor;
exports.gstAmount = gstAmount;
exports.generateExternalId = generateExternalId;
exports.calculateTotal = calculateTotal;
exports.lookupPrices = lookupPrices;
exports.buildSfsPayload = buildSfsPayload;
exports.buildOtcPayload = buildOtcPayload;
exports.injectSfsOrder = injectSfsOrder;
exports.injectOtcOrder = injectOtcOrder;
const node_crypto_1 = require("node:crypto");
const newstore_1 = require("../clients/newstore");
const shopify_1 = require("../clients/shopify");
const variants_1 = require("../variants");
// ---------------------------------------------------------------------------
// Brand / store config, as plain per-store maps rather than a mutable global.
// ---------------------------------------------------------------------------
const SHOP_IDS = { US: "us-store", PS: "ps-store" };
const STORE_IDS = { US: "BRANCH_407", PS: "BRANCH_640" };
// Confirmed from a real NewStore delivery payload: NewStore expects this
// literal string for SFS routing, not a store UUID or branch ID.
const FULFILLMENT_NODE_ID = "ORDER_FULFILLMENT_NODE";
const NS_CONFIG = {
    shopLocale: "en-AU",
    currency: "AUD",
    priceMethod: "tax_included",
    sfsServiceLevel: "sl_EXPRESS",
    otcServiceLevel: "IN_STORE_HANDOVER",
    defaultShippingPrice: 9.99,
};
// Real NewStore staff account (Jared Davis) — intentionally left untouched
// per CLAUDE.md: this is a real associate profile, not a customer identity
// to rename, and OTC orders require a real one.
const ACTIVE_ASSOCIATE_ID = "834f3c4de5ae50c787c5ad9b937f80bf";
// Dedicated QA-automation customer identity per brand (matches Shopify's
// BASELINE_CUSTOMERS convention). `nsId` still points at the old Jared Davis
// NewStore customer profile — needs a real profile for this identity before
// live use (see CLAUDE.md, 2026-07-22).
const NS_CUSTOMERS = {
    US: { name: "JJQA AutoNS", email: "QAauto@universalstore.com.au", nsId: "2bf9c32f-6e43-408a-b5f8-1a86981c00c4" },
    PS: { name: "JJQA AutoNS", email: "QAauto@perfectstranger.com.au", nsId: "2bf9c32f-6e43-408a-b5f8-1a86981c00c4" },
};
const NS_CUSTOMER_ADDRESS = {
    firstName: "JJQA",
    lastName: "AutoNS",
    addressLine1: "42 William Farrior Place",
    addressLine2: "",
    zipCode: "4009",
    city: "Eagle Farm",
    state: "QLD",
    country: "AU",
    phone: "0414 697 063",
};
// Store addresses used as shipping_address on OTC orders — NewStore records
// the store as the "shipment" destination for in-store handover (confirmed
// against a real order.opened webhook payload). Placeholder addresses —
// update if address accuracy matters for a test.
const NS_STORE_ADDRESSES = {
    US: {
        firstName: "BRANCH_407",
        lastName: "",
        addressLine1: "BRANCH_407, Westfield Chermside, 395 Hamilton Road",
        addressLine2: "",
        zipCode: "4032",
        city: "Chermside",
        state: "QLD",
        country: "AU",
        phone: "",
    },
    PS: {
        firstName: "BRANCH_640",
        lastName: "",
        addressLine1: "BRANCH_640, Westfield Chermside, 395 Hamilton Road",
        addressLine2: "",
        zipCode: "4032",
        city: "Chermside",
        state: "QLD",
        country: "AU",
        phone: "",
    },
};
// Small accessors for the flows/receipts.ts port — avoids duplicating these
// per-store constants a third time (they already live once, above).
function shopIdFor(store) {
    return SHOP_IDS[store];
}
function customerNameFor(store) {
    return NS_CUSTOMERS[store].name;
}
exports.NS_SHOP_LOCALE = NS_CONFIG.shopLocale;
exports.NS_SHIPPING_PRICE = NS_CONFIG.defaultShippingPrice;
function addressPayload(address) {
    return {
        first_name: address.firstName,
        last_name: address.lastName,
        address_line_1: address.addressLine1,
        address_line_2: address.addressLine2,
        zip_code: address.zipCode,
        city: address.city,
        state: address.state,
        country: address.country,
        phone: address.phone,
    };
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
/** GST = price / 11 for a GST-inclusive (tax_included) price — the AU standard. */
function gstAmount(price) {
    return round2(price / 11);
}
/**
 * Collision-free external order ID: `QA{prefix}_{timestamp}_{random}`.
 * Replaces order_counter.json entirely — see the module doc comment for why.
 * The random segment alone guarantees uniqueness even for two calls in the
 * same millisecond; the timestamp is kept for human-readable traceability in
 * NewStore Manager.
 */
function generateExternalId(prefix) {
    const suffix = (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 10);
    return `QA${prefix}_${Date.now()}_${suffix}`;
}
function placedAt() {
    return `${new Date().toISOString().slice(0, 19)}Z`;
}
function buildItems(skus, prices) {
    return skus.map((sku, i) => ({
        external_item_id: `ITEM_${i + 1}_${sku}`,
        product_id: sku, // NewStore staging: product_id == SKU, 1:1 passthrough
        price: {
            item_price: prices[sku],
            item_list_price: prices[sku], // no discount/markdown modelled
            item_tax_lines: [
                {
                    name: "GST",
                    amount: gstAmount(prices[sku]),
                    rate: 0.1,
                    country_code: "AU",
                },
            ],
        },
    }));
}
/**
 * Sum over `skus` (not `Object.keys(prices)`) so a duplicate SKU ordered in
 * qty > 1 is counted the correct number of times — prices is keyed by SKU so
 * a repeated entry only has one price, but must contribute to the total once
 * per unit ordered.
 */
function calculateTotal(skus, prices, includeShipping) {
    const itemTotal = skus.reduce((sum, sku) => sum + prices[sku], 0);
    const shipping = includeShipping ? NS_CONFIG.defaultShippingPrice : 0;
    return round2(itemTotal + shipping);
}
function buildCashPayment(totalAmount, timestamp) {
    return {
        processor: "cash",
        correlation_ref: `CASH_${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 12)}`,
        type: "captured",
        amount: round2(totalAmount),
        method: "cash",
        processed_at: timestamp,
    };
}
/**
 * Fetches real Shopify prices for the given SKUs. Strict: an unpriceable SKU
 * fails the whole injection rather than silently skewing the order total
 * with a synthetic fallback price.
 */
async function lookupPrices(shopify, store, skus) {
    const variants = (0, variants_1.variantsFor)(store);
    const uniqueSkus = [...new Set(skus)];
    const unknown = uniqueSkus.filter((sku) => !(sku in variants));
    if (unknown.length > 0) {
        throw new Error(`SKUs not in ${store} variant map, cannot price for NewStore injection: ${JSON.stringify(unknown)}`);
    }
    const gidsBySku = Object.fromEntries(uniqueSkus.map((sku) => [sku, variants[sku]]));
    const pricesByGid = await shopify.fetchVariantPrices(Object.values(gidsBySku));
    const prices = {};
    for (const sku of uniqueSkus) {
        const gid = gidsBySku[sku];
        const price = pricesByGid[gid];
        if (price === undefined) {
            throw new Error(`Shopify returned no price for SKU ${sku} (${gid}) — cannot inject NewStore order`);
        }
        prices[sku] = price;
    }
    return prices;
}
/**
 * Builds the SFS fulfill_order payload (pure — no network calls), so shape,
 * GST, and total calculations can be unit-tested offline.
 */
function buildSfsPayload(params) {
    const { store, skus, prices, externalId, placedAt: timestamp } = params;
    const total = calculateTotal(skus, prices, true); // customer pays shipping
    const customer = NS_CUSTOMERS[store];
    return {
        external_id: externalId,
        placed_at: timestamp,
        shop: SHOP_IDS[store],
        shop_locale: NS_CONFIG.shopLocale,
        channel_type: "store",
        channel_name: "QA Ship From Store",
        currency: NS_CONFIG.currency,
        store_id: STORE_IDS[store],
        associate_id: ACTIVE_ASSOCIATE_ID,
        customer_name: customer.name,
        customer_email: customer.email,
        external_customer_id: customer.nsId,
        is_preconfirmed: false, // NewStore handles routing/confirmation
        is_fulfilled: false, // NewStore handles picking/shipping
        price_method: NS_CONFIG.priceMethod,
        shipping_address: addressPayload(NS_CUSTOMER_ADDRESS),
        billing_address: addressPayload(NS_CUSTOMER_ADDRESS),
        shipments: [
            {
                items: buildItems(skus, prices),
                shipping_option: {
                    fulfillment_node_id: FULFILLMENT_NODE_ID,
                    service_level_identifier: NS_CONFIG.sfsServiceLevel,
                    price: NS_CONFIG.defaultShippingPrice,
                    tax: gstAmount(NS_CONFIG.defaultShippingPrice),
                },
            },
        ],
        payments: [buildCashPayment(total, timestamp)],
    };
}
/**
 * Builds the OTC fulfill_order payload (pure — no network calls). Key
 * differences from SFS, all confirmed from a real in-store order.opened
 * webhook payload: is_preconfirmed/is_fulfilled=true (sale already closed),
 * channel_name is the store ID (not a descriptive label), shipping_address
 * is the store's own address (not the customer's), and shipping_option is
 * zero-priced but still required by the schema.
 */
function buildOtcPayload(params) {
    const { store, skus, prices, externalId, placedAt: timestamp } = params;
    const total = calculateTotal(skus, prices, false); // no shipping charge for counter pickup
    const customer = NS_CUSTOMERS[store];
    const storeAddress = NS_STORE_ADDRESSES[store];
    return {
        external_id: externalId,
        placed_at: timestamp,
        shop: SHOP_IDS[store],
        shop_locale: NS_CONFIG.shopLocale,
        channel_type: "store",
        channel_name: STORE_IDS[store],
        currency: NS_CONFIG.currency,
        store_id: STORE_IDS[store],
        associate_id: ACTIVE_ASSOCIATE_ID, // required for OTC
        customer_name: customer.name,
        customer_email: customer.email,
        external_customer_id: customer.nsId,
        is_preconfirmed: true, // sale already confirmed at the register
        is_fulfilled: true, // item already handed to the customer
        price_method: NS_CONFIG.priceMethod,
        shipping_address: addressPayload(storeAddress),
        billing_address: addressPayload(NS_CUSTOMER_ADDRESS),
        shipments: [
            {
                items: buildItems(skus, prices),
                shipping_option: {
                    fulfillment_node_id: FULFILLMENT_NODE_ID,
                    service_level_identifier: NS_CONFIG.otcServiceLevel,
                    price: 0.0,
                    tax: 0.0,
                },
            },
        ],
        payments: [buildCashPayment(total, timestamp)],
    };
}
/** Injects a Ship From Store order into NewStore staging. */
async function injectSfsOrder(store, skus, clients = {}) {
    if (skus.length === 0) {
        throw new Error("injectSfsOrder requires at least one SKU");
    }
    const shopify = clients.shopify ?? new shopify_1.ShopifyClient(store);
    const newstore = clients.newstore ?? new newstore_1.NewStoreClient();
    const prices = await lookupPrices(shopify, store, skus);
    const externalId = generateExternalId("SFS");
    const payload = buildSfsPayload({ store, skus, prices, externalId, placedAt: placedAt() });
    const response = (await newstore.post("/v0/d/fulfill_order", payload));
    return { externalId, response };
}
/** Injects an Over the Counter order into NewStore staging. */
async function injectOtcOrder(store, skus, clients = {}) {
    if (skus.length === 0) {
        throw new Error("injectOtcOrder requires at least one SKU");
    }
    const shopify = clients.shopify ?? new shopify_1.ShopifyClient(store);
    const newstore = clients.newstore ?? new newstore_1.NewStoreClient();
    const prices = await lookupPrices(shopify, store, skus);
    const externalId = generateExternalId("OTC");
    const payload = buildOtcPayload({ store, skus, prices, externalId, placedAt: placedAt() });
    const response = (await newstore.post("/v0/d/fulfill_order", payload));
    return { externalId, response };
}
