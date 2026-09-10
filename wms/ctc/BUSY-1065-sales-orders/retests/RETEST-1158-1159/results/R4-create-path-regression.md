# Result: Slice R4, BUSY-1159 create-path regression

**Ticket:** BUSY-1159
**Verdict:** TC1, TC1b (corrected reading), TC8, TC16, TC11, TC10 PASS. TC6 re-confirmed only against
the pre-1160 fixture, not re-proven under the changed code. TC18 PASS on the our-side half; SCALE half
is R6's. **TC9 and TC15 NOT RE-VERIFIED** - no fresh DLQ rejection was manufactured this session, per
the slice's own instruction that finding or creating one is JJ's call, not this session's.

## Scope, as set by R0

Per R0 Gate B: `staging-orders-cin7-so-poller` and `staging-shipping-manhattan-send-shipment` both
changed on 2026-09-03, so TC6, TC10, TC18 are in scope, not carried. Also changed:
`staging-orders-v2-create-order`, `staging-orders-v2-create-transaction`,
`staging-shipping-v2-shipment-reporting-stream`. Unchanged:
`staging-orders-v2-segment-eda-queue-handler`, `staging-orders-v2-order-reporting-stream` - BUSY-1158's
TC5, TC5b, TC6, TC6b rest on those two and are carried, not re-run here.

## Preconditions

MEASURED. Staging identity confirmed. Watermark `2026-08-28T01:35:45.769Z`, matches R0. `check-ctc-status.sh`:
stage-5 Manhattan-sender DLQ 0, stage-2 orders DLQ 2 (non-CTC Shopify messages, unchanged from R0),
poller schedule DISABLED. All matches R0's baseline exactly, no drift.

## Setup

`find-cin7-sales-order.sh --branch 51909 --with-contact` located several ECOM orders newly modified
today, none previously seen in R0 or R5. Picked four, all confirmed zero existing rows via
`inspect-ctc-order.sh` before touching anything (genuinely unprocessed, not re-runs of R5's targets):

| Reference | modifiedDate | Stage | Lines | Option repeats | packingBrand |
|---|---|---|---|---|---|
| `261842` | 2026-09-04T02:24:05Z | Processing | 1 (1 size) | no | THRILLS |
| `261843` | 2026-09-04T02:24:04Z | Processing | 1 (1 size) | no | THRILLS |
| `261844` | 2026-09-04T02:24:02Z | Processing | 1 (1 size) | no | THRILLS |
| `WOR19169A` | 2026-09-04T02:22:26Z | Processing | 1 (1 size) | no | **WORSHIP** |

None carries a repeated option code, so TC6 rides the documented `WOR19261` fixture as anticipated.
`WOR19169A` is Worship-branded, which gave TC10 a fresh re-verification instead of relying only on the
old fixture.

## The schedule window

Blast radius checked before enabling: a direct Cin7 GET over the prospective fetch window (watermark
minus the poller's own 5 minute lookback) returned exactly these same 4 orders, nothing wider.

* Watermark set: `2026-09-04T02:24:01Z` (dry run, then `--confirm`), read back confirmed.
* Schedule **ENABLED**: `2026-09-04T02:47:05Z`.
* One scheduled cycle observed via `wait-for-so-cycle.sh` (no manual invoke): completed
  `2026-09-04T02:48:02.509Z`. `Cin7SOPollerCycleComplete ordersFetched=4 created=4` and every other
  counter zero, `skippedStages={}`, `watermarkAdvanced=true newWatermark=2026-09-04T02:47:57.171Z`.
* Schedule **DISABLED**: `2026-09-04T02:48:26Z`. Confirmed `State: DISABLED` immediately after.
  Enabled window: 81 seconds, one cycle only.
* Watermark restored to `2026-08-28T01:35:45.769Z` at final teardown, read back confirmed.

## TC1 and TC1b, order through the schedule, and latency

**TC1 PASS.** All 4 orders reached SCALE. `inspect-ctc-order.sh` on each shows `wmsSentAt` set:
`261842` 02:48:43.898Z, `261843` 02:48:39.505Z, `261844` 02:48:42.083Z, `WOR19169A` 02:48:48.194Z.
`inspect-ctc-order.sh` does not print `shipmentId` itself, but a direct query of the shipment header
row (found via R1's method: order PK, `staging-shipments` table, header row) does carry it. For
`261842`: `shipmentId 18145142-944e-54db-9b3a-2bcc6a8e7777`. R6 can look up the other three the same
way rather than searching SCALE by `cin7Id`.

**TC1b, corrected reading needed.** `check-latency.sh --modified 2026-09-04T02:24:05Z --wms-sent-at
2026-09-04T02:48:43.898Z` reports `gap: 1478.9 seconds (24.65 minutes), FAIL: gap exceeds the 5 minute
ceiling` (the tool's own ceiling reads 5 minutes, the slice's target is stated as 3; either way this
figure fails both). **This raw figure is not a genuine latency measurement and should not be read as a
regression.** All 4 orders had already sat in Cin7 for 23-26 minutes with the poller schedule DISABLED
before this session enabled it; the gap is dominated by that pre-existing dwell time, which is an
artefact of how this slice necessarily has to source a fixture (a live order already in Processing,
not one that changes stage at the moment the schedule happens to be live), not of send-path
performance. **The comparable figure is cycle-complete-to-`wmsSentAt`:**

| Reference | Cycle-complete | wmsSentAt | Gap |
|---|---|---|---|
| `261843` | 02:48:02.509Z | 02:48:39.505Z | 37.0s |
| `261844` | 02:48:02.509Z | 02:48:42.083Z | 39.6s |
| `261842` | 02:48:02.509Z | 02:48:43.898Z | 41.4s |
| `WOR19169A` | 02:48:02.509Z | 02:48:48.194Z | 45.7s |

37-46 seconds across all 4, well inside any 3 or 5 minute target and in the same range as the prior
run's 73 seconds. **PASS on this reading.** Recommend the register capture both numbers with this
explanation rather than the raw `check-latency.sh` FAIL standing alone, since read naively it looks
like a severe regression that isn't there.

## TC8 and TC16, row counts and message grouping

**PASS.** `inspect-ctc-order.sh --reference 261842`: 1 ORDER, 1 ITEM, 1 ADDRESS, 1 TRANSACTION, 1
shipment header, 1 shipment item. `list-transaction-rows.sh --reference 261842`: exactly 1
`TRANSACTION` row (`event=CREATE_ORDER`). No duplication under the changed `create-transaction`.

`MessageGroupId`: read from the poller's own `Pushed ... to EventBridge` log line rather than a live
queue read (the send had already completed by the time this was checked; the value is preserved
end-to-end through EventBridge's message-group attribute so reading it from the push log is
equivalent). `message_group_id` = `ce12372a-ff21-557c-881f-4256101aee6f`, identical to the payload's own
`orderId`. Confirms `MessageGroupId` is the order key.

## TC11, bus isolation during a CTC send

**PASS.** Depths before (preconditions) and after (post-cycle) the send window are identical:
stage-2 orders DLQ 2 (same 2 non-CTC Shopify messages, unrelated, carried from R0), every other queue
and DLQ on the sales-order path at 0 waiting / 0 in-flight both times. No UNI reference reached the
CTC sender path (`staging-shipping-manhattan-sender.fifo`, filtered to `company=CTC` by design) during
this send, and the send introduced no new DLQ entry anywhere.

## TC6, TC10, TC18, the mapping cases

**TC10 PASS, freshly re-verified under the changed code.** `WOR19169A`, created and sent in this
session's own cycle, resolved `packingBrand WORSHIP` on our side, and the cycle's own
`packingBrandMisses=0` counter confirms no mapping miss across all 4 orders in the cycle. Stronger than
relying on the pre-existing `WOR19261` fixture alone, since this one ran through the actual
2026-09-03 build. `UserDef3` in SCALE is R6's read.

**TC6, re-confirmed against the existing fixture only, not re-proven under the changed code.** None of
the 4 fresh orders this session created carries a repeated option/SKU, so TC6 could not be re-run
against the new poller/sender build this session; Cin7 is read-only production and manufacturing such
a fixture is out of scope. `WOR19261` (existing, `wmsSentAt 2026-08-27T11:03:15.283Z`, predates the
2026-09-03 deploy) still shows 2 shipment items, both `sku=PDTC25-1003B-One Size`, same
`lineItemId=3478079`, matching the documented shape. This confirms the pre-1160 shape is still stored
correctly, but says nothing about whether the changed `create-transaction`/sender code preserves it,
since this record was never touched by that code. **Flag: TC6 needs a genuinely fresh repeated-option
order to close this properly; none existed today.**

**TC18 PASS on the our-side half.** `address-field-lengths.sh --reference 261106`: `firstName length=5`,
`lastName length=23` (5 + 1 space + 23 = 29, matching the documented "29 to 25" truncation fixture).
Both fields kept at full length on our side, not truncated by us. No value printed, lengths only. SCALE
side (the 25-character truncated ship-to name) is R6's read.

## TC9 and TC15, the DLQ cases

**NOT RE-VERIFIED.** R0 found the stage-5 Manhattan-sender DLQ drained; the three references TC9/TC15
were proved against are gone, and the existing PASS evidence in
`../../BUSY-1159/results/07-failure-handling.md` predates the drain. This session did not go looking for
or attempt to manufacture a fresh rejection (an item-master-absent SKU order for TC9, an
over-25-character reference for TC15), per the slice's explicit instruction that finding or creating
one in live Cin7 is JJ's call. **Recording as NOT RE-VERIFIED, reason: DLQ drain, rather than carrying
the old PASS forward.** Confirmed the stage-5 DLQ is still empty after this session's own send batch
(all 4 orders sent cleanly, no new rejection incidentally produced).

## Scripts written

None new. `wait-for-so-cycle.sh`, `capture-tc1-evidence.sh`, `check-latency.sh`,
`list-transaction-rows.sh`, `address-field-lengths.sh` (all `../../BUSY-1159/scripts/`) used as-is, no
behaviour changes observed to log in `TOOL-NOTES.md`.

## Teardown

* Schedule disabled at `2026-09-04T02:48:26Z`, confirmed `State: DISABLED`.
* Watermark restored to `2026-08-28T01:35:45.769Z`, read back confirmed.
* Orders left in place for R3 and R6: `261842`, `261843`, `261844`, `WOR19169A` (all newly sent this
  session), plus the two mapping-case fixtures `WOR19261` and `261106` (untouched, pre-existing).
* DLQ picture after this session: stage-5 Manhattan-sender DLQ 0, stage-2 orders DLQ 2 (unchanged,
  non-CTC, carried from R0). No new DLQ entries from this session's own batch.

## Stop and ask JJ

* **TC9/TC15 need a decision, not just a flag.** No fresh DLQ rejection exists or was created this
  session. R3 and later slices should not assume these two close during this pass without JJ either
  confirming a fixture or accepting NOT RE-VERIFIED as the final word this round.
* **TC6 needs a genuinely fresh repeated-option order** to be re-proven against the 2026-09-03 build;
  today's fixture pool didn't have one. Cheap to re-check on a future day the same way R5's Gate A
  is, opportunistically.
* Schedule was disabled and watermark restored successfully; neither of those two hard-stop conditions
  triggered.
