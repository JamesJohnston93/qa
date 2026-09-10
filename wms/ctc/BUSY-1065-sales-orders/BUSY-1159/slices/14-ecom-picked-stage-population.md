# Slice 14, does an ECOM order ever reach a picked stage in Cin7

**Ticket:** BUSY-1159. RAN, see `results/14-ecom-picked-stage-population.md`.
**Cases:** TC14 (decides whether it is BLOCKED or NOT APPLICABLE), and the method behind five prior checks.
**Runs in:** one IDE session. Cin7 API only for parts 1 to 3, all read-only. No AWS, no watermark, no
poller invoke, no schedule change. Part 4 is a decision, not a test.

## The question, and why the previous five checks could not answer it

TC14 is BLOCKED on "no ECOM order has ever been observed at `Fully Picked` or `Partially Picked`
across five independent checks". Every one of those five asked **what stage is this order at right
now**, and every one judged order type by reading company names by eye.

Two things follow. A snapshot cannot see a stage an order passed through and left. And "all wholesale"
has never been measured as a distribution, only eyeballed.

**The insight this slice is built on: a stage is a snapshot, a date is a record.** Cin7's sales order
carries a `Fully Picked Date` field alongside `Fully Dispatched` and `Invoice Date`. On order
`261115`, MEASURED from the Cin7 UI on 2026-09-02, `Fully Picked Date` is **empty** while
`Fully Dispatched` and `Invoice Date` both read 31-08-2026 09:15. That order reached dispatched
without a picked date ever being stamped.

If that holds across the ecom population, the question is settled permanently and the transience
problem disappears, because a date persists after the stage has moved on.

## Preconditions

Read-only against Cin7 throughout. **GET only. Cin7 is CTC's production system**, so never issue a
POST, PUT, PATCH or DELETE, and do not add one to any script.

Credentials auto-load from `.env` beside the scripts and are never printed. Do not pass them as flags
and do not echo them.

**API budget.** Burst 3/s, 60/min, 5,000/day, shared with three live pollers. Every part below states
its cost. Do not exceed it without stopping to ask.

**Redaction.** Print references, stages, statuses, dates, projectNames, branchIds and counts freely.
Never print customer name, email, address or phone. Company name only where part 2 requires it.

## Part 1. Find the field, and confirm the observation. 1 GET

Pull SO `261115` raw and identify the exact API field names for the three date fields the Cin7 UI
labels `Fully Picked Date`, `Fully Dispatched` and `Invoice Date`, plus `stage` and `status`.

Record the field names verbatim. The UI label and the API attribute will not necessarily match, and
everything below depends on naming the right one.

Confirm what the UI showed: on `261115`, is the picked-date field null, absent, or populated?

**Stop condition.** If no picked-date field exists in the payload at all, say so and skip to part 3.
Part 2 depends on it existing.

## Part 2. The population, by date rather than by stage. 4 GETs

Extend `survey-cin7-orders.sh` additively, the same way slice 02 added its `taxStatus` counter. Do not
change existing behaviour or existing output keys. Add:

* `pickedDatePresence`: count of orders where the picked-date field is populated versus null, split by
  `projectName` literal, with no-projectName bucketed as `(none)`
* `stageByProjectName`: stage cross-tabbed against `projectName`
* `stageByBranch`: stage cross-tabbed against `branchId`

`projectName` is free in the same payload, so all three cross-tabs cost zero extra calls.

Run at `--max-pages 4`, which is 1,000 orders across both CTC branches and 4 GETs.

Report the full `stages` and `statuses` distributions **verbatim**, then the three cross-tabs.

**Report the actual vocabulary, not a check against the expected one.** If a stage or status value
appears that is outside {New, Processing, Partially Picked, Fully Picked, Dispatched, Fraud Warning},
call it out. The LLD's eligibility gate is written against a list someone typed, and nobody has
verified that list is complete. An unlisted value that passes or fails the gate silently is a finding
in its own right.

**The headline number:** of ecom-shaped orders that have reached Dispatched, how many ever had a
picked date stamped.

## Part 3. Confirm the proxy, on the small set only. Up to 10 GETs

`projectName` is a proxy for ECOM. The definition is the contact group `Retail - Ecomm`.

For up to 10 orders, resolve the contact group via `find-cin7-sales-order.sh --with-contact` and
confirm the proxy holds. Choose them in this priority order:

1. Any order carrying a picked stage **or** a picked date **and** an ecom-shaped `projectName`. These
   are the ones that decide the case. If any exist, resolve every one of them first, up to the cap.
2. Otherwise a spread of ecom-shaped orders across branches and stages.

**Do not resolve contact groups across the population.** That is one GET per distinct memberId and
will burn the daily budget.

Say plainly in the results whether the proxy held, and never let it harden into the definition.

## Part 4. What the answer means. No API calls

Write the verdict, then apply it.

**If no ecom order has ever carried a picked stage or a picked date**, across a 1,000 order sample
where wholesale orders demonstrably do: TC14 is **NOT APPLICABLE to ECOM**, not BLOCKED. Close it with
that reason. The ecom fulfilment path dispatches without passing through a recorded picked state,
which is consistent with Starshipit doing the dispatching. Say so, and say that BUSY-1159's AC5 is
therefore satisfiable without the fixture that has been blocking it. **This also retires the second
half of the sign-off blocker.**

**If ecom orders do carry a picked date but never a picked stage in a snapshot**: the stage is real
but transient, all five prior checks used a method incapable of seeing it, and TC14 is runnable. The
fixture is any ecom order caught in the window. Say how short the dwell looks and what it would take
to catch one.

**If ecom orders carry a picked stage right now**: TC14 was never blocked, the five prior checks were
wrong, and the fixture is in hand. Name it with its `modifiedDate`.

In all three cases, record what this says about the method: five checks that agreed with each other
are not five independent confirmations if they shared an instrument.

## Fails if

* Any call is not a GET.
* Credentials appear in output, a prompt, or a script argument.
* The run exceeds 15 Cin7 GETs total without stopping to ask.
* A customer name, email, address or phone reaches the results file.
* The verdict is written from the stage cross-tab alone while the picked-date field exists and was not
  read. That would repeat the exact error this slice was written to correct.

## What this slice does not do

It does not touch the watermark, the schedule or the poller. Replaying a window is confounded for this
question twice over: the poller's own eligibility gate filters out picked stages before you could
observe them, and all twelve known orders are now terminal at Dispatched so they would be skipped for
an unrelated reason. Fresh fixtures for BUSY-1158's TC4b, TC4c and TC7 are a separate job with its own
blast radius, and mixing them means neither result is clean.

## Writes

`results/14-ecom-picked-stage-population.md`. Any script change is additive to
`survey-cin7-orders.sh`, recorded in `SCRIPTS.md` as not reviewed.
