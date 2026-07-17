/** Allocation-state checks against staging-shipments ITEM# rows. Ports regression/verify/shipments.py. */

import { REMOVED, type AllocationSummary, type ShipmentItem } from "../readers/dynamoReader";
import { VerificationError } from "./index";

function mapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * One ITEM# row per unit: total shipment units per SKU must equal the
 * ordered quantity (DynamoDB does NOT merge duplicates like Shopify does).
 */
export function assertUnitCounts(summary: AllocationSummary, expectedSkus: Record<string, number>, orderName: string): void {
  if (!mapsEqual(summary.skuUnits, expectedSkus)) {
    throw new VerificationError(
      "shipments.unit_counts",
      expectedSkus,
      summary.skuUnits,
      `order ${orderName}; by_store=${JSON.stringify(summary.byStore)}`,
    );
  }
}

/**
 * Each SKU landed where the seed plan forced it.
 *
 * expectedAllocation: {sku: storeNumberOrUNDELIVERABLE}, e.g.
 *   {"32625134": "100"} or {"33413679": "UNDELIVERABLE"}.
 */
export function assertAllocation(
  summary: AllocationSummary,
  expectedAllocation: Record<string, string>,
  orderName: string,
): void {
  if (summary.unallocated > 0) {
    throw new VerificationError(
      "shipments.allocated",
      "all items allocated or undeliverable",
      `${summary.unallocated} item(s) with no store value`,
      `order ${orderName}; by_store=${JSON.stringify(summary.byStore)}`,
    );
  }

  const actual: Record<string, Set<string>> = {};
  for (const [store, skus] of Object.entries(summary.byStore)) {
    for (const sku of skus) {
      if (!actual[sku]) {
        actual[sku] = new Set();
      }
      actual[sku].add(store);
    }
  }

  for (const [sku, expectedStore] of Object.entries(expectedAllocation)) {
    const stores = actual[sku];
    if (!stores) {
      throw new VerificationError(
        "shipments.allocation",
        { [sku]: expectedStore },
        { [sku]: null },
        `order ${orderName}: no ITEM# rows for sku`,
      );
    }
    const storesArray = Array.from(stores).sort();
    if (storesArray.length !== 1 || storesArray[0] !== String(expectedStore)) {
      throw new VerificationError(
        "shipments.allocation",
        { [sku]: String(expectedStore) },
        { [sku]: storesArray },
        `order ${orderName}`,
      );
    }
  }
}

/**
 * After undeliverable cleanup, the refunded SKUs' ITEM# rows have transitioned
 * to status REMOVED. The row is NOT deleted from staging-shipments (confirmed
 * live) - only its status changes, so this checks status rather than absence.
 */
export function assertItemsRemoved(shipmentItems: ShipmentItem[], removedSkus: string[], orderName: string): void {
  const notRemoved = Array.from(
    new Set(
      shipmentItems.filter((item) => removedSkus.includes(item.sku) && item.status !== REMOVED).map((item) => item.sku),
    ),
  ).sort();
  if (notRemoved.length > 0) {
    throw new VerificationError(
      "shipments.cleanup",
      `status=${REMOVED} for ${JSON.stringify([...removedSkus].sort())}`,
      `not yet ${REMOVED} for ${JSON.stringify(notRemoved)}`,
      `order ${orderName}`,
    );
  }
}
