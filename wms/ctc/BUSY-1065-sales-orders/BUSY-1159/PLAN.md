# BUSY-1159 test plan

**Ticket:** BUSY-1159
**Plan location:** /Users/james.johnston/Desktop/QA/wms/ctc/BUSY-1065-sales-orders/BUSY-1159
**Tools:** /Users/james.johnston/Desktop/QA/wms/ctc
**Stage:** staging, `ap-southeast-2`

The only control surface is the watermark, reset to pull a chosen window of real Cin7 orders through the schedule. Manual invocation is diagnosis only and invalidates TC1 and TC11.

## Standing setup, applies to every slice

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>     # confirmed in slice 01
# Cin7 credentials come from .env beside the scripts, not from AWS
```

Read the watermark before touching it, and read it back after every set:

```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```

`--poller` defaults to `item`. Pass `--poller so` every time. `--set` without `--confirm` is a dry run.

Disable the poller schedule at the end of any session that is not immediately followed by another.

Any command with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run, not after. See `CLAUDE.md` for the rule and the header every script carries.

## Manual cases

These need a human, mostly because SCALE staging has no programmatic shipment lookup.

| TC | What | Companion slice |
|---|---|---|
| TC1a | Read the SCALE Shipment header and lines in the UI and check the full mapping | 02 |
| TC6 (SCALE half) | Confirm one SCALE line with `Quantity: N` for the repeated option | 05 |
| TC10 (SCALE half) | Confirm `UserDef3` reads `WORSHIP` | 05 |
| TC18 (SCALE half) | Confirm the ship to name is truncated at 25 characters and the full value is on the address name element | 05 |
| TC9 (setup half) | Spot check the SCALE staging item master to find an option code that is absent | 07 |
| TC7 (setup half) | Get an ordinary `us` or `ps` order to flow through the usual path in the same window | 06 |

## IDE cases

| TC | What | Slice | Depends on |
|---|---|---|---|
| TC20 | Feed alarms exist, alert topic subscriber counts recorded | 01 | access |
| TC1 | Unattended create, Cin7 order to SCALE Shipment | 02 | 01 |
| TC1b | Cin7 `modifiedDate` to `wmsSentAt` latency | 02 | 01 |
| TC2 | CTC stamps on order, items, shipment header, shipment items. No reallocation | 02 | 01 |
| TC8 | Exactly one order row, one transaction row, one shipment header | 02 | 01 |
| TC3 | Replay after a watermark reset creates nothing | 03 | 02 |
| TC4 | Second sighting of an edited order is left alone | 03 | 02 |
| TC12 | Consumer guard sweep on the TC1 order | 03 | 02 |
| TC13 | `lastEmittedPayloadHash` written on create | 03 | 02 |
| TC5 | Dispatched, POS and non ecommerce orders skipped and counted | 04 | 01 |
| TC14 | Eligibility of `Fully Picked` and `Partially Picked` orders | 04 | 01 |
| TC6 | Repeated option produces per unit rows and one aggregated SCALE line | 05 | 01 |
| TC10 | Worship packing brand | 05 | 01 |
| TC18 | Ship to name over 25 characters | 05 | 01 |
| TC7 | Universal Store orders unaffected and absent from the CTC path | 06 | 02 |
| TC11 | CTC only routing on the shipping bus | 06 | 02 |
| TC16 | Message group is the order key | 06 | 02 |
| TC9 | SCALE rejection throws, no `wmsSentAt`, message parks on the DLQ | 07 | 01 |
| TC15 | One hard error order does not block valid orders in the same cycle | 07 | 01 |
| TC21 | Replay outside the 5 minute dedupe window | 09 | 02, 03 |
| TC21b | Which guard suppressed the replay, and whether an echo skip counter exists | 09 | 02, 03 |
| TC17 | Watermark width at which the poller times out | 08 | 04 |
| TC19 | Order above the event size limit | 08 | 01 |

## Order

01 gate, then 02, then 03 and 06 which both need 02's reference. 04 and 05 are independent of 02 and can run any time after 01. 07 needs a found condition and may block. 09 needs a freshly sent order and runs with the schedule disabled. 08 runs last because it burns API budget and can leave the feed mid backfill.

All nine slices, 01 to 09, are done. Manual SCALE UI reads (TC1a, TC6/TC10/TC18 SCALE halves) and script review are the only work left, see STATE.md.
