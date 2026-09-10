> **CLOSED 2026-09-08. Do not re-run.** Harness built, Gate A passed with one named exception,
> TC12 PASS. Result: `results/03-synthetic-harness-and-fidelity.md`. Its open thread on outward
> events was resolved by slice 04 TC11. The harness gained a numeric `lineItemId` fix mid-slice-04.

# Slice 03, synthetic injection harness and fidelity gate

**Cases:** TC12, and the foundation every case in slices 04 and 05 rests on
**Depends on:** slice 01, all three gates
**Estimated:** a full session. Do not compress it

This slice writes to `staging-orders-v2-event-bus` and its records reach Manhattan SCALE staging.
It is the first slice in this plan that creates anything.

## What this slice is for

Slices 04 and 05 answer 15 of the 23 cases with synthetic transactions. If the harness that builds
those transactions is not faithful to what the poller actually emits, all 15 results are worthless,
and worse than worthless: they cost dev time to dismiss.

That has already happened on this epic. **BUSY-1260's C5 findings came off hand-built direct-invoke
payloads and were retracted**, because the poller builds the item `SK` and `sku` itself, so the
malformed key and null sku those tests drove could not arise from Cin7 data. TC45 went back to NOT
RUN and TC55 was removed.

So this slice proves the harness before anything rests on it. **If the fidelity gate does not pass,
stop. That is a complete and useful session**, and the plan reverts to waiting on real Cin7 edits.

## Part 1, build `scripts/emit-synthetic-revision.sh`

Read `../../tools/SCRIPTS-INDEX.md`, `SCRIPTS.md` and the header rule in `CLAUDE.md` first. Scripts are
saved, never run inline.

**Seed from reality, mutate one thing.** The script takes a real CTC order that already exists in
`staging-orders-v2`, reads its persisted record, and emits a transaction derived from it.

Required behaviour:

1. **Seed source is the persisted record**, read the way `inspect-ctc-order.sh` reads it. Do **not**
   source the seed by dumping poller log lines: `staging-orders-cin7-so-poller` carries unredacted
   customer data in its `Pushed` lines. The persisted record is already shaped by the schema.
2. **Never hand-write a payload from the LLD.** The LLD is the specification, not the observed shape,
   and this ticket's own drift table already carries three rows where the two disagree.
3. **Routing fields come from slice 01 Gate B's result file**, verbatim. `source`, `detail-type` and
   anything else the rule's event pattern filters on. Do not re-derive them and do not guess.
4. **Mutation is a single named flag**, one per case: add a line, change a quantity, remove a line,
   change the address, cancel, bump the modified date, leave unchanged. One flag per invocation, no
   combinations. A payload carrying two mutations cannot attribute its own result.
5. **The reference is rewritten** to `QASYN-<seq>-<case>`, under 25 characters, per the marking rule
   in `PLAN.md`. 25 is the SCALE `ShipmentId` ceiling that hard-errored the 33-character split child
   in BUSY-1159 slices 01 and 07.
6. **`--dry-run` is the default.** Print the constructed payload with customer fields redacted and
   emit nothing. Emitting requires an explicit flag. Every emit appends to `SYNTHETIC-REGISTER.md`
   before the call, not after, so a failed emit still leaves a trace.
7. Customer fields on a synthetic record should be replaced with obvious placeholders, not carried
   from the seed. The seed supplies **shape**, and carrying a real person's details into a
   deliberately fake order is both unnecessary and the thing `CTC-customer-data-in-cloudwatch.md`
   exists to prevent.

## Part 2, the fidelity gate

Two halves. Both must pass.

### Gate A, does a faithful replay behave exactly like the poller's own

Take a real CTC order that flowed recently. Rebuild its emit from its persisted record with **no
mutation at all** and the original reference, and compare the constructed payload against what the
poller actually emitted for it, field by field, key set included.

* **Key sets match, values match.** MEASURED fidelity. Proceed.
* **A field differs.** Do not proceed and do not patch the script until you understand why. A
  difference here is either a harness bug or a fact about the emit shape nobody has recorded, and
  both are worth more than the case that was going to use it.
* **The poller's own emit for that order is no longer in retention.** Use a more recent order. Do not
  substitute the LLD's description of the shape for the observed one.

### Gate B, TC12, the version guard in isolation

This is the fidelity gate and a real test case at once, and it is the design point that makes every
later negative result readable.

**Three independent mechanisms can silently swallow a synthetic transaction**, and "nothing happened"
cannot tell them apart:

1. the **idempotency index**, keyed `<event>#<origin>#<modifiedDate>#<payloadHash>`
2. the **version guard** on the order's stored `lastModified`
3. the **FIFO content dedup**, 5 minutes, on the orders-to-shipping queue

This is exactly what left BUSY-1159's TC21b INCONCLUSIVE: a suppression fired, nothing named which
guard did it, and the case was recorded as a pass having failed on its own terms.

They key on different things, so they can be separated. **To test the version guard alone, emit a
payload with a new `payloadHash` and an older `modifiedDate`.** The new hash means the idempotency
index lets it through; varied content means the FIFO dedup lets it through; so anything that stops it
is the version guard, by construction.

Run three emits against one seeded order, spaced more than 5 minutes apart:

| # | Payload | Expected | Proves |
|---|---|---|---|
| 1 | New hash, `modifiedDate` **older** than stored | No write, no send | Version guard rejects an older revision |
| 2 | New hash, `modifiedDate` **equal** to stored | Applied | Guard passes on equal, per whole-second precision |
| 3 | New hash, `modifiedDate` **newer** than stored | Applied, one outward event | Guard passes a genuine later edit |

Emit 2 matters more than it looks. **The guard passes on an equal timestamp, not only a newer one**,
because Cin7 `modifiedDate` has whole second precision and two edits inside one second carry the same
value. A test asserting strict inequality would report a false defect against correct code.

For emit 1, name the suppressor with evidence: the handler's own log line, a counter, or the absence
of a write against a same-window control that did write. **A bare absence is not attribution.** If
you cannot name it, TC12 is INCONCLUSIVE, not PASS, and say so.

**Establish the attribution instrument as part of this gate, because slices 04 and 05 depend on it.**
The poller gained `staleSkipped` and `echoSkipped` counters in the 2026-09-03 deploy (MEASURED, slice
01 and R14). **Neither is usable here.** They sit on the poller's `Cin7SOPollerCycleComplete` line and
a synthetic emit bypasses the poller entirely, so they will not move for an injected transaction. A
session reading `staleSkipped` at zero after an injection has measured nothing at all.

So find what the handler side offers, and write it into the result file for slices 04 and 05 to use:

* the reconciliation handler log groups did not exist as at slice 01, so the first injection creates
  them. Record what they actually emit on a suppression, verbatim
* whether the handler publishes a counter or metric of its own
* failing both, the control-based method: a same-window emit that should apply, against one that
  should be suppressed, so the suppression is measured as a difference rather than an absence

If none of the three yields attribution, say so plainly. That does not stop the slice, but it means
every later negative result is INCONCLUSIVE by construction, and JJ needs to know that before slice
04 runs rather than after.

## Part 3, record the ceiling

Before finishing, write down what the harness can and cannot reach, because slices 04 and 05 will be
tempted to claim more than it supports.

* It proves **handler behaviour given an input**. It cannot prove the input occurs. The honest form
  is "the handler reconciles a quantity change correctly", never "quantity changes work".
* It does not exercise the poller at all, so nothing it produces speaks to contact group resolution,
  stage eligibility, the watermark, or anything else in BUSY-1159's territory.

## Standing constraints for this slice

* **The poller schedule stays DISABLED and the watermark stays unset.** Injection does not involve
  the poller. If this slice seems to need the schedule, it has drifted.
* Every synthetic record goes in `SYNTHETIC-REGISTER.md` as it is created.
* Extract fields, never print or pipe a whole record.

## Stop and ask JJ if

* Gate A finds a field difference you cannot explain
* Gate B cannot attribute a suppression to a named mechanism
* the harness would need production Cin7 credentials for any reason. It should not, and if it appears
  to, the design has gone wrong
* a synthetic record reaches SCALE in a state you did not intend

## Write results to

`results/03-synthetic-harness-and-fidelity.md`, then update `STATE.md`, the TC12 row in `QA-DOC.md`,
`SCRIPTS.md`, `../../tools/SCRIPTS-INDEX.md` and `SYNTHETIC-REGISTER.md`.

Record the script as **not reviewed by a second person**, like every other script in these plans.

Tag every claim MEASURED, INFERRED or UNKNOWN.
