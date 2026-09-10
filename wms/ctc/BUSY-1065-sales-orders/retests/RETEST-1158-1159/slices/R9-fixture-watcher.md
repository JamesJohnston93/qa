# Slice R9, the fixture watcher

**Ticket:** BUSY-1158 and BUSY-1159
**Cases:** none directly. This is what unblocks TC4, TC6, TC9, TC15, the version guard's second half,
and R2.
**Depends on:** nothing. Read only, no AWS writes, no Cin7 writes, no poll.
**Estimated:** one session to build, then five minutes a day to run

## The problem this solves

Cin7 is read only for everyone, so this team cannot manufacture a fixture. Five cases are now waiting
on a shape that has to occur naturally:

| Waiting case | Shape needed |
|---|---|
| TC4, line reconciliation, version guard second half, R2's update half | an order **already sent by us** whose Cin7 `modifiedDate` has since moved |
| The cancellation path, R2 | an order **already sent by us** that has since been cancelled or voided in Cin7 |
| TC6 | an order carrying the **same option code twice** |
| TC9 | an order carrying a SKU **absent from the SCALE item master** |
| TC15 | an order whose reference is **over 25 characters** |

"Re-check opportunistically" is the right instruction and the wrong mechanism. Nobody re-checks five
shapes by hand every day, and the shapes are transient: R5's `Fully Picked` fixture existed that day
only. A second-revision order is even more perishable, because the next poller cycle consumes it.

One read-only script, run daily, turns five parked cases into five cases that get run the day their
fixture appears.

## Build

`scripts/watch-for-fixtures.sh`, in this folder. Read only, GET only, no AWS writes.

Header carries ticket, the five cases, what it asserts, and a "Does NOT" line: it finds candidate
fixtures, it does not prove any case.

Take `--stage` and `--profile` as arguments, never hardcode an environment. `set -euo pipefail`. Cin7
credentials come from `.env` beside the scripts. **No `-X`, no `-d`, no `--data` on anything touching
Cin7.**

Read `SCRIPTS.md`, `../../../tools/SCRIPTS-INDEX.md`, `../../BUSY-1158/SCRIPTS.md` and `../../BUSY-1159/SCRIPTS.md`
before writing a line of it. Several of the pieces already exist and extending beats rewriting:

* `find-cin7-sales-order.sh` lists recent CTC ecommerce orders and resolves contact groups
* `survey-cin7-orders.sh` already does population distributions and cross-tabs
* `find-picked-stage-orders.sh` is the closest existing shape, a single Cin7 GET filtered to a
  condition, printing one line per hit
* `inspect-ctc-order.sh` reads the whole chain for one reference

### Check 1, second-revision orders. The valuable one.

The only check that needs both sides.

1. Scan `staging-shipments` for shipment headers with `wmsSentAt` set, bounded to the last 14 days.
   Collect each one's Cin7 reference and the `modifiedDate` we stored at send time.
2. One Cin7 GET per reference, or a bounded bulk GET if the API allows filtering by reference set.
3. Report any reference whose current Cin7 `modifiedDate` is **later** than the one we stored.

That is a real, naturally occurring second revision on an order we have already sent, which is exactly
the TC4 fixture and exactly the version guard's discriminating case.

Keep the scan bounded. Do not full-scan `staging-shipments` on every run: 14 days of sent orders is
the useful window, and anything older is not a live fixture.

Print, per hit: reference, stored `modifiedDate`, current `modifiedDate`, current stage, current
status, order type. Never a customer name, email or address. Presence and length only if a field
matters at all.

### Check 2, cancelled or voided after send

Same reference set as check 1. Report any whose Cin7 status is now cancelled or voided.

That is the cancellation path fixture, and it is what gives R2 a CTC shipment that can leave `OPEN`.

### Check 3, repeated option code

One Cin7 GET over recent orders. Report any order where the same option code appears on more than one
line. TC6's existing fixture `WOR19261` predates the 2026-09-03 deploy, so TC6 is unproven against the
current build until a fresh one appears.

### Check 4, item-master-absent SKU

Two option codes are confirmed absent from the SCALE item master: `TH25-318B-28` and `WPR25-104A-10`.
Report any recent order carrying either.

Better if cheap: report any order carrying a SKU not present in the SCALE item master at all, rather
than only the two known ones. If that lookup is expensive, the two known codes are enough to start
with. Say which you implemented.

### Check 5, over-25-character reference

One Cin7 GET, report any order whose reference exceeds 25 characters. This is a hard error at the
poller, which is what TC15 needs. `261111-SplitShipment-HARBOUR-TOWN` is the known example of the
shape.

## Output

One block per check. For each: how many candidates, and one line per candidate. When a check finds
nothing, say so explicitly rather than printing nothing, so a silent run is distinguishable from a
clean run.

End with a single summary line naming which parked cases are runnable today. That line is the whole
point of the script.

## Running it

Daily, or at the head of any session in this folder. Five minutes.

**Second-revision and cancellation hits are perishable.** The next poller cycle consumes a second
revision, and the poller schedule being DISABLED is what preserves them, so a hit found today is
still there tomorrow only while the schedule stays off. When check 1 or check 2 hits, run the parked
cases that day rather than noting it.

## Write results to

`results/R9-fixture-watcher.md` for the build session: what was built, what each check does, what it
does not check, and the first run's output.

Subsequent runs do not need a result file each time. Record a hit in `STATE.md` when one occurs, and
what was run against it.

Add a row to `SCRIPTS.md`. Leave the Reviewed column empty, a human fills it.

## Stop and ask JJ if

* check 1 or check 2 hits. That is a parked case becoming runnable and it is time-critical.
* the `staging-shipments` scan cannot be bounded to 14 days without a full scan, since a repeated full
  scan on a daily script is not acceptable.
* a Cin7 GET pattern needed here is not already covered by an existing script, so the script would be
  making a call shape nobody has reviewed.
