# TAA-31 slice D sign-off (2026-08-23) — reject → reallocate flow, live-confirmed twice

Scope: build `rejectShipment()`, the whole-shipment-reject flow (mirrors
`fulfilFlow.ts`'s `fulfilOrder()` shape), per the slice A/B/C breakdown item
3. Not wired into `cases/`/`runner.ts`/`cli.ts` — that's slice F/G's job, same
split TAA-36 (flow) vs TAA-39 (regression-suite wiring) already used for
fulfil. `npm run build` + `npm test`: **290/290 green** (286 slice-A/B/C + 4
new).

## Pre-build discovery: ambient stock is too thin to rely on

Before writing the flow, checked a hypothesis slice C's sign-off raised but
didn't confirm — a new **read-only** probe, `probe-stock-check.ts`, dumped
every `staging-inventory-v2` location row for the pool-13 SKU (`33775371`,
US). Confirmed: **allocation decrements real per-store stock and reject
never restores it.** Of the 10 stores this SKU landed on across slices A-C's
six live trials, every single one now sits at **exactly 0** (matched by
numeric suffix — the inventory table keys carry a network prefix,
`ATP#`/`ABS#`, that `staging-shipments`' bare-number `allocatedStore` doesn't
— a naming mismatch worth remembering for any future stock-reading code).
One, `ABS#407`, is **negative** (`-9`) — a separate real backend oddity
(negative inventory allowed), noted here per the "flag it, don't chase it"
convention, not investigated further. Of only 37 total location rows for
this SKU, just 6 hold any nonzero stock at all — this SKU's real ambient
network is thin and was already mostly exhausted before this session
started.

**Consequence for the case design:** a "reject → reallocate" happy-path flow
cannot depend on the wider real store network having a valid next-best
store — it has to control its own guaranteed backup. Confirmed live
(`probe-seed-store99.js`, a second new one-shot **write**, deliberately
narrow — only `setStock` for one SKU at `STORE_99`): topping up `ATP#99`
immediately **after** initial allocation had already settled (so it can't
perturb the starting "one shipment, two items, store 100" shape) gave a
reliable, repeatable non-undeliverable outcome, twice.

**Side-effect caught and worth logging:** the first attempt at this
left `STORE_99` topped up from a prior manual test. The *next* order placed
for the same SKU allocated **initially** to store 99, not 100 — a leftover
backup seed can leak into a later run's starting shipment shape. Any real
case built on this pattern must zero the backup store back down after each
run (or immediately before seeding it), not just before rejecting.

## Build

**New in `flows/rejectFlow.ts`:** `rejectShipment(deps, orderPk, shipmentId,
itemIdsToReject, reason?)` —

1. Reads every item currently on `shipmentId` fresh from Dynamo (the
   contract returns the WHOLE shipment to the allocator regardless of how
   many items are listed in the payload, so `waitForReallocation` needs the
   full original item set, not just the ones passed in).
2. **Mandatory pre-check, per JJ (2026-08-23): reject is never valid on an
   already-`FULFILLED` shipment.** Reuses `fulfilFlow.ts`'s
   `isAlreadyFulfilled` rather than redefining it — throws before ever
   calling the reject endpoint, same reasoning TAA-41 established for
   fulfil (the endpoint provides no guard of its own).
3. Builds the payload with only the listed `itemIdsToReject`, calls
   `RejectClient.reject()`, then `waitForReallocation` (slice C).
4. Returns a structured `RejectShipmentResult` — per-item outcome
   (`wasListed`, `newShipmentId`, `store`, `status`), not a bare HTTP
   response, mirroring `fulfilOrder`'s outcome shape.

**Tests:** 4 new cases in `tests/rejectFlow.test.js`, fixtures built from
the real order #9953/#9955 ids — happy path (payload lists only the
specified item; both original items, listed and unlisted, resolve onto the
new shipment; `wasListed` correctly distinguishes them), the FULFILLED guard
(asserts `reject()` is never called), missing-shipment error, and the
`UNDELIVERABLE` outcome shape.

## Live confirm — twice, both via the real flow function

`probe-reject.ts` was rewritten to call `rejectShipment()` directly (no more
hand-built payload/manual poll in the probe) and gained `--seed-store99` to
reproduce the validated backup-store design on demand.

- **Order #9953** (pre-flow, hand-driven with the same design):
  seeded `33775371` x2 @ `WEB_DC`, waited for settle (one shipment,
  `f92ffc14…`, both items @ store 100), topped up `STORE_99` fresh, rejected
  one item → both items resolved onto **one new shipment** (`c6d6701f…`) @
  **store 99**, in **26.4s**. First time in this whole investigation two
  items coalesced into a single new shipment on reallocation (every slice
  A/B/C trial scattered to two different real stores) — makes sense: they
  only combine when they land at the *same* new store, and a single
  well-stocked controlled backup makes that the likely outcome.
- **Order #9955** (through the real `rejectShipment()` flow, this slice's
  required confirmation): identical setup and result — both items resolved
  onto one new shipment (`f7561658…`) @ store 99 in **20.5s**. Transaction
  log confirms the same `SHIPMENT_ITEM_REJECTED` → `SHIPMENT_REJECTED` →
  `REALLOCATION` → `SHIPMENT_ITEM_ALLOCATED` ×2 → `SHIPMENT_CREATE` sequence
  every prior trial showed. Original shipment → `REMOVED`, consistent with
  every trial to date.

`STORE_99` zeroed back to 0 for this SKU after both trials, per the
leak lesson above.

## Not done this slice (by design)

- **PS not exercised.** Slice A/B/C didn't touch PS either; deferred to the
  live-confirm-on-both-stores slice (F/G) once the case is actually wired
  into the regression suite — matches TAA-36's precedent (flow proven on one
  store first, both-store confirmation lands with the wired case).
- **Not wired into `cases/`/`runner.ts`/`cli.ts`.** Per the slice A
  breakdown, that's slice F/G, after slice E (reject → undeliverable) also
  lands, so both new cases get wired together the way TAA-39 wired both
  fulfilment cases in one pass.
- **No `cli-reject.ts` standalone command.** `cli-fulfil.ts` exists as
  TAA-36's hand-driven single-order surface; an equivalent for reject wasn't
  built this slice since `probe-reject.ts` already covers the same need for
  now and building a second permanent CLI surface before the case itself
  lands would be premature — revisit if slice F's wiring finds it's
  actually needed as a standalone tool, not just folded into the case.

## Files touched this slice

New: `src/probe-stock-check.ts`, `src/probe-seed-store99.ts` (both one-shot,
not wired anywhere), `ts/signoffs/TAA-31-slice-d.md`. Modified:
`src/flows/rejectFlow.ts` (added `rejectShipment`), `tests/rejectFlow.test.js`
(4 new tests), `src/probe-reject.ts` (dogfoods `rejectShipment`, gained
`--seed-store99`). Nothing fenced touched.

## Next up

Slice E — reject → undeliverable case, implementing slice A's
audited-targeted-zero proposal. The backup-store lesson here (seed late,
clean up after) applies just as much there: whatever store slice E designates
as the SKU's sole legitimate stock must be managed with the same care not to
leak into later runs.
