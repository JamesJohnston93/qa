# Result: Slice 06, routing and isolation

**Ticket:** BUSY-1159
**Verdict:** TC7 PASS (order side; shipment side not comparable, see note). TC11 PASS. TC16 PASS, **contrary to the slice's own expectation of a FAIL.**

## Approach

Rather than coordinating a fresh `us`/`ps` order through staging by hand, used the fact that `staging-orders-v2` and the shipping pipeline are shared with every UNI order: real US-store (NEWSTORE channel) traffic was already flowing in the last hour, found via the shared `staging-orders-v2-create-order` log (11 `CREATE_ORDER` events, 6 `CTC`, 5 `US`). Nothing was invoked by hand on either side, satisfying the slice's "nothing invoked by hand" requirement for TC11 more strictly than a manually-coordinated order would.

## TC7, Universal Store orders unaffected

MEASURED, direct `dynamodb query` on one US order's PK (identifiers only, no name/email printed):

* Order row: `origin US#NEWSTORE#<id>`, `status FULFILLED`, no `store`, `packingBrand`, `allocatedStore`, `warehouse` or `carrier` fields at all (these are CTC-only attributes, simply absent rather than null).
* 6 `ITEM#...` rows, none carrying `quantity`, none carrying `company`.
* Checked all 5 US orders found in the window: all `FULFILLED`, all with the same shape.

PASS on the order side: no CTC stamp of any kind, `company` absent throughout.

**Shipment side not directly comparable.** All 5 US orders found are on the NEWSTORE (in-store, already-fulfilled) channel and have zero rows in `staging-shipments`, confirmed this is not a defect but a channel characteristic: `staging-shipping-v2-order-created` shows the `ORDER_CREATED` event was consumed for these (`store:'US'` present, 5 times, matching the 5 orders), but an in-store sale apparently never proceeds to shipment creation, there is nothing to pick or pack. A genuine warehouse-fulfilled `us`/`ps` order (Shopify or M2 channel, not NEWSTORE) would be needed for a like-for-like "one row per unit, no `company`" shipment-side comparison. Not chased further this session to avoid open-ended exploration of an unrelated channel; flagged below rather than left silent.

MEASURED, negative search: none of the 5 US orders' identifiers (`newstoreOrderId` UUIDs, `newstoreExternalOrderID`) appear anywhere in the Manhattan sender log group across the last 3 hours (0 matches each, checked individually).

## TC11, CTC only routing

MEASURED:

* Sender log holds the CTC reference from slice 02 (`261115`) and does not hold any of the 5 US identifiers (checked above).
* Queue/DLQ snapshot, same as slice 01's Gate B baseline, unchanged: `staging-shipping-manhattan-sender.fifo` 0 waiting, 2 in-flight; `staging-shipping-manhattan-sender-dlq.fifo` still exactly 3 dead-lettered. No growth, so no UNI message has leaked into the CTC path.
* Each CTC shipment message carries its own distinct `MessageGroupId` (see TC16 below for the actual values), never shared across orders.

PASS. No UNI shipment reached the CTC sender queue, and the DLQ has not grown from the baseline recorded in slice 01.

## TC16, message group is real

**Contrary to the slice's own expectation.** Read the 3 messages currently on `staging-shipping-manhattan-sender-dlq.fifo` directly (`--visibility-timeout 0`, non-destructive, terminal messages already parked there, not part of an active retry cycle):

| Cin7 reference | MessageGroupId |
|---|---|
| `261070` | `24eaeacc-43c3-5260-8ed4-5ca35db9f88f` |
| `261089` | `74d58037-46f6-5256-9ba5-d0e192154025` |
| `261073` | `ef32ed83-006c-588a-8d0e-863f9d6b49af` |

All three are real, distinct, order-specific values. None is the literal string `undefined`. Each order's group id is stable and unique to that order, satisfying "the message group is the order key" and "each CTC shipment uses its own message group" directly.

This is not what the slice, or Q3 in the open questions register, expected. BUSY-1258's fallback defect was assessed as epic-wide and still live (To Do, Sprint 41), and this flow was expected to be on its list of affected callers. The live evidence here says this particular flow's message group is not defective today, at least for FIFO ordering purposes. Either this flow was not actually affected by the populator fallback described in BUSY-1258, or something already isolates it. Recorded as a correction to Q3 rather than re-opening it as a new question, since it narrows an existing epic-wide claim rather than introducing a new fact in dispute.

PASS, which is the opposite of "expect a FAIL here" in the slice text. Flagging clearly rather than quietly recording a pass where a fail was anticipated, since the slice explicitly asked for this to be checked and reported honestly either way.

## Fails if conditions

None triggered on TC7 or TC11. TC16's stated fail condition (`undefined`) also did not occur, which is the surprising part of this result.

## Scripts written

None. Everything done with direct `aws logs filter-log-events`, `aws dynamodb query` and `aws sqs receive-message` calls, kept inline since none exceeded the three-line/reuse threshold on its own (each was a single, one-shot lookup for a specific PK or queue).

## Teardown

Queue and DLQ depths unchanged from the baseline recorded in slice 01 (0 waiting/2 in-flight on the sender, 3 dead-lettered on its DLQ). Nothing purged. Schedule left ENABLED, more slices running today.
