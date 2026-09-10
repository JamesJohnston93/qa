# Results, slice 19, TC6d, the empty `sizes[]` fallback the poller does not do

**Ticket:** BUSY-1159. **Case:** TC6d. **Register:** Q43. **Ran:** S1 only, per instruction.

## S1. Read the counter across every retained cycle

**New script:** `scripts/check-skipped-no-sizes.sh`, row added to `SCRIPTS.md` before running.
Sweeps every `Cin7SOPollerCycleComplete` line in `staging-orders-cin7-so-poller`'s full retained
CloudWatch history (mirrors the window-resolution approach already trusted in this epic via
`../retests/RETEST-1158-1159/scripts/reconcile-poller-cycles.sh`, written fresh rather than editing that
script since it lives in a different ticket's plan) and reports `skippedNoSizes` specifically.

### Retention correction

**The log group's retention is confirmed unlimited**, `aws logs describe-log-groups` ->
`retentionInDays: null`. This corrects the slice's own framing ("30 days is not never"): the group
does not expire logs at all, so the retained window is bounded by how long the group has existed and
held data, not by a 30-day policy. MEASURED.

### Step 1 and 2, the sweep and the distribution

Window swept: the log group's own earliest retained event (`2026-08-27T01:34:50.575Z`) to now
(`2026-09-10T01:47:27Z`). **584 `Cin7SOPollerCycleComplete` lines fetched.**

Of those, **8 cycles carry the `skippedNoSizes` field**, the remaining 576 do not. This is expected,
not a parsing gap: `skippedNoSizes` was added by the 2026-09-04 deploy (per Q43's register entry,
corroborated by RETEST-1158-1159's R11/R14), so every cycle before that date genuinely lacks the
field. **Spot-checked**: fetched the cycle at `2026-09-02T03:32:59.447Z` (the same cycle slice 11
already cites) directly and confirmed `skippedNoSizes` is absent from its raw JSON, not silently
zero. The field is genuinely new, not missed by this script's parser.

The 8 cycles that do carry it span `2026-09-04T01:33:31Z` to `2026-09-07T06:32:38Z`. **A direct tail
read of the last 4 days confirms no cycle has run since**: only 2 `Cin7SOPollerCycleComplete` lines
exist in the last 4 days, both dated `2026-09-07T06:30:43Z` and `2026-09-07T06:32:38Z`, the second
being the same cycle that created the last of the nine R13 references. The schedule has been quiet
since, consistent with every slice from 15 onward keeping it disabled.

**All 8 cycles: `skippedNoSizes: 0`. Largest value seen: 0.**

| Timestamp | ordersFetched | created | skippedNoSizes |
|---|---|---|---|
| 2026-09-04T01:33:31.987Z | (see raw sweep) | (see raw sweep) | 0 |
| ... (6 more cycles, all 0) | | | 0 |
| 2026-09-07T06:32:38.253Z | 2 | 0 | 0 |

(Only the timestamp range and the zero/non-zero split are load-bearing here; the slice's step 2 asks
for the distribution, not a full per-cycle dump, and none of the 8 is non-zero so step 3, pulling a
non-zero cycle's order references, does not apply.)

### Reading against the slice's own three-way branch

**"Zero across every retained cycle"** is the branch that fired, not "non-zero on any cycle" and not
"counter absent from the summary line" (it is present, just only since the deploy that added it, as
expected).

**But the sample behind this zero is small and that has to be said plainly.** "Every retained cycle"
technically covers 584 cycles, but only 8 of them could have shown the counter at all, because the
schedule has been disabled for nearly the entire window this ticket's testing has covered. The honest
claim is: **the counter has existed for about 3 days of actual poller activity (2026-09-04 to
2026-09-07) and has not fired once in that window**, not "has never fired across weeks of history."

### Proposed disposition

**Q43: `TRIED 2, negative`.** Per the slice's own reads-as, this is a drift row plus a correction, not
yet a defect: the LLD specifies a fallback the deployed poller does not implement, and this session's
read found no evidence it has cost a real line so far, on a genuinely small sample. **Proposed QA doc
row (not applied):** TC6d, drift/correction row, "LLD §5 specifies a `lineItems[].code`/`qty` fallback
for an empty `sizes[]`; the deployed poller skips the line instead and counts it via `skippedNoSizes`
(0 across 8 cycles observed since the counter's 2026-09-04 deploy). Latent, not yet observed to drop
a real line. Correction for Kian, not a defect, pending S2's occurrence check." Q43 register updated
in `../BUSY-1065-OPEN-QUESTIONS.md` with this attempt's outcome and the retention correction.

**S2 is next**, per the slice's own gating ("only run this if S1 came back all-zero"), and it is
JJ's: the named Cin7 query for whether any CTC ECOM order ever carries an empty `sizes[]` on a
`lineItems[]` entry. `results/18-unrun-cases.md` carries a 100-reference list if a sample is wanted.

No "Stop and ask JJ" trigger fired: no non-zero cycle, the counter is present (not absent) once its
deploy date is accounted for, and S2 has not run yet so there is no contradiction to compare against.

## Scripts written

`scripts/check-skipped-no-sizes.sh`, new, row added to `SCRIPTS.md` before running. Read only, one
paginated `aws logs filter-log-events` sweep plus a small spot-check call outside the script. **Not
yet reviewed.** A clean run proves the sweep and count are as printed; it does not independently
verify that `skippedNoSizes` is wired to the exact branch this case cares about beyond what slice 18's
source read already established.

---

## Correction appended at the 2026-09-10 wrap-up, not by the session that ran S1

**The deploy date is 2026-09-03, not 2026-09-04.** This file attributes `skippedNoSizes` to "the
2026-09-04 deploy (per Q43's register entry)". Q43 says 2026-09-03, and so does
`../retests/RETEST-1158-1159/results/R11-pre-kian-confirmation.md` in six places. What is dated 2026-09-04 is
the **first observed cycle carrying the field**, `2026-09-04T01:33:31.987Z`.

**Nothing else in this file changes.** The window is slightly wider than stated and the material
findings stand: 8 cycles carry the counter, all read 0, and no cycle has run since
`2026-09-07T06:32:38Z`. If anything the correction sharpens the caveat this file already makes about
its own sample size, since it means cycles may have run on 2026-09-03 carrying the field that this
sweep grouped with the 576.

**The retention correction in this file is accepted and carried forward.** Retention is `null`, that
is unlimited, not 30 days. Slice 19's own text said "30 days is not never" and was wrong.
