# Result: Slice 11, picked stage eligibility and cancellation on loss of eligibility

**Ticket:** BUSY-1159
**Verdict:** TC14 stays BLOCKED on its ECOM half, but Q31 is now answered rather than suspected. A
named, attributable, single-cycle measurement CONFIRMS the deployed poller skips `Fully Picked` on
stage, contradicting dev's corrected 2026-09-01 statement that all four stages are eligible. Part 3
(Q30) found nothing to learn: none of the 12 previously-sent orders reached a picked stage.

## Gate A, finding a target

`scripts/find-picked-stage-orders.sh --since 2026-09-01T21:29:12Z` (6 hour window): 18 orders at
`Fully Picked` or `Partially Picked` (MEASURED). Every company name reads as a wholesale retail
account. Two resolved directly with `find-cin7-sales-order.sh --with-contact` rather than trusting
the name:

* `S5310-27A` (branch 51909, the ECOM/Main-Warehouse branch, company "Staff - Reid Pownall", the one
  candidate that did not look like a store): contact group `Staff` -> WHOLESALE (MEASURED).
* `975303Sep26` (branch 51908, Fully Picked, `modifiedDate 2026-09-02T02:09:09Z`, company "Kalbarri
  Jetty Surf (WA)"): contact group `Retailer - Domestic` -> WHOLESALE (MEASURED). **Chosen as target.**

No ECOM order at a picked stage turned up. Same result as slices 04 and 08: zero ECOM in every check
run so far. Per the slice text, this is the likely case, so Part 2's control is mandatory.

## Part 1, the controlled poll

Snapshot (MEASURED): watermark `2026-08-28T01:35:45.769Z` (`--poller so`), schedule DISABLED, both
matching `STATE.md` exactly.

Floor set to `2026-09-02T02:09:00.000Z` (a few seconds before the target's `modifiedDate`), confirmed
and read back. One manual invoke (`invoke-so-poller.sh`, schedule already disabled, no `--force`
needed):

```
Cin7PollerCycleStart      watermark=2026-09-02T02:09:00.000Z modifiedSince=2026-09-02T02:04:00.000Z modifiedBefore=2026-09-02T03:32:52.889Z
Cin7SOFetched             page=1 count=48
Cin7SOPollerCycleComplete ordersFetched=48 created=2 skippedCounted=4 skippedStages={'Fully Picked': 1}
                          skippedZeroQty=1 skippedZeroUnitOrders=0 oversized=0 packingBrandMisses=0
                          watermarkAdvanced=True newWatermark=2026-09-02T03:32:52.889Z
                          requestsThisCycle=3
```

`inspect-ctc-order.sh` for `975303Sep26`: 0 rows, no order row, no shipment header (MEASURED). Expected
regardless of the stage question, since the order is also wholesale.

### Attributing the single `Fully Picked` count

The window the poller actually used was `modifiedSince 2026-09-02T02:04:00.000Z` to
`modifiedBefore 2026-09-02T03:32:52.889Z` (narrower than Gate A's 6 hour scan, and inside it).
Re-ran `find-picked-stage-orders.sh --since 2026-09-02T02:04:00.000Z` against that exact floor:
**one** order at either stage in that window, `975303Sep26` itself (MEASURED). So the single
`skippedStages {'Fully Picked': 1}` count cannot be anyone else's: it is the target, unambiguously.

## Part 2, the control (mandatory, target is wholesale)

Needed a wholesale order at `New` or `Processing` in the same bounded run. Found by listing recent
orders directly (`find-cin7-sales-order.sh --limit 20 --max-pages 2`, no stage filter) rather than
widening Gate A's window: `UQLD160-3773`, branch 51908, stage `New`, `modifiedDate
2026-09-02T03:28:54Z`, resolved contact group `Retailer - Majors` -> WHOLESALE (MEASURED). Falls
inside the same cycle's fetch window (`02:04:00Z` to `03:32:52Z`), so Part 1's single invoke covers
both orders, no second cycle needed.

`inspect-ctc-order.sh` for `UQLD160-3773`: 0 rows, no order row (MEASURED). Skipped, as expected for a
wholesale order regardless of stage.

`skippedCounted=4` against `skippedStages` summing to only `1`: at least 3 skips, including this
control, carry no stage attribution at all. `skippedStages` holds no `New` or `Processing` key.
**This reproduces slice 04's `1038295Dec26` finding (wholesale, stage `New`, `skippedCounted 1`,
`skippedStages {}`) under today's deployed code, in the same cycle as the target.**

## Reading it

The control rules out the alternative explanation Q31 needed ruled out: `skippedStages` is not simply
"the stage of any skipped order, whatever the reason." A wholesale order at an eligible stage produces
a type-only skip with no stage entry. The target, also wholesale, produced a skip **with** a stage
entry, on a stage (`Fully Picked`) the control's stage (`New`) does not share. The only thing that
explains the target carrying a stage tag the control does not is a stage check that fired
independently and specifically flagged `Fully Picked`.

**Per the slice's own reading table: target's stage appears in `skippedStages` -> the deployed poller
skips picked stages, contradicting the stated intent.** That is now a controlled, attributable,
single-order finding, not an aggregate correlation across 32 orders that all happened to share a skip
reason. It answers Q31: dev's corrected 2026-09-01 statement (`New`, `Processing`, `Partially Picked`
and `Fully Picked` all eligible, matching the LLD) does not match what staging's poller actually does,
at least for `Fully Picked`. `Partially Picked` was not itself represented in this cycle's window (Gate
A's wider 6 hour scan had 3 wholesale `Partially Picked` orders, all outside this narrower floor), so
it is INFERRED to share the same fate via the same stage-list check, not independently re-measured
this session.

**What this does not settle.** Every order used across every check this plan has ever run at a picked
stage is wholesale. The mechanism (a stage check independent of type) is now MEASURED, but whether an
ECOM order at `Fully Picked` gets an order row created is still unobserved and unobservable until one
exists in the population. TC14's ECOM half stays BLOCKED for lack of a fixture, on stronger grounds
than before: the stage gate is now confirmed to reject the stage itself, so an ECOM order there would
almost certainly be rejected the same way, but "almost certainly" is not "measured."

## Part 3, Q30, cancellation on loss of eligibility

Read-only, no watermark work, no polling. Before reading any absence as a pass: checked whether the
cancellation path is deployed. **BUSY-1160's `STATE.md` says "Nothing has run," slice 01 Gate A (which
settles deployment) is NOT RUN.** Deployment status stays unconfirmed regardless of what Part 3 finds.

Current Cin7 stage for all 12 orders this plan has sent (MEASURED, `find-cin7-sales-order.sh
--reference '#<ref>'`, the leading `#` is required for these ECOM/Shopify references even though
`fixtures.md` records the normalised form):

| Reference | Current stage |
|---|---|
| 261115 | Dispatched |
| WOR19261 | Dispatched |
| 261106 | Dispatched |
| 261119 | Dispatched |
| 261110 | Dispatched |
| 261111 | Dispatched |
| 261113 | Dispatched |
| 261120 | Dispatched |
| 261122 | Dispatched |
| 261123 | Dispatched |
| 261124 | Dispatched |
| 261125 | Dispatched |

All 12 (MEASURED). None reached a picked stage. **The live Q30 case did not arise this session.**

Per the design, `Dispatched` should emit nothing. Confirmed for all 12 via
`scripts/list-transaction-rows.sh`: exactly one `TRANSACTION` row each, `event=CREATE_ORDER`, no
second row, no cancel event (MEASURED). Spot-checked 3 of the 12 (`261115`, `261119`, `261125`) with
`inspect-ctc-order.sh`: shipment header intact, `status OPEN`, `wmsSentAt` still set, unchanged from
their original send (MEASURED). No DELETE.

**Nothing to learn, not a pass.** This confirms `Dispatched` emits nothing on these 12 orders, which is
expected and unsurprising; it does not touch Q30's actual question (an order that reaches a picked
stage after being sent), which needs an order that both entered the system as eligible and later moved
to a picked stage. That has never occurred yet in this plan's population.

## Q32

Unchanged. Still gated behind Q31 and an ECOM fixture, neither of which changed this session in the
direction Q32 needs (an ECOM order actually reaching Manhattan from a `Partially Picked` state). Stays
NOT TRIED.

## Stop and ask JJ if

None of the four conditions triggered:

* Control showed a stage-eligible order's stage in `skippedStages` -> did not happen, `New` absent.
* Part 3 found a cancel/DELETE against a picked-stage order -> no order reached a picked stage.
* Only a wholesale target available and the control could not be run -> the control ran, same cycle.
* Anything needed a config change, a Cin7 write, or a window wider than a few hours -> window was
  about 1 hour 24 minutes (`02:09` floor to `03:33` newWatermark), no config change, no Cin7 write.

## Scripts written

None. Reused `find-picked-stage-orders.sh`, `find-cin7-sales-order.sh`, `cin7-watermark.sh`,
`invoke-so-poller.sh`, `inspect-ctc-order.sh` and `scripts/list-transaction-rows.sh` as they stood.

## Teardown

Watermark restored to the snapshotted value `2026-08-28T01:35:45.769Z`, read back and confirmed
(MEASURED). Chose to restore rather than leave forward: unlike slice 09's deviation, leaving the
watermark at its post-invoke value here would permanently skip the entire multi-day backlog between
the schedule's 2026-08-28 disablement and now, not just avoid re-sending a handful of already-sent
orders. That is a bigger call than this slice licenses, so the snapshot wins. Schedule left DISABLED,
confirmed after the restore.
