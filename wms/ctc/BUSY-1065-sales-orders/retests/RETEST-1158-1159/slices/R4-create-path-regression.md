# Slice R4, BUSY-1159 create-path regression

**Ticket:** BUSY-1159
**Cases:** TC1, TC1b, TC8, TC16, TC11, TC6, TC10, TC18, TC9, TC15
**Depends on:** R0 Gate B. Run this before R3, since R3 needs an order that is already sent.
**Estimated:** one session

## Scope, set by R0 rather than assumed

R0 Gate B measured that **both the poller and the sender changed** on 2026-09-03:
`staging-orders-cin7-so-poller` and `staging-shipping-manhattan-send-shipment`. The plan's condition
for the mapping cases is therefore met, so TC6, TC10 and TC18 are **in scope**, not carried.

Also changed: `staging-orders-v2-create-order`, `staging-orders-v2-create-transaction`, and
`staging-shipping-v2-shipment-reporting-stream`.

Unchanged, so nothing in this slice re-proves them: `staging-orders-v2-segment-eda-queue-handler` and
`staging-orders-v2-order-reporting-stream`. TC5, TC5b, TC6 and TC6b on **BUSY-1158** rest on those two
and can be carried rather than re-run. Say so in the result rather than leaving it implied.

## The schedule problem, read this before starting

TC1's trigger is "pull a live ECOM order **through the schedule**". The poller schedule is DISABLED
and a manual invoke invalidates TC1 and TC11.

So this slice has to enable the schedule, run, and disable it again. That is the only write it makes
to the environment and it must be reversed at teardown.

```bash
aws events describe-rule --name staging-orders-cin7-so-poller-rule --profile staging --region ap-southeast-2
aws events enable-rule  --name staging-orders-cin7-so-poller-rule --profile staging --region ap-southeast-2
# ... run ...
aws events disable-rule --name staging-orders-cin7-so-poller-rule --profile staging --region ap-southeast-2
```

It is `rate(2 minutes)`. Keep the window narrow and keep the watermark window narrow with it. Record
the exact enable and disable times in the result, because every other case's log window sits inside
them.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
./cin7-watermark.sh --stage staging --profile staging --poller so
./check-ctc-status.sh --stage staging --profile staging
```

Record the watermark. Expect `2026-08-28T01:35:45.769Z`. **Restore it at teardown.**

`check-ctc-status.sh` also gives the DLQ picture. R0 measured the stage-5 Manhattan-sender DLQ at 0
and the stage-2 orders DLQ holding 2 non-CTC Shopify messages. Expect the same, and note any drift.

## Setup

One ECOM order at an eligible stage, found with `find-cin7-sales-order.sh`. Record its reference,
`modifiedDate`, stage, line count and whether any line repeats an option code, since that decides
whether TC6 can ride this order or needs `WOR19261`.

## Cases

### TC1 and TC1b, order through the schedule, and latency

Trigger: schedule enabled, watermark set narrowly behind the order's `modifiedDate`, wait for a cycle.
`../../BUSY-1159/scripts/wait-for-so-cycle.sh` waits for cycle-complete without a manual invoke, which is
the whole point here. Then `capture-tc1-evidence.sh` for the cycle and the send outcome, and
`check-latency.sh` for the gap.

Expect: shipment reaches SCALE, `wmsSentAt` stamped, Cin7 `modifiedDate` to `wmsSentAt` inside the 3
minute target. The prior run measured 73 seconds.

Capture: cycle-complete event, send outcome, the latency figure, and the `ShipmentId` for R6.

Fails if: no `wmsSentAt`, or the gap exceeds 3 minutes. A slower but passing figure is not a fail,
record it, the sender changed and the number may have moved.

### TC8 and TC16, row counts and message grouping

Trigger: `inspect-ctc-order.sh` for the reference, then `list-transaction-rows.sh`. Read
`MessageGroupId` on live queue messages during the send.

Expect: one order row, one transaction row, one shipment header. `MessageGroupId` is the order key.

Capture: the counts, and the group values seen.

Fails if: more than one of any, which under a changed `create-transaction` would be a new duplication
path.

### TC11, bus isolation during a CTC send

Trigger: watch the shipping bus queue and DLQ depths across the send window.

Expect: no UNI reference reaches the CTC sender, depths unchanged.

Capture: depths before and after.

### TC6, TC10, TC18, the mapping cases

In scope because the poller and sender both changed.

* **TC6**, an order carrying the same option twice. Expect two per-unit rows on our side with the same
  sku and same `lineItemId`, one aggregated line in SCALE. `WOR19261` is the documented fixture.
* **TC10**, a Worship branded order. Expect `packingBrand` set, `packingBrandMisses` zero, and
  `UserDef3` carrying the brand. `WOR19261` again. The SCALE half is R6's read.
* **TC18**, ship-to name longer than 25 characters. Expect truncation logged, shipment accepted, full
  value kept on our side. `261106` is the documented fixture, 29 to 25. Use
  `../../BUSY-1159/scripts/address-field-lengths.sh`, which prints lengths and never values.

Capture: for each, our side now, and the SCALE-side expectation handed to R6.

Fails if: any mapping differs from the recorded prior result. The point of re-running these is that
the code under them changed.

### TC9 and TC15, the DLQ cases, and the problem with them

**R0 found the stage-5 Manhattan-sender DLQ empty.** The three references TC9 and TC15 were proved
against (`261070`, `261073`, `261089`) are gone. Someone drained it. The existing PASS evidence in
`../../BUSY-1159/results/07-failure-handling.md` predates the drain and cannot be re-verified against
current state.

So these two cases need a **fresh rejection**, manufactured deliberately:

* **TC9**, an order whose option code is absent from the SCALE item master. Two codes are confirmed
  absent: `TH25-318B-28` and `WPR25-104A-10`. An order carrying one of those is the fixture. Expect
  the send to throw, no `wmsSentAt`, and the message to park on the DLQ after the receive limit of 20.
* **TC15**, a cycle containing one hard error order alongside valid ones. Expect the valid orders
  still send and the watermark advances once. A reference longer than 25 characters is a hard error at
  the poller, and `261111-SplitShipment-HARBOUR-TOWN` exists as that fixture.

Finding or creating such an order in Cin7 is JJ's, not the session's. **Ask before assuming one
exists.** If no fresh rejection can be produced this session, record both cases as NOT RE-VERIFIED
with the drain as the reason, rather than carrying the old PASS forward silently.

Capture: the DLQ depth before and after, the receive count on the parked message, and the watermark
behaviour across the cycle.

## Teardown

* **Disable the poller schedule.** Confirm with `describe-rule` that `State: DISABLED`.
* **Restore the watermark** to `2026-08-28T01:35:45.769Z` and read it back.
* Leave the order in place. R3 needs it and R6 reads it.
* Record what is now parked on any DLQ, so the next session inherits a true picture rather than R0's.

## Write results to

`results/R4-create-path-regression.md`.

Update `SCRIPTS.md` if you extend any of the BUSY-1159 scripts, and `TOOL-NOTES.md` if the behaviour
of one changed under the new build.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* the schedule cannot be re-disabled at teardown
* the watermark cannot be restored to `2026-08-28T01:35:45.769Z`
* a mapping case differs from its prior result, since that is a regression in code that was passing
* no fresh DLQ rejection can be produced, so TC9 and TC15 stay unverified
* the poller picks up references beyond the intended window, which would mean the watermark window
  was wider than intended and other people's fixtures have moved
