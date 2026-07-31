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
  name: string;
  description: string;
  orderType: NewStoreOrderType;
  skuQuantities: Record<string, number>;
}

/**
 * Builds the two NS cases for the given store, pulling from that store's
 * variant pool (needed for real Shopify price lookup during injection — see
 * flows/newstoreOrders.ts's lookupPrices). Uses the last two pool entries so
 * ns_sfs and ns_otc use distinct SKUs from each other whenever the pool has
 * at least 2 entries (falls back to the single entry otherwise). Both
 * stores' pools are small today (5 US / 4 PS) and fully claimed by
 * baselineCases.ts's cases 1-6 via modulo wraparound, so this necessarily
 * reuses a SKU literal one of those cases also uses — that's fine: NS
 * injection never touches Shopify or staging-inventory-v2, so there's no
 * shared mutable state to race with a concurrently-run baseline case.
 */
export function buildNewStoreCases(store: Store): Record<string, NewStoreCaseDefinition> {
  const pool = skuPoolFor(store);
  if (pool.length === 0) {
    throw new Error(`variant pool for ${store} is empty`);
  }
  const sfsSku = pool[pool.length >= 2 ? pool.length - 2 : 0];
  const otcSku = pool[pool.length - 1];

  return {
    ns_sfs: {
      name: "ns_sfs",
      description: "NewStore Ship From Store injection — order lands in NewStore with the requested SKU/qty",
      orderType: "SFS",
      skuQuantities: { [sfsSku]: 1 },
    },
    ns_otc: {
      name: "ns_otc",
      description: "NewStore Over the Counter injection — preconfirmed/fulfilled order, no shipping charge",
      orderType: "OTC",
      skuQuantities: { [otcSku]: 1 },
    },
  };
}
