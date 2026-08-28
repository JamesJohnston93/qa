/**
 * Baseline case set v1 — "these always need to work and behave exactly the
 * same way." Declarative: each case states its inputs (SKUs, seed plan) and
 * its expected state in every system. The runner turns these into orders
 * and assertions.
 *
 * SKU isolation (TAA-14 Phase B, 2026-07-31; PS caught up to the same pool
 * size in TAA-22, 2026-08-04): both US and PS now have 14-SKU pools
 * (variants.ts). The 6 original cases use slots 0-9 (single=0, multi=1,
 * unique=2-4, split=5-6, undeliverable=7, partial_undeliverable=8-9); TAA-39
 * (slice F) adds fulfil_single=10 and fulfil_split=11-12; TAA-31 (slice F/G)
 * adds reject_reallocate and reject_undeliverable, BOTH on slot 13 — the
 * only slot shared by two cases. That's safe: `scheduler.ts`'s `buildWaves`
 * greedily separates any cases sharing a SKU into different waves (they run
 * sequentially relative to each other, never concurrently), and every case's
 * `prepareInventoryForCase` zeroes the SKU everywhere before reseeding, so
 * neither case can see the other's leftover state.
 *
 * Fulfilment cases (`fulfilment: true`) run through the exact same
 * seed/order/readback/allocation pipeline as the other six — the only
 * difference is runner.ts drives a fulfil + verify stage afterward (TAA-36/
 * 37/38's fulfilOrder/verify functions). Reject cases (`rejectMode` set)
 * follow the same principle but insert their extra stage(s) BEFORE the
 * refund branch instead of after — see `CaseDefinition.rejectMode`'s doc
 * comment and `ts/signoffs/TAA-31-slice-f.md`. Neither is a separate case
 * "kind": they still need the wave scheduler and progress tracker exactly
 * like the plain pipeline cases do, just with extra stages tacked in.
 *
 * NewStore SFS/OTC cases (7-8 in the design) live separately in
 * cases/newstoreCases.ts — they don't share this file's Shopify/Dynamo
 * pipeline shape at all (see that file's own doc comment).
 */

import { WEB_DC, STORE_99, CHERMSIDE_US, PS_STORE, type Store } from "../config";
import { skuPoolFor } from "../variants";
import type { RejectMode } from "../progress";

export const UNDELIVERABLE = "UNDELIVERABLE";

export interface CaseDefinition {
  kind: "pipeline";
  name: string;
  description: string;
  skuQuantities: Record<string, number>;
  seedPlan: Record<string, Record<string, number>>;
  expectedAllocation: Record<string, string>;
  expectedDecrements: Record<string, Record<string, number>>;
  expectedRefundSkus: Record<string, number>;
  cleanupSkus: string[];
  /** TAA-39: when true, runner.ts drives a fulfil + verify-fulfilment + allocation-reflection stage after the usual pipeline. */
  fulfilment: boolean;
  /**
   * TAA-31: when set, runner.ts drives a reject stage after the initial
   * allocation settles instead of finishing the pipeline normally.
   * "reallocate" rejects exactly one item on the shipment and expects it (and
   * every other original item) to land on a new shipment or go
   * UNDELIVERABLE; "undeliverable" rejects every item in one call and
   * expects all of them to go UNDELIVERABLE. See `ts/signoffs/TAA-31-slice-f.md`.
   */
  rejectMode?: RejectMode;
  /**
   * "reallocate" mode only: a backup store seeded fresh AFTER the initial
   * allocation settles, immediately before rejecting — slice D's finding
   * that this pool's ambient real per-store stock is too thin to trust for a
   * reliable reallocation target. Seeding after settle (not in `seedPlan`)
   * avoids perturbing the initial one-shipment shape.
   */
  rejectSeedStore?: string;
  rejectSeedQuantity?: number;
}

const REJECT_DESIGNATED_STORE: Record<Store, string> = { US: CHERMSIDE_US, PS: PS_STORE };

function storeNumber(location: string): string {
  // 'ATP#100' -> '100'. Expected-allocation values use plain store numbers.
  const parts = location.split("#");
  return parts[1];
}

/** Builds the case set for the given store from its real variant pool. */
export function buildCases(store: Store): Record<string, CaseDefinition> {
  const pool = skuPoolFor(store);
  if (pool.length < 4) {
    throw new Error(`variant pool for ${store} too small: ${JSON.stringify(pool)}`);
  }
  const sku = (i: number): string => pool[i % pool.length];

  const primary = WEB_DC;
  const secondary = STORE_99;
  const pNum = storeNumber(primary);
  const sNum = storeNumber(secondary);
  const TOP_UP = 99;

  const cases: CaseDefinition[] = [
    {
      kind: "pipeline",
      name: "single",
      description: "Single item, stock at one location -> one shipment there",
      skuQuantities: { [sku(0)]: 1 },
      seedPlan: { [sku(0)]: { [primary]: TOP_UP } },
      expectedAllocation: { [sku(0)]: pNum },
      expectedDecrements: { [sku(0)]: { [primary]: 1 } },
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: false,
    },
    {
      kind: "pipeline",
      name: "multi",
      description:
        "3x same SKU -> one shipment, three ITEM# rows (Shopify merges duplicate line items; Dynamo does not)",
      skuQuantities: { [sku(1)]: 3 },
      seedPlan: { [sku(1)]: { [primary]: TOP_UP } },
      expectedAllocation: { [sku(1)]: pNum },
      expectedDecrements: { [sku(1)]: { [primary]: 3 } },
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: false,
    },
    {
      kind: "pipeline",
      name: "unique",
      description: "3 different SKUs all stocked at one location -> one combined shipment",
      skuQuantities: { [sku(2)]: 1, [sku(3)]: 1, [sku(4)]: 1 },
      seedPlan: {
        [sku(2)]: { [primary]: TOP_UP },
        [sku(3)]: { [primary]: TOP_UP },
        [sku(4)]: { [primary]: TOP_UP },
      },
      expectedAllocation: { [sku(2)]: pNum, [sku(3)]: pNum, [sku(4)]: pNum },
      expectedDecrements: {
        [sku(2)]: { [primary]: 1 },
        [sku(3)]: { [primary]: 1 },
        [sku(4)]: { [primary]: 1 },
      },
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: false,
    },
    {
      kind: "pipeline",
      name: "split",
      description: "Each SKU stocked at a different store only -> one shipment per store",
      skuQuantities: { [sku(5)]: 1, [sku(6)]: 1 },
      seedPlan: {
        [sku(5)]: { [primary]: TOP_UP },
        [sku(6)]: { [secondary]: TOP_UP },
      },
      expectedAllocation: { [sku(5)]: pNum, [sku(6)]: sNum },
      expectedDecrements: {
        [sku(5)]: { [primary]: 1 },
        [sku(6)]: { [secondary]: 1 },
      },
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: false,
    },
    {
      kind: "pipeline",
      name: "undeliverable",
      description: "Zero stock everywhere -> UNDELIVERABLE, Shopify refund, rows removed from both AWS tables",
      skuQuantities: { [sku(7)]: 1 },
      seedPlan: {}, // zeroing everywhere IS the seed
      expectedAllocation: { [sku(7)]: UNDELIVERABLE },
      expectedDecrements: { [sku(7)]: {} }, // nothing to decrement
      expectedRefundSkus: { [sku(7)]: 1 },
      cleanupSkus: [sku(7)],
      fulfilment: false,
    },
    {
      kind: "pipeline",
      name: "partial_undeliverable",
      description: "One SKU stocked, one zero everywhere -> mixed: allocated shipment + refunded undeliverable",
      skuQuantities: { [sku(8)]: 1, [sku(9)]: 1 },
      seedPlan: { [sku(8)]: { [primary]: TOP_UP } }, // sku(9) stays zeroed everywhere
      expectedAllocation: { [sku(8)]: pNum, [sku(9)]: UNDELIVERABLE },
      expectedDecrements: { [sku(8)]: { [primary]: 1 } },
      expectedRefundSkus: { [sku(9)]: 1 },
      cleanupSkus: [sku(9)],
      fulfilment: false,
    },
    {
      kind: "pipeline",
      name: "fulfil_single",
      description:
        "One SKU, one shipment -> fulfilled end to end, tracking number lands in both AWS tables and Shopify's fulfilment matches the allocation (TAA-39)",
      skuQuantities: { [sku(10)]: 1 },
      seedPlan: { [sku(10)]: { [primary]: TOP_UP } },
      expectedAllocation: { [sku(10)]: pNum },
      expectedDecrements: { [sku(10)]: { [primary]: 1 } },
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: true,
    },
    {
      kind: "pipeline",
      name: "fulfil_split",
      description:
        "Two shipments across two stores -> both fulfilled independently, each with its own tracking number and its own correctly-located Shopify fulfilment (TAA-39)",
      skuQuantities: { [sku(11)]: 1, [sku(12)]: 1 },
      seedPlan: {
        [sku(11)]: { [primary]: TOP_UP },
        [sku(12)]: { [secondary]: TOP_UP },
      },
      expectedAllocation: { [sku(11)]: pNum, [sku(12)]: sNum },
      expectedDecrements: {
        [sku(11)]: { [primary]: 1 },
        [sku(12)]: { [secondary]: 1 },
      },
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: true,
    },
    {
      kind: "pipeline",
      name: "reject_reallocate",
      description:
        "Reject one item post-allocation -> whole shipment returns to the allocator and reallocates to a fresh backup store (TAA-31)",
      skuQuantities: { [sku(13)]: 2 },
      seedPlan: { [sku(13)]: { [primary]: TOP_UP } },
      expectedAllocation: { [sku(13)]: pNum },
      expectedDecrements: {}, // not checked — the mid-flight backup-store seed perturbs the before/after snapshot, see runner.ts
      expectedRefundSkus: {},
      cleanupSkus: [],
      fulfilment: false,
      rejectMode: "reallocate",
      rejectSeedStore: secondary,
      rejectSeedQuantity: TOP_UP,
    },
    {
      kind: "pipeline",
      name: "reject_undeliverable",
      description:
        "Reject every item on a shipment stocked at one designated store only -> UNDELIVERABLE, refunded (TAA-31)",
      skuQuantities: { [sku(13)]: 2 },
      seedPlan: { [sku(13)]: { [REJECT_DESIGNATED_STORE[store]]: 2 } },
      expectedAllocation: { [sku(13)]: storeNumber(REJECT_DESIGNATED_STORE[store]) },
      expectedDecrements: { [sku(13)]: { [REJECT_DESIGNATED_STORE[store]]: 2 } },
      expectedRefundSkus: { [sku(13)]: 2 },
      cleanupSkus: [sku(13)],
      fulfilment: false,
      rejectMode: "undeliverable",
    },
  ];

  return Object.fromEntries(cases.map((c) => [c.name, c]));
}
