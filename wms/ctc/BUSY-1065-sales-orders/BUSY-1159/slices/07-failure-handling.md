# Slice 07, failure handling

**Ticket:** BUSY-1159
**Cases:** TC9, TC15
**Depends on:** slice 01
**Estimated:** one session, plus retry wait time

Both cases need a naturally occurring bad condition, because Cin7 data cannot be created or malformed. If the condition cannot be found, the case is BLOCKED, not FAILED.

## Preconditions

* Slice 01 passed.
* Poller schedule rule enabled.
* Dead letter depths snapshotted, so a parked message can be attributed to this slice.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
./check-ctc-status.sh --stage staging --profile "$AWS_PROFILE"    # baseline depths
```

## Cases

### TC9, SCALE rejection is treated as a failure
Trigger: find an order carrying a product option code absent from the SCALE staging item master, confirm the absence in the SCALE UI first, then poll it in a narrow window.
Expect: the sender logs a non zero `rejected` count, or `accepted=0`, a `ManhattanRequestOutcome` line with outcome `rejected`, and an error line naming the flow and reference. The shipment header carries no `wmsSentAt`. The queue retries up to 20 times, then the message parks on the sender dead letter queue.
Capture: the outcome line, the absence of `wmsSentAt`, and the dead letter depth change.
Fails if: the rejection is treated as success, or `wmsSentAt` is stamped anyway.
Blocked if: no such order can be found. The behaviour is covered by automated tests, so record BLOCKED with that reason rather than leaving the row silent.

### TC15, containment within a cycle
Trigger: find a window holding one order that will hard error alongside at least two valid ECOM orders. The reachable hard error conditions are an unmapped contact group, an unmapped delivery state or country, a reference over 25 characters, or an unrecognised tax status. An international delivery address is the easiest to find, since CTC sells internationally.
Expect: the valid orders in the same cycle are still created and sent. The bad order raises its alert and is skipped. The watermark advances once, past all of them.
Capture: which orders were created, the alert line for the bad one, and the watermark before and after.
Fails if: a valid order in the same cycle is not created. That is the containment failure the purchase order flow already showed, where a handler batching messages against its own timeout redelivers the whole batch. If it fails, check whether a header was written over partly written lines, since that failure mode looks healthy from the header alone.
Blocked if: no window contains both conditions.

## Teardown

Leave any parked dead letter message where it is and record its presence. Do not redrive or purge without asking JJ. Disable the schedule rule if no further slice runs today.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/07-failure-handling.md`
