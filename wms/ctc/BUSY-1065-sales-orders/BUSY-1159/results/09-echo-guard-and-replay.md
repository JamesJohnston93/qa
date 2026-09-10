# Result: Slice 09, echo guard and replay suppression

**Ticket:** BUSY-1159
**Verdict:** TC21 PASS. TC21b answered. Deviation from the slice's assumed blast radius during setup, described below, no defect and no data loss.

## Order used

`261119` (MEASURED). Chosen fresh rather than reusing `261115`: created and sent in the cycle at
`2026-08-28T00:30:51.918Z`, `modifiedDate` `2026-08-28T00:30:03Z`, `wmsSentAt`
`2026-08-28T00:31:21.129Z`, sent about an hour before this slice ran, well past the 5 minute content
dedupe window. Single TRANSACTION row before the invoke:
`TRANSACTION#1787877056557`, `idempotencyId CREATE_ORDER#CTC#261119#2026-08-28T00:30:03Z#e24af605`
(MEASURED).

## Deviation during setup: wider blast radius than the slice assumed

The schedule had been disabled since the slice 07 pause, about an hour. Setting the watermark to one
second before `261119`'s `modifiedDate` and invoking the poller once did not narrowly replay that one
order: the invoke's window runs from the watermark to "now", so it also swept the full backlog that
had built up while the schedule was off.

MEASURED, one invoke: `ordersFetched:8, created:5`, 5 new orders genuinely created and sent
(`261123`, `261122`, `261124`, `261125`, `261120`), watermark auto-advanced to
`2026-08-28T01:35:45.769Z`.

This is CLAUDE.md's "blast radius wider than the slice assumed" stop condition, so I paused and asked
JJ before finishing teardown, rather than deciding alone. No harm: these are real orders that would
have been processed once the schedule was re-enabled regardless, nothing duplicated, Stage 5 DLQ
depth unchanged at 3. JJ's call: leave the watermark at its natural post-invoke value
(`2026-08-28T01:35:45.769Z`) rather than rewind to the slice's recorded restore point
(`2026-08-28T00:36:50.476Z`), since rewinding would only cause a second cycle to re-fetch and
re-push the same 5 orders for no new information, at further Cin7 API cost. Teardown intentionally
departs from the slice's literal text on this point.

**Consequence for future sessions:** if the schedule is disabled for an extended period, a manual
invoke to test a narrow replay window will also catch up the entire backlog. Pick a moment shortly
after the schedule was last active, or accept the catch-up as here, rather than assuming a one-order
blast radius.

## TC21, replay outside the dedupe window

Trigger: watermark set to `2026-08-28T00:30:02.000Z` (one second before `261119`'s `modifiedDate`),
confirmed, then one manual invoke.

MEASURED, before and after, `261119` only:

* Shipments: `wmsSentAt` unchanged at `2026-08-28T00:31:21.129Z`, same single header, same 2 shipment
  items, no second header.
* Orders table: still exactly 1 `TRANSACTION` row, `TRANSACTION#1787877056557`, same idempotencyId.
  No new row.
* Poller log for this invoke: `261119` was among the 8 orders fetched (its `modifiedDate` falls in
  the `modifiedSince 2026-08-28T00:25:02.000Z` to `modifiedBefore 2026-08-28T01:35:45.769Z` window)
  but does not appear in any of the 5 `CREATE_TRANSACTION` events pushed to EventBridge this cycle.

PASS. No second shipment, no second send, `wmsSentAt` unchanged. Same outcome TC3 saw, now with the
5 minute content dedupe window ruled out as the cause, since this order was last sent about an hour
earlier.

## TC21b, which guard actually fired

MEASURED: the third of the three named options. No new `TRANSACTION` row for `261119`, and no skip
counter moved for it either: this cycle's summary is
`{"ordersFetched":8,"created":5,"skippedCounted":0,"skippedStages":{},"skippedZeroQty":0,"skippedZeroUnitOrders":0,"oversized":0,"packingBrandMisses":0,"watermarkAdvanced":true,"newWatermark":"2026-08-28T01:35:45.769Z","pageCapHit":false,"pendingCreates":0,"requestsThisCycle":2}`.
8 fetched, 5 created, all named skip buckets at 0. `261119` (and presumably `261118` and
`257048A-`style, also inside the window and also already created, not directly confirmed for those
two) is fetched, not created, not counted in any skip bucket. It never reached the emit step at all,
the third of the three options the slice named.

No echo skip counter exists anywhere in the cycle-complete output. Full counter list observed across
this and prior slices: `ordersFetched, created, skippedCounted, skippedStages, skippedZeroQty,
skippedZeroUnitOrders, oversized, packingBrandMisses, watermarkAdvanced, newWatermark, pageCapHit,
pendingCreates, requestsThisCycle`. No field named for an echo or hash-comparison skip. CONFIRMS the
slice's premise: the LLD's own tell for a mis-scoped hash, zero echo skips while confirmations flow,
cannot be read by anyone from this output. This is a finding for BUSY-1162 and the confirmation epic,
not a defect on this ticket, per the slice's own framing.

`lastEmittedPayloadHash`: confirmed still absent on every row for `261119`'s origin (ORDER, both
ITEM rows, ADDRESS, the TRANSACTION row), checked directly against the DynamoDB attributes, not
inferred. TC13's finding stands, narrower reading not triggered.

## Fails if / Watch conditions

Neither triggered. No second shipment or send appeared (would have failed TC21 against AC6).
`lastEmittedPayloadHash` did not turn up present (would have narrowed TC13 and reshaped the slice).

## Scripts written

`scripts/list-transaction-rows.sh`, not reviewed yet. Lists TRANSACTION row SKs and idempotencyId
for one order's origin, redaction-safe (never prints customerEmail, addressChanges or orderInfo also
stored on that row type). Needed because `inspect-ctc-order.sh` only reports a TRANSACTION row count,
not enough to confirm a specific idempotencyId did or did not recur. Extends the same
`origin_index` query pattern `inspect-ctc-order.sh` already uses rather than a new one.

## Teardown

Watermark left at `2026-08-28T01:35:45.769Z`, read back and confirmed, per the deviation above.
Schedule left DISABLED, no further slice running immediately after this one.
