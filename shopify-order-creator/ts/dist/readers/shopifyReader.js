"use strict";
/**
 * Shopify order read-back for verification. Ports
 * regression/readers/shopify_reader.py.
 *
 * NOTE: Shopify merges duplicate line items (3x same SKU = one line item
 * with quantity 3). DynamoDB and NewStore keep one row per unit. Assertions
 * must compare SKU -> total-quantity maps, never line counts — use
 * skuQuantities().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrder = getOrder;
exports.skuQuantities = skuQuantities;
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
    return {
        id: node.id,
        name: node.name,
        financialStatus: node.displayFinancialStatus,
        lineItems,
        refunds,
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
/** Numeric tail of a Shopify order GID ('gid://shopify/Order/123' -> '123'). */
function orderIdTail(orderGid) {
    return orderGid.split("/").pop() ?? "";
}
