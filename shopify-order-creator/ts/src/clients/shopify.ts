/**
 * Shopify order placement via the Admin GraphQL API. Ports the relevant
 * parts of orders_processor.py's draft-order lifecycle (create -> calculate
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
 */

import type { Store } from "../config";

export interface ShopifyLineItemInput {
  variantId: string;
  quantity: number;
}

export interface ShopifyOrderResult {
  orderId: string;
  orderName: string;
  createdAt: string;
}

/**
 * Optional delivery override for createDraftOrder (TAA-15 ad-hoc order
 * command). Omitted entirely = today's behaviour, unchanged: first available
 * shipping rate. Ports orders_processor.py's PREFERRED_SHIPPING_RATE /
 * PREFERRED_PICKUP_LOCATION_ID, but as an explicit per-call param instead of
 * module-global state.
 */
export type DeliverySelection = { type: "rate"; title: string } | { type: "pickup"; locationId: string };

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/** Overridable so tests don't have to wait out real backoff delays. */
const DEFAULT_THROTTLE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

function isThrottled(errors: GraphQLError[] | undefined): boolean {
  return (errors ?? []).some((e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ShopifyClient {
  private readonly throttleRetryDelaysMs: number[];

  constructor(
    private readonly store: Store,
    options: { throttleRetryDelaysMs?: number[] } = {},
  ) {
    this.throttleRetryDelaysMs = options.throttleRetryDelaysMs ?? DEFAULT_THROTTLE_RETRY_DELAYS_MS;
  }

  async execute<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
    const totalAttempts = this.throttleRetryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const response = await fetch(this.getEndpoint(), {
        method: "POST",
        headers: this.getHeaders(),
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

      const json = (await response.json()) as GraphQLResponse<T>;
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
   * JJ — this is intended, not a fallback). Every regression run reuses the
   * same per-store QA-automation email (config.BASELINE_CUSTOMERS), so the
   * customer is only actually created once, on the very first order.
   */
  async createDraftOrder(
    customerEmail: string,
    lineItems: ShopifyLineItemInput[],
    firstName: string,
    lastName: string,
    delivery?: DeliverySelection,
  ): Promise<ShopifyOrderResult> {
    const input: Record<string, unknown> = {
      note: "QA regression order",
      email: customerEmail,
      taxExempt: false,
      tags: ["foo", "bar"],
      billingAddress: mockAddress(firstName, lastName),
      lineItems,
    };

    if (delivery?.type === "pickup") {
      // Local pickup: no shippingAddress/shippingLine, matches
      // orders_processor.create_draft_order's PREFERRED_PICKUP_LOCATION_ID path.
      input.deliveryMethod = { methodType: "LOCAL", locationId: delivery.locationId };
    } else {
      const shippingRateHandle =
        delivery?.type === "rate"
          ? await this.fetchNamedShippingRateHandle(customerEmail, lineItems, firstName, lastName, delivery.title)
          : await this.fetchShippingRateHandle(customerEmail, lineItems, firstName, lastName);
      input.shippingAddress = mockAddress(firstName, lastName);
      input.shippingLine = { shippingRateHandle };
    }

    const result = await this.execute<{
      draftOrderCreate: {
        draftOrder?: { id?: string };
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(DRAFT_ORDER_CREATE, { input });

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

  private async completeDraftOrder(draftOrderId: string): Promise<ShopifyOrderResult> {
    const result = await this.execute<{
      draftOrderComplete: {
        draftOrder?: {
          createdAt?: string;
          order?: { id?: string; name?: string };
        };
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(DRAFT_ORDER_COMPLETE, { id: draftOrderId });

    const errors = result.data?.draftOrderComplete.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(`draftOrderComplete failed: ${JSON.stringify(errors)}`);
    }

    const draft = result.data?.draftOrderComplete.draftOrder;
    const order = draft?.order;
    if (!order?.id) {
      throw new Error(
        `draftOrderComplete returned no order for draft ${draftOrderId}: ${JSON.stringify(result)}`,
      );
    }

    return {
      orderId: order.id,
      orderName: order.name ?? "",
      createdAt: draft?.createdAt ?? "",
    };
  }

  /** Mirrors orders_processor.py's _calculate_shipping_rates: calculates real rates without saving anything. */
  private async fetchShippingRates(
    customerEmail: string,
    lineItems: ShopifyLineItemInput[],
    firstName: string,
    lastName: string,
  ): Promise<Array<{ handle: string; title: string }>> {
    const result = await this.execute<{
      draftOrderCalculate: {
        calculatedDraftOrder?: {
          availableShippingRates: Array<{ handle: string; title: string }>;
        };
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(DRAFT_ORDER_CALCULATE, {
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

  /** Mirrors orders_processor.fetch_shipping_rates with no preferred rate set: first available. */
  private async fetchShippingRateHandle(
    customerEmail: string,
    lineItems: ShopifyLineItemInput[],
    firstName: string,
    lastName: string,
  ): Promise<string> {
    const rates = await this.fetchShippingRates(customerEmail, lineItems, firstName, lastName);
    return rates[0].handle;
  }

  /** Mirrors orders_processor.fetch_shipping_rates's PREFERRED_SHIPPING_RATE path: exact title match, or throw with the available list. */
  private async fetchNamedShippingRateHandle(
    customerEmail: string,
    lineItems: ShopifyLineItemInput[],
    firstName: string,
    lastName: string,
    title: string,
  ): Promise<string> {
    const rates = await this.fetchShippingRates(customerEmail, lineItems, firstName, lastName);
    const match = rates.find((rate) => rate.title === title);
    if (!match) {
      throw new Error(`Shipping rate "${title}" not found. Available: ${JSON.stringify(rates.map((r) => r.title))}`);
    }
    return match.handle;
  }

  /** Ports orders_processor.get_pickup_locations / graphql_scripts.get_locations: fulfilment locations for click-and-collect. */
  async fetchPickupLocations(): Promise<Array<{ id: string; name: string }>> {
    const result = await this.execute<{ locations: { edges: Array<{ node: { id: string; name: string } }> } }>(
      LOCATIONS,
      {},
    );
    if (result.errors && result.errors.length > 0) {
      throw new Error(`locations query failed: ${JSON.stringify(result.errors)}`);
    }
    const edges = result.data?.locations.edges ?? [];
    return edges.map((edge) => edge.node);
  }

  /**
   * Batch price lookup by variant GID (ports orders_processor.get_shopify_prices
   * / graphql_scripts.get_variant_prices). Used by NewStore order injection so
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
  async fetchVariantPrices(variantIds: string[]): Promise<Record<string, number>> {
    if (variantIds.length === 0) {
      return {};
    }
    const result = await this.execute<{ nodes: Array<{ id: string; price: string } | null> }>(
      VARIANT_PRICES,
      { ids: variantIds },
    );
    if (result.errors && result.errors.length > 0) {
      throw new Error(`variant price lookup failed: ${JSON.stringify(result.errors)}`);
    }
    const nodes = result.data?.nodes;
    if (!nodes) {
      throw new Error(`nodes query for variant prices returned no data: ${JSON.stringify(result)}`);
    }
    const prices: Record<string, number> = {};
    for (const node of nodes) {
      if (!node) continue;
      prices[node.id] = Number(node.price);
    }
    return prices;
  }

  private getEndpoint(): string {
    return this.store === "US"
      ? "https://universal-store-staging.myshopify.com/admin/api/2025-10/graphql.json"
      : "https://perfect-stranger-staging.myshopify.com/admin/api/2025-10/graphql.json";
  }

  private getHeaders(): Record<string, string> {
    const token = this.store === "US" ? process.env.US_ACCESS_TOKEN : process.env.PS_ACCESS_TOKEN;
    if (!token) {
      throw new Error(`Missing ${this.store === "US" ? "US_ACCESS_TOKEN" : "PS_ACCESS_TOKEN"} environment variable`);
    }
    return {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    };
  }
}

function mockAddress(firstName: string, lastName: string): Record<string, string | null> {
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
