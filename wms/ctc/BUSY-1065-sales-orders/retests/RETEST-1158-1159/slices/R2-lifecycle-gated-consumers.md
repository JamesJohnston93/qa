# Slice R2, lifecycle-gated consumers on a CTC shipment

**Ticket:** BUSY-1158, AC5
**Cases:** TC4e, plus the TC4b consumers that slice 02 could only mark inconclusive
**Depends on:** nothing but its own precondition. Corrected 2026-09-04: this slice needs a CTC
shipment that has moved off `OPEN` **by any route**. It was originally written as downstream of R3,
and R3 can no longer produce that state change, so the dependency is dropped rather than inherited.
Run `../../BUSY-1158/scripts/list-ctc-shipment-states.sh` first, any time; if every CTC shipment is still
`OPEN`, stop there.

**Last checked 2026-09-04 by this slice: 79 of 79 still `OPEN`**, grown from 70 at slice 04 by this
pass's own sends, distribution unchanged at 100% `OPEN`.
**Estimated:** 40 minutes, not a full session

## Why this is runnable now when it was not before

TC4e has been BLOCKED since slice 04 for one reason: all 70 CTC shipments on staging are `OPEN`, from
a complete table scan. Consumers gated on a later lifecycle state have therefore never seen a CTC
record, and their stance is untested rather than proven.

R0 Gate B measured that the four dc-packing workers all changed on 2026-09-03, including
`staging-shipping-v2-dc-packing-shipment-address-update` and
`staging-shipping-v2-dc-packing-shipment-delete`, and that the `cancel-order` family now exists on a
`TRANS_CANCEL_ORDER` rule. Those are the first mechanisms in this integration that can move a CTC
shipment out of `OPEN`.

Note the split R0 found: the dc-packing **top-level dispatcher**
(`staging-shipping-v2-dc-packing-eda-queue-handler`) did **not** change, its four workers did. Do not
report "dc-packing changed" without that distinction.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
./list-ctc-shipment-states.sh --stage staging --profile staging   # ../../BUSY-1158/scripts/
```

Run the state map first. It is the same scan slice 04 used, so its output is directly comparable.
Expect the distribution to have changed if R3 did its work. If every CTC shipment is still `OPEN`,
R3 did not move one and this slice stops here.

## Setup

None of its own. The fixture is whatever R3 left behind. Record its `ShipmentId`, its current status,
and the timestamp of the state change, since every log window below is anchored on that timestamp.

## Cases

### TC4e, consumers gated on a later shipment lifecycle state

Trigger: for each consumer that slice 02 could only mark inconclusive because the shipment never left
`OPEN`, read its log group over the window around the state change.

The four named in the BUSY-1158 diagram as unchecked against TC4b, and which slice 02 actually queried
and got zero matches from:

* reallocation
* NewStore
* Shopify (`staging-shipping-v2-shopify-move-fulfilment-orders`, **changed 2026-09-03**)
* click-and-collect

Plus the two whose own workers changed and which the state change now reaches:

* `staging-shipping-v2-dc-packing-shipment-address-update`
* `staging-shipping-v2-dc-packing-shipment-delete`

Expect: each skips, and says so with a guard line naming the shipment id, matching the shape TC4b
already proved on create.

Capture: per consumer, one of three verdicts. Invoked and skipped with a named guard. Invoked and
handled, which is a FAIL. Never invoked, which is not a pass, it is the same absence that blocked this
case in the first place, so say so plainly.

Audit item 9 applies here: **checked and uninformative is not the same as untried.** Slice 02 queried
each of these and got zero matches, and the BUSY-1158 diagram wrongly shows them as unchecked. Whatever
this slice finds, correct that diagram's marking in the result file so R7 can fix it.

Fails if: any consumer handles a CTC shipment rather than skipping it. Name the consumer and the log
line.

Inconclusive if: a consumer is never invoked at all on the state change. Record which, and what the
state change actually was, since a delete may reach a different set than an address update.

### The cancellation path, if R3 produced one

Trigger: if R3 cancelled an order rather than only updating an address, read
`staging-orders-cin7-cancel-order` and its dispatcher pair over the same window.

Expect, per BUSY-1160's ACs: the order is flipped without physical deletion on our side, and the
sender issues a delete on the shipment id.

Capture: whether the order row still exists and carries a cancelled state, and whether the delete
reached the sender. This is 1160 evidence rather than 1158 evidence, so record it as such and hand it
to that ticket rather than folding it into AC5.

## Teardown

None. Nothing changed by this slice. Leave R3's fixture alone.

## Write results to

`results/R2-lifecycle-gated-consumers.md`.

Include the refreshed CTC shipment state distribution from `list-ctc-shipment-states.sh`, since it is
directly comparable to slice 04's and shows whether the population has actually moved.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* any consumer handles a CTC shipment rather than skipping it
* the state change reaches no consumer at all, which would mean TC4e is still untestable and the
  blocker survives the deploy
* the shipment was physically deleted on a cancellation rather than flipped, which contradicts 1160's
  own AC
