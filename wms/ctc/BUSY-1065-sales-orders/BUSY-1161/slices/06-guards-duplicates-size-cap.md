# Slice 06, guards, duplicates and the size cap

**Ticket:** BUSY-1161
**Cases:** TC10, TC12, TC13, TC14, TC20, TC21, TC22
**Depends on:** slice 02 (the fidelity gate and its difference list)
**Estimated:** one session, read-heavy, no SCALE UI needed for TC12 to TC14

Only TC10 and TC20 need SCALE, so this slice can run ahead of 03 to 05 if the SCALE login is what is holding those up.

**How the version cases are driven.** There is no flag to set a last-modified value. The fixtures ascend in it, so re-applying an earlier scenario after a later one is an older save. That is the whole mechanism.

## Preconditions

- Slice 02's difference list. If the tool's constructed last-modified field differs from the deployed shape, TC12 and TC13 prove nothing and this slice stops.
- Fresh references. Register each in `../BUSY-1160/SYNTHETIC-REGISTER.md` before emitting.

## Setup

Use a new order for this slice, not one from slices 03 to 05. Two of these cases put the header into states the earlier slices' orders should not be left in.

## Cases

### TC10, apply one revision twice unchanged

Trigger: emit `01-baseline`, then `07-echo-stage-only --family outbound`, then re-apply that unchanged.

Expect: exactly one Shipment in SCALE, no doubled lines, quantities unchanged.

Capture: the Shipment's line list, and both handler invocations.

Fails if: a second Shipment appears, or lines double.

**The trap.** The orders-to-shipping queue deduplicates on content over a five-minute window, so a replay inside it is dropped by the queue rather than by the idempotency guard, and the case then proves nothing about the guard. Leave more than five minutes between the two emits, or vary a field the hash does not cover, and say in the note which was done.

### TC12, replay a save older than the stored header

Trigger: apply `02-size-qty-increased`, then re-apply `01-baseline`, whose last-modified value is an hour earlier.

Expect: no write, and a stale-revision metric.

Capture: the metric line with both the incoming and the stored `lastModified`, and the header's `lastModified` afterwards, unchanged.

Fails if: the header moves.

**Equal timestamps apply, they are not stale.** Cin7 `modifiedDate` has whole second precision, so the guard passes on equal, not only on newer. A test asserting strict inequality reports a false defect. Re-applying one scenario twice is the equal arm; expect it to apply rather than be rejected.

This is the materialiser's guard. BUSY-1160's TC12 proved the same mechanism on the orders-side handler; the outbound materialiser is a different function and has not been shown to behave the same way.

### TC13, deliver a save after the header is cancelled

Trigger: apply `08-ineligible-declined`, which cancels, then apply `10-zero-qty-size`, whose last-modified value is two minutes later.

Expect: the header stays `CANCELLED_OUTBOUND`, nothing is sent to SCALE.

Capture: the header status after the save, and the absence of a send in the sender's log for that reference.

Fails if: the header flips out of cancelled, or a Shipment reappears in SCALE. This is the third limb of AC5 and the one with the worst real-world consequence: stock picked against an order that was cancelled.

### TC14, wholesale order past the event size cap

Trigger: emit a wholesale order with enough size rows to exceed the event payload cap. LLD section 3 gives 256 KB; the PO flow measured the real breach nearer 240 KB. BUSY-1159 section 10.2 put the largest real order at 83 size rows, about 7 percent of the cap, so this needs a deliberately built payload.

Expect: routed to the error path. Not split, not silently dropped.

Capture: the poller or handler's own error path evidence, the `PutEvents` `FailedEntryCount`, and whether anything reached the materialiser.

Fails if: the payload is split across events, or nothing at all is recorded. A counter reading zero is not evidence of correct routing; that is precisely why BUSY-1159's TC19 handed this half here.

Note: the alert this would raise reaches nobody. Both alert topics have zero subscribers, owned by BUSY-1162. Absence of an alert is not this case's FAIL.

### TC20, two sizes on one line sharing a size code

Trigger: a fresh reference, `--scenario 14-duplicate-size-code`.

Expect: unknown, and the case exists to settle it. Detail-line identity is the pair of line number and item code, so two sizes sharing both collide on that pair.

Capture: the stored row keys, what the sender built, and what SCALE holds. The engineer's SCALE probe validates locally that one document carries no duplicate line number, so the collision may be caught before the send.

Fails if: one of the two rows is silently lost with no counter and no error. Surviving as distinct rows is defensible and so is a clean refusal; a silent drop is not.

### TC21, a size carrying zero quantity

Trigger: a fresh reference, `--scenario 10-zero-qty-size`.

Expect: the zero-quantity size skipped and counted, and no zero-quantity line in SCALE.

Capture: the skip counter for that cycle, the stored row set, and the SCALE line count.

Fails if: a zero-quantity line reaches SCALE, or the size is dropped with no counter. BUSY-1159 proved this on the native path; the outbound grain is one row per size and has not been shown to behave the same way.

### TC22, a line whose `sizes[]` array is empty

Trigger: a fresh reference, `--scenario 11-single-size-line`.

Expect: unknown. **This is correction C10 from BUSY-1159, and a fixture for it now exists.** The deployed poller skips a line whose `sizes[]` is empty; the LLD specifies a fallback to the line's own code and quantity in five places. C10 was carried without an observed occurrence because none could be found in real traffic.

Capture: whether the line falls back or is dropped, the counter if one increments, and whether anything reaches SCALE for that line.

Fails if: nothing fails against the build. **Record which of the two it does.** If it drops the line, C10 stops being a divergence with no observed occurrence and becomes one with evidence, which is a materially stronger thing to hand Lachlan. Say so in the note and in the result file.

## Teardown

Leave the records. Update this slice's rows in `../BUSY-1160/SYNTHETIC-REGISTER.md` with their end states. Confirm the schedule is still DISABLED and the watermark still UNSET.

## Write results to

`results/06-guards-duplicates-size-cap.md`.

## Stop and ask JJ if

- TC13 resurrects a cancelled header. Stop everything and tell him, this is the highest-severity outcome in the plan.
- TC14's oversize payload is accepted rather than refused
- the DLQ depth moves for a reason this slice did not cause
- TC22 shows the line silently dropped. That closes C10 with evidence, and JJ decides whether it becomes a defect rather than a correction.
