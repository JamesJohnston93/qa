# Slice R13, fresh data verification

**Ticket:** BUSY-1158, BUSY-1159, BUSY-1160, epic BUSY-1065
**Supersedes:** the 2026-09-07 read-only draft of this file, and R12 (its static checks are S0 here).
**Depends on:** `results/R11-pre-kian-confirmation.md`. Read it before anything else.
**Estimated:** S0 and S1 about 25 minutes. S2 about 40. S3 about 20.

## Rules for this slice, from JJ, 2026-09-07

1. **Cin7 is READ ONLY. GET calls only, always.** No order created, edited, approved, voided or
   touched in Cin7 at any point, by anyone, for any reason.
2. The watermark may be moved back to let fresh data flow, up to 24 hours.
3. **Unset the watermark and disable the schedule when testing is done, or as soon as the poller has
   caught up to present**, whichever comes first. Do not leave it running.
4. Value order for every choice in this slice: **cheap, then on new data, then different from what has
   already been run.** Re-using an old case is acceptable, not preferred.

## What R11 already settled, so do not re-run it

* Q27 write side: **closed**, measured zero on `staging-inventory-v2` write capacity and zero on
  `staging-inventory-bus`. Do not re-test.
* Q27 duration: **retracted**. n=32 warm CTC p50 3.49ms against n=129 warm non-CTC p50 27.02ms. CTC is
  faster, not slower. R1's inference is dead, do not repeat it.
* `skippedStages` counter: **stopped firing at the 2026-09-03 deploy** (last non-empty 2026-09-02, zero
  across all 6 post-deploy cycles).
* Counters have **never** balanced: 292 of 582 cycles carry a residual, 291 of them pre-deploy.
* Wholesale drop is **real**: nothing in the native family, nothing in the outbound family, and the
  outbound family is not deployed at all (0 rows on all four `*_OUTBOUND` statuses, 0 lambdas, 0 rules).
* **Cin7 `modifiedDate` is mutable current state, not history.** A past window cannot be reconstructed:
  10 historical window GETs returned 0 orders while the poller's own logs show 1 to 5 fetched at the
  time. So there is no going back for anything, ever. Fresh data is the only data.

## S0. Pre-flight. Free, no writes

One sentence each on what it decides.

1. Watermark with `--poller so`, expect `2026-08-28T01:35:45.769Z`, and schedule expect `DISABLED`.
   **Decides nothing, but if either has moved, stop and tell JJ.**
2. `faulty-sale-worker-queue-handler`: last modified, code SHA against R0's, and its EventBridge rule
   pattern. **Decides K1: has the CTC split landed, or is the rule still an unconditional
   `TRANS_CREATE_ORDER`.**
3. Any new lambda between the orders bus and that handler, by name search. **Same question, K1, from
   the other direction.**
4. Stage 5 Manhattan sender DLQ depth. **Decides K5: if a rejection has landed naturally since
   2026-09-04, TC9 and TC15 run off it and K5 never needs asking.**
5. `describe-table` on `staging-shipments`, GSI list. **Decides Q37: R11 found no `origin_index`
   despite the LLD saying BUSY-1103 delivers it.**

**Write the prediction down before S2 runs.** If step 2 shows a `company` or `origin` filter, then S2
must show zero CTC invocations of that consumer. The prediction is the test.

## S1. Window selection. Free, Cin7 GETs only

Count before committing anything. **The poller fetches from watermark minus 5 minutes**, so every count
is over `[candidate watermark - 5 min, now]`. R5 counted from the watermark, expected 6 and got 8.

Report three counts and let the numbers pick the window:

* last 30 minutes
* last 60 minutes
* last 24 hours, JJ's stated ceiling

At the rates R11 measured (Monday business hours ran 11 to 91 orders an hour, 16 dispatch batches of
10 to 52 orders a minute), 24 hours is likely 300 to 500 orders and every one of them a first-time
create. **Take the smallest window that contains what the checks below need.** Report the 24 hour
number anyway so JJ can decide whether he wants the wide sweep; do not run it on your own judgement.

While counting, look for these in the window, because each one turns S2 into a discriminating test at
no extra cost:

* **A wholesale order at `New` or `Processing`.** Highest value item in this slice. It breaks the
  confound R5 left and R11 Gate B could not: R5's two wholesale orders were both at stages that were
  already ineligible, so wholesale and ineligible-stage could not be separated. A wholesale order at an
  eligible stage separates them on fresh data. **Decides Q35 and the wholesale half of Q31.**
* **Any order at an ineligible stage** (`Dispatched`, `Fraud Warning`, `Fully Picked`). **Decides Q31
  part 1: does `skippedStages` fire at all post-deploy, for any order type.** This does not need an
  ECOM picked-stage order, which has never been observed, so it is the cheap route into a question that
  has been stuck for a week.
* An order with a repeated option code (TC6), a reference over 25 characters (TC18 SCALE half), or a
  SKU absent from the SCALE item master (TC9 and TC15).

Record every reference in the chosen window with its stage and order type **before** enabling anything.
That list is what S2 is audited against.

## S2. Cycle 1, the create cycle

Set the watermark to 1 second below the oldest chosen order. Enable the schedule. **Use the schedule,
not a manual invoke**, because a manual invoke invalidates TC1 and TC11. Let it run one cycle for a
narrow window, or until it has caught up to present for a wide one, then disable it immediately.

Checks, each with the question it answers:

| Check | Question |
|---|---|
| Is the fresh wholesale order (if one was in window) created anywhere: native shipment row, any `*_OUTBOUND` status, any counter, any log line | **Q35.** LLD 9.2/9.3 says outbound family, BUSY-1160 says native family, BUSY-1161 excludes wholesale. On fresh data at an eligible stage, which happens |
| `skippedStages` contents against the ineligible-stage orders actually in the window | **Q31 part 1.** Does the counter fire at all post-deploy |
| `ordersFetched` against the sum of every printed counter, using `scripts/reconcile-poller-cycles.sh`'s own counter list | **Q36.** Do the counters still leak on the current build, and by how much |
| Does `faulty-sale-worker-queue-handler` fire on the fresh CTC reference, and does it log a named guard or bail line | **K1 and Q27.** Whether the split landed, tested behaviourally rather than from a code SHA |
| `lastEmittedPayloadHash` on the freshly created order row in `staging-orders-v2`, read after the emit | **K11.** LLD section 3 says the poller writes it on emit; TC13 measured it absent after a create |
| `company` on the fresh CTC shipment header row, and on a UNI row for comparison | **K6.** LLD has `Company` static `CTC`; Q29 measured `null` on a UNI order and no attribute on the row |
| The cycle's own logged `modifiedSince` against the watermark that was set | **K4.** Confirms the undocumented 5 minute lookback first hand |
| Field names present in the `staging-inventory-check-order-faulty-sale` log record for the fresh reference, presence only | **The PII question.** R11 confirmed it live on `261844`; this confirms it survived whatever was deployed since |

Regression on the same fresh orders, since they are free once the cycle has run: TC1, TC1b measured as
cycle-complete to `wmsSentAt` and not raw Cin7 modified-to-sent, TC8 row counts, TC16 `MessageGroupId`,
TC11 bus isolation depths before and after, TC10 if a Worship order is in window.

**Account for every reference in the window by name: created, counted, hard-errored, or unexplained.**
An unexplained order is Q36 reproduced on the current build, which is worth more than any of the
history sweeps.

## S3. Cycle 2, the second sighting. Same session, minutes later

R3 could never do this because its targets went stale. S2's orders are minutes old, so the window that
reaches them is minutes wide.

Set the watermark back to 1 second below the oldest S2 order, re-count the window, one cycle.

| Check | Question |
|---|---|
| Second sighting of an unchanged, already-sent order: no second transaction row, no second send, **and the suppressing guard named in the log** | **TC21 and TC21b.** TC21b's expected result is that the guard is named; an unnamed suppression is a FAIL, which is why it sits INCONCLUSIVE |
| `echoSkipped` on this cycle | Same, and note this counter did not exist before the 2026-09-03 deploy, so it has never been read on a real second sighting |
| Row counts unchanged from cycle 1 for every reference | **The version guard's replay half.** LLD section 3: a create, update or cancel applies only if the Cin7 `modifieddate` is not older than the stored `lastModified` |
| `lastEmittedPayloadHash` again | **K11.** Whether it appears on emit, on echo, or never |

## S4. Optional, only if a natural stage progression appears

R9 measured CTC orders moving `Processing` to `Dispatched` in 1 to 3 hours with nobody touching them.
If one of S2's orders has progressed, a narrow window over its new `modifiedDate` tests BUSY-1160's
update path: does an update reach SCALE, and does the payload carry lines on a non-line change. **A
stage progression is not a content edit**, so record which of the two the build reacts to. TC4's line
and address shapes stay parked, they need a content edit and nobody edits Cin7.

## Teardown, mandatory, after the last cycle

1. Disable the schedule, read back, confirm `DISABLED`.
2. **Unset the watermark override**, read back and record the value it returns to. JJ's instruction is
   unset, not restore to `2026-08-28T01:35:45.769Z`. If the tool's unset path is not clearly safe, stop
   and ask rather than guessing.
3. DLQ depths against the S0 baseline.
4. List every reference created this session, so the next session knows which rows are ours.

## Stop and ask JJ if

* The chosen window will not come down to single digits and he has not approved the wide sweep.
* A dispatch batch starts mid-cycle.
* Teardown cannot restore the schedule or the watermark.
* Any order in the window is unexplained after the cycle. Flag before running S3.

## Data handling

`faulty-sale-worker-queue-handler`, `staging-inventory-check-order-faulty-sale` and the dc-packing
workers log unredacted customer data. Extract named fields only. Width truncation is not redaction, see
`CLAUDE.md`.
