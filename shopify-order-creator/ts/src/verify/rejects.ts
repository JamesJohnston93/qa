/**
 * Reject-outcome assertions (TAA-31 slice F/G). Pure — offline-testable,
 * same pattern as verify/shipments.ts's assertAllocation.
 */

import { UNDELIVERABLE } from "../readers/dynamoReader";
import { VerificationError } from "./index";
import type { RejectedItemOutcome } from "../flows/rejectFlow";

/** reject_undeliverable: every item must have resolved UNDELIVERABLE. */
export function assertAllUndeliverable(items: RejectedItemOutcome[], orderName: string): void {
  const bad = items.filter((item) => item.status !== UNDELIVERABLE);
  if (bad.length > 0) {
    throw new VerificationError(
      "reject.outcome",
      UNDELIVERABLE,
      bad,
      `order ${orderName}: ${bad.length} of ${items.length} item(s) did not resolve ${UNDELIVERABLE}`,
    );
  }
}

/**
 * reject_reallocate: every item must have landed on a genuinely new
 * shipment (not the rejected one), or gone UNDELIVERABLE — matches slice A's
 * proposal item 3, which tolerates either terminal outcome.
 */
export function assertReallocatedOrUndeliverable(
  items: RejectedItemOutcome[],
  originalShipmentId: string,
  orderName: string,
): void {
  const bad = items.filter(
    (item) => item.status !== UNDELIVERABLE && (item.newShipmentId === null || item.newShipmentId === originalShipmentId),
  );
  if (bad.length > 0) {
    throw new VerificationError(
      "reject.outcome",
      "new shipmentId or UNDELIVERABLE",
      bad,
      `order ${orderName}: ${bad.length} of ${items.length} item(s) neither reallocated nor went ${UNDELIVERABLE}`,
    );
  }
}
