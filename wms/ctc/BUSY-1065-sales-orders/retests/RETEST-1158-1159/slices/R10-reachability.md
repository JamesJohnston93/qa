# Slice R10, reachability

**Ticket:** BUSY-1158 and BUSY-1159 re-test, infrastructure for the rest of the pass
**Cases:** none directly. This unblocks R3, R8, and the four fixture-dependent cases.
**Depends on:** R3, R8 and R9, all done.
**Estimated:** 30 minutes. Read only except Gate B, which runs cycles bounded to ~6 minutes.

## The actual problem, which is not traffic volume

R8 and R3 both stopped on blast radius within fifteen minutes of each other, and `STATE.md` reads that
as heavy volume in the environment, recommending a wait until it settles. **The measurements say
otherwise, and waiting makes it worse.**

Every window measured this pass, converted to a rate:

| Slice | Window | Orders | Rate |
|---|---|---|---|
| R5 | 00:57:41Z to 01:33:24Z, 36 min | 8 | 13.4/hr |
| R3 | 02:17:25Z to 03:26:29Z, 69 min | 103 | 89/hr |
| R8 | 04:07:28Z Sep 3 to ~03:55Z Sep 4, 24 hr | 223 | 9.4/hr |

R3's own result names what makes its row different: roughly 90 of those 103 orders moved in a single
83 second burst, `03:25:06Z` to `03:26:29Z`, "by timestamp density almost certainly one warehouse
batch-dispatch job". Take the batch out and R3's window holds about 13 orders in 69 minutes, which is
R5's rate exactly.

So the organic rate is stable at roughly 9 to 13 orders an hour across every independent measurement,
and a 30 to 60 minute window holds single digits, which is what R4 and R5 both ran on comfortably.

**One batch-dispatch job accounts for the entire blast-radius problem.** It is a discrete recurring
event, not a traffic level, and a window is workable if and only if it does not span one.

Two consequences, both the opposite of waiting:

* A target on the far side of a batch is not reachable by waiting. It gets further away, because the
  window only ever grows and the next batch adds another ninety.
* R3's four orders and R8's `THE ICONIC` order are already past a batch. Nothing in the current method
  recovers them.

## Gate A, is the deployed code readable

Ask this first because it may retire several open questions outright, and because it is a decision for
JJ rather than a step to take.

Six things on these two tickets are currently INCONCLUSIVE or UNKNOWN for the same stated reason,
that they are not provable from outside the repo: BUSY-1158 TC1b, TC7, TC7b, Q27's write side, the
1160 version guard's real behaviour, and the mechanism behind R5's wholesale drop.

The team has no repo access. That is not the same as having no access to the deployed artifact.

```bash
aws lambda get-function --function-name staging-orders-cin7-so-poller \
  --profile staging --region ap-southeast-2 --query 'Code.Location'
```

**Report whether a location is returned. Do not download it, and do not read any code, in this
session.** That is JJ's call, not the session's, for three reasons worth stating in the result:

* it turns black-box QA into white-box QA, and several QA doc rows are written on the black-box
  premise
* a bundled or minified artifact may not be readable in practice even when it downloads
* whether QA reading a deployed bundle is appropriate here is a question for JJ and Kian, not a
  technical one

Capture: whether the call succeeds, and the artifact size if the response carries it. Nothing else.

## Gate B, can the poller's window be bounded above

The watermark sets the lower bound. The upper bound is invoke time, which is why staleness and blast
radius are the same thing. If the poller accepts an upper bound, that stops being true and every
stalled slice becomes runnable regardless of how old its fixture is.

`invoke-so-poller.sh` sends `--payload '{}'`. Whether the handler reads anything from that payload is
unknown, and it is cheap to find out.

**Safe probe design.** Set the watermark to one minute ago. Then even if every override is ignored,
the poller's real window is that minute plus its own 5 minute lookback, about 6 minutes, which at the
measured organic rate is one or two orders. That is a normal cycle, not a sweep.

Do not run this probe within twenty minutes of a dispatch batch. Gate C tells you when those are.

1. Read and record the watermark. Restore it at teardown.
2. `./cin7-watermark.sh --stage staging --profile staging --poller so --set <now minus 1 minute>`
3. Count the real window against Cin7 directly before invoking, as every slice this pass has done.
   Expect one or two orders. **If it is more than five, stop, something is running.**
4. Invoke with a payload carrying a candidate upper bound, and read the `modifiedSince` /
   `modifiedBefore` pair the poller logs. R5 confirmed it logs both.

Try these spellings, one invoke each, most likely first:

```
{"modifiedBefore": "<now minus 4 minutes>"}
{"modifiedTo": "<now minus 4 minutes>"}
{"until": "<now minus 4 minutes>"}
{"modifiedSince": "<X>", "modifiedBefore": "<Y>"}
```

The last one is worth trying even if the others fail, since a handler that takes a full window may not
take half of one.

**The evidence is the logged window, not the outcome.** If the logged `modifiedBefore` matches what
was passed, the override works. If it is invoke time, that spelling is ignored.

Stop after the first spelling that works. Stop after the fourth either way, four small cycles is
enough.

Capture: per attempt, the payload sent and the window logged, verbatim. And whether `ordersFetched`
tracked the logged window.

**If any spelling works, say so at the top of the result.** R3, R8, both of R9's `[PAST]` fixture
classes and TC9, TC15 and TC6 all become runnable immediately, on fixtures that already exist and
have been found.

## Gate C, when does the dispatch batch run

Read only, no invoke, no watermark write. One Cin7 GET per day over the last seven days, or one wider
GET paginated, reading `modifiedDate` only.

Bucket every CTC order's `modifiedDate` by hour and print the counts. A batch shows as a spike of
roughly 90 in a single minute against a background of 9 to 13 an hour.

Capture: the hour histogram, and for each spike its date, time, and size.

Three things to answer:

* is it daily, and at roughly the same time
* how many are there per day
* what is the longest reliably clear interval between them

That last one is the deliverable. It is the window inside which a fresh fixture can be caught and
polled, and it is what R9's watcher and every future controlled cycle should be scheduled around.

Add the finding to `TOOL-NOTES.md`, since it constrains every slice in this plan and any future one.

## Teardown

* Restore the watermark to `2026-08-28T01:35:45.769Z`, read it back, confirm.
* Poller schedule stays DISABLED.
* Record any order the Gate B probes created, so the next full-table scan is not surprised by it.

## Data handling

No width-based truncation on log output. Select fields with `--query` or `jq`.

## Write results to

`results/R10-reachability.md`.

Lead with Gate B's answer, since it decides whether the rest of the pass is blocked or not.

Update `STATE.md`, and correct its "check traffic levels before attempting R3 or R8 again" line, which
this slice's Gate C either supports with numbers or replaces.

## Stop and ask JJ if

* **Gate B finds a working upper bound.** Interrupt for it. Three stalled slices and four parked cases
  become runnable the same day, on fixtures already identified.
* Gate A's call returns a code location. That is a decision about how this team tests, and it should
  be JJ's before anyone downloads anything.
* the probe window holds more than five orders when it should hold one or two.
* Gate C finds the batch is not a single recurring job but continuous, since the whole reachability
  strategy then changes.
