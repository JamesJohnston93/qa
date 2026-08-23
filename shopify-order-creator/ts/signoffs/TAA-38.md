# TAA-38 sign-off — fulfilment slice E, allocation reflection (Shopify ↔ DynamoDB)

Branch `taa-38-allocation-reflection`, cut from `origin/main` @ `1146374` (worktree
`/Users/james.johnston/Documents/GitHub/qa-taa-38`). Ran as one of three parallel
TAA-21 fulfilment sessions (alongside TAA-37); stayed inside owned files:
`src/readers/shopifyReader.ts`, new `src/verify/allocation.ts`, new `src/locations.ts`,
and one additive `export * from "./allocation";` line at the end of `src/verify/index.ts`.
`readers/dynamoReader.ts` was read-only this session, as instructed — used
`groupItemsByShipment`/`ShipmentItem` as they already stand, no changes.

## Build — done

1. **`ORDER_QUERY` extended** (`readers/shopifyReader.ts`) with `fulfillments`. Confirmed
   via live schema introspection against API 2025-10 (not guessed): `Order.fulfillments`
   is `fulfillments(first: Int, query: String): [Fulfillment!]!` — a **plain list**, not a
   connection, unlike `lineItems`/`refundLineItems` above it. New `ShopifyFulfilment`
   (`id`, `status`, `locationId`/`locationName` from the nullable `Fulfillment.location`,
   `items: ShopifyFulfilmentLineItem[]`) added to `ShopifyOrderSnapshot.fulfilments`. New
   pure `fulfilmentSkuQuantities()` mirrors `skuQuantities()` — the same duplicate-line-item
   merge applies inside one fulfilment's `fulfillmentLineItems`, confirmed live (see #9931
   below: 3x-same-SKU was never exercised directly this slice, but the merge mechanism is
   identical and doc'd inline).
2. **Store → Shopify-location mapping built** (`locations.ts`, new). One table per Shopify
   store (`US_STORE_LOCATIONS`/`PS_STORE_LOCATIONS`), keyed by the plain OMS store number.
   Could not be derived from location names (confirmed: no US/PS staging location name
   contains an ATP/branch number anywhere) — built entirely from live data, see "Live
   confirm" below. `shopifyLocationForStoreNumber(store, storeNumber)` throws on an
   unmapped number rather than returning undefined.
3. **PS `read/write_fulfillments` scope — verified, not just a doc claim.** Queried
   `currentAppInstallation.accessScopes` directly on both apps: **US "AWS OMS App"** and
   **PS "QA PS App"** both have `read_fulfillments` and `write_fulfillments` (plus
   `read/write_locations`, confirmed too, since `locations.ts` depends on location GIDs
   being readable). CLAUDE.md:243's claim was correct — no scope-gap blocker for PS.
4. **`verify/allocation.ts`** (new): `expectedShipmentAllocations` (pure — real,
   non-undeliverable shipments derived from `ShipmentItem[]` via the existing
   `groupItemsByShipment`), `matchFulfilmentsToShipments` (correlates a Shopify fulfilment
   to a shipment by SKU/unit-count signature — there is no shared id between the two
   systems for this, confirmed: the fulfil payload only ever carries the shipment's own
   ids, nothing Shopify-side echoes them back), `assertFulfilmentLocations`,
   `assertNoFulfilmentForUndeliverable`, and `assertAllocationReflection` (composes all of
   the above for one order — undeliverable check runs first for a more specific failure
   message, since a stray fulfilment on an undeliverable item would otherwise surface as a
   generic "unexplained fulfilment" from the shipment-matching step). Every failure is a
   `VerificationError` carrying expected-vs-actual from both systems (sanity-checked live —
   see below).

## Offline tests — done, build + suite green

`npm run build` clean. `npm test`: **217/217 green** (192 baseline + 25 new: 3 in
`tests/orders.test.js` for `fulfilmentSkuQuantities`, 6 in new `tests/locations.test.js`,
16 in new `tests/allocation.test.js`). Two of the allocation tests and one location test
pin real captured live shapes (US order #9931's split/combination and #9934's
partial_undeliverable, see below) rather than only synthetic fixtures.

## Live confirm — done, both stores, single/combination/undeliverable, 6 orders

Hand-driven (TAA-36's one-command path doesn't exist yet this session) via a scratch
driver script reusing the harness's own compiled clients — `prepareInventoryForCase` →
`placeOrder` → poll `getShipmentItemsByPk` for allocation → `buildFulfilPayloadForShipment`
→ `FulfilmentClient.fulfil` → poll `getShipmentsByPk` for settle (status+trackingNumber,
per TAA-41's rule) → `getOrder` (extended query) → `assertAllocationReflection` against the
**real compiled code**, not just hand-typed fixtures. All spare orders below are unused by
anyone else; shipment ids recorded so no one else reuses them.

| Store | Order | Scenario | Shipments → outcome |
| --- | --- | --- | --- |
| US | **#9931** | combination (split: WEB_DC + STORE_99) | `07d356a1-…` → ATP#100, FULFILLED, tracking `111JD885844601000931505`; `554a8155-…` → ATP#99, FULFILLED, tracking `111JD885844701000931502` |
| US | **#9933** | single, at a physical branch (CHERMSIDE_US/ATP#407) | `970edfcd-…` → ATP#407, FULFILLED, tracking `111JD885845001000931502` |
| US | **#9934** | partial_undeliverable | `1fa54475-…` → ATP#100, FULFILLED, tracking `111JD885845101000931509`; second SKU (`33992457`) UNDELIVERABLE → refunded, **no shipment ever created for it** |
| PS | **#3302** | combination (split: WEB_DC + STORE_99) | `18cef4e3-…` → ATP#99, FULFILLED, tracking `111JD885845201000931506`; `c839a876-…` → ATP#100, FULFILLED, tracking `111JD885845301000931503` |
| PS | **#3303** | single, at a physical branch (PS_STORE/ATP#640) | `5ebd70c7-…` → ATP#640, FULFILLED |
| PS | **#3304** | partial_undeliverable | `1db452f4-…` → ATP#100, FULFILLED, tracking `111JD885845701000931501`; second SKU (`33948010`) UNDELIVERABLE → refunded, no shipment |

`assertAllocationReflection` run against a **fresh** read-back of all 6 (separate script,
after the live driver finished) — **6/6 PASS**: SKU/unit alignment, fulfilment location vs.
allocated store, one-fulfilment-per-shipment, and no-fulfilment-for-undeliverable all held
for every scenario on both stores. Sanity-checked the assertion isn't vacuous: re-ran #9931
against `store: "PS"` on purpose (wrong location table) — correctly threw
`allocation.fulfilment_location` with both systems' state in the error.

## Two real findings

**Finding 1 — `WEB_DC`/`STORE_99` are shared, brand-agnostic DC facilities, not
per-brand.** `ATP#100` always fulfils from the Shopify location named **"Universal Store
Distribution Centre"**, and `ATP#99` always fulfils from **"Perfect Stranger Distribution
Centre"** — regardless of which brand's shop placed the order (a **PS** order allocated to
ATP#100 fulfilled from "Universal Store Distribution Centre", and a **US** order allocated
to ATP#99 fulfilled from "Perfect Stranger Distribution Centre"). Each shop still carries
its own local GID for these two shared facilities (confirmed 4 distinct GIDs across the two
tables), which is why `locations.ts` still needs one table per store even though the
underlying physical facilities are shared. `CHERMSIDE_US`/`PS_STORE` are NOT shared this
way — confirmed same-brand only (US branch order fulfilled from "Universal Store
Chermside", PS branch order from "Perfect Stranger Chermside"). Not raised as a ticket per
JJ's standing instruction for this class of finding — logged here for his own triage.

**Finding 2 (process, not a backend defect) — first PS transcription had "100"/"99"
swapped, caught by re-running the real assertion against real data, not just the offline
tests.** Building `locations.ts` from the live output by hand, the PS split order's two
GIDs got attributed to the wrong store numbers on the first pass — the offline tests
(written against the same, already-wrong values) passed anyway, since they were pinning the
mistake rather than the truth. Only surfaced by running `assertAllocationReflection` a
second time against a **fresh** Shopify+Dynamo read-back post-build, which failed loudly
with expected-vs-actual from both systems, exactly as designed. Worth remembering for any
future mapping-table build from hand-transcribed live output: re-verify the finished table
against a fresh independent read, don't just trust the offline tests that were written
alongside the same transcription.

## Checklist

- [x] `ORDER_QUERY` extended with the fulfilment fields needed
- [x] Store → Shopify-location mapping built (`locations.ts`)
- [x] PS `read/write_fulfillments` scope verified against Shopify (confirmed present)
- [x] Per-fulfilment SKU/unit-count alignment asserted
- [x] Fulfilment location maps to the allocated store
- [x] One fulfilment per shipment
- [x] No fulfilment for undeliverable items
- [x] Mismatches report expected-vs-actual from both systems
- [x] Offline tests for the mapping and the comparison logic
- [x] `npm run build` + `npm test` green (217/217)
- [x] Live confirm on both stores, single/combination/undeliverable (6 orders, table above)

TAA-38 acceptance criteria met. Ticket left for JJ to move to Done.
