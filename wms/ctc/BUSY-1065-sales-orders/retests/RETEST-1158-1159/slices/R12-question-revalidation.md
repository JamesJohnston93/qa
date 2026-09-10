# Slice R12, question revalidation

**Ticket:** BUSY-1158, BUSY-1159, BUSY-1160, epic BUSY-1065
**Cases:** none. One cheap check per open question, to prove each is still a live question before it is
put to a person.
**Depends on:** R11. Run R11 first, then this. V7 and V8 are R11's own gates and are not repeated here.
**Estimated:** 60 minutes.
**Write scope: none.** No watermark set, no schedule change, no poller invoke, no Cin7 write.

## Why this exists

A lambda in the pipeline was redeployed after the 2026-09-04 pass, which means at least one question's
evidence is stale. Every question is now assumed stale until re-checked. Each V step below is a state
read, not a test run.

## This slice is pre-flight for R13, not the answer

**Revised 2026-09-07.** This slice was originally written read only, and said that because the poller
schedule has been DISABLED since 2026-08-28 a behavioural check was not sound and absence should not be
read as a pass. The first half is true, the conclusion was wrong. **A question about redeployed code
cannot be answered by rows written by the old code.** The correct response is to move the watermark
forward and let fresh orders flow, which is `R13-fresh-data-verification.md`.

So this slice is now the static pre-flight that runs before R13 touches anything: build table, event
rule and filter shape, DLQ depth, artifact state, plus the table reads that set expectations for what
R13's first cycle should show. **Write the prediction down before R13 runs.** If V1 finds the rule now
filters on `company` or `origin`, then R13 cycle 1 should show zero CTC invocations of that consumer,
and that prediction is the test.

Absence of a CTC reference in a consumer log is still not evidence while the schedule is off. Record
it as UNKNOWN and let R13 settle it.

## V0. Re-identify the build

R0's 24-row build table is from 2026-09-04 and at least one row has moved since. Re-run it: last
modified, code SHA and version for every lambda in the pipeline, plus stack last-update times.

**Gate:** any lambda that changed invalidates whatever R4, R1 or R5 proved about it. List the changed
rows explicitly, because that list is the re-test scope, and say plainly which prior PASSes it puts
back in doubt. Do not re-run those cases in this slice.

## V1. K1 and K2, the faulty sale worker

Static only, per the trap above.

* Last modified and code SHA on `faulty-sale-worker-queue-handler`, against 2026-03-04 and R0's SHA.
* Its EventBridge rule: is `TRANS_CREATE_ORDER` still unconditional, or does a pattern now filter on
  `company`, `origin` or `orderType`.
* Does a new lambda exist between the bus and the handler, by name search across the stack.
* Whether `staging-inventory-check-order-faulty-sale` still exists and whether its own rule changed.

**K1 dies if** a filter or an intermediate lambda now exists. **K1 survives if** the rule is still
unconditional, and the question becomes sharper, since the LLD's own consumer-guard audit puts an
explicit `company`/`origin` check inside each consumer and BUSY-1164 in Review says the same, so a
routing-layer split is a third design and QA needs to know which one to test.

**K2 depends on K1.** If CTC can no longer reach the handler, K2 and K3 both die with it.

## V2. K3, the write side

Only if V1 leaves K2 alive.

* `staging-inventory-bus` catch-all: re-confirm zero events in the windows R1 measured, and that the
  log group is still active.
* `staging-inventory-v2`: CloudWatch `ConsumedWriteCapacityUnits`, one minute period, over R1's CTC
  invocation windows against control windows. If the table is on demand and the metric is sparse, read
  `ItemCount` from `describe-table` instead and record that a null result is UNKNOWN, not a negative.

**K3 dies if** a measured zero write is obtained by either route. Otherwise it stands as a request for
the key mapping.

## V3. K4, the poller window

The four payload spellings are already measured as ignored. Do not re-probe them.

* Read the deployed poller's environment variables and any SSM parameters it reads, looking for a page
  cap, a record cap, a lookback constant or an upper-bound flag.
* Confirm the 5 minute lookback is real and where it comes from: the poller's own logged
  `modifiedSince` sits 5 minutes below the watermark on every cycle on file.
* Check the LLD (page 1802698758, section 4 step 7 and section 9.1) for any documented lookback or
  window bound. A desk read on 2026-09-07 found none, which makes the deployed 5 minute lookback
  undocumented. **Verify that against the LLD text directly rather than trusting this line.**

**K4 survives either way** and gains a second half: is the undocumented 5 minute lookback deliberate.
It dies only if an env var or parameter turns out to bound the window.

## V4. K5, the DLQ fixture

One read: depth of the stage 5 Manhattan sender DLQ.

**K5 dies if** anything has landed naturally since 2026-09-04, in which case TC9 and TC15 run against
it instead of waiting on Kian. Two minutes, and it is the cheapest question on the list to kill.

## V5. K6, `company` on shipment rows

This is the decisive one and it is a single table read. The LLD says `Company` is static `CTC` on the
Manhattan header, that CTC headers carry `company: 'CTC'`, and that the explicit `company` field
replaces the brand-based inference in the dc-packing workers. Q29 was measured on a Universal Store
order, where the field came out `null` and the row carried no `company` attribute at all.

* Scan `staging-shipments` for the presence of a `company` attribute, grouped: CTC rows versus UNI
  rows. Presence and value only, no customer fields.
* On CTC rows, is the value literally `CTC`.

**K6 reframes if** CTC rows carry `company: 'CTC'` and UNI rows carry nothing. That is the LLD's stated
behaviour, Q29 collapses to expected, and the live question becomes whether AC8 is meant to change UNI
orders at all. If it is CTC only, TC7 and TC7b are structurally unprovable on a UNI order and should be
recorded that way rather than left inconclusive.

**K6 stands as a defect question if** CTC rows also carry no `company`, since the LLD requires it.

## V6. K7, the confirmation leg

* Name search across the deployed stacks for a confirmation, writeback or SCALE 300 handler. Absence
  of the lambda is a sound static check.
* Re-run `find-picked-stage-orders.sh` and resolve the contact group on any candidate that does not
  look wholesale.

**K7 becomes a one-line confirmation if** no confirmation-leg lambda exists, since the LLD says the
picked stages are in the eligible set precisely because that leg writes them on first pick. TC14 then
moves to the confirmation epic instead of sitting BLOCKED.

## V7 and V8

R11's Gate B0 and Gate C. Not repeated here. **Gate B0 now has exact targets from the LLD**, so use
these rather than guessing a table: family `OUTBOUND_SHIPMENT`, header `SK = SHIPMENT#<reference>`,
lines `SK = OUTBOUND_ITEM#<line id>#<size code>`, audit `SK = TRANSACTION#<epoch-ms>`, transaction
`category = OUTBOUND`, statuses `PENDING_OUTBOUND` and `SENT_OUTBOUND`, events
`OUTBOUND_ORDER_CREATED`, `OUTBOUND_SHIPMENT_READY` and `TRANS_OUTBOUND_SHIPMENT_READY`. Also
established: `Retailer - Domestic` and `Retailer - Majors` are both in the LLD's contact group table
and both map to `WHOLESALE`, so neither of R5's two orders was an unmapped group and neither should
have produced a permanent error. Both should have materialised in that family.

## V9. K10, access

* Does the presigned artifact URL still resolve, and is the size unchanged.
* Has repo or build access appeared.

Not a test, a state read. Two minutes.

## V10. K11, `lastEmittedPayloadHash`

LLD section 3: the poller stores it on the order as `lastEmittedPayloadHash` when it emits. TC13 read
the row for the first real create in this plan and the attribute was absent, with nothing resembling a
hash under another name.

Re-read one of R4's four sent orders (`261842` is the one with a captured shipment header) for that
attribute, now that the 2026-09-03 build is deployed.

**K11 dies if** the attribute is present. **K11 stands if** it is still absent, and it is then a clean
LLD-versus-code question rather than the softer "is this stale text" it has been.

## Deliverable

`results/R12-question-revalidation.md`. For each of K1 to K11: DEAD, ALIVE or REFRAMED, with the single
piece of evidence that decided it. Update `STATE.md`. Update the question list in
`../../BUSY-1065-OPEN-QUESTIONS.md` for anything that died.
