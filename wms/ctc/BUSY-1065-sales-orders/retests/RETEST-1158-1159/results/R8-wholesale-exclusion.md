# Result: Slice R8, the wholesale silent drop

**Ticket:** BUSY-1159 AC5, BUSY-1160 AC1
**Verdict:** Gate A found a wholesale order at an eligible stage, but not one that can be tested by a
controlled, narrow-window cycle: it has sat unrevised for over 24 hours, and the only ECOM control
available to pair it with is today's traffic, which forces a window covering roughly 223 intervening
orders across both CTC branches. **Stopping before Gate B**, per the root `CLAUDE.md`'s own stop
condition ("the blast radius turns out wider than the slice assumed"), not per Gate A's own "no
fixture" condition, since a fixture does exist. R5's confound stays unresolved. Recommend R9's watcher
gain a sixth check for this exact shape, caught while still fresh, rather than attempting this window.

## Preconditions

MEASURED. `aws sts get-caller-identity --profile staging` returned the staging account. Watermark
`2026-08-28T01:35:45.769Z`, matches expectation, untouched this slice (no write was made).

## Gate A, find a wholesale order at an eligible stage

**Found: `MAPY004700-9377779363539B`, stage `New`, branch `51908`, `modifiedDate 2026-09-03T04:07:29Z`.**
Company `THE ICONIC`, `projectName TheIconic`. Contact group resolved via `memberId 68` against the
`Contacts` endpoint (reference-based lookup failed for this order despite the `#` prefix convention
established in R9; resolved by `id`/`memberId` instead, worth a note for whoever writes the next Cin7
script): `group: 'Retailer - Majors'`, confirming `orderType WHOLESALE`, the same contact group R5
already established as wholesale.

**No wholesale order at an eligible stage was found modified today.** A branch-51908 sweep for
`stage IN ('New','Processing')` since 2026-09-04T00:00:00Z returned zero. The `THE ICONIC` order above
is the only candidate, and its own `modifiedDate` is roughly 24 hours old at the time of this check -
it has not moved since entering `New`, while every ECOM order this plan has observed progresses to
`Dispatched` within 1-3 hours (R9). Whether that 24-hour stall is itself meaningful (a wholesale order
genuinely sits at `New` far longer in normal operation, or this specific one is stuck for an unrelated
reason) is UNKNOWN, not established by this check.

**This order's reference is exactly 25 characters**, not over 25, so it is not also a TC15 candidate
(`len('MAPY004700-9377779363539B') == 25`, checked directly).

## Why Gate B was not attempted

R8's own method (mirroring R5) requires the target and an ECOM control to fall inside one bounded
cycle window, and the window has to stay narrow, since a manual poller invoke processes everything
between the watermark and invoke time, not a fixed upper bound. The only ECOM controls available are
today's traffic. Bounding the watermark to one second before `THE ICONIC`'s own `modifiedDate`
(`2026-09-03T04:07:28Z`) and checking the real window up to now (`2026-09-04T03:5X`) returned **223
orders across both branches**, paginated and counted directly before committing anything (3 full pages
of 100, a 23rd partial page).

That is roughly 30-50x the size of any window run so far in this pass (R4: 4-8 orders, R5: 6-8
orders), an order of magnitude past what any slice in this plan has assumed as its blast radius. A
single manual invoke against this window would create real order and shipment records, real fan-out
to every downstream consumer, and real Cin7 API pagination cost, for over 200 references this plan
has no reason to touch. **This is the root `CLAUDE.md`'s "blast radius wider than the slice assumed"
stop condition**, not Gate A's own "no fixture" condition - a fixture exists, it is just not reachable
without an unacceptably wide sweep given how it aged. Not attempted. No watermark write, no invoke,
nothing changed.

## The two questions, both still open

* **Is a wholesale order at an eligible stage silently dropped?** Still unanswered. R5's confound
  (wholesale and already-excluded-stage perfectly correlated in that data) stands.
* **Did a skip counter stop reporting?** Not directly tested here either, since Gate B did not run.
  Gate C's four-cycle counter comparison (slice 04, slice 11, R5, this slice) is not attempted without
  this slice's own cycle to add as the fourth row.

## Recommendation

**Add a sixth check to `scripts/watch-for-fixtures.sh`: a wholesale order at `New` or `Processing`
whose `modifiedDate` is within the last hour or two**, alongside an ECOM control from the same narrow
window. That is exactly what would make R8 runnable without the blast-radius problem hit here. R9 as
built only watches for the five shapes already parked; this is a sixth, newly understood as necessary
by this slice, not something to build unilaterally from here without the user's steer.

Until then: **re-check Gate A opportunistically**, same spirit as R9, but specifically for a wholesale
order caught soon after it enters `New`/`Processing`, not merely "one exists somewhere, however old."

## Fails if / Stop and ask JJ

None of R8's own three stop conditions were reached (Gate B never ran, so none of "vanished with no
counter," "sent with the wrong `ShipTo`," or "a counter that populated on 2026-09-02 no longer does"
was tested). Flagging instead on the root plan's own condition: **the blast radius this fixture would
require is wider than any slice in this pass has assumed, and that is worth JJ knowing before anyone
else reaches for `THE ICONIC` order as a shortcut.**

## Teardown

None. Nothing was changed. Watermark and poller schedule both untouched.
