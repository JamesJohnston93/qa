# Slice 09, echo guard and replay suppression

**Ticket:** BUSY-1159
**Cases:** TC21, TC21b
**Depends on:** slices 02 and 03
**Estimated:** one short session

TC13 proved `lastEmittedPayloadHash` is never written on create. The echo guard compares a freshly
mapped hash against that field, so with the field absent the comparison can never be equal and the
poller should emit on every re-poll of an unchanged order. TC3 saw no duplicate record and no second
send anyway, so something else suppressed it. This slice names that something.

Until it does, TC3 is a pass whose mechanism is unknown, and the QA doc cannot honestly tell a UAT
reader that replay protection works.

## Preconditions

* Poller schedule rule **disabled** for the whole slice. The manual invoke is the control surface
  here and the invoke script refuses to run while the rule is enabled.
* An order created and sent within the last hour or two. Pick a fresh one rather than reusing
  `261115` from slice 02: the watermark has moved on, and resetting back to yesterday would pull a
  full day of real traffic through a poller whose ceiling is still unmeasured (TC17).
* The order's last send more than 5 minutes old, so the orders to shipping queue's content dedupe
  window cannot be what holds the replay back.
* Current watermark recorded as the restore point.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=staging
aws events disable-rule --name staging-orders-cin7-so-poller-rule --profile "$AWS_PROFILE" --region ap-southeast-2
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so   # restore point
./inspect-ctc-order.sh --stage staging --profile "$AWS_PROFILE" --reference <ref>   # rows before
```

## Cases

### TC21, replay outside the dedupe window
Trigger: set the watermark to one second before the chosen order's Cin7 `modifiedDate`, confirm the
set, then invoke the poller once by hand.
Expect: no second shipment header, no second send, `wmsSentAt` unchanged. The same outcome TC3 saw,
now with the 5 minute content dedupe window ruled out as the cause.
Capture: row counts in both tables before and after, the sender outcome lines for the window, and
`wmsSentAt` either side.
Fails if: a second shipment or a second send appears. That is a real duplicate, and it means only the
dedupe window was holding it back in TC3. Raise it against AC6 immediately, do not continue to TC21b.

### TC21b, which guard actually fired
Trigger: on the same invoke, read the poller's cycle complete line, the transaction rows for the
order, and the order row itself.
Expect: one of three, and naming which is the whole point of the case.

* An extra transaction row carrying the same `idempotencyId`. The poller emitted and the transaction
  writer deduped it. Replay protection is idempotency, not the echo guard.
* No new transaction row and a skip counter moved. Something in the poller skipped it, and the counter
  says what.
* No new transaction row and no counter moved. It never reached the emit step.

Also record whether an echo skip counter exists in the poller output at all. The LLD names one in its
metric list. The counters seen in cycle complete lines so far are `ordersFetched`, `created`,
`skippedCounted`, `skippedStages`, `watermarkAdvanced` and `packingBrandMisses`. If no echo counter
exists, then the LLD's own tell for a mis-scoped hash, zero echo skips while confirmations flow,
cannot be read by anyone. That is a finding for BUSY-1162 and for the confirmation epic, not a defect
on this ticket.
Capture: the cycle complete line, structured fields only. The transaction rows with their idempotency
ids. Whether `lastEmittedPayloadHash` is still absent.
Fails if: nothing. The output is an answer, not a verdict.
Watch: if `lastEmittedPayloadHash` turns out to be present on this order, TC13's finding is narrower
than recorded. Say so and stop, because the whole slice changes shape.

## Teardown

Restore the watermark to the recorded restore point, read it back, and confirm. Leave the schedule
disabled unless slice 08 runs straight after.

```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so --set <restore-point> --confirm
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read
`SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an
overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result
file, with its review state.

## Write results to

`results/09-echo-guard-and-replay.md`
