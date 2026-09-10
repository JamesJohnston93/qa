# Parked, the cases that need a Cin7 revision

**Ticket:** BUSY-1159 AC3 and AC6, BUSY-1158 AC5, BUSY-1160 evidence
**Status:** not runnable as designed. Not blocked on a person.
**Unparked by:** `R9-fixture-watcher.md` check 1 or check 2 finding a hit.

## Why these are parked

Cin7 is CTC's live production system and it is read only for everyone on this team, JJ included.
There is no path by which a test case gets a purpose-built fixture created in it.

The original `R3-update-semantics.md` was written on the assumption that JJ would make a sequence of
live Cin7 edits. That premise was invalid against a constraint both ticket `CLAUDE.md` files already
carried. The slice was replaced by `R3-update-semantics-no-cin7-write.md`, which runs the three case
groups that never needed a Cin7 write, and by this file, which holds the rest.

These cases are not waiting on anyone's decision. They are waiting on a shape occurring in a live
system that this team observes and does not control.

## What is parked

### TC4, second sighting of an order edited in Cin7

Needs: an order already sent by us whose Cin7 `modifiedDate` has since moved.

Under BUSY-1160 the expected result inverts. The current QA doc row reads "no update reaches SCALE"
and PASSES on that, which was correct against the pre-1160 build and is now either stale or a live
defect. **The row cannot be corrected without running it**, because guessing which of the two it is
would be exactly the copy-a-conclusion-you-did-not-measure error the 2026-09-02 audit exists to stop.

Leave TC4 as it stands with a note that it is unverified against the current build.

### Line reconciliation, the three shapes

Needs: the same fixture, and enough successive revisions on one order to see them.

BUSY-1160's ACs: new lines inserted, changed quantities updated in place under the same item key,
vanished lines marked removed without physical deletion, exactly one outward event per revision.

A single naturally occurring revision gives one of these at best, whichever the customer or the
account manager happened to change. Take what the fixture offers and record which shapes were and
were not observed. Do not report reconciliation as verified on a single quantity change.

### The address-update payload

Needs: a naturally occurring address change on a sent order.

The assertion is specific and worth keeping ready: the address-update payload carries **no lines**.
Read the payload block with `../../BUSY-1158/scripts/read-transaction-payload.sh`, which prints key names
and presence and never values. Confirm the line set is absent, not empty and not repeated.

### The version guard, discriminating half

Needs: a genuine later edit in a new `modifiedDate` tick.

`R3-update-semantics-no-cin7-write.md` proves the replay half: an older or equal revision is a no-op.
That alone does not distinguish a guard that discriminates from a guard that blocks everything, and
the second one presents in production as silently stale shipments.

Record the guard as HALF MEASURED until this runs.

### The cancellation path, and R2's update half

Needs: an order already sent by us that is cancelled or voided in Cin7.

Two things ride on it:

* BUSY-1160's AC that a cancelled order is removed from SCALE, the order flipped without physical
  deletion on our side, and the sender issuing a delete on the shipment id
* **BUSY-1158 TC4e**, blocked since slice 04 because all 70 CTC shipments on staging are `OPEN`. A
  cancellation or an address update is the only mechanism that moves one off `OPEN`, which is what
  `R2-lifecycle-gated-consumers.md` needs to sweep the lifecycle-gated consumers against.

R2's own precondition check, `../../BUSY-1158/scripts/list-ctc-shipment-states.sh`, is read only and cheap
and can be run any time. If the distribution has moved off all-`OPEN` by any route, R2 becomes
runnable whether or not this file's fixture has appeared.

## What to do instead of waiting

Run `R9-fixture-watcher.md` daily. Checks 1 and 2 are what unpark this file.

When a hit appears, it is perishable: the next poller cycle consumes a second revision. The schedule
being DISABLED is what preserves it. Run the parked cases that day.

## What this means for sign-off

BUSY-1160's reconciliation behaviour may go unverified for this pass, for want of a fixture this team
has no way to create. That is a plan-level gap and it belongs in front of Kian and the project team,
not buried in a result file. It is not a QA capability problem and it is not solved by more testing.

The honest handover line: TC4, the line reconciliation shapes, the address-update payload assertion,
the version guard's discriminating half and the cancellation path are **unverified against the
deployed build, with the reason recorded**. That is a better handover than any of them carrying a PASS
that was true of a build nobody is running any more.
