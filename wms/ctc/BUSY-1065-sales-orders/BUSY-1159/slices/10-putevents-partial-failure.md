# Slice 10, PutEvents partial failure and the watermark

**Case:** TC22
**Depends on:** slices 01 to 09 done. Nothing in them is a prerequisite except the fixtures.
**Estimated:** one session, most of it spent on the gates rather than the test.

> **CLOSED FOR THIS TICKET, 2026-09-01.** Gates A and B have run and are clean, see
> `results/10-putevents-partial-failure.md`. Gate C and the write half are **deferred to BUSY-1162**
> by JJ's decision with dev's agreement, and are recorded as D1 in `../DEFERRED-TEST-CASES.md`.
> **Do not run the write half from this plan.** The method below is kept because BUSY-1162 will need
> it, not because it is outstanding work here.

**This is the first slice in this plan that writes anything.** Every earlier slice was a read, a
watermark reset, or a poller invoke. This one changes a Lambda's configuration. Read the whole slice
before the first call, and do not start it if you cannot finish it, because the revert is the half
that matters.

**Stage is `kian-dev`, not `staging`.** Do not run any part of the write half against staging.

## What is already answered, and what is left

Kian answered Q25 verbally on 2026-08-31: no batching, one order per `PutEvents` call, and the call
throws on failure so the watermark holds and the poll retries next cycle. **Do not raise Q25 with him
again.** That answer is accepted.

What is left is not the same question. A rejected entry does not always throw. `PutEvents` returns
**HTTP 200 with `FailedEntryCount` greater than zero** and a per entry `ErrorCode`, and the SDK does
not raise on that. So the case is narrow: **does the watermark hold on the 200 shape, or only on the
exception shape?** If the code checks `FailedEntryCount`, Kian's answer holds in both shapes and this
closes. If it checks only for a thrown error, the watermark advances past a record that never reached
the bus, which is silent loss with no trace.

One entry per call actually makes this cleaner than the purchase order version of the same question.
With a batch of one there is no partial failure: every failure is a total failure of that call, so
the forced condition below reproduces the exact production shape rather than an approximation.

## Gate A, before anything is changed. Confirm the batch size from our own evidence

Read the poller's `Pushed {"Entries":[...]}` log line on a real cycle and count the entries.

Plan B recorded the purchase order flow batching at 10 per call, 2,678 of 2,821 batches exactly 10.
Kian says the sales order poller sends one. Both can be true, they are different pollers, but the
premise has never been measured on this one.

* **One entry per call.** Proceed. This is the shape the slice assumes.
* **More than one.** Stop the write half and write up what you found. It does not contradict Kian, he
  may be describing intended behaviour or a recent change, but it does mean the case is a genuine
  partial failure rather than a total one, and the decision rule below needs rewriting before it can
  be run. Tell JJ, do not re-open it with Kian.

## Gate B, is the cheaper answer already available

**Plan B's B1.2 has never been run against the sales order bus, and it is free.** It is read only, it
needs no config change, no coordination, and it runs on staging.

Compare the poller's `recordsEmitted` / `Cin7RecordEmitted` count per cycle against the number of
records the populator logged receiving for the same window, across a decent sample of
cycles. The populator, not the sender: the sender coalesces, the populator does not.

**Name the right component, this cost a wrong turn once.** It is
`staging-orders-v2-eda-queue-populator`, resolved by reading the EventBridge targets on the bus rule
that matches `CREATE_TRANSACTION`, not by guessing from a name. The `*-buffer-populator` pair named
elsewhere in this plan's fixtures is the BigQuery reporting buffer, which CTC records are guarded
away from by design, so it would read a clean zero for a reason that has nothing to do with
`PutEvents` delivery. Match on `idempotencyId`, not on counts, and restrict the populator-side filter
to the poller's own `Source` or a CTC order's downstream events inflate the count roughly threefold.

* **Clean match on every cycle sampled.** No record has gone missing between `PutEvents` and the
  populator in the retained window. That does not prove the code checks the response, but it does
  establish the risk as latent rather than realised, and it is a legitimate stopping point. Record it
  and put the write half to JJ as a choice rather than doing it.
* **A shortfall in any cycle where the watermark still advanced.** The defect is demonstrated from
  existing data and no forced test is needed at all. Stop and tell JJ.

Do not skip this gate to get to the interesting part. It is cheaper, it is safer, and one of its two
outcomes ends the slice.

Note the known trap from Plan B: `get-metric-statistics` with `--period 86400` over a multi month
range mis-buckets days into their neighbours. Chunk anything longer than about two months and cross
check every non-zero day individually.

## Gate C, the coordination question, and it is JJ's to answer not yours

`kian-dev` is Kian's own stage and he is mid build on it. Changing an environment variable on a
Lambda he may be actively debugging, even for ten minutes, is the kind of thing that costs an
afternoon if he does not know it happened.

This is **not** re-raising Q25 with him. It is asking for a short window on his stage. Those are
different conversations and the standing instruction not to re-ask about Q25 does not cover it.

**Do not make the change until JJ confirms the window has been agreed.** If it has not, run Gates A
and B, write them up, and stop there. That is a complete and useful session on its own.

## The test, only after all three gates pass

The lever is the `INTERNAL_EVENT_BUS_NAME` environment variable on the poller. `PutEvents` targeting a
bus that does not exist does not throw. It returns 200 with `FailedEntryCount` greater than zero and
`ErrorCode: ResourceNotFoundException` per entry. That is the shape we need, reachable by one
revertible change.

1. **Snapshot `INTERNAL_EVENT_BUS_NAME` verbatim.** Save it to the result file before anything else.
   Also record the function's `LastModified`.
2. **Snapshot the watermark** and record DLQ depth.
3. Set `INTERNAL_EVENT_BUS_NAME` to a name that does not exist.
4. Set a **tight** watermark floor, minutes not hours, so only a handful of records are in play.
5. Watch one cycle. The observable is `Cin7PollerCycleComplete` and whether it reports
   `watermarkAdvanced:true`.
6. **Revert the env var immediately** and prove the revert with a fresh `get-function-configuration`.
   Check `LastModified` again: a deploy landing mid test would silently restore the real name and
   invalidate the run.
7. If the watermark advanced, **rewind to the snapshotted floor** so the stranded records are covered
   again, and confirm they land.

**The warm container trap, and it will silently defeat this test.** If the code reads the env var at
module init rather than per invocation, a warm container keeps the old bus name and the cycle proves
nothing while looking like a clean pass. A Lambda config update did **not** force a cold start in the
2026-08-06 sessions. **Confirm an `INIT_START` in the invocation you are measuring.** If there is
none, you are not testing what you think you are: wait for natural recycling or abandon the write
half and close on Gates A and B.

## Decision rule

| Observed | Verdict |
|---|---|
| Watermark **held**, cycle failed or errored | The code checks the response. TC22 PASS, Q25 closes fully, record which of the two it was |
| Watermark **advanced** despite every entry failing | Confirmed defect, high severity. Records are silently lost on a 200. Stop, rewind, tell JJ |
| No `INIT_START` in the measured invocation | Inconclusive. The test did not run, whatever the watermark did. Say so plainly and do not report a verdict |

## Stop and ask JJ if

* Gate A finds more than one entry per call
* Gate B finds a shortfall on a cycle where the watermark advanced
* the coordination window in Gate C is not confirmed
* the revert in step 6 does not prove clean on the first attempt
* anything in this slice would touch `staging` rather than `kian-dev`

## Write results to

`results/10-putevents-partial-failure.md`, then update `STATE.md` and the TC22 row in `QA-DOC.md`.

Tag every claim MEASURED, INFERRED or UNKNOWN. If the write half ran, the result file must carry the
env var snapshot, the revert proof and the `INIT_START` confirmation, or the verdict does not stand.
