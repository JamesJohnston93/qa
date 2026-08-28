/**
 * Reject-outcome assertions (TAA-31 slice F/G). Pure — offline-testable,
 * same pattern as verify/shipments.ts's assertAllocation.
 */

import { UNDELIVERABLE, type TransactionRow } from "../readers/dynamoReader";
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

/**
 * TAA-31 slice A proposal item 5: confirms the `TRANSACTION#` event log
 * carries exactly one `SHIPMENT_REJECTED` row, and exactly one
 * `SHIPMENT_ITEM_REJECTED` row per rejected item (i.e. per item actually
 * *listed* in the reject call — `reject_reallocate` lists one,
 * `reject_undeliverable` lists every item on the shipment; confirmed live
 * across every trial to date that only listed items get their own
 * `SHIPMENT_ITEM_REJECTED` row, not every item on the shipment).
 * `SHIPMENT_ITEM_REJECTED` rows correlate to items via `shipmentItemInfo`'s
 * `id` field — confirmed live shape, `ts/signoffs/TAA-31-slice-f.md`.
 */
export function assertRejectTransactions(transactions: TransactionRow[], rejectedItemIds: string[], orderName: string): void {
  const shipmentRejected = transactions.filter((t) => t.event === "SHIPMENT_REJECTED");
  if (shipmentRejected.length !== 1) {
    throw new VerificationError(
      "reject.transactions.shipment_rejected",
      1,
      shipmentRejected.length,
      `order ${orderName}: expected exactly one SHIPMENT_REJECTED transaction, got ${shipmentRejected.length}`,
    );
  }

  const itemRejectedCounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.event !== "SHIPMENT_ITEM_REJECTED") {
      continue;
    }
    for (const info of transaction.shipmentItemInfo) {
      const id = String(info.id ?? "");
      itemRejectedCounts.set(id, (itemRejectedCounts.get(id) ?? 0) + 1);
    }
  }

  const bad = rejectedItemIds.filter((id) => itemRejectedCounts.get(id) !== 1);
  if (bad.length > 0) {
    throw new VerificationError(
      "reject.transactions.item_rejected",
      rejectedItemIds.map((id) => ({ id, expectedCount: 1 })),
      rejectedItemIds.map((id) => ({ id, actualCount: itemRejectedCounts.get(id) ?? 0 })),
      `order ${orderName}: expected exactly one SHIPMENT_ITEM_REJECTED transaction per rejected item, mismatch for: ${bad.join(", ")}`,
    );
  }
}
