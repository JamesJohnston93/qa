# Slice 04, eligibility and skips

**Ticket:** BUSY-1159
**Cases:** TC5, TC14
**Depends on:** slice 01
**Estimated:** one session

Both cases are about orders that should produce nothing. The evidence is absence plus a counter, which makes it easy to record a false pass. Confirm the window genuinely contained the conditions before accepting either result.

## Preconditions

* Slice 01 passed.
* Poller schedule rule enabled.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
./survey-cin7-orders.sh --max-pages 2
```
The survey prints stage and contact group distributions across the population. Use it to pick a window that genuinely contains dispatched, point of sale and non ecommerce orders, and separately one containing a `Fully Picked` or `Partially Picked` order. Record the references you expect to be skipped **before** polling, so absence can be checked against a list rather than assumed.

## Cases

### TC5, ineligible orders skipped and counted
Trigger: set the watermark to the start of the chosen window and wait one cycle.
Expect: no order row for any reference on the expected skip list. `skippedCounted` non zero and `skippedStages` listing each non eligible stage with a count. The two do not sum, because `skippedCounted` also covers point of sale and non ecommerce orders. Dispatched orders appear in neither counter and produce nothing at all. No alert line for any skip.
Capture: both counters verbatim, and the check of each expected reference against the orders table.
Fails if: a record is created for anything on the skip list, or a skip raises an alert.

### TC14, eligibility of picked stages
**Rewritten. This is now a defect hunt, not an open question.** The LLD was re-read and it is unambiguous: `status = APPROVED` and stage in New, Processing, Fully Picked or Partially Picked. It states the reason in three separate places, and the reason is the point of the case.

Trigger: the same cycle if the window contained a `Fully Picked` or `Partially Picked` order, otherwise a second narrow window around one.
Expect, per the LLD: the order **is** polled, **is** eligible, and produces a record.
Capture: created or skipped, the exact stage string, and the cycle counters.
Fails if: the order lands in `skippedStages` instead of being created.

Why a skip is a real defect and not a preference. The confirmation leg writes `Fully Picked` and `Partially Picked` into Cin7 on the first pick, and that write bumps `modifiedDate`. If those stages were ineligible, the next poll would read the first pick as a previously sent order losing eligibility, which the design treats as a cancellation. It would flip the order to cancelled locally and send SCALE a DELETE for a shipment the warehouse is in the middle of picking. The LLD calls this out in its own risk table.

Two things soften it today and neither makes it safe to leave. The confirmation leg does not exist yet, so nothing of ours is writing those stages in staging. And this ticket has no cancellation path, so the DELETE cannot fire from BUSY-1159 alone. The trap is armed by BUSY-1160 and sprung by the confirmation epic, which is exactly when it stops being cheap to fix.

If it fails: raise against BUSY-1159 as a conformance defect with the LLD section quoted, and flag it to Lachlan and Kian together, since the fix is in the poller gate but the reason lives in the design. Pair it with TC13, because the same paragraph of the LLD says the echo guard is what stops a picked order re-sending. Both must hold, or neither helps.
Blocked if: the population holds no order in either stage across two survey pages. Say so and move on rather than widening the window, which costs API budget. Slice 01 Gate D may already have answered this from log history.

### Observation, delivery country spread (Q22)
While the survey output is open, record the delivery country distribution if the script exposes it, or note that it does not. This is the only cheap read of how many CTC ecommerce orders would hard error on a non Australian address, which is currently an unquantified open question. No pass or fail, just a number in the result file.

## Teardown

Leave the watermark advanced. Disable the schedule rule if no further slice runs today.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/04-eligibility-and-skips.md`
