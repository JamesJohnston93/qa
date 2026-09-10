# Result: Slice 07, failure handling

**Ticket:** BUSY-1159
**Verdict:** TC9 PASS. TC15 PASS. Both answered from conditions already found and recorded in earlier slices, no new watermark manipulation or wait needed.

## TC9, SCALE rejection is treated as a failure

Used the found condition from slices 02/06: Cin7 reference `261073`, missing item master entry in SCALE staging (its rejection message names the missing option, consistent with the other 3 references in the same family, see `fixtures.md`).

MEASURED:

* Sender log (from slice 02's full pull, same shape confirmed again here): `Manhattan ShipmentDownload response: accepted=0 rejected=1`, `{"metric":"ManhattanRequestOutcome","outcome":"rejected",...}`, and an ERROR line `Permanent failure sending to Manhattan SCALE: Manhattan rejected shipment <ref>: ... Item "<code>" with company "CTC" does not exist.`
* `inspect-ctc-order.sh --reference 261073`: shipment header exists (6 rows total in the shipments table, so the order and shipment items were created, only the send failed), `wmsSentAt` is **absent**.
* Queue mechanics: `staging-shipping-manhattan-sender.fifo` has `maxReceiveCount 20`. The 3 messages read directly off the DLQ in slice 06 (`261070`, `261073`, `261089`) all carry `ApproximateReceiveCount: 21`, consistent with 20 retries before the 21st failed receive parks the message.

**Precondition substitution.** The slice asks to "confirm the absence in the SCALE UI first." No SCALE UI access this session. Substituted with stronger evidence: SCALE's own rejection message names the missing option code directly, which is more authoritative than a UI spot check would be. Recorded here rather than silently skipped.

PASS. Rejection is never treated as success, `wmsSentAt` is never stamped on a rejected shipment, and the message correctly parks on the DLQ after exhausting retries.

## TC15, containment within a cycle

Used the found condition from slice 01: the poller cycle at `2026-08-27T23:30:52.385Z` both hard-errored on `261111-SplitShipment-HARBOUR-TOWN` (33-character reference, over the 25-character ShipmentId limit) and processed 3 other valid orders in the exact same cycle.

MEASURED:

* Cycle summary: `{"ordersFetched":4,"created":3,"skippedCounted":0,"skippedZeroQty":3,"watermarkAdvanced":true,"newWatermark":"2026-08-27T23:30:50.624Z"}`. 4 fetched, 1 hard error (uncounted in any skip bucket, consistent with slice 01's finding that this failure mode is a build-time ERROR/alert rather than a stage/type skip), 3 created.
* Confirmed by reference, from the `create-order` log in the same window: `261113`, `261111`, `261110` all created. (`261111` here is the ordinary sibling order, distinct from `261111-SplitShipment-HARBOUR-TOWN`, which is a separate Cin7 SalesOrder record for the same order split across shipments.)
* All 3 were previously confirmed sent successfully to Manhattan (`outcome:"success"`, slice 01/02 exploration).
* Watermark advanced exactly once, to `2026-08-27T23:30:50.624Z`, past all 4 orders including the hard-errored one.

PASS. The bad order did not block or roll back the 3 valid orders in the same cycle. No batch-redelivery containment failure of the kind seen on BUSY-1260's purchase order flow.

## Fails if / Blocked if conditions

Neither case was BLOCKED. Both found conditions were already live and did not need to be manufactured.

## Scripts written

None. Everything was a re-read of evidence already captured in earlier slices' log pulls, or a single targeted `inspect-ctc-order.sh` / `aws logs filter-log-events` call.

## Teardown

Both parked DLQ messages (`261073` used as TC9's evidence, `261070` and `261089` alongside it) left exactly where they are. Nothing redriven or purged. Schedule left ENABLED, more slices running today.
