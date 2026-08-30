"use strict";
/**
 * Shopify order read-back for verification.
 *
 * NOTE: Shopify merges duplicate line items (3x same SKU = one line item
 * with quantity 3). DynamoDB and NewStore keep one row per unit. Assertions
 * must compare SKU -> total-quantity maps, never line counts — use
 * skuQuantities(). The same merge applies within a single fulfilment's
 * fulfillmentLineItems (TAA-38) — use fulfilmentSkuQuantities() there too.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrder = getOrder;
exports.skuQuantities = skuQuantities;
exports.fulfilmentSkuQuantities = fulfilmentSkuQuantities;
exports.orderIdTail = orderIdTail;
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
              id
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
                id
                quantity
                lineItem { sku }
              }
            }
          }
        }
        fulfillmentOrders(first: 10) {
          edges {
            node {
              id
              status
              fulfillmentHolds {
                id
                reason
                reasonNotes
              }
            }
          }
        }
      }
    }
  }
`;
async function getOrder(client, orderGid) {
    const result = await client.execute(ORDER_QUERY, { id: orderGid });
    if (result.errors && result.errors.length > 0) {
        throw new Error(`order read-back failed for ${orderGid}: ${JSON.stringify(result.errors)}`);
    }
    const node = result.data?.node;
    if (!node) {
        throw new Error(`order ${orderGid} not found in Shopify: ${JSON.stringify(result)}`);
    }
    const lineItems = node.lineItems.edges.map((edge) => ({
        id: edge.node.id,
        sku: edge.node.sku,
        quantity: Number(edge.node.quantity),
        unitPrice: Number(edge.node.originalUnitPriceSet.shopMoney.amount),
    }));
    const refunds = node.refunds.map((refund) => ({
        id: refund.id,
        createdAt: refund.createdAt,
        total: Number(refund.totalRefundedSet.shopMoney.amount),
        items: refund.refundLineItems.edges.map((edge) => ({
            sku: edge.node.lineItem?.sku ?? null,
            quantity: Number(edge.node.quantity),
        })),
    }));
    const fulfilments = node.fulfillments.map((fulfillment) => ({
        id: fulfillment.id,
        status: fulfillment.status,
        locationId: fulfillment.location?.id ?? null,
        locationName: fulfillment.location?.name ?? null,
        items: fulfillment.fulfillmentLineItems.edges.map((edge) => ({
            id: edge.node.id,
            sku: edge.node.lineItem?.sku ?? null,
            quantity: Number(edge.node.quantity),
        })),
    }));
    const fulfillmentOrders = node.fulfillmentOrders.edges.map((edge) => ({
        id: edge.node.id,
        status: edge.node.status,
        holds: edge.node.fulfillmentHolds.map((hold) => ({
            id: hold.id,
            reason: hold.reason,
            reasonNotes: hold.reasonNotes,
        })),
    }));
    return {
        id: node.id,
        name: node.name,
        financialStatus: node.displayFinancialStatus,
        lineItems,
        refunds,
        fulfilments,
        fulfillmentOrders,
        raw: node,
    };
}
/** SKU -> total quantity map (duplicate-line-item safe). */
function skuQuantities(snapshot) {
    const out = {};
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
function fulfilmentSkuQuantities(fulfilment) {
    const out = {};
    for (const item of fulfilment.items) {
        if (item.sku === null) {
            continue;
        }
        out[item.sku] = (out[item.sku] ?? 0) + item.quantity;
    }
    return out;
}
/** Numeric tail of a Shopify order GID ('gid://shopify/Order/123' -> '123'). */
function orderIdTail(orderGid) {
    return orderGid.split("/").pop() ?? "";
}
