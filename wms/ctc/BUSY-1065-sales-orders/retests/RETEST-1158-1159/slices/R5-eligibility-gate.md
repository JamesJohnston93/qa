# Slice R5, the eligible-stage gate

**Ticket:** BUSY-1159, AC5
**Cases:** TC14, and open question Q31
**Depends on:** R0 Gate B, which measured `staging-orders-cin7-so-poller` changed on 2026-09-03. The
gate lives in the poller, so it may have been fixed.
**Estimated:** 30 minutes, opportunistic. Cheap to re-run on another day.

## What is being settled

Q31 is the one thing blocking BUSY-1159 sign-off, and it is code against intent rather than a defect
anyone reported.

The LLD makes `New`, `Processing`, `Partially Picked` and `Fully Picked` eligible, and dev confirmed
that intent on 2026-09-01. Slice 11's controlled single-cycle measurement on 2026-09-02 showed the
deployed poller flagging `Fully Picked` as ineligible: target `975303Sep26` at `Fully Picked` appeared
in `skippedStages {'Fully Picked': 1}` while a same-cycle `New` control, `UQLD160-3773`, did not
appear in any stage counter. That ruled out the alternative explanation that any skip picks up a stage
tag, and proved the stage check fires independently.

`Partially Picked` was never independently measured. It is inferred to share the code path.

The poller changed on 2026-09-03. If the fix included the stage gate, this closes.

## The fixture problem, unchanged

TC14 has two halves and only one of them is about the gate.

The other half is absence: **no ECOM order has ever been observed at either picked stage**, across
five independent checks (a 225 order live sample, 14 days of poller history, a 32 order individual
wholesale check, an 18 order 6 hour scan, and slice 11's 1 order narrow window). Every order ever seen
at a picked stage is wholesale.

So even a fixed gate leaves TC14's ECOM half blocked on a fixture that does not exist. Do not report a
fixed gate as TC14 PASS. They are separate findings.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
./cin7-watermark.sh --stage staging --profile staging --poller so
```

Record the watermark. Expect `2026-08-28T01:35:45.769Z`. **Restore it at teardown.**

Cin7 is CTC live production. GET only.

## Gate A, does a fixture exist at all

Trigger:

```bash
./find-picked-stage-orders.sh          # ../../BUSY-1159/scripts/
```

It does one Cin7 GET for orders currently at `Fully Picked` or `Partially Picked` and prints the
company name per order. Company name is a fast proxy for wholesale versus ECOM, not a firm call. Any
candidate that looks ECOM needs the contact group check:

```bash
./find-cin7-sales-order.sh --with-contact     # tools root
```

Three outcomes:

* a `Fully Picked` order exists, wholesale or ECOM: the mechanism half is runnable, go to Gate B
* a `Partially Picked` order exists: run Gate B against it too, and the inference becomes a
  measurement
* nothing at either stage: **stop here.** Record that the slice found no fixture, leave TC14 as is,
  and re-run tomorrow. This is the expected outcome most days and it is not a failure of the slice.

## Gate B, the controlled single-cycle measurement

Only if Gate A found something.

Trigger: reproduce slice 11's method exactly, since its result is what this is being compared to.

1. Pick the picked-stage target and a stage-eligible control (`New` or `Processing`) that both fall
   inside one bounded cycle window.
2. Confirm with `find-picked-stage-orders.sh` that the target is the **only** order at a picked stage
   in that window, so a stage counter attributes unambiguously.
3. Set the watermark to a narrow window bounding both, `--poller so`.
4. One manual poller invoke. One cycle, not several.
5. Read `skippedStages` and every other counter on the cycle.

Expect, if the gate is fixed: the target is treated as eligible and sent. No `skippedStages` entry for
its stage.

Expect, if it is not: `skippedStages {'Fully Picked': 1}` attributable to the target, control absent
from any stage counter. Same as 2026-09-02.

Capture: the exact window bounds, both references, every counter on the cycle, and whether the target
produced a shipment. Compare directly against
`../../BUSY-1159/results/11-*.md` and say whether the outcome changed.

Fails if: the target is still skipped on stage. Q31 stays open, BUSY-1159 stays unsignable, and the
finding goes back to Kian as a second controlled measurement rather than a first, which is stronger.

Inconclusive if: more than one order at a picked stage entered the window, so a counter of 1 cannot be
attributed. Redo with a narrower window rather than reporting it.

### If the target is wholesale, which it probably is

That is fine for the mechanism half. The stage gate is stage logic, and a wholesale order at
`Fully Picked` measures it as well as an ECOM one would.

But say so explicitly in the result: **mechanism measured on a wholesale order, ECOM half still
inferred.** Do not let the row read as though an ECOM order was tested. That copy-from-result-into-row
seam is exactly what the 2026-09-02 audit found going wrong.

Note also that BUSY-1160 introduces wholesale mapping, so a wholesale order at a picked stage may now
behave differently from how it did on 2026-09-02 for reasons unrelated to the stage gate. If the
target sends, check whether it sent as wholesale with the delivery company as `ShipTo`, and hand that
observation to BUSY-1160 rather than folding it into TC14.

## Teardown

* Restore the watermark to `2026-08-28T01:35:45.769Z` and read it back.
* Leave the poller schedule DISABLED.
* If the target sent, record its `ShipmentId` so R6 can read it.

## Write results to

`results/R5-eligibility-gate.md`.

State the two halves separately: the mechanism verdict, and the ECOM fixture verdict. Propose the Q31
register update, do not edit the register from this session.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* the gate is fixed, since that closes Q31 and unblocks 1159's sign-off path, and JJ will want to know
  immediately rather than at the end of a session
* the gate is still wrong, since that is now a second controlled measurement contradicting a stated
  intent and it needs to go to Kian
* an ECOM order is found at a picked stage. That fixture has never existed and TC14's other half
  becomes runnable for the first time, which is worth interrupting for
* the poller picks up references outside the intended window
