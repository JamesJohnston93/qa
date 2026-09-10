# Slice 07, the Cin7-reading half

**Ticket:** BUSY-1161
**Cases:** TC9, TC11, TC16, TC17
**Depends on:** slices 03 to 06 done, and JJ available
**Estimated:** one session, with JJ present for the watermark moves

**Run this last.** Restoring the poller schedule pulls real CTC traffic into staging continuously, which makes every injected case noisier. Every case before this one proves a handler behaved given an input the system was sent. **This slice is the only one that proves the code reading Cin7 produces that input in the first place.** Everything else rests on it, and it is the only slice whose verdicts escape the revision tool's caveat, because nothing here is manufactured.

## Preconditions

- JJ present. The watermark is a write to SSM and the schedule is a live change; both are his to authorise.
- Slice 01 Gate D's recorded schedule and watermark values, so they can be put back exactly.
- Cin7 read access, GET only. JJ runs anything needing production credentials himself.

## Setup

Record the watermark's current value before touching it. `common/cin7-watermark.sh` in the engineer's toolset **defaults to the item master poller**; the poller flag has to be passed explicitly every time, and the wrong flag rewinds the item master feed. Its wait-time guidance prints the item poller's wording whatever poller is named, so ignore that line.

The poller fetches from the watermark minus five minutes, so any window is five minutes wider than the value set. Carried over from BUSY-1159.

## Cases

### TC9, real wholesale order end to end

Trigger: find an eligible real wholesale order on branch `51908` or `51909` with the engineer's `find-cin7-sales-order.sh`, which resolves the contact group with `--group`, status Approved and stage New or Processing. His `survey-contact-groups.sh` gives the population if no single candidate turns up. Write down the current watermark. Rewind it to just before that order's last-modified value. Wait for one cycle, then up to five more minutes.

Expect: the order reaches SCALE, and what SCALE holds matches what Cin7 holds.

Capture: the Cin7 order's own header and line values, the stored rows, and the SCALE Shipment, side by side. This is the comparison the whole case exists for.

Fails if: the order does not arrive, or any mapped field differs from Cin7.

**Restore the watermark** to the value written down in the trigger. Leaving it rewound makes the poller re-read an old window on every cycle.

**Q35's data half is open here.** No real wholesale order has ever reached the system at an eligible stage. If none can be found, TC9 is BLOCKED on a Cin7 population fact, not on a code gap, and that is worth recording as such rather than as a failure.

### TC11, revise an order already at `Dispatched`

Trigger: a real order whose stage is `Dispatched`, pulled in the same way.

Expect: nothing created, nothing changed, no error and no alert.

Capture: the skip evidence from the poller's own cycle log, and the absence of any downstream record for that reference.

Fails if: a Shipment appears. `Dispatched` is terminal.

Note: a skip counter reading zero is not evidence the order was handled. BUSY-1159's Q38 found the poller's cycle counters have never balanced. Read the cycle log for the specific reference, not the aggregate.

### TC16, wholesale order on branch `51908`

Trigger: the same rewind technique against a real order on `51908` rather than `51909`. If no eligible one exists, fall back to the injected half, `--scenario 13-branch-qdc --family outbound`, and say in the note that the case ran injected rather than live.

Expect: the warehouse code the deployed poller now produces, which is `CTC-QDC` unconditionally, and SCALE accepts it.

Capture: the stored `warehouse` value and what SCALE holds.

Fails if: the code is `CTC-WH`, which SCALE rejects as an invalid warehouse. That was Q41, closed by a source read and a runtime confirmation on 2026-09-09; a recurrence means the fix was reverted.

**This is drift row 3.** The LLD still specifies a branch-keyed lookup, `51909` to `CTC-QDC` and `51908` to `CTC-WH`. The deployed code has no branch read left at all. The case records what the build does; the LLD is the artefact that needs correcting.

### TC17, live ECOM order through the same cycle

Trigger: no separate trigger. With the schedule restored, real ECOM orders flow. Pick one from the same cycle as TC9.

Expect: it travels the native path, gets a `wmsSentAt` on the native header, and writes **no** outbound records.

Capture: the native shipment header, and a confirmed absence of any `OUTBOUND_ITEM#` row or `category = OUTBOUND` transaction under that order's key.

Fails if: an ECOM order produces outbound records. The outbound family must not have widened its own routing.

## Teardown

**The most important teardown in the plan.** Set the watermark back to the value recorded at the start, confirm it with a direct `get-parameter` rather than trusting the write, and set the schedule back to DISABLED. Watermark writes have shown a pickup lag from one cycle to 33 minutes, so confirm rather than assume.

Register every real order this slice touched, so a later session does not read them as synthetic.

## Write results to

`results/07-cin7-reading-half.md`.

## Stop and ask JJ if

- no eligible real wholesale order can be found. That is Q35's data half and it is his call whether to hold TC9 or defer it.
- an ECOM order produces outbound records
- the watermark does not read back the restored value after two attempts
- real customer data has to be quoted to evidence a case. Redact first, and read `../CTC-customer-data-in-cloudwatch.md`.
