# QA Doc - BUSY-1159

### BUSY-1159, Walking skeleton: ECOM order from Cin7 → Shipment in SCALE (staging)

**Relevant Documentation**

* [Task BUSY-1159](https://universalstore.atlassian.net/browse/BUSY-1159), status Review. Blocked by [BUSY-1158](https://universalstore.atlassian.net/browse/BUSY-1158) (Review) and [BUSY-1260](https://universalstore.atlassian.net/browse/BUSY-1260) (Review). Blocks [BUSY-1160](https://universalstore.atlassian.net/browse/BUSY-1160), [BUSY-1161](https://universalstore.atlassian.net/browse/BUSY-1161), [BUSY-1162](https://universalstore.atlassian.net/browse/BUSY-1162).
* [Epic BUSY-1065](https://universalstore.atlassian.net/browse/BUSY-1065), Cin7 Sales Order Integration.
* [LLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1802698758), source of truth. Where it and the ticket disagree, the difference is under Design drift.
* [HLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1631617025), business framing and volumes.
* [Connections](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1620148233), Manhattan endpoints and XML rules.
* Engineering QA handover draft, local HTML, built against PR #1568.
* [QA DOC - BUSY-1260](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1907458052), the purchase order flow sharing this stack. Gotchas carried over below.
* Re-test evidence for the current build, `BUSY-1065-sales-orders/RETEST-1158-1159/results/` (R11, R13). Every fresh-data verdict below is sourced there rather than from this plan's own `results/`.
* **Re-verified against the LLD on 2026-09-09**, clause by clause, with the LLD as source of truth. TC19 was re-dispositioned, TC2 was split, three cases were added from LLD clauses nothing covered, and drift rows were reframed and added. TC2b then resolved on 2026-09-10 from JJ's IDE session, and its artefact read produced two further drift rows. Each change says so in its own Notes cell. Nothing was re-run to produce them.

**Goal of Task**

Cheap Thrills Co. takes online orders in Cin7, but the Arundel warehouse picks and packs in Manhattan SCALE, which cannot see them. This task builds the pipe for the simplest case: a new online order raised in Cin7 turns into a real job the warehouse can work, within about three minutes, without anyone re-keying it. Only new online orders are in scope here. Changes, cancellations and the other order types follow on later tickets.

**Stakeholders**

Assignee james.johnston, reporter Lachlan.Paulsen.

**Overview**

The poller runs every 2 minutes at reserved concurrency 1 and pages `GET /v1/SalesOrders` filtered on `modifieddate`, `isApproved = true` and `branchId IN (51908, 51909)`. It resolves `memberId` to a Cin7 contact, maps the contact `group` to an order type, gates on `status = APPROVED` and `stage` in New, Processing, Fully Picked or Partially Picked (no ECOM order can reach either picked stage yet, see TC14 and Design drift), then emits one transaction per order carrying the full header and line set, FIFO grouped by the order key. ECOM rides the existing trickle down unchanged: order -> `order-created` -> shipment items -> shipment header. The sender builds ShippingDownload XML, treats `rejectedTransactions > 0` on an HTTP 200 as a failure, and stamps `wmsSentAt`. The watermark advances only after every page succeeds.

**Acceptance Criteria (from Jira AC checklist)**

Jira carries these as an unnumbered checkbox list. The AC numbers below exist only so the test table has something to point at, and will not survive an edit to the ticket.

* **AC1** An ECOM sales order created in Cin7 appears as a Shipment in SCALE staging within ~3 minutes, mapped per LLD §5 (`ShipmentId` = reference, item key = the Cin7 product option code, `AllocateComplete` = Y)
* **AC2** The poller emits exactly one order transaction per sales order, FIFO-grouped by the order key, with the full header and line set
* **AC3** An absent order yields a create and a present one an update, test-asserted with the orders table seeded to drive the existence read
* **AC4** Order items and shipment items are one per line carrying a quantity, not one per unit; a quantity-less UNI order is unaffected
* **AC5** Ineligible orders are skipped: unknown source (counted in a metric), dispatched, completed, draft
* **AC6** Watermark advances only on success; a watermark reset re-poll produces no duplicate records or sends
* **AC7** Header records carry `company`, `orderType`, `cin7Id` and `allocatedStore`; `wmsSentAt` is set after a successful send; reallocation is not triggered
* **AC8** An HTTP 200 carrying `rejectedTransactions > 0` is treated as a send failure and throws for redrive
* **AC9** Poller handler test (create path) and sender test (mapping plus alphabetical ordering)

### Scope for this QA pass

**Covered here:** the create path end to end on staging against real Cin7 production orders, driven by watermark moves and one live scheduled cycle. Order, item and shipment shape on our side, the CTC stamps, the skip and count gates, replay and second-sighting suppression, and isolation from Universal Store traffic. The failure path when SCALE rejects a line passed on the pre-deploy build only and is not re-runnable, see TC9 and TC15. The SCALE side of the mapping is verified by eye in the UI, since nothing reads a shipment back by id.

**Out of scope**

* The `taxStatus` mapping. Dev is checking the Cin7 value list and wrapping the fix into BUSY-1160, so the coverage case belongs there. Three real orders were refused at the poller during this pass, recorded in the epic open questions register.
* Updates, wholesale mapping, line reconciliation and cancellation. Owned by BUSY-1160, in progress.
* RTV and STORE_PICK order types. Owned by BUSY-1161 and BUSY-1219.
* Alert routing and the error taxonomy. Owned by BUSY-1162, not built. Both alert topics have zero subscribers, so do not raise that as a defect here.
* Consumer guards on the existing order and shipment consumers. Owned by BUSY-1158 and covered by its TC4 to TC6. The sweep ran from this ticket's slice 03 because that is where the live order was, and its evidence is carried into that doc.
* Production SCALE. The endpoint is not published and is supplied at cutover.
* Proving the poller checks the `PutEvents` response. Deferred to BUSY-1162 with the rest of the alerting and resilience work, see TC22 and `DEFERRED-TEST-CASES.md` D1. The retrospective half was done here and found no occurrence.

**Services**

| Component | Resource Name | Type |
|---|---|---|
| Sales order poller | `staging-orders-cin7-so-poller` | Lambda |
| Poller schedule | `staging-orders-cin7-so-poller-rule` | EventBridge rule |
| Poller watermark | `/staging/orders/cin7-so-watermark` | SSM parameter |
| Cin7 credentials | `staging/orders/cin7` | Secret |
| Orders table | `staging-orders-v2` | DynamoDB |
| Shipments table | `staging-shipments` | DynamoDB |
| Orders event bus | `staging-orders-v2-event-bus` | EventBridge bus |
| Shipping event bus | `staging-shipping-v2-event-bus` | EventBridge bus |
| Shipment sender | `staging-shipping-manhattan-send-shipment` | Lambda |
| Sender queue | `staging-shipping-manhattan-sender.fifo` | SQS FIFO |
| Sender dead letter queue | `staging-shipping-manhattan-sender-dlq.fifo` | SQS FIFO, 20 attempts |
| Feed alerts | `staging-orders-cin7-alerts` | SNS, no subscribers |
| Send alerts | `staging-shipping-manhattan-alert-topic` | SNS, no subscribers |
| Feed alarms and dashboard | `staging-orders-cin7-dashboard` | CloudWatch |

**Blockers For Testing**

* The sender never logs its outbound XML, only the SCALE response, so no mapping check completes from logs. TC1a is the only route to the mandatory field set, `CommentType` values and element ordering.
* The CTC item master in SCALE staging is incomplete. **Two option codes are confirmed absent** (`TH25-318B-28`, `WPR25-104A-10`) and four references were stuck in the reject-and-retry loop; on two of those, slice 02 recorded the reference only and never captured the missing code, so the cause is inferred from an identical retry signature. Go live is gated on the master being loaded.
* No rejection has occurred since the current build deployed and the sender dead letter queue is empty, so TC9 and TC15 have no fixture to re-run against and neither can be manufactured. Both are recorded UNTESTABLE and handed to E2E.
* No script in the plan folder has been reviewed by a second person. TC1, TC1b, TC3, TC4, TC18 and TC21b each rest on one, so a pass proves the script ran as much as it proves the system behaved.

**Edge Cases / Gotchas**

* Cin7 is CTC's live production system with no sandbox. Every condition is found in real traffic, never created. Nothing can be approved, edited or voided to make a case.
* A reference longer than 25 characters is a hard error at the poller, so the order never reaches the queue. Nothing lands on the DLQ to find.
* The watermark script defaults to the item master poller. Every sales order call needs the sales order flag, and the wrong flag rewinds the item master feed.
* The orders to shipping queue deduplicates on content over a 5 minute window, so an identical replay inside that window is dropped silently and looks like a lost message.
* Dynamoose `saveUnknown` is false, so an undeclared attribute is dropped on save with no error. Every new CTC field is a candidate.
* Real ECOM shipments reached SCALE staging before QA started, so no send in this pass is the first send. The mandatory field set is still unestablished.
* The real Lambda timeout marker is `Status: timeout`. The `REPORT.*Task timed out` pattern returns nothing on this runtime. Carried over from BUSY-1260.
* A rejected shipment retries for roughly 8.3 hours before it dead letters, so a rejection looks like silence for most of a day.
* An unrecognised Cin7 `taxStatus` is a second hard-error trigger, separate from the reference length one: an `Exempt` order refuses to build and alerts rather than guessing a tax treatment. Found live, not manufactured, on 3 real orders. Whether `Exempt` should be a mapped, sendable status is an open question for dev, not raised as a defect here.
* On a wide watermark window, `aws lambda invoke` can outlast the CLI's own patience and report a client-side throttling error while the real invocation is still running and completes normally minutes later. A QA-tooling trap, not a system behaviour, see the plan's TOOL-NOTES.
* The poller fetches from the watermark minus 5 minutes, so any test window is 5 minutes wider than the watermark set. MEASURED twice from the poller's own log line on scheduled cycles. **Not a defect and not asserted as correct either, see Design drift**: the LLD describes no lookback.
* Cin7's `modifiedDate` is mutable current state, not history, so a past window cannot be reconstructed by a later GET. Any reconciliation of an earlier cycle's order set is foreclosed, including cycles only days old.
* Measuring latency from the Cin7 `modifiedDate` reads as a false breach of the 3 minute target, because orders dwell while the schedule is disabled. Measure from cycle complete to `wmsSentAt`, as TC1b does.
* The poller's cycle counters have never balanced. Worst case 718 fetched against 319 accounted for, and one fresh cycle read 56 fetched, 20 summed, 36 unaccounted, all 36 traced to 43 confirmed wholesale orders at `Dispatched` that produced no counter and no log line, while 4 wholesale orders at `Approved` were counted correctly. A missing skip counter is not evidence an order was handled. Q38.
* The poller logs full customer name, email and address in the clear on every order it creates, as do the faulty sale worker and the dc packing consumers. Read `CTC-customer-data-in-cloudwatch.md` before pulling raw log output.

**Actual Tests**

Black box against staging, driven only by watermark resets so the real schedule does the work. Direct invocation is diagnosis only and invalidates TC1 and TC11.

```
Cin7 production sales orders (branches 51908, 51909)
        |
        v
  SO POLLER, every 2 minutes, watermark in SSM
   eligibility gate, skip and count            [TC5, TC14]
   one transaction per order, FIFO by key      [TC8, TC16]
   watermark advances only on success          [TC3]
   replay suppression and the echo guard       [TC21, TC21b]
   second sighting of an edited order          [TC4]
   watermark holds on a failed emit             [TC22]
        |
        v
  ORDER HANDLER, then the native trickle down
   order, items and shipment header stamped    [TC2, TC13]
   reallocation not triggered                  [TC2b]
   every existing consumer holds off CTC       [BUSY-1158]
   Universal Store traffic untouched           [TC7, TC11]
        |
        v
  SHIPMENT SENDER, ShippingDownload XML
   grain and aggregation                       [TC6, TC6b, TC6c, TC6d]
   ship to truncation, packing brand           [TC10, TC18]
   FIFO group on the Manhattan queue           [TC16b]
   rejection is a failure, then the DLQ        [TC9, TC15]
        |
        v
  MANHATTAN SCALE STAGING
   shipment visible, wmsSentAt stamped         [TC1, TC1b, TC1a]
   feed alarms and alert routing               [TC20]
   volume and size ceilings                    [TC17, TC19]
```

| TC | AC | Test | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| TC1 | AC1 | Pull a live ECOM order through the schedule | Shipment reaches SCALE, `wmsSentAt` stamped | PASS | 9 fresh orders through one live cycle, all present in SCALE |
| TC1b | AC1 | Measure cycle complete to `wmsSentAt` | Inside the 3 minute target | PASS | 35.2 to 47.8 seconds across 9 fresh orders |
| TC1a | AC1 | Read the shipment header and lines in the SCALE UI | Mapping matches LLD §5 | PASS | `261115` and `261111`. `ShipmentId`, `ErpOrder`, `Company`, `Warehouse`, `OrderType`, `AllocateComplete`, `ConsolidationAllowed`, `Priority`, `UserDef3`, the ship to pair and the line grain all match. `Carrier` is not sent, see Design drift. `OrderDate`, `ErpOrderLineNum` and `CustomerPO` were not found on the screens opened, four orders across three screens, so read that as not found rather than not present. Not re-read on the current build. See `results/12-scale-ui-manual-reads.md` |
| TC2 | AC7 | Read order, items and shipment header after a create | CTC stamps present | PASS | MEASURED, no stamp missing on readback. The reallocation half was split out to TC2b on 2026-09-09, because it turned out not to be a caveat on a pass |
| TC2b | AC7 | Check whether shipment item creation triggers reallocation for a CTC ECOM order | No `REALLOCATION` transaction in the order's partition | PASS | MEASURED both ways, 2026-09-10, `results/17-tc2b-reallocation.md`. **Read:** all nine R13 references carry exactly one `TRANSACTION#` row each, every one `CREATE_ORDER`, no `REALLOCATION#` idempotencyId on any of them. The read was baselined on `262208` first so an empty partition could not be misread as an absence. **Artefact:** the deployed `staging-shipping-v2-create-shipment-items` (2026-09-09, function name resolved from `list-functions`, not guessed) branches four ways, and the `REALLOCATION` emit sits only in the trailing `else`. `isCTCOriginKey` tests `origin.startsWith("CTC#")`, so a CTC order routes to `attachItemsToOpenShipment` or `createCtcShipment` and structurally cannot reach that emit. Was carried inside TC2 as an INFERRED absence from the wrong log groups; a source read on 2026-09-09 showed the pre-CTC file had no guard at all, which is what made this worth measuring rather than assuming. **Ceiling:** proves the guard holds now, for these nine, not that `origin` is always correct upstream nor that the guard existed earlier in the ticket |
| TC8 | AC2 | Count rows written for one reference | One order row, one transaction row, one header | PASS | 9 fresh orders, row counts match the line counts |
| TC3 | AC6 | Reset the watermark behind an order already sent | Nothing written, nothing re-sent | PASS | `wmsSentAt` unchanged |
| TC4 | AC3 | Second sighting of an order edited in Cin7 | No update reaches SCALE | PASS | Cin7 `modifiedDate` moved, shipment untouched |
| TC13 |  | Read `lastEmittedPayloadHash` on the stored order row | Present, matching the emitted payload | PASS | 2 fresh orders, one create and one echo. The value matches the emitted payload exactly and the echo leaves it unchanged. Measured absent before the current build, so this reverses the earlier finding. The withdrawal recorded as D17 no longer applies |
| TC5 | AC5 | Poll a window holding POS, wholesale and dispatched orders | No order rows, skip counters move | PASS | 4 references, all absent |
| TC14 | AC5 | Poll an order in `Fully Picked` or `Partially Picked` | Order is treated as eligible and sent | DEFERRED | Not testable by QA, handed to dev for a dev-environment test, and likely to pass. The LLD makes both picked stages eligible because the confirmation leg writes them into Cin7 on first pick, and that leg does not exist, so no ECOM order can reach either stage. They are the only two stages never observed on an ECOM order, across five independent checks and a 1000 order population cross tab. See `results/14-ecom-picked-stage-population.md` |
| TC6 | AC4 | Order carrying the same option twice | Two per unit rows on our side, one aggregated line in SCALE | PASS | `WOR19261`, 1 run, both halves. 2 shipment item rows, same sku, same `lineItemId`, neither carrying `quantity`; SCALE holds one line, Total Qty 2, UM `EA`. Proven only on a pre-deploy fixture: no fresh repeated-option-code order has appeared, so it is not proven under the current code. `ErpOrderLineNum` is not readable in the UI, so the line identity pair was never observed, see D8 |
| TC6b | AC4 | Order carrying a multi-size style, one `lineItems[]` entry with two or more `sizes[]` | Rows with different skus sharing one `lineItemId`; one SCALE detail line per size | UNTESTABLE | **No fixture exists in the population.** MEASURED 2026-09-10, `results/18-unrun-cases.md`: full scans of both tables found **zero** multi-size styles across **100 ECOM orders**, 233 `(order, lineItemId)` groups in `staging-orders-v2` and 226 in `staging-shipments`, and the largest distinct-sku count in any group is **1**. Not a failure: it is the same disposition as TC9, with a population number attached. **INFERRED, and it changes who owns this case:** a multi-size style is a bulk shape. A Shopify-originated ECOM order creates one Cin7 line per variant purchased, so one size per style line, while a size run under one style line is how a wholesale order is written. If that holds, this is **BUSY-1161's case rather than E2E's**, the same way TC19's breach turned out to be a wholesale condition. **Not asserted:** 100 orders is a population observation, not a structural proof, and the Cin7-side confirmation is JJ's. The per-unit half of the case is separately MEASURED from source, see TC6c's mechanism read: nonzero sizes push `Math.round(qty)` rows each carrying `lineItemId`. SCALE half stays UNKNOWN and with E2E, since `ErpOrderLineNum` is not readable in the UI (D8) |
| TC6c | AC4 | Order carrying a `sizes[]` entry at `qty: 0` | No order item and no `ShipmentDetail` for it; skip counted, not alerted | PASS | **On the measured mechanism. JJ's call 2026-09-10 to close it without the Cin7 reconciliation.** `results/18-unrun-cases.md`. **Mechanism, from the deployed `staging-orders-cin7-so-poller` artefact:** `expandLineItems` does `if (unit.qty === 0) { skippedZeroQtyCount += 1; continue; }`, matching all three of LLD §5's claims at once, no row produced, counted, and not alerted, the last confirmed by contrast with the sibling `qty < 0` branch which does `console.warn`. **Counter:** `skippedZeroQty` has fired non-zero twice on cycles already on record, `3` in `results/07-failure-handling.md` and `1` in `results/11-picked-stage-eligibility.md`, so this rests on a positive reading and not on an absent row. **Not measured, and stated here rather than left implicit: the reconciliation half.** That the remaining lines still total correctly, and that nothing beyond the zero-quantity sizes was dropped, needs the Cin7 line totals and was not performed. **For E2E:** the named check is `261110`, `261111` and `261113` against the cycle that recorded `skippedZeroQty:3`, stored counts 3, 4 and 2, where the shortfalls should total exactly 3. Any shortfall not attributable to a `qty: 0` entry would be a lost row |
| TC6d | AC4 | Order carrying a `lineItems[]` entry with an empty `sizes[]` array | Per LLD §5 the line falls back to `lineItems[].code` and `lineItems[].qty` and still produces a row and a `ShipmentDetail` | PASS | **On no evidence of loss, not on the build matching the LLD. JJ's call 2026-09-10.** Read this row in full before citing it. `results/18-unrun-cases.md`, `results/19-empty-sizes-fallback.md`. **The build does not implement the specified behaviour, and that is MEASURED, not open:** `expandLineItems` opens `const sizes = lineItem.sizes ?? []; if (!sizes.length) { skippedNoSizesCount += 1; continue; }`, with no fallback on that branch, so such a line produces no order item and therefore no `ShipmentDetail`. The LLD specifies the fallback in five places, including §11.1's own poller test. **Carried as correction C10** so the divergence survives this PASS. **What the PASS rests on:** `skippedNoSizes` read **0 on all 8 cycles that carry it**, `2026-09-04T01:33:31Z` to `2026-09-07T06:32:38Z`. The counter shipped in the 2026-09-03 deploy; the other 576 cycles swept genuinely predate it, spot-checked against one cycle's raw JSON rather than assumed. Log retention is unlimited, so the window is bounded by poller activity. **The honest bound: about 3 days of poller activity, not weeks**, because the schedule has been disabled since 2026-09-07. **Not measured:** whether Cin7 ever produces an empty `sizes[]` on a CTC order. **Running more cycles could not have answered that**, since occurrence depends on Cin7 line shape and not on cycle count. **For E2E, and this is the residual risk:** if the shape does occur, the line is lost **silently**. The counter increments, nothing alerts, and LLD §7's divergence check cannot see it, because the order and the shipment record are both still created with matching `lastModified`. A shipment short a line, with neither system flagging it |
| TC10 | | Worship branded order | `packingBrand` set, `packingBrandMisses` zero, `UserDef3` carries the brand | PASS | `WOR19169A`, a fresh Worship order, both halves. SCALE `User Defined Field 3` = `WORSHIP`. The brand map resolves on both `projectName` spellings, so `packingBrandMisses` reading zero is trustworthy. No Worship order sat in the latest cycle's window, so it was not re-run there; that is not a failure |
| TC18 | | Ship to name longer than 25 characters | Truncation logged, shipment accepted, full value kept | PASS | `261106`, 29 to 25, both halves. SCALE `ShipTo` is exactly 25 characters and `ShipToAddress` `Name` carries the full 29 untruncated |
| TC7 | AC4 | Universal Store order in the same window | No CTC stamp, no entry to the CTC path | PASS | 5 found, all NEWSTORE, none reach the shipments table. A wider scan under BUSY-1158 found ~14,000 warehouse fulfilled ones, so this was a narrow search, not an absence |
| TC11 | | Watch the shipping bus during a CTC send | No UNI reference reaches the CTC sender | PASS | All queue and dead letter depths 0 either side of 2 fresh cycles |
| TC16 | AC2 | Read `MessageGroupId` on live **transaction** queue messages | Group is the order key | PASS | All 9 fresh orders, group equals the order id. **Scope note added 2026-09-09:** this is the transaction hop, which LLD §3 says is safe by construction, "transactions are safe (the writer re-emits with `message_group_id` = PK)". The hop §3 and §10.2 actually flag is the native domain events reaching the Manhattan sender queue through the populator. That is TC16b |
| TC16b | AC2 | Read `MessageGroupId` for native domain events reaching the Manhattan sender queue | Every group is the order PK, none is the literal string `undefined` | PASS | MEASURED, both claims separately, 2026-09-10, `results/18-unrun-cases.md`. **Claim A, the populator fallback is fixed.** LLD §3 warns the fallback "stringifies `undefined` into a truthy `undefined`, so every event lacking a `message_group_id` lands in one global FIFO group". The deployed `staging-shipping-manhattan-manhattan-eda-queue-populator` builds `` `${detailType}_${event.detail.id}` `` instead, which is distinct per event. The consumer and the populator were each resolved from AWS (`list-event-source-mappings` by queue ARN, then the populator's own `QUEUE_NAME` env), not from naming symmetry, because three sessions on this epic have already misread this queue's consumer. **Claim B, native events carry the group.** All nine R13 references produced one `SHIPMENT_CREATED` event each and every one carried `message_group_id` equal to that order's own PK. **Read from the populator's own log line, never from the queue:** `MessageGroupId` is only returned by `ReceiveMessage`, which increments `ApproximateReceiveCount`, and on this queue that would have corrupted slice 16 S3's evidence and could have dead-lettered a live message early. **One loose end:** `262223`'s PK from the populator log differs from the same reference's PK resolved via `origin_index`. Eight of nine matched. Worth one check |
| TC9 | AC8 | Order whose option code is absent from the SCALE item master | Rejection classified **permanent** per LLD §6: no `wmsSentAt`, parked and alerted with flow, company and `ShipmentId`, **without 20 transient redeliveries** | UNTESTABLE | **Expected result rewritten 2026-09-09 against LLD §6 and §11.5**, both of which put a `rejectedTransactions > 0` on HTTP 200 on the permanent-failure path, where §6's permanent bucket is "DLQ + SNS alert" and only the transient bucket is where "SQS redrives each hop". The old wording asked only that the message park on the DLQ, and the pre-deploy pass met it at receive count 21, which is the transient path. **That is BUSY-1160's D5 reached from the other side** (classified permanent and alerted, but the caller rethrows on every branch so it redelivers 20 times anyway); cited here rather than logged twice. Independently, §6's permanent bucket requires an alert naming flow, company and `ShipmentId`, and TC20 measured both SNS topics at zero subscribers, so the permanent contract cannot be satisfied in staging whatever the retry count does. On the original wording: passed on the pre-deploy build (`261073`, receive count 21 against a limit of 20) and cannot be re-run on the current one. No dead letter fixture exists, no rejection has occurred since the deploy, and one cannot be manufactured because Cin7 is read only for everyone. A fixture on the dev stack would not answer a staging question. Handed to E2E |
| TC15 | | Cycle containing one hard error order | Valid orders in the same cycle still send | UNTESTABLE | Passed on the pre-deploy build (3 sent, watermark advanced once) and cannot be re-run on the current one, for the same reason as TC9. Handed to E2E |
| TC20 | | Read feed alarms and alert topic subscriptions | Alarms exist, subscriber counts recorded | PASS | Both topics zero. An alarm fired this pass and reached nobody |
| TC21 | AC6 | Re-poll an unchanged order outside the 5 minute dedupe window | No second transaction row, no second send | PASS | 2 orders on a real second sighting, no duplicate rows, no second send |
| TC21b | AC6 | Read the counters and transaction rows on that re-poll | The guard that suppressed it is named | INCONCLUSIVE | Suppression works and is now visible in the aggregate `echoSkipped` counter, which fired 2 against the 2 re-swept orders and did not exist before the current build. No per-order log line names the guard, which is what this case asked for. Reconfirmed on fresh data. For BUSY-1162 and the confirmation epic |
| TC22 | AC6 | Make one `PutEvents` entry fail while the call still returns HTTP 200 | Watermark holds, the order is retried next cycle | DEFERRED | Deferred to BUSY-1162, recorded as D1 in `DEFERRED-TEST-CASES.md`. The read only half ran first: one entry per call across all 70 real calls in retained history, and 70 of 70 idempotencyIds the poller pushed were received at the queue populator, so the risk is latent rather than realised. Whether the code checks the response is unproven and needs a forced config change on the dev stack. Note for that ticket: a failed entry never reaches the bus, so nothing lands in a dead letter queue |
| TC17 | | Widen a watermark reset until the poller times out | Ceiling recorded | PASS | No failure at 6 hours, 24 hours or 3 days: 29s, 92s, 137s against a 5 minute limit. Ceiling not reached. INFERRED near 190 to 200 requests per cycle at 1.5s each |
| TC19 | | Order above the 256 KB event size limit | Routed to the error path with an alert, never split or truncated | PASS | **Routing half deferred, see below. Re-dispositioned 2026-09-09 from BLOCKED, which implied the case was waiting on something it was not.** The limit is named in LLD §4 step 6 and §6 as **256 KB**, the EventBridge entry cap, with the 400 KB DynamoDB item cap second because §9.2 persists the item array inline. Headroom is already measured in §10.2: the largest real order in the book is **83 size rows, about 7% of the cap**, against 6,634 units which would be 5.4x over. INFERRED-from-design, not measured here. **The breach §6 describes is a wholesale condition**, "not unreachable on a large multi-size wholesale order", and ECOM is per-unit at a handful of units per order, so it is not an ECOM risk and `oversized:0` across 718 orders is the expected reading rather than a blocked one. **The routing half is deferred to BUSY-1161**, where wholesale lives: a counter reading zero does not evidence that an oversized order is routed to the error path rather than split or dropped, and §11.1 names "oversize routing" as a poller unit test. §6 also requires an alert on that route, and TC20 measured both topics at zero subscribers |

`PASS / INCONCLUSIVE / UNTESTABLE / DEFERRED`

**No case is `PROPOSED` any more.** The four added from the LLD on 2026-09-09 and 2026-09-10 (TC6b,
TC6c, TC6d, TC16b) have all since been attempted, so that status is retired rather than left in the
legend unused. **This does not mean every case ran:** TC9 and TC15 are UNTESTABLE on this build, and
TC14 and TC22 are DEFERRED to a dev environment and to BUSY-1162.

**No case is `BLOCKED` either.** TC19 was the only one and it was re-dispositioned on 2026-09-09,
because BLOCKED implied it was waiting on something and it was not.

All four manual SCALE UI reads are done and none is outstanding. They are in **Order Planning > Planned Shipment Insights**, searched on `ShipmentId`, which is the Cin7 reference unchanged. Not Shipping Insights: that screen lists post-wave shipments only and holds none of ours, since a downloaded shipment rests at `In Pool` until the DC waves it.

**Design drift**

| What | LLD says | Ticket says | Test impact |
|---|---|---|---|
| ECOM item grain | One row per unit, no `quantity` field | AC4: one per line carrying a quantity | Settled by TC6, rows are per unit. AC4 is wrong as worded |
| Order type source | Contact `group`, an unmapped group is a permanent error and alerts | The `source` field, unknown values skipped and counted | Settled by TC5, skips land in the order type bucket. The alert path is untested |
| Cancellation trigger | Inferred from loss of eligibility, `isVoid` does not drive it | Cancel when voided | Not tested here, cancellation is BUSY-1160 |
| Eligibility gate, picked stages | Gates on `stage` in New, Processing, Fully Picked or Partially Picked | Silent | Both picked stages are eligible only because the confirmation leg writes them back into Cin7 on first pick, and that leg is unbuilt, so no ECOM order can reach either stage. TC14 is deferred to a dev environment test rather than blocked. Q31 |
| `Carrier` on ECOM | Per type matrix sends `Carrier` from `logisticsCarrier` on ECOM, WHOLESALE and RTV | Silent | Not sent, and deliberate. Cin7 holds a carrier, our order row holds `UNASSIGNED`, SCALE holds nothing. Carrier is expected to be chosen at pick and to flow back to us, so the LLD's matrix is the document out of step. No written source for the decision yet. Deferred as D16 |
| XML element order | Connections page says alphabetical, XSD declares a sequence, and §5 resolves it: "the Connections page ... takes precedence for the build; **if SCALE returns a schema-validation message on the first send, the builder switches to the schema's declared order**" | AC9 asserts alphabetical | **Not drift, corrected 2026-09-09.** SCALE rejected alphabetical and the build switched to the XSD sequence, which is exactly the fallback §5 prescribed and §10.2 repeats, "the build follows Manhattan's documented alphabetical rule and the first staging send settles it. The rule is isolated in `libs/manhattan`, so switching is a one-line change". The build obeyed the LLD. AC9 is stale, which is the only live half of this row |
| Replay suppression mechanism | AC6 and the LLD's risk table imply the payload hash echo guard is what stops a duplicate send | The named `lastEmittedPayloadHash` attribute is never persisted | Settled. The attribute is persisted on the current build and matches the emitted payload (TC13), and a second sighting is suppressed and counted (TC21, TC21b). No log line names the guard, so the mechanism itself is still not directly observable |
| `create-shipment-items` was modified for CTC | Three clauses say it would not be. §3: the native-family consumers "materialise CTC **ECOM** orders exactly as they do UNI orders. **No change is required to any of them**". §9.3: "**ECOM rides the existing trickle-down unchanged** ... No CTC-specific emission path, and no change to those handlers", with the fallout line "**zero new code on the native path**". §11.3: "**assert that `create-shipment-items` is unmodified**" | Silent | **The deployed file carries a CTC-specific path.** MEASURED 2026-09-10 on the 2026-09-09 build: `isCTCOriginKey`, `existingCtcShipment`, `createCtcShipment` and `attachItemsToOpenShipment`, in a four-way branch. The pre-CTC version of the same file, read from a 2026-02-12 checkout, had two branches and no guard. **The modification is what makes TC2b pass**: it is the guard that keeps a CTC order out of the `REALLOCATION` emit, which §3 and §9.2 both require. So the build is right and the LLD's approach statement is what is out of date, not the code. §11.3's two clauses cannot both hold and the "unmodified" one is the wrong one. Raised as C7. **Two consequences beyond the wording**, both flagged not tested: §11.3's other half, "a CTC order and a UNI order of the same size produce structurally identical item records", is no longer obviously true now that CTC items take `createCtcShipment` and `attachItemsToOpenShipment` rather than the UNI route, and nothing has tested it; and `attachItemsToOpenShipment` describes attaching items to an already-open shipment, a native-path behaviour the LLD does not describe at all |
| Empty `sizes[]` is skipped, not fallen back to | §5 specifies the fallback in four places, including the line-grain prose "Where `sizes[]` is empty the style is a single-size item and `lineItems[].code` and `lineItems[].qty` are used directly", plus §11.1's poller test "an empty `sizes[]` falls back to the line's own `code`/`qty`" | Silent | **The deployed poller skips the line and counts it.** MEASURED 2026-09-10. Unlike C7, there is no sign the LLD is the stale document here: nobody has said the fallback was dropped on purpose, and the consequence if the input occurs is a **silently lost line**, since the counter increments, nothing alerts (the sibling `qty < 0` branch does `console.warn`, this one does not), and **§7's divergence check cannot see it** because the order and the shipment record are both still created with matching `lastModified`. §7 calls that check "the primary health signal" and "the only signal that catches stalls no DLQ sees". Not yet observed to cost a line, on about 3 days of poller activity. **JJ's call 2026-09-10: not escalated. TC6d passes on no evidence of loss, and the divergence stays here as correction C10 rather than becoming a defect.** So this row, not TC6d's verdict, is the record that the build and the LLD disagree. Never cite TC6d's PASS as the build conforming. The unmeasured part is whether Cin7 produces the shape at all, and **no counter-based route could have settled it**, since occurrence depends on Cin7 line shape rather than on cycle count |
| Consumer guards key on `origin`, not `company` | §9.2: "the three header fields are added to the shipment schema; **`company` is what every consumer guard keys on**". §3's dc-packing row: "also replaces the `brand`-based company inference with the explicit `company` field" | Silent | The guard measured on 2026-09-10 keys on the **`origin` prefix** (`CTC#`) via `isCTCOriginKey`, not on `company`. Both reach the same outcome here, so this is not a defect. It matters for **BUSY-1158's consumer-guard audit (its TC4 to TC6)**: a sweep searching deployed artefacts for a `company` guard would miss an origin-prefix guard and could report a consumer as unguarded when it is guarded. Carried to that ticket as a search-term note rather than a finding here |
| The 5 minute watermark lookback | §4 step 2 and §9.1 describe the filter as `modifieddate` since the watermark, and §9.1 adds "**never a 'now - N minutes' window** (a requirement of both HLDs)". No lookback of any kind is described | Silent | The poller fetches from the watermark minus 5 minutes, MEASURED twice. Not contradicted, since §10.2 says "replay is idempotent end to end, so **overlap is preferred to precision**", and a watermark lookback is not a now-minus-N window. But it is **undocumented**, so this doc previously calling it "correct behaviour" asserted a licence the LLD does not give. Needs an LLD addition rather than a defect. Raised 2026-09-09 |
| Where a WHOLESALE order goes | An `OUTBOUND_SHIPMENT` family in the shipments table, built by BUSY-1161 | BUSY-1160 has wholesale riding the native records and the same sender; BUSY-1161 scopes the outbound family to RTV only | Nothing holds a wholesale order anywhere today: the outbound family is not deployed and the native tables hold none. Out of scope here, but it decides what BUSY-1160 tests. Q35 |

**Covered by automated tests**

Scoped to what AC9 asserts. **LLD §11 names six test groups plus a UAT list**, so this table is not the
LLD's full expectation and should not be read as it at handover. §11.3 (native trickle-down, which
carries the reallocation assertion behind TC2b) and §11.6 (a consumer-guard regression per consumer)
are the two groups this pass has a live question against.

| Case | Where |
|---|---|
| Absent order creates, present order updates, against a seeded table | Poller handler test, AC3 and AC9 |
| Sender mapping and element ordering | Sender test, AC9 |

**Sign-off**

**Signed off with limits, 2026-09-10.** 29 cases: **23 PASS, 1 INCONCLUSIVE, 3 UNTESTABLE, 2 DEFERRED.
No FAIL, nothing BLOCKED.** Re-derived from the table, not edited from the previous wording.

The create path is proven on fresh data on the current build: nine real ECOM orders through one live
scheduled cycle, all present in SCALE, `wmsSentAt` stamped, 35 to 48 seconds against a 3 minute
target. The CTC stamps, the skip and count gates, replay and
second-sighting suppression, brand and truncation, and isolation from Universal Store traffic are all
measured on that build, as is the per-unit item grain. **Item shape is measured for the shapes real
traffic produced, not for every shape the LLD describes:** the empty-`sizes[]` fallback was never
exercised (TC6d, C10) and no multi-size style exists in the population to exercise (TC6b).

**Two cases were closed on JJ's call rather than on complete evidence, and both rows say so.** TC6c
passes on its measured mechanism without the Cin7 reconciliation. TC6d passes on no evidence of loss,
**not** on the build matching the LLD, and the divergence behind it is carried as correction **C10**.
Neither should be cited as more than that.

### For the E2E testers: what QA could not reach, and what to watch

**1. Nothing here proves a SCALE rejection is handled.** TC9 and TC15 passed on the pre-deploy build
and cannot be re-run: no rejection has occurred since, the sender DLQ has no fixture, and one cannot
be manufactured because Cin7 is read only for everyone. **LLD §6 requires a rejection to be treated
as a permanent failure**, alerted with flow, company and `ShipmentId`. The pre-deploy behaviour
instead redelivered 20 times over roughly 8.3 hours before parking, which is §6's transient path. That
is BUSY-1160's **D5** and it is unresolved. Expect a rejection to look like silence for most of a day.

**2. Both alert topics have zero subscribers.** Every alerting clause in LLD §6 is unsatisfiable in
staging regardless of what the code does. An alarm fired during this pass and reached nobody. Do not
read a missing alert as a passing test.

**3. One silent-loss path is open, and §7's health check cannot see it.** TC6d: a line whose `sizes[]`
array is empty is skipped rather than falling back to the line's own code and quantity. The counter
increments, nothing alerts, and the divergence check compares `lastModified` between the order and the
shipment record, both of which are still written. **A shipment short a line, with neither system
flagging it.** Not observed in about 3 days of poller activity. Whether Cin7 produces the shape at all
is unmeasured.

**4. The SCALE side of the mapping was verified by eye, once, in the UI.** Nothing reads a shipment
back by id and the sender never logs its outbound XML, so TC1a is the only route to the mandatory
field set, `CommentType` values and element ordering. `OrderDate`, `ErpOrderLineNum` and `CustomerPO`
were not found on the screens opened; read that as not found rather than not present.

**5. Counter-based negatives on this ticket cover about 3 days of poller activity**, because the
schedule has been disabled since 2026-09-07. Any case resting on a counter reading zero inherits that
bound, not just TC6d.

**6. No script in this plan folder has been reviewed by a second person.** A pass proves the script ran
as much as it proves the system behaved. That is the largest single assumption under this evidence
base.

**7. Two order-level absences are unexplained.** `261644` and `261646`, real ECOM orders at
`status=OPEN`, hold order-side items and zero shipment-side items, and the DIGITAL/INSTORE
delivery-method exclusion accounts for neither. Found incidentally, not chased, and **not** TC6c's
shape, which is a size-level absence.

**8. Go live is gated on the CTC item master being loaded** (LLD §9.4). Two option codes are confirmed
absent from SCALE staging, and per §5 an unknown item code fails **every line on the shipment**, not
just its own.

### Handed on, by owner

* **E2E:** TC9 and TC15 (rejection and DLQ, no fixture obtainable here), TC1a's three not-found
  fields, the SCALE half of TC6b, and **TC6c's reconciliation**, which is the one unclosed check this
  doc hands over with a named fixture: `261110`, `261111` and `261113` against the cycle that recorded
  `skippedZeroQty:3`, stored counts 3, 4 and 2, where the shortfalls should total exactly 3. Any
  shortfall not attributable to a `qty: 0` entry is a lost row.
* **Dev, a dev-environment test:** TC14, the two picked stages. No ECOM order can reach either until
  the confirmation leg exists, per LLD §9.1.
* **BUSY-1161:** TC19's routing half and TC6b's fixture. Both are wholesale conditions: §10.2 puts the
  256 KB breach at 83 size rows on the largest real order, about 7% of the cap, and the multi-size
  style QA could not find in 100 ECOM orders is how a size run is written on a bulk order.
* **BUSY-1162:** TC22 (D1) and TC18's deferred fix (D18), plus the alerting and error taxonomy.
* **The confirmation epic:** TC21b. LLD §6's own acceptance for the echo guard is a counter tracking
  pick confirmations one for one, which needs a leg that does not exist.
* **Lachlan, document corrections:** C1 to C3 and C10 on this ticket, and C7 to C9 from the epic
  register.

Poller schedule left disabled, watermark unset.
