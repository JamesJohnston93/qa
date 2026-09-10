# Final re-test plan, BUSY-1158 and BUSY-1159

Written 2026-09-04, after Kian deployed BUSY-1160 plus fixes to 1158 and 1159. The fix contents are
not known to QA, so this plan verifies from the deployed build outward rather than from a fix list
inward.

Ticket state: both 1158 and 1159 sit in Review. 1160 and 1161 are In Progress on Kian.

## Settle this before anything else: 1160 changes what correct looks like on 1159

Three BUSY-1159 cases currently PASS on the expectation that a second sighting of an order does
nothing:

* **TC4**, AC3, second sighting of an order edited in Cin7, "no update reaches SCALE"
* **TC3**, AC6, reset the watermark behind an order already sent, "nothing written, nothing re-sent"
* **TC21 and TC21b**, AC6, re-poll outside the dedupe window, "no second transaction row, no second
  send"

BUSY-1160's acceptance criteria require the opposite for a genuine edit: "pre-wave edits in Cin7 are
reflected in SCALE: line added, quantity changed, line removed, address changed", and "a replayed
revision is a no-op under the version guard; a later edit in a new modified-date tick passes".

With 1160 deployed, TC4's PASS is either stale or a live defect and there is no way to tell which
without re-running it. Same for TC3 and TC21. These are not regression sampling, they are the highest
priority cases in the run.

Related: TC21b is INCONCLUSIVE against the hypothesis that the build is create-only and the
present-order branch does nothing. If 1160 is deployed that branch now exists, so TC21b becomes
measurable rather than a guess.

**Decided 2026-09-04, JJ: re-run and re-write against current behaviour.** The doc goes to E2E testers
who will run against whatever is deployed at that time, and over-testing costs less than a stale PASS
reaching UAT.

## What no build can fix

Six items on these two tickets will not close on this run whatever the fixes did. Named here so
sign-off is not planned around them.

**BUSY-1158**

* TC1b BLOCKED, no repo access
* TC6c BLOCKED, dev deferred it until the BigQuery reporting LLD lands
* TC7 and TC7b INCONCLUSIVE, AC8 is not provable from outside the repo, verification belongs to
  dc-packing unit tests

**BUSY-1159**

* TC14 ECOM half BLOCKED on absence: no ECOM order has been observed at a picked stage across five
  independent checks. The mechanism half, Q31, is separately re-testable, see R5.
* TC19 BLOCKED, `oversized:0` across 718 orders, which is the case's own expected outcome

A clean run therefore leaves 1158 signable with four documented limits and 1159 with two. Signing
them outright needs a decision from Lachlan or Kian, not a test.

JJ's position, 2026-09-04: run to the absolute limit of what is testable from QA's side first, then
take the residue to them for sign-off. So these six are not a reason to stop, they are the list that
goes with the handover.

## Sessions

R0 gates everything. If R0 shows a lambda was not redeployed, drop the sessions that depend on it
rather than running them.

### Revised 2026-09-04 after R0 ran

R0 is done. Slice files for R1 to R5 are written and cut against its result, not against this plan
alone. Four things changed:

* **R1 is reframed.** The CTC split named in Q27's answer has not landed, so TC4f cannot pass and
  AC5 stays FAIL on BUSY-1158 whatever R1 finds. R1's job is now ground truth on what the lambda does
  with a CTC order, including the inventory write side, as evidence for Kian.
* **R4 widened.** The poller and the sender both changed, so TC6, TC10 and TC18 are in scope rather
  than carried. R4 also has to enable and re-disable the poller schedule, since TC1's trigger is the
  schedule.
* **TC9 and TC15 lost their evidence.** The stage-5 DLQ was drained and `261070`, `261073` and
  `261089` are gone. Both cases need a fresh rejection manufactured before they mean anything.
* **Order is now fixed: R4, then R3, then R2.** R3 needs an order R4 sent; R2 needs a shipment R3
  moved off `OPEN`. R1 and R5 float.

Carried rather than re-run, because R0 measured them unchanged: BUSY-1158 TC5, TC5b, TC6 and TC6b,
which rest on the Segment handler and the orders reporting stream.

### Revised again 2026-09-04, after R1, R4 and R5

R0, R5, R4 and R1 have all run. Two corrections and one new finding re-cut the rest.

**The original R3 was invalid and has been superseded.** It was written around a sequence of live Cin7
edits, which both ticket `CLAUDE.md` files already forbade: Cin7 is CTC's live production system and
is read only for everyone, JJ included. Replaced by:

* `R3-update-semantics-no-cin7-write.md`, which runs TC3, TC21, TC21b and the version guard's replay
  half against R4's four sent orders. **Three of the four rows this re-test was called for are
  runnable today**, which the blanket "R3 is not runnable" reading missed.
* `_parked-cin7-revision-cases.md`, holding TC4, the line reconciliation shapes, the address-update
  payload assertion, the version guard's discriminating half and the cancellation path.

**R5's wholesale finding is confounded and must not go to Kian as it stands.** Both orders that
vanished were wholesale, and both were at a stage that was already excluded before the deploy
(`Fully Picked`, `Dispatched`). Wholesale and already-excluded-stage are perfectly confounded in that
cycle. `R8-wholesale-exclusion.md` discriminates them with a wholesale order at `New` or `Processing`,
plus an ECOM control. It also compares the counter set across the four cycles on file, because a skip
counter that silently stopped firing is a finding in its own right whatever the drop turns out to be.

If the drop is real, it fails BUSY-1160's first acceptance criterion in the worst available way: no
error, no counter, no alarm, no DLQ.

**Five cases now wait on naturally occurring fixtures, so `R9-fixture-watcher.md` builds a daily
read-only check for them** rather than leaving "re-check opportunistically" to memory. The shapes are
perishable: R5's fixture existed for one day, and a second-revision order is consumed by the next
poller cycle.

**R2 is no longer downstream of R3.** Its precondition is a CTC shipment off `OPEN` by any route, and
`list-ctc-shipment-states.sh` checks that cheaply at any time.

**Still open after this pass, for Kian or the project team:** the wholesale drop (pending R8), Q27's
write side on `staging-inventory-v2` (no known mapping from a Cin7 SKU or branch id to that table's
`sku` + `store` key format), and the plan-level gap that BUSY-1160's reconciliation behaviour may go
unverified for want of a fixture this team cannot create.

### Revised a third time 2026-09-04, after R9, R8, R3 and R2

R8, R3 and R2 all stopped without executing a case. R9 built the watcher and ran it.

**Traffic volume is not what stopped them, and waiting is the wrong response.** Organic CTC order
volume is stable at 9 to 13 an hour across every window measured this pass: R5 saw 8 in 36 minutes,
R8 saw 223 in 24 hours, and R3's outlying 103 in 69 minutes is roughly 13 organic plus one warehouse
batch-dispatch job that moved about 90 orders in 83 seconds. Remove the batch and R3's rate is R5's
rate.

So the constraint is not a traffic level, it is that **the poller's window has no upper bound**. The
watermark sets where a cycle starts and invoke time sets where it ends, which makes blast radius a
function of how stale the target is. A fixture on the far side of a dispatch batch is not recovered by
waiting, it recedes.

That produces the two new slices:

* **`R10-reachability.md`.** Whether the poller accepts an upper bound in its invoke payload, probed
  safely with the watermark set one minute back so an ignored override costs a normal six-minute
  cycle. If any spelling works, R3, R8 and every fixture R9 tagged `[PAST]` become runnable the same
  day. It also asks whether the deployed lambda artifact is downloadable, which would bear on six
  cases currently unprovable from outside the repo, and it maps when the dispatch batches run so
  future windows can be placed between them.
* **`R9-fixture-watcher-rev2.md`.** Two corrections to the watcher spec, both mine. Check 1 compared
  `modifiedDate`, so it fired on stage progression and hit 69 of 70; it has to compare content. And no
  candidate carried a reachability figure, which is precisely what R8 and R3 each spent a session
  rediscovering by hand, so every candidate now gets a window order count and a REACHABLE / EXPENSIVE
  / PAST classification. Plus the sixth check R8 asked for, a fresh wholesale order paired with a
  same-window ECOM control.

**R2's slice file carried a stale "Depends on R3" header** while KICKOFF said the opposite. Fixed, and
it now records 79 of 79 CTC shipments still `OPEN`, up from 70 at slice 04 through this pass's own
sends, distribution unchanged.

**A third option exists for R3 and R8 and it is JJ's call, not a session's:** accept one wide sweep
with sign-off. The cost is real but bounded and it is staging pollution, not production risk. Cin7
stays read-only either way. A 200-order sweep would create roughly 200 order and shipment records in
staging plus their downstream fan-out, and `clean-ctc-order.sh` is hard-locked to `kian-dev`, so there
is no cleanup path on staging. That noise then sits under every future full-table scan and state map.
Worth doing only if R10 Gate B comes back negative.

### R0. Build identification. IDE, ~20 min, read only

We have no fix list, so this session produces one.

* Last-modified timestamp, code SHA and version on every lambda in the pipeline: so-poller, orders
  service handlers, shipment sender, `faulty-sale-worker-queue-handler`, dc-packing workers,
  pickslip, Segment, both reporting streams, the two inventory dispatchers,
  `orders-dn-rec-eda-queue-handler`.
* Stack last-update times.
* Whether the present-order / update handler exists at all. This is BUSY-1160 slice 01 Gate A, run it
  here rather than duplicating it.
* Whether the poller schedule is still DISABLED and the watermark still
  `2026-08-28T01:35:45.769Z`. The deploy may have re-enabled the schedule.

**Gate:** the list of changed consumers sets the regression scope for every later session.

### R1. BUSY-1158 AC5, the faulty sale worker. IDE, ~45 min

Runs whatever R0 finds. Q27 is being re-verified from behaviour rather than from the dev
answer, so this session establishes ground truth on what that lambda actually does with a CTC
order. The dev statement that it "cannot execute because the fields it needs are absent" is the
claim under test, not the premise: our own investigation measured every invocation returning
`StatusCode 200`, `Payload null`, `Errors 0`.

* **TC4f**, the re-test the case was written for: sweep the log group for a live CTC reference,
  expect no CTC reference at all.
* **TC4c** re-sweep against the real event wiring, every subscriber has a stance. AC5 is FAIL until
  this clears.
* **TC4d**, pickslip on a live CTC shipment, look for a named guard line this time rather than
  absence.
* **Audit item 8**: `orders-dn-rec-eda-queue-handler` is recorded as UNKNOWN not MEASURED and is
  absent from the blocker list. Resolve it here.
* **The write side**, never checked on this path: does an invocation on a CTC order write to
  `staging-inventory-v2` or emit on `staging-inventory-bus`. Absence of an error is not absence of
  a write.
* Same read confirms whether customer data is still unredacted in that log group.

Extract only the fields needed. Never print matched lines whole.

### R2. BUSY-1158 TC4e, lifecycle-gated consumers. IDE, ~40 min

Runs only if R0 confirms the update and cancellation path is deployed.

TC4e has been blocked because all 70 CTC shipments on staging are `OPEN`. BUSY-1160 adds address
updates and cancellation, which is the first mechanism that can move a CTC shipment off `OPEN`. Drive
one CTC shipment through an address change and a cancellation, then sweep reallocation, NewStore,
Shopify and click-and-collect for a stance.

If the path is not deployed, TC4e stays BLOCKED and this session does not run.

### R3. BUSY-1159 update semantics. IDE, ~60 min. Highest value session

On a fresh ECOM order that has already been sent:

* **TC4** re-run: edit it in Cin7, poll, record what reaches SCALE. Under 1160 the expectation
  inverts.
* **TC3** re-run: reset the watermark behind it, poll, record.
* **TC21 and TC21b** re-run: re-poll unchanged outside the dedupe window and name the guard. TC21b's
  expected result is that the guard is named, so an unnamed suppression is a FAIL, not a PASS.
* **Version guard**: replay an older revision, expect a no-op. Then a genuine later edit in a new
  modified-date tick, expect it to pass.
* If an address update sends, confirm the payload carries no lines.

Cin7 writes stay with JJ.

### R4. BUSY-1159 create-path regression. IDE, ~45 min. Scope set by R0

Prove the fixes did not break what was passing. One fresh ECOM order end to end: TC1, TC1b timing,
TC8 row counts, TC16 `MessageGroupId`, TC11 bus isolation, TC15 hard-error containment, TC9 DLQ park.

TC6 (duplicate option), TC10 (Worship brand) and TC18 (25 character truncation) only re-run if R0
shows the poller or the sender changed. They are mapping cases and a consumer-only deploy cannot
touch them.

### R5. Eligibility gate, Q31. IDE, ~30 min, opportunistic

Q31 is the one thing blocking 1159 sign-off, and it is code against intent: the deployed poller flags
`Fully Picked` as ineligible while the LLD and dev say all four stages are eligible. If the fix
included the stage gate, this closes.

* Re-run slice 11's controlled single-cycle measurement: one order at a picked stage plus a
  same-cycle stage-eligible control, check `skippedStages`.
* `Partially Picked` is currently inferred from the same code path. Measure it if a fixture exists.
* ECOM half: `find-picked-stage-orders.sh`, then a contact-group check on any hit. If nothing exists,
  the slice stops and TC14's ECOM half stays blocked. Cheap to re-run daily.

### R6. BUSY-1159 SCALE UI reads. Manual, ~30 min, no AWS

TC1a mapping read on whatever orders R3 and R4 produce. Order Planning > Planned Shipment Insights,
searched on `ShipmentId`. Under 1160, also read the shipment after an update to confirm lines were
not re-sent on an address change.

### R7. Doc sync. Cowork, no AWS

Sync both QA docs and STATE files against the results, run `qa-doc-cleanup` on each, push to
Confluence pages 1929642002 and 1929805827.

## Not in this plan

The nine audit open items are read-and-compare against files already on disk. None needs a test run
and none is gated on the deploy.

**Audit item 1 is now folded into R0 Gate D and R1 rather than desk-checked.** JJ's call, 2026-09-04:
Q27 gets re-verified by measurement end to end rather than by comparing the register against an
investigation file. The register entry is updated from the R1 result, not the other way round.

## Environment

* AWS SSO staging profile expires between sessions: `aws sso login --profile staging`.
* Watermark reads and sets need `--poller so` every time. The flag defaults to `item` and the wrong
  flag rewinds the item master feed.
* Poller schedule DISABLED as of 2026-08-28, watermark `2026-08-28T01:35:45.769Z`. R0 confirms both
  are still true.
* Cin7 credentials live in `.env` beside the scripts. Production API calls and any script needing
  production credentials stay with JJ.
* Thirteen scripts, none peer reviewed. A verdict resting on a script proves the script ran, not that
  the system behaved.

## Order and cost

R0 first, alone. Then audit item 1 (Cowork, cheap). Then R3 and R1 in either order, they are the two
that can change a verdict. R5 opportunistically alongside. R2 only if R0 permits. R4 scoped by R0.
R6 after R3 and R4. R7 last.

Five IDE sessions, one manual session, two Cowork sessions.
