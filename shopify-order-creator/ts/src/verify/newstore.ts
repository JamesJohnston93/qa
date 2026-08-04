/** NewStore injected-order read-back checks (NS cases 7-8, TAA-17 step 3). No Python spec — see readers/newstoreReader.ts. */

import { skuQuantities, type NewStoreOrderSnapshot } from "../readers/newstoreReader";
import { VerificationError } from "./index";

function mapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * The injected order has propagated to the read-back endpoint and its
 * ordered_products exactly match the requested {sku: quantity} map.
 *
 * snapshot is null while NewStore hasn't indexed the order yet (expected
 * during the ~2s propagation window) — treated as "not found yet", not a
 * hard failure, so pollVerify keeps polling.
 */
export function assertNewStoreOrder(
  snapshot: NewStoreOrderSnapshot | null,
  expectedSkus: Record<string, number>,
  externalId: string,
): void {
  if (!snapshot) {
    throw new VerificationError("newstore.exists", "order present", "not found yet", `external_id ${externalId}`);
  }

  const actual = skuQuantities(snapshot);
  if (!mapsEqual(actual, expectedSkus)) {
    throw new VerificationError(
      "newstore.ordered_products",
      expectedSkus,
      actual,
      `external_id ${externalId}, order_uuid ${snapshot.orderUuid}`,
    );
  }
}
