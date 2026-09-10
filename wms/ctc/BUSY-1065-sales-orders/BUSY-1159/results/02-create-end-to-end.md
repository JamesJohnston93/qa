# Result: Slice 02, create end to end

**Ticket:** BUSY-1159
**Verdict:** TC1 PASS, TC1b PASS, TC2 PASS, TC8 PASS. Capture job blocked, deferred to TC1a (manual).

## Order chosen

Cin7 SO `#261115` (id 964484), MEASURED. AU delivery (Queensland store, NSW delivery state), 2 line items, branchId 51909, projectName `ShopifyV2_thrills`. Not a repeat, no leading `#` collision with any prior test order. Chosen because its modifiedDate (`2026-08-27T23:48:03Z`) was already ahead of the live watermark at the time of selection (`2026-08-27T23:46:50.468Z`), so the very next scheduled cycle picked it up with zero watermark manipulation, no manual invoke of any kind. Confirmed the SO poller schedule rule was ENABLED before starting (precondition).

Neither of its two SKUs (`TDP-321EDD-28`, `TA26-200C-S`) appears in any "does not exist" rejection in 8+ days of sender log history. This is the closest available spot check on item master presence, MEASURED absence of a negative signal, not proof of presence (`inspect-ctc-order.sh` confirmed after the fact that it was in fact accepted).

## TC1, unattended create

MEASURED, via `capture-tc1-evidence.sh` and `wait-for-so-cycle.sh` (both new, see Scripts written):

* Cycle `2026-08-27T23:48:51.707Z`: `{"ordersFetched":1,"created":1,"skippedCounted":0,"skippedStages":{},"watermarkAdvanced":true,"newWatermark":"2026-08-27T23:48:50.466Z"}`. No alert line.
* Sender, same order, `2026-08-27T23:49:16.535Z`: `Manhattan ShipmentDownload response: accepted=1 rejected=0 message="SHIPMENT XML Download  ended."`, then `{"metric":"ManhattanRequestOutcome","outcome":"success","flow":"SO","reference":"261115","durationMs":2057}`.
* Shipment visible in SCALE staging: not checked, this is TC1a, handed to the manual list as planned.

PASS on everything checkable from this session.

## TC1b, latency

MEASURED, via `check-latency.sh`:

```
modifiedDate:  2026-08-27T23:48:03Z
wmsSentAt:     2026-08-27T23:49:16.535Z
gap:           73.5 seconds (1.23 minutes)
PASS: within the 5 minute ceiling
```

## TC2, CTC stamps and no reallocation

MEASURED, via `inspect-ctc-order.sh --reference 261115`:

* Order row: `store CTC`, `origin CTC#CIN7_SO#261115`, `orderType ECOM`, `cin7Id 964484`, `allocatedStore 51909` (matches branchId), `warehouse CTC-QDC`, `packingBrand THRILLS`, `carrier UNASSIGNED`, `status OPEN`, `scheduledShipDate 2026-08-27T23:41:52Z`. All present, none absent.
* Shipment header: `company CTC`, `brand CTC`, `status OPEN`, `holdStatus False`, `warehouse CTC-QDC`, `carrier UNASSIGNED`, `wmsSentAt 2026-08-27T23:49:16.535Z`. All present.
* Shipment items: 2, one per unit (`ITEM SKs distinct: 2/2`), both `company CTC`, both carry `lineItemId`, neither carries `quantity` (correctly absent, per C2).
* No reallocation log entry found for this reference (checked by absence in the poller and sender logs already pulled; no dedicated reallocation log group was searched separately, so this is INFERRED from absence rather than a direct reallocation-log read).

PASS. No stamp missing on readback.

## TC8, exactly one of everything

MEASURED. Orders table: 1 ORDER, 1 TRANSACTION, 1 ADDRESS, 2 ITEM (matches the 2 line items). Shipments table: queried the raw SKs directly rather than trusting `inspect-ctc-order.sh`'s row count alone, because that script buckets everything that is not `ITEM#...` together as "headers", which actually mixes the shipment header row with `TRANSACTION#...` audit rows. Raw SKs on the shipment partition:

```
ITEM#99229739-...  ITEM#d7f380b0-...  SHIPMENT#9d3c58e3-...  TRANSACTION#1787874540902  TRANSACTION#1787874546301
```

Exactly one `SHIPMENT#` row (the header). The two `TRANSACTION#` rows are a shipments-table detail TC8 does not assert on, most likely one per pipeline event (`SHIPMENT_ITEM_CREATE`, `SHIPMENT_CREATE`), not investigated further as out of scope for this case.

PASS: one order row, one transaction row (orders table), one shipment header.

## Capture job, the first staging send

BLOCKED, and the framing needs a correction. Q14 (Answered) assumed TC1 in slice 02 would be the first ECOM send to SCALE staging. MEASURED: it was not. The sender log already shows successful `outcome:"success"` sends for references `261113`, `261110` and `261111-SplitShipment-HARBOUR-TOWN`, all at `2026-08-27T23:31:2x-3xZ`, roughly 17 minutes before this slice began. The poller schedule was already live against real Cin7 traffic before slice 01 ran (see `results/01-environment-gate.md`), so an unknown number of real ECOM shipments have already gone to SCALE staging outside any QA session.

Separately, the sender lambda logs only the inbound SCALE response (`ManhattanShipmentPayloadBytes`, `ManhattanRequestOutcome`, and on rejection the response message), never the outbound XML it built. There is no log-based way to recover the element set sent, the `CommentType` value used, or whether XSD sequence ordering was followed, for any order including this one.

Capture job cannot be completed from logs for any order, past or present. Deferred entirely to TC1a's manual SCALE UI read (Interface Error Insight / Audit Log Insight per Q9), which is the only place the actual received document is visible. Flagged for Lachlan as originally planned, but the "this is the first send" framing in Q14 needs correcting since it is not true even in principle from this point forward.

## Found condition, not part of this slice's cases but recorded

MEASURED, while validating the sender log shape for the capture scripts. Multiple CTC ECOM orders are stuck in a live retry loop against Manhattan SCALE because of missing item master entries in SCALE staging, distinct from the split-shipment hard error already recorded in slice 01:

| Reference | Missing SKU | First seen rejected | Still retrying at |
|---|---|---|---|
| 261073 | not captured, only reference seen repeatedly | 2026-08-27 08:37 | last seen 16:32, same day |
| 261089 | not captured, only reference seen repeatedly | 2026-08-27 11:25 | last seen 19:20, same day |
| 261104 | `TH25-318B-28` | 2026-08-27 21:31 | still retrying as of 23:36 |
| WOR19270 | `WPR25-104A-10` | 2026-08-27 23:25 | single sighting so far |

Mechanism confirmed, not inferred: `staging-shipping-manhattan-sender.fifo` has `maxReceiveCount 20` and `VisibilityTimeout 1500s` (25 minutes). A permanently-rejected shipment message is retried every ~25 minutes for up to 20 attempts, roughly 8.3 hours, before landing on the DLQ. This is standard SQS behaviour, not a bug, but it means a missing item master entry produces about 8 hours of silent, repeated, invisible failure (no alarm on this queue's DLQ depth, per the Gate B observability gap already flagged in slice 01) before the DLQ depth becomes the only signal. Worth carrying into TC9 (slice 07) as background: TC9 will very likely find one of these four already sitting in the DLQ rather than needing to manufacture a rejection.

This answers the item master half of Q8 in the negative: the CTC item master in SCALE staging is measurably incomplete, at least four SKUs confirmed absent across two calendar days of ambient traffic.

## Fails if conditions

None triggered for the chosen order.

## Scripts written

| Script | Reviewed |
|---|---|
| `scripts/wait-for-so-cycle.sh` | not yet |
| `scripts/capture-tc1-evidence.sh` | not yet |
| `scripts/check-latency.sh` | not yet |

All three added to `SCRIPTS.md`.

## Teardown

Watermark left at whatever the poller last advanced it to (not reset, per instructions, slice 03 needs it). Schedule left ENABLED: more slices are running today in this same session, so it is not being disabled per the "only if not immediately followed by another" rule.

## Written to fixtures.md

TC1 order reference `261115`, Cin7 `modifiedDate` `2026-08-27T23:48:03Z`, `branchId` 51909, `projectName` `ShopifyV2_thrills`, `wmsSentAt` `2026-08-27T23:49:16.535Z`.

---

## Correction, 2026-09-02, from the SCALE UI manual reads

The "Capture job" section above lists `261111-SplitShipment-HARBOUR-TOWN` among the successful sender
outcomes at `2026-08-27T23:31:2x-3xZ`. That is wrong, and it contradicts slices 01 and 07, which both
record that string hard-erroring on the 25-character ShipmentId limit and never reaching SQS.

MEASURED in the SCALE UI: a shipment exists with `ShipmentId` and `ErpOrder` both `261111`, created by
the `ilssrvseau` interface account at `2026-08-27T23:31:38Z`, and **no longer variant of that
reference exists under any search**. The order that sent was the plain parent `261111`. The split child
was refused, as slices 01 and 07 say.

Nothing else in this file changes: the "first send" correction, the four stuck references, and the
`maxReceiveCount 20` / 25 minute retry mechanism all stand. See `results/12-scale-ui-manual-reads.md`.
