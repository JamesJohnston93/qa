# QA Doc - BUSY-1158

### BUSY-1158, Prefactor: CTC-ready order and shipment schema + consumer guards

**Relevant Documentation**

* [Task BUSY-1158](https://universalstore.atlassian.net/browse/BUSY-1158), status Review. Blocked by [BUSY-1260](https://universalstore.atlassian.net/browse/BUSY-1260) (Review). Blocks [BUSY-1159](https://universalstore.atlassian.net/browse/BUSY-1159) (Review).
* [Epic BUSY-1065](https://universalstore.atlassian.net/browse/BUSY-1065), Cin7 Sales Order Integration.
* [LLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1802698758), source of truth, section 3 record model and consumer guard audit.
* [HLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1631617025), business framing and volumes.
* QA Doc - BUSY-1159. Six rows below carry evidence from its slices, each naming the source case.
* Kian's ticket comments of 2026-07-30 and 2026-08-18. The first names four consumers the LLD audit table still does not.

**Goal of Task**

Before a single Cheap Thrills order reaches our systems, the orders service and the shipping service both have to know what one is, and every existing piece of software that reacts to an order has to be told to leave them alone. Without that, Cheap Thrills orders would appear in Universal Store's marketing analytics and customer messaging, in reporting, on pick slips, and in the warehouse tooling that packs Universal Store's own parcels. This task adds the fields and the guards. It moves no orders itself.

**Stakeholders**

Assignee james.johnston, reporter Lachlan.Paulsen. Built by kian.noctor.

**Overview**

The orders service gains `CIN7_SO` as an origin system, keyed `CTC#CIN7_SO#<reference>`. The order gains `cin7Id`, `orderType`, `warehouse`, `scheduledShipDate`, `carrier`, `packingBrand`, `sourceStatus`, `sourceStage`, `isVoid`, `cancellationDate`, `lastModified` and `lastEmittedPayloadHash`. Order items gain `quantity`, `qtyShipped` and `OUTBOUND` as a delivery method. The shipping service gains `company`, `orderType` and `cin7Id` on the shipment header and in the transaction shipment payload block. Dynamoose `saveUnknown` is false, so any attribute not declared is dropped on save with no error. Every consumer in the LLD audit table then gets an explicit CTC stance, each backed by a regression test. Order triggered stances apply to all four order types, shipment triggered stances to ECOM only, since the other three never emit native events.

**Acceptance Criteria (from Jira AC checklist)**

Jira carries these as an unnumbered checkbox list. The AC numbers below exist only so the test table has something to point at, and will not survive an edit to the ticket.

* **AC1** Orders domain carries `CIN7_SO`; order and order-item schemas carry every field listed above, each declared rather than relying on unknown-attribute saving
* **AC2** `qtyShipped` and the fulfilment statuses exist and are writable by the confirmation leg, though nothing in this epic sets them
* **AC3** Shipment header schema and the transaction payload block carry `company`, `orderType`, and `cin7Id`
* **AC4** `create-shipment-items` carries `quantity` through; a quantity-less UNI order behaves exactly as today
* **AC5** Every consumer in the LLD audit table has its CTC stance implemented, with one regression test each
* **AC6** A CTC ecom order with a customer email present produces no Segment event, asserted specifically, since this is the case the PO guards do not cover
* **AC7** No CTC row reaches BigQuery on either path in either service
* **AC8** dc-packing company inference is replaced by the explicit field, with existing UNI tests still green

### Scope for this QA pass

**Covered here:** what a live CTC order evidences from outside the repository, which is the schema fields something writes, the header stamps, the record grain, and the stance of every consumer reachable in CloudWatch. Six rows carry that evidence from BUSY-1159's slices; every other row runs natively here. The audit table is where the carried rows run out, since a consumer that correctly ignores a CTC order and a consumer nobody wired up leave the same trace.

**Out of scope**

* The poller, the mapping and the send to SCALE. Owned by BUSY-1159.
* The outbound family records for wholesale, RTV and store pick. Owned by BUSY-1161 and BUSY-1219, not built.
* Anything the confirmation leg writes. `qtyShipped` and the fulfilment states are declared here and populated by BUSY-1015 to BUSY-1017. Do not raise their emptiness as a defect.
* How CTC rows are mapped into the analytics estate later. A separate CTC reporting LLD owns that. This ticket owes it only a sequencing dependency.
* The message group fallback fix. Owned by BUSY-1258 under the purchase order epic, coordinate rather than rebuild.
* Driving a CTC shipment past `OPEN`. Fulfilment and collection are outside this LLD entirely, owned by BUSY-1015 to BUSY-1017. Two inventory lambdas subscribe to the item-allocated, rejected and fulfilled events with no origin or company filter, so they will see CTC records once a shipment moves. Noted for the picks epic, which owns shipment handling, not tested here. Address update and rejection are in the design but owned by BUSY-1160. Hold is named as a trigger in the audit table and addressed by no section of the LLD at all, which is a design gap rather than a testing one.
* Reallocation's worker. The audit table gives it a skip stance, but no `TRANS_REALLOCATION` worker was found on the dispatcher that lists the detail type. Unresolved, and not this pass.
* Schema declarations themselves. Not observable without repo access, see TC1b.

**Services**

| Component | Resource Name | Type |
|---|---|---|
| Orders table | `staging-orders-v2` | DynamoDB |
| Shipments table | `staging-shipments` | DynamoDB |
| Orders event bus | `staging-orders-v2-event-bus` | EventBridge bus |
| Shipping event bus | `staging-shipping-v2-event-bus` | EventBridge bus |
| Order create consumer | `staging-orders-v2-create-order` | Lambda |
| Order placed consumer | `staging-orders-v2-placed-order` | Lambda |
| Address validation consumer | `staging-orders-v2-validate-address` | Lambda |
| Shipping order created consumer | `staging-shipping-v2-order-created` | Lambda |
| Orders reporting stream | `staging-orders-v2-order-reporting-stream` | Lambda |
| Shipping reporting stream | `staging-shipping-v2-shipment-reporting-stream` | Lambda |
| Reporting buffer | `staging-shipping-reporting-buffer-processor` | Lambda |
| Shipment transform backup | `transform-shipments-backup` | Fargate task, unit tested only |
| Guard sweep tool | `check-ctc-consumer-guards.sh` | Script |

**Blockers For Testing**

* No monorepo or build access, so no schema declaration can be read. A field is visible only once something writes it, which leaves AC1's declared-not-inferred wording and all of AC2 unverifiable.
* Unmarked reporting rows in the orders service cannot be excluded by the current guards. Dev deferred this until the BigQuery reporting LLD lands. AC7 cannot close while it stands.
* No engineering QA handover page and no recorded PR, so there is no named commit behind guards that are demonstrably live on staging.
* The LLD audit table has no inventory service row, though dev traced that service consuming these event types and flagged it as unowned.
* The guard sweep script is ours and unreviewed. Its real risk is under-scanning a busy shared log group, which it did once before slice 03 fixed it, so a negative result is weaker than a positive one. The guard lines themselves were read directly, so the carried rows do not rest on the script alone.
* The subscriber list cannot be completed from infrastructure alone. Four of the seven functions the sweep checks are invoked Lambda to Lambda and appear in no rule, mapping or stream, so AC5 evidence rests on log content.

**Edge Cases / Gotchas**

* Segment is the guard that differs from the purchase order flow. A CTC ecom order carries a real customer email, so the empty-email early return that incidentally protects purchase orders never fires, and only an explicit company or origin check keeps it out of marketing analytics.
* A consumer that correctly skips and a consumer nobody guarded look identical from outside. A pass means the guard line was seen, not that nothing happened.
* A consumer silent because its triggering event never happened is a third case, neither a skip nor a run. TC4e exists because a shipment sitting at `OPEN` makes a dozen consumers look guarded when they were never called.
* Native CTC shipment records share the Universal Store key shape, so reporting excludes them on the header's `company` field rather than on a key prefix.
* `packingBrand` is deliberately separate from `brand`, so CTC brand values never land in `brand` and re-create the inference problem AC8 removes.
* The guard sweep needs about 10 minutes before a negative result can be trusted, because some consumers log late.
* A sender failure is not a domain rejection. The references that dead lettered under BUSY-1159 are all still `OPEN` with no `wmsSentAt`, so DLQ membership and shipment status are independent. A DLQ reference is not a rejection fixture.
* Reading these log groups returns customer data. The faulty sale worker logs its whole record body, the dc-packing workers log customer names in object dumps, and the poller logs the record it is about to emit. Extract the one field needed, never print a matched line whole.
* The shipments table has no `origin` index, so the only route from an order to its shipment row is the order's own key. A lookup by Cin7 reference is not available.
* The sweep script under-scanned busy shared log groups until BUSY-1159 slice 03 fixed it. Any guard result taken before that fix is unverified.
* A shipments scan returns roughly 14,000 warehouse fulfilled Universal Store candidates. BUSY-1159's TC7 saw only NEWSTORE orders and read that as none existing. A narrow search, corrected by TC3b.
* Staging is not a quiet sandbox. The sales order poller runs against real Cin7 traffic whenever enabled, so a candidate order is usually already created by the time you look. Carried over from BUSY-1159.

**Actual Tests**

Observation against staging using live CTC orders, since nothing here can be seeded. Rows marked carried name the BUSY-1159 case that produced the evidence and were not re-run.

```
CTC order written to the orders service, origin CTC#CIN7_SO#<reference>
        |
        v
  ORDERS SERVICE SCHEMA
   declared fields persist, none dropped          [TC1, TC1b]
        |
        +--> Segment order and item events        guard fires   [TC4, TC5, TC5b]
        +--> orders reporting stream              guard fires   [TC4, TC6, TC6b, TC6c]
        +--> address validation, order handlers   by design     [TC4]
        +--> CX email, listOrders gateway         unchecked     [TC4b]
        |
        v
  NATIVE TRICKLE DOWN, ECOM only
   header and transaction payload stamped         [TC2, TC2b]
   grain inherited from the order                 [TC3]
        |
        +--> shipping reporting stream            guard fires   [TC4, TC6]
        +--> pickslip generation and merger       unchecked     [TC4b]
        +--> dc-packing to uniWMS workers         unchecked     [TC4b]
        +--> reallocation                         unchecked     [TC4b]
        +--> NewStore, Shopify, click and collect unchecked     [TC4b]
        +--> subscribers absent from the audit    no stance     [TC4c, TC4f]
        |
        v
  UNIVERSAL STORE ORDERS UNCHANGED                [TC3b, TC7, TC8]
```

| TC | AC | Test | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| TC1 | AC1 | Read a live CTC order row against the LLD field list | Every field the poller writes is persisted | PASS | Carried, BUSY-1159 TC2. No stamp missing on readback |
| TC1b | AC1, AC2 | Fields nothing writes yet: `qtyShipped`, `sourceBranchId`, `destinationBranchId` | Absent from the row, declaration unreadable | BLOCKED | No repo access. `lastEmittedPayloadHash` has left this set: the poller writes it on emit, value matching the emitted payload, and an echo leaves it untouched |
| TC2 | AC3 | Read the native shipment header for a live CTC order | `company`, `orderType` and `cin7Id` on the header | PASS | Carried, BUSY-1159 TC2. Reconfirmed on a fresh order, `company: CTC` |
| TC2b | AC3 | Read the shipment payload block on that order's transaction row | Same three fields inside the payload block | PASS | All three inside `shipmentInfo`. Item block carries `company` too |
| TC3 | AC4 | Order items and shipment items for an ECOM order | One row per unit, no `quantity` field | PASS | Carried, BUSY-1159 TC6. Passthrough withdrawn, see drift |
| TC3b | AC4 | A quantity-less Universal Store order through shipment item creation | Item rows unchanged from today | PASS | Two units of one SKU, two rows, no `quantity` attribute on either |
| TC4 | AC5 | Sweep the audited consumers reachable in logs for a live CTC reference | Each skips or handles by design | PASS | Carried, BUSY-1159 TC12. 7 of 7 clean |
| TC4b | AC5 | The audited consumers reachable on a newly created CTC shipment | Each skips | PASS | dc-packing create and Shopify move-fulfilment. Guard line names the shipment id in the same invocation. **Reconfirmed 2026-09-09** against the redeployed `staging-shipping-v2-dc-packing-shipment-create` (`LastModified 2026-09-09T01:33:01Z`, new `CodeSha256`, changed by an unrelated same-day redeploy): direct source read found the identical guard (`isCTCShipment`, log line `` `shipment ${event.shipmentId} is a CTC record, not for uniWMS` ``) unchanged, byte for byte. No new invocation observed post-redeploy (none occurred); confirmation is by source read, per `../retests/RETEST-POST-1161/slices/R1-targeted-retest.md` Part 4, which chose not to create a new shipment to force one. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` |
| TC4d | AC5 | Pickslip generation on a live CTC shipment | Skips, and says so | INCONCLUSIVE | Invoked, no guard line, no downstream pickslip URL and no `pickslipUrl` on the row. A real skip and an unguarded run are indistinguishable here. Re-checked after the consumer redeploy, unchanged. Q28 for Kian, who recorded a guard and a regression test for this consumer |
| TC4e | AC5 | Consumers gated on a later shipment lifecycle state | Each skips | BLOCKED | All 79 CTC shipments on staging are `OPEN`, from a complete table scan, so no CTC record has ever reached these consumers. The LLD verifies these guards by regression test at the handler boundary, not live. Observation lands under BUSY-1160 for address update and rejection, BUSY-1015 to BUSY-1017 for fulfilment and collection |
| TC4c | AC5 | Re-sweep the audit against the real event wiring rather than the LLD table | Every subscriber is accounted for, and any without a stance has no side effect on a CTC record | PASS | One unguarded consumer, confirmed: the faulty sale worker reads `TRANS_CREATE_ORDER` on its own rule with no origin or company filter, and 9 of 9 fresh CTC orders reached it and the inventory worker it invokes. No side effect: zero events on the inventory bus, zero write capacity consumed on the inventory table, warm durations below the non-CTC median. Absent from the audit table and from the sweep script. Q27 closed on evidence. Residual exposure is logging only, BUSY-1162 |
| TC4f | AC5 | Sweep the faulty sale worker for a live CTC reference once the CTC split lands | No CTC reference in its log group at all | N/A | The split is not shipping and AC5 does not need it, see TC4c. The logging exposure it would also have closed is tracked under BUSY-1162 |
| TC5 | AC6 | CTC ecom order on the Segment path | Guard fires, no event emitted | PASS | Carried, BUSY-1159 TC12. 10 guard lines |
| TC5b | AC6 | Confirm the order behind TC5 carried a customer email | Email present on the order | PASS | Present, length 21. The Segment guard is explicit, not the empty-email path |
| TC6 | AC7 | Reporting stream consumers in both services | Guard fires, buffer never sees the reference | PASS | Carried, BUSY-1159 TC12. Both streams, buffer clean |
| TC6b | AC7 | Read how the reporting guard records a skipped CTC row | Debug log, no error branch and no error metric | PASS | DEBUG on both streams, one line per row. `Errors` flat across both windows |
| TC6c | AC7 | Unmarked reporting rows in the orders service | Excluded | BLOCKED | Deferred by dev until the BigQuery reporting LLD lands |
| TC7 | AC8 | Universal Store order through the dc-packing path | Company read from the explicit field, behaviour unchanged | N/A | Handled, not skipped, not misclassified. The worker computes `company: 'UNIVERSAL'` mid-pipeline and saves `null`. A UNI order cannot separate inference from the explicit field, they agree, so this is not provable from outside. Q29 |
| TC7b | AC8 | The same worker's sequence on a CTC shipment, to see whether the explicit field is what classifies it | The guard fires before the code that sets `company` | N/A | Guard fires 0.16s after the record's own fields are read, same invocation, too short for the warehouse round trip that produced the `"company":"UNIVERSAL"` echo on the UNI baseline, and no echo appears, so the skip precedes the classification code. On fresh data a CTC header carries `company: CTC` and a UNI header carries none, matching the LLD's static value. Inference against the explicit field belongs to the dc-packing unit tests |
| TC9 | AC5 | `listOrders` gateway with `CTC` present in `Stores` | CTC orders either returned or excluded deliberately, not by accident | PASS | Gate A (store list source) UNKNOWN, not readable from outside the repo, ruled out a DynamoDB table and an SSM parameter by the function's own IAM role, leaving only a code constant. Gate B MEASURED: invoked read-only (logs too stale to use), `GET /orders?status=OPEN` returns a live `CIN7_SO`/`store: CTC` order (`261071`) unfiltered, mixed with PS/US/NEWSTORE rows, matching the LLD. Downstream callers not traceable from infrastructure, flagged as Q39 rather than decided |
| TC8 | | Universal Store orders in the same window as a CTC order | No CTC stamp, no entry to the CTC path | PASS | Carried, BUSY-1159 TC7 and TC11. Orders side only, see TC3b and TC7 |

`PASS / N/A / BLOCKED / INCONCLUSIVE`

**Design drift**

| What | LLD says | Ticket says | Test impact |
|---|---|---|---|
| Field list | Adds `packingBrand`, `sourceStage`, `isVoid`, `cancellationDate`, `lastEmittedPayloadHash` and the branch ids | Names none of them | TC1 follows the LLD, so an absent field is a finding against the LLD |
| `quantity` passthrough | ECOM is per unit, no passthrough needed | AC4 requires `create-shipment-items` to carry `quantity` through | Settled by TC3. AC4 is stale for ECOM, the passthrough still matters to the outbound family |
| Reporting | Owned by a separate CTC reporting LLD | AC7 requires no CTC row on either path in either service | Both stream guards pass, the orders side is deferred, so AC7 cannot close |
| Consumer list | The audit table is the consumer list, and section 11 verifies AC5 with one regression test per row | Same list | Settled by TC4c. The table omits both Futura dispatchers, the inventory service and the faulty sale worker, so no regression test for any of them exists or would |

**Covered by automated tests**

| Case | Where |
|---|---|
| One regression test per guarded consumer, AC5 | LLD section 11 item 6. Scoped to the audit table, which TC4c showed is incomplete |
| Existing Universal Store dc-packing tests still green, AC8 | dc-packing suite |
| That the explicit field, not inference, classifies company, AC8 | dc-packing suite. TC7b establishes this is the only place it can be verified |
| Pickslip merger ignores a CTC shipment in a shared store merge | Named in a dev comment, not readable by QA |

**Sign-off**

Signable with limits. AC5 passes on measured absence of side effects rather than on a guard. Still
open: repo access for AC2 and AC1's declared half, the orders-side reporting deferral for AC7, and
AC8's dependency on the dc-packing unit tests. Read only throughout, nothing created or invoked.
