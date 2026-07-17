/** Undeliverable -> Shopify refund checks. Ports regression/verify/refunds.py. */

import type { ShopifyOrderSnapshot } from "../readers/shopifyReader";
import { VerificationError } from "./index";

/**
 * A Shopify refund exists covering exactly the expected {sku: quantity}.
 *
 * Used for undeliverable (full or partial) cases: the undie item(s) must be
 * refunded in Shopify before their rows are removed from the AWS tables.
 */
export function assertRefundForSkus(
  snapshot: ShopifyOrderSnapshot,
  expectedRefundSkus: Record<string, number>,
): void {
  const refunded: Record<string, number> = {};
  for (const refund of snapshot.refunds) {
    for (const item of refund.items) {
      if (item.sku) {
        refunded[item.sku] = (refunded[item.sku] ?? 0) + item.quantity;
      }
    }
  }

  const expectedKeys = Object.keys(expectedRefundSkus);
  const refundedKeys = Object.keys(refunded);
  const equal =
    expectedKeys.length === refundedKeys.length && expectedKeys.every((key) => refunded[key] === expectedRefundSkus[key]);

  if (!equal) {
    throw new VerificationError(
      "shopify.refund",
      expectedRefundSkus,
      refunded,
      `order ${snapshot.name}; ${snapshot.refunds.length} refund(s) present`,
    );
  }
}

/** Fully-allocated orders must have no refunds. */
export function assertNoRefund(snapshot: ShopifyOrderSnapshot): void {
  if (snapshot.refunds.length > 0) {
    throw new VerificationError(
      "shopify.no_refund",
      [],
      snapshot.refunds.map((r) => r.id),
      `order ${snapshot.name}`,
    );
  }
}
