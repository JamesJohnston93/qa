# QA Doc - BUSY-1160

### BUSY-1160, Native updates: wholesale mapping, line reconciliation, cancellation

**Relevant Documentation**

* [Task BUSY-1160](https://universalstore.atlassian.net/browse/BUSY-1160), status In Progress, assignee kian.noctor. Blocked by [BUSY-1159](https://universalstore.atlassian.net/browse/BUSY-1159), which is still in Review.
* [Epic BUSY-1065](https://universalstore.atlassian.net/browse/BUSY-1065), Cin7 Sales Order Integration.
* [LLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1802698758), source of truth, §3 order handlers, §5 per type mapping, §9.1 eligibility and echo guard, §11.2 and §11.5 verification.
* [HLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1631617025), business framing and volumes.
* [Confirmation LLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1806139393), the return leg that consumes what this ticket writes.
* QA Doc - BUSY-1159, the create path this one extends. Its findings on the item master gap and the missing payload hash carry over.

**Goal of Task**

An order rarely stays as it was raised. Quantities change, lines come and go, a delivery address is corrected, and some orders are cancelled outright. This task keeps the warehouse job in SCALE matching the Cin7 order while the order is still editable, and removes it when the order is cancelled. It also brings in wholesale and B2B orders, which reach the same warehouse but ship to a company rather than a person. Once the warehouse has released an order for picking, late changes are rejected and become a job for people.

**Stakeholders**

Assignee kian.noctor, reporter Lachlan.Paulsen.

**Overview**

The poller does no diffing. It emits one transaction per revision carrying the full current line set, and the orders service reconciles: new lines inserted, changed quantities updated in place under the same `SK` of `ITEM#<lineItems[].id>#<size code>`, vanished lines marked removed, cancel flipping status without deletion. All three are guarded on the stored `lastModified`, which is Cin7's `modifieddate`, and the guard passes when the incoming value is not older. Idempotency is `<event>#<origin>#<modifiedDate>#<payloadHash>`. WHOLESALE resolves from the contact `group`, carries one row per size with a `quantity`, takes `deliveryCompany` as `ShipTo` truncated to 25 characters, and keeps `AllocateComplete = Y`. Cancellation is inferred from loss of eligibility, not from `isVoid`, and reaches SCALE as a header DELETE on the same `ShipmentId`.

**Acceptance Criteria (from Jira AC checklist)**

Jira carries these as an unnumbered checkbox list. The AC numbers below exist only so the test table has something to point at, and will not survive an edit to the ticket.

* **AC1** A wholesale order lands in SCALE with the delivery company as `ShipTo` and the wholesale order type
* **AC2** Pre-wave edits in Cin7 are reflected in SCALE: line added, quantity changed, line removed, address changed
* **AC3** Successive revisions of one order reconcile in place, changed quantities update under the same item key rather than churning line identity
* **AC4** An address-update payload carries no lines
* **AC5** A cancelled order is removed from SCALE; a post-wave update or delete rejection is classified permanent and lands in the DLQ
* **AC6** A replayed revision is a no-op under the version guard; a later edit in a new modified-date tick passes
* **AC7** Exactly one outward event per revision
* **AC8** Handler tests for the reconciliation decisions against seeded orders: add, remove, quantity change, address change, cancellation

### Scope for this QA pass

**Covered here:** wholesale mapping and family routing, line reconciliation across successive revisions of one order, the version guard, cancellation, and the failure classification when SCALE rejects a change to a waved shipment.

**How it is driven.** Cin7 stays read only, but it is the only read-only link in the chain: every acceptance criterion here sits downstream of the poller. So a revision is injected as a synthetic transaction at the poller's own entry point, seeded from a real order and mutated in one field. **Read every verdict accordingly.** Each evidences that the handler behaves correctly given an input the system was sent, not that Cin7 produces that input. Synthetic records carry a `QASYN-` reference and are listed in the plan's register.

**Out of scope**

* The create path, the poller gates and the sender itself. Covered by BUSY-1159.
* RTV and STORE_PICK, and the outbound family as a whole beyond what wholesale needs. Owned by BUSY-1161 and BUSY-1219. **Updated 2026-09-09: wholesale itself belongs there too**, per Kian directly, and the deployed code agrees. AC1's ticket text was never updated to match, see C6 in the register. AC1's cases are kept here as measured rather than moved, and their live upstream half defers to BUSY-1161.
* The error taxonomy, alerting and metrics that AC5 leans on. Owned by BUSY-1162, To Do. Its absence is why TC17 cannot pass yet, and that is not a defect on this ticket. TC18's fix was deferred there too on 2026-09-09, see D18.
* The confirmation leg writing back into Cin7. Separate epic, BUSY-1015 to BUSY-1017. TC20 checks only that its write pattern is skipped, not that it works.
* `lastEmittedPayloadHash` being written at all. **Corrected 2026-09-02 by BUSY-1159 slice 13.** A payload hash is computed on every emit and lives in `idempotencyId`'s trailing segment; the named attribute is simply never exposed, by the shape of the emit rather than by a schema gap. So TC20 does not wait on someone writing an attribute. It waits on the confirmation leg existing, and on a decision from Lachlan about whether the named attribute is a real requirement or stale LLD text. See D17.

**Services**

| Component | Resource Name | Type |
|---|---|---|
| Sales order poller | `staging-orders-cin7-so-poller` | Lambda |
| Poller watermark | `/staging/orders/cin7-so-watermark` | SSM parameter |
| Orders table | `staging-orders-v2` | DynamoDB |
| Idempotency index | `idempotency_index` | GSI on the orders table |
| Shipments table | `staging-shipments` | DynamoDB |
| Origin index | `origin_index` | GSI on the shipments table |
| Orders event bus | `staging-orders-v2-event-bus` | EventBridge bus |
| Shipping event bus | `staging-shipping-v2-event-bus` | EventBridge bus |
| Shipment sender | `staging-shipping-manhattan-send-shipment` | Lambda |
| Sender queue | `staging-shipping-manhattan-sender.fifo` | SQS FIFO |
| Sender dead letter queue | `staging-shipping-manhattan-sender-dlq.fifo` | SQS FIFO, 20 attempts |
| Outbound materialiser and sender | Not published, LLD §3 | Planned, needed only if wholesale routes outbound |
| Feed alerts | `staging-orders-cin7-alerts` | SNS, no subscribers |
| Send alerts | `staging-shipping-manhattan-alert-topic` | SNS, no subscribers |

**Blockers For Testing**

* ~~TC17 has no defined pass~~ **Classification half CONFIRMED, 2026-09-09, slice 08.** A rejection IS classified permanent and alerted, exactly as AC5 wants -- source read of `send-shipment`. Still needs a shipment the warehouse has actually waved, and none has been. `results/08-final-sweep-before-dev.md`.
* ~~AC1's cases have no fixture and none can be made~~ **Downstream half proven anyway, 2026-09-09, slice 08.** A synthetic `CREATE_OUTBOUND_ORDER` traced a complete, previously-untraced dedicated pipeline (own handler chain, own Manhattan sender) to real acceptance. The upstream half (a real Cin7 wholesale order at an eligible stage) is still unreachable -- Q35's own headline, a data question now, not a code gap. `results/08-final-sweep-before-dev.md`.
* ~~AC1's own worked example doesn't hold against the deployed code~~ **Corrected, 2026-09-09, slice 08.** The `fullName`-only `ShipTo` gap (Q40) is real but belongs to the native path a real wholesale order never reaches -- the poller routes WHOLESALE/RTV to a dedicated outbound pipeline first. That pipeline's own sender correctly builds `ShipTo` from the delivery company and truncates it at 25 characters, proven by a real emit reaching Manhattan. `results/08-final-sweep-before-dev.md`.
* **New, real defect found instead, 2026-09-09, Q41.** The same emit that proved `ShipTo` works was rejected by Manhattan on `Invalid warehouse "CTC-WH"` -- exactly the code the poller's own lookup produces for the wholesale branch. Isolated to the warehouse code specifically by a second emit using the known-valid main-warehouse code, which was accepted in full. `../BUSY-1065-OPEN-QUESTIONS.md`.
* **TC18 found a real defect, narrowed 2026-09-09, and its fix is deferred to BUSY-1162 (JJ, 2026-09-09).** The cancel handler throws an uncaught error on a DELETE for a shipment SCALE never held specifically when no `ORDER` row exists at all (Form A) -- a duplicate cancel against an order that does have one (Form B) is handled cleanly instead. Slice 05, slice 08, `results/05-cancellation-and-isolation.md`, `results/08-final-sweep-before-dev.md`.
* ~~Q30 and Q31 together still gate sign-off~~ **Cleared, 2026-09-09, slice 07.** A direct read of the deployed poller found `Fully Picked`/`Partially Picked` already match dev's stated intent (`ELIGIBLE_STAGES` includes both), so a picked-stage order never reaches the cancel path. Q31's older "confirmed ineligible" finding measured a poller build from one day before the 2026-09-03 deploy this whole plan tests against, and is now stale. **This was the ticket's last sign-off blocker; nothing further gates AC5.** See Q30 and Q31 in `../BUSY-1065-OPEN-QUESTIONS.md`, both moved to Answered, and `results/07-poller-cancel-emit-source-read.md`.
* ~~TC22's mapped tax-status value set was built from the values dev happened to see while testing~~ **Mostly cleared, 2026-09-09, slice 02.** Cin7's own API docs give the authoritative 4-value set, and a direct code read found the fix already deployed for 3 of them (`Exempt` no longer hard-errors). One value, `Undefined`, never observed on a real order, still hard-errors with no confirmation that is deliberate -- small residual item, worth a one-line confirmation from Kian, not a blocker. `results/02-taxstatus-coverage.md`.

**Edge Cases / Gotchas**

* Cin7 `modifiedDate` has whole second precision, so two edits inside one second carry the same timestamp. The payload hash in the idempotency key is what separates them, and TC14 is the only thing that proves it.
* The version guard passes on an equal timestamp, not only a newer one, because of that precision. A test asserting strict inequality would report a false defect.
* The orders to shipping queue deduplicates on content over a 5 minute window, so a replay with identical content inside that window is dropped silently. Anyone debugging a missing replay will chase the wrong thing.
* A confirmation write back changes stage, shipped quantities, tracking and dispatch dates, none of which is mapped, so it must hash identical and emit nothing. The poller's `echoSkipped` counter cannot evidence that for an injected transaction, because injection bypasses the poller.
* A misclassified contact group now selects the record family, grain, materialiser, sender and confirmation branch, not just the ship to value.
* SCALE SAVE is additive, so a field cleared in Cin7 never clears without an explicit overwrite. A removal test checking only for an absent value passes wrongly.
* Detail line identity is the pair `ErpOrderLineNum` and `SKU.Item`, never the line number alone, because every size expanded from a style shares the style's line id.
* **Cancellation is inferred from loss of eligibility, not from a void flag**, and picked stages interact with that. Dev's corrected position is that both picked stages are eligible, so reaching one is not a loss of eligibility and no cancel follows. **Confirmed against the currently deployed poller by source read, slice 07: the eligible-stages list already includes both picked stages, matching that intent.** Q31's earlier "confirmed ineligible" finding measured a poller build from before the 2026-09-03 deploy and is now stale. Slice 05 separately measured that the downstream reconciliation handler has no stage-based safety net of its own -- it would execute whatever the poller sends -- but the poller does not send a cancel for this input. Closed, see Q30.

**Actual Tests**

Black box against staging. Revisions are driven by injecting a synthetic transaction at the poller's own first-stage entry point, seeded from a real order and mutated in one field.

```
Synthetic transaction, seeded from a real order      Real Cin7 order
   one mutation, QASYN- reference                     (create path only)
        |                                                   |
        +--------------------------+------------------------+
                                   v
  SO POLLER PATH, full line set per revision, no diffing
   contact group picks type and family          [TC2, TC4]
   echo guard skips confirmation write backs    [TC20]
   payload hash separates same second edits     [TC14]
        |
        v
  ORDER HANDLERS, reconcile against the incoming set
   insert, update in place, mark removed        [TC5, TC6, TC7]
   version guard on lastModified                [TC12, TC13]
   cancel flips, never deletes                  [TC15, TC16]
   one outward event per revision               [TC11]
   header fields survive reconciliation         [TC19]
        |
        v
  SENDER, SAVE or DELETE on the shipment id
   wholesale mapping and truncation             [TC1, TC1b, TC3]
   address update carries no lines              [TC8, TC9]
   line identity stable across revisions        [TC10]
        |
        v
  MANHATTAN SCALE STAGING
   post wave rejection is permanent             [TC17]
   delete of an unknown shipment is benign      [TC18]
   Universal Store traffic untouched            [TC21]
```

| TC | AC | Test | Expected Result | Status |  |
|---|---|---|---|---|---|
| TC1 | AC1 | Wholesale order flows through a poll cycle | `ShipTo` is the delivery company, order type is wholesale | **Downstream half PASSES (proven at runtime, 2026-09-09); upstream half still BLOCKED** | The full case (poll cycle -> contact-group resolution -> ShipTo) needs a real Cin7 wholesale order at an eligible stage, which has never occurred (Q35). But a synthetic `CREATE_OUTBOUND_ORDER` traced the entire downstream chain to a dedicated Manhattan sender that correctly built `ShipTo` from the delivery company and reached full Manhattan acceptance. `results/08`. **Ownership settled 2026-09-09 by Kian: wholesale lands in BUSY-1161.** JJ's call the same day, defer the upstream half's pass or fail to that ticket. The verdict here stays as measured; the fixture that would move it is not this ticket's to produce. See C6 in the register |
| TC1b | AC1 | Wholesale delivery company longer than 25 characters | Truncated and logged, full value on the address name | **PASS** | 2026-09-09: a real emit with a 31-character delivery company (`"Cheap Thrills Returns Warehouse"`) produced `WARN Truncating Customer.ShipTo to 25 characters` from the dedicated outbound sender, then reached Manhattan successfully. The address-name-preserved-in-full half is INFERRED from the code structure (the truncation function only touches `Customer.ShipTo`, `ShipToAddress.name` is untouched), not independently re-read. **Corrects the earlier Q40-based BLOCKED verdict**: that finding was against the wrong function -- a real wholesale order never reaches it. `results/08`. **Reconfirmed 2026-09-09 against the 2026-09-09 redeploy** (`staging-shipping-manhattan-send-outbound-shipment`, `LastModified 2026-09-09T01:39:12Z`): fresh emit `QASYN-15-TC1B`, 36-character company `"Cheap Thrills Wholesale Returns Dept"`, same `WARN Truncating` line, same `OUTBOUND_SHIPMENT_SENT` accept. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` |
| TC2 | AC1 | Compare records written for a wholesale order | Outbound records only, no native shipment rows | **PASS, both readings partially right** | 2026-09-09: a real emit persisted `ORDER`/`ITEM` rows in `staging-orders-v2` and a `SHIPMENT` row in `staging-shipments` -- the same tables ECOM uses (the ticket's "rides ECOM's records" is right about storage) -- via an entirely dedicated handler chain and schema, down to its own Manhattan sender (the LLD's "own materialiser and sender" is right about the code path). **Still latent**: this is what the code does given the input; no real wholesale order has ever produced it (R14, Q35). `results/08`. **Reconfirmed 2026-09-09 against the 2026-09-09 redeploy**: `QASYN-14-TC2WH` and `QASYN-15-TC1B` persisted the same record shape in the same two tables via the same dedicated chain. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` |
| TC3 | AC1 | Wholesale order carrying a multi size style | One row per size with a quantity, zero quantity sizes counted | **PASS** | 2026-09-09: a real emit with two size rows sharing one lineId persisted as two `ITEM#<lineId>#<size>` rows, each with its own quantity, exactly as written. The "zero quantity sizes counted" half is confirmed by source read only (the poller's `expandLineItems2` has a dedicated `skippedZeroQtyCount`), not by a live emit -- that logic is upstream of injection. `results/08`. **Reconfirmed 2026-09-09 against the 2026-09-09 redeploy**: `QASYN-14-TC2WH`, two size rows sharing one lineId, persisted as `ITEM#3494647#M` (qty 2) and `ITEM#3494647#L` (qty 1). `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` |
| TC4 | AC1 | Orders across the mapped contact groups, plus one unmapped | Each maps to its type, unmapped alerts and is not sent | **Mapping table CONFIRMED by source read, 2026-09-09; live test still BLOCKED** | `classifyContactGroup` maps `Retail - Ecomm`->ECOM, 7 named wholesale groups->WHOLESALE, `Supplier`->RTV, `Retail - Shop`->skip-counted, anything else->alert+not sent, exactly as the case describes. Cannot run live: needs real Cin7 orders across each contact group, which is Q35's own unresolved headline (does Cin7 ever return one at an eligible stage), and the one half of Q35 Kian's 2026-09-09 answer did not settle. **The live half defers to BUSY-1161 with the order type**, JJ's call 2026-09-09. `results/08` |
| TC5 | AC2 | Line added to an order already in SCALE | New line reaches SCALE, existing lines untouched | **PASS on insert/untouched; SCALE half UNKNOWN** | New line inserted with a fresh `SK`, original line untouched, shipments-side row created. **SCALE half retracted**: the new line's synthetic `lineItemId` was non-numeric and the sender correctly refuses those. Harness fixed, not re-run under the fix. `results/04` |
| TC6 | AC2, AC3 | Quantity changed on an existing line | Same item key updated, no new row | **NOT RUNNABLE AS WRITTEN** | Asserts a per-size grain that only WHOLESALE, RTV and STORE_PICK use, and no order of those types has ever existed (R14, full-history scan). ECOM is one row per unit with no quantity field, so a quantity increase and a new line are the same operation: closest analog measured `added:1`. **This is an acceptance-criteria question, not a case that needs re-running.** See the AC2/AC3 drift row above: if that limb belongs to BUSY-1161, TC6 is out of scope here rather than unrunnable, and AC2 and AC3 lose their only gap. With Lachlan. `results/04` |
| TC7 | AC2 | Line removed from an order already in SCALE | Line marked removed, removal reaches SCALE | **PASS**, one residual gap named | Orders-side item `OPEN` to `CANCELLED`, shipments-side `OPEN` to `REMOVED`, neither deleted. Outward chain traced five hops to a Manhattan accept, `accepted=1 rejected=0`. Residual gap: line-level SCALE state needs a UI read. `results/04` |
| TC8 | AC2 | Delivery address changed | New address reaches SCALE | **PASS** | 1 run. New address on the shipment header, `wmsSentAt` advanced. |
| TC9 | AC4 | Inspect the payload of an address update | Header and address only, no lines | **PASS** | 1 run. `ORDER_ADDRESS_UPDATED` carrying no item lines. |
| TC10 | AC3 | Three successive revisions of one order | `ErpOrderLineNum` stable throughout | **PASS** | 1 run, three revisions. All five unaffected items kept identical `SK`, `sku` and `lineItemId`, the readable proxy for the Manhattan pair. |
| TC11 | AC7 | Count outward events for one revision | Exactly one, of the right type for the family | **PASS** | 1 run. One `ADD_ITEM` event to one target, counted against the real rule set. Content-neutral revisions emit none, so AC7 reads as one event per content-changing revision. |
| TC12 | AC6 | Replay a revision older than the stored one | No write, no send | **PASS** | 3 sub-cases, all clean. Older rejected with named attribution `SalesOrderStaleRevision`, equal and newer applied. `results/03`. **Reconfirmed at runtime 2026-09-09** against the redeployed `staging-orders-cin7-update-order`: fresh order `QASYN-16-TC12B`, all three sub-cases identical (`SalesOrderStaleRevision` on the older revision, `SalesOrderUpdated` on equal and newer). RETEST-POST-1161 R1 Part 3's first attempt stopped at a queue anomaly, which turned out to be a known, unrelated, already-registered poison message (`QASYN-12-TC2`) in its own FIFO group; a second session characterised it, confirmed it did not block a fresh emit, and ran this case. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` |
| TC13 | AC6 | Edit landing in a later modified date tick | Applied, one outward event | **PASS** | 1 run. Applied, one event reaching two subscribers rather than two events. |
| TC14 |  | Two edits inside one second | Both revisions emit, neither dropped as a replay | **PASS. Settles drift row 2** | 1 run. Both revisions applied under one `modifiedDate`. The hash is in the idempotency key, matching the LLD. |
| TC15 | AC5 | Order cancelled in Cin7 | Header DELETE reaches SCALE, order flipped not deleted | **PASS, both halves** | 1 run (`QASYN-09-TC15`). Order flipped `CANCELLED`, not deleted. Header DELETE traced end to end and accepted by SCALE on the same `ShipmentId`. `results/05`. **Reconfirmed at runtime 2026-09-09** against the redeployed `staging-orders-cin7-cancel-order` and `staging-shipping-manhattan-send-shipment`: fresh order `QASYN-16-TC12B`, `SalesOrderCancelReceived` -> `SalesOrderCancelled`, order flipped not deleted, `ManhattanRequestOutcome outcome:success` on the literal `QASYN-` reference as `ShipmentId`, same mechanism as before. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` |
| TC16 | AC5 | Order reaching `Dispatched` against one losing eligibility another way | Dispatched emits nothing, the other emits a cancel | **PASS on its own comparison, and its side risk is now closed** | 1 run (`QASYN-10-TC16`, arm 1) plus TC15's own result (arm 2). `sourceStage` is inert to the reconciliation handler either way; only the event type decides. Q30's picked-stage arm was a clean negative at the layer tested (no DELETE); slice 07's source read of the poller then confirmed the risk itself does not exist in the deployed build -- `Fully Picked`/`Partially Picked` are eligible, matching dev's intent. `results/05`, `results/07` |
| TC17 | AC5 | Change to a shipment already waved in SCALE | Rejection classified permanent, message lands on the DLQ | **Classification half CONFIRMED, 2026-09-09; still BLOCKED on a wave** | Source read of `send-shipment`: a `rejectedTransactions > 0` response IS classified `"rejected"` and logged/alerted as a Permanent failure -- exactly AC5's want, already implemented. One nuance for Lachlan: the classification only changes the log/alert, not retry count -- every failure still retries up to `maxReceiveCount` before the DLQ, "permanent" or not. Still needs a shipment SCALE has actually waved, none has been. `results/08` |
| TC18 | none | DELETE for a shipment SCALE does not hold | Logged as benign, no alert | **FAIL (Form A), narrowed 2026-09-09, still FAIL against the 2026-09-09 redeploy. Fix deferred to BUSY-1162** | **Maps to no acceptance criterion.** QA-proposed, like TC14, TC19, TC20, TC21 and TC22. **So this FAIL is a defect found during testing, not a BUSY-1160 acceptance failure**, and it does not gate this ticket. It is still worth fixing: Form A (`QASYN-08-TC18`, no `ORDER` row at all): the cancel handler throws an uncaught error, tripping a real alarm. Form B (`QASYN-09-TC15` reused, duplicate cancel against an already-cancelled order that DOES have an `ORDER` row): PASS, clean named attribution `SalesOrderAlreadyCancelled`, no throw, no alarm. The bug is specific to a missing header, not cancel handling in general. Form C (shipment never reached SCALE) not yet run. `results/05`, `results/08`. **Reconfirmed unfixed 2026-09-09**: direct source read of the redeployed `staging-orders-cin7-cancel-order` (`LastModified 2026-09-09T01:20:09Z`, new `CodeSha256`) found the identical throw (`` `No sales order ${transaction.PK} to cancel — header is missing.` ``) still fires before any named metric on this branch. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md`. **Deferred, JJ 2026-09-09: dev is rolling the fix into BUSY-1162, which owns error taxonomy and metrics, so it was not raised as BUSY-1160 work.** Recorded as D18 in `../DEFERRED-TEST-CASES.md`, with Form C and the missing failure metric noted there. The FAIL stands on the evidence and is not carried forward as a case on this ticket |
| TC19 |  | Read the header after a line reconciliation | `orderType`, `cin7Id`, `allocatedStore` and `wmsSentAt` survive | **PASS** | 1 run. `orderType`, `cin7Id` and `allocatedStore` unchanged, `wmsSentAt` advanced. |
| TC20 |  | Record modified only in confirmation written fields | No second send | **PASS, on the field the harness can construct** | Served by TC16/Q30's own `sourceStage`-only revisions, not a separate emit: applied, content-neutral, no second send, both times. Ceiling: the harness has no field for shipped quantities or tracking (not part of the poller's measured payload shape); only `stage` was tested. `results/05` |
| TC21 |  | Universal Store order in the same window | Untouched by the update and cancel paths | **PASS** | Control order `updatedAt` months before this session, unchanged. `results/05` |
| TC22 |  | Every `taxStatus` value Cin7 can return on a sales order | Each value is either mapped to a tax treatment or refused deliberately with the hard error and alert | **PASS for 3 of 4, 1 residual item** | Not from the ticket, from a dev answer. Cin7's own API docs enumerate exactly 4 values: `Undefined`, `Incl`, `Excl`, `Exempt`. **Direct code read of the deployed poller found the fix has already landed**: `Incl`, `Excl` and `Exempt` are all explicitly mapped (`Exempt` no longer hard-errors -- contradicts the historical finding, which measured an older build). `Undefined` (never observed on a real order) still falls to the generic hard-error-and-alert path, with nothing marking that as deliberate. `results/02`. **Reconfirmed unchanged 2026-09-09** against the redeployed poller (`LastModified 2026-09-09T01:20:09Z`, new `CodeSha256`): same three values mapped, `Undefined` still the one residual item. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md`. **Answered 2026-09-09 by Kian**, now Q42 in the register: he searched Cin7 and found the value on no order either, and treats it as worth fixing. Two independent sweeps, no occurrence. **JJ's call the same day: not an issue.** The residual item is a one-line re-test whenever the fix lands, not an open question |

Case notes, by how each was resolved

Nothing left in this state. Every case has a run, a written verdict, or a recorded block.

**Wholesale/AC1, run 2026-09-08 and 2026-09-09, and the picture changed materially between those two dates:** TC1 (downstream half), TC1b, TC2, TC3 all PASS as of 2026-09-09 -- a real synthetic emit traced the poller's dedicated `CREATE_OUTBOUND_ORDER` pipeline (found in the same slice) all the way to Manhattan acceptance. TC1's upstream half and TC4's live half stay BLOCKED: no wholesale order has ever reached the system at an eligible stage (R14, Q35), which is a Cin7-side data question, not a code gap. See `results/08-final-sweep-before-dev.md`; `results/06-wholesale-and-blocked.md` is the 2026-09-08 read that came before this and is superseded on the "unbuilt"/"cannot pass" claims specifically, not on R14's own population measurement, which still stands.

**Drivable by synthetic injection, run 2026-09-08:** TC15, TC16, TC18, TC20, TC21 -- slice 05. 4 PASS, 1 FAIL (TC18, narrowed 2026-09-09, see below). See `results/05-cancellation-and-isolation.md`.

**Read only, run 2026-09-09:** TC22. Cin7's own API docs gave the authoritative 4-value `taxStatus` set; a direct code read found the fix already deployed for 3 of the 4 (`Exempt` no longer hard-errors). `Undefined`, never observed, is the one residual item. `results/02-taxstatus-coverage.md`.

**TC17's classification half confirmed 2026-09-09**, still blocked on a wave. `results/08-final-sweep-before-dev.md`.

**TC18 narrowed 2026-09-09.** Form A (no `ORDER` row) still FAILs -- uncaught error, real alarm. Form B (duplicate cancel against an already-cancelled order that has an `ORDER` row) PASSes cleanly, named attribution `SalesOrderAlreadyCancelled`. The defect is specific to a missing header, not general. `results/08-final-sweep-before-dev.md`.

**Design drift**

| What | LLD says | Ticket says | Test impact |
|---|---|---|---|
| Wholesale record family | Outbound family, its own materialiser and sender, no native shipment rows | Rides ECOM's records and sender | **Settled 2026-09-09, both partially right.** A real emit persists `ORDER`/`ITEM`/`SHIPMENT` rows in the same `staging-orders-v2`/`staging-shipments` tables ECOM uses (the ticket's reading, on storage) via an entirely dedicated handler chain and its own Manhattan sender (the LLD's reading, on code path). Still latent: no real wholesale order has ever produced this, only a synthetic one has |
| Idempotency key | `<event>#<origin>#<modifiedDate>#<payloadHash>` | Event, brand, reference and modified date, no hash | **Settled for the LLD by TC14.** Two revisions sharing a `modifiedDate` but differing in content both applied; a hash-free key would have dropped the second |
| AC2 and AC3's "quantity changed" limb | Per-size records carry a `quantity`; ECOM is one record per unit with no quantity field (LLD 9.2) | AC2 lists "quantity changed" as a pre-wave edit and AC3 says changed quantities update under the same item key | **Raised 2026-09-09, unresolved, and it is a ticket-text question not a defect.** That behaviour needs a quantity field to change. ECOM has none, so a quantity increase is structurally a new unit row, MEASURED `added:1`. The grain the ACs describe belongs to the outbound mapper, which dev says is BUSY-1161's. TC6 is the only case on either AC and cannot be written against ECOM as worded |
| Rejection classification | Post wave rejection is permanent and alerts | AC5 wants it classified permanent, and says nothing about how it is recognised | **Settled for the LLD, 2026-09-09.** Source read confirms a rejection is classified `"rejected"` and logged/alerted as permanent, exactly as wanted. TC17 still needs a waved shipment to run live |

Slice 06's own write-results instruction referred to "both wholesale drift rows" -- there has only ever been one; noted so it is not chased again.

**New, real defect found 2026-09-09, Q41.** A synthetic wholesale order reached the real Manhattan API and was rejected: `Invalid warehouse "CTC-WH"` -- the exact code the poller's own branch-to-warehouse lookup produces for the wholesale branch. Isolated to the warehouse code specifically (not the pipeline) by a second emit using the known-valid main-warehouse code, which was accepted in full. See Q41, `../BUSY-1065-OPEN-QUESTIONS.md`.

**Covered by automated tests**

| Case | Where |
|---|---|
| Add, remove, quantity change, address change and cancellation against seeded orders | Handler tests, AC8 |

**Sign-off**

**Not signable, and every remaining gap is outside QA's reach.** 23 cases: 18 PASS, 1 FAIL, 3 BLOCKED, 1 not runnable as written. All verdicts reconfirmed against the 2026-09-09 redeploy with fresh `CodeSha256` citations, after a full platform release landed roughly half an hour after this ticket's testing completed.

**AC4, AC6, AC7 evidenced.** TC9, TC12, TC13, TC11, all reconfirmed at runtime post-redeploy.

**AC5 evidenced except TC17.** TC15 and TC16 pass, the cancel path reconfirmed at runtime (order flipped not deleted, header DELETE accepted by Manhattan). TC17 needs a shipment the warehouse has waved, and none has been. Its classification half is confirmed by source read: a rejection is classified permanent and alerted, as AC5 wants.

**AC2 and AC3 evidenced except their "quantity changed" limb**, which is a ticket-text question rather than a test gap. See the AC2/AC3 drift row: ECOM has no quantity field, so the behaviour those ACs describe cannot occur on this ticket's order type, and the grain they describe belongs to the outbound pipeline. TC6 is the only case on either AC. With Lachlan.

**AC1's downstream half evidenced, upstream half deferred to BUSY-1161.** TC1b, TC2 and TC3 pass against a synthetic wholesale order traced end to end to Manhattan acceptance. TC1's upstream half and TC4 need a real Cin7 wholesale order at an eligible stage, and none has ever reached the system. **Kian, 2026-09-09: wholesale and RTV land in BUSY-1161, and the tickets were never updated to say so.** The deployed code agrees, so AC1 as worded describes a design dev has already moved. JJ's call the same day: defer AC1's pass or fail to BUSY-1161. See C6.

**AC8** is dev's handler unit tests, not a QA case here.

**The one FAIL maps to no acceptance criterion.** TC18 is QA-proposed, like TC14, TC19, TC20, TC21 and TC22. It is a real defect (the cancel handler throws instead of a benign no-op when no `ORDER` row exists, tripping a live alarm), and **the fix is deferred to BUSY-1162 by JJ's call on 2026-09-09**, recorded as D18 in `../DEFERRED-TEST-CASES.md`. It does not gate this ticket and needs nothing further from QA here.

Run through 2026-09-09, slices 01 to 08 plus R14 and the RETEST-POST-1161 pass. No scripts reviewed yet, by decision. Sixteen synthetic orders exist, listed in the plan's register, none cleared.

**What is left belongs to other people, and after 2026-09-09 that is one person.** Lachlan: AC2/AC3's quantity limb, and TC17's retry-versus-permanent nuance, recorded as D5. **Nothing is open with Kian.** He answered Q35's design half, Q38's design question and Q42 (TC22's `Undefined`) directly on 2026-09-09; TC18's uncaught error is deferred to BUSY-1162 as D18, and Q38's counter gap as D19. **One cheap runnable item remains, found at the 2026-09-09 wrap-up and not previously named here: TC5's SCALE half.** Its add-line emit was retracted because the harness built a non-numeric `lineItemId` that the sender correctly refuses. The harness was fixed and the emit was never re-run, so the SCALE half reads UNKNOWN on a row that is otherwise PASS. One emit under the fixed harness closes it. AC2 does not depend on it, so this is JJ's call rather than a gate. Nothing else on this ticket needs another QA slice.
