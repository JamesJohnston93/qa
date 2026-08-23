/**
 * Allocation-reflection checks (TAA-38) — does what Shopify shows as
 * fulfilled match what the OMS actually allocated in DynamoDB?
 *
 * There is no shared id between the two systems for "which Shopify
 * Fulfillment corresponds to which staging-shipments SHIPMENT# row" — the
 * fulfil payload (clients/fulfilment.ts) carries the shipment's own ids
 * only, nothing Shopify-side ever comes back with them (confirmed live,
 * TAA-34/35). So a fulfilment is matched to a shipment by SKU/unit-count
 * signature instead: cases/baselineCases.ts keeps every shipment in an
 * order SKU-disjoint from every other shipment in that same order (by
 * design, for the unrelated reason of making `--parallel` safe — see that
 * file), which makes the signature match unambiguous for every scenario the
 * harness actually exercises. Confirmed live across single/combination/
 * undeliverable on both stores (ts/signoffs/TAA-38.md).
 */

import {
  UNDELIVERABLE,
  groupItemsByShipment,
  type ShipmentItem,
} from "../readers/dynamoReader";
import { fulfilmentSkuQuantities, type ShopifyFulfilment } from "../readers/shopifyReader";
import { shopifyLocationForStoreNumber } from "../locations";
import type { Store } from "../config";
import { VerificationError } from "./index";

export interface ExpectedShipmentAllocation {
  shipmentId: string;
  allocatedStore: string; // plain store number, e.g. "100" — never UNDELIVERABLE
  skuUnits: Record<string, number>;
}

function mapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * The real (non-undeliverable) shipments a fulfilment set is compared
 * against, derived from ITEM# rows. Pure — offline-testable.
 *
 * `groupItemsByShipment` (readers/dynamoReader.ts) already excludes
 * unallocated items (`shipmentId === null`), which covers undeliverable
 * items too — they never get a shipmentId. Nothing here treats
 * `UNDELIVERABLE` specially beyond that; it's the absence of a shipmentId
 * that does the exclusion.
 */
export function expectedShipmentAllocations(items: ShipmentItem[]): ExpectedShipmentAllocation[] {
  const grouped = groupItemsByShipment(items);
  const out: ExpectedShipmentAllocation[] = [];
  for (const [shipmentId, shipmentItems] of grouped) {
    const skuUnits: Record<string, number> = {};
    for (const item of shipmentItems) {
      skuUnits[item.sku] = (skuUnits[item.sku] ?? 0) + 1;
    }
    const store = shipmentItems[0].store;
    if (!store || store === UNDELIVERABLE) {
      // Shouldn't happen given groupItemsByShipment's contract (an allocated
      // shipment always carries a real store) — never assert against a
      // bogus allocation instead of silently treating it as valid.
      throw new Error(
        `shipment ${shipmentId} has a shipmentId but no real allocatedStore (got ${JSON.stringify(store)}) — ` +
          "unexpected DynamoDB state, not a normal undeliverable/unallocated item.",
      );
    }
    out.push({ shipmentId, allocatedStore: store, skuUnits });
  }
  return out;
}

/**
 * Matches every expected (non-undeliverable) shipment to exactly one
 * Shopify fulfilment by SKU/unit-count signature. Throws
 * VerificationError — carrying both systems' state — on any of:
 *   - a shipment with no matching fulfilment at all (never fulfilled, or
 *     fulfilled with the wrong composition)
 *   - a shipment matched by more than one fulfilment ("one fulfilment per
 *     shipment" violated — Shopify shows the same shipment fulfilled twice)
 *   - a leftover Shopify fulfilment matching no expected shipment (includes
 *     the "fulfilment raised for an undeliverable item" case, since
 *     undeliverable items never appear in `expected`)
 */
export function matchFulfilmentsToShipments(
  fulfilments: ShopifyFulfilment[],
  expected: ExpectedShipmentAllocation[],
  orderName: string,
): Array<{ shipment: ExpectedShipmentAllocation; fulfilment: ShopifyFulfilment }> {
  const remaining = fulfilments.map((fulfilment) => ({ fulfilment, skuUnits: fulfilmentSkuQuantities(fulfilment) }));
  const matches: Array<{ shipment: ExpectedShipmentAllocation; fulfilment: ShopifyFulfilment }> = [];

  for (const shipment of expected) {
    const candidates = remaining.filter((entry) => mapsEqual(entry.skuUnits, shipment.skuUnits));

    if (candidates.length === 0) {
      throw new VerificationError(
        "allocation.fulfilment_alignment",
        shipment.skuUnits,
        fulfilments.map((f) => fulfilmentSkuQuantities(f)),
        `order ${orderName}, shipment ${shipment.shipmentId}: no Shopify fulfilment matches this shipment's SKU/unit composition`,
      );
    }
    if (candidates.length > 1) {
      throw new VerificationError(
        "allocation.one_fulfilment_per_shipment",
        1,
        candidates.length,
        `order ${orderName}, shipment ${shipment.shipmentId}: ${candidates.length} Shopify fulfilments share this shipment's SKU signature ${JSON.stringify(shipment.skuUnits)}`,
      );
    }

    const matched = candidates[0];
    matches.push({ shipment, fulfilment: matched.fulfilment });
    remaining.splice(remaining.indexOf(matched), 1);
  }

  if (remaining.length > 0) {
    throw new VerificationError(
      "allocation.no_unexplained_fulfilments",
      expected.length,
      fulfilments.length,
      `order ${orderName}: ${remaining.length} Shopify fulfilment(s) don't correspond to any allocated shipment — ` +
        `${JSON.stringify(remaining.map((entry) => entry.skuUnits))} (a fulfilment raised for an undeliverable item would surface here)`,
    );
  }

  return matches;
}

/**
 * Each matched fulfilment's location resolves (via locations.ts) to the
 * same store the shipment was actually allocated to.
 */
export function assertFulfilmentLocations(
  matches: Array<{ shipment: ExpectedShipmentAllocation; fulfilment: ShopifyFulfilment }>,
  store: Store,
  orderName: string,
): void {
  for (const { shipment, fulfilment } of matches) {
    const expectedLocationId = shopifyLocationForStoreNumber(store, shipment.allocatedStore);
    if (fulfilment.locationId !== expectedLocationId) {
      throw new VerificationError(
        "allocation.fulfilment_location",
        { allocatedStore: shipment.allocatedStore, locationId: expectedLocationId },
        { locationId: fulfilment.locationId, locationName: fulfilment.locationName },
        `order ${orderName}, shipment ${shipment.shipmentId}`,
      );
    }
  }
}

/**
 * No Shopify fulfilment references any SKU belonging to an undeliverable
 * item — the direct check behind the ticket's "no fulfilment is raised for
 * undeliverable items" line, independent of the shipment-matching above (it
 * would also catch a fulfilment that happens to share a SKU with, but not
 * exactly equal, an undeliverable item's shipment).
 */
export function assertNoFulfilmentForUndeliverable(
  fulfilments: ShopifyFulfilment[],
  undeliverableSkus: string[],
  orderName: string,
): void {
  if (undeliverableSkus.length === 0) {
    return;
  }
  const undeliverableSet = new Set(undeliverableSkus);
  const offending: Array<{ fulfilmentId: string; sku: string }> = [];
  for (const fulfilment of fulfilments) {
    for (const item of fulfilment.items) {
      if (item.sku !== null && undeliverableSet.has(item.sku)) {
        offending.push({ fulfilmentId: fulfilment.id, sku: item.sku });
      }
    }
  }
  if (offending.length > 0) {
    throw new VerificationError(
      "allocation.no_fulfilment_for_undeliverable",
      `no fulfilment for ${JSON.stringify(undeliverableSkus)}`,
      offending,
      `order ${orderName}`,
    );
  }
}

/**
 * Full TAA-38 allocation-reflection check for one order: asserts no
 * fulfilment exists for any undeliverable SKU, matches the remaining
 * Shopify fulfilments to real shipments (SKU alignment +
 * one-fulfilment-per-shipment + no unexplained fulfilments), then asserts
 * each match's location against the allocated store. The undeliverable
 * check runs first deliberately — a fulfilment wrongly raised for an
 * undeliverable item would also fail shipment-matching (as an unexplained
 * fulfilment), but that error is generic; checking undeliverable SKUs first
 * gives the specific, more actionable failure. Composes the functions above
 * rather than re-deriving their logic — callers that only need one check
 * can call that function directly instead.
 */
export function assertAllocationReflection(
  fulfilments: ShopifyFulfilment[],
  shipmentItems: ShipmentItem[],
  store: Store,
  orderName: string,
): void {
  const undeliverableSkus = shipmentItems.filter((item) => item.store === UNDELIVERABLE).map((item) => item.sku);
  assertNoFulfilmentForUndeliverable(fulfilments, undeliverableSkus, orderName);

  const expected = expectedShipmentAllocations(shipmentItems);
  const matches = matchFulfilmentsToShipments(fulfilments, expected, orderName);
  assertFulfilmentLocations(matches, store, orderName);
}
