> **CLOSED 2026-09-08. Do not re-run.** 9 of 10 PASS, TC6 not runnable as written. Result:
> `results/04-revision-reconciliation.md`. Two follow-ups are live and are recorded in `STATE.md`:
> TC6 needs rewording or deferring (JJ's call), and TC5's SCALE half was retracted for its own emit
> after the `lineItemId` harness bug, so it is worth re-running that one assertion under the fix.

# Slice 04, revision reconciliation, synthetic

**Cases:** TC5, TC6, TC7, TC8, TC9, TC10, TC11, TC13, TC14, TC19
**Depends on:** slice 03's fidelity gate passing. **Do not start otherwise**
**Estimated:** two sessions. Ten cases, and several need a SCALE-side read

Writes to `staging-orders-v2-event-bus`. Records reach Manhattan SCALE staging.

This is the body of the ticket: AC2, AC3, AC4, AC6 and AC7. Every case is one seeded order plus one
mutation, per `PLAN.md`.

## Before the first emit

1. Confirm slice 03 recorded a MEASURED fidelity pass. If it is INCONCLUSIVE, stop.
2. Pick the seed orders. Prefer orders that already flowed cleanly under BUSY-1159, because their
   correct end state is documented and a deviation is therefore attributable. R13's nine are the
   obvious pool: `#262208`, `#262210`, `#262211`, `#262216`, `#262217`, `#262219`, `#262221`,
   `#262222`, `#262223`. `#262208`'s shipment header carries a `shipmentId`.
3. **One seed order per case.** Reusing a seed across cases means each mutation lands on an order the
   previous case already changed, and the stored `lastModified` and line set drift underneath you.
4. Space emits more than 5 minutes apart, or vary content, so the FIFO dedup never becomes the
   explanation for a null result.

## The two traps that make a wrong answer look right

**SCALE `SAVE` is additive.** A field cleared in Cin7 never clears in SCALE without an explicit
overwrite. So a removal test that only checks for an absent value passes wrongly, and so does an
address test that only checks the new value arrived. **TC7 must assert both halves**: the removal
marker on the orders side, and the line's absence on the SCALE side. Either alone is INCONCLUSIVE.

**Detail line identity is the pair `ErpOrderLineNum` and `SKU.Item`, never the line number alone**,
because every size expanded from a style shares the style's line id. TC10 asserting on the number
alone would report stable identity that is not actually there. BUSY-1159 already found a real order,
`WOR19261`, where two lines share both halves of that pair, which is a separate finding for the
confirmation epic but a live hazard for this case.

## Cases

Each row is one emit unless stated. Assert on the orders table, the outward event, and SCALE.

| TC | AC | Mutation | Assert |
|---|---|---|---|
| TC5 | AC2 | Add one line to the incoming set | New line inserted, **existing lines untouched**, new line reaches SCALE |
| TC6 | AC2, AC3 | Change quantity on one existing line | Same `SK` of `ITEM#<lineItems[].id>#<size code>` updated in place, **no new row**, no line identity churn |
| TC7 | AC2 | Drop one line from the incoming set | Removal marker written on the orders side **and** line absent in SCALE. Both, per the additive-SAVE trap |
| TC8 | AC2 | Change the delivery address | New address reaches SCALE |
| TC9 | AC4 | Same emit as TC8 | Inspect the outward payload: header and address only, **no lines** |
| TC10 | AC3 | Three successive emits on one order, each a different mutation | `ErpOrderLineNum` **and** `SKU.Item` stable across all three |
| TC11 | AC7 | A revision with a **genuine content change**, not a content-neutral one | **Exactly one** outward event, of the right type. Count against the full target list from slice 01 Gate B and slice 03's stage-1/stage-2 contract, not an assumed one |
| TC13 | AC6 | New hash, `modifiedDate` in a later tick | Applied, exactly one outward event |
| TC14 | none | Two emits with the same `modifiedDate`, different content | Both apply, neither dropped as a replay. Proves the payload hash is doing work in the idempotency key |
| TC19 | none | Read the header after TC5, TC6 or TC7 | `orderType`, `cin7Id`, `allocatedStore` and `wmsSentAt` all survive reconciliation |

**TC14 is the one that settles a drift row.** The LLD keys idempotency on
`<event>#<origin>#<modifiedDate>#<payloadHash>`; the ticket describes event, brand, order reference
and Cin7 modified date, with no hash. Cin7 `modifiedDate` has whole second precision, so two edits
inside one second carry the same timestamp and **the hash is the only thing that separates them**. If
both emits apply, the hash is in the key and the LLD is right. If the second is dropped, the ticket's
description is what shipped, and that is a real defect: a genuine second edit inside one second is
lost silently. Either result closes drift row 2.

**TC9 is free.** It is the same emit as TC8, read at the payload rather than at SCALE. Do not spend a
second order on it.

**TC11 has an open thread from slice 03, and it is the sharpest thing in this slice.** All three of
TC12's revisions applied cleanly and **none produced a new outward shipping-side event**: `wmsSentAt`
stayed at the create's own timestamp throughout (MEASURED). All three were deliberately
content-neutral (`added:0, removed:0, addressChanged:false`), which was the point of isolating the
version guard.

Two readings, and slice 03 could not separate them. Either the handler emits only when content
actually changes, which is sensible and arguably correct, or it never emits on an update at all,
which would mean **every pre-wave edit in AC2 silently fails to reach SCALE** while the orders table
looks perfectly reconciled. AC7's wording is "exactly one outward event per revision", which on its
face favours the second reading being a defect.

**Run TC11 on a content-changing revision before TC5 to TC8.** If no outward event ever fires, those
four cases are all measuring the orders side of a change that never reaches the warehouse, and their
SCALE halves will read as absences with one shared cause. Settle the emit question first, then run
the rest knowing which world you are in.

## Attribution rule

**The attribution instrument is known. Slice 03 found it, use it.**
`staging-orders-cin7-update-order`'s **own log group** publishes a named metric-shaped line on every
outcome, and it beats any counter:

* `SalesOrderStaleRevision` on a version-guard rejection, naming **both** the incoming and the stored
  `lastModified` inline
* `SalesOrderUpdated` on an applied revision, with `added`, `removed` and `addressChanged` counts

Read that log group by request ID for every case. Those three counts are as much the assertion for
TC5, TC6, TC7 and TC8 as the row state is.

The log groups did not exist before slice 03; its first injection created them. **Do not reach for
the poller's `staleSkipped` or `echoSkipped`**: they sit on the poller's cycle line and an injected
transaction bypasses the poller, so they never move. Slice 03 confirmed this directly.

**`skippedStages` is not empty by construction.** An earlier note from R11 said it stopped populating
on 2026-09-03. Slice 01 measured it non-empty (`{"Approved": 4}`) in a 2026-09-07 cycle, so do not
build an assertion on its being absent.

Carried from `PLAN.md` and it applies to every null result here. Three mechanisms can swallow a
transaction: the idempotency index, the version guard, the FIFO dedup. **Every negative result names
which one, with evidence.** A bare absence is INCONCLUSIVE, not a pass and not a fail. This is what
put BUSY-1159's TC21b at INCONCLUSIVE after it had been recorded as a pass.

## The caveat every result here carries

Synthetic injection proves the handler behaves correctly **given an input**. It cannot prove the
input occurs. Write the verdicts in that form: "the update handler reconciles a quantity change in
place", not "quantity changes work". Whether Cin7 emits revisions in these shapes is unmeasured and
belongs to a real-revision corroboration pass before sign-off.

## Standing constraints

* Poller schedule DISABLED, watermark unset, throughout.
* Every synthetic record in `SYNTHETIC-REGISTER.md` as it is created.
* Extract fields, never print or pipe a whole record.
* SCALE-side reads are in **Order Planning > Planned Shipment Insights**, not Shipping Insights. A
  downloaded shipment rests at `In Pool` until the DC waves it, and Shipping Insights lists post-wave
  shipments only. Reading an absence off Shipping Insights is how BUSY-1159 briefly convinced itself
  SCALE was accepting documents without creating shipments.

## Two harness limits slice 03 recorded, both live in this slice

* **`itemChanges.added` carrying the full current line set rather than a delta is INFERRED, not
  measured.** TC12's mutations were content-neutral so they never exercised it. **TC5, TC6 and TC7
  are what actually test it**, and should watch for a surprise here specifically. If the handler
  treats `added` as a delta rather than a full set, TC7's removal case is what exposes it, and that
  is a finding rather than a case verdict.
* **Financial totals pass through from the seed unchanged**, whatever the mutation. No case here may
  assert that `subtotal`, `grandTotal` or `taxPaid` reconcile against a line-item change. That needs
  the harness extended first. Recorded as P3 in `PROPOSALS.md`, not a case.

## Stop and ask JJ if

* a mutation produces a change on an order it was not aimed at
* TC14's second emit is dropped, which is a defect finding rather than a case result
* a null result cannot be attributed to a named suppressor after a genuine attempt
* any case would need the poller schedule enabled

## Write results to

`results/04-revision-reconciliation.md`, then update `STATE.md`, the ten case rows in `QA-DOC.md`,
drift row 2 if TC14 settles it, and `SYNTHETIC-REGISTER.md`.

Tag every claim MEASURED, INFERRED or UNKNOWN.
