# QA Doc - BUSY-1161

### BUSY-1161, Outbound family: RTV end-to-end

**Relevant Documentation**

- [Task BUSY-1161](https://universalstore.atlassian.net/browse/BUSY-1161), status Review. Blocked by [BUSY-1159](https://universalstore.atlassian.net/browse/BUSY-1159) (Done). Blocks [BUSY-1219](https://universalstore.atlassian.net/browse/BUSY-1219) (To Do) and [BUSY-1162](https://universalstore.atlassian.net/browse/BUSY-1162) (In Progress).
- [Epic BUSY-1065](https://universalstore.atlassian.net/browse/BUSY-1065), Cin7 Sales Order Integration
- [LLD, Sales Orders and Branch Transfers to Manhattan SCALE (CTC)](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1802698758), sections 3 and 5. Status Draft.
- [HLD, Sales Order Data Flow](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1631617025) (business framing, carries errata)
- [BUSY-1161 QA Handover](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1961656356), Kian Noctor
- [QA Doc - BUSY-1159](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1929805827) and [QA Doc - BUSY-1160](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1929052164), both of which hand cases here

**Goal of Task**

CTC raises two kinds of sales order in Cin7 that send stock out of the warehouse to someone other than a retail shopper: a wholesale order to a trade customer, and a return to vendor, which sends stock back to a supplier. Neither reaches the warehouse system today, so the Arundel DC has no record to pick against. This task makes both appear automatically in Manhattan SCALE as shipments, and keeps them in step as the order is edited or cancelled in Cin7.

**Stakeholders**

Assignee james.johnston. Reporter Lachlan.Paulsen. Engineer kian.noctor.

**Overview**

The poller reads `GET /v1/SalesOrders` on branches `51908` and `51909` and resolves the contact `group` to an order type. Anything other than `Retail-Ecomm` routes down a dedicated outbound path rather than the native ECOM one: poller -> `CREATE_OUTBOUND_ORDER` / `UPDATE_` / `CANCEL_` -> outbound order handler -> `OUTBOUND_ORDER_*` -> bridge -> `OUTBOUND_SHIPMENT_SAVE` or `_DELETE` -> materialiser -> `OUTBOUND_SHIPMENT_READY` -> sender -> Shipment XML to SCALE -> `OUTBOUND_SHIPMENT_SENT`. Records sit under `SK = SHIPMENT#<reference>`, lines at `OUTBOUND_ITEM#<line id>#<size code>`, one row per size, lifecycle `PENDING_OUTBOUND` -> `SENT_OUTBOUND` plus `CANCELLED_OUTBOUND` and `REMOVED_OUTBOUND`. The sender reads the persisted records rather than the payload, so a per-line `DELETE` derives from the line's removed status. Every hop is version-guarded on Cin7's `lastModified`, which the bridge has to carry across.

**Acceptance Criteria (from Jira AC checklist)**

- AC1: An RTV order lands in SCALE with the RTV order type and `AllocateComplete = N`
- AC2: The bridge preserves the last-modified value and the message group, test-asserted, not assumed
- AC3: A save emits the ready event only after the records are written
- AC4: A line removed in Cin7 flips to removed and the next send carries a per-line delete; cancellation flips the header and sends a header delete
- AC5: Version guards hold: stale sent dropped, older replayed save is a no-op, a cancelled header is never resurrected
- AC6: The sent event flips the header from pending to sent; a sender retry after a crash-on-success dedupes on the echoed key
- AC7: Materialiser and sender carry no Cin7 Sales Order field names, verified by BUSY-1219 reusing them unchanged
- AC8: Materialiser and sender handler tests

### Scope for this QA pass

**Covered here:** both order types the outbound family carries from sales orders, WHOLESALE and RTV, from the Cin7 read through to an accepted Shipment in SCALE staging. Creation, the five line-level and address revisions, cancellation, and the stored record state behind each. The version guards the materialiser applies, the two conditions BUSY-1159 handed here (an oversize order and a style expanded across sizes), and a regression row on the native ECOM path. Revisions are applied from the engineer's fixture set rather than edited in Cin7, which is production and read only. RTV runs against composed stand-ins throughout; wholesale runs against real Cin7 data in TC9, the only case exercising the Cin7-reading half.

**Out of scope**

- STORE_PICK and branch transfers. Owned by BUSY-1219, which reuses this machinery unchanged.
- The native ECOM mapping. Owned by BUSY-1159, signed off. TC17 covers only that it is undisturbed.
- Overseas delivery addresses. Refused before the pipeline by design, unit-covered only. Also a production gate for RTV, since most real RTV suppliers are overseas.
- Alerting, dashboards and error taxonomy. Owned by BUSY-1162. Both alert topics have zero subscribers, so a missing alert here is not a defect against this ticket.
- The confirmation leg reading SCALE dispatches back into Cin7. Its own epic.
- BigQuery reporting on either service. Deferred epic-wide to a separate CTC reporting LLD.
- Reprocessing an order reference already used. There is no self-service reset on staging.

**Services**

| Component | Resource Name | Type |
|---|---|---|
| Sales order poller | `staging-orders-cin7-so-poller` | Lambda |
| Poller read position | `/staging/orders/cin7-so-watermark` | SSM parameter |
| Outbound order handlers | `staging-orders-cin7-{create,update,cancel}-outbound-order` | Lambda |
| Outbound order queue | `staging-orders-cin7-outbound-orders-queue.fifo`, DLQ `staging-orders-cin7-outbound-orders-dlq.fifo` | SQS FIFO, direct consumer `staging-orders-cin7-outbound-orders-eda-queue-handler` (MEASURED, slice 01 Gate B), which dispatches to the create/update/cancel handlers above |
| Bridge to the shipping side | `staging-shipping-inbound-outbound-order-bridge` | Lambda |
| Bridge queue | `staging-shipping-inbound-outbound-bridge.fifo`, DLQ `staging-shipping-inbound-outbound-bridge-dlq.fifo` | SQS FIFO, direct consumer `staging-shipping-inbound-outbound-bridge-eda-queue-handler` (MEASURED, slice 01 Gate B), not the bridge function directly |
| Outbound materialiser | `staging-shipping-inbound-materialise-outbound-shipment` | Lambda |
| Materialiser queue | `staging-shipping-inbound-outbound.fifo`, DLQ `staging-shipping-inbound-outbound-dlq.fifo` | SQS FIFO, direct consumer `staging-shipping-inbound-outbound-eda-queue-handler` (MEASURED, slice 01 Gate B), not the materialiser function directly |
| Outbound sender | `staging-shipping-manhattan-send-outbound-shipment` | Lambda |
| Orders table | `staging-orders-v2` | DynamoDB |
| Shipments table | `staging-shipments` | DynamoDB |
| Injection point for synthetic revisions | `staging-orders-v2-event-bus` | EventBridge |
| SCALE staging | `https://unvsstg.manhscale.com`, `POST /general/interfaces/shipments-Downloaded` | API |
| Send alerts | `staging-shipping-manhattan-alert-topic` | SNS, zero subscribers |

**Blockers For Testing**

- Manhattan SCALE staging access, the only blocker that can stop the pass. Nothing reads a Shipment back and a successful send logs neither the document nor the reply, so every "reaches SCALE" expectation is a human read in the UI.
- No RTV exists on branch `51908` or `51909`. Every RTV in Cin7 sits on branch `3`, which the integration never asks for. RTV is provable only against composed stand-ins until one is raised in scope.
- Poller schedule is DISABLED and the sales order watermark UNSET since 2026-09-07. TC9, TC11 and TC16 need both restored, and restoring the schedule pulls real CTC traffic into staging.
- No self-service reset on staging. The documented reset ends in a step locked to the `kian-dev` stage.

**Edge Cases / Gotchas**

- A reference used in earlier testing silently never sends. This build changed the internal keys and the per-line marker the sender relies on, so an old record materialises, stalls, and drops a line removal instead of sending it. Every reference is single use.
- A successful send writes no record of the document sent or of SCALE's reply. Failures log, successes do not. Any pass has to be read off SCALE.
- SCALE accepts or rejects a document atomically, so one bad line fails the whole shipment.
- A SCALE `SAVE` is additive. A field cleared in Cin7 never clears without an explicit overwrite, so a removal test checking only for an absent value passes wrongly. Carried over from BUSY-1160.
- Detail-line identity is the pair `ErpOrderLineNum` and `SKU.Item`, never the line number alone, because every size expanded from a style shares the style's line id.
- Cin7 `modifiedDate` has whole second precision, so the version guard passes on an equal timestamp, not only a newer one. A test asserting strict inequality reports a false defect. Carried over from BUSY-1160.
- The orders-to-shipping queue deduplicates on content over a five minute window, so an identical replay inside that window is dropped silently and looks like a lost message. TC10 has to allow for it.
- Dynamoose `saveUnknown` is false, so an undeclared attribute is dropped on save with no error. Every field this ticket adds is a candidate.
- Sixteen synthetic orders exist and none has been cleared. Four carry non-ECOM `orderType` values a naive query reads as real wholesale traffic, and one is a poison message still cycling toward its DLQ, so it appears in any queue snapshot. `BUSY-1160/SYNTHETIC-REGISTER.md` is the only thing telling them apart.
- **Revisions are manufactured, not read from Cin7.** The tool rebuilds the mapping rather than calling the deployed code, so a clean run proves SCALE accepts that document, not that the deployed mapper builds it. Every verdict here carries that limit except TC9's.
- Three log groups dump whole order records at INFO, customer name, email and address included. Read `CTC-customer-data-in-cloudwatch.md` before pasting raw log output anywhere.
- Cin7 is CTC live production, GET only. Every Cin7-side condition is found in real traffic, never created.
- No script in any plan folder has had a second reader. A pass proves the script ran as much as it proves the system behaved.

**Actual Tests**

Staging, driven two ways: prepared or synthetic revisions injected at the poller's own entry point, and one real Cin7 order pulled through by rewinding the poller's read position.

```
Cin7 sales order, branches 51908 / 51909
  contact group -> ECOM | WHOLESALE | RTV
              |
              v
       SALES ORDER POLLER
   eligibility, type, echo guard        [TC9, TC11, TC16, TC17, TC21, TC22]
              |
              v
   OUTBOUND ORDER HANDLERS
   create / update / cancel             [TC2, TC3, TC4, TC5, TC5d, TC6, TC7a, TC7b]
              |
              v
     BRIDGE -> MATERIALISER
   header, lines, removed lines         [TC5b, TC5c, TC8, TC12, TC13, TC15]
   version guard on lastModified
              |
              v
       OUTBOUND SENDER
   XML built from stored records        [TC10, TC14]
              |
              v
    MANHATTAN SCALE STAGING             [TC1a, TC1b, TC1c, TC1d, TC6b, TC18, TC20]
```

| TC | AC | Test | Expected Result | Status | Notes |
|---|---|---|---|---|---|
| TC1a | AC1 | Wholesale order reaches SCALE | Shipment present, type `WHOLESALE`, warehouse `CTC-QDC`, one line per size | NOT RUN | |
| TC1b | AC1 | RTV order reaches SCALE | Shipment present, ship-to the supplier, one line per size | NOT RUN | |
| TC1c | AC1 | RTV supplier holding no email | Accepted, email element absent rather than blank | NOT RUN | |
| TC1d | AC1 | RTV revision carrying a supplier email | Email shows in Ship To | NOT RUN | |
| TC2 | AC1 | Raise the quantity on one size | That row rises, other rows unchanged | NOT RUN | |
| TC3 | AC1 | Lower the quantity on one size | That row falls, no row disappears | NOT RUN | |
| TC4 | AC1 | Add a size to an existing line | One extra detail line, existing quantities held | NOT RUN | |
| TC5 | AC4 | Remove a size from an existing line | That line deleted in SCALE, every other line survives | NOT RUN | |
| TC5b | AC4 | Read the stored line after a removal | Line reads `REMOVED_OUTBOUND`, the send carries a per-line `DELETE` | NOT RUN | |
| TC5c | AC4 | Re-add a size that was removed | Line returns in SCALE, stored row leaves `REMOVED_OUTBOUND` | NOT RUN | |
| TC5d | AC4 | The same removal run as RTV | Behaves as TC5. Closes the type gap the handover names | NOT RUN | |
| TC6 | AC1 | Change the delivery address | Ship To updates, lines unchanged | NOT RUN | |
| TC6b | AC1 | Clear an optional mapped field in Cin7 | Records whether SCALE clears it or holds the prior value | NOT RUN | |
| TC7a | AC4 | Cancel the wholesale order | Shipment gone from SCALE and does not return | NOT RUN | |
| TC7b | AC4 | Cancel the RTV order | As TC7a | NOT RUN | |
| TC8 | AC1, AC6 | Read the stored header after a send | `SENT_OUTBOUND`, every line carries its sent marker | NOT RUN | |
| TC9 | AC1 | Rewind the read position onto a real wholesale order | Genuine Cin7 data reaches SCALE unaltered | NOT RUN | |
| TC10 | AC1 | Apply one revision twice unchanged | One shipment, no doubled lines | NOT RUN | |
| TC11 | AC1 | Revise an order already at `Dispatched` | Nothing created or changed, no error | NOT RUN | |
| TC12 | AC5 | Replay a save older than the stored header | No write, stale revision counted | NOT RUN | |
| TC13 | AC5 | Deliver a save after the header is cancelled | Header stays cancelled, nothing sent | NOT RUN | |
| TC14 | AC1 | Wholesale order past the event size cap | Routed to the error path, not split or dropped | NOT RUN | |
| TC15 | AC1 | Style expanded across several sizes | One row per size under one line id, both reach SCALE | NOT RUN | |
| TC16 | AC1 | Wholesale order on branch `51908` | Warehouse code recorded, SCALE accepts it | NOT RUN | |
| TC17 | AC1 | Live ECOM order through the same cycle | Native path unchanged, no outbound records written | NOT RUN | |
| TC18 | AC1 | First real RTV raised on an in-scope branch | Mapping matches what the stand-ins showed | NOT RUN | |
| TC20 | AC1 | Two sizes on one line sharing a size code | Both rows survive under distinct keys, or the order is refused | NOT RUN | |
| TC21 | AC1 | A size carrying zero quantity | Skipped and counted, no zero-quantity line in SCALE | NOT RUN | |
| TC22 | AC1 | A line whose `sizes[]` array is empty | Records whether the line falls back or is dropped | NOT RUN | |

`NOT RUN / PASS / FAIL / BLOCKED / N/A / DEFERRED`

**Design drift**

| What | LLD says | Ticket / dev doc says | Test impact |
|---|---|---|---|
| Order types in this family | WHOLESALE, RTV and STORE_PICK all outbound | Ticket scope reads "RTV as its only order type from sales orders" | Wholesale is tested here. Ticket text is stale, correction C6, Kian confirmed 2026-09-09 |
| `AllocateComplete` for wholesale | `Y` for ECOM and WHOLESALE, `N` for RTV and STORE_PICK | Handover says `N` for both wholesale and RTV | TC1a records the observed value rather than asserting one. Needs Lachlan |
| Warehouse code | Derived per record, `51909` to `CTC-QDC` and `51908` to `CTC-WH` | Deployed poller carries a single constant `CTC-QDC`, no branch lookup | TC16 exists to record what a `51908` order now produces. LLD correction |
| RTV ship-to source | Open, "settled against a real RTV order during build" | Handover: supplier name arrives in the first-name field, company empty | TC1b's expected ship-to comes from the build, not the design |

**Covered by automated tests**

| AC | Where it is covered |
|---|---|
| AC2 | `outbound-order-bridge.test.ts`. Internal message attributes with no observable surface. |
| AC3 | `materialise-outbound-shipment.test.ts`. Ordering of internal writes. |
| AC5 | `materialise-outbound-shipment.test.ts`. TC12 and TC13 drive two limbs; the stale sent limb needs deliberate out-of-order delivery. |
| AC6 | `outbound-shipment-sender.test.ts`. A crash on success cannot be forced. |
| AC7 | Property of the code. Enforced by BUSY-1219 reusing both workers unchanged. |
| AC8 | `materialise-outbound-shipment.test.ts` 58, `outbound-shipment-sender.test.ts` 29, `outbound-order-bridge.test.ts` 17, `outbound-download-mapper.test.ts` 52. |

**Sign-off**
