# Result: Slice R5, the eligible-stage gate

**Ticket:** BUSY-1159, AC5
**Verdict:** Q31 does NOT close. Neither of the slice's two anticipated outcomes occurred. A third,
unanticipated shape was measured: the wholesale target was neither sent nor counted as a stage skip,
`skippedStages` came back empty, and a second wholesale order in the same cycle (`Dispatched` stage)
also vanished with zero trace. Both silently-missing orders are wholesale; every ECOM order in the
same cycle was accounted for exactly (created or a named hard-error). TC14's ECOM-fixture half remains
blocked, unrelated to this finding.

## Preconditions

MEASURED. `aws sts get-caller-identity --profile staging` returned the staging account, session alive.
Watermark before starting: `2026-08-28T01:35:45.769Z`, matches expectation.

## Gate A, does a fixture exist

MEASURED. Yes. `find-picked-stage-orders.sh --since 2026-09-01T00:00:00Z` returned 14 orders at
`Fully Picked` or `Partially Picked`, all branch `51908`, all with recognisable retail-store company
names (no ECOM candidate among them, confirmed by name alone, not re-checked with `--with-contact` on
all 14 since none looked ECOM). Picked target: `1065881Sep26`, `Fully Picked`, modified
`2026-09-04T01:02:42Z` (same day, most recent of the 14; the next-most-recent picked-stage order was
`975303Sep26` at `2026-09-02T02:09:09Z`, over a day earlier). `find-cin7-sales-order.sh --reference
1065881Sep26 --with-contact` confirmed contact group `Retailer - Domestic` -> `orderType WHOLESALE`.
Mechanism half runnable, went to Gate B. No `Partially Picked` order was used as a second target; one
target is sufficient to measure the gate and a second measurement was not needed given what Gate B
found.

## Gate B, the controlled single-cycle measurement

**Window.** Confirmed `1065881Sep26` was the only order at a picked stage in a bounded window before
committing anything: a direct Cin7 GET for `branchId IN (51908,51909)`, `modifiedDate >=
'2026-09-04T01:02:41Z'` (one second before the target's own `modifiedDate`) returned exactly 6 orders:
the target (`Fully Picked`), one `Dispatched` order (`UQLD160-3711A`, also wholesale, contact group
`Retailer - Majors` per an earlier general listing), and 4 `Processing` orders (all branch `51909`, all
`orderType ECOM` per the poller's own later log output). Re-checked immediately before committing the
watermark, still exactly 6. This is the control set: `#261837`, `#261838`, `#261558`, `#261839`, all
`Processing`, all later confirmed ECOM.

**Watermark set.** `cin7-watermark.sh --stage staging --profile staging --poller so --set
2026-09-04T01:02:41Z --confirm`. Read back confirmed `2026-09-04T01:02:41Z`.

**One manual poller invoke.** `invoke-so-poller.sh --stage staging --profile staging`. The poller
applies its own 5-minute lookback and runs to invoke-time, so the actual fetch window was
`modifiedSince=2026-09-04T00:57:41.000Z` to `modifiedBefore=2026-09-04T01:33:24.766Z`, 8 orders wide
rather than 6 (widened by two additional `Processing` orders, `#EXC-259871-1` and `#EXC-260435-1`,
both modified `01:00:0{2,3}Z`, both ECOM, both inside the 5-minute lookback but outside my own
watermark-minus-one-second check). Re-verified against a direct Cin7 GET over the poller's own
actual window: exactly 8 orders, matching `Cin7SOFetched count=8` precisely, target still the only
picked-stage order in it.

**Cycle result, MEASURED (full raw log, 74 lines, captured entirely, reproduced fully below where it
bears on the finding):**

```
Cin7SOPollerCycleComplete  ordersFetched=8 created=5 updated=0 cancelled=0 staleSkipped=0
  echoSkipped=0 skippedLocallyTerminal=0 skippedCounted=1 skippedZeroUnitOrders=0 pendingCreates=0
  oversized=0 skippedZeroQty=1 skippedNoSizes=0 packingBrandMisses=0 skippedStages={}
  watermarkAdvanced=True newWatermark=2026-09-04T01:33:24.766Z
```

The 5 `created` are exactly the 5 ECOM `Processing` orders that were not hard-errored (`#EXC-260435-1`,
`#261837`, `#261838`, `#261558`, `#261839`), confirmed by reading every `Pushed ... to EventBridge` log
line in the cycle: each carries `"orderType":"ECOM"` and a `CREATE_TRANSACTION` detail matching one of
the 5 by Cin7 reference. The 1 `skippedCounted` is the named hard-error: `Cin7SOPollerAlert
alert=true message="Cannot build CREATE_ORDER for Cin7 SO #EXC-259871-1 (modified
2026-09-04T01:00:03Z) — order not sent. Unmapped Cin7 delivery state: \"Nelson\""`, the 6th `Processing`
order, unrelated to the stage gate.

That accounts for 6 of the 8 fetched orders (5 created + 1 named hard-error), all `Processing`, all
ECOM. **The remaining 2 are the target (`1065881Sep26`, `Fully Picked`, wholesale) and the incidental
`Dispatched` order swept into the wider window (`UQLD160-3711A`, wholesale).** Neither appears in any
counter by name, neither appears in `skippedStages` (which is `{}`, completely empty, not
`{'Fully Picked': 1}`), and neither appears anywhere in the cycle's full 74-line log by reference,
Cin7 order id, or any other field: `grep` for `967582`, `1065881Sep26`, `961105`, `UQLD160-3711A`,
`"Fully Picked"` and `"Dispatched"` across the complete log returned zero matches. `skippedZeroQty=1`
accounts for at most one of the two; the other is not accounted for by any printed counter at all.
Confirmed via `inspect-ctc-order.sh` for both references: zero ORDER/ITEM/ADDRESS/TRANSACTION rows and
no shipment header for either `1065881Sep26` or `UQLD160-3711A`.

**This is neither of the two outcomes the slice anticipated.** Not "gate fixed" (the target was not
sent), and not "gate still wrong" in slice 11's own shape (`skippedStages {'Fully Picked': 1}`,
control absent from any counter) - here `skippedStages` is empty and the target left no trace
whatsoever, counted or logged. Both of the two orders that vanished without any counter or log
reference share one property the six accounted-for orders do not: **both are wholesale, all six
accounted-for orders are ECOM.** That reads as a wholesale-side exclusion happening somewhere before
or instead of the stage check the slice was measuring, silently, not as a fix or a continuation of the
previously-measured stage-skip behaviour. Whether the exclusion is by design (BUSY-1160's wholesale
mapping intentionally routes wholesale orders elsewhere, uncounted here on purpose) or a metrics
regression (the counter that used to catch this, `skippedStages`, no longer fires for it) is UNKNOWN
from this slice alone; code was not read, per this gate's own discipline.

### The two halves, stated separately per the slice's instruction

* **Mechanism half:** measured on a wholesale order (`1065881Sep26`), as anticipated ("mechanism
  measured on a wholesale order, ECOM half still inferred"). Result: inconclusive, not FAIL and not
  PASS. The order was not sent, but it was also not caught by the stage-skip counter the prior
  measurement relied on, so this measurement cannot confirm the same mechanism is still in force
  versus something else (a wholesale gate) now sitting in front of it.
* **ECOM fixture half:** still blocked, unchanged from every prior check. No ECOM order was observed
  at a picked stage in this run either; the two orders swept into `Fully Picked`/`Dispatched` here were
  both wholesale.

## Fails if / Inconclusive if

**Inconclusive**, by the slice's own definition extended to this new shape: the measurement does not
land cleanly in either the "fixed" or "still wrong" bucket it was built to distinguish between, so
reporting either verdict would misstate what was observed. Recommend treating this as a second
controlled measurement that surfaces a new question rather than answering the old one, and taking it
to Kian alongside Q31 rather than closing Q31 either way.

## Proposed Q31 register update

Propose adding to `../../BUSY-1065-OPEN-QUESTIONS.md` rather than editing it from this session: Q31
should note that the 2026-09-03 deploy changed the stage-skip counter's behaviour (`skippedStages` no
longer populates for the one case measured) without confirming whether the underlying stage gate
itself changed, and that both orders silently missing from this cycle were wholesale, which may be an
unrelated wholesale-routing change from BUSY-1160 rather than the stage gate at all. Recommend asking
Kian directly which mechanism (if either) is now responsible for a wholesale order at `Fully Picked`
producing nothing.

## Teardown

* Watermark restored to `2026-08-28T01:35:45.769Z`, read back and confirmed.
* Poller schedule confirmed `DISABLED` throughout (was never touched, only the watermark).
* Target did not send, no `ShipmentId` for R6.

## Stop and ask JJ

**Flagging this now rather than at the end of the pass.** This does not cleanly match any of the four
listed stop conditions ("gate fixed", "gate still wrong", "ECOM order found", "poller picks up
references outside the intended window" - the window was as intended) but sits squarely in their
spirit: a wholesale order at `Fully Picked` and a wholesale order at `Dispatched` both disappeared from
the pipeline in the same cycle with zero counter entry and zero log line, which is new behaviour since
2026-09-02 and worth JJ's attention before more of this pass runs, in case R4's create-path check runs
into the same silent-drop shape on a different order type.
