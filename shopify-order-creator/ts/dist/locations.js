"use strict";
/**
 * Store -> Shopify-location mapping (TAA-38).
 *
 * Neither Shopify store's location list embeds the OMS's ATP/branch number
 * anywhere in the location name (confirmed live, 2026-08-23 — every US/PS
 * staging location is named after a real place, e.g. "Universal Store
 * Chermside", "Perfect Stranger Distribution Centre"; nothing reads
 * "ATP#407" or "BRANCH_407"). So this mapping cannot be derived by pattern-
 * matching a name string — it was built by forcing allocation to each known
 * ATP location in turn (via inventory seeding, same mechanism
 * cases/baselineCases.ts uses), fulfilling the resulting shipment, and
 * reading back which `Fulfillment.location` the OMS actually attached to
 * the Shopify order. See ts/signoffs/TAA-38.md for the live runs (order
 * numbers, shipment ids) that produced each GID below.
 *
 * One table per Shopify store, not one shared table: US and PS are separate
 * shops, so the *same* physical ATP location (e.g. ATP#100, the shared web
 * DC) has two different Shopify Location records, one per shop, with
 * different GIDs. `WEB_DC`/`STORE_99` (config.ts) are used by both stores'
 * case sets and so need an entry in both tables; `CHERMSIDE_US`/`PS_STORE`
 * are brand-specific and only ever appear in their own store's table.
 *
 * ⚠ Live finding, both stores (2026-08-23): `WEB_DC` (`ATP#100`) and
 * `STORE_99` (`ATP#99`) are two shared, brand-agnostic DC facilities, each
 * always surfacing under the SAME Shopify location NAME regardless of which
 * brand's shop the order was placed on — `ATP#100` is always "Universal
 * Store Distribution Centre" and `ATP#99` is always "Perfect Stranger
 * Distribution Centre", even for a PS/US order respectively. Each shop still
 * has its own local GID for that shared facility (separate Shopify
 * locations, same physical place), which is why this mapping is still one
 * table per store rather than one shared table. The brand-specific branch
 * locations (`CHERMSIDE_US`/`PS_STORE`) are NOT shared this way — each only
 * ever appears in its own brand's shop. Confirmed reproducible (one live
 * order per store; a first PS transcription had "100"/"99" swapped and was
 * caught by a live end-to-end re-check against these exact GIDs, not just
 * the offline tests — see ts/signoffs/TAA-38.md).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PS_STORE_LOCATIONS = exports.US_STORE_LOCATIONS = void 0;
exports.storeLocationsFor = storeLocationsFor;
exports.shopifyLocationForStoreNumber = shopifyLocationForStoreNumber;
/** Plain OMS store number (config.ts's ATP#<n> with the "ATP#" stripped) -> Shopify Location GID, for the US shop. */
exports.US_STORE_LOCATIONS = {
    "100": "gid://shopify/Location/93156147473", // WEB_DC — "Universal Store Distribution Centre"
    "99": "gid://shopify/Location/93154410769", // STORE_99 — "Perfect Stranger Distribution Centre" (shared DC, see warning above)
    "407": "gid://shopify/Location/93155983633", // CHERMSIDE_US — "Universal Store Chermside"
};
/** Same shape, for the PS shop. */
exports.PS_STORE_LOCATIONS = {
    "100": "gid://shopify/Location/93423206692", // WEB_DC — "Universal Store Distribution Centre" (shared DC, see warning above)
    "99": "gid://shopify/Location/93421535524", // STORE_99 — "Perfect Stranger Distribution Centre"
    "640": "gid://shopify/Location/93421502756", // PS_STORE — "Perfect Stranger Chermside"
};
function storeLocationsFor(store) {
    return store === "US" ? exports.US_STORE_LOCATIONS : exports.PS_STORE_LOCATIONS;
}
/**
 * Resolves a plain OMS store number to its Shopify Location GID for the
 * given Shopify store. Throws on an unmapped store number rather than
 * returning null/undefined — an allocation to a store this mapping doesn't
 * know about is exactly the kind of drift TAA-38 exists to catch, and a
 * caller silently skipping the location check on a missing entry would hide
 * it instead.
 */
function shopifyLocationForStoreNumber(store, storeNumber) {
    const gid = storeLocationsFor(store)[storeNumber];
    if (!gid) {
        throw new Error(`No known Shopify location GID for ${store} store number "${storeNumber}" — ` +
            `extend locations.ts's mapping before asserting allocation for this store (known: ${JSON.stringify(Object.keys(storeLocationsFor(store)))}).`);
    }
    return gid;
}
