> **CLOSED 2026-09-08. Do not re-run.** TC15, TC16, TC20, TC21 PASS. **TC18 FAIL**, the cancel
> handler throws on a cancel for an unknown order and tripped a real alert. Result:
> `results/05-cancellation-and-isolation.md`. Its Q30 arm was a narrow negative and did not settle
> Q30; slice 07 does that.

# Slice 05, cancellation and isolation, synthetic

**Cases:** TC15, TC16, TC18, TC20, TC21
**Depends on:** slice 03's fidelity gate passing. Runs independently of slice 04
**Estimated:** one session

Writes to `staging-orders-v2-event-bus`. **This slice issues DELETEs against Manhattan SCALE
staging.** Read the marking and teardown rules in `PLAN.md` before starting.

Cancellation was the least reachable thing on this ticket under the 2026-09-01 plan, because Cin7 is
production and no order can be voided. It is now drivable, and that is the single biggest change this
plan makes.

## How cancellation is actually raised, and why it is not `isVoid`

**Cancellation is inferred from loss of eligibility, not from a void flag.** The LLD deliberately
leaves `isApproved` out of the Cin7 query because voiding may clear it and hide cancellations. So a
synthetic cancel is an emit that makes the order ineligible, not an emit carrying a cancel field.

That distinction is the whole of TC16, and it is the case most likely to find something. Loss of
eligibility has more than one cause, and they are not supposed to mean the same thing:

* an order reaching `Dispatched` has completed normally and **must emit nothing**
* an order losing eligibility another way is a cancellation and **must emit a cancel**

If both produce a cancel, real dispatched orders get deleted out of SCALE, which is a serious defect.
If neither does, cancellations never reach the warehouse. Both failure directions are worth naming in
the result file.

## Cases

| TC | AC | Emit | Assert |
|---|---|---|---|
| TC15 | AC5 | Seeded order made ineligible by cancellation | Order **flipped, not physically deleted**, on the orders side. Header DELETE reaches SCALE on the same `ShipmentId` |
| TC16 | AC5 | Two orders: one to `Dispatched`, one losing eligibility another way | `Dispatched` emits **nothing**. The other emits a cancel. Two seeds, two emits, compared |
| TC18 | none | DELETE for a `ShipmentId` SCALE does not hold. Use a `QASYN-` reference never sent | Logged as benign, **no alert**, no DLQ message |
| TC20 | none | Emit modified only in fields the confirmation leg writes: stage, shipped quantities, tracking, dispatch dates | **No second send.** See the reframing note below |
| TC21 | none | A Universal Store order in the same window as any of the above | Untouched by the update and cancel paths |

**TC15's two halves are independent and both matter.** "Flipped not deleted" is an orders-table read.
"Header DELETE reaches SCALE" is a sender and SCALE read. A pass needs both, and a cancel that flips
the row but never reaches SCALE leaves a live job in the warehouse for an order that no longer exists.

**TC18 is cheap and should run early**, because it is the safest write in the whole plan: a DELETE for
something that was never sent cannot damage anything, and it establishes that the sender's error
handling is sane before TC15 issues a DELETE that is supposed to work.

**TC20's framing has moved twice. Read this before writing the case.**

Reframed 2026-09-02 after BUSY-1159 slice 13: a payload hash **is** computed on every emit and
carried as the trailing segment of `idempotencyId`.

**Corrected again by slice 03, and this part matters for TC20.** That segment and
`orderInfo.lastEmittedPayloadHash` are **different values on the same order**, MEASURED across four
real orders. They are two independently computed hashes, not one value carried twice, and neither
algorithm is known without a code read. `lastEmittedPayloadHash` **is** written and updated on every
applied revision (MEASURED, slice 03 used exactly that to confirm a write landed), so the old
"never exposed" framing is wrong too. What you cannot do is predict or reproduce either value, so do
not assert on a hash matching a computed expectation. Asserting that it **changed** is fine and is
what slice 03 did.

**Corrected again 2026-09-08.** The 2026-09-02 note also said no echo-skip counter exists. That is
now out of date: **`echoSkipped` is one of six fields the 2026-09-03 deploy added** to the poller's
`Cin7SOPollerCycleComplete` line, alongside `staleSkipped`, `updated`, `cancelled`,
`skippedLocallyTerminal` and `skippedNoSizes`. MEASURED in slice 01's counter vocabulary and
corroborated by R14's pre/post-deploy line-type diff.

**But it does not help this case, and here is the trap.** `echoSkipped` and `staleSkipped` are
counters on the **poller's** cycle line. A synthetic emit bypasses the poller entirely, so neither
will move for an injected transaction. A session that reads `echoSkipped` at zero after an injection
and concludes the echo guard did not fire has measured nothing. Whether the handler-side guard has
its own counter is **UNKNOWN**, and slice 03's Gate B is where that gets established.

So assert the behaviour, no second send, and take attribution from the handler side. See D17 in
`../DEFERRED-TEST-CASES.md`. Ceiling unchanged: this tests the guard against a synthetic echo, and
the real confirmation leg does not exist yet, so a pass is about the guard, not about confirmations.

**TC21 costs nothing extra.** Run it as a control alongside whichever case is in flight rather than as
its own exercise.

## Q30 is now drivable here, and it is the highest-value thing in this slice

Q30 in `../BUSY-1065-OPEN-QUESTIONS.md` sits at `TRIED 1, inconclusive on population`. It asks
whether an order reaching a picked stage is read as a loss of eligibility and therefore **DELETEs a
live SCALE shipment for a job the warehouse is actively working**.

Its first attempt could not answer it: all 12 CTC orders the epic had ever sent were `Dispatched`, so
the case never arose in real data. **The harness removes that dependency.** A synthetic revision can
put an order at `Fully Picked` or `Partially Picked` directly and the answer is then measured rather
than waited for.

This is a **differing-in-kind second attempt**, not a wider re-run of the first: attempt 1 was a
read-only population check against orders already sent, this is a controlled emit with a chosen
stage and a same-window control. That satisfies the register's own bar.

Run it as part of TC16, since it is the same mechanism: TC16 already asks whether an order losing
eligibility one way emits a cancel while a `Dispatched` one emits nothing. Add a picked-stage arm to
it. **If a picked-stage revision produces a header DELETE, that is a defect finding of real
consequence**, because it would delete a warehouse job in progress, and it should stop the slice and
go to JJ before a verdict is written. Record the outcome against Q30 in the register either way.

## Attribution rule

As slice 04. Three mechanisms can swallow a transaction: the idempotency index, the version guard,
the FIFO dedup. **Every negative result names which one, with evidence.**

TC20 and TC16's `Dispatched` half are both cases where **the expected result is that nothing
happens**, which makes them the two most likely in the plan to be recorded as passes without
attribution. That is precisely the TC21b failure. If you cannot name why nothing happened, the
verdict is INCONCLUSIVE.

## Teardown

Slice 05 is the only slice that can remove its own records, because the cancel path issues a DELETE.
Do not clear the register silently. Record which synthetic shipments remain in SCALE at the end and
leave the decision to JJ, per `PLAN.md`.

## Standing constraints

* Poller schedule DISABLED, watermark unset, throughout.
* Every synthetic record in `SYNTHETIC-REGISTER.md` as it is created, including every DELETE.
* Extract fields, never print or pipe a whole record.
* SCALE reads in **Order Planning > Planned Shipment Insights**, not Shipping Insights.

## Stop and ask JJ if

* TC16 produces a cancel on the `Dispatched` order. That is a defect finding, stop before writing a
  verdict
* a DELETE reaches a shipment that is not a `QASYN-` record
* TC15 flips the order but nothing reaches SCALE, or the reverse
* a null result cannot be attributed after a genuine attempt

## Write results to

`results/05-cancellation-and-isolation.md`, then update `STATE.md`, the five case rows in
`QA-DOC.md`, and `SYNTHETIC-REGISTER.md`.

Tag every claim MEASURED, INFERRED or UNKNOWN.
