# Result: Slice 02, consumer stance on a live order

**Ticket:** BUSY-1158
**Verdict:** TC2b PASS. TC5b PASS. TC4b PASS on the two consumers confirmed guarded, one consumer
(`generate-pickslip`) left genuinely UNKNOWN rather than PASS or FAIL, logged as **Q28**, and a batch
of named consumers left INCONCLUSIVE because this order's lifecycle never exercised them, not because
their guards are in doubt.

## Reference used

`261115`, CTC#CIN7_SO, ECOM. PK `7e02c7f6-aa5d-5596-8a81-6a0c9313cd29`. Order create / Cin7
`modifiedDate` `2026-08-27T23:48:03Z`. Shipment `wmsSentAt 2026-08-27T23:49:16.535Z`. Shipment SK
`SHIPMENT#9d3c58e3-d9b2-5412-aa20-97a3274c8c72`. Shipment status `OPEN` at read time (2026-08-31),
never reached Fulfilled, Rejected, Collected, Held or Address-updated in this table. Same reference
used across slice 01. `inspect-ctc-order.sh` confirms 5 order rows and 5 shipment rows still present,
well inside 30 day retention.

## TC2b, transaction payload block carries the three fields

Saved `scripts/read-transaction-payload.sh`. Read the shipment-side TRANSACTION row
(`staging-shipments`, PK above, `SK TRANSACTION#1787874540902`, the `CREATE_TRANSACTION` row slice 01
already located via the reporting-stream logs).

**MEASURED.** `shipmentInfo` (the payload block) keys: `allocatedStore, carrier, cin7Id, company,
deliveryMethod, holdStatus, orderType, packingBrand, scheduledShipDate, shippingAddress, status,
warehouse`.

```
company:   present = CTC
orderType: present = ECOM
cin7Id:    present = 964484
```

All three named in AC3 are inside the block, not just on the shipment header (`inspect-ctc-order.sh`
already showed them there in slice 01). `shipmentItemInfo[0]` also carries its own `company` field,
present, `CTC`, matching the per-item `company=CTC` reporting-stream markers seen in slice 01.

**PASS.** No absence found. `shippingAddress` sits in the same block; its value is never printed by
the script or reproduced here.

## TC5b, the order behind the Segment guard carried a customer email

Saved `scripts/check-order-email-present.sh`. Read the `ORDER` row on `staging-orders-v2` for the
same PK.

**MEASURED.** `customerEmail: present, length 21`.

**PASS.** An email is present, so the Segment guard PASS carried from BUSY-1159 TC12 is not resting on
an incidental empty-email early return for this reference. Not a stop-JJ trigger (that fires only if
no email were found).

## TC4b, the audited consumers the sweep does not reach

Extended `../../check-ctc-consumer-guards.sh` rather than writing a second script, per the slice's own
instruction. Two rows added, both confirmed live against `261115` first, then added to the shared
script with the exact marker text observed. Change recorded in `TOOL-NOTES.md`. Ran the extended
script at `--since-min 5000` (covers 2026-08-27T23:48 to now with margin):

```
PASS  staging-shipping-v2-dc-packing-shipment-create        guard fired (29 lines)
PASS  staging-shipping-v2-shopify-move-fulfilment-orders    guard fired (29 lines)
```

The script's own count is not reference-scoped for marker-kind rows (same limitation the original
seven rows already have, per its own comment: "a marker can be traced to a reference" but the count
itself is not filtered to one). The reference-specific proof is the raw log trace pulled directly this
session, both from the exact millisecond window `261115`'s shipment was created:

```
staging-shipping-v2-dc-packing-shipment-create:
  <shipment record for 261115, PK/SK/origin=CTC#CIN7_SO#261115>
  "shipment 9d3c58e3-... is a CTC record, not for uniWMS"

staging-shipping-v2-shopify-move-fulfilment-orders:
  "PK 7e02c7f6-..."
  <shipment record for 261115>
  "shipment 9d3c58e3-... is a CTC record, no Shopify fulfilment order to move"
```

Both: DEBUG-shaped, one guard line per invocation, no error, matches Kian's 2026-07-29 comment
("Added a CTC-skip guard to the dc-packing consumers... and the Shopify consumers... (cc-shipment-
collected, move-fulfilment-orders, shipment-rejected)"). **PASS**, marker observed naming the
reference's own PK/shipment id in the same invocation.

### UNKNOWN, not PASS or FAIL: `staging-shipping-v2-generate-pickslip`

Invoked for `261115`'s shipment (confirmed, PK/SK/origin all present in its input log). Logs the
input record twice, then exits clean. **No third line of any kind** (no `"CTC"`, no `"skip"`, no
error), unlike its sibling consumers above which log an explicit guard sentence in the same shape of
invocation. Checked for a side effect instead of a log line: zero calls to the downstream
`staging-shipping-v2-update-pickslip-url` worker for this shipment id, and no `pickslipUrl`-shaped
field on the shipment header row. Re-checked against the other live CTC reference from the same
session (`261116`, shipment `43753d46-...`): identical shape, same two lines, same clean exit, same
absence of a downstream URL update.

Both same-session comparison points are themselves CTC orders, so this cannot distinguish "this
function always logs just two lines, CTC or not" from "this is exactly what an undocumented CTC skip
looks like here." Kian's 2026-07-29 comment claims this consumer got the same guard-plus-regression-
test treatment as dc-packing and Shopify. What's live does not contradict that claim, but it does not
confirm it either, because a real skip and a real no-marker full run would look identical from
CloudWatch alone here, and no downstream artifact answers it. **Not counted as a FAIL** (TC4b's own
fail condition is "processed the reference without a guard line," and there is no positive evidence
of processing, only the absence of one). Logged as **Q28** for Kian.

Not a stop-JJ trigger under "a consumer processed the reference with no guard," since processing was
not confirmed, only invocation.

### `staging-shipping-v2-pickslip-merger`

0 matches, this reference. Kian's comment pairs this with pickslip generation ("proving a CTC shipment
event is ignored and left out of a shared-store merge"), which implies it only fires when two or more
shipments to the same `allocatedStore` need merging. `261115` has `allocatedStore 51909` with no
evidence a second concurrent shipment to that store existed in this window. **Inconclusive**: absence
here is consistent with the merge condition never arising for this reference, not with the guard.
Would need a reference known to have shared a store with another concurrent shipment to settle.

### Consumers checked, event never observed for this order (INCONCLUSIVE, not a guard finding)

This order's shipment has sat at status `OPEN` since creation: no address change, hold, delete,
rejection, fulfilment, collection or reallocation has happened to it in the four days since. Every
consumer below is wired to one of those later-lifecycle detail types, and none shows the reference in
its logs over the same window:

| Consumer | Detail type it would need | Read |
|---|---|---|
| `staging-shipping-v2-dc-packing-shipment-address-update` | `SHIPMENT_ADDRESS_UPDATED` | 0 matches |
| `staging-shipping-v2-dc-packing-shipment-delete` | `SHIPMENT_REJECTED` | 0 matches |
| `staging-shipping-v2-dc-packing-shipment-hold-update` | `SHIPMENT_HOLD_UPDATED` | 0 matches |
| `staging-shipping-v2-allocate-shipment-items` | `ALLOCATE_SHIPMENT_ITEMS` | 0 matches |
| `staging-shipping-v2-shopify-create-fulfilment` | `SHIPMENT_FULFILLED` | 0 matches |
| `staging-shipping-v2-shopify-shipment-rejected` | `SHIPMENT_REJECTED` | 0 matches |
| `staging-shipping-v2-shopify-cc-shipment-collected` | `SHIPMENT_COLLECTED` | 0 matches |
| `staging-shipping-v2-cc-undeliverable-item`, `-transaction` | undeliverable/click-collect family | 0 matches |
| `staging-shipping-v2-cc-partial-fulfilment-transaction` | `TRANS_PARTIAL_FULFILMENT` | 0 matches |
| `staging-shipping-v2-cc-store-updated` | `ORDER_CC_STORE_UPDATED` | 0 matches |
| `staging-orders-v2-send-cx-email` | `SEGMENT_CX_EMAIL` | 0 matches |
| `staging-orders-v2-order-item-status-updated` | `ORDER_ITEM_FULFILLED` or `ORDER_ITEM_REFUNDED` (best-guess mapping by elimination against the dispatcher's other `WORKER_*` keys, not confirmed by an explicit key match) | 0 matches |

**Reading, per the slice's own rule:** "a skip and an absence look the same." These are a third case
neither RAN nor a same-session skip: the triggering business event itself never happened to this
order, CTC or not, so the guard was never exercised either way. Not counted as a PASS. A future slice
would need a reference whose lifecycle actually reached one of these states (address changed, held,
rejected, or reallocated) to test them for real. `staging-orders-v2-shopify-orders-create` and
`staging-orders-newstore-create-order` also read 0, expected and uninformative: their detail types
(`SHOPIFY_ORDERS_CREATE`, `NEWSTORE_ORDER_CREATE`) are origin-specific and a CIN7_SO order never emits
them.

### Named but not resolved to a specific function this session

* **Reallocation.** The dispatcher's rule pattern lists `TRANS_REALLOCATION` as a detail type, but no
  `WORKER_TRANS_REALLOCATION` or `WORKER_REALLOCATION` key exists on `staging-shipping-v2-shipment-eda-queue-handler`'s
  env vars (checked). `WORKER_ALLOCATE_SHIPMENT_ITEMS` exists and was checked above (0 matches) but
  maps to `ALLOCATE_SHIPMENT_ITEMS`, a different detail type. Whether `TRANS_REALLOCATION` has no
  worker at all, or is handled a different way, is UNKNOWN, not investigated further this session.
* **`listOrders` gateway.** Found as `staging-orders-v2-list-orders`, but this reads like a
  synchronous query API (API Gateway-fronted), not an event consumer. TC4b's method (search a log
  group for a reference against a known event trigger) does not apply to it directly; testing whether
  its response correctly excludes or marks CTC orders would need an actual API call against it, not
  attempted this session.
* Click-and-collect beyond the four `cc-*`/`CC_REMINDER`-family functions checked above was not
  further chased; CTC orders in this plan are all `deliveryMethod STANDARD`, so a genuine click-and-
  collect code path may not be reachable from this order at all regardless of guard status.

## Fails if conditions

TC2b and TC5b's fail conditions did not trigger. TC4b's fail condition ("a consumer processed the
reference without a guard line") did not trigger on either of the two consumers confirmed this
session; `generate-pickslip` is UNKNOWN rather than a confirmed trigger, see above.

## Scripts written

* `scripts/read-transaction-payload.sh`, TC2b. Reads one shipment TRANSACTION row, prints the
  payload block's keys and the three CTC field values only. Read only. **Not reviewed.**
* `scripts/check-order-email-present.sh`, TC5b. Reads one order row, prints `customerEmail`
  presence and length only, never the value. Read only. **Not reviewed.**
* `../../check-ctc-consumer-guards.sh` extended, not rewritten. Two new rows, both SKIP-MARKER, using
  guard lines observed live this session. See `TOOL-NOTES.md`.

No script was written for the ad hoc discovery sweep behind the "consumers checked, event never
observed" table: one `filter-log-events` call per candidate function, looped inline once to decide
which were worth adding to the shared script, not intended to be re-run as a set (each candidate's
answer will change independently as this order's lifecycle changes, if it ever does).

## Open questions raised

**Q28**, in `../BUSY-1065-OPEN-QUESTIONS.md`: does `staging-shipping-v2-generate-pickslip` actually
skip CTC shipments, and if so why does nothing in CloudWatch or the shipment row show it.

## Teardown

None needed. Used an existing order, created nothing, polled nothing, invoked nothing except the
extended read-only guard script. Poller schedule state untouched.
