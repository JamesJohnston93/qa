/**
 * Shopify order read-back for verification.
 *
 * NOTE: Shopify merges duplicate line items (3x same SKU = one line item
 * with quantity 3). DynamoDB and NewStore keep one row per unit. Assertions
 * must compare SKU -> total-quantity maps, never line counts — use
 * skuQuantities(). The same merge applies within a single fulfilment's
 * fulfillmentLineItems (TAA-38) — use fulfilmentSkuQuantities() there too.
 */

import type { ShopifyClient } from "../clients/shopify";

export interface ShopifyLineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface ShopifyRefund {
  id: string;
  createdAt?: string;
  total: number;
  items: Array<{ sku: string | null; quantity: number }>;
}

export interface ShopifyFulfilmentLineItem {
  sku: string | null;
  quantity: number;
}

/**
 * One Shopify Fulfillment record (TAA-38). `Order.fulfillments` is a plain
 * list, not a connection — confirmed live via schema introspection against
 * API 2025-10 (`fulfillments(first: Int, query: String): [Fulfillment!]!`),
 * unlike `lineItems`/`refunds.refundLineItems` above. `locationId`/
 * `locationName` come from `Fulfillment.location`, nullable per the schema —
 * a fulfilment with no resolvable location surfaces as `null` here so a
 * caller reports it as a mismatch with real data instead of crashing.
 */
export interface ShopifyFulfilment {
  id: string;
  status: string | null;
  locationId: string | null;
  locationName: string | null;
  items: ShopifyFulfilmentLineItem[];
}

export interface ShopifyOrderSnapshot {
  id: string;
  name: string;
  financialStatus: string | null;
  lineItems: ShopifyLineItem[];
  refunds: ShopifyRefund[];
  fulfilments: ShopifyFulfilment[];
  raw: unknown;
}

const ORDER_QUERY = `
  query getOrder($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        createdAt
        displayFinancialStatus
        lineItems(first: 50) {
          edges {
            node {
              sku
              quantity
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
        refunds {
          id
          createdAt
          totalRefundedSet { shopMoney { amount } }
          refundLineItems(first: 50) {
            edges {
              node {
                quantity
                lineItem { sku }
              }
            }
          }
        }
        fulfillments(first: 50) {
          id
          status
          location {
            id
            name
          }
          fulfillmentLineItems(first: 50) {
            edges {
              node {
                quantity
                lineItem { sku }
              }
            }
          }
        }
      }
    }
  }
`;

interface OrderQueryResult {
  node: {
    id: string;
    name: string;
    displayFinancialStatus: string | null;
    lineItems: {
      edges: Array<{
        node: { sku: string; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } } };
      }>;
    };
    refunds: Array<{
      id: string;
      createdAt?: string;
      totalRefundedSet: { shopMoney: { amount: string } };
      refundLineItems: {
        edges: Array<{ node: { quantity: number; lineItem: { sku: string } | null } }>;
      };
    }>;
    fulfillments: Array<{
      id: string;
      status: string | null;
      location: { id: string; name: string } | null;
      fulfillmentLineItems: {
        edges: Array<{ node: { quantity: number; lineItem: { sku: string } | null } }>;
      };
    }>;
  } | null;
}

export async function getOrder(client: ShopifyClient, orderGid: string): Promise<ShopifyOrderSnapshot> {
  const result = await client.execute<OrderQueryResult>(ORDER_QUERY, { id: orderGid });
  if (result.errors && result.errors.length > 0) {
    throw new Error(`order read-back failed for ${orderGid}: ${JSON.stringify(result.errors)}`);
  }
  const node = result.data?.node;
  if (!node) {
    throw new Error(`order ${orderGid} not found in Shopify: ${JSON.stringify(result)}`);
  }

  const lineItems: ShopifyLineItem[] = node.lineItems.edges.map((edge) => ({
    sku: edge.node.sku,
    quantity: Number(edge.node.quantity),
    unitPrice: Number(edge.node.originalUnitPriceSet.shopMoney.amount),
  }));

  const refunds: ShopifyRefund[] = node.refunds.map((refund) => ({
    id: refund.id,
    createdAt: refund.createdAt,
    total: Number(refund.totalRefundedSet.shopMoney.amount),
    items: refund.refundLineItems.edges.map((edge) => ({
      sku: edge.node.lineItem?.sku ?? null,
      quantity: Number(edge.node.quantity),
    })),
  }));

  const fulfilments: ShopifyFulfilment[] = node.fulfillments.map((fulfillment) => ({
    id: fulfillment.id,
    status: fulfillment.status,
    locationId: fulfillment.location?.id ?? null,
    locationName: fulfillment.location?.name ?? null,
    items: fulfillment.fulfillmentLineItems.edges.map((edge) => ({
      sku: edge.node.lineItem?.sku ?? null,
      quantity: Number(edge.node.quantity),
    })),
  }));

  return {
    id: node.id,
    name: node.name,
    financialStatus: node.displayFinancialStatus,
    lineItems,
    refunds,
    fulfilments,
    raw: node,
  };
}

/** SKU -> total quantity map (duplicate-line-item safe). */
export function skuQuantities(snapshot: ShopifyOrderSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of snapshot.lineItems) {
    out[item.sku] = (out[item.sku] ?? 0) + item.quantity;
  }
  return out;
}

/**
 * SKU -> total quantity map for one fulfilment (duplicate-line-item safe —
 * see the module doc comment: the same Shopify line-item merge that applies
 * at order level applies within a fulfilment's fulfillmentLineItems too).
 */
export function fulfilmentSkuQuantities(fulfilment: ShopifyFulfilment): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of fulfilment.items) {
    if (item.sku === null) {
      continue;
    }
    out[item.sku] = (out[item.sku] ?? 0) + item.quantity;
  }
  return out;
}

/** Numeric tail of a Shopify order GID ('gid://shopify/Order/123' -> '123'). */
export function orderIdTail(orderGid: string): string {
  return orderGid.split("/").pop() ?? "";
}
