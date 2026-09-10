# Result: Slice R10, reachability

**Ticket:** BUSY-1158 and BUSY-1159 re-test, infrastructure for the rest of the pass
**Gate B answer, up front: no working upper bound exists.** All four candidate payload spellings were
tried against the live poller, one invoke each. **Every one was ignored.** The fetch window is always
`[watermark minus 5 minutes, invoke time]`, with no override. Staleness and blast radius are
structurally the same problem for this handler, confirmed rather than suspected. **R3's four orders,
R8's `THE ICONIC` order, and every `[PAST]`-tagged candidate from R9 stay unreachable by this method.**
The rest of the pass is not unblocked by R10. `STATE.md`'s "wait for traffic to settle" line is wrong
for a different reason than assumed, corrected below with Gate C's numbers: waiting does not help
either, because reachability is about not spanning a batch on the way to a target, not about the
target itself sitting in a quiet spot.

## Gate A, is the deployed code readable

**MEASURED: yes, a location is returned.**

```
aws lambda get-function --function-name staging-orders-cin7-so-poller --profile staging \
  --region ap-southeast-2 --query 'Code.Location'
```

Returned a presigned S3 URL (`RepositoryType: S3`), valid 10 minutes per its own `X-Amz-Expires=600`.
Artifact size (`Configuration.CodeSize`): **394,934 bytes** (~386 KB). **Not downloaded. Not read.**
Per the slice's own instruction, this is a decision for JJ, for three reasons worth restating here
rather than acting on: it would turn this black-box QA pass into white-box QA, several QA doc rows are
written on the black-box premise; a bundled/minified artifact may not be readable in practice even if
downloaded; and whether QA reading a deployed bundle is appropriate at all is a question for JJ and
Kian, not a technical one this session can settle by itself.

**This is a stop-and-ask item**, per the slice's own list: "Gate A's call returns a code location.
That is a decision about how this team tests, and it should be JJ's before anyone downloads anything."
Flagging it now rather than at the end.

## Gate B, can the poller's window be bounded above

**No.** Method, exactly as specified: watermark set to roughly one minute before invoke time each
time (so even a fully-ignored override still only processes a 6-minute, 1-or-2-order window), real
window counted against Cin7 directly before each invoke (0 orders every time, well under the 5-order
stop threshold), one invoke per spelling, watermark reset between attempts, restored to
`2026-08-28T01:35:45.769Z` at the end.

| Attempt | Payload | Logged `modifiedSince` | Logged `modifiedBefore` | Matched what was sent? |
|---|---|---|---|---|
| 1 | `{"modifiedBefore": "2026-09-04T04:57:19Z"}` | 2026-09-04T04:53:25.000Z | 2026-09-04T05:01:53.727Z | No, `modifiedBefore` = invoke time |
| 2 | `{"modifiedTo": "2026-09-04T05:02:00Z"}` | 2026-09-04T04:58:00.000Z | 2026-09-04T05:02:27.785Z | No, `modifiedBefore` = invoke time |
| 3 | `{"until": "2026-09-04T05:02:20Z"}` | 2026-09-04T04:57:00.000Z | 2026-09-04T05:02:57.606Z | No, `modifiedBefore` = invoke time |
| 4 | `{"modifiedSince": "2026-09-04T05:03:15Z", "modifiedBefore": "2026-09-04T05:04:00Z"}` | 2026-09-04T04:58:15.000Z | 2026-09-04T05:04:33.128Z | No, both bounds derived from watermark/invoke time, payload's values not used |

Every attempt: `ordersFetched=0`, `created=0`, nothing else moved. Four small, side-effect-free cycles,
exactly as the slice designed. **All four spellings ignored, including the combined
`modifiedSince`/`modifiedBefore` pair**, which the slice flagged as worth trying even if the individual
ones failed, on the theory a handler might take a full window but not half of one - not the case here
either.

**Conclusion: the invoke-time payload does not influence the fetch window at all.** The handler reads
`{}` or any of these four shapes identically. If an upper bound exists, it is not reachable through the
Lambda invoke payload; this rules out the cheapest, safest path and leaves reading the deployed code
(Gate A, JJ's call) or asking Kian directly as the remaining options.

## Gate C, when does the dispatch batch run

Read only, no invoke, no watermark write during this gate. One Cin7 GET, paginated with
`fields=modifiedDate` to keep it cheap: 17 pages, **1,617 orders** across both CTC branches, spanning
`2026-08-30T22:18:07Z` to `2026-09-04T04:49:34Z` (the 7-day request window itself returned nothing
older than 08-30T22, i.e. genuinely no CTC order activity in this data before that point).

**The premise of a single daily batch does not hold. There are several elevated-volume events per
active period, of widely varying size, at irregular spacing.** Clustering every one-minute bucket with
10+ orders (gap of more than 10 minutes between spike-minutes = a new event) found **22 distinct
events** across the ~4.5 days of data, ranging from **10 to 455 orders each** (R3's own ~90-order batch
sits in the middle of that range, not at the top).

**The real, load-bearing structure is a daily active/quiet cycle, not a single batch time:**

```
Total orders by hour-of-day (UTC), summed across every day in the dataset:
00: 565   01: 221   02: 111   03: 228   04: 245   05: 22   06: 12   08: 2
21: 1     22: 102   23: 108
(hours 07, 09-20 not shown: 0 orders across the entire ~4.5 day dataset)
```

Activity concentrates almost entirely in **UTC 21:00-05:59** (roughly 9 hours), and is essentially
**zero for the other ~15 hours** (UTC 06:00-20:59). In AEST (UTC+10) that is order/dispatch activity
during roughly **07:00-16:00 AEST**, consistent with a warehouse operating standard Australian business
hours, and near-total silence outside them.

**Gaps between the 22 events, split by where they fall:**

* **Within the active window**: 17 gaps measured, ranging 12 to 136 minutes, median 40 minutes, mean
  56 minutes. No fixed time of day, no reliable minimum - the 136-minute longest observed gap is not a
  guarantee, and the shortest was 12 minutes.
* **Between active windows (i.e. the daily quiet period)**: 4 gaps measured, 17.9, 18.8, 21.7 and 25.0
  hours. **This is the only genuinely reliable clear interval** - during it, the dataset shows literally
  zero order activity, not just an absence of large batches.

**Answers to the three questions asked:**

* **Is it daily, at roughly the same time?** No, not as a single event. The *active window* itself
  recurs daily at roughly the same hours (UTC 21:00-06:00); *within* that window, multiple
  elevated-volume events occur at irregular times, not one fixed slot.
* **How many per day?** Roughly 8-9 events per active window in this data (day of 2026-08-31 alone had
  9), sized anywhere from 10 to 455.
* **What is the longest reliably clear interval?** Not within the active window - the longest
  *observed* gap there (136 min) is not a promise, medians run closer to 40 minutes. The only
  **reliable** clear interval is the daily quiet period itself, roughly UTC 06:00-20:59 (~15 hours),
  where the measured order-modification rate is zero.

**Practical consequence, which cuts against `STATE.md`'s "wait for traffic to settle" advice:**
Waiting does not create a safe window for reaching an *already-stale* target (R3's four orders, R8's
`THE ICONIC` order) - per R10's own framing, a target on the far side of a batch only gets further
away, and this holds regardless of which part of the daily cycle it is now. Waiting *does* help for a
**fresh, no-fixture-dependent** action like a bounded replay probe (this gate's own Gate B used one) -
those are safest run either during the quiet UTC 06:00-20:59 stretch (zero background activity to
sweep in) or immediately after checking the live window count, as this slice's own method requires
regardless of time of day.

Added to `TOOL-NOTES.md`: the daily active/quiet cycle and the 22-event size/spacing table, since this
constrains every future watermark-touching slice, not just this one.

## Teardown

* Watermark restored to `2026-08-28T01:35:45.769Z`, read back and confirmed.
* Poller schedule confirmed `DISABLED` throughout (never touched).
* No order was created by any of the four Gate B probes (`ordersFetched=0` on all four).

## Scripts written

`scripts/probe-poller-payload.sh`, this slice. Invokes the poller with a caller-supplied payload
(mirrors `invoke-so-poller.sh`'s invoke-then-tail-logs shape, but does not send `'{}'`) and prints its
structured metric lines. Read only against Cin7 in effect (each invoke's own window was verified empty
before running), but it does invoke the lambda, so **not** read only as a script property - noted
plainly. **Not reviewed.** Row to add to `SCRIPTS.md`.

## Stop and ask JJ

* **Gate A returned a code location.** Flagged above. Not acted on.
* **No spelling worked in Gate B**, which is itself close to "an upper bound doesn't exist by this
  method" rather than "found one" - the slice's own trigger is for the positive case, but the negative
  result is exactly as consequential: it forecloses the cheapest path to unblocking R3/R8/TC6/TC9/TC15
  and leaves reading deployed code (Gate A) or asking Kian directly as the remaining options.
* Gate C's finding that dispatch batches are **not** a single recurring job but multiple irregular
  events per active window is close to the slice's fourth stop condition ("the batch is not a single
  recurring job but continuous") without being identical to it - not continuous, but frequent and
  irregular enough that the "whole reachability strategy" framing in that condition applies. Worth
  JJ/Kian knowing this reshapes what "avoid the batch" can mean in practice.

## Recommendation

Given no upper-bound override exists, the three practical options are: (1) ask Kian directly whether an
upper-bound parameter exists under some other name or mechanism not triable from outside; (2) get JJ's
decision on Gate A's code-readability question, which could answer the same question definitively; (3)
accept that R3/R8/TC6/TC9/TC15's stalled fixtures are permanently unreachable and focus fixture-hunting
on catching a **fresh** occurrence during a business-hours event count small enough (R9 rev 2, if
extended with the reachability classification already planned) rather than trying to reach a fixture
that has already gone stale.
