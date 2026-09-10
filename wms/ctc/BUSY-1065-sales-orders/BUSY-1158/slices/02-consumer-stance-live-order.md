# Slice 02, consumer stance on a live order

**Ticket:** BUSY-1158
**Cases:** TC2b, TC4b, TC5b
**Depends on:** slice 01 (the real subscriber list, in `results/01-wiring-and-guard-shape.md`)
**Estimated:** one session

## Preconditions

A CTC reference that exists in the orders table. It does not need to be fresh and nothing here
creates one. Check an order already used under BUSY-1159 first:

```bash
../../tools/cin7-sales-orders/inspect-ctc-order.sh --stage staging --profile staging --reference 261115
```

If its log window has aged out of the 30 day retention, pick a more recent reference from the table
rather than re-enabling the poller schedule. Only if nothing recent exists should you poll, and then
narrow the watermark window hard. Remember `cin7-watermark.sh` defaults to `--poller item`; sales
order work needs `--poller so` on every call.

Slice 01 must be done. Sweeping the LLD list again instead of the real one is the mistake this plan
exists to avoid.

## Setup

Record the reference, its create time and its `modifiedDate` at the top of the result file. Every case
below reads the same order.

## Cases

### TC2b, transaction payload block carries the three fields

Trigger: read the transaction row for the reference and look inside the shipment payload block, not
just at the header.

```bash
../BUSY-1159/scripts/list-transaction-rows.sh --stage staging --profile staging --reference <ref>
aws dynamodb get-item --table-name staging-shipments --profile staging --region ap-southeast-2 \
  --key '{"PK":{"S":"<pk>"},"SK":{"S":"TRANSACTION#<epoch-ms>"}}'
```

Save the read as `scripts/read-transaction-payload.sh`, printing the payload block's keys and the
three values, and nothing else from the row. The row carries customer data.

Expect: `company`, `orderType` and `cin7Id` present inside the payload block.

Capture: the three key names and values, redacted of everything else.

Fails if: any of the three is absent from the payload block while present on the header. AC3 names
both places, and the payload block is the half nothing has read yet. A field declared but not written
into the block is a real gap, because the confirmation leg reads the block.

### TC4b, the audited consumers the sweep does not reach

Trigger: check the stance of every consumer in slice 01's list that
`check-ctc-consumer-guards.sh` does not currently cover. From the LLD audit table that is pickslip
generation and the merger, the dc-packing workers, reallocation, the NewStore, Shopify and click and
collect consumers, CX email and notifications, and the `listOrders` gateway. Slice 01 will have added
to that list.

Extend `../../tools/cin7-sales-orders/check-ctc-consumer-guards.sh` rather than writing a second script beside it. It already
knows the three expectation kinds, RAN, SKIP-MARKER and SKIP-SILENT, and a second sweep script that
disagrees with the first is worse than no sweep at all. Record the change in `TOOL-NOTES.md`.

Run it at `--since-min` wide enough to cover the order's create time, and never trust a negative
result taken inside 10 minutes of the event. Some consumers log late.

Expect: each consumer either logs a guard line naming the reference, or never sees the reference at
all.

Capture: per consumer, which of the two you observed. This is the distinction the whole slice turns
on. A SKIP-MARKER row that produces silence has not passed. It has told you nothing, because a
consumer that was never wired up looks identical.

Fails if: a consumer processed the reference without a guard line. Name it and the line.

Inconclusive if: a consumer is silent and its expectation kind is SKIP-SILENT. Record it as
inconclusive rather than PASS, and say what evidence would settle it.

### TC5b, the order behind the Segment guard carried a customer email

Trigger: read the order row for the reference and check whether a customer email is present.

Save as `scripts/check-order-email-present.sh`. **Print presence and length only, never the value.**
This case is a question about an email field and the output will be pasted into a result file.

Expect: an email present on the order.

Capture: present or absent, and the field name it sits on.

Fails if: no email is present. That does not mean the guard is broken, it means the Segment PASS
carried from BUSY-1159 TC12 proves less than AC6 asks for, since the incidental empty-email early
return would explain the same silence. In that case the case is not FAIL but the carried TC5 row
becomes inconclusive, which is a finding for JJ and needs a different order with a known email.

## Teardown

None if you used an existing order. If you did poll, restore the watermark to the value you recorded
before starting, with `--poller so`, and confirm the read back. Leave the schedule as you found it,
which at plan creation was DISABLED.

## Write results to

`results/02-consumer-stance-live-order.md`.

## Stop and ask JJ if

* TC5b finds no email, since that reopens a row the QA doc currently carries as PASS
* a consumer processed the reference with no guard, which is an AC5 failure and Kian will want it
  before he opens the PR
* the sweep script change makes an earlier BUSY-1159 result look wrong
