# Result: Slice 04, eligibility and skips

**Ticket:** BUSY-1159
**Verdict:** TC5 PASS. TC14 BLOCKED (population held no order in either stage, exactly as anticipated).

## Approach, and why no new watermark reset was used

The schedule has been running continuously against real Cin7 traffic since well before slice 01 (confirmed there, and again by Gate D's 538 cycles over 14 days). That means essentially every Cin7 order already modified has already passed through the poller's eligibility gate at least once, and the poller's own log history already contains the evidence TC5 asks for. Rewinding the watermark far enough back to replay a specific old order live would mean replaying a very wide window (the wholesale order found below is from `06:29` this morning, roughly 18 hours of real order traffic away from the current watermark), which conflicts with the API-budget constraint to keep windows narrow. Used log history plus direct row lookups instead, at zero extra Cin7 API cost.

## Setup, population survey

MEASURED, `survey-cin7-orders.sh --max-pages 2`, 500 orders, both CTC branches (51908, 51909):

```
stage             Dispatched 214, New 189, Processing 64, Fully Picked 29, Partially Picked 3, Fraud Warning 1
```

The survey does not resolve contact group (too expensive to do for the whole population), so a second, targeted set of `find-cin7-sales-order.sh --group ...` calls was used to get real references for each ineligible category.

## TC5, ineligible orders skipped and counted

Three ineligible categories checked, each with a real reference and a live-row check.

**Point of sale.** MEASURED: `--group 'Retail - Shop' --any-branch` returns real POS orders (e.g. reference `CTC000190365`), but every one sits at branchId `8289`/`8288`, never at CTC's fulfilment branches `51908`/`51909`. Two full pages restricted to `51908`/`51909` returned zero POS-group matches. POS orders structurally never enter the poller's queried population at all, filtered out by branch before any stage or type gate is reached. No live "skipped POS order" instance is obtainable at the CTC branches because POS does not occur there, which is itself the finding: the branch filter is doing this job before any type-based logic runs.

**Wholesale.** MEASURED. `--group 'Retailer - Domestic'` found real wholesale orders inside the CTC branches: reference `1038295Dec26` (stage `New`, branch `51908`, an otherwise-eligible stage) and reference `1059277Aug26` (stage `Dispatched`, branch `51908`). Both checked with `inspect-ctc-order.sh`: zero rows in both tables for both references. Cross-referenced against poller log history: a cycle at `2026-08-27T06:30:53.940Z` shows `{"ordersFetched":3,"created":0,"skippedCounted":1,"skippedStages":{}}`, timed almost exactly to `1038295Dec26`'s own `modifiedDate` (`2026-08-27T06:29:30Z`). `skippedStages` empty confirms `skippedCounted` is the orderType-level bucket, not a stage-level one, exactly as the slice describes.

**Non ecommerce / stage-ineligible.** MEASURED, from the same log sweep: two cycles (`2026-08-27T09:24:50Z` and `09:26:50Z`) show `{"skippedCounted":1,"skippedStages":{"Fraud Warning":1}}`, a genuine stage-based skip distinct from the orderType-based one above.

**Dispatched.** MEASURED. Two ECOM-group Dispatched references (`#260834C`, `#261055`) both show zero rows via `inspect-ctc-order.sh`. Consistent with the slice's own description that dispatched orders appear in neither counter and produce nothing at all, most likely excluded by the Cin7 query's own server-side stage filter rather than a post-fetch skip (no `Dispatched` entry has ever appeared in `skippedStages` across Gate D's 14 day sweep or this session's own log reads).

**No alert line** on any of the cycles pulled above.

PASS. No order row exists for any of the four checked ineligible references. `skippedCounted` and `skippedStages` both observed non-zero in real cycles, with the type/stage split matching the slice's description exactly.

## TC14, eligibility of picked stages

BLOCKED, per the slice's own stated condition, not a pass or fail.

MEASURED: a full 2-page, uncapped (`--limit 250`) pull of ECOM-group orders returned 225 matches. Stage breakdown: 160 Dispatched, 64 Processing, 1 Fraud Warning. Zero `Fully Picked`, zero `Partially Picked`. The population's 29 `Fully Picked` / 3 `Partially Picked` orders (from the raw, ungrouped survey) are apparently concentrated in the wholesale contact groups, not ECOM, at least in the current live population.

Per the slice's instruction, did not widen the window further to manufacture a hit, since that costs API budget for a low-probability find. Carrying forward Gate D's evidence from slice 01 instead: 14 days of poller log history, 538 cycles, contain zero `Fully Picked`/`Partially Picked` entries in `skippedStages`. Combined, this session has now checked both the live current population and 14 days of history and found no evidence of the suspected defect, but also no direct confirming instance either. TC14 remains open until a genuine ECOM order reaches one of these two stages while this plan is still running; re-check opportunistically in later slices rather than as a dedicated re-run.

## Observation, delivery country spread (Q22)

`survey-cin7-orders.sh --json` output keys: `total, stages, statuses, carriers, projectNames, branchIds, distinctMemberIds, ordersWithNoLineItems, carrierByStage`. No country field of any kind. The script does not expose delivery country. UNKNOWN, not measured, and not cheaply measurable with the existing tooling. Would need a new script pulling `deliveryCountry` from the raw payload across a page (a real number, not a text summary, so worth a small script if this becomes a priority), not done here to avoid scope creep beyond what this slice asked for.

## Fails if conditions

None triggered.

## Scripts written

None. Everything this slice needed was either an existing script or a client-side filter over an existing script's raw/JSON output (no new logic worth saving as its own file).

## Teardown

Watermark unchanged by this slice, still at whatever slice 03 left it. Schedule left ENABLED, more slices running today.
