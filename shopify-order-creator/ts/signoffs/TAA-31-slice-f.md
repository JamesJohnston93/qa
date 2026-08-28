# TAA-31 slice F/G sign-off (2026-08-28) — reject cases wired, both stores, live-confirmed

Scope: wire both reject case designs (D's reallocate, E's undeliverable) into
`cases/`/`runner.ts`/`cli.ts` per TAA-39's precedent for the fulfilment
cases, confirm both on PS, and prove `--repeat`-stable on both stores — items
3/4/6 of slice A's proposed breakdown (`ts/signoffs/TAA-31-slice-a.md`).
`npm run build` + `npm test`: **310/310 green** (294 slice-A/B/C/D/E + 16
new).

**Decision from JJ (2026-08-28): `--repeat 2` instead of `--repeat 3`** for
this slice's stability check, to save time — JJ is confident in the design
already. Applies to this slice's acceptance bar only, not a project-wide
change to the `--repeat 3` convention used elsewhere (e.g. TAA-40's
outstanding PS baseline run).

## Design

**`CaseDefinition` gains three fields** (`cases/baselineCases.ts`):
`rejectMode?: "reallocate" | "undeliverable"`, and reallocate-only
`rejectSeedStore`/`rejectSeedQuantity` (the mid-flight backup-store top-up
slice D's design needs). Two new cases, both on pool slot 13 — the one slot
shared by two cases in this whole project, by design:

- **`reject_reallocate`**: seeds `WEB_DC` normally, orders 2 units (one
  shipment, matches slice D exactly), then — after initial allocation
  settles — tops up `STORE_99` fresh and rejects one item. Expects every
  item to land on a new shipment or go `UNDELIVERABLE` (slice A's proposal
  item 3 tolerates either).
- **`reject_undeliverable`**: seeds only the designated store (`CHERMSIDE_US`/
  `PS_STORE`) with 2 units via the *existing* `prepareInventoryForCase`
  (`zeroEverywhere` + `seedInventory`) — **not** slice E's `zeroExceptStore`;
  for a single-SKU, single-designated-store case the two produce an
  identical end state, and reusing the pipeline every other case already
  goes through was simpler than special-casing the seed step. Rejects every
  item in one call. Expects every item to resolve `UNDELIVERABLE` strictly.

**Runner changes** (`runner.ts`): a new stage block ("5a. Reject") sits
between the initial allocation composite-poll and the refund/no-refund
branch — reject happens, then the *existing* refund/cleanup logic runs
unmodified using the case's already-declared `expectedRefundSkus`, which is
how `reject_undeliverable` gets refund + `REMOVED`-cleanup verification for
free, closing the gap slice E's sign-off flagged as unverified. The
"inventory" stage (`assertDecrements`) is skipped entirely for `rejectMode:
"reallocate"` — its mid-flight backup-store seed is a large deliberate
"increase" relative to the pre-order snapshot that `assertDecrements` would
reject as unexpected; kept active for `"undeliverable"`, where nothing moves
between stores after the reject so the plain before/after model still holds.

**New pure assertions** (`verify/rejects.ts`, offline-tested):
`assertAllUndeliverable` and `assertReallocatedOrUndeliverable`, mirroring
the existing `verify/*` pattern (`assertAllocation` etc.) rather than
inlining the checks in `runner.ts`.

**Progress/ETA** (`progress.ts`): `stageSequenceFor`/`buildRunPlan` gain a
`rejectMode` parameter (default `undefined`, existing callers unaffected) so
the live progress line and rolling-average ETA account for the reject
stage(s) — same discipline CLAUDE.md's "wiring traps" note already calls out
for `hasFulfilment`.

**cli.ts**: `printHelp`'s hardcoded case list/count updated to "all 12";
`buildRunPlan` calls in both `runner.ts`'s `run()` and `cli.ts`'s `runCli()`
now pass the `rejectMode` callback (the third of the three places CLAUDE.md
warns must stay in sync — `runCase`'s `caseStages`, `run()`, `runCli()`).

**Pool-slot-13 sharing is safe, confirmed both by reasoning and live run:**
`scheduler.ts`'s `buildWaves` already greedily separates any cases sharing a
SKU into different waves (sequential, never concurrent) — no pool widening
needed, resolving the open question slice E's sign-off left. Live-confirmed
under `--parallel` (the default): both stores' runs above show "2 case(s) in
2 wave(s)".

## Bug caught mid-build: cross-case race, `reject_undeliverable` right after `reject_reallocate`

First live pair-run (US, order #9970) failed: `reject_undeliverable`'s
initial allocation correctly landed at `CHERMSIDE_US`, but after rejecting
both items, one resolved `ALLOCATED` at `WEB_DC` (store 100) instead of
`UNDELIVERABLE`. Re-running `reject_undeliverable` alone passed cleanly
(refund + cleanup + inventory all green), confirming this was a cross-case
interaction with the immediately-prior `reject_reallocate` run, not a defect
in `reject_undeliverable`'s own design.

Traced via `probe-reject.ts` against `reject_reallocate`'s order (#9969):
its own outcome was clean — the contract's "whole *originating* shipment's
store is excluded from reallocation for every item on it" behavior held
(both items scattered together to `STORE_99`, not back to `WEB_DC`, even
though only one item's `rejectedStores` formally listed `"100"`) — so
`WEB_DC` was left with its un-consumed seed remainder (99 seeded − 2 ordered
= 97 units) genuinely sitting in `staging-inventory-v2` after that case
finished. `reject_undeliverable`'s own `zeroEverywhere` (in its
`seed_inventory` stage) provably zeroed `WEB_DC` — its initial allocation
landing correctly at `CHERMSIDE_US` proves that — yet by the time its reject
call fired roughly 40-70s later, `WEB_DC` had become nonzero again. Root
cause unconfirmed — most likely a delayed backend inventory sync/mirror
landing late (same class as the documented ~30-60s `AGGREGATE_LOCATIONS`
mirror lag in `config.ts`, though the timing here ran longer) rather than
anything the harness itself did. Flagged, not chased, per this project's
"flag it, don't chase it" convention (`defer-backend-bugs-prioritize-
coverage`) — full order-regression coverage remains the priority.

**Fix:** `reject_undeliverable`'s reject step now calls
`dynamo.zeroEverywhere(sku)` a second time, immediately before firing the
reject call (not just at `seed_inventory`) — cheap for a mostly-empty pool
SKU, and removes the race outright regardless of its root cause. Re-ran the
same pair back-to-back on US afterward: clean pass, no repeat of the issue.

## Live confirm

**US**, `reject_reallocate` + `reject_undeliverable` back-to-back
(`--sequential`, then again under default `--parallel` via `--repeat 2`):
clean both times post-fix. Stage timings: `reject_reallocate` — allocation
16.7-21.7s, `reject` 10.5-16.6s; `reject_undeliverable` — allocation
16.7-26.8s, `reject` 12.7-26.6s, `refund` 13.9s, `cleanup` 11.3-21.3s. All
comfortably inside existing poll windows.

**PS**, same pair, `--repeat 2`: clean, zero variance. Stage timings in the
same range as US (allocation 16.6-16.8s, `reject` 10.5-12.6s, `refund`
13.9-14.1s, `cleanup` 11.2-16.3s) — no store-specific surprises.

Both SKUs (`33775371` US / `33950419` PS) left at 0 across all locations
after every run, confirmed via `probe-stock-check.ts`.

## Not done this slice

- **`TRANSACTION#` reader/assertions (slice A proposal item 5).** The
  expected `SHIPMENT_REJECTED` + one `SHIPMENT_ITEM_REJECTED` per rejected
  item has now been visually confirmed ad hoc in three separate slices'
  probe dumps (A, D, and this slice's `probe-reject.ts` re-check of order
  #9969) with zero surprises each time — a reusable assertion would be
  low-risk, low-effort follow-up, not a design question. Deferred rather
  than folded in here to keep this slice's diff scoped to the wiring + the
  race it surfaced.
- **`probe-reject-undeliverable.ts` (slice E) and `probe-reject.ts`/
  `probe-stock-check.ts`/`probe-seed-store99.ts` (slices A/D) are now fully
  superseded** by the wired cases for day-to-day regression use, but left in
  place — they're still the fastest way to hand-drive a single reject call
  or audit stock without running the whole suite.

## Files touched this slice

Modified: `src/cases/baselineCases.ts` (2 new cases, 3 new
`CaseDefinition` fields), `src/runner.ts` (reject stage, inventory-stage
skip, defensive re-zero), `src/progress.ts` (`rejectMode` param on
`stageSequenceFor`/`buildRunPlan`), `src/cli.ts` (help text, `rejectModeFor`
wiring), `tests/progress.test.js`, `tests/cli.test.js`,
`tests/baselineCases.test.js` (updated for the new cases + the one allowed
SKU overlap). New: `src/verify/rejects.ts`, `tests/rejects.test.js`,
`ts/signoffs/TAA-31-slice-f.md` (this file). Nothing fenced touched.

## Next up

TAA-31's core scope (build the reject client/predicate/flow, both case
designs, wire into the regression suite, confirm both stores) is done. What
remains, in rough order of value: the `TRANSACTION#` reader/assertions noted
above (small); deciding whether the `reject_undeliverable` cross-case race's
root cause is worth a dedicated live investigation or stays flagged
indefinitely (JJ's call, same as TAA-42); and whether TAA-32 (click &
collect) or TAA-33 (order-finalised transaction) picks up next, per the
queue order CLAUDE.md already documents.
