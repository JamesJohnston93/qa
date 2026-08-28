"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.REALLOCATION_SETTLE_INTERVAL_SECONDS = exports.REALLOCATION_SETTLE_WINDOW_SECONDS = void 0;
exports.reallocationResolved = reallocationResolved;
exports.waitForReallocation = waitForReallocation;
exports.rejectShipment = rejectShipment;
const dynamoReader_1 = require("../readers/dynamoReader");
const polling_1 = require("../polling");
const reject_1 = require("../clients/reject");
const fulfilFlow_1 = require("./fulfilFlow");
exports.REALLOCATION_SETTLE_WINDOW_SECONDS = 240;
exports.REALLOCATION_SETTLE_INTERVAL_SECONDS = 2;
/**
 * True once every one of the original shipment's items has EITHER landed on
 * a new `shipmentId` (resolved, and different from the rejected shipment)
 * OR gone `UNDELIVERABLE`. False if any original item's row is missing
 * entirely, still points at the rejected shipment, or is still
 * unallocated (`shipmentId: null`, the intermediate "returned to the
 * allocator" state) — see file header for why that intermediate state must
 * not be mistaken for done.
 */
function reallocationResolved(items, originalItemIds, originalShipmentId) {
    const targets = items.filter((item) => originalItemIds.includes(item.shipmentItemId));
    if (targets.length !== originalItemIds.length) {
        return false;
    }
    return targets.every((item) => (item.shipmentId !== null && item.shipmentId !== originalShipmentId) || item.status === dynamoReader_1.UNDELIVERABLE);
}
/**
 * Polls `getShipmentItemsByPk` until `reallocationResolved` holds. Mirrors
 * `fulfilFlow.ts`'s fulfilment-settle wait shape (a local, named `pollUntil`
 * call) rather than duplicating the poll loop itself.
 */
async function waitForReallocation(reader, orderPk, originalItemIds, originalShipmentId, verbose = false) {
    return (0, polling_1.pollUntil)(() => reader.getShipmentItemsByPk(orderPk), (items) => reallocationResolved(items, originalItemIds, originalShipmentId), exports.REALLOCATION_SETTLE_WINDOW_SECONDS, exports.REALLOCATION_SETTLE_INTERVAL_SECONDS, "reallocation_settle", verbose);
}
async function rejectShipment(deps, orderPk, shipmentId, itemIdsToReject, reason = reject_1.DEFAULT_REJECTION_REASON) {
    const { reader, rejectClient, verbose = false } = deps;
    const allItems = await reader.getShipmentItemsByPk(orderPk);
    const originalItems = allItems.filter((item) => item.shipmentId === shipmentId);
    if (originalItems.length === 0) {
        throw new Error(`No items found on shipment ${shipmentId} for order ${orderPk}`);
    }
    const summaries = await reader.getShipmentsByPk(orderPk);
    const currentSummary = summaries.find((summary) => summary.shipmentId === shipmentId);
    if ((0, fulfilFlow_1.isAlreadyFulfilled)(currentSummary)) {
        throw new Error(`Shipment ${shipmentId} is already FULFILLED — reject is never valid on a fulfilled shipment (JJ, TAA-31, 2026-08-23)`);
    }
    const payload = (0, reject_1.buildRejectPayload)(shipmentId, itemIdsToReject, reason);
    await rejectClient.reject(payload);
    const originalItemIds = originalItems.map((item) => item.shipmentItemId);
    const { value: resolvedItems, elapsed } = await waitForReallocation(reader, orderPk, originalItemIds, shipmentId, verbose);
    const items = originalItemIds.map((id) => {
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
