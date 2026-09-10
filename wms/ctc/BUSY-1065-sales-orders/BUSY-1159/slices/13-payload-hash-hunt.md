# Slice 13, payload hash hunt: is TC13 measuring the right thing

**Ticket:** BUSY-1159. RAN, see `results/13-payload-hash-hunt.md`. Its TC13 finding was later reversed on the current build, see the QA doc.
**Cases:** TC13 (re-test, may be rewritten), TC13b, TC13c, TC13d.
**Numbering note:** there is no slice 12. `results/12-scale-ui-manual-reads.md` belongs to the manual
SCALE UI reads, which were not a slice. This slice writes `results/13-payload-hash-hunt.md`.

## Why this slice exists

TC13 is BUSY-1159's only remaining FAIL, and the premise behind it is probably wrong.

The case reads "`lastEmittedPayloadHash` written on create", and it failed twice on direct DynamoDB
attribute reads. But **the payload hash demonstrably exists.** Slice 09 recorded an idempotencyId of
`CREATE_ORDER#CTC#261119#2026-08-28T00:30:03Z#e24af605`, and the epic's own definition is
`<event>#<origin>#<modifiedDate>#<payloadHash>`. That trailing `e24af605` is the hash, computed on
every emit, sitting in a field we have been reading past for two weeks.

So the honest finding is not "no hash is computed". It is "a hash is computed and is not persisted to
the order row under the name the LLD gives it". Those are different defects with different fixes, and
one of them may not be a defect at all.

**What both prior attempts had in common, and why a third of the same kind is worthless.** Slice 03
read the ORDER row's attribute list directly. Slice 09 read every row under one order's origin in
`staging-orders-v2`. Both are attribute reads on the orders table, on orders that had only ever been
created. Re-running that on more orders or a wider window is the same route. Every part below closes
a different one.

## Preconditions

Read-only throughout except where a part says otherwise. No watermark movement, no poller invoke, no
writes. The poller schedule is DISABLED and stays that way; every order this slice needs already
exists.

Reference set, all already sent and all now `Dispatched` in Cin7 (slice 11 part 3): `261115`,
`WOR19261`, `261106`, `261119`, `261110`, `261111`, `261113`, `261120`, `261122`, `261123`, `261124`,
`261125`.

**Redaction.** The TRANSACTION row type in `staging-orders-v2` carries `customerEmail`,
`addressChanges` and `orderInfo`. Print attribute **names** freely; print **values** only for
attributes whose name matches `/hash|idempotenc/i`. `scripts/list-transaction-rows.sh` already
follows this rule and is the right starting point.

## Part 1. Does a content-derived hash exist at all, and is it stable

TC13b. Free, read-only, no fixture needed.

1. For every reference in the set, list the TRANSACTION rows and their `idempotencyId` values.
2. Split each on `#` and record the trailing segment. Confirm it is present on every row, and record
   its width and character set. A fixed-width hex string across all of them is the signature of a
   hash rather than a counter or a timestamp.
3. **The stability test, and it is the point of this part.** Find two transaction rows for the same
   reference with the same `modifiedDate`, if any exist, and compare their trailing segments. Then
   compare the trailing segments of two *different* references. Same content should give the same
   hash; different content should not.
4. If no reference has two rows at one `modifiedDate`, say so and fall back to the weaker claim: the
   segment is present, fixed width, and differs across orders.

**Passes if:** every emit carries a fixed-width trailing segment, and it varies by order.
**Then:** TC13's "no hash is computed" reading is dead, and TC13 needs rewriting rather than fixing.

## Part 2. Is it persisted anywhere retrievable

TC13c. Read-only. This is the part that decides whether the confirmation leg has anything to read.

The echo guard's requirement is not that an attribute called `lastEmittedPayloadHash` exists. It is
that the hash of the last emitted payload can be retrieved at the moment the poller needs to compare.
So look everywhere it could be retrieved from, not just where the LLD says it is.

1. **The shipments table, which has never been checked.** Slice 09 covered `staging-orders-v2` only.
   Dump the full attribute name list for every row under the order's PK in `staging-shipments`:
   the `SHIPMENT#` header, the `ITEM#` rows and the `TRANSACTION#` rows. Report any attribute whose
   name matches `/hash/i`.
2. **The orders-table TRANSACTION row's payload blob.** Slice 09 read that row's SK and
   `idempotencyId` and deliberately did not open `orderInfo`. Open it now, keys only, and report
   whether the stored payload carries a hash field. This is the single most likely hiding place and
   it has never been looked at.
3. **The GSI.** `idempotency_index` exists for dedupe. Record whether the hash is queryable through
   it, since a hash that can be looked up by index is retrievable whether or not it is on the order.

**Passes if:** the hash is retrievable from at least one durable record without re-deriving it.
**Fails if:** it exists only inside an `idempotencyId` string on an audit row nobody queries by hash,
which is the honest worst case and is still better than "not computed".

## Part 3. Create versus update

TC13d, first half. Read-only.

Both prior reads were on orders that had only ever been created. The LLD's echo guard does an
existence read and compares, which is behaviour that only happens on a **second** sighting. It is
entirely possible the attribute is written on update and never on create.

`261115` is the fixture: TC4 measured its Cin7 `modifiedDate` genuinely moving between sightings while
the shipment stayed untouched, so it has been polled more than once. Re-read its ORDER row now, months
of confirmations later, and report the full attribute name list.

Compare against slice 03's recorded list for the same field set: `origin, currency, lastModified,
status, createdAt, scheduledShipDate, taxPaid, sourceStatus, shipping, subtotal, orderType, updatedAt,
packingBrand, paymentMethod, warehouse, carrier, grandTotal, customerEmail, cin7Id, PK, allocatedStore,
sourceStage, SK`.

**Watch:** every one of these orders is now `Dispatched`, which is terminal and produces nothing, so
none of them has been re-polled recently. A negative here is weaker than it looks and must be reported
as such rather than as a clean absence.

## Part 4. Computed and dropped, or never persisted

TC13d, second half. This is the discriminator and it changes who owns the fix.

Dynamoose `saveUnknown` is false on these tables, so **an attribute the poller emits that the schema
does not declare is dropped on save with no error.** If the emitted event carries the hash and the
persisted row does not, this is a schema declaration gap, which is BUSY-1158's TC1b territory and a
one-line fix. If the emitted event does not carry it either, nothing is being dropped and the poller
simply never sends it.

1. Recover an emitted event payload. Order of preference: the TRANSACTION audit record's stored
   payload from part 2, then the poller's `Pushed {"Entries":[...]}` log line, which logs the outbound
   request before the call and is the only place the emitted shape is visible.
2. Compare its key set against the persisted ORDER row's attribute set.
3. Report which of the two states holds, and name the evidence for it.

**CloudWatch retention is 30 days.** Every reference in the set was sent on 27 to 28 August, so the
log route ages out around 26 September. After that, part 4 can only be run against a fresh order,
which needs the schedule re-enabled. Run this part first if the slice is split.

## Fails if

* Part 1 finds the trailing segment is not fixed width or does not vary by order. Then it is not a
  hash and TC13 stands exactly as written. Stop the slice and say so.
* Any part needs a write, a poller invoke or a watermark change. It does not. If it appears to, the
  part has been misread.
* A value from a redacted attribute reaches the result file.

## What this slice cannot answer

Whether the hash is computed over the **right** fields. A confirmation write-back changes stage,
shipped quantities, tracking and dispatch dates, none of which is mapped, so it must hash identical
and emit nothing. Proving that needs a confirmation to flow, and the confirmation leg does not exist.
That stays with the confirmation epic and is already recorded as D2 and D3.
