/**
 * NewStore SFS/OTC injection cases — design doc cases 7-8 (TAA-17 step 3).
 *
 * These don't share the Shopify/Dynamo baseline pipeline (baselineCases.ts):
 * a NewStore-injected order never touches Shopify or staging-inventory-v2 at
 * all, so there's nothing to seed/allocate/decrement — the round trip is
 * simply inject -> read back -> confirm the ordered SKUs/quantities landed.
 */

import type { Store } from "../config";
import { skuPoolFor } from "../variants";
import type { NewStoreOrderType } from "../flows/newstoreOrders";

export interface NewStoreCaseDefinition {
  kind: "newstore";
  name: string;
  description: string;
  orderType: NewStoreOrderType;
  skuQuantities: Record<string, number>;
}

/**
 * Builds the two NS cases for the given store, pulling from that store's
 * variant pool (needed for real Shopify price lookup during injection — see
 * flows/newstoreOrders.ts's lookupPrices). Pinned to fixed slots 14 and 15
 * (TAA-46 slice C) — freed up when TAA-31's reject cases closed out on slot
 * 13 without needing them. Previously selected positionally as the pool's
 * last two entries, which worked fine while the pool was small and static,
 * but silently migrated ns_sfs/ns_otc to whatever the newest two slots were
 * every time the pool grew (TAA-46's own 14->80 expansion would have moved
 * them to slots 78/79, brand-new SKUs with no proven availability — see
 * ts/plans/TAA-46-plan.md's "the trap"). Fixed slots mean pool growth never
 * moves them again. The substantive reasoning from the old positional
 * comment still holds and is kept: NS injection never touches Shopify or
 * staging-inventory-v2, so there's no shared mutable state to race with a
 * concurrently-run baseline case, regardless of which slots are involved.
 */
const NS_SFS_SLOT = 14;
const NS_OTC_SLOT = 15;

export function buildNewStoreCases(store: Store): Record<string, NewStoreCaseDefinition> {
  const pool = skuPoolFor(store);
  if (pool.length <= NS_OTC_SLOT) {
    throw new Error(
      `variant pool for ${store} has ${pool.length} entries, needs at least ${NS_OTC_SLOT + 1} for ns_sfs/ns_otc's pinned slots`,
    );
  }
  const sfsSku = pool[NS_SFS_SLOT];
  const otcSku = pool[NS_OTC_SLOT];

  return {
    ns_sfs: {
      kind: "newstore",
      name: "ns_sfs",
      description: "NewStore Ship From Store injection — order lands in NewStore with the requested SKU/qty",
      orderType: "SFS",
      skuQuantities: { [sfsSku]: 1 },
    },
    ns_otc: {
      kind: "newstore",
      name: "ns_otc",
      description: "NewStore Over the Counter injection — preconfirmed/fulfilled order, no shipping charge",
      orderType: "OTC",
      skuQuantities: { [otcSku]: 1 },
    },
  };
}
