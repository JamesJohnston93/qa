# Slice R3, BUSY-1159 update semantics under the 1160 build

**Ticket:** BUSY-1159, AC3 and AC6
**Cases:** TC4, TC3, TC21, TC21b, plus the 1160 version guard and the address-update payload shape
**Depends on:** R0 Gate A (confirmed: `update-transaction` and the `cancel-order` family exist and
changed on 2026-09-03). Needs a fresh ECOM order already sent to SCALE, so run R4 first or create the
order at the head of this session.
**Estimated:** one session, the longest in the plan

## Why this slice exists

Three BUSY-1159 cases PASS on the expectation that a second sighting of an order does nothing. BUSY-1160
is built to make a second sighting do something. Those PASS rows are now either stale or a live
defect, and only a re-run separates the two.

JJ's decision, 2026-09-04: re-run and re-write against current behaviour rather than pin them to the
pre-1160 build.

Read the BUSY-1160 acceptance criteria before starting. The relevant ones: pre-wave edits reflected in
SCALE (line added, quantity changed, line removed, address changed); successive revisions reconcile in
place under the same item key; an address-update payload carries no lines; a replayed revision is a
no-op under the version guard while a later edit in a new modified-date tick passes; exactly one
outward event per revision.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
./cin7-watermark.sh --stage staging --profile staging --poller so    # --poller so, always
```

Record the watermark before anything. Expect `2026-08-28T01:35:45.769Z` unless R4 has already moved
it. **Restore it at teardown.**

The poller schedule is DISABLED. TC3, TC4, TC21 and TC21b do not require the schedule the way TC1
does, so a manual `invoke-so-poller.sh` is acceptable here. Say in the result that each cycle was
manual.

**Cin7 writes stay with JJ.** Every edit below is JJ's to make in the Cin7 UI. The slice waits, it
does not write. Ask for one edit at a time and confirm the new `modifiedDate` before polling.

## Setup

One ECOM order, already sent, with a known `wmsSentAt` and a known Cin7 `modifiedDate`. Either the
order R4 created, or create one here. Record reference, `ShipmentId`, `wmsSentAt`, current
`modifiedDate`, and the current transaction row list from
`../../BUSY-1159/scripts/list-transaction-rows.sh` before touching anything.

That transaction row list is the baseline every case below is diffed against. Capture it once, print
it in the result.

## Cases

### TC4, second sighting of an order edited in Cin7

Trigger: JJ makes one pre-wave edit in Cin7. Prefer a quantity change on an existing line, since it
is the case that distinguishes reconcile-in-place from churn. Confirm `modifiedDate` moved, then poll.

Expect, under 1160: the edit reaches SCALE. Old expectation was that nothing reaches SCALE.

Capture: the transaction rows after the poll, diffed against the baseline; the `update-transaction`
log group for this reference; whether the outward event count is exactly one for the revision; and
the SCALE-side result, which R6 reads in the UI.

**Rewrite the row rather than flipping its verdict.** TC4's Expected Result column has to change to
match 1160 before a PASS or FAIL means anything. Propose the new wording in the result file, do not
edit `../../BUSY-1159/QA-DOC.md` from this session.

Fails if: the edit does not reach SCALE, or it reaches SCALE by churning line identity rather than
updating under the same item key.

### Line reconciliation, the three shapes

Trigger: after TC4, JJ makes each of these as a separate revision, confirming `modifiedDate` between
each:

1. a line added
2. a line removed
3. an address change

Poll after each. Do not batch them, the point is one revision at a time.

Expect: new line inserted, vanished line marked removed without physical deletion, address change
carried.

Capture: per revision, the transaction rows, the item keys, and whether the item key is stable across
the quantity change from TC4.

**The address change carries its own assertion:** the address-update payload must carry no lines.
Read the payload block on the transaction row with
`../../BUSY-1158/scripts/read-transaction-payload.sh` and confirm the line set is absent, not empty and
not repeated. Never print address values, only key names and presence.

### TC3, reset the watermark behind an order already sent

Trigger: set the watermark back behind the order's original `modifiedDate`, poll, restore.

```bash
./cin7-watermark.sh --stage staging --profile staging --poller so --set <value>
# poll
./cin7-watermark.sh --stage staging --profile staging --poller so --set 2026-08-28T01:35:45.769Z
```

`--poller so` on every call. The flag defaults to `item` and the wrong flag rewinds the item master
feed.

Expect: the version guard makes this a no-op, because the order's stored last-modified value is not
older than what Cin7 returns. `wmsSentAt` unchanged, no second send.

Capture: `wmsSentAt` before and after, transaction row count before and after, and the guard's own log
line if it names one.

Fails if: the order re-sends. That is a replay under a guard that is supposed to prevent exactly this.

### TC21 and TC21b, re-poll an unchanged order outside the dedupe window

Trigger: re-poll the order unchanged, more than 5 minutes after the last send.

Expect: no second transaction row, no second send, **and a named guard.**

TC21b's expected result is that the guard that suppressed it is named. It was recorded as PASS on an
unnamed suppression and corrected to INCONCLUSIVE in the 2026-09-02 audit. **An unnamed suppression is
a FAIL here, not a PASS.** Do not repeat that error.

Capture: the counters before and after, the transaction rows from `list-transaction-rows.sh` before
and after, and the literal log line that names the suppression mechanism. Three candidates to
distinguish: the version guard, the idempotency key (event, brand, order reference, Cin7 modified
date), and the create-only branch that slice 09 suspected. Under 1160 the third should no longer
exist. Say which one fired, from its own log line, not from elimination.

Inconclusive if: nothing is logged at all by any of the three. Record INCONCLUSIVE and say what you
looked for.

### The version guard, both directions

Trigger: two runs.

1. Replay an older revision. Expect a no-op.
2. JJ makes a genuine later edit in a new `modifiedDate` tick. Expect it to pass.

This is the case that proves the guard discriminates rather than just blocking everything. TC3 and
TC21 only prove the blocking half.

Capture: both outcomes, with the stored last-modified value read before and after each.

Fails if: the later edit is also a no-op. That is a guard that has stopped the feed, and it would
present in production as silently stale shipments.

## Teardown

* Restore the watermark to `2026-08-28T01:35:45.769Z` and read it back to confirm.
* Leave the poller schedule DISABLED.
* Do not clean up the order. R6 reads it in the SCALE UI and R2 may need it.
* Record every Cin7 edit JJ made, in order, with its `modifiedDate`, so the sequence is reproducible.

## Write results to

`results/R3-update-semantics.md`.

Include the proposed new wording for TC4, TC3, TC21 and TC21b's Expected Result columns. The QA doc
edit itself happens in R7.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* an edit reaches SCALE by churning line identity rather than reconciling in place. That is an AC
  failure on 1160 and it affects what R2 can even test.
* the later edit is a no-op, meaning the version guard blocks everything.
* an address update carries lines.
* more than one outward event fires for a single revision.
* the poller writes to a reference other than the one under test during any cycle.
