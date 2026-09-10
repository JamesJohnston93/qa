# Slice 05, address, field clearing, cancellation

**Ticket:** BUSY-1161
**Cases:** TC6, TC6b, TC7a, TC7b
**Depends on:** slice 04 (TC1a's order at a known line set), slice 03 (TC1b's RTV order)
**Estimated:** one session, plus a SCALE UI pass per case

The two cancellations run last, in this order, because they end both orders. Nothing after them can revise either.

## Preconditions

- `results/04-line-reconciliation.md` gives the wholesale order's final line count.
- `results/03-creation-both-types.md` gives the RTV order's reference.
- SCALE staging login.
- Slice 02's difference list.
- `--family outbound` on every command. Two of the three scenarios here have an ECOM namesake that auto-resolution picks first.

## Setup

Five minutes between revisions, as slice 04.

## Cases

### TC6, change the delivery address

Trigger: `--scenario 06-address-changed --family outbound`. The outbound scenario, not the ECOM namesake.

Expect: Ship To updates in SCALE, lines unchanged.

Capture: the address before and after, and the line count against slice 04's final.

Fails if: a line moves, or the address is partially applied.

### TC6b, clear an optional mapped field in Cin7

**No fixture exists for this.** Clearing an optional mapped field is the one drive capability the toolset lacks. Two routes, and the first thing this case does is choose between them:

1. Add a scenario to `make-wholesale-scenarios.py` in the engineer's folder. Its README asks for extensions to go there rather than into a scratch directory, so this is the sanctioned route. The generator is offline and touches neither Cin7 nor AWS, so the cost is low.
2. Record TC6b as BLOCKED on tooling and move on.

Take route 1 unless the generator turns out to be harder to extend than it looks. If route 2, say in the note which field would have been cleared and why it mattered.

Trigger, if route 1: the new scenario, clearing a field the LLD section 5 mapping says is omitted when absent. `Carrier.Carrier` and `Comments.Comment` are the candidates.

Expect: **unknown, and that is the point.** A SCALE `SAVE` is additive, so a cleared field may well hold its prior value rather than clearing.

Capture: the field's value in SCALE before and after, and whether the sender omitted the element or sent it empty.

Fails if: nothing fails here on its own. Record what happens. If the field holds its prior value, that is the additive-SAVE behaviour carried over from BUSY-1160, and the finding is whether any code path exists to clear it. Raise it as a question, not a defect, unless the LLD says the field must clear.

### TC7a, cancel the wholesale order

Trigger: `--scenario 08-ineligible-declined --family outbound`, which resolves to a cancel because the order exists and the scenario is not eligible.

Expect: the Shipment is gone from SCALE, and is still gone five minutes later.

Capture: the stored header's status, the sender log showing a header `DELETE`, and two SCALE reads five minutes apart.

Fails if: the Shipment is still present after five minutes, or it reappears on the second read. A cancelled header must never be resurrected.

### TC7b, cancel the RTV order

Trigger: the same scenario against TC1b's order, with `--order-type RTV`.

Expect: as TC7a.

Capture: as TC7a.

Fails if: as TC7a. Run TC8's read before this if slice 03 did not complete it; cancellation flips the header to `CANCELLED_OUTBOUND` and the sent state is no longer readable afterwards.

## Teardown

Both orders are now cancelled, which is the tidy-up and a real behaviour at the same time. Nothing further can be done with either reference; the documented reset ends in a step locked to the `kian-dev` stage. Confirm the schedule is still DISABLED and the watermark still UNSET. Update the two orders' rows in `../BUSY-1160/SYNTHETIC-REGISTER.md` to say they were cancelled.

## Write results to

`results/05-address-clearing-cancellation.md`.

## Stop and ask JJ if

- a cancelled Shipment reappears
- the cancel handler throws rather than flipping the header. BUSY-1160's TC18 found an uncaught throw on a cancel for a shipment SCALE never held, deferred to BUSY-1162 as D18. If that reproduces on the outbound path it is a second instance, not the same one.
- TC6b's cleared field turns out to have no clearing path at all and the LLD requires one
- extending the engineer's generator looks like it would change his existing scenarios rather than just add one
