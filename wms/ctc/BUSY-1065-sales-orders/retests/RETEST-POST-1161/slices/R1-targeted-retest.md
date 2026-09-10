# Slice R1, targeted re-test against the 2026-09-09 build

**Scope:** set by R0's changed-component table. Read
`results/R0-build-identification.md` before anything else; do not re-derive what changed
**Cases:** BUSY-1160 TC1b, TC2, TC3, TC12, TC18, TC22, plus BUSY-1158 TC4b. Q30, Q31, Q41
**Depends on:** R0, which has run
**Estimated:** two sittings. **Stop after any part**, each stands alone

Parts 1 and 4 are read only. Parts 2 and 3 emit and reach Manhattan SCALE staging.

## What R0 established, so this slice does not redo it

* **The shared `staging-orders-v2-create-transaction` changed only by addition** for everything the
  native harness constructs. Enums identical, whitelist gained the outbound blocks and lost nothing.
* **The version guard is not in that handler.** It lives in the reconciliation handlers and reads
  `incomingLastModified >= stored`, unchanged. The five named attribution metrics are all still
  present verbatim.
* **Q41 is closed.** `WAREHOUSE_BY_BRANCH_ID` is gone; a single `CTC_WAREHOUSE = "CTC-QDC"` constant
  is passed unconditionally.

**So this slice does not re-read the shared handler or the version guard.** It re-tests what R0 could
not settle by reading.

## Part 1, source re-reads against the new build. Read only

Four findings were established by reading artifacts that have since been replaced. Each is one grep
with `../../../tools/inspect-lambda-code.sh`, and together they cost a fraction of one emit.

| Read | Function | What the old build showed | Closes |
|---|---|---|---|
| 1a | `staging-orders-cin7-so-poller` | `ELIGIBLE_STAGES = ["New","Processing","Fully Picked","Partially Picked"]` | Q30 and Q31 |
| 1b | `staging-shipping-manhattan-send-shipment` | `rejectedTransactions !== 0` throws, classified `"rejected"`, alerted permanent | TC17's classification half |
| 1c | `staging-orders-cin7-so-poller` | `Exempt` explicitly mapped in `deriveOrderMoneyContext`; `Undefined` unhandled | TC22 |
| 1d | `staging-orders-cin7-cancel-order` | Throws uncaught when no `ORDER` row exists, no named failure metric | TC18 Form A |

**1d is the one to watch.** TC18 is this ticket's only FAIL and it is about to be raised with dev. If
the redeploy fixed it, that changes what you send. If it did not, the report goes out with a
current-build citation instead of a stale one, which is worth having either way.

**1a matters more than it looks.** Q30 and Q31 were both closed on 2026-09-09 against a poller whose
`CodeSha256` has since changed. If `ELIGIBLE_STAGES` still contains both picked stages, both stay
closed and say so against the new build. If it does not, Q30's risk is live again and that stops the
slice.

## Part 2, the outbound re-run. Emits

R0 names TC1b, TC2 and TC3 as the most likely verdicts in the plan to be stale: they were proven
against the outbound pipeline, and every function in that chain changed today.

Use `../../BUSY-1160/scripts/emit-synthetic-outbound-order.sh`. **Sequence numbers continue from
`QASYN-13-TC2RTV`, so start at `QASYN-14`.** Register before the emit, as always.

**Emit 1, the one Q41 blocked.** A WHOLESALE order that would previously have carried `CTC-WH`. With
the branch lookup gone, this should now reach Manhattan rather than being rejected on the warehouse
code. **This is Q41's runtime confirmation**, distinct from R0's source read, and it is worth having
because the earlier rejection was measured, not inferred.

**Emit 2, the mapping pair.** A delivery company over 25 characters, no person name. Confirms
`deriveShipTo` still takes the company and still truncates. That is TC1b.

For both, re-confirm **TC2** (which records get written, and where) and **TC3** (one row per size,
each with its own quantity) against what the old build produced. **Report any difference from the
recorded verdicts explicitly**, including a difference that looks like an improvement.

## Part 3, native reconciliation. Emits

The poller, `update-order` and `cancel-order` all changed. R0 read the version guard and the
attribution metrics and found them unchanged, but did not diff the rest of those bundles.

### Gate, amended 2026-09-09. JJ has seen the anomaly. Characterise it, then proceed

R1's first attempt stopped here correctly. **JJ has now seen it and authorised proceeding once the
message is characterised**, which is not the same as proceeding regardless. Do the reads below first.

`staging-shipping-manhattan-sender.fifo` shows `0 waiting, 1 in-flight`, with no invocation in
`staging-shipping-manhattan-send-shipment`'s log group for 14 to 15 hours against a 25 minute
visibility timeout. A message should have returned to visible and been redelivered long ago.

**Do not try to receive the message.** An in-flight message is invisible, so `ReceiveMessage` returns
nothing while it stays that way and tells you only that it is still invisible. It also increments
`ApproximateReceiveCount`, which on a genuinely stuck message pushes it toward the DLQ for no gain.

Four read-only checks, cheapest and most likely first:

1. **The event source mapping on the sender.** `lambda:list-event-source-mappings` for this queue.
   Read `State` and `LastProcessingResult`. **If the mapping is Disabled, that explains the whole
   anomaly**, both the absent invocations and the message never redelivering, and it means anything
   Part 3 emits would also sit unprocessed. This is the hypothesis to rule out first.
2. **`ApproximateAgeOfOldestMessage`** on the queue, via CloudWatch. This settles whether a genuinely
   old message exists or whether `ApproximateNumberOfMessagesNotVisible` is simply stale, which it is
   documented to be on low-throughput queues.
3. **`NumberOfMessagesReceived` and `NumberOfMessagesDeleted`** over the last 24 hours. If both are
   zero across the window, nothing is consuming this queue at all.
4. **The redrive policy**, so the `maxReceiveCount` and DLQ target are on record.

**Reads as:**

* **The mapping is disabled, or nothing is consuming the queue.** That is a finding in its own right
  and it blocks Part 3, because an emit would prove nothing. Stop, write it up, tell JJ.
* **The count is stale and no old message actually exists.** The anomaly dissolves. Proceed with the
  two emits below and record that it was a metric artefact.
* **A real message is genuinely stuck with the mapping enabled.** Proceed with the emits anyway, per
  JJ's authorisation, but say so plainly in the result and treat any emit that does not complete as
  explained by this rather than by the redeploy.

Two emits, seeded and mutated the usual way:

1. **One TC12-style revision triple** on a fresh order: older `modifiedDate` rejected with
   `SalesOrderStaleRevision`, equal applied, newer applied. Confirms the version guard behaves as
   R0's source read says it should.
2. **One cancel** on an order that exists, expecting `SalesOrderCancelReceived` then
   `SalesOrderCancelled`, the order flipped not deleted, and a header DELETE reaching SCALE.

That is enough to confirm the native path still reconciles. **Do not re-run the whole of slices 03 to
05.** If either emit behaves unexpectedly, stop and say so rather than expanding the slice.

## Part 4, BUSY-1158's TC4b. Read only

R0's own at-risk table did not catch this one.

**`staging-shipping-v2-dc-packing-shipment-create` changed today**, unexpectedly under a scoped
outbound reading. BUSY-1158's **TC4b passed on that consumer skipping a CTC shipment**, evidenced by
a guard line naming the shipment id in the same invocation.

A pass built on a consumer skipping is exactly the kind that a redeploy can invert silently. Re-read
the guard in the new bundle, or find a recent CTC shipment in its log group and confirm the guard
line still appears. **Do not create a new shipment for this**; the existing synthetic ones are
sufficient.

Also worth recording while you are there: **`staging-inventory-check-order-faulty-sale` changed on
2026-09-07**, outside today's window and unaccounted for by anything this plan knows. Note its
current `LastModified` and `CodeSha256` so a future session has a baseline. Do not investigate it
from here.

## Standing constraints

* **Cin7 is CTC production. READ ONLY, GET calls only.** Nothing in this slice needs a Cin7 call.
* **Poller schedule stays DISABLED and the SO watermark stays UNSET.** R0 confirmed both. Nothing
  here needs either.
* Every synthetic record in `../../BUSY-1160/SYNTHETIC-REGISTER.md` **before** the emit, `QASYN-`
  prefixed, under 25 characters, continuing from seq 14.
* Seed from a real persisted order, mutate only what the case needs, never hand-write from the LLD.
* Attribution from the handlers' own named log lines, never poller-side counters.
* Extract fields, never print or pipe a whole record. A redactor must recurse.
* **Use `filter-log-events` against a log group directly.** `describe-log-streams` has produced a
  false "no send" read twice on the Manhattan sender.
* Tag every claim MEASURED, INFERRED or UNKNOWN. Where a verdict is unchanged from the old build, say
  so against the new `CodeSha256` rather than leaving it implied.

## Stop and ask JJ if

* Part 1a finds the eligible-stages list no longer contains both picked stages, which puts Q30's risk
  back in play
* Part 1d finds TC18's behaviour changed, before anything is sent to dev
* the Manhattan sender's in-flight message is still stuck
* any Part 2 or 3 emit behaves differently from the recorded verdict
* Part 4 finds the dc-packing guard no longer fires

## Write results to

`results/R1-targeted-retest.md`, then update `../../BUSY-1160/QA-DOC.md` and `STATE.md` for every case
whose verdict this slice re-confirms or changes, `../../BUSY-1160/SYNTHETIC-REGISTER.md`, and Q30, Q31
and Q41 in `../../BUSY-1065-OPEN-QUESTIONS.md`.

**Every re-confirmed verdict should cite the new build**, not just say "unchanged". The whole point of
this slice is that the old citation is no longer sufficient.
