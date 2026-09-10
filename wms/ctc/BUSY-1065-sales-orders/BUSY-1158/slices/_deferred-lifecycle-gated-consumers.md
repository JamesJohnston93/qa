# DEFERRED, not a numbered slice

Parked 2026-08-31. Accepting or fulfilling a CTC shipment in SCALE is out of the BUSY-1158 pass by
decision, and JJ is raising it with dev after BUSY-1158 and BUSY-1159 are finished. Do not run this
from a BUSY-1158 session. Slice 04 is the read-only state map that decides whether the fixture this
slice needs already exists without anyone driving one.

Kept because the case work is sound and this becomes runnable the moment that conversation lands, or
the moment the confirmation leg (BUSY-1015 to BUSY-1017) starts moving shipments in staging.

---

# Slice 04, lifecycle gated consumers

**Ticket:** BUSY-1158
**Cases:** TC4e, plus P6 if JJ has accepted it
**Depends on:** slice 02 (the consumer list and the guard script extension)
**Estimated:** one session

Slice 02 read a dozen consumers as 0 matches and could not call any of them a pass, because
`261115`'s shipment has sat at `OPEN` since it was created. Every one of them reacts to a state that
order never reached. This slice finds a CTC shipment that did leave `OPEN` and reads them for real.

## Gate 0, verify the premise before spending the session

The plan assumes a CTC shipment somewhere in staging has reached a later state. **Check that before
anything else.** BUSY-1159 TC9 found rejections happening, but they were send failures at the sender,
which throws for redrive; whether that ever produces a `SHIPMENT_REJECTED` domain event on our own
bus is not established anywhere.

```bash
aws dynamodb scan --table-name staging-shipments --profile staging --region ap-southeast-2 \
  --filter-expression "company = :c" --expression-attribute-values '{":c":{"S":"CTC"}}' \
  --projection-expression "PK,SK,#s,createdAt" --expression-attribute-names '{"#s":"status"}'
```

Save it as `scripts/list-ctc-shipment-states.sh`. It will be run again, and the distribution of states
is itself worth recording.

Three outcomes, and only the first means carry on:

1. **At least one CTC shipment is not `OPEN`.** Take the most recent one and run the cases below.
2. **Every CTC shipment is `OPEN`.** Then no CTC record has ever exercised these consumers, and TC4e
   is not blocked on a fixture, it is blocked on the flow itself. Record the state distribution, write
   the result file saying so, and stop. That is a finding worth more than a test: it means the entire
   later half of the shipment lifecycle is untested for CTC by anyone, and it belongs to whoever owns
   the confirmation leg (BUSY-1015 to BUSY-1017), not to this ticket.
3. **Rejections exist but only as sender failures**, with no shipment row leaving `OPEN`. Same as 2,
   and additionally note that the DLQ references from BUSY-1159 (`261070`, `261073`, `261089`) are
   send failures, not domain rejections, so they cannot serve as a fixture here. Say so explicitly,
   because the next person will otherwise reach for them the way this slice nearly did.

Do not manufacture a state change. Nothing in this plan writes to the shipments table.

## Setup

Record the chosen shipment's PK, SK, status, the state it reached, and when. Every case reads that one
shipment.

## Cases

### TC4e, consumers gated on a later shipment lifecycle state

Trigger: run the extended `../../tools/cin7-sales-orders/check-ctc-consumer-guards.sh` against the chosen reference, then read
each consumer slice 02 listed as 0 matches directly, scoped to that shipment's own id.

The list, from `results/02-consumer-stance-live-order.md`: dc-packing address-update, delete and
hold-update, allocate-shipment-items, Shopify create-fulfilment, shipment-rejected and
cc-shipment-collected, the click and collect family, CX email, and order-item-status-updated.

Only the consumers whose triggering state this shipment actually reached can be judged. A shipment
that was rejected says nothing about the hold path.

Expect: each consumer that was invoked logs a guard line naming the shipment.

Capture: per consumer, one of three, and the distinction is the whole point of the slice. Invoked and
guarded. Invoked and not guarded. Never invoked, because this shipment did not reach its state either.

Fails if: a consumer processed the reference and produced a side effect with no guard line. Name it
and the line, the way slice 01 named the faulty sale worker.

Inconclusive if: invoked, silent, and no observable side effect. That is the `generate-pickslip`
shape from slice 02, Q28, and a second instance of it would be worth saying so.

**Redaction.** The dc-packing workers log customer names in object dumps and the faulty sale worker
logs whole record bodies at INFO. Extract the field you need with a narrow pattern. Never print a
matched line whole. See `TOOL-NOTES.md`.

### P6, inventory service consumption on a rejected CTC shipment

**Run this only if JJ has accepted P6 in `PROPOSALS.md`.** If its state is still "proposed", skip it
and say so in the result file.

Slice 01 confirmed two `staging-inventory-core` lambdas are wired to the shipping bus with no origin
or company filter, reading `TRANS_SHIPMENT_ITEM_ALLOCATED`, `TRANS_SHIPMENT_REJECTED` and
`SHIPMENT_FULFILLED`. Dev called the inventory service a silent correctness risk with no owner. Those
detail types are exactly what a shipment leaving `OPEN` emits, which is why this belongs in this slice
and nowhere else: on an `OPEN` shipment the question cannot be asked at all.

Trigger: read both inventory lambdas' logs, scoped to the chosen shipment's id and its window.

Expect: nothing. The LLD gives the inventory service no stance, so an unguarded consumer moving stock
on a CTC record is the failure mode dev warned about.

Capture: invoked or not. If invoked, whether an inventory adjustment was written, and against which
SKU and location.

Fails if: an inventory movement was written for a CTC shipment. That is a live correctness defect on a
service outside this ticket, and it stops the slice.

## Teardown

None. Read only throughout.

## Write results to

`results/04-lifecycle-gated-consumers.md`.

Record the CTC shipment state distribution from Gate 0 whichever way the gate goes. It is the fixture
map for anyone who comes back to this.

## Stop and ask JJ if

* Gate 0 lands on outcome 2 or 3, so there is nothing to test and the finding is about the flow
* an inventory movement was written against a CTC shipment
* a second consumer shows the `generate-pickslip` shape, invoked and silent with no side effect,
  since two instances would make it a pattern in how these guards are written rather than one gap
