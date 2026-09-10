# Result: Slice 03, post create observation

**Ticket:** BUSY-1159
**Verdict:** TC3 PASS, TC4 PASS (strong result), TC12 PASS (after a tool fix), TC13 FAIL (expected, low severity today per the slice's own framing)

## Setup

Watermark before this slice: `2026-08-27T23:56:50.528Z` (MEASURED). Reset to `2026-08-27T23:46:50.468Z`, the value in force just before slice 02's create cycle, per the slice's trigger for TC3.

## TC3, replay is idempotent

MEASURED. Replay cycle `2026-08-28T00:00:53.468Z`: `{"ordersFetched":3,"created":0,...,"watermarkAdvanced":true,"newWatermark":"2026-08-28T00:00:50.549Z"}`. `capture-tc1-evidence.sh --reference 261115` found no new sender log line since the watermark reset. `inspect-ctc-order.sh --reference 261115` re-run and compared byte for byte against slice 02's capture: same 5 orders-table rows, same 5 shipments-table rows, same `wmsSentAt` (`2026-08-27T23:49:16.535Z`, unchanged).

PASS. No second shipment, no second send, `wmsSentAt` unchanged.

## TC4, create on first sight only

MEASURED, not INFERRED, and a strong result rather than a weak one. Checked Cin7 directly for the order's current `modifiedDate` between the two cycles: it had moved from `2026-08-27T23:48:03Z` (at TC1) to `2026-08-27T23:54:03Z` (at the point of the TC3 replay). The order genuinely changed in Cin7 between the two poller sightings, and the SCALE shipment was still completely unchanged (same evidence as TC3 above). This is the case the slice describes as the stronger result: a second sighting of a genuinely edited order was left alone.

PASS. No update reached SCALE. Per the slice's own note, the absence of an update mechanism is not itself a finding here, that is BUSY-1160's scope.

## TC12, consumer guard sweep

First run FAILED on two rows with a tool bug behind it, see Scripts fixed below. After the fix, re-ran clean:

```
PASS     staging-orders-v2-create-order                 ran (2 matching lines)
PASS     staging-orders-v2-placed-order                 guard fired (10 lines)
PASS     staging-orders-v2-validate-address              guard fired (10 lines)
PASS     staging-shipping-v2-order-created                ran (2 matching lines)
PASS     staging-orders-v2-order-reporting-stream         guard fired (58 lines)
PASS     staging-shipping-v2-shipment-reporting-stream    guard fired (95 lines)
PASS     staging-shipping-reporting-buffer-processor      reference absent, as expected
```

Run at `--since-min 120`, well past the 10 minute trust threshold (order created 71+ minutes earlier). MEASURED: every guarded consumer skipped as expected, including the Segment row (`staging-orders-v2-placed-order`), which the slice calls out as the one that matters most.

PASS on all 7 checked rows. `transform-shipments-backup` not checked, as documented (Fargate task, unit-tested only).

## TC13, echo guard hash written

MEASURED, via direct `dynamodb get-item` on the order row (`PK 7e02c7f6-aa5d-5596-8a81-6a0c9313cd29`, `SK ORDER`):

* `lastEmittedPayloadHash`: `null` (absent)
* Full attribute list on the row: `origin, currency, lastModified, status, createdAt, scheduledShipDate, taxPaid, sourceStatus, shipping, subtotal, orderType, updatedAt, packingBrand, paymentMethod, warehouse, carrier, grandTotal, customerEmail, cin7Id, PK, allocatedStore, sourceStage, SK`. No attribute resembling a hash under any other name.

FAIL, per the slice's own definition. This is not a BUSY-1159 acceptance criterion. Recorded as a finding for Lachlan against the LLD: the hash the confirmation leg will depend on is not written on create today, and no ticket in the epic currently owns writing it (confirms Q4's open half). Severity is low today because the confirmation leg does not exist yet, but this becomes high the moment it does, per the LLD's own risk table logic (see Q1/Q4 in the open questions register).

## Scripts fixed (not new)

No new scripts written this slice. Two existing root-level tools were fixed:

* `cin7-watermark.sh`: confirmation message hardcoded item-poller cadence regardless of `--poller`. See `TOOL-NOTES.md`.
* `check-ctc-consumer-guards.sh`: the RAN-kind check under-scanned busy shared log groups and produced a false FAIL on both rows it applies to. See `TOOL-NOTES.md` for the full root cause. Neither of BUSY-1159's other cases depended on the old behaviour, since this is TC12's first run in this plan.

## Teardown

Watermark left at `2026-08-28T00:00:50.549Z` (wherever the replay cycle advanced it to). Schedule left ENABLED, more slices running today.
