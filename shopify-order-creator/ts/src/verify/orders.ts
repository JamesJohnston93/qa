/** Shopify order <-> staging-orders-v2 alignment checks. Ports regression/verify/orders.py. */

import { skuQuantities, type ShopifyOrderSnapshot } from "../readers/shopifyReader";
import { VerificationError } from "./index";

function mapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}

/**
 * The Shopify order exists, is paid, and its line items exactly match the
 * requested {sku: quantity} map (duplicate-line-item safe).
 */
export function assertShopifyOrder(snapshot: ShopifyOrderSnapshot, expectedSkus: Record<string, number>): void {
  if (snapshot.financialStatus !== "PAID") {
    throw new VerificationError("shopify.financial_status", "PAID", snapshot.financialStatus, `order ${snapshot.name}`);
  }

  const actual = skuQuantities(snapshot);
  if (!mapsEqual(actual, expectedSkus)) {
    throw new VerificationError("shopify.line_items", expectedSkus, actual, `order ${snapshot.name}`);
  }
}

/** staging-orders-v2 item content matches the order exactly. */
export function assertOrdersTableAlignment(
  awsSkuQuantities: Record<string, number>,
  expectedSkus: Record<string, number>,
  orderName: string,
): void {
  if (!mapsEqual(awsSkuQuantities, expectedSkus)) {
    throw new VerificationError("orders_table.items", expectedSkus, awsSkuQuantities, `order ${orderName}`);
  }
}
