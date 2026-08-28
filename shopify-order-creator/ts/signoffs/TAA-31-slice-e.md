# TAA-31 slice E sign-off (2026-08-28) — reject → undeliverable, live-confirmed

Scope: implement slice A's "audited targeted-zero" proposal
(`ts/signoffs/TAA-31-slice-a.md`, "Proposed constrained alternative") for the
reject → undeliverable case — item 4 of that slice's proposed breakdown. Not
wired into `cases/`/`runner.ts`/`cli.ts` — same F/G split slice D used for the
reject → reallocate flow. `npm run build` + `npm test`: **294/294 green** (290
slice-A/B/C/D + 4 new offline tests for `planTargetedZero`).

## Why not `zeroEverywhere`

`zeroEverywhere` (used by the existing baseline `undeliverable` case) zeroes
every existing location row unconditionally — for pool-slot-13's SKU that's
correctness-safe but wasteful cost when this same SKU already gets zeroed and
re-seeded repeatedly across this whole workstream's live trials (slices A-D,
and now E). Slice A's proposal instead audits first
(`getAllLocationsForSku`, already existed, read-only) and zeroes only the
locations actually found nonzero, skipping rows already at 0 — bounded by
"however many locations actually hold stock", not a blanket sweep.

## Build

**New in `clients/dynamo.ts`:**

- `planTargetedZero(locations, keepStore, keepQuantity)` — pure planning
  function. Returns `{ zero: string[], keep: { store, quantity } }`: every
  currently-nonzero location except `keepStore` goes in `zero`; `keepStore`
  is excluded from the zero list unconditionally (even if it started
  nonzero — `zeroExceptStore` sets it to `keepQuantity` afterward regardless
  of its starting value, so double-handling it would be redundant, not
  wrong, but the plan stays a clean partition either way).
- `zeroExceptStore(sku, keepStore, keepQuantity)` — the AWS-touching method:
  audits, computes the plan, zeroes `plan.zero` in `ZERO_BATCH_SIZE` batches
  (reusing `zeroEverywhere`'s batching), then seeds `keepStore`. Returns the
  plan for logging.

**Tests:** 4 new cases in `tests/dynamo.test.js` — zeroes only nonzero
locations excluding keepStore; excludes keepStore from the zero list even
when it's already nonzero; an all-zero audit has nothing to zero; an empty
audit has nothing to zero.

**No new flow logic needed.** `rejectShipment()` (slice D) already handles
"reject every item on the shipment in one call" generically — its
`itemIdsToReject` parameter doesn't care how many items are listed, and
`reallocationResolved` (slice C) already treats `UNDELIVERABLE` as a terminal
outcome per item. The only new work this case needed was the inventory setup
around it; slice A's proposal step 5 ("reject every item in the shipment in
one call, not just one") is exactly what the existing function signature
already supports.

**New probe:** `probe-reject-undeliverable.ts` (one-shot, not wired
anywhere, per slices A/D's precedent) — drives the whole case end to end:
audit → `zeroExceptStore` → `placeOrder` → wait for order-row alignment →
wait for item-count settle → reject every item on the resulting shipment →
`rejectShipment` → dump `TRANSACTION#` rows → assert every item resolved
`UNDELIVERABLE` → zero the designated store back to 0 in a `finally` (same
leak lesson as slice D).

Designated stores, per the proposal (deliberately not `WEB_DC`/`STORE_99`,
which every other case already seeds): **US → `CHERMSIDE_US` (`ATP#407`)**,
**PS → `PS_STORE` (`ATP#640`)** — not yet exercised on PS this slice (see
"Not done this slice" below).

## Bug caught mid-build: stale `totalOrderUnits` snapshot

First live attempt (order #9967) timed out waiting for `itemCountsSettled`
even though the last-observed value it printed showed both items already
`ALLOCATED` with a shared `shipmentId` — a fully settled state the predicate
should have accepted. Cause: the probe's first poll (waiting for the
`staging-orders-v2` row to exist at all) returned as soon as `rows.length >
0`, which can be true before the order's `ITEM#` rows have landed — the same
"row creation and shipment assignment are two separate write steps" gap
`itemCountsSettled`'s own doc comment already documents for a different
poll. `totalOrderUnits` was computed once from that premature snapshot,
almost certainly summing to 0, which made `itemCountsSettled`'s `expectedTotalUnits
<= 0` guard return `false` forever regardless of what showed up later. Fixed
by polling the order-row stage on `orderSkuQuantitiesFromRows(rows)[sku] ===
SEED_QUANTITY` instead of bare row presence — mirrors `runner.ts`'s
`assertOrdersTableAlignment` composite-poll shape rather than a naive
existence check. Order #9967 itself settled correctly (2 items `ALLOCATED` @
store 407, one shipment) and was left alone — same terminal shape any other
case's un-rejected allocated order is left in, no cleanup needed. Worth
remembering for any future probe that reads `staging-orders-v2` once and
reuses the snapshot: existence is not the same as complete.

## Live confirm — US, order #9968

Pre-run audit: SKU `33775371`, 38 location rows, 0 nonzero (this session's
prior probe run had already zeroed everything back down). `zeroExceptStore`
had nothing to zero and seeded `ATP#407` to 2.

- Order row alignment: 12.2s.
- Item-count settle: 18.2s. Shipment `66e15741-…` allocated to store `407`
  (matches the designated store, as expected — it was the only stocked
  location).
- Rejected both items on that shipment in one call. Resolved in **28.4s** —
  both items `UNDELIVERABLE`, `newShipmentId: null`.
- Transaction log confirms the full expected sequence: `SHIPMENT_ITEM_CREATE`
  → `REALLOCATION` → `SHIPMENT_ITEM_ALLOCATED` ×2 → `SHIPMENT_CREATE` →
  `SHIPMENT_PICKSLIP_CREATED` → `SHIPMENT_REJECTED` → `SHIPMENT_ITEM_REJECTED`
  ×2 → `REALLOCATION` → `SHIPMENT_ITEM_UNDELIVERABLE` ×2. First trial in this
  whole investigation to observe `SHIPMENT_ITEM_UNDELIVERABLE` fired directly
  from a rejection-triggered reallocation (every prior A-D trial had a real
  candidate store to land on).
- `ATP#407` zeroed back to 0 after the run (confirmed via
  `probe-stock-check.ts`: 0 of 38 locations nonzero).

**PASS: every item resolved UNDELIVERABLE**, matching slice A's proposal item
4's acceptance line verbatim.

## Not done this slice (by design)

- **PS not exercised.** Same precedent as slice D (reject → reallocate also
  US-only so far) — both-store confirmation deferred to the wiring slice
  (F/G), once both reject cases are wired into the regression suite proper
  and can be run with `--store PS` the same way every other case already is.
- **Refund/cleanup interaction unverified.** Whether the Shopify refund and
  the `UNDELIVERABLE` → `REMOVED` cleanup transition (already asserted by the
  baseline `undeliverable` case, `verify/refunds.ts` /
  `assertItemsRemoved`) behave identically when the item reached
  `UNDELIVERABLE` via rejection-triggered reallocation rather than zero
  ambient stock was not checked this slice — out of scope per slice A's
  proposal item 4, which only requires the `UNDELIVERABLE` outcome itself.
  Worth confirming when this case gets wired into the full pipeline (F/G),
  since the wired case will presumably want the same refund assertions the
  baseline case already has.
- **Not wired into `cases/`/`runner.ts`/`cli.ts`.** Per the slice A
  breakdown, that's slice F/G's job, landing after both new cases (D's
  reallocate case and this slice's undeliverable case) exist — the same
  single pass TAA-39 used to wire both fulfilment cases in together.

## Files touched this slice

New: `src/probe-reject-undeliverable.ts` (one-shot, not wired anywhere),
`ts/signoffs/TAA-31-slice-e.md` (this file). Modified: `src/clients/dynamo.ts`
(added `planTargetedZero`, `zeroExceptStore`), `tests/dynamo.test.js` (4 new
tests). Nothing fenced touched.

## Next up

Slice F/G — wire both new reject cases (D's reallocate, E's undeliverable)
into `cases/`/`runner.ts`/`cli.ts` per TAA-39's precedent for the fulfilment
cases, confirm both on PS, add the `TRANSACTION#` reader/assertions (slice A
proposal item 5 — `SHIPMENT_REJECTED` + one `SHIPMENT_ITEM_REJECTED` per
rejected item, already visible ad hoc in this slice's and slice D's probe
dumps but not yet a reusable assertion), and prove `--repeat 3` stability on
both stores (proposal item 6). Also needs a real pool-slot decision — both
reject cases currently share slot 13's SKU; whether they can safely share it
in the wired regression run (they don't conflict SKU-wise since one seeds a
backup store and the other seeds a single designated store, both explicitly
zeroing everything else first) or need the pool widened to 15 SKUs is a call
for that slice, not this one.
