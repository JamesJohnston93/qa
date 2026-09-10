# Result: Slice 13, payload hash hunt

> **Superseded in part, 2026-09-08.** TC13c below measured that no retrievable standalone payload
> hash existed anywhere. That was measured on the pre-deploy build. R11 and R13 found
> `lastEmittedPayloadHash` present on create on the current build, matching the emitted payload and
> unchanged by an echo. TC13c's FAIL does not describe the current build and must be re-stated on a
> current-build order row before it is cited or written into the QA doc. TC13b and TC13d stand.


**Ticket:** BUSY-1159
**Verdict:** TC13b PASS (weaker claim). TC13c FAIL. TC13d part 1 UNKNOWN (weak negative only). TC13d
part 2 decisive: the hash is never emitted as a standalone attribute, so nothing is being dropped by
Dynamoose. TC13 should be REWRITTEN, not left FAIL and not reassigned to BUSY-1158. Recommendation at
the bottom.

Read-only throughout. No writes, no poller invoke, no watermark change. Schedule confirmed still
DISABLED at the end.

## Part 1 (TC13b): does a content-derived hash exist, and is it stable

MEASURED, all 12 references in the fixture set, via new script `scripts/hash-segment-check.sh`:

```
Rows: 12
Widths seen: [8]
All hex lowercase: True
Present on 12/12 rows
Distinct segments: 12/12
No reference has two TRANSACTION rows at the same modifiedDate.
```

Every reference has exactly one TRANSACTION row, so the same-reference-same-modifiedDate stability
test the slice asks for has no fixture: no order in this set has been polled twice while landing on
the same `modifiedDate`. Falling back to the weaker claim the slice names: the trailing segment is
present on every row (12/12), fixed width (8 hex characters, lowercase, on all 12), and distinct
across all 12 different orders. That is the signature of a hash rather than a counter or timestamp,
just not proof of stability against identical input.

**TC13b PASSES on the weaker claim.** TC13's "no hash is computed" reading is dead. Values (all match
`/idempotenc/i`, redaction rule permits): `261115 bb1dffc4`, `WOR19261 90a1d1a0`, `261106 b87fa292`,
`261119 e24af605`, `261110 1fcb1c75`, `261111 e4c2cfa0`, `261113 009f21ce`, `261120 44bba32c`,
`261122 88878e9c`, `261123 ef20708f`, `261124 24c9bc98`, `261125 31d5f0d2`.

## Part 2 (TC13c): is it persisted anywhere retrievable

MEASURED, order `261119` (PK `1d9f8a41-7b09-5189-932e-e0ed6aaf6d43`).

**staging-shipments, never checked before.** 5 rows under the order's PK: 2 `ITEM#`, 1 `SHIPMENT#`, 2
`TRANSACTION#`. Attribute names on every row:

```
ITEM#...      PK, SK, allowedStores, company, createdAt, deliveryMethod, holdStatus, lineItemId,
              orderedAt, rejectedStores, shipmentId, sku, status, updatedAt, weight
SHIPMENT#...  PK, SK, allocatedStore, brand, carrier, cin7Id, company, createdAt, deliveryMethod,
              holdStatus, orderType, orderedAt, origin, packages, packingBrand, scheduledShipDate,
              shipmentId, shippingAddress, status, updatedAt, warehouse, wmsSentAt
TRANSACTION#1787877069270  PK, SK, category, createdAt, event, idempotencyId, origin,
              shipmentInfo, shipmentItemInfo, updatedAt
TRANSACTION#1787877074559  PK, SK, category, createdAt, event, idempotencyId, origin,
              shipmentInfo, updatedAt
```

No attribute matching `/hash/i` at the top level or inside the nested `shipmentInfo` /
`shipmentItemInfo` maps (opened, keys only, none present). Worth recording as a side finding: the
shipment-side `idempotencyId` is a different shape entirely, `SHIPMENT_ITEM_CREATE#<PK>` and
`SHIPMENT_CREATE#<PK>`, two segments only, no `modifiedDate`, no trailing hash. Whatever the hash is
for, it is an orders-table concept only.

**The orders-table TRANSACTION row's `orderInfo` payload, deliberately left unopened in slice 09.**
Opened now, keys only. Top-level keys on `TRANSACTION#1787877056557`: `PK, SK, addressChanges,
category, createdAt, customerEmail, event, idempotencyId, itemChanges, orderInfo, origin,
paymentChanges, updatedAt`. Nested map keys, all checked against `/hash/i`, none matched:

```
orderInfo        allocatedStore, carrier, cin7Id, lastModified, orderType, packingBrand,
                 scheduledShipDate, sourceStage, sourceStatus, warehouse
itemChanges.added[0]   costPrice, deliveryMethod, grandTotal, lineItemId, sku, status, subtotal, taxPaid
paymentChanges   currency, grandTotal, payments, shipping, subtotal, taxPaid
addressChanges.shipping  city, country, countryCode, firstName, lastName, postalCode, state, street1
```

No hash field anywhere in the stored payload. This is the single most likely hiding place named in
the slice, and it is empty.

**The `idempotency_index` GSI.** `describe-table` confirms it exists, HASH key `idempotencyId`
(the whole composite string, not the hash segment alone). Queried directly with the known full
string and it works: `Query idempotencyId = "CREATE_ORDER#CTC#261119#2026-08-28T00:30:03Z#e24af605"`
returns the one TRANSACTION row, 1 result. But a DynamoDB `Query` key condition on a HASH-only index
takes an exact match, not a suffix or `contains`, so this index is queryable **by the full string
you already have to already know**, not **by the hash alone**. To use it as a lookup you would need
`event`, `origin` and `modifiedDate` down to the second before you could ask it anything, at which
point the hash contributes nothing you did not already have. It does not function as a hash-keyed
retrieval path.

**TC13c FAILS**, on the slice's own stated worst case: the hash exists only inside an `idempotencyId`
string on an audit row (the orders-table TRANSACTION row), and no durable record and no index makes
it retrievable by the hash value itself.

## Part 3 (TC13d, first half): create versus update

MEASURED, `261115`. Current ORDER row attribute list, 23 attributes:

```
PK, SK, allocatedStore, carrier, cin7Id, createdAt, currency, customerEmail, grandTotal,
lastModified, orderType, origin, packingBrand, paymentMethod, scheduledShipDate, shipping,
sourceStage, sourceStatus, status, subtotal, taxPaid, updatedAt, warehouse
```

Identical, attribute for attribute, to the list slice 03 recorded. Still exactly 1 TRANSACTION row
(`TRANSACTION#1787874532288`, unchanged idempotencyId). No hash under any name, same as before.

**This is a weak negative and is reported as such, not as a clean absence.** Slice 11 already
established all 12 fixture orders are now `Dispatched`, terminal, and none has been re-polled since.
`261115` specifically has had zero second sightings since slice 03: the create-versus-update question
is UNKNOWN, not answered. TC13d's first half stays open pending a genuinely re-polled order, which
does not exist in this fixture set.

## Part 4 (TC13d, second half): computed and dropped, or never persisted

**Decisive.** Recovered the exact emitted event for `261119` from the poller's own `Pushed
{"Entries":[...]}` log line (`/aws/lambda/staging-orders-cin7-so-poller`, event at
`2026-08-28T00:30:51.834Z`, matched to this order by `origin CTC#CIN7_SO#261119` and by
`idempotencyId` matching the value already on file). Top-level keys of the emitted `Detail` JSON:

```
orderId, category, event, origin, idempotencyId, message_group_id, customerEmail, itemChanges,
paymentChanges, addressChanges, orderInfo
```

`idempotencyId` value: `CREATE_ORDER#CTC#261119#2026-08-28T00:30:03Z#e24af605` (matches Part 1 and
Part 2 exactly). Nested key sets under `itemChanges`, `paymentChanges`, `addressChanges` and
`orderInfo` were compared field for field against what Part 2 found stored on the TRANSACTION row's
`orderInfo`/`itemChanges`/`paymentChanges`/`addressChanges`, and against the persisted ORDER row's
attribute set from Part 3. **They match exactly, key for key, at every level.** No key resembling a
hash exists anywhere in the emitted event outside the `idempotencyId` string.

**Finding: the poller never emits a standalone hash field at all.** The hash is computed once, at
emit time, purely to build the trailing segment of `idempotencyId`. It is not attached to the event
`Detail` as its own attribute, so there is nothing for Dynamoose's `saveUnknown:false` to drop on
save. This rules out the schema-gap explanation: **this is not BUSY-1158 TC1b's territory.** The
persisted row is missing `lastEmittedPayloadHash` because the event never carried one, not because an
undeclared attribute was silently discarded.

## Stop conditions checked

Part 1's stop condition (trailing segment not fixed width, or not order-varying) did not trigger.
No write, invoke or watermark change was needed or made. No redacted attribute value reached this
file: every value printed above matches `/hash|idempotenc/i`; every other attribute is named, not
valued.

## Recommendation for TC13

**Rewrite TC13, do not leave it FAIL and do not send it to BUSY-1158.**

The measured facts, in order of how much they change the original case:

1. A fixed-width, order-varying hash is computed on every emit (TC13b). "No hash is computed" is
   settled as false.
2. That hash is never exposed as a standalone attribute anywhere it could be looked up: not on the
   ORDER row, not on any `staging-shipments` row, not inside the stored `orderInfo` payload, and not
   through the `idempotency_index` GSI in any way that takes a hash as input (TC13c).
3. It is not exposed because the poller never puts it there in the first place, not because a
   declared schema drops it. The emitted event's key set matches the persisted rows' key set exactly,
   with no hash field on either side (TC13d part 2). The create-versus-update question this slice also
   tried to close (TC13d part 1) stays genuinely unanswered, no fixture available, not because the
   answer trends either way.

New TC13 reading: "A payload hash is computed on every emit and embedded in `idempotencyId`'s
trailing segment. It is not persisted, indexed or otherwise retrievable as a named attribute anywhere
in the system, by design of the current emit shape, not as a side effect of a schema gap." This is a
finding for Lachlan against the LLD, same owner as before, but the LLD needs to say either (a) the
named `lastEmittedPayloadHash` attribute is a real requirement and the poller needs a code change to
emit and persist it, or (b) an echo guard is meant to work by re-parsing `idempotencyId`'s suffix,
in which case the LLD's own attribute name is wrong and should be corrected rather than built. Either
way this is a design decision, not a bug this ticket can fix, and BUSY-1162 already carries the wider
echo-guard-mechanism thread this attaches to (see the QA doc's "Replay suppression mechanism" drift
row).

## Scripts written

`scripts/hash-segment-check.sh`, not reviewed yet. Calls `list-transaction-rows.sh` once per
reference and reports the trailing segment's width, character set, presence rate, cross-order
variance, and runs the same-modifiedDate stability comparison if any exist. Extends the existing
`list-transaction-rows.sh` rather than re-implementing its DynamoDB query or its redaction rule.

## Teardown

No watermark change, no schedule change. Schedule confirmed still DISABLED. No fixture consumed;
all 12 orders read were already `Dispatched` and untouched by this slice.

---

## Decision on this slice's recommendation, 2026-09-02

The recommendation above was to rewrite TC13. **It was withdrawn instead**, and moved to the
confirmation epic as D17. Three reasons, and the slice's own measurements are what make them safe.

**1. It was never this ticket's case.** `lastEmittedPayloadHash` appears in no BUSY-1159 acceptance
criterion. QA proposed it at plan creation, P1 in `PROPOSALS.md`, against an LLD attribute the scope
section already recorded as owned by nobody.

**2. It cannot be exercised here.** The guard exists to stop a confirmation write-back bouncing back
into SCALE. The confirmation leg is unbuilt, and the eligibility gate at step 4 excludes `Dispatched`
and, on the deployed build, `Fully Picked`, both before the payload is built at step 5. The one live
path is `Partially Picked`, which the LLD keeps eligible, and that belongs to the confirmation epic.

**3. The severity in every prior doc was wrong and has been retracted.** "High the moment the
confirmation leg exists" was QA's adjective, not a measurement. A duplicate emit produces an identical
SAVE on the same `ShipmentId`: a no-op overwrite pre-wave, and post-wave a rejection that retries
about twenty times over 8.3 hours into the DLQ. Alert noise, not double-picking, and the post-wave
half is INFERRED from BUSY-1160's unrun TC17.

**Everything measured above stands and is the baseline D17 starts from.** Part 4 in particular is the
finding worth keeping: nothing is being dropped, so this is not a schema gap and not BUSY-1158 TC1b's
territory, which is what the epic would otherwise have assumed.

**What survives as live work,** and neither is a test: a decision for Lachlan on whether the named
attribute is a real requirement or stale LLD text, and the unnamed suppression this slice did not
chase, that slice 09's cycle fetched 8 orders, created 5, and moved no skip counter for the other 3.
The leading explanation is that this build is create-only and the present-order branch does nothing,
which BUSY-1160 slice 01 Gate A settles.

## Audit corrections, 2026-09-02

Two claims in the decision note above are broader than the measurement.

* **"Nothing is being dropped by Dynamoose"** was measured on one order, `261119`, by comparing its
  emitted event key set to its persisted rows. That supports "no hash key exists for this order for
  `saveUnknown: false` to drop", which is enough to rule out the BUSY-1158 TC1b schema-gap
  explanation. It is not a general property of the schema.
* **The step 4 before step 5 ordering**, which carries the whole unreachability argument for
  withdrawing TC13, is read from the LLD's process order. It has never been measured at runtime. If
  the gate does not in fact precede the payload build, the guard is reachable on `Fully Picked` and
  `Dispatched` too, and D17 is bigger than it currently looks.
