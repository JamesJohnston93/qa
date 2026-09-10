# Slice 04, line reconciliation

**Ticket:** BUSY-1161
**Cases:** TC2, TC3, TC4, TC5, TC5b, TC5c, TC5d
**Depends on:** slice 03 (TC1a's wholesale order and its line count, and TC15's three-size order, both in results/03)
**Estimated:** one session, plus a SCALE UI pass per case

TC2 to TC5b run as WHOLESALE on the one order from TC1a, in order, because each fixture builds on the last: `03` is meaningless without `02`, `05` without `04`.

TC5c and TC5d are new arms the engineer's fixture set made possible. TC5c continues from TC15's three-size order with `17` then `18`. TC5d re-runs the removal as RTV on a fresh reference, using the same wholesale fixtures with `--order-type RTV`, which closes the type gap the handover names as a worthwhile follow-up. Slice 02 step 3 is what says whether that substitution is trustworthy.

## Preconditions

- `results/03-creation-both-types.md` gives TC1a's reference and its baseline line count.
- Slice 02's difference list, which says how narrowly each verdict has to be written.
- `--family outbound` on every command.
- SCALE staging login.

## Setup

Apply each revision, then wait up to five minutes before reading SCALE. Do not batch two revisions inside the five-minute content dedup window on the orders-to-shipping queue; an identical replay inside it is dropped silently and reads as a lost message.

## Cases

### TC2, raise the quantity on one size

Trigger: `--scenario 02-size-qty-increased`.

Expect: that row's quantity rises in SCALE, every other row unchanged.

Capture: the changed row's before and after quantity, and the total line count against slice 03's baseline.

Fails if: the line count changes, or another row's quantity moves.

### TC3, lower the quantity on one size

Trigger: `--scenario 03-size-qty-reduced`.

Expect: that row falls, no row disappears.

Capture: as TC2.

Fails if: a row vanishes. Lowering a quantity is not a removal.

### TC4, add a size to an existing line

Trigger: `--scenario 04-size-added`.

Expect: one extra detail line, existing quantities held.

Capture: the new row's key and its `(ErpOrderLineNum, SKU.Item)` pair, and the new line count.

Fails if: the added size overwrites an existing row under the same line id.

### TC5, remove a size from an existing line

Trigger: `--scenario 05-size-removed`.

Expect: that line is deleted in SCALE, **every other line survives**.

Capture: the full line list from SCALE before and after. SCALE `SAVE` is additive, so a removal test that only checks the value is absent passes wrongly; check the line itself is gone.

Fails if: any other line disappears, or the removed line is still present.

### TC5b, stored state behind the removal

Trigger: read `staging-shipments` for the same order, no new emit.

Expect: the removed line's row reads `REMOVED_OUTBOUND`, and the sender's log for that send shows a per-line `DELETE`.

Capture: the row's status, and the sender log line naming the deleted line.

Fails if: the row is physically deleted rather than flipped, or the send carried no per-line `DELETE`. This is the limb of AC4 that TC5 alone cannot see: the design says the delete derives from the line's status, not from a diff against the payload, and a diff-derived delete would still make TC5 pass.

### TC5c, re-add a size that was removed

Trigger: on TC15's three-size order, `--scenario 17-middle-size-removed`, then `--scenario 18-removed-size-readded`.

Expect: the middle size goes, the other two survive, then the removed size returns in SCALE.

Capture: the stored row's status through all three states, and the line list in SCALE after each.

Fails if: the re-added line never returns, or returns as a second row under a new key. A row that stays `REMOVED_OUTBOUND` while SCALE shows the line back is the worse outcome of the two, because the next removal then has nothing to derive a delete from.

### TC5d, the same removal run as RTV

Trigger: a fresh reference. `--scenario 04-size-added` then `05-size-removed`, both with `--order-type RTV`.

Expect: as TC4 and TC5.

Capture: the same evidence, plus the order type and `AllocateComplete` on the header.

Fails if: the removal behaves differently from the wholesale arm.

**Write the note narrowly.** The header is a wholesale shape re-typed as RTV, so this evidences that the machinery is type-agnostic on the removal path. It is not evidence about a real RTV's content.

## Teardown

Leave TC1a's order where TC5 left it. Slice 05 continues from this line set and cancels it at the end. TC5c's and TC5d's orders are finished with; register their end states.

## Write results to

`results/04-line-reconciliation.md`. Record TC1a's final line count under "Values other slices need".

## Stop and ask JJ if

- a removal takes another line with it
- the stored line is physically deleted rather than flipped
- two cases in a row are inconclusive because SCALE cannot be read
