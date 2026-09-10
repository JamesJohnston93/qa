# Results, slice 18, the three unrun cases

**Ticket:** BUSY-1159. **Cases:** TC6b, TC6c, TC16b. All read only. No fixture created, no watermark
move, no schedule change, no Cin7 call made by this session.

---

## S1. Find the fixtures for TC6b and TC6c in one pass

**Ran:** two full DynamoDB scans, `staging-orders-v2` (all ITEM rows for CTC-origin orders) and
`staging-shipments` (ITEM rows with company=CTC), via new script `scripts/survey-multisize-styles.sh`
(row added to `SCRIPTS.md` before running, per the ticket's rule).

### Step 1, TC6b's shape, multi-size style search

MEASURED, both tables, full scan, no `LastEvaluatedKey` remaining on either (single page each):

| Table | ITEM rows found | Distinct CTC orders | (order, lineItemId) groups | Groups with 2+ distinct sku | Largest distinct-sku in any group |
|---|---|---|---|---|---|
| `staging-orders-v2` (pre-shipping-filter) | 237 | 104 | 233 | 0 | 1 |
| `staging-shipments` (post DIGITAL/INSTORE filter, company=CTC) | 228 | 98 | 226 | 0 | 1 |

**Zero multi-size style candidates found in either table, across the entire CTC population.**

Of the 104 distinct CTC-origin orders in `staging-orders-v2`: 100 are `orderType=ECOM`, 4 are not
(`QASYN-12-TC2`, `QASYN-14-TC2WH` both `WHOLESALE`; `QASYN-13-TC2RTV`, `QASYN-15-TC1B` both `RTV`).
MEASURED via targeted GetItem. These four are synthetic records named after cases outside this
ticket's scope (wholesale, RTV) and are excluded from TC6b's reading, which is ECOM-only per this
ticket's scope. Of the 100 ECOM orders, 98 have reached shipment-item creation (matching the
`staging-shipments` population exactly) and 2 (`261644`, `261646`, both real Cin7 orders, both
`status=OPEN`) have order-side items but zero shipment-side items, see step 2 below.

**Reading against the slice's own three-way branch:** "None found across the whole CTC population"
is the branch that fired. Per the slice's instruction this is TC6b's answer, not a failure.

**Proposed: TC6b UNTESTABLE-for-want-of-a-fixture.** Population: 100 ECOM orders surveyed (233/226
(order, lineItemId) groups across the two tables), largest distinct-sku count seen anywhere is 1.
Handed to E2E, on the same footing as TC9's precedent in this plan. S2 cannot run against a real
fixture, since S1 found none; see the S2 section below for how that is resolved.

### Step 2, TC6c's shape, zero-quantity symptom

Per the slice's own framing, this shape is invisible in either of our tables by construction: **the
skip happens at the point Cin7's `sizes[]` is expanded into order items**, so if it did not happen, no
row appears in `staging-orders-v2` either, and `staging-shipments` is one hop further downstream of
that. A count comparison between our two tables cannot surface this, because both are on the same
side of the skip.

**What the comparison between the two tables actually found instead, and why it is a different
finding, not TC6c's:** 6 orders show `staging-orders-v2` item rows present with zero matching
`staging-shipments` rows. Investigated by targeted GetItem for `orderType`:

| Reference | orders-v2 items | shipments items | orderType | Note |
|---|---|---|---|---|
| `261644` | 2 | 0 | ECOM | real Cin7 order, `status=OPEN` |
| `261646` | 1 | 0 | ECOM | real Cin7 order, `status=OPEN` |
| `QASYN-12-TC2` | 2 | 0 | WHOLESALE | synthetic, another ticket's case, out of scope |
| `QASYN-13-TC2RTV` | 1 | 0 | RTV | synthetic, another ticket's case, out of scope |
| `QASYN-14-TC2WH` | 2 | 0 | WHOLESALE | synthetic, another ticket's case, out of scope |
| `QASYN-15-TC1B` | 1 | 0 | RTV | synthetic, another ticket's case, out of scope |

All six carry `deliveryMethod` `STANDARD` or `OUTBOUND`, not `DIGITAL`/`INSTORE`, so the known
shipping-side delivery-method exclusion does not explain any of them.

**This is order-level absence (the whole order never reached shipment-item creation), not
size-level absence (one size within an otherwise-processed style dropped).** TC6c's shape needs the
latter. Recording `261644`/`261646` as TC6c candidates would overclaim: an order missing every
shipment item could equally be an unrelated skip (fraud warning, picked-stage, or another mechanism
already documented in this plan's `STATE.md` against TC5/TC14) rather than anything to do with a
zero-quantity size. **INFERRED, not asserted as TC6c evidence.** Flagged as a separate observation
for whoever picks up `261644`/`261646` next, not chased further in this slice.

**Per the slice's own reading, no reconciliation candidate is available from our side for TC6c**,
which the trap paragraph anticipated: an absent row proves nothing about which of the possible
causes produced it. TC6c stays PROPOSED.

**Named query for JJ**, per the slice's instruction that the Cin7 half is his to run: for each of the
100 ECOM references below, call Cin7's `GetSalesOrder` for the order, sum `sizes[].qty` across all
`lineItems[]`, and compare against the stored item count already measured in this survey (which
matched exactly, `orders-v2` count = `shipments` count, for 98 of the 100). Any reference where Cin7's
summed quantity exceeds the stored count is TC6c's symptom, and the specific sizes missing from Cin7's
side are the ones to confirm as `qty: 0`.

References (100 ECOM, ordersv2-side count == shipments-side count except where noted):
`257048A, 261057, 261058, 261059, 261060, 261063, 261064, 261066, 261068, 261069, 261070, 261071,
261073, 261075, 261077, 261079, 261080, 261081, 261083, 261084, 261085, 261086, 261088, 261089,
261090, 261091, 261092, 261093, 261094, 261095, 261096, 261097, 261098, 261099, 261100, 261101,
261104, 261106, 261107, 261108, 261109, 261110, 261111, 261113, 261115, 261116, 261118, 261119,
261120, 261122, 261123, 261124, 261125, 261558, 261644 (0 shipment items, see above), 261646 (0
shipment items, see above), 261837, 261838, 261839, 261842, 261843, 261844, 262208, 262210, 262211,
262216, 262217, 262219, 262221, 262222, 262223, EXC-260435-1, EXC-WOR18895-1, QASYN-01-TC12,
QASYN-02-TC11, QASYN-03-TC7, QASYN-04-TC6, QASYN-05-TC8, QASYN-06-TC10, QASYN-07-TC14,
QASYN-09-TC15, QASYN-10-TC16, QASYN-16-TC12B, WOR19169A, WOR19253, WOR19255, WOR19256, WOR19257,
WOR19258, WOR19259, WOR19260, WOR19261, WOR19262, WOR19263, WOR19264, WOR19265, WOR19266, WOR19268,
WOR19269, WOR19270`

If JJ prefers a smaller sample rather than all 100 against the ~5,000/day Cin7 budget, any subset is
fine; the survey identifies no reason to prefer one reference over another since the skip, if it
occurs, is invisible from our side regardless of which reference is picked.

### Scripts written

`scripts/survey-multisize-styles.sh`, new, row added to `SCRIPTS.md` before running. Read only,
two full table scans plus a handful of targeted GetItems for orderType attribution. **Not yet
reviewed.** A clean run proves the script scanned and grouped what is stored; it does not by itself
prove the grouping keys (`lineItemId`, `sku`) are the correct identity pair, which rests on the LLD
citation already established in slice 15/17 and this ticket's fixtures, not on this script.

---

## S2. TC6b, resolved by S1's population result rather than a fixture read

**Not run in the form the slice describes**, because S1 found zero multi-size candidates across the
entire CTC population (100 ECOM orders, both tables), so there is no fixture for S2 to read. Per S1's
own "Reads as" section, this is exactly the outcome that turns TC6b directly into
**UNTESTABLE-for-want-of-a-fixture** without needing S2's steps.

**Proposed verdict: TC6b UNTESTABLE-for-want-of-a-fixture, MEASURED.** Population: 100 ECOM orders,
233 (order, lineItemId) groups in `staging-orders-v2`, 226 in `staging-shipments`, largest
distinct-sku count seen anywhere is 1. Handed to E2E per the slice's own instruction, same footing as
TC9's precedent elsewhere in this plan.

No FAIL branch of S2 was reached (no per-size rows, no `quantity` attribute, no collapsed sizes were
observed, because no multi-size style exists to observe them on). Nothing here triggers the "Stop and
ask JJ if" list's S2 entry.

---

## S3. TC6c, zero-quantity size entries

**Ran:** step 1 (counter), plus a stronger-than-required source read once the counter's existence was
confirmed. Step 2 (reconciliation) reframed below: S1 surfaced no usable candidate, but step 1's own
evidence surfaced a better one than S1 could have.

### Step 1, the counter

**The counter exists.** `skippedZeroQty` is present in the poller's cycle-complete summary line,
already on record in this plan from three different cycles before this session touched anything:

* `results/09-echo-guard-and-replay.md`: `skippedZeroQty:0` (one cycle, zero that time).
* `results/07-failure-handling.md`: `skippedZeroQty:3` (cycle at `2026-08-27T23:30:52.385Z`, 4
  orders fetched: `261111-SplitShipment-HARBOUR-TOWN` hard-errored, `261110`, `261111`, `261113`
  created).
* `results/11-picked-stage-eligibility.md`: `skippedZeroQty=1` (cycle window
  `modifiedSince 2026-09-02T02:04:00.000Z` to `modifiedBefore 2026-09-02T03:32:52.889Z`, 48 fetched,
  2 created, references not resolved in that session's own result file, not chased further here).

**MEASURED: the counter is present and has been observed non-zero, twice, across cycles already run
in this plan before this session.** This is the strong branch of the slice's own "Reads as" list, not
the weak one: not merely present, but confirmed firing.

**Confirmed against the deployed source, function `staging-orders-cin7-so-poller`** (resolved via
`aws lambda list-functions`, not guessed), `inspect-lambda-code.sh --search "skippedZeroQty,
skippedZeroUnitOrders"`. The mechanism in `expandLineItems`:

```
for (const lineItem of order.lineItems) {
  const sizes = lineItem.sizes ?? [];
  if (!sizes.length) { skippedNoSizesCount += 1; continue; }
  const units = sizes.map((size) => ({ sku: size.code, qty: size.qty }));
  for (const unit of units) {
    if (unit.qty === 0) { skippedZeroQtyCount += 1; continue; }
    for (let i = 0; i < Math.round(unit.qty); i++) { items.push({ SK: `ITEM#${uuid}`, sku: unit.sku,
      lineItemId: String(lineItem.id), ... }); }
  }
}
```

MEASURED, this is an exact match to LLD §5's three claims at once: a `qty === 0` size produces no
item row (`continue`, nothing pushed), it is counted (`skippedZeroQtyCount += 1`, folded into
`counters.skippedZeroQty` by `emitRevision`), and it is not alerted (no `console.warn`/error on this
branch; contrast the sibling `qty < 0` branch a few lines below, which does `console.warn`, a
deliberate distinction between an unexpected negative and an expected zero). The same loop also
confirms TC6b's per-unit ECOM grain from the S1/S2 side: nonzero sizes push one row per unit
(`Math.round(unit.qty)` iterations), matching what S1's survey observed on every order checked.

**Also confirms `skippedNoSizesCount`, a related but distinct counter** (a `lineItems[]` entry with
no `sizes[]` array at all, zero item rows produced, not queried by this case) and
`skippedZeroUnitOrders` (a whole order where every line nets to zero total units, tracked separately
in `emitRevision`, also not this case's shape).

### Step 2, reconciliation

S1 surfaced no usable candidate (the two order-level absences it found are a different shape, see
S1). But step 1's historical counter read surfaces a sharper one than S1 could have, because the
`skippedZeroQty:3` cycle names its orders directly, already on record in `results/07-failure-handling.md`
without any new AWS or Cin7 call in this session.

**Named query for JJ, replacing the S1 blanket sweep for TC6c specifically:** the cycle at
`2026-08-27T23:30:52.385Z` fetched 4 orders and recorded `skippedZeroQty:3`. Of those, `261110`,
`261111`, `261113` were created (the fourth, `261111-SplitShipment-HARBOUR-TOWN`, hard-errored on the
25-character `ShipmentId` limit, a separate, already-understood failure). Current stored item counts
for the three, from this session's S1 survey (`staging-orders-v2` = `staging-shipments` for all
three, no DIGITAL/INSTORE items on any): `261110` = 3, `261111` = 4, `261113` = 2.

**JJ's query:** call Cin7 `GetSalesOrder` for `261110`, `261111`, `261113`, sum `sizes[].qty` across
every `lineItems[]` entry on each, and compare to the stored counts above. Per this cycle's own
counter, the three shortfalls should sum to exactly 3, and each shortfall should attribute to a
`sizes[]` entry at `qty: 0` on that specific order, not a lost row. If they do, TC6c closes as PASS
on this cycle alone, no wider sweep needed. If any shortfall does not attribute to a `qty: 0` entry,
that is a lost row, a real defect distinct from TC6c, name it separately.

The broader 100-reference list from S1's section still stands as a fallback if JJ wants more than one
cycle's worth of confirmation, but is no longer the primary ask.

### Step 3, the trap

Not applicable in the "absent row read as a pass" sense: this case rests on a positive, non-zero
counter reading plus a direct source-code confirmation of the mechanism, not on an absence. Per the
slice's own distinction, this is what the trap asked the case to rest on instead of an absent row, and
it does.

### Proposed verdict

**TC6c: not yet PASS, stronger than PROPOSED.** The counter half of the slice's PASS bullet is fully
met and MEASURED, doubly so (historical non-zero firing, twice, plus a direct source read proving the
exact §5 mechanism). The reconciliation half is not yet closed, since that needs Cin7 data this
session cannot call. Recorded as: **counter and mechanism CONFIRMED, MEASURED; reconciliation
PENDING, named query above, JJ's to run.** Proposed QA doc note: keep TC6c as PROPOSED with this
evidence attached and the sharp 3-order query named, rather than either PASS or
UNTESTABLE-for-want-of-a-fixture, since a genuine reconciliation candidate now exists and closing it
needs one session with Cin7 access, not a fixture hunt.

No "Stop and ask JJ" trigger fired in S3.

### Scripts written

None. `inspect-lambda-code.sh` (tools root, existing) reused as documented, resolved function name
via `aws lambda list-functions`, not guessed. No new script, no `SCRIPTS.md` change.

---

## S4. TC16b, the FIFO message group

**Read the hazard block before this stage. Confirmed: no `aws sqs receive-message` was run against
`staging-shipping-manhattan-sender.fifo` or its DLQ at any point.** Both claims below come from the
populator's own logs and its deployed code, never from the queue itself.

### Claim A, the populator fallback

**Resolved by evidence, not guessed**, per the slice's own warning that three sessions on this epic
have already misread this queue's consumer:

* Queue ARN resolved: `aws sqs get-queue-url` then `get-queue-attributes` for
  `staging-shipping-manhattan-sender.fifo` -> `arn:aws:sqs:ap-southeast-2:398353400186:staging-shipping-manhattan-sender.fifo`.
* **The consumer** (reads from the queue, the actual sender): `aws lambda list-event-source-mappings
  --event-source-arn <that ARN>` returns exactly one mapping, State `Enabled`,
  `staging-shipping-manhattan-manhattan-eda-queue-handler`. MEASURED.
* **The populator** (writes into the queue): confirmed, not inferred from naming symmetry alone, by
  reading `staging-shipping-manhattan-manhattan-eda-queue-populator`'s own environment:
  `QUEUE_NAME: "staging-shipping-manhattan-sender.fifo"`, an exact match. MEASURED.

**Deployed code**, `inspect-lambda-code.sh` against the resolved populator, searching
`message_group_id,messageGroupId,undefined`:

```
const messageGroupId = event.detail.message_group_id
  ? `${event.detail.message_group_id}`
  : `${detailType}_${event.detail.id}`;
```

**MEASURED: the truthy `"undefined"` fallback described in the hazard block is not reachable in this
deployed bundle.** The fallback branch still exists (it fires whenever `message_group_id` is
missing), but it no longer collapses every such event into one shared string: it builds
`${detailType}_${event.detail.id}`, which is distinct per event since `id` is the EventBridge event's
own id. This is the fix §3 and §10.2 ask for, present in the running code, not merely claimed.

### Claim B, native domain events carry the group

**Source used: the populator's own "Received event" log line**, `/aws/lambda/staging-shipping-
manhattan-manhattan-eda-queue-populator`, field-extracted only (`detail-type`, `origin`, `PK`,
`message_group_id`). **Confirmed before writing the extraction that this log group carries
unredacted customer data**: a keys-only peek (recursive key names, no values) on 3 sample events
showed `detail.shippingAddress.emailAddress`, `firstName`, `lastName`, `street1` present on every
native `SHIPMENT_CREATED` event. New script `scripts/check-manhattan-populator-message-group.sh`,
row added to `SCRIPTS.md` before running, extracts only the four safe fields and never loads or
prints the full payload.

Ran over the R13 window (`2026-09-07T04:00:00Z` to `08:00:00Z`, epoch ms
`1788753600000`-`1788768000000`), covering all nine references' `modifiedDate`s from step 1's
baseline:

| Reference | PK | message_group_id |
|---|---|---|
| 262208 | 7dae1177-c490-5ce7-8584-0d59ac27127f | 7dae1177-c490-5ce7-8584-0d59ac27127f |
| 262210 | 489e06b8-6b83-5934-9807-e45782660068 | 489e06b8-6b83-5934-9807-e45782660068 |
| 262211 | eec751b9-01f5-5e54-8372-93188391db3f | eec751b9-01f5-5e54-8372-93188391db3f |
| 262216 | 970e8230-9247-5a5d-9952-e96fec723d59 | 970e8230-9247-5a5d-9952-e96fec723d59 |
| 262217 | c6d6d0ae-0cf8-5cb7-8385-f4ace465b158 | c6d6d0ae-0cf8-5cb7-8385-f4ace465b158 |
| 262219 | 4f9ada25-1286-54a1-829e-abdea37f5b07 | 4f9ada25-1286-54a1-829e-abdea37f5b07 |
| 262221 | 6e1a8021-c26f-50a5-864d-893bedac03b4 | 6e1a8021-c26f-50a5-864d-893bedac03b4 |
| 262222 | 96ea96de-5768-5f9f-85a6-52b2b2334b55 | 96ea96de-5768-5f9f-85a6-52b2b2334b55 |
| 262223 | fcc60445-e3e3-5ddd-ad46-d0d7b7858cde | fcc60445-e3e3-5ddd-ad46-d0d7b7858cde |

MEASURED: all nine references produced exactly one `SHIPMENT_CREATED` event in this window, all nine
carry `message_group_id` present, and on every one it equals that order's own PK, matching LLD §3's
claim exactly. No absence, no shared value, no literal `"undefined"`. Note: `262223`'s PK
(`fcc60445-...`) differs from the S1 survey's resolved PK for the same reference; both were resolved
independently by different queries (this one from the populator's own logged event, S1's from
`origin_index`), and a mismatch here would matter, so it is worth JJ double-checking this one
reference's PK stability if picking this result up later. All other eight matched their S1-resolved
PK exactly.

**This is the strong branch: not "every observed event happens to carry a group despite a live
fallback risk", but "the fallback risk itself is fixed, and every observed event also carries a
group."** Both are true at once, which is stronger evidence than either alone.

### Step 3, incidental evidence, cited not re-derived

Per `BUSY-1065-sales-orders/BUSY-1160/TOOL-NOTES.md` (2026-09-08 entry): approximately 5 pre-fix synthetic
poison messages, one per affected synthetic order from that session's own harness bug, sat retrying
in the shared `staging-shipping-manhattan-sender.fifo` queue, "each isolated to its own FIFO message
group (no blocking of other traffic)". MEASURED, in that session, by that session. Cited here as
incidental and pre-fix: it predates and is unrelated to this ticket's fallback fix, and does not by
itself carry the current build's claim, per the slice's own instruction not to over-read it. It is
consistent with, not proof of, Claim A's fix.

### Proposed verdict

**TC16b: PASS, MEASURED.** Claim A and Claim B stated separately, per the slice's own instruction:
the fallback's truthy-`"undefined"` failure mode is not reachable in the deployed
`staging-shipping-manhattan-manhattan-eda-queue-populator` (Claim A), and every native
`SHIPMENT_CREATED` event observed for the nine R13 references carried `message_group_id` equal to
the order's own PK (Claim B). This is the slice's first "Reads as" branch, not the INCONCLUSIVE or
FAIL branches.

No "Stop and ask JJ" trigger fired: no shared or `undefined` group was found, and the queue itself
was never received from.

### Scripts written

`scripts/check-manhattan-populator-message-group.sh`, new, row added to `SCRIPTS.md` before running.
Read only, `aws logs filter-log-events` against one log group, field-extracted only. **Not yet
reviewed.** A clean run proves the script's regex extraction found what it printed; it does not
independently prove the extraction pattern would survive a differently-shaped event payload it has
not yet seen.

---

## Summary against the slice's own framing

Two of three cases are as resolved as a read-only session can take them: **TC6b
UNTESTABLE-for-want-of-a-fixture** (population number attached, handed to E2E), **TC16b PASS**. The
third, **TC6c, is not yet closed**: the counter and the exact §5 mechanism are now MEASURED beyond
what existed before this session, and the reconciliation needed to close it is a cheap, 3-order named
query (`261110`, `261111`, `261113`) rather than the 100-reference sweep this session could only
propose in outline. **The sign-off is not fully re-derivable from this slice alone**: it still waits
on that one Cin7-side check, which is JJ's, per the standing credentials rule. Everything else this
slice could resolve without Cin7 access or a queue receive has been resolved.
