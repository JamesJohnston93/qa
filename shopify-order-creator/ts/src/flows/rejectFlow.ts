/**
 * Reallocation-resolved poll predicate — TAA-31, slice C. Promotes
 * `probe-reject.ts`'s hand-rolled `reallocationResolved()` (TAA-31 slices
 * A/B) into production code with its own offline tests, mirroring
 * `flows/fulfilFlow.ts`'s `itemCountsSettled`/`isFulfilmentSettled` shape.
 *
 * Learned the hard way in slice A (order #9949): a naive "state hasn't
 * changed for N ticks" heuristic is NOT a safe terminal signal for
 * reallocation. That order spent a stretch with both of a rejected
 * shipment's items sitting at `status: OPEN`, `shipmentId: null` — returned
 * to the allocator, not yet re-picked-up — which looked stable for several
 * poll ticks before reallocation actually resumed. A poll loop trusting
 * "unchanged" as "done" would have reported a false settle. The predicate
 * here requires a POSITIVE terminal condition instead: every one of the
 * ORIGINAL shipment's items (not just the rejected one — the contract
 * returns the whole shipment to the allocator) must have either landed on a
 * genuinely NEW shipment, or gone UNDELIVERABLE.
 *
 * Settle timing measured live across 4 trials (TAA-31 slices A/B, see
 * ts/signoffs/TAA-31-slice-a.md and -slice-b.md): 16.5s, >14.5s (imprecise —
 * the naive heuristic's false-settle run), 20.6s, 30.9s. `REALLOCATION_
 * SETTLE_WINDOW_SECONDS` below is sized with generous headroom over that —
 * the same reasoning this project already applies to the fulfilment-settle
 * window (150s against a measured 6.5-9.0s) — not tightened on a 4-sample n.
 */

import type { DynamoReader, ShipmentItem } from "../readers/dynamoReader";
import { UNDELIVERABLE } from "../readers/dynamoReader";
import { pollUntil, type PollResult } from "../polling";
import { buildRejectPayload, DEFAULT_REJECTION_REASON, type RejectClient } from "../clients/reject";
import { isAlreadyFulfilled } from "./fulfilFlow";

export const REALLOCATION_SETTLE_WINDOW_SECONDS = 240;
export const REALLOCATION_SETTLE_INTERVAL_SECONDS = 2;

/**
 * True once every one of the original shipment's items has EITHER landed on
 * a new `shipmentId` (resolved, and different from the rejected shipment)
 * OR gone `UNDELIVERABLE`. False if any original item's row is missing
 * entirely, still points at the rejected shipment, or is still
 * unallocated (`shipmentId: null`, the intermediate "returned to the
 * allocator" state) — see file header for why that intermediate state must
 * not be mistaken for done.
 */
export function reallocationResolved(
  items: ShipmentItem[],
  originalItemIds: string[],
  originalShipmentId: string,
): boolean {
  const targets = items.filter((item) => originalItemIds.includes(item.shipmentItemId));
  if (targets.length !== originalItemIds.length) {
    return false;
  }
  return targets.every(
    (item) => (item.shipmentId !== null && item.shipmentId !== originalShipmentId) || item.status === UNDELIVERABLE,
  );
}

/**
 * Polls `getShipmentItemsByPk` until `reallocationResolved` holds. Mirrors
 * `fulfilFlow.ts`'s fulfilment-settle wait shape (a local, named `pollUntil`
 * call) rather than duplicating the poll loop itself.
 */
export async function waitForReallocation(
  reader: DynamoReader,
  orderPk: string,
  originalItemIds: string[],
  originalShipmentId: string,
  verbose = false,
): Promise<PollResult<ShipmentItem[]>> {
  return pollUntil(
    () => reader.getShipmentItemsByPk(orderPk),
    (items) => reallocationResolved(items, originalItemIds, originalShipmentId),
    REALLOCATION_SETTLE_WINDOW_SECONDS,
    REALLOCATION_SETTLE_INTERVAL_SECONDS,
    "reallocation_settle",
    verbose,
  );
}

/**
 * Whole-shipment reject — TAA-31, slice D. Mirrors `fulfilFlow.ts`'s
 * `fulfilOrder()` shape: takes ids already resolved by the caller, drives
 * the client call, then waits for the outcome to settle, returning a
 * structured per-item result rather than a bare HTTP response.
 *
 * Only the listed `itemIdsToReject` go in the payload — the contract
 * (TAA-31 slice A) still returns EVERY item on the shipment to the
 * allocator regardless of the list's size, so `originalItemIds` (all items
 * currently on `shipmentId`, read fresh from Dynamo) is what
 * `waitForReallocation` waits on, not just the listed ones.
 *
 * Mandatory pre-check, per JJ (2026-08-23): reject is NEVER valid on an
 * already-`FULFILLED` shipment. Reuses `fulfilFlow.ts`'s
 * `isAlreadyFulfilled` rather than redefining the same check — same reason
 * TAA-41 made it mandatory for fulfil: the endpoint provides no guard of its
 * own, the caller has to read the row itself.
 */
export interface RejectShipmentDeps {
  reader: DynamoReader;
  rejectClient: RejectClient;
  verbose?: boolean;
}

export interface RejectedItemOutcome {
  shipmentItemId: string;
  wasListed: boolean;
  newShipmentId: string | null;
  store: string | null;
  status: string;
}

export interface RejectShipmentResult {
  orderPk: string;
  originalShipmentId: string;
  rejectedItemIds: string[];
  items: RejectedItemOutcome[];
  elapsedSeconds: number;
}

export async function rejectShipment(
  deps: RejectShipmentDeps,
  orderPk: string,
  shipmentId: string,
  itemIdsToReject: string[],
  reason: string = DEFAULT_REJECTION_REASON,
): Promise<RejectShipmentResult> {
  const { reader, rejectClient, verbose = false } = deps;

  const allItems = await reader.getShipmentItemsByPk(orderPk);
  const originalItems = allItems.filter((item) => item.shipmentId === shipmentId);
  if (originalItems.length === 0) {
    throw new Error(`No items found on shipment ${shipmentId} for order ${orderPk}`);
  }

  const summaries = await reader.getShipmentsByPk(orderPk);
  const currentSummary = summaries.find((summary) => summary.shipmentId === shipmentId);
  if (isAlreadyFulfilled(currentSummary)) {
    throw new Error(
      `Shipment ${shipmentId} is already FULFILLED — reject is never valid on a fulfilled shipment (JJ, TAA-31, 2026-08-23)`,
    );
  }

  const payload = buildRejectPayload(shipmentId, itemIdsToReject, reason);
  await rejectClient.reject(payload);

  const originalItemIds = originalItems.map((item) => item.shipmentItemId);
  const { value: resolvedItems, elapsed } = await waitForReallocation(reader, orderPk, originalItemIds, shipmentId, verbose);

  const items: RejectedItemOutcome[] = originalItemIds.map((id) => {
    const resolved = resolvedItems.find((item) => item.shipmentItemId === id);
    return {
      shipmentItemId: id,
      wasListed: itemIdsToReject.includes(id),
      newShipmentId: resolved?.shipmentId ?? null,
      store: resolved?.store ?? null,
      status: resolved?.status ?? "UNKNOWN",
    };
  });

  return { orderPk, originalShipmentId: shipmentId, rejectedItemIds: itemIdsToReject, items, elapsedSeconds: elapsed };
}
