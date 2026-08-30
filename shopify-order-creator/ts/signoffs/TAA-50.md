# TAA-50 sign-off (2026-08-30) — ORDER and ADDRESS row reads

Ticket: https://universalstore.atlassian.net/browse/TAA-50. Branch
`taa-50-order-address-reads`, cut from `main` @ `797f13d` (334/334 offline
green). Owned files only: `src/readers/dynamoReader.ts` (additive),
`tests/dynamoReader.test.js`, four new fixtures under
`ts/fixtures/orders-v2/`. `src/config.ts` untouched — no new poll window was
needed (both new methods compose off the existing `getOrderRows()` GSI
query, same as `getOrderPk`/`getOrderSkuQuantities`/`getOrderTransactions`).
`src/verify/**` untouched.

## Structure — widened in place, per TAA-48's precedent

No new `readers/orderReader.ts`. `getOrderRows()` already fetches every row
for an order (ORDER, ADDRESS#, ITEM#, TRANSACTION#) via `origin_index`; the
three new methods (`getOrderRecord`, `getAddressRows`, `getOrderItemRows`)
are thin compositions over it, same shape as `getOrderPk`/
`getOrderSkuQuantities`/`getOrderTransactions` immediately above them in the
class. Three new pure `rows -> typed[]` functions do the actual parsing
(`orderRecordFromRows`, `addressRowsFromRows`, `orderItemRowsFromRows`),
mirroring `shipmentSummariesFromRows`'s split. `OrderRecord`/`AddressRow`/
`OrderItemRow` all carry a `raw` passthrough. The schema doc-comment at the
top of `dynamoReader.ts` (lines 1-45) is updated in place to name the new
fields under each SK prefix — additive only, no existing line rewritten
beyond appending to it.

## Field findings — the three unpinned fields, captured live

**`onHold`** — an array of reason strings on the ORDER row, present ONLY
while held (absent, not `[]`, on all 10 pre-existing fixtures — confirmed by
a dedicated offline test that loads three of them and asserts `onHold: []`).
Both reason strings TAA-53 named were reproduced live, via two genuinely
different trigger mechanisms:

- **`POTENTIAL_FRAUD`** — order **US #9994** (slot 65, `33906898` x1),
  `fulfillmentOrderHold(reason: HIGH_RISK_OF_FRAUD)` via
  `probe-admin-mutations.js hold`. HOLD_ORDER transaction landed ~55-60s
  after the hold call (slower than TAA-53's ~5-10s sample — one data point,
  not chased). Fixture: `US-hold-fraud-9994.json`.
- **`OUTSTANDING_PAYMENT`** — order **US #9998** (slot 68 base `33754369`
  x1), via `probe-admin-mutations.js edit --add-sku 33906898` (slot 65) —
  the automatic hold TAA-53 documented as firing when an edit adds an
  unpaid item to an already-paid order. This is a DIFFERENT trigger than
  TAA-53's own sample (an unpaid order at creation); same reason string,
  same mechanism, third of the three triggers TAA-53 named not
  independently reproduced this session (see anomaly below). Fixture:
  `US-hold-outstanding-edit-9998.json`.

Both fixtures show `onHold` as a JSON array (`["POTENTIAL_FRAUD"]` /
`["OUTSTANDING_PAYMENT"]`) and `status` unaffected by the hold (`OPEN`
throughout) — hold is an orthogonal dimension to order status, not a status
value.

**`ccStore`-family field** — confirmed present, but NOT on the ORDER row,
and NOT spelled the way the ticket's placeholder name suggested. It lives on
the ITEM# row as **`clickCollectStore`** (plain store-number string, e.g.
`"251"`), and — separately — the CREATE_ORDER TRANSACTION# row's
`itemChanges.added[]` names the identical value **`ccStore`**. Envelope and
row disagree on the field's name, the same class of drift already on record
for `paymentMethod`/`paymentChanges.payments`. Captured from a real click &
collect order, **US #9997** (slot 67, `33923871` x1, pickup at "Universal
Store Belconnen"). Fixture: `US-clickcollect-9997.json`.

**Real CLI defect found and NOT fixed (out of lane):** `cli-order.ts`'s
`--delivery pickup:<name>` flag is broken against the shop's current (2025-
10) Admin API schema — `DraftOrderInput.deliveryMethod` no longer exists
(confirmed via live introspection: the field is entirely absent from
`DraftOrderInput`'s schema). The command throws
`"Field is not defined on DraftOrderInput"` for every pickup order,
unconditionally. The correct 2025-10 shape is a two-step flow:
`draftOrderAvailableDeliveryOptions(input: {lineItems, shippingAddress})` to
list `availableLocalPickupOptions[].handle`, then
`shippingLine: {shippingRateHandle: handle}` on `draftOrderCreate`/`Update`
— confirmed live (this is how order #9997 was actually placed, via a
throwaway probe script, NOT via `cli-order.ts`, since fixing
`clients/shopify.ts`/`cli-order.ts` is outside this ticket's owned files).
**This blocks every future rate-limited use of `--delivery pickup:`,
including TAA-32's click & collect case** — flagging loudly for JJ/TAA-32,
not fixed here.

**`finalPrice`** — chased via a real discounted edit, per the ticket's
instruction to capture-not-guess. **Does not exist anywhere in
staging-orders-v2** — order **US #9998**'s added item (slot 65 SKU on the
slot-68 base order, `orderEditAddLineItemDiscount` fixed $1 off) shows the
discount only as `discountInfo: [{amount: 1, code: "...", type: "SALE"}]`;
`grandTotal` (49) is already net of the discount against `subtotal` (50).
This is byte-for-byte consistent with TAA-53's edit-chain finding
(discount folds into `grandTotal`, no separate event or field). Confirmed,
not modeled — `OrderItemRow` deliberately has no `finalPrice` field, and a
test (`"...no finalPrice field exists"`) asserts `discounted.finalPrice ===
undefined` against the live fixture as a tripwire against ever adding it
without new evidence. **Deferred to TAA-56**, per the ticket.

## Anomaly, not chased

A second attempt to capture `OUTSTANDING_PAYMENT` via `create-pending`
(order **US #9996**, slot 66, `33463964` x1 — the same
`orderCreate(financialStatus: PENDING)` mutation TAA-53 used for its
`markAsPaid` probe) never landed a single row in `staging-orders-v2` after
6+ minutes of polling, despite the order genuinely existing in Shopify
(confirmed `displayFinancialStatus: PENDING` via a direct dump). TAA-53's
own sample of this exact mutation landed and held within ~7s. Not
investigated further — the field shape this ticket needed was already
pinned via the other two routes (#9994, #9998); flagging for whoever next
touches `orderCreate(financialStatus: PENDING)` ingestion timing. Order
#9996 is a burned spare, unused otherwise.

## Orders burned (pool slots 65-68 only, per the wave-2 ground rules)

| Order | Store | Slot | SKU | Purpose |
| --- | --- | --- | --- | --- |
| #9994 | US | 65 | 33906898 | `POTENTIAL_FRAUD` hold (kept, unreleased) |
| #9995 | US | 65 | 33906898 | Spare — accidental duplicate `create` call (script output was truncated the first run, re-ran not realizing the first had already succeeded) |
| #9996 | US | 66 | 33463964 | `create-pending` for `OUTSTANDING_PAYMENT` route — anomaly above, never landed |
| #9997 | US | 67 | 33923871 | Click & collect (`clickCollectStore` capture) |
| #9998 | US | 68 (base) + 65 (added item) | 33754369 / 33906898 | Edit + discount (`OUTSTANDING_PAYMENT` route 2, `finalPrice` chase) |
| #3323 | PS | 65 | 33977737 | Cross-store live confirmation (plain order, no special state) |

No collision with slots burned by TAA-53 (53-64) or TAA-46 (0-13, 20).

## Tests and build

`npm run build` + `npm test`: **348/348 green** (334 baseline + 14 new —
`orderRecordFromRows`/`addressRowsFromRows`/`orderItemRowsFromRows` unit
tests plus fixture-driven tests against all four new fixtures and three
pre-existing ones, confirming `onHold: []` on fixtures that predate this
ticket).

## Live confirmation — both stores, via the actual `DynamoReader` methods

Not just fixture parsing — `getOrderRecord`/`getAddressRows`/
`getOrderItemRows` called live against a fresh `DynamoClient`:

- **US #9994** (fraud hold): `OrderRecord.onHold` = `["POTENTIAL_FRAUD"]`,
  `AddressRows` = BILLING (no email) + SHIPPING (email present),
  `OrderItemRows` = one STANDARD row, `clickCollectStore: null`.
- **US #9997** (click & collect): `OrderItemRows` = one CLICKCOLLECT row,
  `clickCollectStore: "251"`.
- **PS #3323**: `OrderRecord`/`AddressRows` parse identically to US, same
  field names, no cross-store drift — consistent with every prior TAA-46/48
  cross-store check.

## Not done, deliberately

No changes to `cli-order.ts`/`clients/shopify.ts` (the pickup-delivery
defect above is out of this ticket's owned files — flagged, not fixed). No
`finalPrice` modeled (deferred to TAA-56, no fixture would support it). No
touch to `src/verify/**` (TAA-52's lane) or `ts/scripts/probe-admin-
mutations.js` (run only, per the ground rules).
