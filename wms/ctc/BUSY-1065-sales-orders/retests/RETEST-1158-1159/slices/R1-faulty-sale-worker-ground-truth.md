# Slice R1, faulty sale worker ground truth

**Ticket:** BUSY-1158, AC5
**Cases:** TC4f, TC4c, TC4d, plus audit item 8 and the inventory write side
**Depends on:** R0. Read `results/R0-build-identification.md` Gate B and Gate D first.
**Estimated:** one session

## What R0 already settled, and what it means for this slice

R0 Gate D measured that the CTC split named in Q27's dev answer **has not landed**.
`faulty-sale-worker-queue-handler` is unchanged since 2026-03-04, still on the same rule
`staging-inventory-faulty--faultysaleworkerfaultysal-O9HvnJv0c14A` on `staging-orders-v2-event-bus`,
pattern `{"detail-type":["TRANS_CREATE_ORDER"]}`, no origin or company filter, no intermediate lambda,
single target `faulty-sale-worker-queue-populator`.

So **TC4f's expected result cannot be met.** Its expectation is no CTC reference in that log group at
all, and the mechanism that would produce that does not exist. Record TC4f as FAIL against the
current build and move on. Do not spend the session trying to make it pass.

The value of this slice is elsewhere. Q27's answer has two halves, and JJ's call on 2026-09-04 is to
re-verify both from behaviour rather than accept either:

1. "CTC is split out a layer up so it never reaches the lambda." R0 measured this as false.
2. "The lambda cannot execute on a CTC order because the fields it needs are absent, so it is wasted
   invocations rather than a correctness problem." **This is the claim under test here.** The prior
   investigation measured every invocation, CTC and non-CTC, returning `StatusCode 200`, `Payload
   null`, `Errors 0`, which is consistent with running to completion, not with being unable to
   execute. The write side has never been checked.

Absence of an error is not absence of a write. That sentence is the whole slice.

## Preconditions

```bash
aws sts get-caller-identity --profile staging     # expect account 398353400186
```

Nothing here creates an order or invokes anything. Read only throughout.

## Cases

### TC4f, sweep the faulty sale worker for a live CTC reference

Trigger: pick CTC references whose create time is inside the 30 day CloudWatch retention window.
`261115` and `WOR19261` are the best documented, see `../../BUSY-1159/fixtures.md`. Use two, not one.

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/faulty-sale-worker-queue-handler \
  --filter-pattern '"<reference>"' --profile staging --region ap-southeast-2 \
  --start-time <epoch-ms> --end-time <epoch-ms>
```

Expect, per the case: no CTC reference at all. Per R0: the reference will appear, because nothing
filters it out.

Capture: whether each reference appears, and the invocation's `REPORT` line (duration, billed
duration, memory). Do not print matched lines whole, this log group carries unredacted customer data.
See `../../CTC-customer-data-in-cloudwatch.md`.

Fails if: a CTC reference appears. This is the expected outcome now. Record FAIL against TC4f and
carry AC5 as FAIL, with R0 Gate D as the reason rather than a new finding.

### The behavioural half, does it execute or bail

Trigger: for the same references, read the full invocation, start line to `REPORT`, and establish
which it is:

* it entered its own handler body and returned early on a missing field, which supports dev's answer
* it entered and ran its normal path to completion, which contradicts it

The distinguishing evidence is what the lambda logs between `START` and `END`, plus duration. A bail
on a missing field and a completed run rarely have the same duration profile. Compare a CTC
invocation against a non-CTC one in the same window.

Capture: for each invocation, `START`/`END`/`REPORT`, duration, and the sequence of its own log lines
by message shape, not content. Tag the verdict MEASURED, INFERRED or UNKNOWN. If the lambda logs
nothing of its own between `START` and `END`, say so and mark it UNKNOWN rather than reading silence
as a bail.

### The write side, never checked before

Trigger: for each CTC invocation found above, check whether anything was written or emitted in that
window.

```bash
# the inventory table: is there a row keyed on, or carrying, this reference
aws dynamodb query --table-name staging-inventory-v2 ... --profile staging --region ap-southeast-2
# the inventory bus: any rule whose target fired in the window
aws events list-rules --event-bus-name staging-inventory-bus --profile staging --region ap-southeast-2
```

`staging-inventory-v2` holds 11.7M items with a stream enabled, so a full scan is not acceptable.
Query on the key, or read the stream consumer's log group over the invocation window instead. Decide
which before you start and say which you used.

Expect: nothing written for a CTC reference.

Capture: the query or log read you actually ran, and its result. If you cannot address the table by
key from the reference alone, say so and mark the write side UNKNOWN. That is a legitimate outcome
and better than a scan.

Fails if: anything was written or emitted for a CTC reference. That converts Q27 from a tidiness
question into a correctness defect on someone else's service, and it stops the slice, see below.

### TC4c, re-sweep against the real event wiring

Trigger: re-run `read-event-wiring.sh` (in `../../BUSY-1158/scripts/`) and diff its output against the
subscriber table in `../../BUSY-1158/results/01-wiring-and-guard-shape.md`.

R0 Gate B already established that six consumers did not change and the rest did, and that the newly
appeared names are the BUSY-1160 handlers rather than surprise consumers. This case is the
confirmation at rule and target level rather than at function level.

Expect: the same subscriber set as slice 01, plus the `cancel-order` family on `TRANS_CANCEL_ORDER`.

Capture: three columns as in slice 01, subscriber, whether the LLD audit table lists it, whether
`check-ctc-consumer-guards.sh` checks it. Add a fourth: changed since 2026-09-02, from R0's table.

Fails if: a subscriber exists on these event types that is in neither the audit table nor the sweep
script. Name it.

### TC4d, pickslip on a live CTC shipment

Trigger: `staging-shipping-v2-generate-pickslip` **changed on 2026-09-03** (R0 Gate B), so this is
worth re-reading rather than carrying. Read its log group for a live CTC shipment reference and look
for a named guard line.

Expect: a guard line that names the shipment id, as `dc-packing` create and Shopify move-fulfilment
both do (TC4b).

Capture: the literal guard line if one exists, and the `pickslipUrl` attribute state on the shipment
row either way.

Inconclusive if: still no guard line and still no downstream pickslip URL. That is the same standoff
as before, a real skip and an unguarded run that produced nothing are not distinguishable from
outside. Record it as INCONCLUSIVE again rather than upgrading it, and note that the code changed
under it.

### Audit item 8, `staging-orders-dn-rec-eda-queue-handler`

Trigger: this consumer was measured once, its env vars read, and the conclusion recorded as "UNKNOWN
not MEASURED, out of scope, but not confirmed either way". It is absent from TC4c's blocker list. R0
shows it unchanged since 2025-12-30.

Read its log group for a CTC reference over the same windows used above, and give it a stance.

Capture: ran, skipped with a named guard, or never invoked. One of those three.

## Teardown

None. Nothing was changed.

## Write results to

`results/R1-faulty-sale-worker-ground-truth.md`.

Structure the result around the two Q27 halves, since that is what it exists to answer. State plainly
which half is MEASURED, which is INFERRED, and which is UNKNOWN.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* **anything was written to `staging-inventory-v2` or emitted on `staging-inventory-bus` for a CTC
  reference.** That is a live correctness risk on another team's service and JJ will want it raised
  before any more testing happens.
* the lambda's own log lines show it processing a CTC order rather than bailing, which contradicts
  the accepted answer to Q27 and needs to go back to Kian as measurement, not opinion.
* a subscriber turns up on these event types that is in neither the audit table nor the sweep script.
* the customer data exposure in this log group has grown rather than stayed the same.
