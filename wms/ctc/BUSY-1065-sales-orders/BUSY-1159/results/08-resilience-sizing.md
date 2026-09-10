# Result: Slice 08, resilience sizing

**Ticket:** BUSY-1159
**Verdict:** TC17: no failure at any suggested step, ceiling not reached, rate data recorded. TC19: BLOCKED as expected, no oversized order in a 718-order window. Bonus: TC14 stays BLOCKED but on much stronger evidence, one new hard-error type found (Q26), one tool-reading trap found (`invoke-so-poller.sh`).

## Preconditions

Slices 01, 02, 03, 06, 07 and 09 already run. Nobody else known to be against the shared Cin7
budget. Restore point recorded at setup: `2026-08-28T01:35:45.769Z` (MEASURED, same value slice 09
ended on, no drift). Schedule DISABLED throughout, confirmed before and after.

## TC17, backfill ceiling

Three steps, each set with `--confirm`, read back, then one manual invoke:

| Window | ordersFetched | created | skippedCounted | requestsThisCycle | Duration | Outcome |
|---|---|---|---|---|---|---|
| 6 hours | 25 | 1 | 0 | 2 | 28.7s | completed, watermark advanced |
| 24 hours | 306 | 4 | 212 | 55 | 91.85s | completed, watermark advanced |
| 3 days | 718 | 0 | 286 | 91 | 136.6s | completed, watermark advanced |

All MEASURED from the poller's own `Cin7SOPollerCycleComplete` line and CloudWatch `REPORT` line,
not the CLI's own reporting (see the tool note below on why). No cycle failed, no window came close
to the 5 minute (300s) Lambda timeout, no failure metric or alarm fired for timeout or throttling.
Rate held close to 1.5 to 1.7 seconds per Cin7 API request across the two larger windows
(91.85s / 55 requests = 1.67s/request, 136.6s / 91 requests = 1.50s/request), reasonably
consistent given `created` and `skippedStages` composition differ per window.

Per the slice's own text ("suggested steps are 6 hours, 24 hours, 3 days, stopping at the first
failure"), all three suggested steps completed clean, so the ceiling itself was not reached and
this session did not push wider. Extrapolating the measured rate, INFERRED not measured: reaching
the 300s timeout would need roughly 190 to 200 Cin7 requests in one cycle, which at the order
volume seen this window (roughly 240 orders/day recently) is in the order of 6 to 7 days of
backlog, not something likely to occur under the plan's 2 minute schedule in normal operation.

No failure metric or alarm fired at any step (`Fails if: nothing` per the slice, recorded as data
not a verdict).

**Note on API budget.** Total Cin7 SO poller requests today before this slice: 28 (baseline check).
After all three TC17 steps plus the TC14 follow-up query below: sum of 2 + 55 + 91 + 2 (one-off
picked-stage query) is well under 200 additional requests, against a shared 5,000/day cap. Not a
sharp climb, no early stop needed.

## TC19, oversized order

`oversized:0` in all three TC17 cycles, spanning 718 orders at the widest window. No oversized
order exists in the population sampled. BLOCKED, exactly the expected outcome the slice names: "At
ECOM per unit grain this is very unlikely, so BLOCKED with that reason is the expected outcome." No
dedicated Cin7 call needed, this piggybacked entirely on TC17's own cycles.

## Bonus finding 1: new hard-error type, not the ShipmentId one

Both the 6 hour and wider cycles logged `Cin7SOPollerAlert` for `WOR19267`, `261103` and `261105`:
"Unrecognised Cin7 taxStatus \"Exempt\" for SO #<ref> - refusing to guess a tax treatment." Tripped
`staging-orders-cin7-so-poller-alert` to ALARM (confirmed via `describe-alarms` after the run).
Distinct from the ShipmentId-length hard error already on file (`fixtures.md`). Logged as Q26 in the
open questions register for Kian: is `Exempt` a legitimate Cin7 tax status the mapping should cover.
Refuse-and-alert matches the ShipmentId case's handling, so not treated as a defect on this ticket.

## Bonus finding 2: TC14 opportunistic follow-up, stays BLOCKED, stronger evidence

The 3 day window's `skippedStages` showed real, non-zero counts for the first time in this plan:
`{"Fully Picked":29,"Partially Picked":3,"Fraud Warning":1}`. Rather than accept the aggregate at
face value, pulled all 32 real orders directly from Cin7 (`stage IN ('Fully Picked','Partially
Picked')`, same branch/approval filter the poller uses) and read each one's company name.

MEASURED: all 32 are wholesale accounts (surf shops, retailer chains, one marketplace: Hillzeez
Subculture, Universal (QLD), Ozmosis, THE ICONIC, and 14 more distinct company names, full list in
the script output). Zero look like an ECOM customer order. Confirmed one directly
(`UQLD160-3709`): `branchId 51908`, `memberCostCenter "Cin7 Wholesale"`, `company "Universal
(QLD)"`, unambiguously wholesale.

TC14 stays BLOCKED, no ECOM order at either stage has been directly observed yet. But this is much
stronger evidence than slice 04's smaller sample: this positively identifies every real candidate
in the window and rules each one out by name, rather than finding zero in a sample and being unable
to say why. It also reframes Q1: the dev handover's observation of `Fully Picked` among skipped
stages is very plausibly wholesale orders sharing the same stage-keyed skip counter, not evidence of
an ECOM eligibility defect. Correction logged in the open questions register against Q1, not
overwriting the original answer.

## Scripts written

`scripts/find-picked-stage-orders.sh`, not reviewed yet. One Cin7 GET for orders currently at
`Fully Picked`/`Partially Picked`, printing company name per order so a wholesale account can be
told apart from an ECOM one at a glance. Read only. Reproduces the 32-order finding above exactly.
Saved because TC14 is explicitly opportunistic across future sessions (`STATE.md`), so this query
is likely to run again.

## Teardown

Watermark restored to the slice's own recorded restore point, `2026-08-28T01:35:45.769Z`, read back
and confirmed. Schedule confirmed DISABLED. Stage 5 DLQ depth unchanged at 3 throughout. Sender
queue in-flight count rose transiently (2 to 6) while the small number of genuinely new orders from
the TC17 windows drained through, expected and not a defect.
