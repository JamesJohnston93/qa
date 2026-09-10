# Result: Slice R1, targeted re-test against the 2026-09-09 build

**All four parts now complete, across two sessions.** Parts 1, 2 and 4 ran first. Part 3 stopped on
its first attempt, correctly, at a queue anomaly; JJ then amended the gate, and a second session
characterised the anomaly (fully explained, not new) and ran Part 3's two emits.

Scope set by `results/R0-build-identification.md`, not re-derived. JJ gave explicit go-ahead to
proceed past R0's two flagged items (the explained, pre-existing `so-poller-stalled` alarm, and the
Manhattan sender anomaly, the second re-checked live at the start of Part 3 per the slice's own
instruction at the time) before the first session's emits ran, and separately amended Part 3's own
gate before the second session's emits ran.

## Part 1, source re-reads against the new build. Read only

All four reads run via `inspect-lambda-code.sh` against the artifacts redeployed 2026-09-09. All four
close as R0 expected -- unchanged from the pre-redeploy build, for everything each case touches.

**1a. `staging-orders-cin7-so-poller` (`LastModified 2026-09-09T01:20:09Z`, new `CodeSha256`).**
MEASURED:
```
var ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"];
var TERMINAL_STAGE = "Dispatched";
```
Byte-identical to the pre-redeploy list slice 07 read. **Q30 and Q31 stay closed against the current
build, not just the 2026-09-03 one.** No stop condition hit.

**1b. `staging-shipping-manhattan-send-shipment` (`LastModified 2026-09-09T01:38:35Z`, new
`CodeSha256`).** MEASURED: `rejectedTransactions !== 0` (or `acceptedTransactions === 0`, or a schema
validation failure) throws `ManhattanRejectionError`; `classifySendOutcome` maps it to `"rejected"`;
`handleSendFailure` treats `AUTH_ERROR`/`REJECTED`/`CLIENT_ERROR` as `"Permanent failure ... to
Manhattan SCALE"` and calls `publishAlert("ManhattanSendPermanentFailure", ...)`. Identical logic to
what TC17's classification half found before the redeploy. TC17 stays blocked on the wave, unchanged
by this read.

**1c. `staging-orders-cin7-so-poller`, `deriveOrderMoneyContext`.** MEASURED: `taxStatus === "Exempt"`
is still explicitly mapped (`headerTaxRate: 0`), and anything other than `Incl`/`Excl`/`Exempt` still
throws `` `Unrecognised Cin7 taxStatus "${order.taxStatus}" ... refusing to guess a tax treatment.` ``
-- i.e. `Undefined` is still unhandled. **TC22 unchanged against the new build**: 3 of 4 values mapped,
`Undefined` still the one residual item for Kian.

**1d. `staging-orders-cin7-cancel-order` (`LastModified 2026-09-09T01:20:09Z`, new `CodeSha256`).**
MEASURED, the exact branch TC18 Form A concerns:
```
const { header, items } = await readOrder(transaction.PK);
if (!header) {
  throw new Error(`No sales order ${transaction.PK} to cancel — header is missing.`);
}
```
This throw fires before any named metric is logged for this branch (only `SalesOrderCancelReceived`
precedes it, unconditionally, for every cancel). **TC18 Form A's FAIL still reproduces on the current
build, unfixed.** One thing worth carrying to whoever picks this up: this read also turned up a metric
not previously documented in this plan, `SalesOrderCancelWithheld` (`alert: true`), logged when a
cancel arrives for an order already past `FULFILMENT_STARTED` -- a different guard from TC18's, not
investigated further here, flagging its existence only.

**No stop condition hit in Part 1.** `ELIGIBLE_STAGES` still has both picked stages, TC18's behaviour
did not change.

## Part 2, the outbound re-run. Emits

Two synthetic `CREATE_OUTBOUND_ORDER` emits, both seeded from real ECOM order `262208` for shape only,
registered before emit in `../../BUSY-1160/SYNTHETIC-REGISTER.md` (seq 14, 15, continuing from seq 13 as
instructed).

**QASYN-14-TC2WH, re-running seq 12's WHOLESALE payload with the one variable Q41's fix changes.**
`emit-synthetic-outbound-order.sh`'s own `WAREHOUSE_BY_ORDER_TYPE` default for WHOLESALE is still
`CTC-WH` -- a value the real poller can no longer produce post-redeploy per R0 Gate C1 (no branch-keyed
lookup left at all). Overridden with `--warehouse CTC-QDC` to match current reality rather than the
harness's stale default; everything else (delivery company `"Cheap Thrills Wholesale Pty Ltd"`,
multi-size, two rows sharing one lineId) held identical to seq 12. **This is Q41's runtime
confirmation, distinct from R0's source read.**

MEASURED: `PutEvents` `FailedEntryCount:0`. Landed and reconciled through the full chain
(`create-outbound-order` metric `OutboundOrderCreated lines:2` -> `outbound-order-bridge` ->
`OUTBOUND_SHIPMENT_SAVE` -> shipping-side `create-transaction` -> `OUTBOUND_SHIPMENT_READY` ->
`staging-shipping-manhattan-send-outbound-shipment`). `staging-orders-v2` ORDER row:
`warehouse:CTC-QDC orderType:WHOLESALE status:OPEN`; two ITEM rows, `ITEM#3494647#M` (qty 2),
`ITEM#3494647#L` (qty 1) -- **TC3 reconfirmed**. `staging-shipments` SHIPMENT row `status:SENT_OUTBOUND`
-- **TC2 reconfirmed, same tables, same dedicated chain, as before**. Sender log (requestId
`eb185ae0`): `WARN Truncating Customer.ShipTo to 25 characters: "Cheap Thrills Wholesale Pty Ltd"`,
then `OUTBOUND_SHIPMENT_SENT`, `sentAt:2026-09-09T04:17:37.593Z`,
`sentLineIds:["3494647#L","3494647#M"]`. **No `ManhattanRejectionError` this time**, in direct contrast
to seq 12's `Invalid warehouse "CTC-WH"`. The only variable that changed between the two emits is the
warehouse code, and that alone flips the outcome from rejected to accepted. **Q41's fix confirmed at
runtime, not just by source read.**

**QASYN-15-TC1B, a fresh emit re-confirming TC1b's truncation independent of the warehouse variable.**
RTV, harness default warehouse (`CTC-QDC`, unaffected by Q41 either way), delivery company `"Cheap
Thrills Wholesale Returns Dept"`, 37 characters, no person name.

MEASURED: same chain, landed cleanly. ORDER row `warehouse:CTC-QDC orderType:RTV status:OPEN`, one ITEM
row (`ITEM#3494647#M` qty 3). Sender log (requestId `75e3e253`): `WARN Truncating Customer.ShipTo to 25
characters: "Cheap Thrills Wholesale Returns Dept"`, then `OUTBOUND_SHIPMENT_SENT`,
`sentAt:2026-09-09T04:17:44.297Z`, `sentLineIds:["3494647#M"]`. **TC1b reconfirmed against the
redeployed dedicated outbound sender**, byte-for-byte the same behaviour as seq 13 against the old
build.

**Neither emit behaved differently from its recorded predecessor except the one deliberate variable
(warehouse).** No stop condition hit.

## Part 3, native reconciliation. Gate amended, characterised, then emitted

**This is a second session against Part 3.** The first attempt stopped at the gate correctly, per the
instruction in force at the time. JJ then saw the anomaly and amended the gate: characterise the
message first, using four specific read-only checks, then proceed under one of three named outcomes
rather than stopping outright. Ran all four before touching anything.

**1. Event source mapping on the queue.** MEASURED, `lambda:list-event-source-mappings` filtered by
the queue's own ARN (the earlier attempt had queried by function name, `send-shipment`, which returned
nothing -- the correct query is by `--event-source-arn`): **one mapping, `State: Enabled`**,
`FunctionArn` pointing to `staging-shipping-manhattan-manhattan-eda-queue-handler`, **not**
`send-shipment`. This is the first correction: the queue's actual consumer had never been checked by
function name before now, and it is a different function from the one every prior session (including
R0) read logs against.

**2. `ApproximateAgeOfOldestMessage`.** MEASURED via `cloudwatch:get-metric-statistics`, last 2 hours,
5-minute period: **climbing continuously and linearly**, 4042s at 02:54Z up to 10944s at 04:49Z --
not a flat, stale metric. Extrapolating the slope back, the message entered the queue around
`01:47Z`, close to the deploy window, not 12-15 hours ago as the earlier log-group read implied.

**3. `NumberOfMessagesReceived`/`NumberOfMessagesDeleted`, 24 hours.** MEASURED: both **non-zero and
active** in the hours since the redeploy (2, 3, 5 received; 1, 2 deleted in the three hourly buckets
after 01:54Z), confirming the queue is being polled and is processing other traffic normally (this
session's own Part 2 emits are in that count). Rules out "nothing is consuming the queue."

**4. Redrive policy.** MEASURED: `deadLetterTargetArn` -> `staging-shipping-manhattan-sender-dlq.fifo`,
`maxReceiveCount: 20`, `VisibilityTimeout: 1500`s, on record.

**Reads as: a real message is genuinely stuck, with the mapping enabled -- but it is fully
identified, and it is not new.** Read `staging-shipping-manhattan-manhattan-eda-queue-handler`'s own
log group directly (not `send-shipment`): the same message (`messageId
2a782c44-4849-4509-a598-e464ad8fd34f`) has been received and has failed on a ~25-minute cycle since
before this session started (8 receives in the last 6 hours alone, each ~6 seconds of processing
followed by ~1494 seconds invisible, which is why every spot-check across two sessions caught it
in-flight). **The message is `QASYN-12-TC2`** -- BUSY-1160 slice 08's own already-registered poison
message, a WHOLESALE order rejected on `Invalid warehouse "CTC-WH"` before Q41's fix landed, retrying
toward its own DLQ exactly as `SYNTHETIC-REGISTER.md` predicted at the time. Confirmed directly in
`staging-shipping-manhattan-send-outbound-shipment`'s own log (the correct function for an outbound
order): `` `Manhattan rejected outbound shipment QASYN-12-TC2: ... Invalid warehouse "CTC-WH"` ``,
repeating on the same schedule. DLQ depth still 7, unchanged, consistent with the message not yet
having exhausted its 20 retries.

**This is not the redeploy's doing and not a native-path issue at all.** `send-shipment` (the actual
native sender) legitimately showed no activity because no native message needed it in that window --
checking it for an *outbound* order's retries was the wrong log group from the start, on both this
session's first attempt and R0's original read. Corrected in
`../../BUSY-1160/SYNTHETIC-REGISTER.md`'s side-effects table so a future session does not re-flag the
same message as a new mystery.

**Proceeded per the gate's third outcome** ("a real message is genuinely stuck with the mapping
enabled -- proceed anyway"), and additionally because the stuck message sits in its own FIFO message
group (keyed on its own `orderId`), which cannot block a fresh emit's different message group.

### Two emits, on a fresh order (`QASYN-16-TC12B`, seed `262208` shape only, `orderId
c62c09dd-231a-4f59-b33d-d1cdd863fc8d`)

**1. TC12-style version-guard triple.** Seed create, then three self-revisions of the same order.
MEASURED, `staging-orders-cin7-update-order`'s own log, all three sub-cases clean:
* Older (`2026-09-09T04:59:59Z` against a stored `05:00:00Z`): `` {"metric":"SalesOrderStaleRevision","incomingLastModified":"2026-09-09T04:59:59Z","storedLastModified":"2026-09-09T05:00:00Z"} ``.
* Equal (`05:00:00Z`): `` {"metric":"SalesOrderUpdated","added":0,"removed":0,"addressChanged":false} ``.
* Newer (`05:00:05Z`): `` {"metric":"SalesOrderUpdated",...} `` again.

**TC12 reconfirmed at runtime against the redeployed `staging-orders-cin7-update-order`**, not just by
R0's source read. Behaviour byte-for-byte identical to the pre-redeploy verdict.

**2. One cancel, same order.** `CANCEL_ORDER`, `modifiedDate 2026-09-09T05:00:10Z`. MEASURED,
`staging-orders-cin7-cancel-order`'s own log: `SalesOrderCancelReceived`, then `SalesOrderCancelled
linesCancelled:1`, pushing `CANCEL_ITEM`. `staging-orders-v2` ORDER row: `status:CANCELLED
lastModified:2026-09-09T05:00:10Z` -- **flipped, not deleted**, matching TC15's established mechanism.
`staging-shipments` SHIPMENT row: `status:REMOVED`, `wmsSentAt:2026-09-09T05:01:39.150Z` (a fresh
send). **`staging-shipping-manhattan-send-shipment`** (the correct native sender this time, confirmed
by its own invocation): `` {"metric":"ManhattanShipmentPayloadBytes","shipmentId":"QASYN-16-TC12B"} ``,
then `` {"metric":"ManhattanRequestOutcome","outcome":"success","reference":"QASYN-16-TC12B"} `` --
`accepted=1 rejected=0`. **The header reached Manhattan SCALE staging and was accepted, on the literal
`QASYN-` reference as the `ShipmentId`**, exactly as TC15 established pre-redeploy.

**Neither emit behaved differently from its recorded predecessor.** No stop condition hit. Registered
as seq 16 in `../../BUSY-1160/SYNTHETIC-REGISTER.md` before the first emit, per the standing rule.

## Part 4, BUSY-1158's TC4b. Read only

`staging-shipping-v2-dc-packing-shipment-create` (`LastModified 2026-09-09T01:33:01Z`, new
`CodeSha256`). MEASURED, direct source read:
```
var CTC_COMPANY = "CTC";
var isCTCShipment = (shipment) => shipment?.company === CTC_COMPANY;
var handler = async (event) => {
  console.log(JSON.stringify(event));
  if (isCTCShipment(event)) {
    console.log(`shipment ${event.shipmentId} is a CTC record, not for uniWMS`);
    return;
  }
  ...
```
Byte-identical guard and byte-identical log line to what TC4b's PASS was evidenced against. **TC4b
reconfirmed against the redeployed build by direct source read.** No new invocation of this guard has
happened since the redeploy (checked `filter-log-events` back 48 hours: 18 hits, all
2026-09-08, none after today's 01:xx-01:44 UTC deploy window) -- this session's own emits did not route
through this function, and per the slice's own instruction no new shipment was created to force one. The
source read is the confirmation this part offers; a live post-redeploy invocation of the guard remains
unobserved, not contradicted.

**`staging-inventory-check-order-faulty-sale` baseline recorded, not investigated.** MEASURED:
`LastModified 2026-09-07T03:28:13.000+0000`, `CodeSha256 Mb0wle0sGywGNIhZUJeF/CZYGvZ4q/BOR9++iHBFg5U=`
-- identical to R0's own read, confirming no further drift since R0. Unaccounted for by anything this
plan knows; noted as a baseline for a future session, per this part's own instruction not to
investigate it here.

## Reads as

**All four parts now closed exactly as R0 predicted: the redeploy changed only by addition for
everything the native harness sends.** The outbound-chain re-run (Part 2) confirms Q41's fix works at
runtime, not just by source read. The native reconciliation re-run (Part 3) confirms TC12 and TC15's
verdicts hold at runtime against the redeployed handlers too. **The queue anomaly that stopped Part 3's
first attempt is fully explained and turned out to be older and narrower than it looked**: a single,
already-registered, already-understood poison message (`QASYN-12-TC2`) in its own FIFO message group,
unrelated to the redeploy and unrelated to the native path, misdiagnosed on the first pass only
because the wrong function's logs were checked.

## Verdicts changed or reconfirmed by this slice

* **Q30, Q31**: stay CLOSED, now against the 2026-09-09 build (`CodeSha256` changed, `ELIGIBLE_STAGES`
  identical). See `../../BUSY-1065-OPEN-QUESTIONS.md`.
* **Q41**: CLOSED by R0 on source read; this slice adds a **runtime confirmation** -- the exact payload
  that was rejected pre-fix (`QASYN-12-TC2`, `CTC-WH`) now succeeds when only the warehouse code is
  corrected (`QASYN-14-TC2WH`, `CTC-QDC`). See `../../BUSY-1065-OPEN-QUESTIONS.md`.
* **BUSY-1160 TC1b, TC2, TC3**: PASS, reconfirmed against the redeployed outbound chain (fresh emits,
  fresh `CodeSha256` citations, `QASYN-14-TC2WH` and `QASYN-15-TC1B`). See `../../BUSY-1160/QA-DOC.md`.
* **BUSY-1160 TC22**: PASS for 3 of 4, reconfirmed unchanged against the redeployed poller
  (`LastModified 2026-09-09T01:20:09Z`). `Undefined` still the one residual item.
* **BUSY-1160 TC18 (Form A)**: FAIL, reconfirmed unchanged against the redeployed cancel-order bundle
  (`LastModified 2026-09-09T01:20:09Z`). Same throw, same missing named metric on this branch.
* **BUSY-1160 TC12**: PASS, **reconfirmed at runtime** in a second session against Part 3 (see below),
  against the redeployed `staging-orders-cin7-update-order` (fresh order `QASYN-16-TC12B`, all three
  sub-cases clean).
* **BUSY-1160 TC15**: PASS, both halves, **reconfirmed at runtime** in the same session against the
  redeployed `staging-orders-cin7-cancel-order` and `staging-shipping-manhattan-send-shipment` (same
  order, cancelled and reached SCALE on the literal `QASYN-` reference).
* **BUSY-1158 TC4b**: PASS, reconfirmed by direct source read of the redeployed
  `dc-packing-shipment-create` bundle. No live post-redeploy invocation observed (none occurred).

## Stop and ask JJ

**Nothing outstanding.** The Manhattan-sender anomaly that stopped Part 3's first attempt was
characterised in a second session (see the Part 3 section above) and turned out to be a known,
already-registered poison message (`QASYN-12-TC2`), unrelated to this redeploy, in its own FIFO
message group, retrying toward its own DLQ exactly as predicted since slice 08. No action needed
beyond the standing "JJ's call whether to clear the DLQ entry once it lands" already on record for
that message.

## Correction, appended 2026-09-09 after audit

Two character counts stated above are off by one. `"Cheap Thrills Returns Warehouse"` is **31**
characters, not 32. `"Cheap Thrills Wholesale Returns Dept"` is **36**, not 37. Both exceed the
25-character ceiling either way, so neither verdict changes and TC1b stands. Corrected in
`../../BUSY-1160/QA-DOC.md`; recorded here rather than edited above, since a result file is history.

Also confirmed after audit: JJ did give the go-ahead to proceed past R0's two flagged items. The
statement in this file's opening is accurate.

## New open questions

None raised. Q30, Q31, Q41 updated in place, not reopened. No new question meets the bar for a fresh
`Q` number -- the `SalesOrderCancelWithheld` metric and the sender-anomaly correction are flagged above
and in `../../BUSY-1160/SYNTHETIC-REGISTER.md`'s side-effects table, not raised as epic-level questions,
since neither blocks a verdict this plan needs right now.

## Scripts written

None. `emit-synthetic-outbound-order.sh`'s existing `--warehouse` override flag covered Part 2's need,
and `emit-synthetic-revision.sh` covered Part 3's, both without modification. No new script was
required for any part of this slice.

## Part 3, second session, 2026-09-09: gate amended, characterised, run

JJ amended Part 3's gate after seeing the anomaly flagged above: characterise the stuck message with
four specific read-only checks, then proceed under a named outcome rather than stopping outright.
Full detail is in the Part 3 section earlier in this file (appended in place, not as a new section),
including the correction this pass turned up: the queue's actual consumer is
`staging-shipping-manhattan-manhattan-eda-queue-handler`, not `send-shipment`, which is why the first
attempt's log check found nothing. The stuck message is `QASYN-12-TC2`, already known, already
registered, unrelated to this redeploy. Both of Part 3's emits (`QASYN-16-TC12B`: a version-guard
triple, then a cancel) ran cleanly and reconfirmed TC12 and TC15 at runtime. Registered as seq 16 in
`../../BUSY-1160/SYNTHETIC-REGISTER.md`.
