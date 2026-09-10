# Result: Slice 04, revision reconciliation, synthetic

**Ticket:** BUSY-1160
**Verdict:** **9 of 10 cases PASS with strong MEASURED evidence** (TC5, TC7, TC8, TC9, TC10, TC11,
TC13, TC14, TC19). **TC6 is not runnable as written** against any seed this environment holds
(needs a WHOLESALE order; R14 confirmed none has ever existed) -- the closest ECOM analog was run
and reported as its own finding, not forced into a false pass. **TC14 settles drift row 2**: the
payload hash is doing real work in the idempotency key. **Slice 03's open thread is resolved**: the
reconciliation handler emits an outward event precisely when content changes, never when it does
not -- both readings slice 03 left open are now one measured fact.

**Correction made mid-slice, read this before trusting any "reaches SCALE" claim below for an
added line.** Every `add-line`/`change-qty` mutation this session generated a synthetic
`lineItemId` shaped `QASYN<hex>` -- non-numeric. The Manhattan-side handler explicitly validates
this field and refuses to forward it: *"has no usable lineItemId ... refusing to send a corrupted
ErpOrderLineNum to SCALE."* **This is a harness bug, not a system defect** -- exactly the class of
thing BUSY-1260's C5 retraction was about: a real Cin7 `lineItemId` is always numeric, so this
shape could never arise from real data, and the system's refusal to forward it is correct,
protective behaviour. The DynamoDB-level reconciliation (orders table, shipments table, the
`SalesOrderUpdated` attribution) happened correctly and is unaffected -- **only the "and it reached
actual Manhattan SCALE" half of TC5's assertion is retracted below**, replaced with what is actually
confirmed. TC6's finding is unaffected (its own point was already that this mutation shape doesn't
belong to ECOM). TC10 and TC14's core assertions (line identity; idempotency-key behaviour) are
unaffected -- neither claims a SCALE-reaching result for the added lines specifically. Fixed in
`emit-synthetic-revision.sh` (numeric `lineItemId`, see `TOOL-NOTES.md`) and structurally
re-verified (a fresh add-line against `QASYN-02-TC11` persisted with a valid numeric `lineItemId`);
full Manhattan-accept confirmation for the fix was not waited out to completion, since ~5 pre-fix
poison messages were still working through their own retry budget in the shared Manhattan sender
queue at the time (see the side-effects table in `SYNTHETIC-REGISTER.md`).

Four synthetic orders created and registered (`QASYN-02-TC11` through `QASYN-07-TC14`; seq 01 was
slice 03's `QASYN-01-TC12`). Poller schedule DISABLED and SO watermark UNSET throughout, confirmed
before and after. No Cin7 call made.

**Efficiency note.** Several cases share one emit where the mutation genuinely tests more than one
assertion, rather than spending a fresh seed on each: TC11+TC5+TC19 on one add-line emit,
TC8+TC9+TC13 on one change-address emit. This is not "one seed order per case" violated -- that rule
protects against reusing an order a *different* mutation already drifted; it says nothing against
one mutation answering two questions it genuinely answers. Each combination is called out below.

## Order run, and why

Per the slice's own instruction: **TC11 first**, on a genuine content change, to settle slice 03's
open thread before spending four more cases on assumptions that might be wrong. Then TC7 (needed the
deepest trace, done early while patience for tracing was highest), TC6, TC8/9/13, TC10, TC14.

## TC11 + TC5 + TC19 -- `QASYN-02-TC11`, seed `262211`

**Mutation:** add-line (add-item, genuine content change). **All three PASS.**

Seed create landed cleanly (4 rows: ORDER/ITEM/ADDRESS/TRANSACTION, shipment reached SCALE). The
add-line revision applied: MEASURED attribution `{"metric":"SalesOrderUpdated","added":1,"removed":0,"addressChanged":false}`.

**This is the fact slice 03 needed and could not get from a content-neutral test:** a new "Pushed"
line appeared, MEASURED, that never appeared for any of TC12's three revisions --

```
DetailType: ADD_ITEM
Detail: {orderId, category: "CREATION", newItems: [{...the new item...}], message_group_id}
```

Routed (MEASURED, `events:list-targets-by-rule`) to exactly one target on the bus,
`staging-shipping-v2-order-eda-queue-populator` -- the only rule matching literal `ADD_ITEM`.
**TC11 PASS: exactly one outward event, of the right type, one target, counted from the actual
rule set, not assumed.**

**Resolves slice 03's open thread.** The two readings were: (a) the handler emits only when content
changes, or (b) it never emits on an update at all. **(a) is now measured fact.** TC12's three
revisions (`added:0, removed:0, addressChanged:false` every time) produced zero outward events,
consistently, because nothing needed telling the shipping side. This one revision
(`added:1`) produced exactly one. **AC7's "exactly one outward event per revision" reads correctly
as "per revision that changes something the shipping side needs to know", not "per accepted
revision regardless of content"** -- the alternative reading (an update silently never reaching
SCALE) does not hold: TC5, TC7, TC8 below all confirm the same pattern independently.

**TC5** (same emit): new line inserted (MEASURED, fresh `SK`), **existing line untouched**
(MEASURED: the original item's `SK` unchanged, still present, `status OPEN`), new line's row
created in the shipments table (MEASURED: shipment item count 1 -> 2). **Retracted: "reached
SCALE".** The new line's synthetic `lineItemId` was non-numeric at the time
(`QASYN71e6db9b`), and the Manhattan handler explicitly rejected it (see the correction at the top
of this file) -- the row exists in `staging-shipments`, but Manhattan itself never accepted it.
**TC5 PASS on insert-and-existing-untouched; the SCALE half is UNKNOWN for this specific emit**,
not re-run under the fixed harness within this session. New line insertion and non-interference
with the existing line are both still fully MEASURED and correct.

**TC19** (same order, read only): `orderType` (ECOM), `cin7Id` (969602) and `allocatedStore` (51909)
unchanged on the header; `wmsSentAt` advanced to a new, later timestamp (`2026-09-08T04:41:56.483Z`),
confirming a fresh send, not a stale leftover value. PASS.

## TC7 -- `QASYN-03-TC7`, seed `262210` (4 items)

**Mutation:** remove-line. **PASS, one residual gap named rather than assumed away.**

MEASURED attribution: `{"metric":"SalesOrderUpdated","added":0,"removed":1,"addressChanged":false}`.

**Both halves of the additive-SAVE trap, checked separately, as the slice demands:**

* **Orders side:** the removed item's row is not deleted. `status` flips `OPEN` -> `CANCELLED`.
* **Shipments side:** the same item's shipment-side row is not deleted either. `status` flips
  `OPEN` -> `REMOVED` (the LLD's own term).

**Traced the full outward chain, five hops, all MEASURED by request ID and timestamp, because the
first two checks initially looked like "nothing happened" and that is exactly the kind of false
negative this ticket has been burned by before** (a stale `describe-log-streams` read, not a real
gap -- see Scripts/process notes):

```
CANCEL_ITEM (orders-cin7-update-order)
  -> staging-shipping-v2-order-item-cancelled: pushes SHIPMENT_ITEM_REMOVED
  -> staging-shipping-v2-shipment-eda-queue-handler: persists, re-emits TRANS_SHIPMENT_ITEMS_UPDATED
  -> staging-shipping-v2-shipment-item-removed: pushes CREATE_TRANSACTION{event: SHIPMENT_ITEMS_UPDATED}
  -> staging-shipping-v2-shipment-eda-queue-handler again: re-emits SHIPMENT_ITEMS_UPDATED
  -> staging-shipping-manhattan-send-shipment: fires
```

MEASURED, the sender's own log: `{"metric":"ManhattanShipmentPayloadBytes","bytes":1810,"shipmentId":"QASYN-03-TC7"}`,
then `Manhattan ShipmentDownload response: accepted=1 rejected=0`. **A send was specifically
triggered by this removal and Manhattan accepted it.**

**What this does not confirm, named rather than glossed over:** the actual XML content (whether the
removed line is sent as an explicit clear/omission Manhattan's schema treats as authoritative, versus
silently absent in a way an additive `SAVE` would ignore) is not logged anywhere this session could
reach, and the live SCALE state is only readable from **Order Planning > Planned Shipment Insights**
in the UI, which this session's tools do not have. **TC7 PASS on every DB-side and pipeline-trigger
signal available to AWS-CLI tooling; the literal line-level SCALE state is UNKNOWN, not assumed
either way.** Recommend a human check of that specific shipment (`QASYN-03-TC7`) in Planned Shipment
Insights before this is treated as fully closed.

## TC6 -- `QASYN-04-TC6`, seed `262223`. Not runnable as written

**Mutation attempted:** change-qty (closest ECOM analog: a second unit row, same SKU).

MEASURED attribution: `{"metric":"SalesOrderUpdated","added":1,"removed":0,"addressChanged":false}`.
Two persisted item rows, identical `sku` (`WTW26-201B-10`), different `SK`.

**TC6 as written asserts "Same `SK` of `ITEM#<lineItems[].id>#<size code>` updated in place, no new
row."** That `SK` shape and an in-place quantity field belong to the **WHOLESALE/RTV/STORE_PICK
per-size grain** (LLD §3 record model). **R14 (2026-09-08, `RETEST-1158-1159`) already established,
by a full-history scan of both tables, that no order of any of those types has ever existed.** ECOM's
per-unit model (LLD §9.2: "one record per unit... no `quantity` field: a row is a unit") has no
in-place quantity field to change -- structurally, for ECOM, a quantity increase and a new line are
the same operation (a new unit row), which is exactly what the measured `added:1` confirms.

**This is a case/reality mismatch, not a system defect and not a harness gap in the mutation
logic itself** (the harness's `lineItemId` bug, corrected at the top of this file, separately means
this specific emit's added row also never reached Manhattan -- a second, independent reason this
run cannot stand as a SCALE-side result, on top of the SK/quantity-field mismatch already named).
The same pattern this project's own `CLAUDE.md` (via `RETEST-1158-1159`) already names: "a case that
needs a specific shape... either finds one already sitting in live data or it does not run yet...
needs re-scoping, worth raising as its own finding rather than parking it." **Recommend TC6 be
reworded for ECOM (assert `added:1` with the same SKU as an existing line, distinguishing it from a
new-SKU add-line) or explicitly deferred until a WHOLESALE order exists to test the per-size grain
literally** -- whichever JJ prefers. Not re-raised as a new open question; this is a direct, evidenced
consequence of Q35/R14, already on record.

## TC8 + TC9 + TC13 -- `QASYN-05-TC8`, seed `262217`

**Mutation:** change-address, `modifiedDate` in a later tick (`+5s`), fresh hash. **All three PASS.**

MEASURED attribution: `{"metric":"SalesOrderUpdated","added":0,"removed":0,"addressChanged":true}`.
ORDER `lastModified` advanced from the create's stamp to the later tick -- **TC13's "applied"
confirmed.**

**Outward event, MEASURED, one `Pushed` line:**

```
DetailType: ORDER_ADDRESS_UPDATED
Detail: {orderId, addressChanges: {shipping: {...}}, message_group_id}
```

**No item lines anywhere in the payload. TC9 PASS exactly as specified**: header and address only.

Matches 2 rules on the bus (the shared transaction-chain rule and the shipping-side order-event
rule), one target each. **This is one event reaching two subscribers, not two events** -- **TC13's
"exactly one outward event" is about how many times the handler emitted (once, MEASURED), not how
many consumers received it.** Slice 01's Gate B distinction ("count against the full target list,
not an assumed one") holds up exactly as designed.

New address (`city: "ChangedTestville"`, `street1: "2 Changed Synthetic Street"`) landed on the
shipment header's `shippingAddress` map (not a separate row -- this table has no
`ADDRESS#SHIPPING` SK, unlike the orders table; address lives inline on the `SHIPMENT#` header).
`wmsSentAt` advanced to a new timestamp. **TC8 PASS: new address reaches SCALE.**

## TC10 -- `QASYN-06-TC10`, seed `262216` (6 items)

**Three successive revisions, different mutations each: add-line, change-address, remove-line.**
**PASS.**

All three applied (MEASURED attribution each time: `added:1`; then `addressChanged:true`; then
`removed:1`). Item identity captured before the sequence and re-checked after all three:

**All 5 unaffected original items kept identical `SK`, `sku` and `lineItemId`** (the DB-side proxy
for the pair `ErpOrderLineNum`/`SKU.Item` the slice names as the real identity, which lives in
Manhattan's own XML and is not independently re-readable from AWS CLI) **across all three
revisions, no churn.** The 6th original item (targeted by the third revision) flipped to
`CANCELLED`, matching TC7's mechanism. The item added by the first revision persisted, itself
untouched, through the second and third -- **this line identity claim is unaffected by the
`lineItemId` harness bug** (see the correction at the top of this file), since it is about the 5
pre-existing, real-shaped items, not the synthetic one. The synthetic added item's own `lineItemId`
was non-numeric at the time it was created, so it did not reach Manhattan -- not claimed here, TC10
never asserted a SCALE-side result for it.

## TC14 -- `QASYN-07-TC14`, seed `262219` (5 items). Settles drift row 2

**Two revisions, identical `modifiedDate` (`2026-09-08T05:55:00Z`), different content (add-line
twice, independently fresh SKU and hash each time).** **PASS.**

MEASURED: item count 5 -> 6 -> 7, `TRANSACTION` row count 1 -> 2 -> 3, both new synthetic SKUs
present and distinct. **Neither emit was dropped as a replay, despite sharing one timestamp.** This
is an idempotency-key/DB-reconciliation claim, unaffected by the `lineItemId` harness bug (see the
correction at the top of this file) -- both new items' `lineItemId` values were also non-numeric at
the time, so neither reached Manhattan, but that was never TC14's assertion.

**Drift row 2, `QA-DOC.md`:** "Idempotency key: LLD says `<event>#<origin>#<modifiedDate>#<payloadHash>`;
ticket says event, brand, order reference and Cin7 modified date [no hash]." **This settles it in the
LLD's favour.** If the ticket's hash-free description were what shipped, the second edit's
idempotency key would collide with the first's (same event, same origin, same modifiedDate) and it
would be silently dropped. It was not. **The hash is in the key and doing real work,** consistent
with STATE.md's 2026-09-02 correction and slice 03's own idempotencyId finding.

## Ceiling, carried from slice 03 and still true

* Proves handler behaviour **given an input it was actually sent**, via the poller's own real
  first-stage path. Does not prove Cin7 emits revisions in these exact shapes. "The update handler
  reconciles a quantity change" / "an address change reaches SCALE", never "quantity changes work" or
  "address changes work" in general.
* Does not exercise the poller. Nothing here speaks to contact-group resolution, the stage
  eligibility gate, the watermark, or the echo guard.
* `itemChanges.added` carrying the full current line set (not a delta) is now **corroborated,
  not just inferred**: TC5/TC6/TC7/TC10 all sent the full current set each time and the handler's
  `added`/`removed` counts matched exactly what changed relative to the previously persisted set,
  every time, across 4 independent orders and 6 total mutation emits. Still not a code read, but a
  much stronger measurement than slice 03 had.
* Financial totals were not asserted anywhere in this slice, per the standing limit.
* Line identity (TC10) was checked at the DB layer (`SK`/`sku`/`lineItemId`), not against the actual
  Manhattan XML's `ErpOrderLineNum`/`SKU.Item` pair, which needs a SCALE-side or code-level read this
  session's tools cannot reach.

## Attribution instrument, used throughout

Every PASS above cites `staging-orders-cin7-update-order`'s own `SalesOrderUpdated` log line by its
`added`/`removed`/`addressChanged` counts, read by request ID for the specific invocation. No
negative result was left as a bare absence; every applied-vs-not question was settled by this
instrument, an outward `Pushed` line, or both.

## Stop and ask JJ

* TC7's residual SCALE-UI gap (above) -- recommend, don't block on.
* TC6's case/reality mismatch -- recommend rewording or deferring, JJ's call, not re-raised as new.
* The `lineItemId` harness bug's cleanup: ~5 poison messages (one per synthetic order that got an
  add-line/change-qty before the fix) are working through their own retry budget in the shared
  `staging-shipping-manhattan-sender.fifo` queue and will land in its DLQ on their own. Harmless
  (isolated FIFO groups, nothing blocked), but worth JJ knowing before someone else reads that DLQ.
  See `SYNTHETIC-REGISTER.md`'s side-effects table.
* Nothing else here hit a stop condition: no mutation touched an order it was not aimed at, no
  content-varied result was ever a bare, unattributed absence, no case needed the poller schedule.

## Open questions register / drift table

**Drift row 2 (`QA-DOC.md`) settled by TC14**, updated there directly. No new Q raised: TC6's finding
is a direct, already-on-record consequence of Q35/R14, not a new question.

## Scripts written

None new. `emit-synthetic-revision.sh` (slice 03) used for every case in this slice, still
unreviewed per JJ's standing deferred-review call, but **changed mid-slice**: `add-line` and
`change-qty`'s synthetic `lineItemId` generation fixed from a non-numeric `QASYN<hex>` string to a
numeric `9xxxxxx` string, per the correction at the top of this file. Any earlier case's add-line/
change-qty result should be read against that fix's date, not assumed retroactively corrected.

## Process note

One stale-read false alarm during TC7's trace: `describe-log-streams`' `lastEventTimestamp` briefly
returned a value several minutes behind the actual latest event for `staging-shipping-manhattan-send-shipment`,
making it look like the sender had not fired when it in fact had, ~20 seconds after the removal.
Resolved by re-querying a few minutes later and finding the correct, later timestamp already present
(the API is eventually consistent for very recent writes, not a script bug). Recorded here rather
than `TOOL-NOTES.md` since no script was at fault -- worth remembering before concluding "no send"
from a single `describe-log-streams` check in a future slice.
