# BUSY-1158 and BUSY-1159 re-test, IDE kick-off prompts

Open the IDE with `BUSY-1065-sales-orders/retests/RETEST-1158-1159` as the working folder, not the tooling root, or the
`../` paths in the slices will not resolve.

Run `aws sso login --profile staging` first if the session has expired. Browser device-code flow,
needs a human.

Read `PLAN.md` for why each session exists, then `STATE.md` for what has already run.

## Done

**R0**, **R5**, **R4**, **R1**, **R9** rev 1, and stopped runs of **R8**, **R3** and **R2**. Results in
`results/`. Do not re-run R0, R5, R4 or R1.

## Revised again 2026-09-04, after R9, R8, R3 and R2

R8, R3 and R2 all stopped without running their cases. `STATE.md` reads that as heavy traffic and
recommends waiting for it to settle. **The rates say traffic was never the problem and waiting makes
it worse:** organic volume is a stable 9 to 13 orders an hour across every measurement this pass, and
a single warehouse batch-dispatch job of about 90 orders in 83 seconds accounts for the whole
blast-radius picture. A window is workable if it does not span a batch. A target on the far side of
one only gets further away.

Two new slices follow from that.

**`R10-reachability.md`** asks whether the poller's window can be bounded above at all. The watermark
sets the lower bound and invoke time sets the upper one, which is why staleness and blast radius are
the same thing. If a payload override works, R3, R8 and every `[PAST]` fixture become runnable the
same day. It also asks whether the deployed lambda artifact is downloadable, which is a decision for
JJ rather than a step, and maps when the dispatch batches actually run.

**`R9-fixture-watcher-rev2.md`** corrects two defects in the watcher spec, both mine. Check 1 compared
`modifiedDate` and so fired on stage progression, hitting 69 of 70. It has to compare content. And no
candidate carried its reachability, which is what R8 and R3 each spent a session rediscovering, so
every candidate now gets a window order count and a REACHABLE / EXPENSIVE / PAST classification. It
also adds the sixth check R8 asked for.

**`R2-lifecycle-gated-consumers.md`'s stale "Depends on R3" header is fixed**, and it now records the
79 of 79 still-`OPEN` reading.

## Revised 2026-09-04, after R1, R4 and R5

Two corrections drove this revision.

**The original R3 was invalid.** It was written around JJ making a sequence of live Cin7 edits, which
both ticket `CLAUDE.md` files already forbade. Cin7 is read only for everyone. It has been superseded
by `R3-update-semantics-no-cin7-write.md` plus `_parked-cin7-revision-cases.md`. The superseded file
is kept as `slices/_superseded-R3-update-semantics.md` so the mistake is visible rather than tidied
away.

**R5's wholesale finding has a confound.** Both orders that vanished were wholesale **and** both were
at a stage that was already excluded before the deploy. Wholesale and already-excluded-stage are
perfectly confounded in that data, so it cannot yet distinguish a new wholesale drop from the old
stage gate with a counter that stopped reporting. `R8-wholesale-exclusion.md` settles it before
anything goes to Kian.

## Run order

1. **R10** first, alone. Its Gate B decides whether the rest of the pass is blocked or not, and
   nothing else should be attempted until it answers.
2. **R9 rev 2**, the corrected watcher. Needed whatever R10 finds, and its reachability column is what
   stops a fourth session discovering a fixture it cannot reach.
3. Then, on a REACHABLE candidate only: **R8**, **R3**, and the parked cases.
4. **R2**, whenever `list-ctc-shipment-states.sh` shows anything off `OPEN`. 79 of 79 as at
   2026-09-04.
5. R6 and R7 are not IDE sessions.

Do not re-attempt R3 or R8 on their existing targets. Both are past a dispatch batch and neither is
reachable by the current method.

## R13, fresh data verification. Primary slice, rewritten 2026-09-07 after R11

Added 2026-09-07, and it supersedes the read-only framing of R11 and R12. Every question about the
redeployed build needs a CTC order that entered the pipeline after the deploy. Old rows cannot answer
any of them. R13 moves the watermark forward, enables the schedule for a bounded window, and verifies
each question against fresh orders.

Run R12's static pre-flight first, in the same session, and write the prediction down before the
watermark moves.

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then run
    slice R13 (slices/R13-fresh-data-verification.md). Read slices/R12-question-revalidation.md as
    well, its static checks are R13's pre-flight. Do not read the other slices. Write
    results/R13-fresh-data-verification.md and update STATE.md before you finish.

    This slice writes the watermark and enables the poller schedule, both restored at teardown. Cin7
    is never written to: no order created, edited, approved or voided, at any point.

    Two things that have burned previous sessions. The watermark moves FORWARD to just below the
    chosen fresh orders, abandoning the ten-day backlog, never backward. And the poller fetches from
    watermark minus 5 minutes, so count the window as [chosen watermark minus 5 minutes, now] and
    re-count immediately before enabling the schedule. R5 counted against the watermark, expected 6
    orders and got 8.

    Proceed only if the counted window is in single digits. Use the schedule for one cycle, not a
    manual invoke, because a manual invoke invalidates TC1 and TC11. Account for every order in the
    window by name: created, counted, hard-errored or unexplained. Stop and flag an unexplained order
    immediately rather than continuing to cycle 2.

Needs: an AWS staging session, and a live window in single digits.

Interrupt JJ if the window will not come down to single digits, if a dispatch batch starts mid-cycle,
if teardown fails, or if cycle 1 produces an unexplained order.

## R12, question revalidation. Static pre-flight for R13

Added 2026-09-07. A pipeline lambda was redeployed after the 09-04 pass, so every open question is
assumed stale until re-checked. One cheap state read per question, V0 to V10.

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then
    results/R11-pre-kian-confirmation.md, then run slice R12
    (slices/R12-question-revalidation.md). Do not read the other slices. Write
    results/R12-question-revalidation.md and update STATE.md before you finish.

    Read the slice's "trap in every behavioural check here" section before V1. The poller schedule
    has been disabled since 2026-08-28, so no CTC order enters the pipeline and absence of a CTC
    reference in a consumer log proves nothing. Only static checks are sound in this slice: event
    rules, filters, code SHAs, lambda existence, table contents. If a step needs an order to flow,
    stop and say so rather than reading absence as a pass.

    No watermark set, no schedule change, no poller invoke, no Cin7 write. The deliverable is DEAD,
    ALIVE or REFRAMED for each of K1 to K11 with the one piece of evidence that decided it.

Needs: nothing. No writes anywhere.

Interrupt JJ if V0 shows a lambda changed that R4, R1 or R5 rested on, since that puts prior PASSes
back in doubt.

## R11, pre-Kian confirmation. Supporting history reads, run after R13 cycle 1

Added 2026-09-07. R10 answered the reachability question and left four findings queued for Kian, three
of which rest on one cycle, two invocations or an unmeasured premise. Every one has a history-based
test that costs no blast radius. This slice runs those before the conversation, not after it.

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then run
    slice R11 (slices/R11-pre-kian-confirmation.md). Do not read the other slices except where R11
    names one. Write results/R11-pre-kian-confirmation.md and update STATE.md before you finish.

    Start with the slice's "Desk findings, 2026-09-07" section, then run Gate B0 before Gate A. B0
    can retire the largest finding in the pass: R5 read native order rows and called a wholesale
    order a silent drop, and the LLD says wholesale never emits native records at all.

    Six gates, B0 then A to E, all read only. No watermark set, no schedule change, no poller invoke,
    no Cin7 write, at any point in this slice. If a gate seems to need one, stop and say so rather
    than redesigning it.

    Gate A and Gate C are CloudWatch history sweeps over the poller log group. Save each as a script
    before running it, per CLAUDE.md, and print the counter names summed so the arithmetic is
    auditable. Gate B needs Cin7 GETs: resolve contact groups only on wholesale-looking candidates at
    New or Processing, and stop and ask if it needs more than about 15 GETs. Gate D reads the
    faulty-sale-worker and inventory-check log groups, which carry unredacted customer data: extract
    named fields only, and do not use cut -c, head -c or any width-based truncation as redaction.

    The deliverable is a revised question list for Kian with every item tagged MEASURED, INFERRED or
    UNKNOWN as it stands after the gates, plus the result file. Any new question goes into
    ../../BUSY-1065-OPEN-QUESTIONS.md with the next Q number, which is Q35.

Needs: nothing. No writes anywhere.

Interrupt JJ if Gate A shows R5's own arithmetic was wrong, if Gate B needs more than about 15 Cin7
GETs, or if Gate E finds a genuinely cheap window. The watermark write that would follow Gate E is
JJ's call, not the session's.

## R10, reachability

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then
    results/R3-update-semantics-no-cin7-write.md and results/R8-wholesale-exclusion.md, then run slice
    R10 (slices/R10-reachability.md). Do not read the other slices. Write results/R10-reachability.md
    and update STATE.md before you finish.

Needs: nothing. Gate A and Gate C are read only. Gate B runs up to four cycles, each bounded to about
six minutes of Cin7 traffic by setting the watermark one minute back, so one or two orders each.

Interrupt JJ if Gate B finds a working upper bound, or if Gate A finds the deployed artifact is
downloadable.

## R9 rev 2, the corrected watcher

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then
    results/R9-fixture-watcher.md, then run slice R9 rev 2 (slices/R9-fixture-watcher-rev2.md). Do not
    read the other slices. Write results/R9-fixture-watcher-rev2.md and update STATE.md before you
    finish.

Needs: nothing. Read only, GET only. Extends the existing `scripts/watch-for-fixtures.sh` rather than
replacing it.

## R9, fixture watcher

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then run
    slice R9 (slices/R9-fixture-watcher.md). Do not read the other slices. Write
    results/R9-fixture-watcher.md and update STATE.md before you finish.

Needs: nothing. Read only, GET only, no AWS writes, no poll.

Builds `scripts/watch-for-fixtures.sh`, five checks, then runs it once. Checks 1 and 2 are the
valuable ones: an order we already sent whose Cin7 `modifiedDate` has moved, or that has since been
cancelled. Either one unparks TC4, the reconciliation shapes, the version guard's second half and R2.

Read the existing scripts before writing. Most of the pieces exist.

## R8, wholesale exclusion

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then
    results/R5-eligibility-gate.md in full, then run slice R8 (slices/R8-wholesale-exclusion.md). Do
    not read the other slices. Write results/R8-wholesale-exclusion.md and update STATE.md before you
    finish.

Needs: a wholesale order at `New` or `Processing` in Cin7 right now, plus an ECOM control at the same
stage. Gate A stops the slice if none exists, and a picked-stage order is not a substitute, it
reproduces the confound.

Interrupt JJ mid-session if a wholesale order at an eligible stage vanishes with zero counter and zero
log line. That is silent data loss against a live acceptance criterion.

## R3, update semantics without a Cin7 write

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then
    results/R4-create-path-regression.md, then run slice R3
    (slices/R3-update-semantics-no-cin7-write.md). Do not read the other slices. Write
    results/R3-update-semantics-no-cin7-write.md and update STATE.md before you finish.

Needs: R4's four sent orders, `261842`, `261843`, `261844`, `WOR19169A`. Already in hand. No Cin7
write, no schedule change, watermark restored at teardown.

Proves TC3, TC21 and TC21b against the 1160 build, which is three of the four rows this whole re-test
was called for. TC21b's expected result is that the guard is **named**, so an unnamed suppression is a
FAIL, not a PASS. It was recorded wrongly once already.

Watch for R5's silent-drop shape reproducing on ECOM. If all four vanish with every counter at zero,
stop and tell JJ, that is bigger than TC21b.

## R2, lifecycle-gated consumers

    We are doing QA on the BUSY-1158 and BUSY-1159 re-test. Read CLAUDE.md, then STATE.md, then
    results/R0-build-identification.md, then run slice R2 (slices/R2-lifecycle-gated-consumers.md). Do
    not read the other slices. Write results/R2-lifecycle-gated-consumers.md and update STATE.md
    before you finish.

Needs: a CTC shipment that has moved off `OPEN`. Check first with
`../../BUSY-1158/scripts/list-ctc-shipment-states.sh`, which is read only and cheap. If all 70 are still
`OPEN`, the slice stops there and TC4e stays blocked.

The slice no longer depends on R3 producing the state change, since R3 cannot. Any route off `OPEN`
will do.

## Parked

`slices/_parked-cin7-revision-cases.md`. TC4, the line reconciliation shapes, the address-update
payload assertion, the version guard's discriminating half and the cancellation path. Not blocked on
a person, waiting on a shape that has to occur naturally. R9 checks 1 and 2 are what unpark them.

## R6 and R7, not IDE sessions

**R6**, manual SCALE UI reads, no AWS. TC1a mapping on R4's four orders. `261842`'s `ShipmentId` is
`18145142-944e-54db-9b3a-2bcc6a8e7777`; the other three read off the `shipmentId` field on the
shipment header row in `staging-shipments`, which R4 found, rather than searching on `cin7Id`. Order
Planning > Planned Shipment Insights, not Shipping Insights. Also TC18's SCALE half and TC10's
`UserDef3` read.

**R7**, doc sync, a Cowork session. Sync both QA docs and STATE against the results, run
`qa-doc-cleanup` on each, push to Confluence pages 1929642002 and 1929805827.
