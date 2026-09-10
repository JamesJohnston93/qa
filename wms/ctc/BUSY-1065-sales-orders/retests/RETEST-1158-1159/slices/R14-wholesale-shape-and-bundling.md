# Slice R14, wholesale record shape and the bundling mechanism

**Ticket:** BUSY-1159, BUSY-1160, epic BUSY-1065
**Cases:** Q35, Q36, Q38, and the wholesale half of Q31. All four are now testable rather than
question-shaped, because Kian answered the premise on 2026-09-07.
**Depends on:** `results/R13-fresh-data-verification.md` and `results/R11-pre-kian-confirmation.md`.
**Estimated:** W1 and W2 desk stages about 30 minutes, and they may close both questions with no new
data at all. W3 only if they do not.

## What Kian said, 2026-09-07, and what it turns into

Rough answers, taken as premises under test, not as settled fact.

1. **"Wholesale orders land in AWS but have a different shape or identifier."** So the drop R5 and R13
   measured may be a search failure on our side, not data loss. That is testable: if a wholesale record
   shape exists anywhere in these tables, a scan finds it. **W1.**
2. **"We do not skip any more, they get bundled together in some form."** So the 36-order residual R13
   measured is expected, and the accounting moved somewhere the cycle line does not print. Also
   testable: if a bundle exists, it is a log line, a metric or a record. **W2.**
3. **Picked-stage eligibility: zero ECOM orders reach `Fully Picked` in Cin7, and every order that is
   eligible does get through, so QA cannot test it and it likely passes.** Agreed and consistent with
   our own data: 9 of 9 eligible fresh orders created in R13, 4 of 4 in R4. **Not a test. It becomes a
   handover ask: dev covers picked-stage eligibility in a dev environment.** Recorded in the question
   list, closed on our side, no further QA work.

**Cin7 stays READ ONLY. GET calls only. No order created, edited, approved or voided, ever.**

## W1. Does a wholesale record shape exist anywhere. Cheapest first

### W1a. List the tables. Free

`aws dynamodb list-tables`, then `describe-table` on anything plausible. R11 checked
`staging-shipments` and `staging-orders-v2` only. If wholesale lands under a different shape it may
also land in a different table, and nobody has looked.

**Closes Q35 immediately if** a table exists that holds it.

### W1b. Scan for the shape itself, not for a reference. Free apart from read capacity

This is the decisive test and it needs no fresh data. The poller has run 582 cycles including a
718-order backfill, so if a wholesale order at an eligible stage has ever been created, its record is
still sitting there.

* `staging-shipments` (about 179,000 rows, R2 already scanned it once so the cost is known): scan
  filtering on `orderType` not equal to `ECOM`, and separately on `orderType` present at all. Report
  the distinct `orderType` values found and a count per value.
* `staging-orders-v2`: same, using `origin_index` where it helps. R13 confirmed that GSI exists on this
  table even though `staging-shipments` has none.
* Report the distinct values, not a yes or no. `WHOLESALE`, `RTV`, `STORE_PICK` and anything
  unexpected are all findings.

**Reads as:**

* A wholesale shape exists: Kian is right, we were looking in the wrong place, Q35 closes and the real
  deliverable is documenting how to find one so every future case can. Add the lookup to
  `inspect-ctc-order.sh` or a new script.
* `ECOM` is the only `orderType` in either table, across the whole history: then no wholesale order has
  ever been stored, under any shape, and Kian's premise does not survive. That is a stronger finding
  than R13's, and it goes back to him with the scan counts attached.

### W1c. Only if W1a and W1b find nothing. Needs fresh data

R13's 24-hour window listing held real wholesale orders at eligible stages: 13 `THE ICONIC` at `New`,
several `City Beach` and `Universal (QLD)` at `Processing`. None was in R13's chosen 96-minute window,
which is why its confound never separated.

1. Find a confirmed-wholesale order at `New` or `Processing`, contact group resolved with
   `find-cin7-sales-order.sh --with-contact`. Company name alone is not sufficient: R13's `#262210`
   looked wholesale by company name and resolved to genuine `Retail - Ecomm`.
2. Count `[candidate watermark minus 5 minutes, now]`. Take the smallest window holding it.
3. One scheduled cycle. Disable, then unset the watermark.
4. Then hunt the created record: by reference, by `origin`, and by any `orderType` value W1b turned up.

**This is the only test that separates wholesale from ineligible-stage.** Every wholesale order
measured so far, R5's two and R13's 47, sat at a stage the LLD excludes anyway, so absence proves
nothing about type.

## W2. Find the bundling. No new data needed

### W2a. Read the whole cycle, not just the summary line. Free

R13's cycle at `2026-09-07T06:30:43.818Z` fetched 56 and printed dispositions for 20. Its result reads
only the `Cin7SOPollerCycleComplete` line and the `Pushed` lines.

Dump every log line in that one cycle's request id, safe fields only, and look for anything that names
a bundle, a group, an aggregate, or any of the 43 `Dispatched` references. Use
`audit-poller-cycle-emits.sh`'s extraction convention. **The SO poller log group carries unredacted
customer data in its `Pushed` lines**, so never print a raw line, see the R13 process note.

**Closes Q36 and Q38 if** a bundle line exists and accounts for the 36.

### W2b. Custom metrics. Free

`aws cloudwatch list-metrics` for the poller's own namespace, then `get-metric-statistics` on anything
resembling a skip, bundle or exclusion count over R13's cycle window. The cycle log line may simply not
print what the metric records. Nobody has checked the metrics side of this at all.

### W2c. Compare vocabularies across the deploy. Free

R11 established the counter set went from 6 fields pre-deploy to 12 post-deploy, and that
`skippedStages` stopped populating on 2026-09-03. Take one pre-deploy cycle and one post-deploy cycle
and diff the full set of distinct log line types each produced, not just the counter names. Bundling
introduced by that deploy should show as a line type that did not exist before.

### W2d. The `Approved` versus `Dispatched` asymmetry, which is the sharpest open thread

R13 measured, on one cycle, both confirmed wholesale by contact group: 4 orders at stage `Approved`
counted correctly in `skippedStages={"Approved":4}`, and 43 orders at stage `Dispatched` producing no
counter and no log line at all.

If W2a to W2c find the bundle, check whether the 43 are in it and the 4 are not, or both, or neither.
**Whatever the bundle turns out to be, this asymmetry needs an answer**, because a stage-name-specific
silent path is the shape most likely to hide a real order later.

## Deliverable

`results/R14-wholesale-shape-and-bundling.md`. For Q35, Q36 and Q38: CLOSED, or ALIVE with the evidence
that keeps it alive. If W1b finds a wholesale shape, the session's second deliverable is a documented
lookup path, promoted to a script, so no future slice repeats this hunt.

## Stop and ask JJ if

* W1b's scan cost looks materially higher than R2's known scan of the same table.
* W1c is needed, since it writes the watermark and enables the schedule.
* The bundle turns out to be a record in a table this plan has never touched.
