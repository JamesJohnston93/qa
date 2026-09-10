# Result: Slice 05, cancellation and isolation

**Ticket:** BUSY-1160
**Verdict:** TC15 PASS (both halves, MEASURED). TC16 PASS on its own defined comparison (Dispatched
emits nothing, an explicit cancel emits a cancel). TC18 FAIL -- the cancel handler throws an
uncaught error instead of handling a DELETE for a shipment SCALE was never sent as benign, and
tripped a real alert. TC20 PASS on the one field the harness can construct (`sourceStage`), ceiling
named for the fields it cannot. TC21 PASS, control unaffected. Q30's picked-stage arm produced a
clean negative at the layer it tested (no DELETE), but **does not retire the risk Q30 actually
names** -- see below, flagged to the open-questions register rather than closed. Poller schedule
stayed DISABLED and the SO watermark stayed UNSET throughout; nothing in this slice touched either.
Four synthetic orders created and registered (`QASYN-08-TC18` through `QASYN-10-TC16`, plus TC16's
own second arm reusing `QASYN-09-TC15`).

**One tool extension before any case ran:** `emit-synthetic-revision.sh` gained `--source-stage
<value>`, needed for TC16 and the Q30 arm. See `TOOL-NOTES.md` and `SCRIPTS.md`.

**One live incident, resolved mid-session with JJ's explicit call:** TC18 tripped a real CloudWatch
alarm feeding an SNS topic. Purged the stuck message rather than letting it retry for hours. Detail
below.

## TC18 -- FAIL

**Case:** DELETE for a `ShipmentId` SCALE does not hold, using a `QASYN-` reference never sent.
**Expected:** Logged as benign, no alert, no DLQ message.

Construction: seeded from a real order for payload shape only, emitted `CANCEL_ORDER` under
`QASYN-08-TC18`, a reference with **no prior `ORDER` row** in `staging-orders-v2` -- the strongest
form of "never sent", since no order, no shipment, and no SCALE record ever existed for it.

**MEASURED:** the event routed correctly and reached `staging-orders-cin7-cancel-order`, which logged
its own named attribution line on receipt (`SalesOrderCancelReceived`), then **threw an uncaught
error**: `"No sales order 01ae5a8e-20f0-4d6a-921b-79273e725dfd to cancel — header is missing."` This
is not a caught, logged-and-continued condition -- it is a Lambda invocation failure. The message was
retried by SQS (`maxReceiveCount: 20`, `VisibilityTimeout: 1500s` -- roughly 8 hours to exhaust) and,
within 90 seconds of the first attempt, **tripped `staging-orders-cin7-cancel-order-errors` from OK to
ALARM** (confirmed via `describe-alarm-history`: this function had never been invoked before today, so
attribution is unambiguous). Both this alarm and its paired `-dlq-depth` alarm feed a real SNS topic,
`staging-orders-cin7-alerts` -- not a silent metric, an actual alert channel.

**This directly contradicts TC18's expected result.** "Logged as benign" would mean the handler
recognises a cancel for an order it has no record of and no-ops cleanly. What it actually does is
throw, retry, and alert.

**Live incident, resolved mid-session.** Left alone, the stuck message would have kept re-triggering
the errors alarm on every ~25-minute retry for hours before finally landing in the DLQ and tripping
the second alarm too. Flagged to JJ mid-slice (not one of the slice's four listed stop conditions
verbatim, but the same class of thing -- an unintended state on shared alerting infrastructure). **JJ's
call: purge the stuck message.** Purged from `staging-orders-cin7-cancel-order-queue.fifo` (confirmed
empty afterward); both alarms had returned to OK by the time the slice continued. This queue holds
nothing but CTC cancel-order traffic (not shared with UNI), so the purge could not have discarded
anyone else's message.

**Recommend raising with dev**, since this is the cancel handler's own defensive gap, not a synthetic-
data artefact: a `CANCEL_ORDER` transaction is exactly the shape a real poller emits, we simply
targeted an origin our own test never created. A real-world equivalent (a redriven or duplicate cancel
arriving after the order row was already removed some other way, or any timing gap between create and
cancel) is not far-fetched.

## TC15 -- PASS, both halves

**Case:** A seeded order made ineligible by cancellation. **Expected:** order flipped, not physically
deleted, on the orders side; header DELETE reaches SCALE on the same `ShipmentId`.

`QASYN-09-TC15` seed-created from real order `262208` (event `CREATE_ORDER`, `lastModified
2026-09-08T06:20:00Z`). Landed cleanly: 4 rows in `staging-orders-v2`, trickled to a shipment header
and item in `staging-shipments`, reached SCALE (`wmsSentAt 2026-09-08T06:47:14.745Z`). **MEASURED**
directly from `staging-shipping-manhattan-send-shipment`'s own log line that the SCALE-facing
`shipmentId` is the literal reference string `QASYN-09-TC15`, not the internal shipment UUID -- this
is what the 25-character `ShipmentId` ceiling in the marking rule is actually protecting.

Second emit: `CANCEL_ORDER`, mutation `cancel`, self-revise, `lastModified 2026-09-08T06:55:00Z`.

**Orders-side half, MEASURED:** `SalesOrderCancelReceived` -> `SalesOrderCancelled`
(`linesCancelled:1`) -> pushed `CANCEL_ITEM`. All 5 rows in `staging-orders-v2` retained (nothing
deleted); `ORDER` and `ITEM#...` both flipped `status: CANCELLED`; `lastModified` advanced to the
cancel's own timestamp. **Not physically deleted, exactly as CLAUDE.md describes.**

**SCALE-side half, MEASURED, full chain traced:** `CANCEL_ITEM` -> shipping-side
`order-item-cancelled` (`SHIPMENT_ITEM_REMOVED`) -> `shipment-item-removed`, which found the shipment
now had zero items (own named metric `CtcShipmentEmptied`) and pushed `SHIPMENT_REJECTED` with
`rejectionReason: CANCELLED` -> Manhattan populator/handler queued `detailType: SEND_SHIPMENT_DELETE`
-> `send-shipment` sent it and Manhattan accepted (`ManhattanRequestOutcome outcome:success
reference:QASYN-09-TC15`, `acceptedTransactions:1 rejectedTransactions:0`).

**Finding, not a defect:** the header-level SCALE cancel is triggered by the shipment becoming
*empty of items*, the same code path a full removal would take, not a distinct order-cancel-to-SCALE
mechanism. Worth knowing for anyone reasoning about this code later.

**One process note, same class as slice 04's TC7 finding:** `describe-log-streams` against
`staging-shipping-manhattan-send-shipment` returned a stale stream list that omitted the new
invocation entirely, even a minute after it ran (confirmed via the `Invocations` CloudWatch metric,
which did show the call). Resolved by `filter-log-events` directly against the log group instead of
trusting the stream listing. **This is now the second time this exact gap has produced a false "no
send" read on this function** -- worth remembering as a standing trap, not a one-off.

**Residual gap, same as TC7:** actual XML content and live SCALE UI state (Order Planning > Planned
Shipment Insights) are outside CLI reach. Flagged, not assumed.

## TC16 -- PASS on its own defined comparison

**Case:** two orders, one reaching `Dispatched`, one losing eligibility another way. **Expected:**
`Dispatched` emits nothing; the other emits a cancel.

**Arm 1, Dispatched.** `QASYN-10-TC16` seed-created (real order `262208`, `lastModified
2026-09-08T07:00:00Z`), reached SCALE (`wmsSentAt 2026-09-08T06:53:13.522Z`). Self-revise, `UPDATE_ORDER`,
`--source-stage Dispatched`, fresh `lastModified 2026-09-08T07:05:00Z`. **MEASURED:** applied
(`SalesOrderUpdated`, `added:0 removed:0 addressChanged:false` -- content-neutral, same shape TC12
established), `sourceStage` confirmed written on the `ORDER` row, order `status` stayed `OPEN`.
**No outward event, `wmsSentAt` unchanged. Arm 1 PASSES: Dispatched emits nothing.**

**Arm 2, losing eligibility another way.** Served by TC15's own result (`QASYN-09-TC15`), not a
separate emit -- an explicit `CANCEL_ORDER` is the only mechanism, of the two available to downstream
injection, that produces a cancel at all (see the Q30 discussion below for why stage content alone
never does, at this layer). Cross-referencing rather than duplicating: TC15 already fully traced this
mechanism end to end. **Arm 2 PASSES: an explicit cancel emits a cancel.**

**The comparison holds:** stage content is inert to the reconciliation handler; only the event type
(`UPDATE_ORDER` vs `CANCEL_ORDER`) determines the outcome. That is itself the answer to what TC16
asks, cleanly measured on both sides, not inferred from one absence.

## Q30's picked-stage arm -- clean negative on the layer tested, does not settle the actual risk

Per the slice and `BUSY-1065-OPEN-QUESTIONS.md` Q30: does an order reaching a picked stage get read
as a loss of eligibility and DELETE a live SCALE shipment. Folded into TC16 as instructed.

Same order (`QASYN-10-TC16`, self-revise again), `UPDATE_ORDER`, `--source-stage "Fully Picked"`,
`lastModified 2026-09-08T07:10:00Z`. **MEASURED:** applied (`SalesOrderUpdated`, `added:0 removed:0
addressChanged:false`), `sourceStage` written as `Fully Picked` on the `ORDER` row, order `status`
stayed `OPEN`. **No outward event, `wmsSentAt` unchanged (still the create's own timestamp). The
stop condition -- a picked-stage revision producing a header DELETE -- was not hit.**

**Read this result narrowly, and this is the most important paragraph in this file.** This is not
the same question Q30 actually asks. Synthetic injection happens downstream of the poller: this
session chose to construct an `UPDATE_ORDER` transaction carrying `sourceStage: "Fully Picked"`
itself. What it measured is that **the reconciliation handler has no stage-based logic at all** --
`sourceStage` is stored as inert metadata regardless of value, and whatever the poller decides to
send is what happens, with zero independent safety check on the handler side. It did not, and by
construction cannot, measure what the real poller actually sends when a tracked order reaches `Fully
Picked` in Cin7, because that decision is made entirely upstream, before injection starts.

**Combined with Q31 (already CONFIRMED, BUSY-1159 slice 11) and this slice's own TC15, the risk gets
sharper, not smaller:**
* Q31 measured that the deployed poller currently drops `Fully Picked` orders out of its eligible
  query result set -- the opposite of dev's stated intent.
* If the poller's own disappearance-detection logic (unmeasured -- no source read, no live poller
  cycle against a real picked-stage order under this ticket's slices) reads "previously-tracked order
  now missing from my query" as loss of eligibility, it would emit `CANCEL_ORDER`, not `UPDATE_ORDER`.
* TC15, this same session, independently confirmed a `CANCEL_ORDER` executes unconditionally: flip
  plus a header DELETE to SCALE, with no stage check of any kind.

Today's arm proves the reconciliation layer would not stop that DELETE if the poller sent it. It does
not prove whether the poller would actually send it. **`BUSY-1065-OPEN-QUESTIONS.md` Q30 updated with
this finding and left open, not closed** -- recommended to go to Kian alongside Q31 before BUSY-1160
ships, per Q30's own standing recommendation. Full detail there rather than duplicated here.

## TC20 -- PASS, on the field the harness can construct

**Case:** record modified only in fields the confirmation leg writes (stage, shipped quantities,
tracking, dispatch dates). **Expected:** no second send.

Not run as a separate emit. **Served by the same two `--source-stage` revisions above** (arm 1 and
the Q30 arm on `QASYN-10-TC16`): both are exactly "modified only in a confirmation-leg-owned field,
fresh hash, fresh `modifiedDate`, no item/address change" -- and both applied, both produced no second
send (`wmsSentAt` unchanged both times), both carried unambiguous attribution
(`SalesOrderUpdated`, content-neutral). This corroborates TC12's original slice 03 finding for a
different field (`lastModified`-only bumps) with the field TC20 actually names first (`stage`).

**Ceiling, stated plainly:** only `sourceStage` was tested. The harness has no field for "shipped
quantities" or "tracking" at all -- they are not part of the poller's own measured payload shape
(`orderInfo` carries `sourceStage`/`sourceStatus`/`scheduledShipDate`/etc., nothing resembling a
tracking number or per-line shipped quantity), consistent with the standing note that the real
confirmation leg does not exist yet (D17, `../DEFERRED-TEST-CASES.md`). If the confirmation leg
eventually adds fields the harness cannot currently represent, this case will need extending, not
re-running as-is.

## TC21 -- PASS, control

**Case:** a Universal Store order in the same window as any of the above. **Expected:** untouched by
the update and cancel paths.

A small `ProjectionExpression`-limited scan of `staging-orders-v2` (extract-only, no full record) found
16 non-CTC orders (`US#SHOPIFY_ECOM#...`, `US#NEWSTORE#...`, `PS#NEWSTORE_B2B#...`) in a 200-item
sample. Picked one (`bfd227df-a722-4dd8-938a-defeeead1683`, `US#SHOPIFY_ECOM`, `FULFILLED`):
`updatedAt` epoch `1782555415`, months before this session. **MEASURED: untouched.** All of this
slice's emits carried a CTC-scoped `origin` and their own `message_group_id`, and the reconciliation
handlers query specifically by CTC origin -- isolation held, as expected, and as every prior slice's
own queue-depth checks corroborated for shared infrastructure.

## Teardown

Per the slice, teardown is JJ's call, not a default. Left in place:
* `QASYN-08-TC18` -- nothing to remove, no order or shipment was ever created for it.
* `QASYN-09-TC15` -- `CANCELLED` on the orders side, SCALE-side DELETE accepted. Live state already
  matches "cancelled", nothing further needed unless JJ wants the row itself removed.
* `QASYN-10-TC16` -- still `OPEN`, `sourceStage: "Fully Picked"`, live in `staging-shipments` with
  `wmsSentAt` set. Not cancelled by this slice (neither arm was a cancel). Flagged for JJ: this
  synthetic shipment remains live in SCALE staging exactly like every other create this plan has
  produced.

**Removed by necessity, not by teardown choice:** TC18's stuck message, purged from
`staging-orders-cin7-cancel-order-queue.fifo` per JJ's mid-session call, to stop the errors alarm
re-firing every ~25 minutes. Recorded in `SYNTHETIC-REGISTER.md`'s side-effects table.

## Attribution instruments found this slice

`staging-orders-cin7-cancel-order` publishes its own named metric on receipt,
`SalesOrderCancelReceived` (`orderId`, `lastModified`), and on success, `SalesOrderCancelled`
(`orderId`, `linesCancelled`) -- the same pattern slice 03 found on the update-order handler
(`SalesOrderStaleRevision` / `SalesOrderUpdated`). On the failure path (TC18) it does not publish a
named metric at all; it throws, and the only signal is the CloudWatch `Errors` alarm plus the raw
stack trace in the log. Worth carrying forward: **a future slice reading this handler for attribution
should not expect a named failure metric the way the success paths have one.**

## Standing constraints, confirmed

Poller schedule DISABLED and SO watermark UNSET, checked before and after via `check-ctc-status.sh`
(unchanged from slice 04). No Cin7 call made. No production credential touched or needed.

## Stop and ask JJ

**One live incident during the slice, already resolved with JJ's explicit call mid-session:** TC18
tripped `staging-orders-cin7-cancel-order-errors` (a real SNS-backed alarm). Purged the stuck
message; both alarms confirmed back to OK before the slice continued. Not one of the four listed stop
conditions verbatim, but flagged and acted on rather than pushed to the end of the session, since it
was an active, re-firing alert on shared infrastructure.

None of the four listed stop conditions were hit: TC16 did not produce a cancel on the `Dispatched`
arm; no DELETE reached a shipment that is not a `QASYN-` record; TC15 flipped the order and the
DELETE reached SCALE (neither half missing); every negative result above is attributed
(content-neutral `SalesOrderUpdated` lines with explicit `added`/`removed`/`addressChanged` counts,
not bare silence).

**Worth a deliberate flag even though it is not a literal stop condition:** Q30's picked-stage arm
produced a safe result but does not clear the risk the question names. See the dedicated section
above and the updated `BUSY-1065-OPEN-QUESTIONS.md` Q30. Recommend this reaches Kian alongside Q31
before BUSY-1160 is signed off, not treated as closed by today's negative.

## Scripts written

* `scripts/emit-synthetic-revision.sh` extended with `--source-stage <value>`, **unreviewed** (review
  deferred by design, per `SCRIPTS.md`). Verified with a dry run before first real use; every `--emit`
  this slice that used it produced the expected override on inspection of the constructed payload and
  the persisted `ORDER` row afterward.
* No new script files this slice; the TC21 control query and the DLQ/alarm snapshots were short,
  one-off `aws` invocations run directly, consistent with CLAUDE.md's three-line/no-logic threshold
  for what needs saving.

## Data handling

Every DynamoDB read this slice used a `ProjectionExpression` (or the existing `origin_index` query
pattern already established by prior slices) restricted to the fields being checked --
`sourceStage`/`status`/`lastModified`/`wmsSentAt`/`origin` -- never a full record. CloudWatch log
excerpts shown above were checked for PII field-name presence before display; the synthetic orders'
own placeholder customer fields (`qasyn-synthetic@example.invalid`, `1 Synthetic Street`) needed no
redaction since they are fake by construction, and no real customer field appeared in anything quoted
in this file.
