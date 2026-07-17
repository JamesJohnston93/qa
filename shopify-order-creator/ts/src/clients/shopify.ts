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

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class ShopifyClient {
  constructor(private readonly store: Store) {}

  async execute<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>> {
    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      throw new Error(`Shopify request failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as GraphQLResponse<T>;
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
  ): Promise<ShopifyOrderResult> {
    const shippingRateHandle = await this.fetchShippingRateHandle(customerEmail, lineItems, firstName, lastName);

    const result = await this.execute<{
      draftOrderCreate: {
        draftOrder?: { id?: string };
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(DRAFT_ORDER_CREATE, {
      input: {
        note: "QA regression order",
        email: customerEmail,
        taxExempt: false,
        tags: ["foo", "bar"],
        billingAddress: mockAddress(firstName, lastName),
        shippingAddress: mockAddress(firstName, lastName),
        lineItems,
        shippingLine: { shippingRateHandle },
      },
    });

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

  /** Mirrors orders_processor.fetch_shipping_rates: calculates real rates and returns the first handle. */
  private async fetchShippingRateHandle(
    customerEmail: string,
    lineItems: ShopifyLineItemInput[],
    firstName: string,
    lastName: string,
  ): Promise<string> {
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
    return rates[0].handle;
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
