# Result: Slice 03, Universal Store regression

**Ticket:** BUSY-1158
**Verdict:** Fixture found (the search was the expected first obstacle, and it did not come up empty
this time). TC3b PASS, a clean regression result. TC7 INCONCLUSIVE, exactly the shape the slice itself
predicted, but with more detail than "nothing logged." Raised as **Q29**.

## Fixture search

Saved `scripts/find-warehouse-uni-order.sh`. Full scan of `staging-shipments` (178,868 items,
one paginated `aws dynamodb scan` call) filtered to `brand = US`, `status = FULFILLED`, delivery
method not click-and-collect. **14,474 candidates found**, far more than BUSY-1159's "all 5 found were
NEWSTORE" note suggested; that earlier search was evidently narrower or looking at a different
population. Picked the most recent by `createdAt` so the fixture reflects the currently deployed code
rather than a pre-BUSY-1158 record.

**Candidate:** PK `977ade0a-d17c-4c02-a575-bf622f439a96`, SK
`SHIPMENT#ca3c8a5e-b202-46db-8d26-d168e2a94ebf`, shipment id `ca3c8a5e-b202-46db-8d26-d168e2a94ebf`.
`brand US`, `deliveryMethod STANDARD`, `status FULFILLED`, `allocatedStore 100`, `wmsId 0000022925`
(a warehouse system id, confirming this went through a real WMS, not an in-store pick), `origin
SHIPPING_SERVICE`, no `company` field on the row. Created `2026-08-31T00:19:59Z` (today, the freshest
row the scan found), fulfilled by `2026-08-31T01:00:04Z`. No `company`/`cin7Id`/CTC-shaped field
anywhere on the row: this is a genuine incumbent Universal Store order, not a mislabelled CTC one, and
every read below was scoped to this shipment's own PK and shipment id, so nothing observed can be
misattributed to a different (including CTC) record regardless of what else ran in the same window.

Not a stop-JJ trigger: a candidate exists, so the "no fixture" condition does not apply.

## TC3b, quantity-less Universal Store order through shipment item creation

Two `ITEM#` rows under this shipment's PK, **same SKU on both** (`33413679`), both `status FULFILLED`,
both `deliveryMethod STANDARD`. **Neither carries a `quantity` attribute.**

This is a stronger regression check than a single-unit or mixed-SKU order would give: two units of the
identical SKU produced two separate rows rather than collapsing into one row with a `quantity: 2`. The
`quantity` passthrough AC4 added for CTC orders is invisible here, exactly as expected.

**PASS.** No `quantity` attribute found, row count (2) matches unit count (2), key shape
(`ITEM#<uuid>`) matches the existing convention. Not a stop-JJ trigger (that fires only on a TC3b
FAIL).

## TC7, Universal Store order through the dc-packing path

Read `staging-shipping-v2-dc-packing-shipment-create`'s log, filtered to this shipment's PK and
shipment id, in the exact processing window (`2026-08-31T00:19` to `01:00`). 5 log lines, one
invocation, no error, no `"CTC"`/skip text of any kind: **the order was handled, not skipped.** No
misclassification evidence either.

**What the logs show about company resolution** (searched narrowly for `company`/`brand` fragments
only, to avoid the customer name and other personal fields also present in these object dumps, which
are not reproduced here or anywhere in this file):

```
incoming record:              brand: 'US'
in-memory shipment object:    company: undefined
external warehouse response:  "company":"UNIVERSAL"  "brand":"UNIVERSAL"
mid-pipeline object:          company: 'UNIVERSAL'   brand: 'UNIVERSAL'
final object built for save:  company: null
```

The persisted row has no `company` attribute, consistent with the final `null`. So the worker clearly
does compute a `company` value (`UNIVERSAL`) partway through, apparently sourced from or agreeing with
an external warehouse/ERP system's own `company` field, then does not carry it into what gets saved.

**Capture:** handled, not skipped, not misclassified. `company` reaches `'UNIVERSAL'` mid-flight,
matching `brand US`, then is dropped before the row is written.

**INCONCLUSIVE**, exactly as the slice anticipated, and for the reason it named: a Universal Store
order cannot tell inference-from-`brand` and an explicit stored field apart, because they agree on the
answer. What's different from the slice's expected "logs nothing" case is that this worker's logs
*do* show a `company` value being computed, just not one that survives to the saved row. That is worth
naming even though it does not settle AC8: it is more than silence, but not proof either way. Raised
as **Q29**, using close to the slice's own suggested framing (does the worker log its company source,
and what would settle AC8 from outside the repository), plus the specific detail that a computed value
is discarded before save.

Not a stop-JJ trigger under "TC3b fails" (it didn't); TC7 has its own documented inconclusive path and
the slice does not list it as a stop condition.

## Redaction note

The dc-packing log lines for this order include the customer's name and other order details in the
clear, the same shape the tool notes already flag for `faulty-sale-worker-queue-handler` in this
ticket, now confirmed on a second, unrelated consumer. Nothing from those fields is reproduced above;
only the `company`/`brand` fragments were extracted, via a narrow regex over the raw log text rather
than printing full lines.

## Scripts written

* `scripts/find-warehouse-uni-order.sh`, TC3b, TC7. Full-scans `staging-shipments` for a
  warehouse-fulfilled Universal Store candidate, prints the most recent match. Read only. **Not
  reviewed.**

No script was written for the TC3b item-row read or the TC7 log read: each was a single
`dynamodb query` / `logs filter-log-events` call for one reference, at or under the three-line
threshold, not intended to be re-run as a set.

## Open questions raised

**Q29**, in `../BUSY-1065-OPEN-QUESTIONS.md`: does `dc-packing-shipment-create` resolve `company`
from an explicit field or from `brand`, and is discarding the computed value before save on a
Universal Store order deliberate.

## Teardown

None needed. Read only throughout, no order created, nothing polled or invoked.
