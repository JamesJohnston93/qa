# Result: Slice 08, final sweep before anything goes to dev

**Ticket:** BUSY-1160
**Verdict:** Every part ran except Part 4 (Part 1c made it unnecessary). **This slice substantially
rewrites what this ticket knows about AC1.** Part 1b found the poller does not reject wholesale --
it routes WHOLESALE/RTV through a complete, fully-wired, dedicated pipeline nobody had traced before.
Part 3 then proved that pipeline works at runtime for TC2, TC3 and (critically) reverses Q40: the
delivery-company-to-ShipTo mapping Q40 said was missing does exist, correctly, in a dedicated
outbound sender -- Q40 was examining the wrong function. Part 3 also found a new, real defect: the
wholesale warehouse code the poller itself constructs (`CTC-WH`) is not configured in Manhattan
SCALE. Part 1a confirms Q38. Part 1c gives TC17 a defined pass for the first time. Part 2 found and
fixed a harness bug and got one clean, useful result (`SalesOrderAlreadyCancelled`): TC18 Form A's
finding narrows to a missing-`ORDER`-row-specific bug, not a general cancel-handling one.

Parts 1 and 4 read only, as planned. Parts 2 and 3 emitted, reaching Manhattan SCALE staging.
Poller schedule stayed DISABLED, SO watermark stayed UNSET throughout -- nothing in this slice
touched either. AWS SSO needed a fresh browser login at the start.

## Part 1a -- Q38 confirmed against the bundle, not just the captured excerpt

Re-read `staging-orders-cin7-so-poller`'s dispatch loop directly (not relying on the excerpt already
in `results/07-poller-cancel-emit-source-read.md`):
```
const eligibility = classifyEligibility({ status: order.status, stage: order.stage, isLocallyDispatchedOrFulfilled: false });
if (eligibility === "skip-terminal") continue;
...
if (eligibility === "skip-counted") {
  skippedStages.set(stage2, ...)
```
**CONFIRMED, `TRIED 3`.** `Dispatched` returns `skip-terminal` and hits `continue` before the
`skippedStages` counter line exists in the control flow at all. A wholesale order at `Approved`
(any non-eligible stage that is not `Dispatched`) returns `skip-counted` and is counted. Two
genuinely different code paths, not an omission in one shared path. `skippedLocallyTerminal` reading
zero on those cycles is explained the same way: that counter lives inside `updateOrder`, which the
43 `Dispatched` orders never reached. Closed in `BUSY-1065-OPEN-QUESTIONS.md`; the remaining question
for Kian is a design one (is the silent `skip-terminal` path deliberate), not an investigation.

## Part 1b -- and this is where the slice's own scope changed

**The question asked: does the poller reject wholesale outright, or does it just never see an
eligible-stage wholesale order?** The answer is neither framing survives contact with the code.

**MEASURED: `createOrder` routes WHOLESALE and RTV through a dedicated path before it ever reaches
the ECOM-only branch:**
```
function isOutboundOrderType(orderType) {
  return orderType === "WHOLESALE" || orderType === "RTV";
}
...
if (isOutboundOrderType(groupClassification.orderType)) {
  await createOutboundOrder(order, reference, groupClassification.orderType, counters);
  return;
}
if (groupClassification.orderType !== ORDER_TYPES.ECOM) {
  counters.skippedCounted += 1;
  return;
}
```
This is not incidental. `createOutboundOrder` builds a `CREATE_OUTBOUND_ORDER` command
(`outboundOrderInfo`/`outboundItemInfo`/`category:"OUTBOUND"`) via its own mapper
(`src/cin7/mapper/outbound-sales-order-mapper.ts`), with its own `deriveShipTo`/`deriveShipToAddress`
functions:
```
function deriveShipTo(order) {
  if (order.deliveryCompany) return order.deliveryCompany;
  const name = `${order.deliveryFirstName ?? ""} ${order.deliveryLastName ?? ""}`.trim();
  if (!name) {
    throw new Error(`Cin7 SO ${order.reference} carries no deliveryCompany, deliveryFirstName or deliveryLastName — refusing to map an empty ShipTo to SCALE.`);
  }
  return name;
}
```
and per-size items via `expandLineItems2`:
```
items.push({ SK: `ITEM#${lineItem.id}#${unit.code}`, lineId: String(lineItem.id), sku: unit.code, quantity: unit.qty });
```
**This is the LLD's own per-size grain (`ITEM#<lineItems[].id>#<size code>`), confirmed by direct
source read, matching CLAUDE.md's own description of it exactly.**

**Traced the whole chain end to end, all still read-only at this point:**
`CREATE_OUTBOUND_ORDER` (`Detail.event`, same `CREATE_TRANSACTION`/two-stage routing pattern as
everything else) -> **`staging-orders-v2-create-transaction`** (the real shared handler behind the
generic 2020-byte `-eda-queue-handler` relay every other chain in this plan already showed; its
schema explicitly lists `CREATE_OUTBOUND_ORDER`/`UPDATE_OUTBOUND_ORDER`/`CANCEL_OUTBOUND_ORDER` with
the comment `// CTC outbound shipments (WHOLESALE / RTV sales orders)`, persists `outboundOrderInfo`/
`outboundItemInfo` on the TRANSACTION row, re-emits `TRANS_CREATE_OUTBOUND_ORDER`) ->
`staging-orders-cin7-outbound-orders-eda-queue-populator/-handler` (confirmed via `--search
CREATE_OUTBOUND_ORDER,outboundOrderInfo,outboundItemInfo`, then its own `WORKER_*` env vars) ->
**`staging-orders-cin7-create-outbound-order`** (a real, substantial worker -- persists `ORDER`/
`ITEM#<id>#<size>` rows into `staging-orders-v2` via its own `OrderModel`/`OrderItemModel`, publishes
`OUTBOUND_ORDER_CREATED`) -> `staging-shipping-inbound-outbound-bridge-eda-queue-handler` (another
generic relay) -> **`staging-shipping-inbound-outbound-order-bridge`** (pushes `OUTBOUND_SHIPMENT_SAVE`
onto `staging-shipping-v2-event-bus`) -> `staging-shipping-v2-create-transaction` (same pattern again,
re-emits `TRANS_OUTBOUND_SHIPMENT_READY`) -> `staging-shipping-manhattan-manhattan-eda-queue-populator/
-handler` -> **`staging-shipping-manhattan-send-outbound-shipment`, a dedicated Manhattan sender for
outbound shipments, entirely separate from the native `send-shipment`.**

**Every one of these functions is real, substantially sized, deployed code** (checked `CodeSize` and
`LastModified` for each rather than assuming): `staging-orders-cin7-create-outbound-order` (338KB),
`staging-shipping-inbound-outbound-order-bridge`, `staging-shipping-manhattan-send-outbound-shipment`
all exist and are wired by real EventBridge rules with real targets, confirmed via
`events:list-rules`/`list-targets-by-rule`, not inferred from naming conventions.

**Reads as, per the slice's own framework: wholesale creates normally.** This is not a defect finding
that stops the slice -- it is the "no rejection" branch the slice itself named as the outcome that
turns Q35 into a data question rather than a code question. **R14's finding stands and is not
contradicted**: no wholesale order has ever reached this pipeline, because Cin7 has never returned
one at an eligible stage (Q31/Q35's own stage-vs-type confound, unchanged). What changes is that R14
was a population check, and this is the first evidence that the destination the population would
have gone to is real, complete, and (per Part 3) works.

## Part 1c -- TC17's classification, now defined

Read `staging-shipping-manhattan-send-shipment` for its handling of `rejectedTransactions > 0`.
**MEASURED, complete answer:**
```
if (response.rejectedTransactions !== 0 || response.acceptedTransactions === 0 || isSchemaValidationFailure(response.message)) {
  throw new ManhattanRejectionError(reference, response);
}
```
```
function isSchemaValidationFailure(message) {
  return typeof message === "string" && message.includes("XML Schema Validation failed");
}
function classifySendOutcome(err, status) {
  if (err instanceof ManhattanTokenError || err instanceof ManhattanConfigError) return "auth_error";
  if (err instanceof ManhattanRejectionError) return "rejected";
  if (status === void 0) return "network_error";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return "unknown_error";
}
```
```
if (outcome === "auth_error" || outcome === "rejected" || outcome === "client_error") {
  console.error(`... Permanent failure sending to Manhattan SCALE: ${message}`);
  await publishAlert("ManhattanSendPermanentFailure", reference, { ... });
} else {
  console.error(`... Transient failure sending to Manhattan SCALE: ${message}`);
}
```
**A `rejectedTransactions > 0` response IS classified `"rejected"` and IS logged and alerted as a
Permanent failure -- exactly the discriminator and exactly the classification AC5 wants, already
implemented.** One nuance worth carrying to Lachlan: the classification only changes the log message
and whether `publishAlert` fires. The function's caller always `throw err`s after `handleSendFailure`
returns, regardless of branch, so SQS redelivers *every* failure the same way up to `maxReceiveCount`
before it reaches the DLQ -- a "permanent" classification does not skip retries, it only labels them.
**TC17 gains a defined pass for the first time**: pass is "a rejection is logged and alerted as
permanent"; whether retrying a known-permanent rejection 20 times before DLQ is intended is a short,
concrete question for Lachlan, not an open design gap. TC17 still needs a waved shipment to run live
-- unchanged, and Part 4 (a forced rejection without a wave) is skipped, since this closes the
classification question Part 4 existed to work around.

## Part 2 -- TC18, two more forms

### Form B, a duplicate cancel against an already-cancelled order

**Found and fixed a harness bug before this could run.** `emit-synthetic-revision.sh`'s self-revise
logic copied the persisted item's own `status` straight through; against `QASYN-09-TC15` (already
`CANCELLED` from slice 05's TC15) that meant sending `itemChanges.added[0].status: "CANCELLED"` --
not a value the shared handler's schema accepts (`OPEN/FULFILLED/FULFILLED_B2B/REFUNDED/RETURNED/
UNDELIVERABLE/DELIVERED/PENDING_SEND/PENDING_CREATE`, no `CANCELLED`, since that is a local-only flip
Cin7 never reports back). First attempt threw `ValidationError` at `staging-orders-v2-create-
transaction` and began retrying toward the shared `staging-orders-v2-dlq.fifo` (no alarm on this
prefix, confirmed via `describe-alarms`, so no live paging risk -- left to drain naturally rather than
touched, since that queue is shared with real UNI traffic and must never be purged). **Fixed**:
`item_to_change()` now maps a persisted `CANCELLED` status to `OPEN` before constructing the payload,
verified with a dry run. Re-emitted under the fix.

**Queued behind the original bad message in the same FIFO group** (both share `QASYN-09-TC15`'s
`orderId` as `message_group_id`), so the fixed emit could not be attempted until the bad message
exhausted its retries. Confirmed at end of session: the bad message dead-lettered
(`staging-orders-v2-dlq.fifo` depth 3 -> 4, ~20 minutes after the first attempt, matching
`maxReceiveCount 20` / `VisibilityTimeout 60s`), and the fixed re-emit then landed cleanly:
```
{"metric":"SalesOrderCancelReceived","orderId":"01b616c4-...","lastModified":"2026-09-09T02:05:00Z"}
{"metric":"SalesOrderAlreadyCancelled","orderId":"01b616c4-..."}
```
**MEASURED, TC18 Form B PASS**: a duplicate cancel against an order that already has an `ORDER` row
and is already cancelled is handled benignly, with its own named attribution metric, no throw, no
alarm. **This narrows the original TC18 (Form A) finding precisely: the cancel handler's uncaught-
error bug is specific to a missing `ORDER` row, not to cancel handling in general.** A redriven or
duplicate cancel against an order the system actually knows about is safe.

### Form C, deferred

Building a shipment that exists in DynamoDB but never reached SCALE (via the known non-numeric-
`lineItemId` refusal) needs a fresh add-line emit under the already-fixed harness, then a cancel.
**Not run this sitting** -- Part 2's time went to finding and fixing the Form B harness bug and
Part 3's much higher-value discovery took priority for the remaining time. Recommended as a small,
cheap follow-up: seed a fresh order, one add-line revision with a non-numeric SKU forced (or simply
observe the naturally-occurring case, since the harness's numeric-`lineItemId` fix from slice 04 means
this needs deliberately reintroducing the old shape or finding another way to keep a line out of
SCALE), then cancel it and confirm the DELETE is either accepted as benign or produces a new finding.

## Part 3 -- AC1's downstream half, and this is where the correction to Q40 lives

**Built `emit-synthetic-outbound-order.sh`**, a new harness constructing the actual
`CREATE_OUTBOUND_ORDER` shape Part 1b found (`outboundOrderInfo`/`outboundItemInfo`/
`category:"OUTBOUND"`), not the `CREATE_ORDER`+`orderType:WHOLESALE` shape the slice's own Part 3
text assumed. Verified the schema match field-by-field against `staging-orders-v2-create-
transaction`'s own schema before the first `--emit` (shipTo/shipToAddress field set matched exactly).
**Seeded from a real ECOM order for shape only** (262208), header re-typed and address/warehouse
fields overridden -- this is a designed-for input per the LLD and the ticket, not a malformed one, the
same standard the plan has held every other emit to.

### Emit 1, `QASYN-12-TC2`, WHOLESALE, `deliveryCompany` set, multi-size items

Landed through the entire chain traced in Part 1b, all the way to a Manhattan send attempt.
**MEASURED, persisted in `staging-orders-v2`**: `ORDER` row carries `orderType:WHOLESALE`,
`shipTo:"Cheap Thrills Wholesale Pty Ltd"`. Two `ITEM` rows, `ITEM#3494647#M` (qty 2) and
`ITEM#3494647#L` (qty 1) -- **TC3 PASSES**: one row per size, each with its own quantity, exactly as
written. Also persisted a `SHIPMENT#QASYN-12-TC2` row in `staging-shipments`, status
`PENDING_OUTBOUND`, `shipTo` still correct -- **TC2 settled**: the order lives in the same
`staging-orders-v2`/`staging-shipments` tables ECOM uses, under a dedicated handler chain and schema,
not a physically separate "outbound family" table. Both readings in the drift row were partially
right: the ticket's "rides ECOM's records" is correct about storage location; the LLD's "own
materialiser and sender" is correct about the code path, confirmed by the dedicated
`create-outbound-order`/`send-outbound-shipment` functions this slice found.

**Then rejected by Manhattan**, at `staging-shipping-manhattan-send-outbound-shipment`:
`ManhattanRejectionError: ... Invalid warehouse "CTC-WH".` **Not a harness artefact.** `CTC-WH` is
exactly what the poller's own lookup produces:
```
var WAREHOUSE_BY_BRANCH_ID = { 51909: "CTC-QDC", 51908: "CTC-WH" };
```
This is a real, previously-undiscovered configuration gap: the code constructs a warehouse code for
wholesale orders that Manhattan SCALE itself does not recognise. Isolated from a wider pipeline
failure by Emit 2, below.

### Emit 2, `QASYN-13-TC2RTV`, RTV, known-valid warehouse (`CTC-QDC`), delivery company over 25 chars

Built specifically to answer: is the rejection about the warehouse code, or does the whole outbound
pipeline fail at Manhattan regardless of input? **Reached full Manhattan acceptance.** Traced the
entire chain a second time end to end, including a hop Emit 1 never reached because it failed one
step earlier:
```
WARN Truncating Customer.ShipTo to 25 characters: "Cheap Thrills Returns Warehouse"
...
Pushed {"event":"OUTBOUND_SHIPMENT_SENT", ... "sentAt":"2026-09-09T01:56:45.539Z", "sentLineIds":["3494647#M"]}
```
**This is the direct, definitive, runtime answer to Q40 and it reverses the finding.** `ShipTo` is
built from the delivery company (`deriveShipTo`'s own priority, matching the poller's construction),
and the 25-character truncation fires correctly (32-character input truncated, logged) -- both exactly
per AC1/TC1b, in a dedicated sender Q40 never examined. **Q40 as originally raised was correct about
the function it read and wrong about its relevance**: `fullName(address)`-only `ShipTo` construction
is real, but it belongs to the native path a genuine wholesale order never reaches, because
`isOutboundOrderType` routes it away before it gets there.

## What this means for Q35, Q38 and Q40 -- updated in `BUSY-1065-OPEN-QUESTIONS.md`

* **Q35** (does the poller reject wholesale, or does it simply never see an eligible one): answered
  by Part 1b/Part 3 together. It does not reject. The full pipeline exists, is wired, and works given
  a WHOLESALE/RTV input (Part 3 proved this at runtime, not just by code read). The stage/type
  confound that has always gated Q35 is unchanged -- this closes the "does it reject" half, not the
  "will Cin7 ever send one at an eligible stage" half, which stays with W1c.
* **Q38**: `TRIED 3, CONFIRMED` by direct bundle read (Part 1a). Closed; one design question left for
  Kian (is silent `skip-terminal` exclusion from `skippedStages` deliberate).
* **Q40**: the original finding is corrected, not merely updated. `ShipTo` DOES carry the delivery
  company, correctly truncated, for a genuine wholesale/RTV order -- proven at runtime (Part 3, Emit
  2), not just read from source. The residual, real defect is narrower and different: **Manhattan
  SCALE has no `CTC-WH` warehouse configured**, which would block every wholesale order specifically
  (not RTV, and not the ShipTo mapping at all). Raised as its own question rather than folded into
  Q40's close, since it is a different mechanism entirely.
* **Q41, new**: is `CTC-WH` the wrong code, or is Manhattan's own configuration missing it. Raisable
  now -- a real Manhattan rejection, isolated to the warehouse code specifically by Emit 2's clean
  acceptance under a known-valid one.

## Open at end of session

* **TC18 Form B confirmed resolved** (above) -- the fixed re-emit landed cleanly with
  `SalesOrderAlreadyCancelled` once the original bad message dead-lettered.
* **`QASYN-12-TC2`'s rejected message is still retrying** in `staging-shipping-manhattan-sender.fifo`
  toward `staging-shipping-manhattan-sender-dlq.fifo` (no alarm on this pair, confirmed, so no paging
  risk -- consistent with the pre-existing 7 messages already in that DLQ from slice 04's bug). Will
  add an 8th entry once it exhausts retries. Not purged -- JJ's call per the standing rule, same as
  the others already there.
* **Form C (Part 2) not run.** Small, cheap, recommended as the next follow-up if TC18 needs a third
  data point.

## Stop and ask JJ

None of the four listed conditions were hit as alarming stops: **Part 1b did find the poller creates
wholesale orders normally, which the slice names as the "no rejection" reading, not the "defect"
reading** -- reported as the substantial finding it is, not treated as a stop. No alarm fired and
stayed firing (the shared `orders-v2-dlq` and `manhattan-sender-dlq` prefixes both confirmed to have
no CloudWatch alarms attached, so neither pending dead-letter is a live paging risk). The synthetic
wholesale orders reached SCALE in states that are informative, not indistinguishable from real
traffic (registered, `QASYN-` prefixed, one rejected with a real code-level cause, one accepted and
traceable). Nothing needed the poller schedule, a watermark write, or a Cin7 call.

## Scripts written

* `emit-synthetic-outbound-order.sh`, new, **unreviewed** (review deferred by design). Constructs a
  faithful `CREATE_OUTBOUND_ORDER` transaction, verified against the real schema before first use,
  then verified twice more by two successful real emits reaching materially different outcomes
  (rejected vs accepted) for reasons fully attributed. Added `--warehouse` override for the second
  emit, kept in the script since future outbound cases will need it.
* `emit-synthetic-revision.sh` fixed (self-revise no longer copies a locally-`CANCELLED` item status
  through). See `TOOL-NOTES.md`.
* `inspect-lambda-code.sh` reused, unchanged, across roughly a dozen more functions this slice --
  fourth ticket-adjacent question it has answered (Q38, Q35, Q40, TC17) without any modification
  needed.

## Data handling

No customer data read. Every DynamoDB query used the established origin_index/PK pattern extracting
only the fields being checked. Code excerpts throughout are the minimum needed to support each
finding; every downloaded Lambda package was deleted immediately after its check, per
`inspect-lambda-code.sh`'s own design. Synthetic customer fields throughout are placeholders
(`qasyn-synthetic@example.invalid`, `1 Synthetic Street`), safe to show as-is.
