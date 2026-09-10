# Result: Slice 01, wiring and guard shape

**Ticket:** BUSY-1158
**Verdict:** TC6b PASS. TC4c FAIL against AC5, one confirmed unguarded consumer, one existing tracked
gap re-confirmed, plus a sweep-method limitation worth naming before slice 02 is scoped.

## Preconditions

MEASURED. `aws sts get-caller-identity --profile staging` returned the staging account
(398353400186), SSO session alive, no login needed this session. Both buses present:
`staging-orders-v2-event-bus`, `staging-shipping-v2-event-bus`.

## TC4c, re-sweep the audit against the real event wiring

### Method and its limit

Saved and ran `scripts/read-event-wiring.sh --stage staging --profile staging`. It covers three of
the four paths the slice named directly (EventBridge rules and targets on both buses, Lambda event
source mappings account wide, the two table streams) and found zero SNS topics among the rule
targets, so the fourth path had nothing to fan out from.

**A fifth path exists that none of the four cover: direct Lambda to Lambda invocation from inside a
queue handler's own code.** `check-ctc-consumer-guards.sh` checks seven functions. Four of them
(`orders-v2-create-order`, `orders-v2-placed-order`, `orders-v2-validate-address`,
`shipping-reporting-buffer-processor`) do not appear anywhere in the rule-target, event-source-mapping
or stream sweep, yet their log groups exist and, for the three checked directly, are shown below
actively receiving and processing full CTC transaction records. MEASURED: `staging-orders-v2-eda-queue-handler`
(the real queue handler behind the big rule matching `TRANS_CREATE_ORDER`/`CREATE_TRANSACTION`/etc.)
logs the parsed transaction object as a single-record body immediately before `create-order`,
`placed-order` and `validate-address` each log the identical object as their own top-level input, with
no SQS envelope, no EventBridge detail wrapper and no ARN this sweep's API calls can resolve. That
shape is consistent with a synchronous or fire-and-forget Lambda invoke buried in application code,
which `list-rules`, `list-event-source-mappings` and `describe-table` cannot see. **Inconclusive by the
slice's own definition: a target cannot be identified from infrastructure alone here, because there is
no target, the call happens in code.** Treat the four guard-script rows fed this way as verified only
by the log content itself (which they were, see below), not by this sweep's method.

### Subscriber table

One row per subscriber found on the orders-v2 or shipping-v2 bus, an event-source-mapping queue whose
messages originate from one of those buses, or the two table streams. Full raw sweep output
(`226` lines, every rule/target/ESM/stream in the account) is in the scratchpad and not reproduced
here; this table is curated to the order/shipment-event-relevant rows in it. Column three is whether
`check-ctc-consumer-guards.sh` checks the function today.

| Subscriber (queue handler) | Path | Event types read | In LLD audit table (per QA-DOC.md's summary) | Checked by guard script |
|---|---|---|---|---|
| `orders-v2-eda-queue-handler` | rule, orders bus | `CREATE_TRANSACTION`, `TRANS_CREATE_ORDER`, `ORDER_CREATED` + 20 more | Yes (orders service, own path) | Indirectly: fans out to `create-order`/`placed-order`/`validate-address` below |
| `orders-v2-create-order` | invoked from the above, not independently wired | `CREATE_ORDER` detail | Yes | Yes, RAN expected. MEASURED processing `WOR19261` and `261115`, both real CTC references |
| `orders-v2-placed-order` | invoked from the above | `ORDER_PLACED` detail | Yes | Yes, SKIP-MARKER expected (Segment). MEASURED receiving `WOR19261` |
| `orders-v2-validate-address` | invoked from the above | `VALIDATE_ADDRESS` detail | Yes | Yes, SKIP-MARKER expected. MEASURED receiving `WOR19261` |
| `orders-v2-segment-eda-queue-handler` | rule + queue, orders bus | `TRANS_CREATE_ORDER`, `CUSTOMER_EMAIL_ADDED`, `TRANS_ADD_ITEM`, `ORDER_ITEM_REFUNDED`, `CANCEL_ITEM`, `SEGMENT_CX_EMAIL` | Yes, this is the Segment consumer named above | Not directly, its log group is not one of the seven, `placed-order` is |
| `orders-v2-shopify-eda-queue-handler` | rule + queue, orders bus | `SHOPIFY_ORDERS_CREATE` + 8 more | Yes | No |
| `orders-v2-orders-futura-eda-queue-handler` | rule + queue, orders bus | `TRANS_ORDER_FINALISED`, `TRANS_REFUND_ITEM`, `TRANS_REFUND_SHIPPING`, `TRANS_EGCS_CHARGED` | Yes | No. Note: its four workers are also `WORKER_DN_*`-named (`dn-finalise-order`, `dn-egcs-charged`, `dn-shipping-refunded`, `dn-order-item-refunded`), same "DN" branding as the shipment-side Futura row below. Dev named one "Futura delivery-notification listener" as untracked; there are two DN-branded Futura dispatchers, one per bus. Which one (or both) is the untracked one is UNKNOWN without the LLD table text itself |
| `orders-v2-gift-card-eda-queue-handler` | rule + queue, orders bus | `CREATE_EGC`, `SEND_EGC` | Not order/shipment creation, unrelated detail types | No |
| `orders-v2-b2b-event-handler-queue-handler` | rule + queue, orders bus | `ORDER_ITEM_ACCEPTED_B2B` | B2B-specific detail type, not exercised by a CIN7_SO ECOM order | No |
| **`faulty-sale-worker-queue-handler`** | rule + queue, orders bus, own rule independent of the main fan-out | `TRANS_CREATE_ORDER` | **No, not in the LLD table and not one of dev's four named additions** | **No** |
| `orders-v2-reporting-eda-queue-handler` | rule + queue, orders bus | `PUSH_TO_BIGQUERY`, `ORDER_TO_BIGQUERY`, `ORDER_ITEM_TO_BIGQUERY`, `ORDER_TRANSACTION_TO_BIGQUERY` | Matches the "unmarked reporting rows in the orders service" item already on file, AC7 deferred | No |
| `orders-reporting-bq-buffer-buffer-populator` (legacy, non-v2 table) | rule, orders bus | same three `*_TO_BIGQUERY` types, no `PUSH_TO_BIGQUERY` | Same known deferred reporting gap | No |
| `orders-v2-order-reporting-stream` | DynamoDB stream, `staging-orders-v2` | table stream, all row types | Yes | Yes, SKIP-MARKER. Confirmed below, TC6b |
| `orders-newstore-eda-queue-handler`, `inventory-core-newstore-orders-eda-queue-handler` | rule + queue, orders bus | `NEWSTORE_*` family | Different event family, not exercised by a CIN7_SO create | No |
| `orders-dn-rec-eda-queue-handler` | rule + queue, orders bus | `EGC_DN_MISSING`, `SHIPPING_DN_MISSING`, `REFUND_SHIPPING_DN_MISSING` | Unclear, see the DN-repair-job finding below the table, reasoned UNKNOWN, likely out of scope rather than a fifth untracked consumer | No |
| `orders-cin7-inbound-orders-eda-queue-handler` | rule + queue, orders bus | `TRANS_CREATE_INBOUND_ORDER`, `TRANS_UPDATE_INBOUND_ORDER`, `TRANS_CANCEL_INBOUND_ORDER` | Branch transfer family, different event set from sales order create, out of this ticket's stated scope | No |
| `shipping-v2-shipment-eda-queue-handler` | rule + queue, shipping bus | large set, `SHIPMENT_CREATED`/`SHIPMENT_FULFILLED`/etc | Yes (shipping service, own path) | Partially, see limitation above |
| `shipping-v2-order-eda-queue-handler` | rule + queue, **orders bus** (a distinct dispatcher from the row above; corrected, see note) | `ORDER_CREATED`, `ORDER_ITEM_REFUNDED`, `ORDER_ADDRESS_UPDATED`, `ORDER_ON_HOLD`, `ORDER_OFF_HOLD`, `ORDER_CC_STORE_UPDATED`, `ADD_ITEM`, `CANCEL_ITEM`, `B2B_ORDER_ACCEPTED` | Yes, this is where `shipping-v2-order-created` actually lives | Yes, RAN expected. MEASURED: `WORKER_ORDER_CREATED` env var on this handler resolves to `staging-shipping-v2-order-created`, the exact function the guard script checks |
| `orders-v2-shipment-eda-queue-handler` | rule + queue, shipping bus | `SHIPMENT_FULFILLED`, `SHIPMENT_ITEM_UNDELIVERABLE` | **Upgraded to MEASURED**, not just inferred: this dispatcher's own env vars name its two workers `staging-orders-v2-shipment-fulfilled` and `staging-orders-v2-shipment-item-undeliverable`, both `orders-v2`-named, confirming this is dev's "orders service" addition by more than event-type overlap | No |
| `shipping-v2-shopify-eda-queue-handler` | rule + queue, shipping bus | `SHIPMENT_CREATED`, `SHIPMENT_REJECTED`, `SHIPMENT_FULFILLED`, `SHIPMENT_COLLECTED`, `TRANS_UNDELIVERABLE_ITEM_CC` | Still INFERRED, not settled. Its workers are `shopify-create-fulfilment`, `shopify-move-fulfilment-orders`, `shopify-cc-shipment-collected`, `shopify-shipment-rejected`, functionally the Shopify delivery-notification path (fulfilment creation is what notifies Shopify a shipment moved) but none of the four worker names literally say "dn", unlike the Futura row below | No |
| `shipping-v2-shipment-futura-eda-queue-handler` | rule + queue, shipping bus | `TRANS_SHIPMENT_CREATE`, `TRANS_SHIPMENT_FULFILLED`, `TRANS_SHIPMENT_REJECTED`, `TRANS_SHIPMENT_ITEM_REJECTED`, `TRANS_UNDELIVERABLE_ITEM_CC`, `TRIGGER_IBT_DNOK` | **Upgraded to MEASURED**: every one of this dispatcher's five workers is literally `WORKER_DN_SHIPMENT_*` (`dn-shipment-create`, `dn-shipment-fulfilled`, `dn-shipment-rejected`, `dn-shipment-item-rejected`, `dn-shipment-b2b-accepted`), `DN` = delivery notification by its own naming, not just an inference from the event types. This is dev's "Futura delivery notification listener" | No |
| **`inventory-core-shipment-inventory-eda-queue-handler`** | rule + queue, shipping bus, **no origin or company filter in the rule pattern** | `TRANS_SHIPMENT_ITEM_ALLOCATED`, `TRANS_SHIPMENT_REJECTED`, `SHIPMENT_FULFILLED` | **No row in the LLD table.** This is dev's "inventory service" addition, now infra-confirmed (Q5) | **No** |
| **`ShipmentItemRejectedEventWorker-queue-handler`** | rule + queue, shipping bus, **no origin or company filter** | `TRANS_SHIPMENT_ITEM_REJECTED` | Same as above, second inventory-adjacent function found alongside it, also unconditional | No |
| `shipping-v2-dc-packing-eda-queue-handler`, `shipping-v2-reporting-eda-queue-handler`, `shipping-reporting-buffer-populator` (legacy) | rule + queue, shipping bus | `SHIPMENT_CREATED`/etc, `*_TO_BIGQUERY` | dc-packing is in the LLD table (TC4b's list). Reporting pair mirrors the orders-side deferred gap, not previously named on the shipping side | No |
| `shipping-v2-shipment-reporting-stream` | DynamoDB stream, `staging-shipments` | table stream, all row types | Yes | Yes, SKIP-MARKER. Confirmed below, TC6b |
| `shipping-newstore-eda-queue-handler`, `shipping-newstore-boris-queue-handler`, `shipping-inbound-*` | rule + queue, shipping bus | `NEWSTORE_*`, return/refund family, `INBOUND_ORDER_*` | Different event family or branch-transfer family, not exercised by a CIN7_SO ECOM create | No |

### Findings against AC5

**FAIL, one confirmed new gap.** `faulty-sale-worker-queue-handler` subscribes to `TRANS_CREATE_ORDER`
on its own EventBridge rule, independent of the main orders fan-out, with no origin or company filter.
MEASURED: it received the full, unredacted transaction record (including customer email and shipping
address) for both `261115` and `WOR19261` with no skip line, no guard marker and no indication the
payload was filtered before or after receipt. It is not one of the four consumers dev named as missing
from the LLD table (Shopify/Futura delivery notification listeners, inventory service, orders
service), not in the LLD table itself, and not one of the seven functions
`check-ctc-consumer-guards.sh` checks. Logged as **Q27** in the open questions register for Kian: does
this fraud/faulty-sale detection path need the same stance as Segment and address validation.

**Already-tracked gap, re-confirmed, not counted as new.** The event-driven `*_TO_BIGQUERY` reporting
pair on the orders side (`orders-v2-reporting-eda-queue-handler` and the legacy
`orders-reporting-bq-buffer-buffer-populator`) matches the "unmarked reporting rows in the orders
service... AC7 cannot close" item already in `STATE.md` and `QA-DOC.md`, deferred by dev until the
BigQuery reporting LLD lands (TC6c, BLOCKED). Not re-raised as a fresh Q. Worth naming to whoever picks
this back up: the same shape exists on the shipping side too
(`shipping-reporting-buffer-populator`, `SHIPMENT_TO_BIGQUERY`/etc), which the existing note only
described for orders. Neither pipeline was tested against a live CTC reference this session; whether
CTC rows actually reach this path, or whether the upstream `*_TO_BIGQUERY` events are only ever emitted
for non-CTC rows in the first place, is UNKNOWN, not measured.

**Inventory service, MEASURED wiring, consumption UNKNOWN.** Two `staging-inventory-core` lambdas
(`inventory-core-shipment-inventory-eda-queue-handler`, `ShipmentItemRejectedEventWorker-queue-handler`)
are wired unconditionally to the shipping-v2 bus, no row in the LLD table, no row in the guard script.
This matches Q5, already on file and already updated with this same infra finding. Neither showed a
log line naming `261115` or `WOR19261`'s shipment references in that shipment's own window, so whether
either one actually moved stock on a CTC shipment is still unconfirmed. Per the slice's own stop
condition, this would warrant flagging to JJ only if consumption were confirmed; it is not, it is
narrowed from "is it wired" to "did it fire on these particular refs," exactly as Q5 already states.

**Two of three INFERRED matches upgraded to MEASURED after this file's first pass**, by reading each
dispatcher's own `WORKER_*` environment variables rather than reasoning from event-type overlap alone:
`orders-v2-shipment-eda-queue-handler`'s two workers are `staging-orders-v2-shipment-fulfilled` and
`staging-orders-v2-shipment-item-undeliverable` (both `orders-v2`-owned by name, confirming dev's
"orders service" addition), and every one of `shipping-v2-shipment-futura-eda-queue-handler`'s five
workers is `WORKER_DN_SHIPMENT_*` (`DN` = delivery notification by the code's own naming, not an
inference). The Shopify shipment dispatcher's workers (`shopify-create-fulfilment`,
`shopify-move-fulfilment-orders`, `shopify-cc-shipment-collected`, `shopify-shipment-rejected`) carry no
equivalent "dn" naming, so that match stays a functional inference, not a settled one.

A fourth complication surfaced by the same env var read: `orders-v2-orders-futura-eda-queue-handler`
(order-side) is **also** `WORKER_DN_*`-named end to end, the same branding as the shipment-side Futura
row. Dev named one "Futura delivery notification listener" as untracked; there are two DN-branded
Futura dispatchers here, one per bus, both exposed to CTC-firing detail types. Which one (or both) is
the untracked one, and which was already in the original five, is UNKNOWN without the LLD table text.

`orders-dn-rec-eda-queue-handler` (`EGC_DN_MISSING`/`SHIPPING_DN_MISSING`/`REFUND_SHIPPING_DN_MISSING`)
also remains unmatched: its own workers are `staging-orders-dn-rec-fix-shipping`,
`staging-orders-dn-rec-fix-egc`, `staging-orders-dn-rec-fix-refund-shipping` (confirmed via env vars),
which read as a DN-repair/reconciliation job rather than either Shopify or Futura specifically, and its
detail types (`*_DN_MISSING`) are internally-raised "a DN didn't arrive" signals, not something a CIN7_SO
order's own lifecycle would emit. Best read, UNKNOWN not MEASURED: out of scope for a CIN7_SO stance
rather than a fifth untracked consumer, but not confirmed either way.

The Confluence pull of LLD Section 3 attempted for this slice did not return a usable result in the
session window (see note below); the comparison above uses `QA-DOC.md`'s existing summary of the
table's known gaps and dev's ticket-comment framing instead of the table's literal text. Treat the
remaining INFERRED/UNKNOWN rows as a starting point for slice 02, not a settled match.

Net count against the slice's own stop condition ("more than two unguarded subscribers"): one clearly
new and confirmed (`faulty-sale-worker-queue-handler`), one already tracked and re-confirmed rather
than new (`orders-v2-reporting-eda-queue-handler`/legacy pair), one wired-but-unconfirmed carried
forward from Q5 (inventory). Not stopping for JJ on count alone, but Q27 needs an answer before AC5 can
be signed off clean.

## TC6b, how the reporting guard records a skip

Used `261115` (`modifiedDate 2026-08-27T23:48:03Z`) and `WOR19261` (`wmsSentAt 2026-08-27T11:03:15.283Z`),
both from `../BUSY-1159/fixtures.md`. Windows: 23:45-00:15 for the first, 11:00-11:30 for the second.
Both reporting-stream log groups have no retention limit set, so the 2026-08-27 history is intact.

**Guard line, both streams, MEASURED.** `filter-log-events --filter-pattern '"CTC"'` on
`/aws/lambda/staging-orders-v2-order-reporting-stream` returned lines of the exact shape:

```
DEBUG	CTC record, excluded from reporting: <hash> TRANSACTION#<sk> origin=CTC#CIN7_SO#261115
```

One line per row (`TRANSACTION`, `ORDER`, `ITEM#...`, `ADDRESS#SHIPPING`) for both `261115` and
`WOR19261`, all at `DEBUG` level, none at `WARN` or `ERROR`. Same shape on
`/aws/lambda/staging-shipping-v2-shipment-reporting-stream`, with `TRANSACTION`, `ITEM#...` and
`SHIPMENT#...` rows and an extra `company=CTC`/`company=n/a` field depending on row type.

**`Errors` metric, both streams, both windows, MEASURED.** `cloudwatch get-metric-statistics
--metric-name Errors --statistics Sum`, 5 minute periods, spanning each reference's window: every
datapoint returned `Sum: 0.0` on both functions, both windows. Flat.

PASS. The skip is debug level and nothing else moves, exactly as the ticket specifies: the guard sits
before row classification, so a CTC row never reaches the error branch of a pipeline that runs on
every order.

## Fails if conditions

TC4c's own fail condition triggered once (`faulty-sale-worker-queue-handler`), logged as Q27 rather
than left only in this file. TC6b's fail condition did not trigger on either stream.

## Redaction note

Two inline log reads during this slice (not saved as scripts, one-off `filter-log-events` calls to
trace which function actually processes a reference) returned full transaction bodies including
customer name, email and shipping address, before it was clear those fields would be in the payload.
Nothing from those bodies is reproduced above or elsewhere in this file, only reference numbers,
function names and detail-type names. `read-event-wiring.sh` itself never touches a record body, only
ARNs and rule metadata, so it carries no redaction risk itself.

## Scripts written

* `scripts/read-event-wiring.sh`, TC4c. Enumerates EventBridge rules and targets on both buses,
  every Lambda event source mapping in the account, both services' table streams, and any SNS topic
  seen as a rule target. Read only. **Not reviewed.** Row already added to `SCRIPTS.md`.

No script was written for the ad hoc log reads behind the invocation-chain tracing or TC6b, both were
single `aws logs filter-log-events` / `aws cloudwatch get-metric-statistics` calls per reference, at
or under the three-line threshold, not looped or re-run as a set beyond the two references this slice
names. If TC6b needs re-running against a fresh reference later, promote it then.

## Open questions raised

**Q27**, in `../BUSY-1065-OPEN-QUESTIONS.md`: does `faulty-sale-worker-queue-handler` need a CTC
stance. Q5 (inventory service wiring) was already on file and is now further corroborated by this
slice's finding of a second unconditionally-wired function (`ShipmentItemRejectedEventWorker-queue-handler`)
alongside the one it already named; not re-logged as a new Q.

## Teardown

None needed. Nothing was created, changed or invoked. Poller schedule state untouched (this slice does
not touch it).
