# TAA-39 sign-off (2026-08-23) — fulfilment slice F, folded into the regression suite

## Pre-flight: merge gate

The task briefing claimed TAA-36/37/38 (slices C/D/E) were already merged to
`main`. That was false — `git merge-base --is-ancestor` confirmed all three
were still independent sibling branches cut from the TAA-35 tip (`1146374`),
none merged anywhere, no `taa-39-fulfil-cases` branch existing yet. Flagged
to JJ before proceeding; with his go-ahead, merged `taa-36-fulfil-order` →
`taa-37-verify-fulfilment` → `taa-38-allocation-reflection` into `main` in
that order. Only one conflict, in both `src/verify/index.ts` and
`dist/verify/index.js` — TAA-37 and TAA-38 each append one additive
`export * from "./..."` line at end-of-file. Resolved by keeping both lines
(mechanical, not a design-level conflict — the two exports don't need to
know about each other). `npm run build` + `npm test`: **254/254 green** on
the merged `main`. Pushed to `origin/main` (`eec38b2`) before branching
`taa-39-fulfil-cases`.

## Build — done

**Owned files:** `src/cases/baselineCases.ts`, `src/progress.ts`,
`src/runner.ts`, `src/cli.ts`, plus new/updated tests. `readers/dynamoReader.ts`
was read-only, as instructed — reused `groupItemsByShipment`,
`ShipmentSummary`/`ShipmentItem` exactly as TAA-35 left them. Pool slots
10-13 in `variants.ts`/`baselineCases.ts`, previously reserved, are now
partially spent by this slice.

**New cases** (`baselineCases.ts`, merged straight into `buildCases()`'s
return — see "wiring traps" below for why): `fulfil_single` (slot 10, one
SKU/one shipment at WEB_DC) and `fulfil_split` (slots 11-12, one SKU at
WEB_DC + one at STORE_99 — two shipments, two stores). **Slot 13 deliberately
left free** for TAA-31, per the ticket's own instruction — checked TAA-31
(rejection) and TAA-33 (order-finalised) first: TAA-33 reuses `fulfil_split`'s
shape for its "absent until the last item closes" assertion rather than
needing its own slot, so only TAA-31 has a claim on the last one.

**Runner wiring** (`runner.ts`): a `CaseDefinition.fulfilment: boolean` flag
drives three extra stages after `inventory` when true — `fulfil` (calls
TAA-36's `fulfilOrder()`, which internally handles the item-settle wait, the
mandatory pre-fulfil FULFILLED check, and the per-shipment fulfilment-settle
poll; any shipment outcome other than `"FULFILLED"` throws a
`VerificationError` with the outcome detail), `fulfilment_verify` (polls
TAA-37's `assertShipmentItemsFulfilled` / `assertShipmentTrackingNumber` /
`assertOrderItemsFulfilled` against fresh Dynamo reads, using the existing
`poll.fulfilment` 150s window), and `allocation_reflection` (polls TAA-38's
`assertAllocationReflection` against a fresh Shopify read-back, same window).

## The four wiring traps — all handled

1. **`stageSequenceFor`** (`progress.ts`) gained a `hasFulfilment` second
   parameter (default `false`, so existing 1-arg/2-arg callers and their
   offline tests are unaffected) appending `["fulfil", "fulfilment_verify",
   "allocation_reflection"]`. `buildRunPlan` gained a matching
   `hasFulfilmentFor` fourth parameter, same default-false backward
   compatibility.
2. **`cli.ts:107`'s unguarded `allCases[name]` index** — resolved by merging
   `fulfil_single`/`fulfil_split` directly into `buildCases()`'s returned
   record instead of a separate case module. This was the cleaner of the
   ticket's own two suggested fixes: it means every site that already reads
   `allCases[name]` (cli.ts's `buildRunPlan` call, runner.ts's `run()`) just
   works, with nothing to widen or guard.
3. **`hasRefund` in three places** — unaffected by construction:
   `expectedRefundSkus: {}` on both new cases means the existing
   `Object.keys(...).length > 0` check at all three sites (`runner.ts:163`,
   `runner.ts:523`, `cli.ts:107`) already does the right thing. The new
   `.fulfilment` flag needed the same three-site treatment instead, and got
   it (see wiring point 1's `hasFulfilmentFor` additions at all three).
4. **`printHelp()`/`printCases()`** — `printHelp()`'s hardcoded case list
   updated to "all 10" with the two new names. `printCases()` needed no
   change at all: since the new cases are merged into `buildCases()`'s
   return (point 2), the existing `buildCases()` → `buildNewStoreCases()`
   two-loop structure already lists them — no third loop, because there's no
   third case module.

## Offline tests — done, 267/267 green

13 new tests: `tests/baselineCases.test.js` (new file) pins the real 8-case
list from `buildCases()` on both stores, the `fulfilment` flag on each case,
full pairwise SKU disjointness across all 8 (the property `--parallel`
depends on), and that `fulfil_split`'s two SKUs land at two distinct stores
(a real split, not a same-store combination). `progress.test.js`: 4 new
tests for `stageSequenceFor`/`buildRunPlan`'s fulfilment axis and backward
compatibility. `cli.test.js`: 1 new test pinning the full 10-case default
set (the exact class of defect fixed 2026-08-06 for `unique`/
`partial_undeliverable` — a case added without updating the hardcoded
`--help` text). `scheduler.test.js`: updated the existing "matches the real
case set" test from 6 to 8 cases. `npm run build` + `npm test`: **267/267
green**.

## Live confirm — done on both stores; `--repeat 3` explicitly NOT done

Scoped down from the full ticket-specified checklist (both stores × full
10-case set × `--repeat 3`) given the real, irreversible Auspost-label cost
per fulfil call — checked in with JJ at each expansion point rather than
running the whole thing unilaterally.

**US, minimal check (`--cases fulfil_single,fulfil_split --sequential`):**
- `fulfil_split` **PASSED** first try, all 10 stages. Order **#9939**
  (`gid://shopify/Order/7881512943889`) → two shipments:
  `d970f370-ff49-4bd1-9591-c3937605a608` (store 100, sku `33773452`,
  tracking `111JD885846101000931508`) and
  `5f207d52-971e-48be-b09a-31e3b66644bd` (store 99, sku `33819099`,
  tracking `111JD885846201000931505`). `allocation_reflection` correctly
  matched both fulfilments to their shipments by SKU signature and their
  locations to the allocated stores.
- `fulfil_single` **FAILED** first try — see finding below. Order **#9938**
  (`gid://shopify/Order/7881507602705`), shipment
  `9c13ff5c-771b-4975-9299-5ca230c34095` (store 100, sku `33837352`,
  tracking `111JD885846001000931501`).
- `fulfil_single` **PASSED** on an immediate retry (fresh order, per the
  finding below). Order **#9940** (`gid://shopify/Order/7881524052241`),
  shipment `d3466b3a-6790-45fe-b2e3-df0739f08f29` (store 100, sku
  `33837352` again — same SKU slot, different order/shipment), tracking
  `111JD885846301000931502`. `allocation_reflection` settled in 0.5s.

**PS, full default set (`node dist/index.js --store PS`, parallel/default,
all 10 cases in one run):** **PASSED**, first try, no retries needed.
Confirms the fulfilment cases behave correctly under the `--parallel` wave
scheduler, not just sequentially. Fulfilment-relevant detail:
- `fulfil_single`: order **#3311** (`gid://shopify/Order/10859992056100`),
  shipment `93e739b9-c747-4083-875a-7dc37e3eacb0` (store 100, sku
  `34013458`, tracking `111JD885846401000931509`).
  `allocation_reflection` settled in 0.4s.
- `fulfil_split`: order **#3312** (`gid://shopify/Order/10859992121636`),
  shipments `75a11456-c42f-46a3-8bbe-e30d3d8fc424` (store 99, sku
  `33933542`, tracking `111JD885846501000931506`) and
  `d1f544bc-8b27-4b79-af0e-0635a92a86cf` (store 100, sku `33790626`,
  tracking `111JD885846601000931503`). `allocation_reflection` settled in
  2.7s.

**`--repeat 3` (US, `fulfil_single,fulfil_split`, default/parallel) — run
2026-08-23, result: FAIL, and correctly so.** `node dist/index.js --store US
--cases fulfil_single,fulfil_split --repeat 3`. `fulfil_single` passed clean
all 3 repeats (#9942, #9943, #9945). `fulfil_split` passed repeat 1 (#9941,
both shipments synced to Shopify) but **failed repeats 2 and 3** (#9944,
#9946) on `allocation.fulfilment_alignment` — see the TAA-42 finding below.
`report.ts`'s `diffRepeats` correctly flagged `repeatConsistent: false` with
`fulfil_split`'s per-repeat signatures in `variance` — this is the
`--repeat` contract working exactly as designed, catching real backend
nondeterminism, not a harness regression. **This checklist item is not
"zero variance" and is not going to become so by re-running it** — the
variance is a real backend defect (TAA-42), not a flake in this harness.

## Finding — filed as TAA-42: Shopify fulfilment sync sometimes never fires (~27% observed)

`fulfil_single`'s first live attempt (order #9938) fulfilled cleanly on the
AWS side — `fulfilment_verify` passed at 11.4s, shipment `9c13ff5c-...`
showed `status: FULFILLED` with a real tracking number — but
`allocation_reflection` ran the full 150s window and still saw **zero**
Shopify fulfilments on the order. Independently re-queried Shopify directly
(bypassing the harness entirely) twice more after the run, several minutes
apart — both times still `fulfilments: []`. Initially treated as a one-off
(an immediate retry with a fresh order, #9940, passed clean in 0.5s) and
logged as n=1.

**The `--repeat 3` run upgraded this from "maybe a flake" to a real,
recurring defect.** 2 of 3 repeats of `fulfil_split` hit the identical
pattern (#9944, #9946) — DynamoDB fully correct (both shipments
`FULFILLED`, real tracking numbers) but Shopify showing zero fulfilments
for the *entire order*, both shipments at once, confirmed still empty on a
direct re-check minutes after each run. Across every live fulfilment
attempt today (11 total, both stores): **3 failed this way (~27%)**. Ruled
out as shipment-count-specific (both single- and multi-shipment orders
failed at least once) and as store/location-specific (failures and passes
both included `ATP#100` and `ATP#99` shipments) — when it fails, the whole
order's Shopify sync appears to silently never fire, not a slow one.

**Filed as [TAA-42](https://universalstore.atlassian.net/browse/TAA-42)**
(Investigation) per JJ, 2026-08-23 — deferred for later triage; full order
regression coverage takes priority first. Departs from this project's
earlier convention of only logging findings in docs without a ticket
(established for the TAA-34/38-era one-off findings) — this rate and
pattern was judged ticket-worthy rather than just triage-notes. Full
evidence (order/shipment ids, before/after state) is in the ticket and
duplicated in the `--repeat 3` section above; not re-duplicated here.

## Checklist

- [x] `fulfil_single` and `fulfil_split` defined on free pool slots (10-12; 13 left free for TAA-31)
- [x] new stage names added to `stageSequenceFor`
- [x] `cli.ts:107` handled — merged into `buildCases()`'s return (not guarded)
- [x] `hasRefund`/`hasFulfilment` treatment consistent across all three sites
- [x] `printHelp()`/`printCases()` updated, case count no longer stale
- [x] offline tests including a `cli.test.js` addition pinning the new case list
- [x] `npm run build` + `npm test` green (267/267)
- [x] LIVE: full default set passes on BOTH stores (US: minimal fulfilment-case check + retry; PS: full 10-case set, parallel, first try)
- [x] LIVE: `--repeat 3` run and analyzed (US, `fulfil_single,fulfil_split`) — **not zero-variance**, but the variance is a confirmed real backend defect (TAA-42), not a harness bug. `--repeat` correctly drove 6 fresh orders/shipments (never re-fired an already-fulfilled one), and `report.ts`'s `stableSignature`/`diffRepeats` correctly flagged the inconsistency it exists to catch.

**The harness side of TAA-39 is done and correct.** The one open item is
backend, not harness: TAA-42 (Shopify fulfilment sync gap, ~27% observed)
is filed and deliberately deferred per JJ — full order regression coverage
is the priority now, backend bugs the harness surfaces get triaged after.
TAA-39 ticket left for JJ to review; TAA-21 completion / TAA-31 unblocking
is a call for JJ given TAA-42 is still open, not a harness gate.
