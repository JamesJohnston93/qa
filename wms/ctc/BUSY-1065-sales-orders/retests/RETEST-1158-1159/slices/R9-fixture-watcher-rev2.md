# Slice R9 rev 2, the fixture watcher, corrected

**Ticket:** BUSY-1158 and BUSY-1159
**Cases:** none directly. Unblocks TC4, TC6, TC9, TC15, the version guard's second half, R2 and R8.
**Depends on:** R9 rev 1, done. `scripts/watch-for-fixtures.sh` exists and ran.
**Estimated:** one session
**Supersedes:** `R9-fixture-watcher.md`. Read `results/R9-fixture-watcher.md` first.

## What rev 1 got right

The script exists, five checks run, and it already produced three things nothing else had:

* three of R4's four orders moved to `Dispatched` within about an hour, `WOR19169A` did not
* zero CTC shipments in `staging-shipments` are allocated to store `51908`, corroborating that
  wholesale orders never reach that table
* Cin7's `reference` filter needs a literal `#` prefix for every reference shape. R8 then found even
  that fails for some references and `memberId` against `Contacts` is the fallback. Both belong in
  `TOOL-NOTES.md` if they are not there yet.

## Two defects in rev 1's design, both mine

### 1. Check 1 compares the wrong thing

I specified "report any reference whose current Cin7 `modifiedDate` is later than the one we stored".
That fires on **any** change, and the change that actually happens is stage progression. 69 of 70
references hit, and the one content spot-check (`261115`) found same two SKUs, same count, no line,
quantity or address difference.

A 69 of 70 hit rate is not a fixture list, it is a broken filter. TC4 needs a **content** revision:
a line added, a line removed, a quantity changed, or an address changed.

**Fix:** check 1 compares content, not `modifiedDate`. Use `modifiedDate` only as the cheap
pre-filter that decides which references are worth a content read.

For each reference whose `modifiedDate` moved, compare against what we stored:

* the set of option codes on the order
* the quantity per option code
* the line count
* the address fields, **by length and presence only, never by value**

Report a hit only when one of those differs. Report stage-only movement as a separate, quieter line,
since it is still useful for the reachability picture but it is not a TC4 fixture.

Rev 1's own spot-check method is the right method. It just needs to run on every candidate rather than
on one.

### 2. No candidate carries its reachability

Checks 3, 4 and 5 each found a genuine fixture: `#261755` with a repeated option code, `#261779`
carrying the known-absent `TH25-318B-28`, and one 39 character reference. All three were tagged
`[PAST]` and none is usable, because a window reaching back to them sweeps everything since.

R8 and R3 then each burned a session discovering the same thing about their own targets.

**Fix: every candidate carries a reachability count.** For each hit, count the orders in the window
from that candidate's `modifiedDate` to now, the same direct paginated count R3 and R8 both did by
hand, and print it beside the candidate.

Then classify, three states rather than two:

* **REACHABLE**, window holds fewer than about 15 orders. Run its case today.
* **EXPENSIVE**, 15 to 100. A judgement call, and JJ's, not the script's.
* **PAST**, over 100, or the window spans a dispatch batch. Not usable by the current method.

`[PAST]` in rev 1 meant "already dispatched". It should mean "not reachable", which is the thing that
actually decides whether a session can run.

If R10 Gate B finds a working upper bound on the poller's window, this classification collapses and
every candidate is reachable. Note that in the script's header so whoever reads it next knows the
column may become moot.

## Add check 6, the wholesale one R8 asked for

R8 stopped because the only wholesale order at an eligible stage had sat for 24 hours and was
unreachable. It recommended this check rather than building it unilaterally, which was right.

Check 6: a wholesale order at `New` or `Processing` whose `modifiedDate` is inside the last two hours,
**paired with an ECOM control from the same window**. Report both or neither, since R8's method needs
the pair and a wholesale hit with no control is not runnable.

Contact group is the firm call on order type. `Retailer - Domestic` and `Retailer - Majors` are both
confirmed wholesale. Company name is a proxy. Resolve by `reference` with the `#` prefix, and fall
back to `memberId` against `Contacts` when that fails, as R8 had to.

Note for whoever runs it: R8 observed that `THE ICONIC` order sat at `New` for 24 hours while every
ECOM order observed reaches `Dispatched` in 1 to 3 hours. If wholesale orders normally dwell, check 6
will find candidates often. If that one was stuck, it may find them rarely. UNKNOWN either way, and
the check itself is what settles it.

## Add a summary line that answers the only question

End with one line naming which cases are runnable **today**, using REACHABLE candidates only. Not
which fixtures exist. R8 and R3 both had fixtures.

## Running it

The shapes are perishable and the classification changes hour by hour, so a daily run is not enough to
catch a REACHABLE candidate before a dispatch batch moves it to PAST.

R10 Gate C establishes when the batches run and what the longest clear interval is. Until that lands,
run the watcher at the head of every session and once mid-morning.

**If R10 Gate B finds an upper bound, drop this cadence.** Perishability is only a problem because the
window cannot be closed.

## Write results to

`results/R9-fixture-watcher-rev2.md`. Include the first run's full output under the new
classification, since that is the list the next session picks from.

Update the row in `SCRIPTS.md` to describe the corrected checks. Leave Reviewed empty.

Update `STATE.md`.

## Stop and ask JJ if

* check 1's content comparison finds a genuine content revision that is REACHABLE. That is the TC4
  fixture this pass has been waiting for, and it is perishable.
* check 6 finds a wholesale and control pair that is REACHABLE. R8 becomes runnable immediately.
* the content comparison cannot be built without storing customer address values anywhere. It must
  not. Lengths and presence only, and if the comparison needs more than that, say so rather than
  storing them.
