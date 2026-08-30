"use strict";
/**
 * Shopify order placement via the Admin GraphQL API (draft -> calculate
 * shipping -> complete) for Universal Store (US) / Perfect Stranger (PS)
 * staging.
 *
 * Strict by design: every mutation result is checked for userErrors and for
 * the expected node in the response. Missing data raises immediately —
 * there is no synthetic/fallback ID path. A regression harness that silently
 * invented an order id on a malformed response would make every downstream
 * assertion meaningless.
 *
 * Throttle retry (TAA-14 Phase B step 3): the Admin API is cost-throttled,
 * and running cases concurrently under `--parallel` makes hitting that
 * throttle far more likely than in sequential mode. This is an infra
 * concern — nothing to do with a stage's poll interval — so it lives here
 * in the client, transparent to every caller. Shopify signals throttling
 * two ways: an HTTP 429, or a 200 whose GraphQL `errors` carry a THROTTLED
 * extension code; both are retried with backoff.
 *
 * Auth (TAA-22): Shopify retired static custom-app tokens (Jan 1 2026). US
 * still authenticates with a static token (`US_ACCESS_TOKEN`) that predates
 * the cutover and keeps working — left untouched. PS now authenticates via
 * the client-credentials grant (`PS_CLIENT_ID`/`PS_CLIENT_SECRET`) against
 * its own CLI/Dev-Dashboard app: POST client_id/client_secret to
 * `/admin/oauth/access_token`, cache the returned token, refresh a few
 * minutes ahead of its ~24h expiry — same shape as clients/newstore.ts's
 * OAuth token cache.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopifyClient = void 0;
/** Overridable so tests don't have to wait out real backoff delays. */
const DEFAULT_THROTTLE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const PS_SHOP_DOMAIN = "perfect-stranger-staging.myshopify.com";
/** Refresh a few minutes ahead of the ~24h (86399s) client-credentials token expiry. */
const PS_TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
function isThrottled(errors) {
    return (errors ?? []).some((e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message));
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
class ShopifyClient {
    store;
    throttleRetryDelaysMs;
    psToken = null;
    psTokenExpiresAt = 0; // epoch ms
    constructor(store, options = {}) {
        this.store = store;
        this.throttleRetryDelaysMs = options.throttleRetryDelaysMs ?? DEFAULT_THROTTLE_RETRY_DELAYS_MS;
    }
    async execute(query, variables) {
        const totalAttempts = this.throttleRetryDelaysMs.length + 1;
        for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
            const response = await fetch(this.getEndpoint(), {
                method: "POST",
                headers: await this.getHeaders(),
                body: JSON.stringify({ query, variables }),
            });
            if (response.status === 429) {
                if (attempt === totalAttempts) {
                    throw new Error(`Shopify request throttled (429) after ${totalAttempts} attempts`);
                }
                const retryAfterHeader = Number(response.headers.get("Retry-After"));
                const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                    ? retryAfterHeader * 1000
                    : this.throttleRetryDelaysMs[attempt - 1];
                await sleep(delay);
                continue;
            }
            if (!response.ok) {
                throw new Error(`Shopify request failed: ${response.status} ${response.statusText}`);
            }
            const json = (await response.json());
            if (isThrottled(json.errors)) {
                if (attempt === totalAttempts) {
                    throw new Error(`Shopify GraphQL throttled after ${totalAttempts} attempts: ${JSON.stringify(json.errors)}`);
                }
                await sleep(this.throttleRetryDelaysMs[attempt - 1]);
                continue;
            }
            return json;
        }
        throw new Error("unreachable: throttle retry loop exited without returning or throwing");
    }
    /**
     * No customerId is passed: Shopify creates/attaches a customer from
     * `customerEmail` automatically on first use of that email (confirmed by
     * JJ — this is intended, not a fallback). The regression suite and the
     * ad-hoc `order` command both default to the same per-store QA-automation
     * email (config.BASELINE_CUSTOMERS), so that customer is only actually
     * created once, on its very first order.
     */
    async createDraftOrder(customerEmail, lineItems, firstName, lastName, delivery) {
        const input = {
            note: "QA regression order",
            email: customerEmail,
            taxExempt: false,
            tags: ["foo", "bar"],
            billingAddress: mockAddress(firstName, lastName),
            lineItems,
        };
        // TAA-68: DraftOrderInput.deliveryMethod is entirely absent from the
        // 2025-10 schema (confirmed by live introspection on both stores) — a
        // pickup order is placed the same way as a rate order, just resolving
        // its shippingRateHandle from a different query. Every path needs a
        // shippingAddress; there is no "no address" pickup shape any more.
        const shippingRateHandle = delivery?.type === "pickup"
            ? await this.fetchNamedPickupHandle(lineItems, firstName, lastName, delivery.locationName)
            : delivery?.type === "rate"
                ? await this.fetchNamedShippingRateHandle(customerEmail, lineItems, firstName, lastName, delivery.title)
                : await this.fetchShippingRateHandle(customerEmail, lineItems, firstName, lastName);
        input.shippingAddress = mockAddress(firstName, lastName);
        input.shippingLine = { shippingRateHandle };
        const result = await this.execute(DRAFT_ORDER_CREATE, { input });
        const errors = result.data?.draftOrderCreate.userErrors ?? [];
        if (errors.length > 0) {
            throw new Error(`draftOrderCreate failed: ${JSON.stringify(errors)}`);
        }
        const draftOrderId = result.data?.draftOrderCreate.draftOrder?.id;
        if (!draftOrderId) {
            throw new Error(`draftOrderCreate returned no draft order: ${JSON.stringify(result)}`);
        }
        return this.completeDraftOrder(draftOrderId);
    }
    async completeDraftOrder(draftOrderId) {
        const result = await this.execute(DRAFT_ORDER_COMPLETE, { id: draftOrderId });
        const errors = result.data?.draftOrderComplete.userErrors ?? [];
        if (errors.length > 0) {
            throw new Error(`draftOrderComplete failed: ${JSON.stringify(errors)}`);
        }
        const draft = result.data?.draftOrderComplete.draftOrder;
        const order = draft?.order;
        if (!order?.id) {
            throw new Error(`draftOrderComplete returned no order for draft ${draftOrderId}: ${JSON.stringify(result)}`);
        }
        return {
            orderId: order.id,
            orderName: order.name ?? "",
            createdAt: draft?.createdAt ?? "",
        };
    }
    /** Calculates real shipping rates without saving anything (draftOrderCalculate is read-only). */
    async fetchShippingRates(customerEmail, lineItems, firstName, lastName) {
        const result = await this.execute(DRAFT_ORDER_CALCULATE, {
            input: {
                email: customerEmail,
                shippingAddress: mockAddress(firstName, lastName),
                lineItems,
            },
        });
        const errors = result.data?.draftOrderCalculate.userErrors ?? [];
        if (errors.length > 0) {
            throw new Error(`draftOrderCalculate failed: ${JSON.stringify(errors)}`);
        }
        const rates = result.data?.draftOrderCalculate.calculatedDraftOrder?.availableShippingRates ?? [];
        if (rates.length === 0) {
            throw new Error("draftOrderCalculate returned no shipping rates for this order");
        }
        return rates;
    }
    /** No delivery override: just the first available rate. */
    async fetchShippingRateHandle(customerEmail, lineItems, firstName, lastName) {
        const rates = await this.fetchShippingRates(customerEmail, lineItems, firstName, lastName);
        return rates[0].handle;
    }
    /** Exact title match against available rates, or throw listing what's actually available. */
    async fetchNamedShippingRateHandle(customerEmail, lineItems, firstName, lastName, title) {
        const rates = await this.fetchShippingRates(customerEmail, lineItems, firstName, lastName);
        const match = rates.find((rate) => rate.title === title);
        if (!match) {
            throw new Error(`Shipping rate "${title}" not found. Available: ${JSON.stringify(rates.map((r) => r.title))}`);
        }
        return match.handle;
    }
    /**
     * Local pickup options fulfillment-eligible for these line items at this
     * address, via `draftOrderAvailableDeliveryOptions` (TAA-68's replacement
     * for the removed `DraftOrderInput.deliveryMethod`). The set returned is
     * NOT "every pickup location that exists" — it's exactly the locations
     * that can actually fulfil this order, same as the real storefront
     * click-and-collect picker. Confirmed live: a location absent here is
     * absent because it doesn't stock/can't fulfil these line items, not
     * because of a count/distance cap — an explicit `localPickupCount` did
     * not change the result for either a 1-option or an 8-option case.
     */
    async fetchLocalPickupOptions(lineItems, firstName, lastName) {
        const result = await this.execute(DRAFT_ORDER_AVAILABLE_DELIVERY_OPTIONS, {
            input: {
                lineItems,
                shippingAddress: mockAddress(firstName, lastName),
            },
        });
        if (result.errors && result.errors.length > 0) {
            throw new Error(`draftOrderAvailableDeliveryOptions failed: ${JSON.stringify(result.errors)}`);
        }
        return result.data?.draftOrderAvailableDeliveryOptions.availableLocalPickupOptions ?? [];
    }
    /**
     * Exact title match against fulfillment-eligible pickup options, or throw
     * listing what's actually available. No customerEmail param, unlike the
     * rate-handle fetchers — `DraftOrderAvailableDeliveryOptionsInput` has no
     * `email` field (confirmed by live introspection).
     */
    async fetchNamedPickupHandle(lineItems, firstName, lastName, locationName) {
        const options = await this.fetchLocalPickupOptions(lineItems, firstName, lastName);
        const match = options.find((option) => option.title === locationName);
        if (!match) {
            throw new Error(`Pickup location "${locationName}" not found or not fulfillment-eligible for these line items. Available: ${JSON.stringify(options.map((o) => o.title))}`);
        }
        return match.handle;
    }
    /**
     * Resolves a Shopify order display name (e.g. "#9928") to the numeric tail
     * of its GID (the correlation key DynamoReader's origin_index GSI needs) —
     * TAA-36's order-driven fulfil CLI takes either, since a name is what an
     * operator actually has on hand. Null if no order matches; does not throw
     * on a miss, since "order not found" is a normal input-validation outcome
     * here, not a client failure.
     */
    async findOrderIdTailByName(name) {
        const result = await this.execute(ORDERS_BY_NAME, {
            query: `name:${name}`,
        });
        if (result.errors && result.errors.length > 0) {
            throw new Error(`order lookup by name failed for "${name}": ${JSON.stringify(result.errors)}`);
        }
        const edges = result.data?.orders.edges ?? [];
        if (edges.length === 0) {
            return null;
        }
        return edges[0].node.id.split("/").pop() ?? null;
    }
    /** Fulfilment locations available for click-and-collect delivery. */
    async fetchPickupLocations() {
        const result = await this.execute(LOCATIONS, {});
        if (result.errors && result.errors.length > 0) {
            throw new Error(`locations query failed: ${JSON.stringify(result.errors)}`);
        }
        const edges = result.data?.locations.edges ?? [];
        return edges.map((edge) => edge.node);
    }
    /**
     * Batch price lookup by variant GID. Used by NewStore order injection so
     * an order's total matches the real Shopify RRP. Returns only GIDs Shopify
     * actually resolved — a null `nodes` entry with no accompanying error
     * (unknown/deleted variant) is silently omitted, not defaulted; callers
     * must treat a missing GID as a hard failure, not fall back to a synthetic
     * price.
     *
     * A per-node GraphQL error (e.g. an access-scope denial) also produces a
     * null node, but must NOT be silently swallowed the same way — confirmed
     * live 2026-07-31 against PS staging: a missing `read_products` scope
     * returns `errors: [{message: "Access denied...", extensions: {code:
     * "ACCESS_DENIED"}}]` alongside `data.nodes: [null]`, and a caller only
     * seeing "no price found" would misdiagnose a permissions problem as an
     * unpriceable SKU. Any top-level `errors` array is surfaced immediately.
     */
    async fetchVariantPrices(variantIds) {
        if (variantIds.length === 0) {
            return {};
        }
        const result = await this.execute(VARIANT_PRICES, { ids: variantIds });
        if (result.errors && result.errors.length > 0) {
            throw new Error(`variant price lookup failed: ${JSON.stringify(result.errors)}`);
        }
        const nodes = result.data?.nodes;
        if (!nodes) {
            throw new Error(`nodes query for variant prices returned no data: ${JSON.stringify(result)}`);
        }
        const prices = {};
        for (const node of nodes) {
            if (!node)
                continue;
            prices[node.id] = Number(node.price);
        }
        return prices;
    }
    getEndpoint() {
        return this.store === "US"
            ? "https://universal-store-staging.myshopify.com/admin/api/2025-10/graphql.json"
            : `https://${PS_SHOP_DOMAIN}/admin/api/2025-10/graphql.json`;
    }
    async getHeaders() {
        const token = await this.getAccessToken();
        return {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
        };
    }
    async getAccessToken() {
        if (this.store === "US") {
            const token = process.env.US_ACCESS_TOKEN;
            if (!token) {
                throw new Error("Missing US_ACCESS_TOKEN environment variable");
            }
            return token;
        }
        return this.getPsOAuthToken();
    }
    /**
     * PS client-credentials grant (TAA-22): cached and refreshed a few
     * minutes ahead of the ~24h expiry, same shape as
     * clients/newstore.ts's getToken(). No fallback to a static PS token —
     * that auth model no longer works (Shopify retired it Jan 1 2026).
     */
    async getPsOAuthToken() {
        if (this.psToken && Date.now() < this.psTokenExpiresAt - PS_TOKEN_EXPIRY_BUFFER_MS) {
            return this.psToken;
        }
        const clientId = process.env.PS_CLIENT_ID;
        const clientSecret = process.env.PS_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new Error("Missing PS_CLIENT_ID/PS_CLIENT_SECRET environment variables");
        }
        const response = await fetch(`https://${PS_SHOP_DOMAIN}/admin/oauth/access_token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId,
                client_secret: clientSecret,
            }),
        });
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`PS OAuth token request failed: ${response.status} ${response.statusText} — ${body}`);
        }
        const data = (await response.json());
        this.psToken = data.access_token;
        this.psTokenExpiresAt = Date.now() + (data.expires_in ?? 86_399) * 1000;
        return this.psToken;
    }
}
exports.ShopifyClient = ShopifyClient;
function mockAddress(firstName, lastName) {
    return {
        firstName,
        lastName,
        address1: "42 William Farrior Place",
        address2: null,
        city: "Eagle Farm",
        zip: "4009",
        province: "Queensland",
        provinceCode: "QLD",
        country: "Australia",
        countryCode: "AU",
        phone: "0414 697 063",
        company: null,
    };
}
const DRAFT_ORDER_CALCULATE = `
  mutation draftOrderCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        availableShippingRates {
          handle
          title
        }
      }
      userErrors { field message }
    }
  }
`;
const DRAFT_ORDER_AVAILABLE_DELIVERY_OPTIONS = `
  query draftOrderAvailableDeliveryOptions($input: DraftOrderAvailableDeliveryOptionsInput!) {
    draftOrderAvailableDeliveryOptions(input: $input) {
      availableLocalPickupOptions {
        handle
        title
      }
    }
  }
`;
const DRAFT_ORDER_CREATE = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;
const DRAFT_ORDER_COMPLETE = `
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
const ORDERS_BY_NAME = `
  query getOrderByName($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node { id }
      }
    }
  }
`;
const LOCATIONS = `
  query {
    locations(first: 20) {
      edges {
        node { id name }
      }
    }
  }
`;
const VARIANT_PRICES = `
  query getVariantPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        price
      }
    }
  }
`;
