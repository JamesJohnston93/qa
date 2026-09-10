# BUSY-1159 test plan state

**Last updated after:** slice 11. Eleven slices in the plan now have a result; slice 10's write half
stays open, `kian-dev`-only.

| Slice | Status | Result file |
|-------|--------|-------------|
| 01 environment gate | PASS | results/01-environment-gate.md |
| 02 create end to end | PASS | results/02-create-end-to-end.md |
| 03 post create observation | PASS (TC13 FAIL, expected, low severity today) | results/03-post-create-observation.md |
| 04 eligibility and skips | TC5 PASS, TC14 BLOCKED (no picked-stage ECOM order in population) | results/04-eligibility-and-skips.md |
| 05 order shape cases | PASS (automated halves), manual SCALE reads handed off, not blocked | results/05-order-shape-cases.md |
| 06 routing and isolation | PASS, TC16 surprised us (see below) | results/06-routing-and-isolation.md |
| 07 failure handling | PASS, both cases answered from already-found conditions | results/07-failure-handling.md |
| 09 echo guard and replay | TC21 PASS, TC21b answered, blast radius wider than assumed, see below | results/09-echo-guard-and-replay.md |
| 08 resilience sizing | TC17 no failure found at any suggested step, TC19 BLOCKED as expected, see below | results/08-resilience-sizing.md |
| 10 PutEvents partial failure | Gate A PASS, Gate B clean match, Gate C and the write half NOT RUN (`kian-dev`-only, skipped this session by instruction), TC22 stays NOT RUN, see below | results/10-putevents-partial-failure.md |
| 11 picked stage eligibility | TC14 stays BLOCKED (ECOM half), Q31 now CONFIRMED by a controlled single-cycle measurement, Part 3 (Q30) found nothing to learn, see below | results/11-picked-stage-eligibility.md |

## Open items

* Slice 01 PASS. Both prerequisites Kian held are resolved: `staging/orders/cin7` is populated (68 chars) and the watermark already holds a real timestamp, not `UNSET`. Q7 and Q8's access half are no longer blocking.
* Access confirmed: AWS profile `staging`, SSO role AWSPowerUserAccess. SSO session needs a manual `aws sso login --profile staging` refresh when expired (a browser device-code flow, needs a human to approve).
* Pre-existing, recorded before any test traffic: 3 messages already dead-lettered on `staging-shipping-manhattan-sender-dlq.fifo`, and the poller schedule was already ENABLED. Neither was caused by this session. See `results/01-environment-gate.md`.
* A live hard-error found condition exists right now: Cin7 SO `261111-SplitShipment-HARBOUR-TOWN`, reference over the 25-char ShipmentId limit. Slice 07 (TC9, TC15) can use it directly instead of manufacturing a case. See `fixtures.md`.
* Gate D log history (14 days, 538 cycles) shows no `Fully Picked`/`Partially Picked` skips, only `Fraud Warning` (6 times). Supporting, not conclusive, evidence for Q1 ahead of TC14 in slice 04.
* Slice 02 PASS. TC1, TC1b, TC2, TC8 all PASS on order `261115`. Reference, `modifiedDate`, `branchId`, `projectName` and `wmsSentAt` written to `fixtures.md` for slices 03 and 06.
* Capture job (mandatory fields/CommentType/XSD ordering) is BLOCKED, not just for this order but for any order: the sender never logs outbound XML, only the SCALE response. Fully deferred to TC1a manual SCALE UI read. The Q14 "first send" premise was also found false and corrected in the open questions register, real traffic had already been flowing before slice 01 started.
* Item master in SCALE staging is confirmed incomplete, answering Q8's second half: at least 4 SKUs across 4 orders (`261073`, `261089`, `261104`/`TH25-318B-28`, `WOR19270`/`WPR25-104A-10`) are stuck in an 8.3-hour SQS retry loop (`maxReceiveCount 20` x `VisibilityTimeout 1500s`) before landing on the DLQ. Slice 07 (TC9) will very likely find one already there rather than needing to manufacture a rejection.
* Reusable scripts now exist for waiting on a poller cycle and capturing its evidence: `scripts/wait-for-so-cycle.sh`, `scripts/capture-tc1-evidence.sh`, `scripts/check-latency.sh`. None reviewed yet. See `SCRIPTS.md`.
* Slice 03 PASS overall. TC3 and TC4 both PASS, TC4 landed a strong result (Cin7's own `modifiedDate` genuinely changed between sightings, shipment still untouched). TC12 PASS across all 7 consumers, including Segment, but only after fixing a false-FAIL bug in `check-ctc-consumer-guards.sh` (see TOOL-NOTES.md). TC13 FAILED as anticipated: `lastEmittedPayloadHash` is confirmed absent on create. Q4 updated in the open questions register.
* Two root-level tools fixed in place this slice: `cin7-watermark.sh` (cadence message) and `check-ctc-consumer-guards.sh` (real defect: under-scanned busy log groups, false FAIL on both RAN-kind rows). Any consumer-guard result from before this fix should not be trusted. This is the first use of that script in this plan, so nothing earlier needs re-running.
* Slice 04 PASS on TC5 (checked POS, wholesale and dispatched orders directly, all zero rows, cross-referenced against real skip counters in log history, no new watermark reset needed). TC14 BLOCKED: a full 225-order live ECOM sample and 14 days of poller history both show zero orders in `Fully Picked`/`Partially Picked`, so the suspected defect could not be confirmed OR ruled out this pass. Revisit opportunistically, not as a dedicated re-run, if a picked-stage ECOM order turns up later in the plan.
* Q22 (delivery country spread) stays open: confirmed `survey-cin7-orders.sh` does not expose country at all, would need a small new script to answer cheaply. Not built, out of this slice's scope.
* Slice 05 PASS on every automated check. `WOR19261` covers both TC6 (repeated option, 2 per-unit rows, no quantity field) and TC10 (packingBrand WORSHIP, packingBrandMisses:0) in one order, already sent successfully. `261106` covers TC18 (name truncated 29 to 25 chars in the sender warning, shipment still accepted, full value preserved on the ADDRESS row's firstName/lastName). All three manual SCALE UI reads handed to the manual list, none blocked by a rejection. Do not reuse `WOR19270` for a Worship manual read, it is the known-rejected one from slice 02.
* New script `scripts/address-field-lengths.sh`: prints ADDRESS row field lengths only, never values, for redaction-safe truncation/shape checks going forward.
* Slice 06 PASS on TC7 and TC11: no CTC stamp leaked onto a real US order, no UNI reference reached the CTC sender, DLQ/queue depths unchanged from slice 01's baseline. TC7's shipment-side comparison is incomplete: the 5 real US orders found are all NEWSTORE (in-store, already-fulfilled) and never reach the shipments table at all, a channel characteristic not a defect. A genuine warehouse-fulfilled `us`/`ps` order would be needed to complete that comparison, not chased this session.
* TC16 surprise: read real MessageGroupId values off 3 live DLQ messages, all distinct and order-specific, none `undefined`. This contradicts the slice's own expectation (and Q3's assumption) that BUSY-1258's fallback defect would still be live on this flow. Corrected in the open questions register. Worth telling whoever picks up BUSY-1258.
* Found conditions in the DLQ have grown since slice 02: now `261070`, `261073`, `261089` (3, stage-5 DLQ count unchanged at 3, so likely `261104` has not yet reached DLQ or one of the original three cycled off). Good pool for slice 07's TC9.
* Slice 07 PASS on both TC9 and TC15, entirely from evidence already captured in slices 01/02/06. TC9: `261073`'s shipment was created but never sent, `wmsSentAt` absent, DLQ mechanics confirmed (`ApproximateReceiveCount 21` matches `maxReceiveCount 20`). TC15: the same cycle that hard-errored on the split-shipment reference (slice 01) also created and sent 3 other valid orders (`261110`, `261111`, `261113`), watermark advanced once past all 4. Neither case needed a fresh watermark reset or wait.
* Only slice 08 remains (resilience sizing, TC17/TC19, runs last per the plan, burns API budget and can leave the feed mid-backfill).
* Slice 09 PASS on TC21, TC21b answered. `261119` (fresh, sent about an hour earlier) replayed by
  watermark reset plus one manual invoke: no second shipment, no second send, no new TRANSACTION row.
  TC21b's answer is the third of the slice's three named options: the order never reached the emit
  step at all, no skip counter moved either. No echo skip counter exists anywhere in the poller's
  output, confirmed against the full counter list seen across all slices so far. `lastEmittedPayloadHash`
  confirmed still absent, TC13's finding stands unchanged.
* Slice 09 deviation, flagged to JJ mid slice rather than decided alone: the manual invoke's window
  runs to "now", so resetting the watermark back to replay one order also caught up the entire
  backlog built up while the schedule was off for about an hour. 5 real orders created and sent as a
  side effect (`261123`, `261122`, `261124`, `261125`, `261120`), not part of any test case. No harm,
  Stage 5 DLQ unchanged at 3. JJ's call: leave the watermark at its natural post-invoke value
  (`2026-08-28T01:35:45.769Z`) rather than rewind to the recorded restore point
  (`2026-08-28T00:36:50.476Z`), since rewinding would only burn a second round of Cin7 calls
  re-creating the same 5 orders for no new information. **Lesson for any future manual invoke after
  the schedule has been off a while: expect a backlog catch-up, not a narrow single-order replay.**
* New script this slice: `scripts/list-transaction-rows.sh`, not reviewed yet. Lists TRANSACTION row
  SKs and idempotencyId for one order, redaction-safe. `inspect-ctc-order.sh` only gives a row count,
  not enough to confirm a specific idempotencyId did or didn't recur.
* Summary for whoever resumes: slices 01-07 and 09 are all done and documented, results in `results/`.
  7 of 8 run so far fully PASS (03 has an expected TC13 FAIL, 04 has a BLOCKED TC14, neither a
  surprise). Six open questions closed in the earlier session (Q4, Q7, Q8, Q14's premise, Q3's
  premise, plus 11 pre-existing). Two real tool bugs found and fixed earlier (`cin7-watermark.sh`,
  `check-ctc-consumer-guards.sh`). Six reusable scripts written across the two sessions, none
  reviewed yet, see `SCRIPTS.md`. Manual SCALE UI reads for TC1a, TC6, TC10, TC18 are still
  outstanding and not blocked by anything found so far.

* Slice 08 done. TC17: no failure at 6 hours, 24 hours or 3 days (28.7s/91.85s/136.6s, well under
  the 5 minute timeout). Ceiling not reached within the suggested steps, not pushed wider; measured
  rate (~1.5-1.7s per Cin7 request) puts an INFERRED ceiling around 190-200 requests in one cycle,
  roughly 6-7 days of backlog at current volume. TC19 BLOCKED as expected: `oversized:0` across all
  three cycles, 718 orders at the widest, no such order in the population.
* Slice 08 found a new hard-error type, distinct from the ShipmentId-length one: unrecognised Cin7
  `taxStatus "Exempt"` on 3 real orders (`WOR19267`, `261103`, `261105`), tripped the poller alert
  alarm. Logged as Q26 for Kian, not treated as a defect (refuse-and-alert is the safe default).
* Slice 08's TC17 backfill also gave TC14 real `Fully Picked`/`Partially Picked` orders for the
  first time in this plan. Checked all 32 directly by company name rather than trusting the
  aggregate: every one is wholesale, zero ECOM. TC14 stays BLOCKED, but on much stronger evidence,
  and this narrows Q1's "probable conformance defect" reading, see the open questions register.
* Slice 08 also confirmed a tool-reading trap, not a script defect: `invoke-so-poller.sh`'s
  underlying `aws lambda invoke` can outlast the CLI's own patience on a wide window and report
  `TooManyRequestsException` while the real invocation is still running and completes normally
  minutes later. Do not retry on that error for a wide window, check CloudWatch for the `REPORT`
  line first. See `TOOL-NOTES.md`.
* New script this slice: `scripts/find-picked-stage-orders.sh`, not reviewed yet. One Cin7 GET,
  prints company name per Fully-Picked/Partially-Picked order so a wholesale account is obvious at
  a glance. Saved because TC14 is explicitly opportunistic across sessions, likely to run again.

* Slice 10 done, on `staging` only, per this session's standing instruction to skip anything needing
  `kian-dev`. Gate A PASS: every `Pushed {"Entries":[...]}` line in the poller's full retained
  history (70 lines, its entire life to date) carries exactly one entry, cross-checked against the
  sum of `created` across all 575 cycle-complete lines (also 70). Gate B clean match, no shortfall:
  identified the buffer populator by reading the EventBridge wiring directly
  (`staging-orders-v2-eda-queue-populator`, not the `*-buffer-populator` reporting pair named
  elsewhere in this plan, which CTC records are guarded away from on purpose), then matched all 70
  pushed `idempotencyId`s against the populator's `Received event` lines from the same poller
  source: 70/70, zero shortfall, zero extra. Gate C and the write half NOT RUN: both are
  `kian-dev`-only per the slice text, out of scope for a staging-only session. TC22 stays NOT RUN in
  `QA-DOC.md`, now with two free gates in evidence rather than none. Full detail, including why the
  CloudWatch-metric approach used in the separate `investigations/kian-questions-2026-08-31` session
  does not substitute for this, in `results/10-putevents-partial-failure.md`.
* New script this slice: `scripts/putevents-vs-populator.sh`, not reviewed yet. Diffs the poller's
  pushed `idempotencyId`s against the populator's received ones for a given window. Re-run twice
  during the slice with different windows, both clean; this is the direct evidence behind Gate B's
  verdict, not just a one-off read.

## Cleanup 2026-08-30

* **TC12 handed to BUSY-1158.** The consumer guard sweep tests BUSY-1158's AC5, AC6 and AC7 and had
  no AC in this doc. Its row is out of the QA doc and replaced by an out of scope bullet naming
  BUSY-1158. `results/03-post-create-observation.md` is unchanged, it is the record of what this plan
  actually ran, and the BUSY-1158 doc carries the evidence forward with the source case named.
* **TC13 stays here, now labelled AC6.** It was the other orphan, but removing it would break TC21b,
  the replay suppression drift row and the sign-off, all of which rest on the hash never being
  written. Its declaration half is BUSY-1158's TC1b.
* **P10 moved to BUSY-1158** as its TC3b and TC7. The warehouse fulfilled Universal Store order is
  still needed, just not from this plan.
* `inspect-ctc-order.sh`'s row counting defect from slice 02 finally reached `TOOL-NOTES.md`.
* Sign-off, the TC14 blocker, two PASS notes and one drift cell trimmed. 158 words out, nothing
  removed but repetition.

## Dev answers and the re-test, 2026-08-31

Kian answered Q25 verbally: no batching, one order per `PutEvents` call, and the call throws on
failure so the watermark holds and the poll retries next cycle. **Do not raise it with him again.**

What is left is narrower and is now **TC22** in the QA doc: a rejected entry comes back as HTTP 200
with `FailedEntryCount` rather than throwing, so the case proves the watermark holds on that shape
rather than on an SDK exception. The bus-name config change in the project doc `Plan B` produces
exactly that response. Run it on `kian-dev`, not staging. **It is the first case in this plan that
writes anything**, so it needs its own slice with a snapshot and revert, and the warm-container trap
applies: confirm a cold start in the invocation being measured or the test proves nothing.

`taxStatus` is out of scope here now. Kian is checking the Cin7 value list and wrapping the fix into
BUSY-1160, so the coverage case belongs to that ticket.

Runnable right now, nothing blocked: the manual SCALE UI reads.

## Next session, start here

Scope is BUSY-1159 only. The QA doc is the artefact UAT reads, so anything found here lands there.

**All eleven slices in the plan as written now have a result.** Slice 10's write half is the one piece
still open, and it needs `kian-dev`, not staging. Remaining work:

1. Manual SCALE UI reads, none blocked: TC1a, and the SCALE half of TC6, TC10 and TC18.
2. Get a second person to review the scripts in `scripts/` (none reviewed yet across either
   session, see `SCRIPTS.md`) and the earlier `cin7-watermark.sh` / `check-ctc-consumer-guards.sh`
   fixes in `TOOL-NOTES.md`.
3. Take slice 11's Q31 finding to Kian: the deployed poller measurably skips `Fully Picked` on stage,
   contradicting his 2026-09-01 corrected statement. TC14's ECOM half stays opportunistic, no
   dedicated run, if a genuinely ECOM order ever turns up at `Fully Picked` or `Partially Picked`
   (`scripts/find-picked-stage-orders.sh` finds the candidates, still needs a contact-group check on
   any hit). Q26 (taxStatus `Exempt`) needs Kian, no QA action pending.
4. P9, P10 in `PROPOSALS.md` remain proposed, not built. P12-P14 remain deferred, not running
   unless JJ says otherwise.
5. Watermark restored to `2026-08-28T01:35:45.769Z` (MEASURED) after slice 11's cycle, schedule
   DISABLED. Re-enable only if a future session needs live polling again.
6. TC22's write half: Gate C (JJ agrees a short coordination window with Kian on `kian-dev`) plus
   the forced bus-name test that follows it. Cannot run from a staging-only session. Gates A and B
   are done and clean, see slice 10 above; nothing there changes what is left to run.
7. BUSY-1160 slice 01 Gate A (cancellation path deployment) is still NOT RUN. Q30's live case needs
   an order that reaches a picked stage after being sent, which has not happened yet; revisit
   opportunistically alongside TC14, not as a dedicated run.

Not running next session unless JJ says otherwise: P12, P13 and P14 in `PROPOSALS.md`, all deferred
once at the 2026-08-28 cleanup.

Manual work that needs a human in the SCALE UI, none of it blocked: TC1a, and the SCALE half of TC6,
TC10 and TC18.

Still true from the cleanup audit: no script in `scripts/` has been reviewed by a second person, so
every verdict resting on one proves the script ran, not that the system behaved. TC1, TC1b, TC3, TC4
and TC18 all sit on unreviewed scripts.

## Notes for the next session

**Superseded, kept for history only.** Everything below this line was written at plan creation, before any slice had run. Slices 01-07 are now done; where a note below turned out wrong, the correction is in the Open items above and in the open questions register, not by editing history here.

* Q7 and Q8 are no longer blocking, both answered in slice 01 (access) and slices 01/02/06/07 (secrets and item master). Q1 got supporting evidence in slice 01 Gate D and stayed unconfirmed-either-way through slice 04's TC14 (BLOCKED, no picked-stage order in the population). TC13 FAILED as this note anticipated (`lastEmittedPayloadHash` absent). **TC16 did NOT fail as this note predicted**, it PASSED, a genuine surprise, see Open items and the Q3 correction in the register. Do not trust the "expect a fail" framing for TC16 if this plan or a similar one is ever reused elsewhere.

**Still true, standing facts about the tools:**

* Scripts are saved, never run inline. `SCRIPTS.md` indexes this ticket's, `../../tools/SCRIPTS-INDEX.md` indexes the reusable ones. Read both before writing a new one. The rule and the required header are in `CLAUDE.md`.
* `cin7-watermark.sh` defaults to `--poller item`. Sales order work needs `--poller so` on every call. Getting this wrong rewinds the item master feed.
* `tail-logs.sh` only knows the item master lambdas. It cannot tail the sales order poller or the shipment sender. Use `aws logs` directly, or the new `scripts/wait-for-so-cycle.sh` / `scripts/capture-tc1-evidence.sh`.
* `clean-ctc-order.sh` refuses any stage but `kian-dev`, so the create path can be tested once per order in staging. Choose test orders deliberately. All orders used this session are recorded in `fixtures.md`, do not reuse them for a fresh create test.
* AWS SSO session for the `staging` profile expires between sessions. Run `aws sso login --profile staging` (device-code flow, needs a human to approve in a browser) if any call errors with an expired-session message.
* The `staging` environment is not a quiet sandbox: the SO poller schedule runs continuously against real Cin7/NEWSTORE traffic whenever enabled, so most recently-modified orders will already be created by the time you look at them. Check `inspect-ctc-order.sh` before assuming a candidate order needs polling, it may already be live.

## Dev answers, 2026-09-01, and what they changed

Kian answered two things directly. Neither needed a new test run; both were already measured.

**Picked stages are never sent to Manhattan.** Only fresh orders with no item fulfilled go. This is
already the deployed behaviour, MEASURED in slice 08: the 3 day window returned
`skippedStages {"Fully Picked":29,"Partially Picked":3,"Fraud Warning":1}`, and all 32 were pulled
from Cin7 individually rather than trusting the aggregate.

What that changes:

* **TC14's expected result was inverted and is now corrected.** It read "order is treated as
  eligible", following the LLD. It now reads "skipped and counted in `skippedStages`, never sent".
* **TC14 moves from BLOCKED to PASS.** It never needed the ECOM fixture it was waiting on: the
  counter is stage-keyed, not type-keyed, which slice 04 established, so the gate does not depend on
  order type. The ECOM-specific half stays INFERRED and the row says so.
* **The LLD is stale on the eligibility gate.** It lists Fully Picked and Partially Picked as
  eligible stages. The build deliberately skips both and dev confirms that is intended. Recorded as a
  Design drift row. JJ's call 2026-09-01: drift table only, not raised with Lachlan separately, so it
  surfaces when the doc is read. Every downstream ticket reads the LLD as source of truth, so this is
  worth re-raising if BUSY-1160 or 1161 trips over it.
* **Q1 is settled.** The "probable conformance defect" reading was wrong, and slice 08 had already
  reframed it: the dev handover's observation of `Fully Picked` among skipped stages was wholesale
  orders sharing the stage-keyed counter, not evidence of a defect.

**The PutEvents 200 shape can be deferred to the alerting and resilience task.** Agreed, and slice 10
already established the risk is latent rather than realised.

**One correction recorded with the deferral, and it matters.** Dev's reasoning is that a rejected
order errors downstream and lands in the DLQ. That holds where `PutEvents` throws, and where a
downstream lambda fails on an event that did reach the bus. It does not hold for the 200 shape: a
failed entry never reaches the bus, so no downstream lambda is invoked, nothing errors, and nothing
lands in any DLQ. The case is "does the watermark hold on a non-throwing 200", and written as "a
rejected order lands in the DLQ" it would pass trivially while testing something else. Captured as D1
in `../DEFERRED-TEST-CASES.md`.

TC22 stays NOT RUN with its write half deferred rather than scheduled. Slice 10's gates stand.

## TC22 deferred, 2026-09-01

JJ's decision, with dev's agreement: the write half of TC22 goes to BUSY-1162 with the rest of the
alerting and resilience work. It is **not** outstanding work on this ticket.

The order it happened in is the point. The free half ran first, on staging, needing nobody's
permission, and came back clean on the full population. That is what makes the deferral a judgement
rather than a shrug: the risk is latent, not realised, and the one thing still unproven needs a config
change on someone else's stage to demonstrate.

TC22 is marked DEFERRED in the QA doc, `DEFERRED` added to the status legend, and an out of scope
bullet points at BUSY-1162. Slice 10 carries a closed banner so nobody runs its write half from this
plan, and its KICKOFF entry no longer offers a prompt. The method stays in the slice file because
BUSY-1162 will need it.

**The manual SCALE UI reads are now the only outstanding work on BUSY-1159.**

## Correction, 2026-09-01, later the same day. Read this before trusting the entry above

The dev answers section above is **wrong on the picked stages** and is left in place as history rather
than edited, per this plan's convention.

Kian corrected himself: **the eligible stages are New, Processing, Partially Picked and Fully
Picked**, which is what the LLD says. His earlier statement came from working on a different code
path, the one that ignores the payload Manhattan sends back when it partially or fully picks an
order, since that would not change state in Manhattan.

So the LLD is right and the drift row claiming otherwise has been removed.

### What was wrong in QA's own reasoning, and it matters more than the dev mix-up

TC14 was moved to PASS on the strength of slice 08's `skippedStages {"Fully Picked":29,"Partially
Picked":3}`, read as proof that the poller deliberately skips those stages. **That was an
over-reading.** A stage-keyed counter showing a stage does not by itself say the stage was the reason
for the skip, and slice 08's own write-up offered the competing explanation: wholesale orders sharing
the counter.

The evidence that actually discriminates was already on file in slice 04 and was not consulted:
wholesale order `1038295Dec26`, stage `New`, skipped with `skippedCounted 1` and `skippedStages {}`
**empty**. A type-based skip does not populate `skippedStages`. The two counters are also
independently sized in the same cycle, 3 day window `skippedCounted` 286 against a `skippedStages`
total of 33.

Which means those 32 orders **were** skipped on stage, and the contradiction is with dev's corrected
answer rather than with the LLD. That is now **Q31**, and the most likely explanation is that the
build is in progress and staging predates the change: dev described the picked-stage work in the
present tense.

TC14 is back to **BLOCKED**, on both an absent ECOM fixture and Q31.

### The lesson worth keeping

Before reading a counter as evidence of a gate, establish which gate that counter attributes to. Slice
04 had already done that work and the answer went unused for a day. The general form: a counter keyed
on a dimension is not proof that the dimension caused the outcome.

## Slice 11, 2026-09-02: Q31 confirmed by a controlled measurement, not an aggregate

Target `975303Sep26` (Fully Picked, WHOLESALE, `modifiedDate 2026-09-02T02:09:09Z`) and control
`UQLD160-3773` (New, WHOLESALE, `modifiedDate 2026-09-02T03:28:54Z`) both fell inside one bounded
cycle (floor `2026-09-02T02:09:00.000Z`, `modifiedSince`/`modifiedBefore` window about 1h28m).
Confirmed by re-running `find-picked-stage-orders.sh` against the poller's own `modifiedSince` that
`975303Sep26` was the *only* picked-stage order in that exact window, so `skippedStages {'Fully
Picked': 1}` attributes to it unambiguously, not to guesswork across many orders.

The control (also wholesale, but stage `New`) reproduced slice 04's `1038295Dec26` finding under
today's code: type-skip, `skippedCounted` incremented, no stage key at all. That rules out the
alternative explanation Q31 needed ruled out (that `skippedStages` tags the stage of *any* skipped
order regardless of reason). With that ruled out, the target carrying a `Fully Picked` tag the control
does not share can only mean the stage check itself independently flagged `Fully Picked` as
ineligible.

**Q31 is answered: the deployed poller does skip `Fully Picked` on stage**, contradicting dev's
corrected 2026-09-01 statement that all four stages (`New`, `Processing`, `Partially Picked`, `Fully
Picked`) are eligible. `Partially Picked` was not itself represented in this cycle's narrower window,
so it stays INFERRED to share the same fate rather than independently re-measured. Every order this
finding rests on is still wholesale; no ECOM order has ever been observed at a picked stage across
five independent checks now (225-order sample, 14 day history, 32-order individual wholesale check,
this session's 18-order 6 hour scan, and this cycle's 1-order narrow window). **TC14's ECOM half stays
BLOCKED**, now on a confirmed mechanism rather than a suspected one: an ECOM order at `Fully Picked`
would almost certainly hit the same stage check, but that is INFERRED, not measured, until one exists.

Part 3 (Q30, read-only): all 12 previously-sent orders (`261115`, `WOR19261`, `261106`, `261119`,
`261110`, `261111`, `261113`, `261120`, `261122`, `261123`, `261124`, `261125`) are now `Dispatched`.
None reached a picked stage, so Q30's live case never arose this session. Confirmed each still carries
exactly one `CREATE_ORDER` transaction row and an intact `wmsSentAt`-set shipment header, no
cancel/DELETE, but this is "nothing to learn" per the slice's own framing, not a pass, since the
question needs an order that reaches a picked stage after being sent, which none has. Also: BUSY-1160
slice 01 Gate A (which would confirm the cancellation path is deployed) is NOT RUN, per its own
`STATE.md`, so deployment status stays unconfirmed regardless.

Watermark restored to the snapshotted `2026-08-28T01:35:45.769Z` after the cycle (a deliberate
departure from slice 09's "leave it forward" call: advancing it here would permanently skip the
multi-day backlog built up since the schedule was disabled, not just avoid re-sending a handful of
already-sent orders). Schedule confirmed still DISABLED.

No new scripts this slice; reused `find-picked-stage-orders.sh`, `find-cin7-sales-order.sh`,
`cin7-watermark.sh`, `invoke-so-poller.sh`, `inspect-ctc-order.sh` and `list-transaction-rows.sh` as
they stood. Full detail in `results/11-picked-stage-eligibility.md`.

## SCALE UI manual reads, 2026-09-02: all four run, one FAIL

Not a slice. Manual reads by JJ in the Manhattan SCALE staging UI, driven by `SCALE-UI-READS.md`.
Full detail in `results/12-scale-ui-manual-reads.md`. Both read sheets now carry a CLOSED banner.

**Navigation, and it cost an hour.** The reads are in **Order Planning > Planned Shipment Insights**,
not Shipping Insights. Shipping Insights lists post-wave shipments only: it returned 49 CTC-QDC
records, all in the DC team's own `CTC-<YYYYMMDD>-<code>` test-data format, and none of ours. That
briefly supported a wrong theory, that SCALE was accepting our documents without creating shipments.
A downloaded shipment rests at `In Pool` until the DC waves it, so an empty Shipping Insights result
for our references is the expected state, not a finding.

**TC1a FAIL, on one element out of thirteen.** `Carrier` is absent in SCALE while Cin7 holds
`logisticsCarrier: "Australia Post"` and our own order row holds `carrier: UNASSIGNED`. The order row
is written from the poller's payload, so the loss is at the poller's mapping step, before the sender.
Three measurements of different kinds, and the source field is populated, so it is not a source-data
gap. Warehouse visible: the DC's own shipments all carry a carrier. **Registered as Q33 at `TRIED 1`
and deliberately not raised with dev**, because two orders is not a population; attempt 2 is a
population-wide scan of the `carrier` attribute, prompt added to `KICKOFF.md`.

Everything else on `261115` matched LLD section 5: `ShipmentId` and `ErpOrder` both the bare
reference, `Company` `CTC`, `Warehouse` `CTC-QDC`, `OrderType` `ECOM`, `AllocateComplete` Y,
`ConsolidationAllowed` N, `Priority` 5, ship-to pair, line grain.

**TC1's SCALE half is now MEASURED.** The shipment exists, created by the `ilssrvseau` interface
account at `2026-08-27T23:49:16Z`, matching `wmsSentAt` to the second. It had been PASS on the sender
log alone.

**TC6 PASS, and the benign branch.** SCALE holds one line for `WOR19261`, Total Qty 2, against two
per-unit rows on our side. The sender aggregates. That also retires the line-identity worry for two
units of one option; D8 stays open on the wholesale per-size grain, which is the real worry case.

**TC10 PASS on both halves**, `WORSHIP` on `WOR19261` and `THRILLS` on `261115`. The brand map
resolves on both `projectName` spellings, so the whitespace-mismatch theory is dead and
`packingBrandMisses` reading zero is trustworthy.

**TC18 PASS on both halves**, `ShipTo` exactly 25 characters and `ShipToAddress` `Name` the full 29.

**Correction to slice 02.** Its capture-job section lists `261111-SplitShipment-HARBOUR-TOWN` among
the successful sends. A shipment exists with `ShipmentId` `261111` and no longer variant exists under
any search, so the order that sent was the plain parent. Slices 01 and 07 are right that the split
child hard-errored on the 25-character limit. Correction appended to `results/02-create-end-to-end.md`.

**Two cases turned out untestable on ECOM** and are deferred to a wholesale order under BUSY-1160:
the `ScheduledShipDate` source (Cin7 returns `createdDate` and `estimatedDeliveryDate` as an identical
value, D14) and `CustomerPO` (empty on Shopify ecom orders, and rendered nowhere in the UI, D15).

**Three elements are not observable in this UI at all:** `OrderDate`, `ErpOrderLineNum` and
`CustomerPO`. Element ordering and the mandatory field set likewise, since the UI renders parsed data.
No further UI read will add anything to this ticket.

No AWS, no scripts, no watermark movement. Schedule left DISABLED.

## Same day, 2026-09-02: the carrier finding is a decision, not a defect

Confirmed by JJ after the wrap-up above. `Carrier` is deliberately not sent for now, pending a final
decision, and a later task owns it. The working assumption is that carrier is chosen when warehouse
staff pick the order and mark it ready to ship, then flows back to us, so it is inbound rather than
outbound and belongs with the confirmation leg rather than with this ticket's send path.

**TC1a moves FAIL to PASS.** BUSY-1159 is now 20 PASS, 1 FAIL, 2 BLOCKED, 1 DEFERRED. The only
remaining FAIL is TC13, which is Lachlan's against the LLD.

**Q33 closed as `NOT TESTABLE, decision`** without its second attempt. The population scan is
withdrawn and its KICKOFF prompt removed, since whether the omission is systemic no longer decides
anything.

**The LLD is what is out of step**, not the build: its per-type matrix still sends `Carrier` from
`logisticsCarrier` on ECOM, WHOLESALE and RTV. Recorded as design drift on the QA doc and as a
correction for Lachlan rather than a question for Kian.

Deferred as D16. No receiving ticket named yet, which is the one loose end.

The measurements stand: Cin7 holds `logisticsCarrier: "Australia Post"`, the order row holds
`carrier: UNASSIGNED`, SCALE holds nothing. That is the baseline the later task changes from.

## Slice 13 written, 2026-09-02: TC13's premise is probably wrong

Not run. `slices/13-payload-hash-hunt.md`, KICKOFF prompt added.

TC13 is this ticket's only FAIL and it reads "`lastEmittedPayloadHash` written on create". It failed
twice, slices 03 and 09, both on direct attribute reads of `staging-orders-v2`. **But the payload hash
exists.** Slice 09 recorded `idempotencyId CREATE_ORDER#CTC#261119#2026-08-28T00:30:03Z#e24af605`, and
the epic defines idempotencyId as `<event>#<origin>#<modifiedDate>#<payloadHash>`. The trailing segment
is the hash, it was on file for five days, and nobody read it as one.

So "no hash is computed" was never the measured fact. The measured fact is that one named attribute is
absent from one table. Those are different findings with different owners.

**Both prior attempts were the same route**, attribute reads on the orders table for orders that had
only ever been created. Slice 13's four parts each close a different one:

* **TC13b**, is the trailing segment a fixed-width, content-derived, order-varying hash. Free, no
  fixture, and if it is not then TC13 stands exactly as written.
* **TC13c**, is the hash retrievable from anywhere durable. `staging-shipments` has never been checked
  for a hash attribute, and the orders-table TRANSACTION row's `orderInfo` payload was deliberately
  left unopened during slice 09 for redaction reasons. That payload is the most likely hiding place.
* **TC13d part 1**, create versus update. The echo guard only runs on a second sighting, and every row
  read so far belonged to an order that had only ever been created. `261115` is the fixture, since TC4
  measured its `modifiedDate` moving between sightings.
* **TC13d part 2**, the discriminator. Dynamoose `saveUnknown` is false, so an emitted attribute the
  schema does not declare is dropped on save with no error. If the emitted event carries the hash and
  the persisted row does not, this is a schema declaration gap, which is BUSY-1158 TC1b's territory and
  a one-line fix rather than a poller defect.

**Time box on part 4.** Its fallback route is the poller's `Pushed` log line, and CloudWatch retention
is 30 days against sends made 27 to 28 August, so it ages out around 26 September. After that it needs
a fresh order and the schedule re-enabled. Run part 4 first if the session is split.

TC13 held at FAIL until the slice runs. Three new cases added to the QA doc as NOT RUN, so the ticket
is 27 cases: 20 PASS, 1 FAIL, 2 BLOCKED, 1 DEFERRED, 3 NOT RUN. Recorded as P15 in `PROPOSALS.md`.

## Slice 13 run, 2026-09-02: TC13 rewritten, not sent to BUSY-1158

Read-only, all four parts, no watermark change, schedule confirmed still DISABLED. Full detail in
`results/13-payload-hash-hunt.md`.

**TC13b PASS on the weaker claim.** All 12 fixture references have exactly one TRANSACTION row each,
so no same-reference-same-modifiedDate pair exists to run the true stability test. Falling back to
the claim the slice itself allows for that case: the trailing segment is present on 12/12 rows, fixed
width (8 lowercase hex characters on all 12), and distinct across all 12 orders. "No hash is
computed" is dead.

**TC13c FAIL.** `staging-shipments` (never checked before) carries no attribute matching `/hash/i` on
any of its 5 row types for `261119`, and its own `idempotencyId` shape is different again, two
segments only (`SHIPMENT_ITEM_CREATE#<PK>`), no hash, no `modifiedDate`. The orders-table
TRANSACTION row's `orderInfo`/`itemChanges`/`paymentChanges`/`addressChanges` payload (deliberately
unopened in slice 09) has no hash key at any nesting level. The `idempotency_index` GSI exists and
works, but its HASH key is the full composite `idempotencyId` string, not the hash segment alone, so
it is not a hash-keyed lookup: querying it needs `event`+`origin`+`modifiedDate` already known, at
which point the hash adds nothing. The honest worst case the slice named is what was found.

**TC13d part 1 stays UNKNOWN, weak negative only.** `261115`'s current ORDER row attribute list is
byte-identical to slice 03's, still 1 TRANSACTION row, but it has had zero second sightings since
(all 12 fixture orders are `Dispatched`, per slice 11). Create-versus-update is genuinely untested,
not answered either way.

**TC13d part 2 is the decisive result.** Recovered `261119`'s exact emitted event from the poller's
own `Pushed` log line before it ages out. Its key set, at every nesting level, matches exactly what
Part 2 found stored on the TRANSACTION row and what Part 3 found on the ORDER row: no hash field
anywhere outside the `idempotencyId` string. **The poller never emits a standalone hash attribute at
all**, so Dynamoose `saveUnknown:false` is not dropping anything. This rules out the schema-gap
reading: TC13 does **not** move to BUSY-1158's TC1b as one of the two possible outcomes the slice
named. It stays here.

**Recommendation, not yet actioned:** rewrite TC13 to read "a payload hash is computed and embedded
in `idempotencyId`'s trailing segment; it is not persisted, indexed or otherwise retrievable as a
named attribute anywhere, by the current emit shape rather than a schema drop." For Lachlan against
the LLD: either the LLD's named attribute is a real requirement needing a poller code change, or the
echo guard is meant to re-parse `idempotencyId`'s suffix and the LLD's attribute name is wrong.
Ties into the QA doc's existing "Replay suppression mechanism" drift row and BUSY-1162's wider
echo-guard thread. QA doc and Q4 not yet updated with this slice's result, next step below.

New script: `scripts/hash-segment-check.sh`, not reviewed yet. Extends `list-transaction-rows.sh`
rather than re-querying DynamoDB directly.

**Next step, not done this session:** update `QA-DOC.md`'s TC13/TC13b/TC13c/TC13d rows and the
"Replay suppression mechanism" drift row with this slice's verdicts and the rewritten TC13 text, and
append this finding to Q4 in `../BUSY-1065-OPEN-QUESTIONS.md` rather than opening a new Q, since
Q4 already asks exactly this question and is marked Answered on the weaker "not written on create"
reading only.

## Slice 13 run, and TC13 withdrawn, 2026-09-02

`results/13-payload-hash-hunt.md`. Read-only, no watermark or schedule change, schedule still DISABLED.

**What the slice measured.** A payload hash is computed on every emit: 8 hex characters, lowercase,
present on 12 of 12 references, distinct across all 12, carried as the trailing segment of
`idempotencyId`. It is not retrievable as a named attribute anywhere, and two of those places had
never been checked before: no `/hash/i` attribute on any `staging-shipments` row, and none inside the
orders-table TRANSACTION row's stored `orderInfo` payload, which slice 09 deliberately left unopened.
`idempotency_index` is keyed on the whole composite string, so it cannot be queried by hash. And the
decisive part: the emitted event's key set matches the persisted rows' key set exactly, so
`saveUnknown: false` is dropping nothing. **Not a schema gap, not BUSY-1158 TC1b's territory.**
Create versus update stays genuinely UNKNOWN, no re-polled fixture exists.

**TC13 withdrawn rather than rewritten**, on JJ's call. It is in no acceptance criterion, QA proposed
it at plan creation, and the guard it feeds cannot be exercised on this ticket: the confirmation leg
is unbuilt, and the eligibility gate excludes `Dispatched` and, on the deployed build, `Fully Picked`,
before the payload is built. Moved to the confirmation epic as **D17**, reframed as the behaviour that
matters, no second send on a write-back that leaves the order eligible. TC13b, TC13c and TC13d folded
into it and removed from the doc; their measurements are D17's baseline.

**The severity language across the epic was wrong and is retracted.** "High the moment the confirmation
leg exists" was our adjective. A duplicate emit is an identical SAVE on the same `ShipmentId`: a no-op
pre-wave, DLQ noise post-wave. Corrected in Q4, in D17, and in BUSY-1160's QA doc, PLAN, KICKOFF and
STATE, where TC20's blocker said it could not pass until someone wrote the attribute.

**BUSY-1159 now has no FAIL.** 24 cases: 20 PASS, 2 BLOCKED, 2 DEFERRED, nothing outstanding. **The
one thing standing between this ticket and sign-off is TC14 and Q31**, the deployed poller skipping
`Fully Picked` against the LLD and against dev's stated intent, compounded by no ECOM order ever
having been observed at a picked stage.

**Two live items survive and neither is a test.** A decision for Lachlan on whether
`lastEmittedPayloadHash` is a real requirement or stale LLD text. And the unnamed suppression from
slice 09: 8 fetched, 5 created, no skip counter for the other 3. The leading explanation is a
create-only build whose present-order branch does nothing, which BUSY-1160 slice 01 Gate A settles.

## Evidence audit, 2026-09-02: every result file against the rows built from it

Six parallel readers, one per group of result files, comparing each file's measured facts against the
QA doc rows that cite it. Hunting one error class: the result file states its limit honestly and the
row drops the limit when it copies the verdict across.

**Calibration first.** Four of the readers' claims were checked against the files before anything was
changed, and two were wrong. TC7b's timing figures were reported as having no source; they come from
`investigations/kian-questions-2026-08-31/results/02-behavioural.md` line 79, which that reader could
not see. A second reported a PII log group as never carried anywhere; D12 covers it. Findings from a
fan-out are leads, not verdicts.

**Fixed, confirmed against the files:**

* **TC21b PASS to INCONCLUSIVE.** Its expected result is "the guard that suppressed it is named" and
  no guard was named. Two candidates eliminated, mechanism unidentified. This is the sharpest of the
  set: the case failed on its own terms and was recorded as a pass.
* **TC2** carried a flat PASS while slice 02 labels the no-reallocation half INFERRED from absence,
  with no reallocation log group searched. AC7 names reallocation directly. Hedge restored.
* **The item master blocker** said four option codes absent and gated go-live on it. Two are named,
  the other two are references whose missing code slice 02 never captured. Corrected to two confirmed.
* **TC6's line-identity conclusion** was stated as settled. `ErpOrderLineNum` is not readable in the
  SCALE UI, so the pair was never observed. Relabelled as inference. Same correction into D8.
* **D3** still carried "high severity the moment the confirmation leg exists" and the premise that no
  hash exists under any other name. Both now known false. D17's claim that the retraction had been
  applied in every prior doc was itself false, for the entry directly above it in the same file.

**Fixed, and all four came from this session's own work:**

* The carrier decision is relayed verbally by JJ with no ticket or message named, and that sentence is
  what flips TC1a and closes Q33. Attribution recorded as open.
* "Not readable in this UI" is an absence across the screens actually opened, four orders and three
  screens, not a property of the UI.
* "Nothing is being dropped by Dynamoose" was measured on one order. Scoped.
* The step 4 before step 5 ordering, which carries the whole argument for withdrawing TC13, is read
  from the LLD and has never been measured at runtime. Labelled as design-sourced everywhere it appears.

**BUSY-1159 is now 24 cases: 19 PASS, 1 INCONCLUSIVE, 2 BLOCKED, 2 DEFERRED.** The sign-off blocker is
unchanged: TC14 and Q31.

**The pattern, and it is narrow.** The result files are careful. Almost every finding sits at one seam,
the copy from result file to QA doc row, where a hedge gets dropped. Worth a habit rather than a
process: when a row is written from a result, the row carries the result's weakest qualifier, not its
headline.

Nine leads remain unverified and are listed in `AUDIT-OPEN-ITEMS.md`.

## Update, 2026-09-08: the current build re-tested, QA doc synced

Nothing new ran in this plan. The evidence below is from `../retests/RETEST-1158-1159/results/`, chiefly R11
(pre-Kian confirmation) and R13 (fresh data verification), and it has been synced into `QA-DOC.md`.

**Nine fresh ECOM orders** were created and sent through one live scheduled cycle on the current
build. TC1, TC1b, TC8, TC16 and TC11 all PASS on fresh data. TC1b is now measured cycle-complete to
`wmsSentAt`, 35.2 to 47.8 seconds across the nine; measured from the Cin7 `modifiedDate` instead it
reads as a false 24 minute breach, because orders dwell while the schedule is disabled.

**Status changes, all applied to the QA doc:**

* **TC13 DEFERRED to PASS.** `lastEmittedPayloadHash` is present on the stored order row, matching
  the emitted payload exactly, on create and unchanged by an echo. It was measured absent before this
  build. The withdrawal recorded as D17 no longer applies and that entry needs correcting.
* **TC14 BLOCKED to DEFERRED.** The LLD has both picked stages eligible because the confirmation leg
  writes them into Cin7 on first pick, and that leg does not exist, so no ECOM order can be at a
  picked stage. Not testable by QA, likely passes, handed to dev for a dev-environment test.
* **TC9 and TC15 PASS to UNTESTABLE.** No dead letter fixture exists, no rejection has occurred since
  the deploy, and one cannot be manufactured because Cin7 is read only for everyone. A fixture on the
  dev stack would not answer a staging question. Both handed to E2E. Their pre-deploy passes are
  recorded as such.
* **TC21 PASS** on a real second sighting: no duplicate rows, no second send. **TC21b stays
  INCONCLUSIVE.** Suppression works and the aggregate `echoSkipped` counter now fires, 2 against 2
  re-swept orders, but no log line names the guard, which is what the case asked for. That counter
  did not exist before the 2026-09-03 deploy, so the earlier "no echo-skip counter exists" reading is
  superseded.
* **TC6 stays PASS but is proven only on a pre-deploy fixture.** No fresh repeated-option-code order
  has appeared, so it is not proven under the current code.
* **TC10 stays PASS** on its fresh Worship order. No Worship order sat in the latest cycle's window,
  which is not a failure.

**Three open questions reached the doc as drift or gotchas, none of them ours to solve.** Nothing
holds a wholesale order anywhere: the LLD puts it in an `OUTBOUND_SHIPMENT` family that is not
deployed, BUSY-1160 has it riding the native records, BUSY-1161 scopes the outbound family to RTV
only (Q35). The poller's cycle counters have never balanced, worst case 718 fetched against 319
accounted for, and a fresh cycle read 56 fetched, 20 summed, 36 unaccounted, all traced to 43
confirmed wholesale orders at `Dispatched` that produced no counter and no log line, while 4 at
`Approved` were counted correctly (Q38). And the poller's own log line carries full customer name,
email and address in the clear, a fourth log group, already added to
`CTC-customer-data-in-cloudwatch.md`.

**Case count is now 24: 18 PASS, 1 INCONCLUSIVE, 2 UNTESTABLE, 1 BLOCKED, 2 DEFERRED.** No FAIL. No
QA work outstanding in this plan.

## Update, 2026-09-08 evening: sweep re-assessment after the BUSY-1160 session

**Nothing new was tested in this plan.** A BUSY-1160 session ran 01:24 to 06:01 and slices 15 and 16
were re-assessed against it. **No file in this folder was written after 02:52 by that session**, so
the plan was not tainted by direct writes. What moved was shared state and two facts the slices rest
on. Backups of both slices are kept as `.bak-20260908pm`.

**Case count unchanged: 24 cases, 18 PASS, 1 INCONCLUSIVE, 2 UNTESTABLE, 1 BLOCKED, 2 DEFERRED. No
FAIL.** No verdict moved. `QA-DOC.md` is untouched and stays at Confluence version 14.

**What changed under the plan**

* **R14 ran** at 03:13, `../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`. `orderType`
  has only ever held `ECOM` across full retained history; no outbound-family table exists across all
  137 in the account. MEASURED. **P16 and P17 are closed by measurement.** P18 is the only proposal
  still open on this ticket.
* **There are two hashes, not one.** `idempotencyId`'s trailing segment and `lastEmittedPayloadHash`
  hold different values, MEASURED on four real orders. Every note in this plan written before this
  entry reads as one hash serving both roles and is wrong. Slice 15 S3's prerequisite is corrected and
  P18's row carries the amendment. No case may assert a hash matching a computed expectation.
* **The sender DLQ baseline of 3 is about to move and it is our own doing.** Roughly 5 pre-fix
  synthetic messages are retrying in `staging-shipping-manhattan-sender.fifo` and should park
  overnight. TC11's no-growth control needs re-baselining with a real-against-synthetic split, or the
  next reader will read the growth as a UNI leak. Slice 16 S1 owns it and runs first. JJ's call: let
  them land, re-baseline, note it, purge nothing.
* **TC9's fixture may already exist.** `QASYN-02-TC11`'s post-fix add-line persisted with a valid
  numeric `lineItemId` (`9152082`) and a `QASYN-SKU-` code absent from the SCALE item master by
  construction, and its fate was never waited out. Slice 16 S2 is rewritten from a fresh poison
  message to a free read of that emit. A dedicated emit is now contingent (S4) and only if the read is
  ambiguous. **The harness has no option-code mutation**, so a dedicated emit would need a harness
  change or a deliberate reuse of `add-line`'s generated SKU.
* **Slice 15 S3's TC21b re-word is agreed by JJ.** The inconclusive-twice stop is satisfied and the
  stage may run.
* **The 1160 handler-side guard evidence does not transfer to TC21b.** That session characterised the
  idempotency index and version guard by injecting downstream of the poller. TC21b's suppression is
  poller-side: slice 09 measured the re-polled order was fetched but never reached the emit step.
  Different mechanisms at different hops. Both slices now say so explicitly.

**Standing trap, now recorded in `KICKOFF.md`.** BUSY-1160 has its own TC5 to TC19 meaning entirely
different things, and its `SYNTHETIC-REGISTER.md` labels rows with 1160 numbers. 1160's TC9 is an
address-only revision emitting no item lines, PASS. 1159's TC9 is a SCALE rejection parking on the
DLQ, UNTESTABLE. Two corrections on this epic already came from misreading which record did what.

**Doc correction still outstanding, free.** The 2026-09-08 START HERE says "Stage 5 sender DLQ empty".
`results/01`, `results/06`, `fixtures.md` and this file all say exactly 3, consistently. The START
HERE line is the suspect one. Slice 16 S1 settles it with a live read.

---

## 2026-09-09, LLD re-verification from a Cowork session. No AWS, no verdict moved by testing

**What this session was.** JJ asked for the unrun slices to be identified and then for the slices and
tests to be re-verified against the QA doc and the LLD, with **the LLD as source of truth**. That is
what happened. Nothing was tested, because this session could not reach AWS.

**Run state established:** slices **15 and 16 have no result files and have never run**. Everything
01 to 14 has results. Slice 12 has a result and no slice file; it is driven from `SCALE-UI-RUNSHEET.md`.

**Capability change, and it is the useful part of this session.** Two facts about the Cowork shell on
JJ's machine, both new:

* **There is no `aws` CLI on it.** So `inspect-lambda-code.sh`, `check-ctc-consumer-guards.sh` and
  every DynamoDB and CloudWatch read still need JJ's IDE session. The standing "Cowork cannot reach
  AWS" line is confirmed and now has a reason attached.
* **The monorepo is on the machine** at `~/Repos/monorepo` and Cowork can read it with a folder grant.
  **But that checkout is branch `UNI-1167-cc-reminder-master`, HEAD dated 2026-02-12, with no git
  remote configured**, so it cannot be fetched forward and it predates the CTC build entirely. No
  `cin7`, `orders-cin7`, `so-poller` or `ctc` path exists in it. It is good for the pre-CTC shape of
  existing UNI consumers, which is exactly what the §3 consumer-guard audit is a stance about, and it
  is worthless for anything the CTC build added. **Do not cite it as repo access.**

**Nine of ten slice stages were corrected before running.** Both slice files amended in place, backups
`.bak-20260909`. The four that matter:

1. **TC9's expected result contradicted LLD §6.** §6 and §11.5 put a `rejectedTransactions > 0` on an
   HTTP 200 on the **permanent**-failure path, where §6's permanent bucket is "DLQ + SNS alert" and
   only transient is where "SQS redrives each hop". TC9's old wording asked only that the message park,
   and its pre-deploy pass met it at **receive count 21**, which is the transient path. Slice 16 S3
   called 21 the measured pass. **Inverted.** This is BUSY-1160's **D5** from the other side; JJ's
   call, cite D5, do not open a second defect.
2. **TC19 was never an ECOM risk.** The 256 KB limit is named in §4 step 6 and §6, and §10.2 already
   carries the headroom, 83 size rows at about 7% of the cap. §6 says the breach is reachable only on
   "a large multi-size wholesale order". Slice 15 S1 lost three of four steps. Row moved BLOCKED to
   PASS with the routing half deferred to BUSY-1161.
3. **TC2's reallocation half was unsafe in the other direction, and slice 15 S2 ran.** See
   `results/15-non-pass-sweep-1.md`. Row split into TC2 (PASS, stamps) and **TC2b (INCONCLUSIVE)**.
   One DynamoDB read closes it and it is the only open item that could still change a verdict here.
4. **Slice 16 S2's manual-SCALE gate is gone.** The synthetic SKU's absence from the item master
   follows from §5's item-key contract. One stop-and-ask item removed.

**Three cases added from LLD clauses nothing covered:** TC6b (multi-size style, §11.5 and §5's
identity pair and §10.2's collapse risk), TC6c (zero-quantity sizes, §5 and §4 step 5 and §11.5),
TC16b (`MessageGroupId` on the Manhattan sender queue, §3's populator fallback and §10.2's risk).
TC16b matters because **TC16 tests the transaction hop, which §3 says was safe by construction**, and
not the native-domain-event hop the LLD actually flags.

**Six QA doc rows corrected, local file only. `QA-DOC.md` is NOT synced: Confluence is still at
version 14.** Backup `QA-DOC.md.bak-20260909`. AC1's casing (`ShipmentId`, not `ShipmentID`, per §5's
own erratum note), the XML element order drift row (the build followed the LLD's prescribed fallback,
so it is not drift), and the 5 minute lookback gotcha (downgraded from "correct behaviour" to a drift
row, because the LLD describes no lookback) alongside the four above.

**Dropped on JJ's instruction:** the Cin7 5,000/day budget question. Covered under BUSY-1162 if needed,
and already exercised on the item master.

**Still open with people:** unchanged. Lachlan holds the AC2/AC3 quantity limb, D5's retry nuance and
corrections C1 to C6. Nobody is waiting on Kian, though TC2b's outcome may produce a §11.3 correction
for him. **The two-hash question is JJ's to verify over coming sessions and is not to be raised with
anyone yet**, added as slice 15 S3 step 3.

## Slice 17, TC2b, reallocation. Run from JJ's IDE session, resolves the last open verdict item

Baseline (step 1) on `262208` returned 1 TRANSACTION row, `CREATE_ORDER`, confirming the read is
valid. All nine R13 references (`262208`, `262210`, `262211`, `262216`, `262217`, `262219`, `262221`,
`262222`, `262223`) checked: each has exactly one TRANSACTION row, all `CREATE_ORDER`, none
`REALLOCATION#`.

Artefact read against the deployed `staging-shipping-v2-create-shipment-items` (resolved via
`aws lambda list-functions`, not guessed) found a real origin-based guard: `isCTCOriginKey` checks
`origin.startsWith("CTC#")`, and the handler's branch order routes an `isCTC` order to
`attachItemsToOpenShipment` or `createCtcShipment`, never reaching the trailing `else` that emits
`REALLOCATION`. This is the deployed 2026-09-09 build, distinct from the Feb 2026 pre-CTC checkout
slice 15 S2 read from source.

**Proposed verdict: TC2b PASS, MEASURED.** Not yet applied to `QA-DOC.md` per the slice's
instruction, staged in `results/17-tc2b-reallocation.md`. **Proposed correction for Kian:** LLD
§11.3's "assert `create-shipment-items` is unmodified" is the wrong clause, the file has clearly been
modified to add the CTC-specific branches, and that modification is what makes §11.3's
"reallocation is not triggered" half true. Not written to the drift table yet, JJ's call on which
ticket's table it belongs in.

No "Stop and ask JJ" trigger fired. No new script written, no `SCRIPTS.md` change.

**This was the last open item that could still change TC2/TC2b's verdict on BUSY-1159.** Everything
else remaining on this ticket is deferred, handed to E2E, or a cheap addition, per the slice's own
framing.

## Slice 18, the three unrun cases (TC6b, TC6c, TC16b). Run from JJ's IDE session, S1 through S4

**TC6b: UNTESTABLE-for-want-of-a-fixture.** Full population scan, both `staging-orders-v2` and
`staging-shipments`, 100 ECOM CTC orders, 233/226 (order, lineItemId) groups: zero multi-size styles
found anywhere, largest distinct-sku count seen is 1. Handed to E2E, same footing as TC9's precedent.
New script `scripts/survey-multisize-styles.sh`, not reviewed.

**TC6c: still PROPOSED, but with much stronger evidence than before this session.** The
`skippedZeroQty` counter is confirmed present, confirmed non-zero twice already on record
(`results/07-failure-handling.md`: 3; `results/11-picked-stage-eligibility.md`: 1), and its exact
mechanism read directly from the deployed poller's source (`expandLineItems`): a `qty === 0` size
produces no row, is counted, is not alerted, matching LLD §5 verbatim. Reconciliation itself needs
Cin7 data this session cannot call. **Named a sharp 3-order query for JJ** (`261110`, `261111`,
`261113`, the cycle where `skippedZeroQty:3` fired, stored counts 3/4/2 respectively), replacing the
100-reference blanket sweep the slice's own S1 would otherwise have proposed. Along the way, found 2
real ECOM orders (`261644`, `261646`) with order-side items but zero shipment-side items, flagged as
a separate, unrelated observation, not conflated with TC6c's shape.

**TC16b: PASS, MEASURED.** Populator resolved by evidence (`QUEUE_NAME` env var match, not naming
symmetry): `staging-shipping-manhattan-manhattan-eda-queue-populator`. Its deployed code's fallback no
longer collapses to the literal `"undefined"`; it now falls back to `${detailType}_${event.detail.id}`,
distinct per event. All nine R13 references' `SHIPMENT_CREATED` events carry `message_group_id` equal
to their own order PK. Queue never received from, per the slice's hard rule. New script
`scripts/check-manhattan-populator-message-group.sh`, not reviewed.

**Sign-off not yet fully re-derivable**: TC6c's reconciliation is the one thing left, and it is Cin7's
side, JJ's to run. Everything else resolvable without Cin7 access or a queue receive is done.
Results: `results/18-unrun-cases.md`, one section per stage (S1-S4).

## Slice 19 S1, TC6d, the empty `sizes[]` fallback. Register Q43

**Q43: `TRIED 2, negative`.** Swept the poller's full retained CloudWatch history (584
`Cin7SOPollerCycleComplete` lines, log group retention confirmed unlimited, correcting the slice's own
"30 days" framing). `skippedNoSizes` only exists on 8 of those cycles (added by the 2026-09-04 deploy,
spot-checked against a pre-deploy cycle to confirm genuine absence, not a parse miss), spanning
2026-09-04T01:33 to 2026-09-07T06:32, the last cycle before the schedule went quiet (confirmed no
cycle has run since via a direct tail read). **All 8 are zero.** Small-sample caveat stated plainly:
this is 3 days of actual activity, not weeks. Disposition proposed: drift row plus correction, not a
defect, pending S2 (JJ's Cin7 occurrence query, not run this session). Q43 updated in
`../BUSY-1065-OPEN-QUESTIONS.md`. New script `scripts/check-skipped-no-sizes.sh`, not reviewed.
Results: `results/19-empty-sizes-fallback.md`.

## 2026-09-10 wrap-up. TC2b applied, two new corrections, Confluence synced

**Correction to this session's own earlier reasoning.** The 2026-09-09 entry above framed the
`create-shipment-items` question as "one of LLD §11.3's two clauses is wrong". That was right but too
narrow. The artefact read shows **three** clauses say the native path is untouched (§3 "no change is
required to any of them", §9.3 "no CTC-specific emission path" and "zero new code on the native path",
§11.3 "assert that `create-shipment-items` is unmodified"), and the deployed file contradicts all
three. Recorded as **C7**, not as a §11.3-only fix.

**TC2b: PASS, MEASURED**, applied to `QA-DOC.md` from `results/17-tc2b-reallocation.md`. Both halves
independent: no `REALLOCATION#` audit row on any of the nine R13 references, and the deployed
`staging-shipping-v2-create-shipment-items` routes a `CTC#`-prefixed origin away from the
`REALLOCATION` emit entirely. The read was baselined on one reference first, so an empty partition
could not be misread as an absence. **This was the last row on this ticket whose verdict a test QA can
run could still move.**

**Two corrections opened, no new question.** Both are settled facts needing a document edit, so they
are corrections and not questions:

* **C7**, the three LLD clauses above. **The build is right and the document is stale**: the
  modification is the guard §3's audit row and §9.2 require, and it is what makes §11.3's
  "reallocation is not triggered" half true. Lachlan's edit, Kian to confirm intent.
* **C8**, §9.2 says "`company` is what every consumer guard keys on"; the measured guard keys on the
  `origin` prefix. Same outcome, so not a defect, but **BUSY-1158's consumer-guard audit searches
  artefacts for these guards and a `company`-only search would miss it** and could report a guarded
  consumer as unguarded. Carried to that ticket as a search-term note.

**Two things C7 must not bury, both flagged and neither tested.** §11.3's other half, "a CTC order and
a UNI order of the same size produce structurally identical item records", is no longer obviously true
now that CTC items route through `createCtcShipment` and `attachItemsToOpenShipment`. And
`attachItemsToOpenShipment` is a native-path behaviour the LLD does not describe anywhere. Neither is a
1159 case today; both are named on the drift table so the next reader sees them.

**Q10 corrected, conclusion unchanged.** It was withdrawn from the Kian ask on 2026-09-09 as
`NOT TESTABLE, access`. A monorepo checkout does exist at `~/Repos/monorepo` and Cowork can read it,
but it is HEAD 2026-02-12 with **no git remote** and holds no CTC path at all. Usable for the pre-CTC
shape of existing consumers and nothing else. **It is not repo access and must not be cited as such.**

**Sign-off re-derived from the table rather than edited.** 28 cases: 20 PASS, 1 INCONCLUSIVE, 2
UNTESTABLE, 2 DEFERRED, 3 PROPOSED, no FAIL, nothing BLOCKED. What stops a sign-off is the three
PROPOSED cases being unrun, not a defect. TC6b, TC6c and TC16b are all cheap and need no fixture,
watermark move or schedule change.

**Slice 16 remains the only unrun slice file.** Its five stages were corrected on 2026-09-09 and none
has run. Poller schedule DISABLED, watermark UNSET, unchanged: this session ran no tests.

### Addendum, same day: slice 18 written for the three unrun cases

`slices/18-unrun-cases.md`. Four stages: S1 hunts the fixtures for TC6b and TC6c in one pass so a
session does not spend two stages discovering there is none, then S2 TC6b, S3 TC6c, S4 TC16b. Every
unrun case on this ticket now has a slice.

**A hazard was found and corrected while writing it.** Slice 16 S1's step 6, added on 2026-09-09, told
a runner to read `MessageGroupId` off `staging-shipping-manhattan-sender.fifo`. **That instruction was
wrong.** `MessageGroupId` is only returned by `ReceiveMessage`, and receiving **increments
`ApproximateReceiveCount`** and starts a 1500 second visibility timeout on the message's group. On that
queue it would have corrupted **slice 16 S3's own evidence**, which counts receives to 21 against a
`maxReceiveCount` of 20, could have dead-lettered a live message early, and would have blocked the
group meanwhile. Step 6 is now a no-op pointing at slice 18 S4, which reaches the same §3 claim through
the populator's deployed artefact and its logs without touching the queue.

**Two other things S1 of the new slice settles cheaply.** TC6c's shape cannot be found from our tables
at all, because §5 says a zero-quantity size produces no record, so its absence is invisible
downstream by design; the case has to rest on the skip **counter** and on **reconciliation**, not on a
missing row. And TC6b's fixture is best chosen with **unequal quantities across its sizes**, because
with qty 1 on every size the per-unit and per-size rules are indistinguishable in one reading.

## 2026-09-10, slice 18 run and wrapped. Two cases closed, one divergence found, sign-off still held

**Slice 18 ran from JJ's IDE session**, all four stages, `results/18-unrun-cases.md`. It respected the
queue hazard: no `receive-message` was run against either Manhattan FIFO queue, and both TC16b claims
came from the populator's logs and its deployed code instead.

**TC16b: PASS, MEASURED, and it is the strong form of the case.** Claim A, §3's truthy-`"undefined"`
fallback is not reachable in the deployed populator, which builds `${detailType}_${event.detail.id}`,
distinct per event. Claim B, all nine R13 references carried `message_group_id` equal to the order PK.
Both the consumer and the populator were resolved from AWS rather than from naming symmetry, which is
the right call given three sessions on this epic have already misread this queue's consumer.

**TC6b: UNTESTABLE for want of a fixture, with a population number.** Zero multi-size styles across
100 ECOM orders, 233 and 226 `(order, lineItemId)` groups across the two tables, largest distinct-sku
count anywhere is 1. **INFERRED and worth following up: this looks like a bulk shape, not an ECOM one**,
since a Shopify-originated order creates one Cin7 line per variant while a size run under one style
line is how a wholesale order is written. If so the case is BUSY-1161's, not E2E's, exactly as TC19's
breach turned out to be a wholesale condition. Not asserted: 100 orders is a population observation.

**TC6c: INCONCLUSIVE, three parts of four MEASURED.** The counter exists and has fired non-zero twice
on cycles already on record, and the deployed `expandLineItems` matches all three of §5's claims
exactly (no row, counted, not alerted, the last confirmed by contrast with the sibling `qty < 0` branch
which warns). Only the reconciliation half is open, and it is now **three named orders against one
cycle** rather than the 100-reference sweep slice 18 could only sketch. JJ's, Cin7 side.

**TC6d, new, and it outranks all three of the above.** The same artefact read shows
`expandLineItems` opens `if (!sizes.length) { skippedNoSizesCount += 1; continue; }`. **The LLD
specifies a fallback to the line's own `code` and `qty` in five places** (§5's detail-line table twice,
§5's line-grain prose, §5's item-key contract, §11.1's poller test). The deployed poller skips.

A `qty: 0` size is nothing and dropping it is right. **A single-size line is a real line, and dropping
it is a silent loss**: the counter increments, nothing alerts, and **§7's divergence check cannot see
it** because the order and the shipment record are both still created with matching `lastModified`.
The shipment is short a line and neither side knows.

**Latent until the condition is shown to occur, and that is exactly what has never been checked:
`skippedNoSizes` was added by the 2026-09-03 deploy and its value has never been read on any cycle in
any plan.** Register **Q43** at `TRIED 1`; attempt 2 written as `slices/19-empty-sizes-fallback.md` S1.
Not raised with anyone, per the register's own rule.

**Two things carried, not chased.** `261644` and `261646`, real ECOM orders at `status=OPEN`, hold
order-side items and zero shipment-side items, and the DIGITAL/INSTORE exclusion does not explain
either; found incidentally, recorded as a sign-off limit, and **not** read as TC6c's shape, which
would have overclaimed since that is a size-level absence and this is order-level. And `262223`'s PK
differs between the populator log and the `origin_index` resolution, eight of nine matched, worth one
check.

**Correction C9 raised against this plan's own reasoning.** Slice 15's out-of-scope list cited R14 for
"no wholesale record has ever been stored under any shape". Slice 18's scan found four synthetic
`WHOLESALE`/`RTV` records, three created after R14 ran. Narrowed in slice 15 in place, and corrected in
`../retests/RETEST-1158-1159/STATE.md`. The surviving claim is that no **real** wholesale order has ever been
stored.

**29 cases: 21 PASS, 2 INCONCLUSIVE, 3 UNTESTABLE, 2 DEFERRED, 1 PROPOSED. No FAIL, nothing BLOCKED.**
Sign-off re-derived, still held, and what holds it is now TC6d rather than three unrun cases. Poller
schedule DISABLED, watermark UNSET: this session ran no tests of its own.

## 2026-09-10, slice 19 S1 run. TC6d latent, and QA's AWS work on this ticket is finished

**S1 ran from JJ's IDE session**, `results/19-empty-sizes-fallback.md`. `skippedNoSizes` read **0 on
all 8 cycles that carry it**, first observed `2026-09-04T01:33:31Z` through `2026-09-07T06:32:38Z`.
The other 576 cycles in the swept history predate the counter and genuinely lack the field, which the
session spot-checked against one cycle's raw JSON rather than assuming.

**Two corrections to the slice's own framing, both from that session and both accepted.** Log
retention is `null`, unlimited, so the window is bounded by poller activity and not by a 30-day
policy; slice 19's text said otherwise and was wrong. And the sweep found no cycle since
`2026-09-07T06:32:38Z`, consistent with the schedule having been disabled throughout.

**One correction to the result file, appended there rather than edited into it.** It attributes the
counter to "the 2026-09-04 deploy (per Q43's register entry)". Q43 says **2026-09-03**, and so does
`../retests/RETEST-1158-1159/results/R11-pre-kian-confirmation.md` in six places. 2026-09-04 is the first
observed cycle carrying the field, not the deploy. The window is slightly wider than the file states,
which sharpens rather than weakens its own caveat.

**TC6d: INCONCLUSIVE, and the session was right to hedge it.** The divergence is MEASURED, the
occurrence is not, and **the negative covers about 3 days of poller activity, not weeks.** Recorded
as a sign-off limit in its own right, because several claims on this ticket rest on a counter reading
zero and that bound applies to all of them.

**The sharp point, and it is what makes S2 the only route:** running more poller cycles cannot answer
this, because occurrence depends on Cin7 line shape and not on cycle count. Enabling the schedule
would produce cycles, not fixtures. Q43 is `TRIED 2, negative` with that named as the closed route,
and it stays below `EXHAUSTED` because S2 exists and is reachable.

**QA's AWS-side work on BUSY-1159 is finished.** Nothing left that this plan can run against AWS
changes a verdict. What remains is two Cin7 queries and one judgement call, all three JJ's:
TC6d's occurrence, TC6c's three-order reconciliation, and whether TC6d is a drift row or a defect.
**That last one needs no further QA evidence**: the non-conformance against LLD §5 is measured and
only the blast radius is open.

Slice 16's five stages remain unrun and are now **optional**: they pursue a synthetic route to TC9,
which is already UNTESTABLE and handed to E2E, so they would add evidence rather than move a verdict.

**29 cases: 21 PASS, 3 INCONCLUSIVE, 3 UNTESTABLE, 2 DEFERRED. No FAIL, nothing BLOCKED, and
`PROPOSED` is retired from the doc** since all four added cases have now been attempted. Poller
schedule DISABLED, watermark UNSET.

## 2026-09-10 final. Doc signed off with limits, ready for Jira

**JJ's call, and it is recorded as a call rather than as evidence:** TC6d passes on no evidence of
loss, not on the build matching the LLD, and the empty-`sizes[]` divergence is carried as correction
**C10** rather than escalated to a defect. Since he was not going to run the Cin7 queries, **TC6c is
closed the same way**, on its measured mechanism, with the reconciliation recorded in the row as not
performed and the named three-order check handed to E2E.

**Both rows state their unmeasured part explicitly**, so neither reads as more proven than it is, and
TC6d's row opens by saying what the PASS rests on. **C10 is now the only record that the build and the
LLD disagree on the fallback**, which is why it was written before Q43 was closed rather than after.

**Q43 is closed, not answered.** The distinction matters for anyone who finds it later: the occurrence
question was never settled, the only remaining route was a Cin7 query, and it was declined as not
worth holding the ticket. If the shape is ever seen in real traffic the question reopens as a defect
with its evidence already assembled.

**29 cases: 23 PASS, 1 INCONCLUSIVE, 3 UNTESTABLE, 2 DEFERRED. No FAIL, nothing BLOCKED.**

**The sign-off was rewritten as an E2E handover**, which is what this doc is for, rather than as a QA
status note. Eight numbered limits, then what is handed on by owner: E2E, dev, BUSY-1161, BUSY-1162,
the confirmation epic, and Lachlan for the document corrections. The three that matter most to a
tester are that no SCALE rejection has been exercised on this build (D5 unresolved), that both alert
topics have zero subscribers so a missing alert is not a passing test, and that TC6d leaves a
silent-loss path §7's divergence check structurally cannot see.

**Slice 16 remains unrun and is now closed out as optional**, not pending: it pursued a synthetic
route to TC9, which is UNTESTABLE and with E2E, so it would have added evidence rather than moved a
verdict.

Poller schedule DISABLED, watermark UNSET. No test was run from Cowork in this session.
