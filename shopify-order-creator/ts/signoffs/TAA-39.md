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

**Not done, left for a follow-up session:** the `--repeat 3` zero-variance
check. JJ chose to stop live confirmation after the single-pass PASS on both
stores rather than spend the additional real Auspost volume a `--repeat 3`
check requires. **This checklist item is explicitly unticked below — do not
report TAA-39 as fully live-confirmed without it.**

## Finding — a one-off Shopify fulfilment-sync gap on order #9938 (n=1, not reproduced)

`fulfil_single`'s first live attempt (order #9938) fulfilled cleanly on the
AWS side — `fulfilment_verify` passed at 11.4s, shipment `9c13ff5c-...`
showed `status: FULFILLED` with a real tracking number — but
`allocation_reflection` ran the full 150s window and still saw **zero**
Shopify fulfilments on the order (`assertFulfilmentLocations`/
`matchFulfilmentsToShipments` threw `allocation.fulfilment_alignment`:
expected `{"33837352":1}`, actual `[]`). Independently re-queried Shopify
directly (bypassing the harness entirely) twice more after the run, several
minutes apart — both times still `fulfilments: []`. This was not a harness
bug: the same code path fulfilled `#9939` (the split order, run immediately
before it in the same process) and its Shopify fulfilments landed within
seconds of the Dynamo-side settle.

Ruled out as an artifact of item/shipment count: `fulfil_split`'s own two
shipments are each single-item, single-package, and both synced fine — so
it's not "single-item payloads never sync." Ruled out as a per-store issue:
both the failing shipment and one of the successful ones were allocated to
store 100 (WEB_DC). An immediate retry with a fresh order (#9940, same SKU
slot) reproduced nothing — clean PASS, `allocation_reflection` settled in
0.5s.

**Conclusion: order-specific Shopify fulfilment-sync flakiness on staging,
n=1, not reproduced on retry.** Logged here for JJ's own triage per the
project's standing convention for this class of finding (real backend
oddity, not a harness defect) — not filed as a separate ticket. Worth
knowing about if a future live run of `fulfil_single`/`fulfil_split` times
out on `allocation_reflection`: re-check Shopify directly before assuming a
harness regression, and don't be surprised if a bare retry clears it.

## Checklist

- [x] `fulfil_single` and `fulfil_split` defined on free pool slots (10-12; 13 left free for TAA-31)
- [x] new stage names added to `stageSequenceFor`
- [x] `cli.ts:107` handled — merged into `buildCases()`'s return (not guarded)
- [x] `hasRefund`/`hasFulfilment` treatment consistent across all three sites
- [x] `printHelp()`/`printCases()` updated, case count no longer stale
- [x] offline tests including a `cli.test.js` addition pinning the new case list
- [x] `npm run build` + `npm test` green (267/267)
- [x] LIVE: full default set passes on BOTH stores (US: minimal fulfilment-case check + retry; PS: full 10-case set, parallel, first try)
- [ ] **LIVE: `--repeat 3` zero-variance check — NOT done, explicitly deferred.** `report.ts`'s `stableSignature`/`diffRepeats` contract was not touched by this slice (verified by reading it — it keys on pass/fail + failing check only, blind to stage names/timings), and `--repeat` already gets fresh orders/shipments for free (every case, fulfilment or not, calls `placeOrder()` anew inside `runCase()`, and `run()` is invoked once per repeat) — but this has not been proven live for the fulfilment path specifically. Whoever picks this up next: `node dist/index.js --store US --cases fulfil_single,fulfil_split --repeat 3` is the minimal live check; confirm each repeat's shipment ids are distinct (never re-fires an already-fulfilled shipment) and the three stable signatures are identical.

TAA-39 ticket left for JJ to review before moving to Done, given the
deferred checklist item above. Once `--repeat 3` is confirmed, TAA-21 is
complete and TAA-31 (rejection) is unblocked.
