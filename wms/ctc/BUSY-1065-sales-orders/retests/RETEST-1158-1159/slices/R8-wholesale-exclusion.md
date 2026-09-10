# Slice R8, the wholesale silent drop

**Ticket:** BUSY-1159 AC5, and BUSY-1160 AC1
**Cases:** none directly. This characterises R5's finding before it goes to Kian.
**Depends on:** R5, done. Read `results/R5-eligibility-gate.md` in full first.
**Estimated:** 40 minutes, gated on a fixture that exists most days

## What R5 found

One poller cycle, 8 orders fetched, 6 fully accounted for: 5 ECOM created, 1 ECOM named hard-error.
The remaining 2 left no trace at all. Not in `skippedStages`, which came back `{}`. Not in any other
counter by name. Not anywhere in the 74 line cycle log, by reference, Cin7 order id or any other
field. `inspect-ctc-order.sh` confirmed zero rows and no shipment header for either.

The two were `1065881Sep26` (`Fully Picked`, wholesale) and `UQLD160-3711A` (`Dispatched`, wholesale).
R5's reading: both wholesale, all six accounted-for orders ECOM, so this looks like a wholesale-side
exclusion.

## The confound R5 did not name, and why this slice exists

Both vanished orders were wholesale **and** both were at a stage that was already being excluded
before the deploy. `Fully Picked` is the stage Q31 is about. `Dispatched` was excluded by the Cin7
query's own server-side stage filter per slice 04.

So "wholesale" and "already-excluded stage" are perfectly confounded in R5's data. Every order that
vanished has both properties, every order that was accounted for has neither. The finding cannot
distinguish:

* a new wholesale-side exclusion that drops wholesale orders silently
* the old stage gate still firing, with the counter that used to report it (`skippedStages`) no longer
  populating

Those two have different owners and different severities, and taking the wrong one to Kian costs
credibility we will want later.

**The discriminating fixture is a wholesale order at `New` or `Processing`.** Wholesale orders at
eligible stages exist in volume, so this is a fixture the team can actually get, unlike the ECOM
picked-stage order TC14 has been waiting on for five checks.

## Why the answer matters beyond the counter

BUSY-1160's first acceptance criterion: "A wholesale order lands in SCALE with the delivery company as
`ShipTo` and the wholesale order type."

If a wholesale order at an eligible stage is silently dropped, that AC fails, and it fails in the
worst way an integration can fail: no error, no counter, no alarm, no DLQ. Nobody finds out until
someone in the warehouse asks where an order went.

If instead the wholesale order sends correctly, then R5's two vanished orders were excluded on stage
after all, the wholesale hypothesis is dead, and the real finding narrows to a counter that stopped
reporting. Still worth raising, much less severe.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
./cin7-watermark.sh --stage staging --profile staging --poller so
```

Expect `2026-08-28T01:35:45.769Z`. **Restore at teardown.** Poller schedule stays DISABLED, this slice
uses a manual invoke.

Cin7 is read only, GET only, for everyone.

## Gate A, find a wholesale order at an eligible stage

Trigger: `survey-cin7-orders.sh` carries stage x projectName and stage x branchId cross-tabs, added
2026-09-02. Use them to find candidates at `New` or `Processing`, then confirm order type properly:

```bash
./find-cin7-sales-order.sh --reference <ref> --with-contact
```

Contact group is the firm call. `Retailer - Domestic` and `Retailer - Majors` both resolved to
`orderType WHOLESALE` in R5. Company name alone is a proxy, not proof.

Also pick an **ECOM control at the same stage** that will fall in the same cycle. R5's method, and it
is what makes the result attributable.

Stop here and re-run another day if no wholesale order at `New` or `Processing` exists. Record that
as the outcome rather than substituting a picked-stage order, which would reproduce the confound.

## Gate B, one controlled cycle

Method, following R5 exactly so the results are comparable:

1. Bound the window with a direct Cin7 GET and confirm exactly which orders it holds. **Account for
   the poller's own 5 minute lookback**, which widened R5's window from 6 orders to 8. Compute the
   real window as watermark minus 5 minutes to invoke time, and check that window, not the watermark
   window.
2. Confirm the wholesale target and the ECOM control are both in it, and note every other order that
   is.
3. Set the watermark, read it back.
4. One manual invoke. One cycle.
5. Capture the complete `Cin7SOPollerCycleComplete` line and the full cycle log.

Three outcomes, all informative:

* **Sent.** The wholesale order reaches SCALE. BUSY-1160's wholesale path works, R5's vanished orders
  were stage-excluded, and the wholesale hypothesis is dead. Then check 1160 AC1 properly: does
  `ShipTo` carry the delivery company rather than the customer name, and is the wholesale order type
  stamped on the header? That is 1160 evidence, hand it to that ticket.
* **Skipped with a named counter.** Wholesale is not enabled yet and the counters are intact. Record
  which counter, and the finding shrinks to "1160's wholesale half is not deployed", which is a
  scheduling fact rather than a defect.
* **Vanished, zero counter, zero log line.** The silent drop is confirmed on an eligible-stage order
  and it is a defect against 1160 AC1. Stop and tell JJ immediately, do not finish the session first.

## Gate C, the counter regression, separately

Whatever Gate B finds, one question stands on its own: **did a counter stop reporting?**

Slice 11's control (`UQLD160-3773`, `New`, wholesale) produced a type-only skip. R5's cycle produced
`skippedStages={}` and no counter entry for either wholesale order. Compare the counter set and values
across the three cycles now on file:

* slice 04's cycle
* slice 11's controlled cycle, 2026-09-02, pre-deploy
* R5's controlled cycle, 2026-09-04, post-deploy
* this slice's cycle

Capture: a four-column table, one row per counter name, so a counter that used to populate and now
does not is visible at a glance. `updated` and `cancelled` are new since the deploy and should appear
as absent in the two pre-deploy cycles.

This is the half that is worth raising with Kian even if Gate B comes back clean, because a skip
counter that silently stopped firing removes the only signal QA has for a whole class of exclusion.

## Teardown

* Restore the watermark to `2026-08-28T01:35:45.769Z`, read it back.
* Poller schedule DISABLED.
* If the wholesale order sent, record its `ShipmentId` for R6, which then reads the `ShipTo` mapping
  in the SCALE UI.

## Data handling

No width-based truncation on log output. Select fields with `--query` or `jq`.

## Write results to

`results/R8-wholesale-exclusion.md`.

State the two questions separately and do not let one answer the other: whether wholesale orders at an
eligible stage are dropped, and whether a skip counter stopped reporting. Propose the Q31 register
update and a new question for the wholesale finding if Gate B confirms it. Do not edit the register
from this session.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* a wholesale order at an eligible stage vanishes with no counter and no log line. Interrupt for this
  one, it is a silent data-loss shape against a live acceptance criterion.
* the wholesale order sends but with the customer name in `ShipTo` rather than the delivery company,
  which is 1160 AC1 failing in a quieter way.
* a counter that populated on 2026-09-02 no longer populates and nothing replaced it.
