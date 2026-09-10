# BUSY-1160 test plan state

**Last updated:** 2026-09-09, after slice 01, R14 (on the retest plan), and slices 02 through 08.
**Every slice has now run, twice over on the wholesale question -- slice 08 substantially rewrites
slice 06's own AC1 findings.** What remains needs other people, not another slice.

| Slice | Status | Result file |
|-------|--------|-------------|
| 01 deployment gate | RUN 2026-09-08. Everything present, pattern readable, PutEvents permitted. Proceed to slice 03 | results/01-deployment-gate.md |
| 02 taxStatus coverage | RUN 2026-09-09. Cin7's own API docs gave the authoritative 4-value set; code read found the fix already deployed for 3 of 4 (`Exempt` no longer hard-errors). `Undefined` is the one residual item | results/02-taxstatus-coverage.md |
| 03 synthetic harness and fidelity gate | RUN 2026-09-08. Harness built, Gate A passes, TC12 PASSES | results/03-synthetic-harness-and-fidelity.md |
| 04 revision reconciliation | RUN 2026-09-08. 9/10 PASS, TC6 not runnable as written (no wholesale order exists) | results/04-revision-reconciliation.md |
| 05 cancellation and isolation | RUN 2026-09-08. TC15 PASS, TC16 PASS, TC18 **FAIL** (narrowed by slice 08), TC20 PASS, TC21 PASS. Q30's picked-stage arm negative but did not clear the risk on its own -- settled by slice 07 | results/05-cancellation-and-isolation.md |
| 06 wholesale and blocked remainder | RUN 2026-09-09. **Superseded on AC1 by slice 08 the same day** -- TC2/TC1b's "unbuilt"/"cannot pass" verdicts were correct for the account state a couple of hours earlier, not for the deploy slice 08 found | results/06-wholesale-and-blocked.md |
| 07 poller cancel-emit source read | RUN 2026-09-09. **Q30 closes NEGATIVE** -- the deployed poller's eligible-stages list already matches dev's intent, `Fully Picked`/`Partially Picked` never reach the cancel path. **Q31 found stale**, superseded by the same deploy. Ticket's last sign-off blocker cleared | results/07-poller-cancel-emit-source-read.md |
| 08 final sweep before dev | RUN 2026-09-09. **Q38 CONFIRMED. TC17's classification confirmed. TC18 narrowed to Form A specifically. AC1's downstream half PASSES at runtime** (TC1b/TC2/TC3, a complete dedicated wholesale pipeline nobody had traced, deployed within the prior ~2 hours) -- **Q40 corrected** (wrong function), **new defect found, Q41** (Manhattan has no `CTC-WH` warehouse configured) | results/08-final-sweep-before-dev.md |

Prerequisite outside this plan: **R14**,
`../retests/RETEST-1158-1159/slices/R14-wholesale-shape-and-bundling.md`, **run 2026-09-08.** Both of Kian's
candidate explanations for the vanished wholesale orders are now falsified: no wholesale record has
ever existed under any `orderType` value in the complete retained history of `staging-orders-v2` or
`staging-shipments` (Kian's "different shape" premise), and no bundling mechanism exists in the
poller's logs, its CloudWatch metrics, or the set of log-line types it produces (Kian's "bundled
together" premise). Full detail:
`../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`. **Slice 06 can now run**, but
should expect a negative (no wholesale destination to test against) rather than a settled family to
verify.

`QA-DOC.md` holds 23 cases, all NOT RUN. It was drafted 2026-08-28, before the build landed, so its
drift table has moved and it should get a `qa-doc-cleanup` pass once slices start reporting. No
Confluence page yet, deliberately.

## Where this ticket sits

**Deployed to staging 2026-09-03. Status Review, assigned to JJ**, updated 2026-09-07. Blocked by
BUSY-1159, also in Review, no FAIL, no QA work outstanding.

This is the largest untouched body of work on the epic.

## What changed on 2026-09-08

Three things, and the second is the substantive one.

**1. The deployment question is answered.** The 2026-09-01 plan opened with a gate asking whether
anything was on staging. It is. Slice 01 was rewritten to ask what is there instead, and its old
Gate B and Gate C moved out.

**2. The fixture problem is solved for most of the ticket. JJ's decision, 2026-09-08.** The old plan
held that every revision and cancellation case waits on a real CTC user editing a real order, because
Cin7 is production. That is still true of Cin7 and was wrong about the consequence: **Cin7 is the only
read-only link in the chain**, and this ticket's ACs are almost entirely downstream of the poller.
Injecting a synthetic transaction on `staging-orders-v2-event-bus` reaches the populator, the
reconciliation handlers, the version guard, the shipping workers and the sender, covering AC2, AC3,
AC4, AC6, AC7 and AC5's cancel half. 14 of the 23 cases, including every one the old plan had parked.

Synthetic records run all the way through to Manhattan SCALE staging. The DC team is not yet looking
at Manhattan, so the blast radius is low, but **every record is marked `QASYN-` and registered in
`SYNTHETIC-REGISTER.md`**. That is not optional.

**3. R14 absorbed slice 01's wholesale gates.** `../retests/RETEST-1158-1159/slices/R14-wholesale-shape-and-bundling.md`
already measures the wholesale record family and the wholesale population. Running both would mean
two scans and two result files that can disagree. R14 first, slice 06 reads its answer.

**4. The plan folder was completed.** It had no `CLAUDE.md`, `SCRIPTS.md`, `TOOL-NOTES.md` or
`PROPOSALS.md`, which every sibling plan folder has and which every slice and kick-off prompt tells
the session to read. All four were written 2026-09-08, adapted from BUSY-1159's, plus the synthetic
record rules and the suppressor attribution rule that are specific to this ticket. Every relative
path referenced by a slice was checked and resolves.

## The two rules that carry the most weight

**Seed from reality, mutate one thing.** BUSY-1260's C5 findings came off hand-built direct-invoke
payloads and were retracted, because the poller builds the item `SK` and `sku` itself so those states
could not arise from Cin7 data. Every synthetic payload starts from a real persisted CTC order, never
from the LLD, and mutates only the field under test. Slice 03 proves this before anything rests on it.

**Every negative result names its suppressor.** Three mechanisms can silently swallow a transaction:
the idempotency index, the version guard, and the FIFO 5-minute content dedup. They key on different
things, so they can be isolated: a payload with a **new hash and an older `modifiedDate`** tests the
version guard alone. A bare absence is INCONCLUSIVE, not a pass. This is exactly what left BUSY-1159's
TC21b INCONCLUSIVE after it had been recorded as a pass.

## Open items

* **TC17 has no defined pass, and that is a design gap rather than a testing one.** Nothing says how
  the sender tells a retryable rejection from a permanent one; both arrive as an HTTP 200 with
  `rejectedTransactions > 0`. BUSY-1159's AC8 redrives that response, this ticket's AC5 wants it
  classified permanent. BUSY-1162 owns the taxonomy and is still To Do. **This is a new question for
  dev, not one of the ones already answered, so it is fair to raise.** On current evidence it is
  design, so Lachlan rather than Kian.
* **TC17 also needs a waved shipment.** All 79 CTC shipments in SCALE staging are `OPEN`.
* **The wholesale record family question is now answered by R14, 2026-09-08**: no wholesale order
  has ever been stored under any `orderType` value in either table's complete history, so neither the
  LLD's outbound-family reading nor the ticket's ride-along reading has anything to point at yet.
  See `../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`. Slice 06 should expect this
  negative rather than a settled destination to test against.
* **`PutEvents` on `staging-orders-v2-event-bus` is confirmed permitted**, 2026-09-08, slice 01 Gate
  C: `iam:simulate-principal-policy` against the actual QA staging role and the actual bus ARN returned
  `allowed`, matched by `PowerUserAccess`, and the bus itself carries no resource policy. No access
  grant needed. Slices 03 to 05 can proceed.
* **TC22 is not in the ticket.** It comes from Kian's answer on `taxStatus`: he mapped only the values
  he saw while testing and is wrapping the fix into this ticket. Slice 02 defines what the fix has to
  cover. **Do not raise it with him again.**
* **TC20 cannot be tested against a real confirmation.** The confirmation leg does not exist yet, so
  slice 05 tests the guard against a synthetic echo. A pass is about the guard, not about
  confirmations. D17 in `../DEFERRED-TEST-CASES.md`.

## Superseded

`scripts/watch-for-revisions.sh`, proposed 2026-09-01 as the fixture finder, is no longer on the
critical path. Synthetic injection replaces it. It keeps some value for corroborating synthetic
results against real revisions before sign-off, which is worth doing, but nothing waits on it.

The 2026-09-01 `PLAN.md`, `STATE.md` and slice 01 are kept as `*.bak-20260908`. The original slice 01
was moved to `_to_delete/`.

## Correction, 2026-09-02, from BUSY-1159 slice 13, still current

An earlier version of this file said TC20 cannot pass because `lastEmittedPayloadHash` is never
written. **Superseded.** A payload hash **is** computed on every emit, 8 hex characters, carried as
the trailing segment of `idempotencyId`. The named attribute is never exposed anywhere, and the
emitted event's key set matches the persisted rows exactly, so nothing is dropped by
`saveUnknown: false` and this is not a schema gap. TC20 asserts a behaviour, no second send.
BUSY-1159's TC13 was withdrawn and moved here as D17.

## Carried from BUSY-1159, still true

* **Poller schedule DISABLED, watermark UNSET** (R13 unset it at teardown rather than restoring
  `2026-08-28T01:35:45.769Z`). Slices 03 to 05 do not need it and must not enable it.
* `cin7-watermark.sh` needs `--poller so` on every sales order call.
* A manual invoke after the schedule has been off a while catches up the entire backlog, not one
  order. Five real orders were created and sent that way as a side effect.
* AWS SSO for `staging` expires between sessions, browser device-code flow, needs a human.
* SCALE reads are in **Order Planning > Planned Shipment Insights**. Shipping Insights lists
  post-wave shipments only, and reading an absence off it is how BUSY-1159 briefly concluded SCALE
  was accepting documents without creating shipments.
* No script in any of these plans has been reviewed by a second person.

## R14 has run, 2026-09-08, and it rewrote slice 06

`../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`.

**Neither of Kian's 2026-09-07 premises survives.** Full-table scans of both tables measured
`orderType` holding exactly one value ever, `ECOM`: 90 of 13,054 header rows in `staging-orders-v2`,
88 of 30,802 in `staging-shipments`, the rest MISSING (expected, it is a CTC-only field). An
account-wide sweep of all 137 table names for `outbound`, `transfer`, `wholesale`, `rtv` and `bt-`
returned zero. **No wholesale order has ever been stored anywhere, under any shape.**

No bundling mechanism exists either: not in the full cycle log, not in the `staging-orders-cin7`
metric namespace, and not as a log-line type the 2026-09-03 deploy introduced. Q35 stays open with
Kian, materially strengthened. Q36 stays closed with a second corroborating negative. Q38 moved to
TRIED 2, negative, and is now raisable.

**Consequences for this plan.** TC2 is written rather than run: no wholesale record family is in use
because no wholesale order has ever arrived, and both wholesale drift rows go down as unresolved by
the build rather than settled either way. TC1, TC1b, TC3 and TC4 stay BLOCKED, on a design question
rather than a fixture hunt.

**The confound R14 does not break, flagged by JJ 2026-09-08.** R14 proves nothing has ever landed. It
does **not** prove wholesale-ness is why. Every wholesale order ever put through a cycle sat at a
stage the deployed poller excludes anyway: 4 at `Approved`, 43 at `Dispatched` (both contact-group
confirmed), and R5's one at `Fully Picked`, which Q31 shows the build skips on stage. **Stage alone
explains every wholesale absence measured to date.**

Wholesale orders at eligible stages do exist in Cin7: R13's 24-hour listing recorded 13x `THE ICONIC`
at `New` and several `City Beach` / `Universal (QLD)` at `Processing`. None was polled, since R13's
96-minute window fell 1 to 5 hours short, and all were company-name proxies rather than contact-group
confirmed.

**So Q35 has never separated and no scan can separate it.** R14's W1c is the only test that
distinguishes "dropped because wholesale" from "never tested". **Its value is higher than R14's own
result file credited**, and slice 06 has been corrected accordingly. It runs from the RETEST plan,
needs a watermark write and one enabled cycle, and JJ runs the Cin7 side himself. Candidates are
perishable: Cin7 `modifiedDate` is mutable current state, so a fresh listing is needed each time.

## Corrections from R14 and slice 01 that change what a slice may assume

* **The echo counter now exists.** The 2026-09-02 note saying no echo-skip counter exists in the
  poller's output is out of date. `echoSkipped` is one of six fields the 2026-09-03 deploy added,
  with `staleSkipped`, `updated`, `cancelled`, `skippedLocallyTerminal` and `skippedNoSizes`. Slice
  05's TC20 has been corrected.
* **But the poller's counters are useless for injected transactions**, because a synthetic emit
  bypasses the poller. `staleSkipped` and `echoSkipped` will not move for an injection. Whether the
  handler side has its own counter is UNKNOWN, and **slice 03 Gate B now has to establish it**, since
  it is the attribution instrument slices 04 and 05 depend on. If it finds nothing, every later
  negative result is INCONCLUSIVE by construction and JJ needs to know before slice 04 runs.
* **The counter vocabulary went 13 fields to 19**, not R11's 6 to 12. R14 corrected the figure.
* **The routing consumers are the ticket's own cin7-specific populators**, not the shared
  `staging-orders-v2-eda-queue-populator`, which consumes a different rule and did not move on deploy
  day. Slice 01's own text carried the wrong claim; CLAUDE.md now carries the measured contract.
* **`skippedStages` is populating**, contradicting R11. Slice 04 must not assume it is empty.

## Script review is deferred, JJ's call 2026-09-08

Nothing gets a second reader until the bulk of testing is done. The scripts exist to be re-used when
a case has to be revisited, not to be signed off one at a time. **An empty Reviewed column is the
expected state, not an open item.** No session should chase a review or hold a verdict waiting for
one. The caveat still goes in every result file.

## Next session, start here

**Order matters. Do not jump to slice 04.**

1. ~~**Slice 01.**~~ Done 2026-09-08. Deploy is not partial, reconciliation handlers and their queue
   infra exist, routing contract for `TRANS_UPDATE_ORDER`/`TRANS_CANCEL_ORDER` is verbatim in
   `results/01-deployment-gate.md` for slice 03 to consume, and `PutEvents` is confirmed permitted.
   No stop condition hit.
2. ~~**R14**, on the retest plan.~~ Done 2026-09-08. Both of Kian's premises falsified; no
   wholesale record exists anywhere, no bundling mechanism exists anywhere. Slice 06 can run,
   expecting a negative.
3. ~~**Slice 03.**~~ Done 2026-09-08. Fidelity gate passed, TC12 PASSES, harness ready. Slices 04
   and 05 should read `emit-synthetic-revision.sh`'s usage and Part 3's ceiling in
   `results/03-synthetic-harness-and-fidelity.md` before writing their own emits, and use
   `--seed-reference QASYN-01-TC12` (self-revise) if they want to keep building on the same
   synthetic order rather than seeding a fresh one.
4. ~~**Slice 04.**~~ Done 2026-09-08. 9 of 10 cases PASS (TC5, TC7, TC8, TC9, TC10, TC11, TC13,
   TC14, TC19). TC6 not runnable as written -- no wholesale order exists to test its per-size grain
   (R14), closest ECOM analog measured and reported. TC14 settles drift row 2 (hash is in the
   idempotency key). Slice 03's open thread resolved: the reconciliation handler emits an outward
   event exactly when content changes, never otherwise.
5. ~~**Slice 05.**~~ Done 2026-09-08. TC15, TC16, TC20, TC21 PASS. **TC18 FAIL** -- the cancel
   handler throws an uncaught error on a DELETE for a never-sent shipment instead of a benign no-op,
   and tripped a real SNS-backed alarm (purged mid-session, JJ's call). Q30's picked-stage arm folded
   into TC16: clean negative at the layer tested, does **not** clear the actual risk -- updated in
   `../BUSY-1065-OPEN-QUESTIONS.md` and left open, recommended to Kian alongside Q31 before ship.
   `results/05-cancellation-and-isolation.md`.
6. ~~**Slice 06.**~~ Done 2026-09-09. TC2 written not run (R14's negative, cited not restated).
   TC1/TC3/TC4 BLOCKED on Q35 (silently dropped, not just unobserved). TC17 BLOCKED, two reasons,
   unchanged by R14. **TC1b settled P2**: the 25-char `ShipTo` truncation lives in the Manhattan
   sender, not the poller, confirmed by directly downloading and grepping both deployed Lambda code
   packages (a different avenue from the blocked monorepo-access question, Q10). **New defect found
   underneath it**: the sender's `ShipTo` is built only from a person's name, never from a wholesale
   order's delivery company, even though the poller already carries that value through under the
   field name the sender's own schema expects. Raised as **Q40**, CONFIRMED by source read, raisable
   with Kian. `results/06-wholesale-and-blocked.md`.
7. ~~**Slice 07.**~~ Done 2026-09-09. Source read of the deployed poller: `ELIGIBLE_STAGES` already
   includes `Fully Picked`/`Partially Picked`, matching dev's intent. **Q30 closes negative -- the
   ticket's last sign-off blocker is cleared.** Q31 found stale (measured a pre-deploy poller build).
   `results/07-poller-cancel-emit-source-read.md`.
8. ~~**Slice 02.**~~ Done 2026-09-09. Cin7's own API docs gave the authoritative 4-value `taxStatus`
   set (`Undefined`, `Incl`, `Excl`, `Exempt`) -- the 1000-order sample only ever had 3. A code read
   found the fix already deployed for 3 of 4 (`Exempt` no longer hard-errors, contradicting the
   historical finding it was written against, which measured an older build). `Undefined`, never
   observed, is the one residual item -- worth a one-line confirmation from Kian, not a blocker.
   `results/02-taxstatus-coverage.md`.

9. ~~**Slice 08.**~~ Done 2026-09-09. Read Part 1 traced a complete, previously-untraced dedicated
   WHOLESALE/RTV pipeline the poller routes to instead of rejecting -- deployed within the prior
   ~2 hours, after R11/R14 both measured it absent. Part 3 then proved it works at runtime: two
   synthetic `CREATE_OUTBOUND_ORDER` emits, one rejected by Manhattan on an unconfigured warehouse
   code (`CTC-WH`, itself real -- new defect, Q41), one accepted in full after correctly building
   `ShipTo` from the delivery company and truncating it at 25 characters (**Q40 corrected, wrong
   function**). Part 1a confirmed Q38. Part 1c gave TC17 a defined classification. Part 2 found and
   fixed a harness bug, then confirmed TC18's bug is specific to a missing `ORDER` row (Form B PASS).
   `results/08-final-sweep-before-dev.md`.

**Every slice has now run.** Nothing left needs another slice -- see the wrap-up below.

## Corrections from slice 01, 2026-09-08

* **CLAUDE.md's routing description was NOT wrong -- slice 01's own "correction" of it was
  incomplete. Corrected again by slice 03.** The routing contract is two stages. The poller's own
  `PutEvents` carries `DetailType: CREATE_TRANSACTION` and routes to the SHARED
  `staging-orders-v2-eda-queue-populator`, exactly as CLAUDE.md always said. That populator forwards
  to the shared transaction-chain handler, which persists the audit row, enforces idempotency,
  applies the version guard, and **re-emits** a second, domain-specific event
  (`TRANS_UPDATE_ORDER`/`TRANS_CANCEL_ORDER`) that THEN routes to the cin7-specific populator slice
  01 measured. Slice 01's Gate B only ever looked at this second hop and mistakenly read that as
  contradicting CLAUDE.md, rather than as a different, later stage of the same pipeline. Both
  descriptions are correct, about two different hops. See
  `results/03-synthetic-harness-and-fidelity.md` for how this was found (building a faithful harness
  required knowing what the poller itself puts on the bus, which slice 01 never actually measured).
* **`skippedStages` is populating again.** R11 (a different ticket) found it stopped populating on
  2026-09-03. Slice 01 measured it non-empty (`{"Approved": 4}`) in a 2026-09-07 poller log. Do not
  assume this field is empty by construction in slice 04.
* **The "manual poller invoke" flagged in slice 01 was not a mystery -- it was R13's own deliberate
  fresh-data-verification cycle** on the retest plan (`../retests/RETEST-1158-1159/results/R13-fresh-data-verification.md`),
  visible from this plan folder alone since slice 01 only reads this ticket's own docs. Resolved,
  not a new event, nothing further to flag.

## Slice 03, 2026-09-08

**Harness built (`scripts/emit-synthetic-revision.sh`, unreviewed -- reviewed is deferred by
design, see `SCRIPTS.md`). Gate A passes (one named, explained exception: the payload-hash algorithm
itself is not replicated). TC12 PASSES, all three sub-cases MEASURED.** First synthetic order
created: `QASYN-01-TC12`, `orderId 9d37be2e-2381-4f43-b838-08058cefd72b`, registered in
`SYNTHETIC-REGISTER.md`, reached Manhattan SCALE staging (`wmsSentAt` set).

**The reconciliation handler publishes its own named attribution instrument**:
`SalesOrderStaleRevision` (version-guard rejection, names both timestamps) and `SalesOrderUpdated`
(applied, names added/removed/addressChanged counts). **Slices 04 and 05 should read
`staging-orders-cin7-update-order`'s own log group for attribution, not a poller-side counter** (the
poller-side `staleSkipped`/`echoSkipped` counters do not move for an injected transaction, exactly as
the slice predicted, since injection bypasses the poller entirely).

**Open thread for TC11 (slice 04):** none of TC12's three (deliberately content-neutral) revisions
produced a new outward shipment-side event. Whether that is because nothing changed
(`added:0, removed:0, addressChanged:false` every time) or because the reconciliation handler never
emits on an update needs a case with a genuine content mutation to settle -- not this slice's job.

**Two process incidents, both caught and corrected in-session, full detail in `TOOL-NOTES.md` and
the result file:** a PII redaction bug (fixed, recursion into nested objects) while reading the seed
order, and a payload type-mismatch bug in the harness's first version that dead-lettered one poison
message into the existing `staging-orders-v2-dlq.fifo` (harmless -- isolated to its own FIFO group,
never persisted anything, caught and fixed before the actual TC12 test emits).

### Corrections slice 03 made to this plan's own documentation

* **The routing correction in slice 01's result file was itself wrong, and so was the CLAUDE.md edit
  built on it.** Both descriptions were right about different hops. **Stage 1:** the poller emits
  `DetailType: CREATE_TRANSACTION` from `Source: orders-cin7.cin7-so-poller.lambda`, routing to the
  **shared** `staging-orders-v2-eda-queue-populator` and handler, which persists the `TRANSACTION`
  row, enforces idempotency and applies the version guard. The verb travels in `Detail.event`, not
  `DetailType`. **Stage 2:** that handler re-emits `TRANS_*_ORDER`, routing to the cin7-specific
  populators slice 01 measured. **Inject at stage 1.** CLAUDE.md now carries both hops. Slice 01's
  result file is closed and was not rewritten, so read it with this in mind.
* **There are two hashes, not one.** `idempotencyId`'s trailing segment and
  `orderInfo.lastEmittedPayloadHash` are different values on the same order, MEASURED across four
  real orders. Neither algorithm is known without a code read, so no case may assert a hash matching
  a computed expectation. Asserting a hash **changed** is fine. `lastEmittedPayloadHash` is written
  and updated on every applied revision, so the old "never exposed" framing is also wrong. Slice 05's
  TC20 corrected.
* **Five PII-print incidents in four days now**, two of them in this slice. The instructive one: a
  correct allowlist applied only at the top level, so a nested `addressChanges.shipping` walked past
  it. CLAUDE.md now says a redactor must recurse and must be verified against known-PII strings
  before being trusted.

See `results/03-synthetic-harness-and-fidelity.md` for full detail.

## Slice 04, 2026-09-08

**9 of 10 cases PASS** (TC5, TC7, TC8, TC9, TC10, TC11, TC13, TC14, TC19). Four synthetic orders
created (`QASYN-02-TC11` through `QASYN-07-TC14`), several cases sharing one emit where the mutation
genuinely answers more than one question (TC11+TC5+TC19 on one add-line; TC8+TC9+TC13 on one
change-address), not a violation of "one seed per case" -- that rule guards against reusing an order
a *different* mutation already drifted.

**Harness bug found and fixed mid-slice, one claim retracted.** Every `add-line`/`change-qty`
mutation generated a non-numeric synthetic `lineItemId`, which the Manhattan handler correctly
refuses to forward (`"refusing to send a corrupted ErpOrderLineNum to SCALE"`) -- the harness's own
bug, not a system defect, same class as BUSY-1260's C5 retraction. **TC5's "reaches SCALE" half is
retracted** (the DynamoDB-side insert/untouched claims stand). TC6/TC10/TC14 are unaffected since
none of them actually asserted a SCALE-side result for the synthetic line. Fixed
(`emit-synthetic-revision.sh` now generates a numeric `lineItemId`); ~5 pre-fix poison messages are
draining on their own in the Manhattan sender's queue, see `SYNTHETIC-REGISTER.md`'s side-effects
table.

**Resolved slice 03's open thread.** Ran TC11 first, on a genuine content change (add-line), per the
slice's own instruction. Result: the reconciliation handler emits exactly one outward event when
content changes (`added`/`removed`/`addressChanged` any true), and none when it does not -- TC12's
content-neutral revisions and this slice's TC13 (an applied-but-unrelated address change riding
alongside TC8) both corroborate this independently. **AC7 is satisfied**, not silently broken.

**TC14 settles drift row 2**, in the LLD's favour: two revisions sharing one `modifiedDate` but
different content both applied, neither dropped as a replay -- the payload hash is doing real work
in the idempotency key.

**TC6 is not runnable as written.** Its assertion (`ITEM#<lineItems[].id>#<size code>`, same SK
updated in place) belongs to the WHOLESALE/RTV/STORE_PICK per-size grain, and R14 already
established none of those has ever existed. ECOM has no in-place quantity field at all -- a
quantity increase and a new line are the same operation. Closest ECOM analog run and reported
(`added:1`, confirming this structurally), not forced into a false pass. Recommend rewording or
deferring TC6, JJ's call.

**TC7 traced a 5-hop outward chain** (`CANCEL_ITEM` -> shipping-side item-cancelled ->
`SHIPMENT_ITEM_REMOVED` -> shipment transaction chain (twice) -> Manhattan sender) to confirm a
removal genuinely reaches the sender and is accepted by Manhattan. One residual gap named: the
actual XML content and live SCALE state need a UI read (Order Planning > Planned Shipment
Insights) this session's tools cannot do.

**One process note:** a `describe-log-streams` check briefly returned a stale timestamp for the
Manhattan sender's log group during TC7's trace, several minutes behind the actual latest event --
an eventual-consistency quirk, not a script bug, resolved by re-querying. Worth remembering before
concluding "no send" from one check.

See `results/04-revision-reconciliation.md` for full detail.

Slice 02 is independent of all of it and can fill any gap.

## Slice 05, 2026-09-08

**TC15 PASS both halves, TC16 PASS on its own comparison, TC18 FAIL, TC20 PASS, TC21 PASS.** Four
synthetic orders (`QASYN-08-TC18` through `QASYN-10-TC16`), `emit-synthetic-revision.sh` extended
with `--source-stage` (needed for TC16 and the Q30 arm, `TOOL-NOTES.md`).

**TC18 found a real, live defect and it briefly paged during the session.** A `CANCEL_ORDER` for an
origin with no prior header throws an uncaught error (`"header is missing"`) instead of the benign
no-op TC18 expects, and tripped `staging-orders-cin7-cancel-order-errors`, a real SNS-backed alarm,
within 90 seconds of the first attempt -- confirmed by alarm history against a function that had
never been invoked before today, so attribution is solid. **JJ's explicit mid-session call: purged
the stuck message** from `staging-orders-cin7-cancel-order-queue.fifo` rather than let it retry and
re-alert for up to 8 hours before dead-lettering. Both alarms confirmed back to OK afterward.
Recommend raising with dev; this is a well-formed `CANCEL_ORDER`, the shape a real poller emits, not
a BUSY-1260-class hand-built payload.

**TC15 traced the full cancel-to-SCALE chain and confirmed the SCALE-facing `ShipmentId` is the
literal `QASYN-` reference**, not the internal shipment UUID -- the fact that makes the marking
rule's 25-character ceiling meaningful. Found, not a defect: the header DELETE is triggered by the
shipment becoming *empty of items* (own named metric `CtcShipmentEmptied`), the same code path a
full line removal takes, not a distinct order-level cancel mechanism.

**TC16 settles cleanly: `sourceStage` is inert to the reconciliation handler.** Only the event type
(`UPDATE_ORDER` vs `CANCEL_ORDER`) decides the outcome -- a `Dispatched` stage-only revision applies
as an ordinary content-neutral update (no outward event), exactly like an explicit cancel produces
one, regardless of what `sourceStage` says either way.

**Q30's picked-stage arm is the one result that needs reading carefully, not taken at face value.**
It produced a clean negative -- a synthetic `sourceStage: "Fully Picked"` revision did not DELETE the
live SCALE shipment -- but that only proves the **downstream reconciliation handler** has no
stage-based logic at all (good and bad: no accidental cancel trigger, but also no safety net).
Combined with Q31 (CONFIRMED: the poller currently drops `Fully Picked` from its eligible query
results) and TC15 (a `CANCEL_ORDER` executes unconditionally, no stage check), **the actual risk Q30
names is unresolved and lives entirely in the untested poller layer** -- whether the poller's own
disappearance-detection logic would read a picked-stage order's absence as cancellation. Updated in
`../BUSY-1065-OPEN-QUESTIONS.md` Q30 and left open, recommended to Kian alongside Q31 **before
BUSY-1160 ships**, not closed by today's negative.

**TC20 served by the same `--source-stage` revisions**, not a separate emit -- both are "a
confirmation-leg-owned field only, fresh hash, no item/address change", and both showed no second
send. Ceiling: only `stage` was tested; the harness has no field for shipped quantities or tracking,
since neither is part of the poller's own measured payload shape.

**TC21** confirmed a real, months-old Universal Store order was untouched throughout.

See `results/05-cancellation-and-isolation.md` for full detail.

---

## Wrap-up, 2026-09-08 end of session

Four slices ran today: 01, R14 (on the RETEST plan), 03 and 04. **8 PASS, 2 PASS with a named
residual gap, 1 not runnable as written, 12 NOT RUN, no FAIL.** From 23 NOT RUN this morning.

`QA-DOC.md` prose was rewritten at wrap-up, not just its case table. Its Blockers, both wholesale
drift rows, the NOT RUN note and the Sign-off were all written on 2026-08-28 against a build that had
not shipped and a fixture theory that has since been falsified. Three blockers it carried have
cleared and are marked as cleared rather than deleted.

### Where the ticket stands, by acceptance criterion

* **AC4, AC6, AC7 evidenced.** TC9, TC12, TC13, TC11.
* **AC2, AC3 evidenced with two named gaps.** TC5, TC7, TC8, TC10 pass. TC5's SCALE half is UNKNOWN
  for its own emit; TC6 is not runnable as written.
* **AC5 untested.** Slice 05, drivable, ours to run. TC17 has no defined pass.
* **AC1 has no fixture and none can be made.** No wholesale order has ever reached the system.
* **AC8** is dev's handler unit tests, not a QA case here.

### The two findings worth carrying

**TC11 settled AC7's meaning.** Slice 03 left two readings open: the handler emits only on a content
change, or it never emits on an update at all. TC11 measured the first. A content-changing revision
produced exactly one `ADD_ITEM` event to exactly one target; TC12's three content-neutral revisions
produced none. So AC7's "exactly one outward event per revision" reads as **per revision that changes
something the shipping side needs to know**, not per accepted revision. The alarming alternative, an
update silently never reaching SCALE, does not hold, and TC5, TC7 and TC8 corroborate it
independently.

**TC6 is a case/reality mismatch, not a defect.** It asserts an in-place quantity update under the
same `ITEM#<id>#<size>` `SK`. That grain belongs to WHOLESALE, RTV and STORE_PICK. ECOM is one row
per unit with no quantity field, so a quantity increase and a new line are structurally the same
operation, which is what the measured `added:1` shows. **Needs rewording for ECOM or explicit
deferral. JJ's call, and it is a decision, not a test.**

### Harness bug caught mid-slice, and the retraction it forced

Every `add-line` and `change-qty` emit generated a non-numeric `lineItemId` (`QASYN<hex>`). The
Manhattan-side handler validates that field and refused to forward it, which is **correct protective
behaviour**: a real Cin7 `lineItemId` is always numeric, so this shape cannot arise from real data.
This is the BUSY-1260 C5 class of error caught before it became a finding.

Consequence: **TC5's "and it reached SCALE" half is retracted for its own emit.** The DynamoDB
reconciliation, the attribution line and the non-interference with the existing line all stand.
TC10's and TC14's assertions are unaffected, since neither claimed a SCALE result for a synthetic
line. Harness fixed to a numeric `lineItemId` and structurally re-verified. **Re-running one add-line
emit under the fix closes TC5.**

### Follow-ups, in the order they are worth doing

1. **Slice 05.** The whole of AC5 and the only substantial runnable work left. Carries Q30, below.
2. **TC5's re-run**, one add-line emit under the fixed harness. Small.
3. **TC7's SCALE-UI read.** Shipment `QASYN-03-TC7` in Order Planning > Planned Shipment Insights.
   JJ's, no AWS.
4. **TC6's rewording or deferral.** JJ's decision.
5. **Slice 02** (TC22) and **slice 06** (writing down R14's answer) whenever.

### Q30 is now drivable, and that is new

Q30 sits at `TRIED 1, inconclusive on population`: does an order reaching a picked stage get read as
a loss of eligibility and DELETE its live SCALE shipment. Attempt 1 failed for want of a fixture,
since every CTC order the epic had sent was `Dispatched`.

**The harness removes that dependency.** A synthetic revision can put an order at a picked stage
directly. That is a differing-in-kind second attempt, not a wider re-run, so it meets the register's
bar. Folded into slice 05's TC16 as an extra arm. **If a picked-stage revision produces a header
DELETE, it would delete a warehouse job in progress**, which stops the slice and goes to JJ.

### Correction found at wrap-up: the Confluence page already existed

Every status doc and this file said BUSY-1160 had no Confluence page, "deliberately". **It has one,
and it did before today**: page id **1929052164**, `QA Doc - BUSY-1160` in space QD,
https://universalstore.atlassian.net/wiki/spaces/QD/pages/1929052164/QA+Doc+-+BUSY-1160

Nobody recorded its creation. It is now at **version 5**, carrying today's `QA-DOC.md` byte for byte,
verified by a diff of the published body against the local file after the push.

This is the second time on this epic that a page was found ahead of what our notes claimed, after
BUSY-1158's. **Check the live page before asserting its state.** The local `QA-DOC.md` remains the
source and Confluence the copy.

### Environment at end of session

Poller schedule **DISABLED**. SO watermark **UNSET**. Confirmed before and after every slice today;
nothing this session touched either. AWS needs an IDE session, there is no access from Cowork.

Seven synthetic orders exist, `QASYN-01-TC12` through `QASYN-07-TC14`, all registered. Side effects in
shared infrastructure are in `SYNTHETIC-REGISTER.md`'s side-effects table: one poison message in
`staging-orders-v2-dlq.fifo` from slice 03's type bug, and roughly five more working through their
retry budget in `staging-shipping-manhattan-sender.fifo` from slice 04's `lineItemId` bug. All
isolated to their own FIFO groups, nothing blocked, none of them persisted anything. **Clearing them
is JJ's call.**

### Standing risks, unchanged

* No script across these plans has been reviewed by a second person, deliberately, until testing is
  done. Every verdict rests on one, so a pass evidences the script ran as much as the system behaved.
* Every PASS on this ticket rests on synthetic injection. It proves handler behaviour given an input
  the system was actually sent, not that Cin7 emits revisions in these shapes.
* The poller is untouched by this ticket's coverage: contact-group resolution, stage eligibility, the
  watermark and the echo guard are all outside it.

---

## Wrap-up addendum, 2026-09-08, after slice 05

Slice 05 ran in a later session the same day. The follow-ups list above (#1, "Slice 05") and the AC5
"untested" line are now stale -- superseded by this addendum, not rewritten in place.

**AC5 now evidenced, with one open risk carried forward, not two.** TC15 and TC16 PASS
(`results/05-cancellation-and-isolation.md`). TC17 still has no defined pass (unchanged, design gap,
Lachlan's). **TC18 is a new FAIL**, a real defect: the cancel handler throws instead of no-op-ing on a
DELETE for a shipment SCALE never held, and it briefly tripped a real SNS-backed alarm mid-session --
purged, JJ's explicit call, both alarms confirmed OK again before continuing. Recommend raising with
dev.

**Q30 did not resolve the way the pre-slice note above expected.** That note said a picked-stage
DELETE "stops the slice and goes to JJ" -- it did not produce a DELETE, so the slice continued, but
the result is not the clean close that phrasing implies either. The picked-stage arm only proved the
**downstream reconciliation handler** has no stage-based logic of any kind (inert either way). Combined
with Q31 (poller currently drops `Fully Picked` from eligibility, confirmed) and TC15 (a `CANCEL_ORDER`
executes unconditionally, no stage check), **whether the poller itself would ever actually send a
cancel for a picked-stage order is still completely unmeasured**, and that is the only thing that
would turn this from a live risk into a settled one. Q30 updated and left open in
`../BUSY-1065-OPEN-QUESTIONS.md`, recommended to Kian alongside Q31 before BUSY-1160 ships. This is
the single most consequential open item on the ticket right now, ahead of TC17 and AC1.

**Environment, updated.** Ten synthetic orders now exist, `QASYN-01-TC12` through `QASYN-10-TC16`, all
registered. New side effect: TC18's stuck retry was purged from
`staging-orders-cin7-cancel-order-queue.fifo` (not left to drain like the others) since it was
actively re-triggering a real alert; the two prior side effects (the slice 03 DLQ poison message, the
slice 04 `lineItemId` poison messages) are unchanged, still JJ's call whether to clear. Poller schedule
DISABLED, SO watermark UNSET, confirmed before and after, unchanged by this session.

**Follow-ups, superseded by the slice 06 addendum below.**

---

## Slice 06, 2026-09-09

Read only, no AWS write of any kind. Poller schedule DISABLED, SO watermark UNSET, unchanged (this
slice never needed either -- W1c is the one thing in this thread that does, and it runs from the
RETEST plan, not here).

**TC2 written not run, TC1/TC3/TC4 BLOCKED, TC17 BLOCKED** -- all mostly a writing-down job against
R14's already-measured negative and the design gaps this plan already knew about. Nothing new in any
of those four beyond citing R14 and, for TC1/TC3/TC4, sharpening the blocker from "no fixture found"
to "silently dropped before reaching AWS at all" (Q35).

**TC1b is where this slice earned its keep.** The question was narrow: does the LLD's 25-character
`ShipTo` truncation live in the poller (TC1b stays blocked with the rest) or downstream (TC1b runs
off the synthetic harness, no wholesale order needed -- P2). Neither monorepo nor build access exists
for this epic (Q10), but a different avenue does: both functions are already deployed, and
`aws lambda get-function` hands back a pre-signed URL to the exact code package currently running in
staging, under credentials this plan already holds. Downloaded and grepped
`staging-orders-cin7-so-poller` and `staging-shipping-manhattan-send-shipment`, deleted both
afterward.

**Settled cleanly: truncation lives entirely in the sender** (`SHIP_TO_MAX_LENGTH = 25`,
`truncateShipTo()`, called unconditionally from `serializeShipmentDownload`). P2 accepted, TC1b moves
to slice 04's territory.

**But the same read found `ShipTo` has exactly one construction site, and it never reads the
delivery company at all** -- `ShipTo: fullName(address)`, and `fullName` reads only
`firstName`/`lastName`, throwing if both are empty rather than falling back to a company name. The
schema already has a `company` field sitting right next to a comment acknowledging wholesale
addresses don't need a first name, and the poller already carries `deliveryCompany` through under
that exact field name -- nothing downstream ever reads it. **This means TC1b cannot pass as written
even once it is unblocked and even once a wholesale order exists**, independent of the fixture
problem entirely. Raised as **Q40**, `TRIED 1, CONFIRMED` by source read, no live test needed,
raisable with Kian. Full code excerpts in `results/06-wholesale-and-blocked.md` and the register
entry, not repeated a third time here.

**One documentation correction:** the slice's own instruction to update "both wholesale drift rows"
doesn't match reality -- `QA-DOC.md` and its pre-cleanup predecessor both only ever carried one.
Noted, not chased further.

See `results/06-wholesale-and-blocked.md` for full detail.

## Follow-ups, current as of slice 06

1. **Q30/Q31 to Kian.** Still the most consequential open item -- whether the poller would ever
   actually send a cancel for a picked-stage order, unmeasured by anything downstream injection can
   reach.
2. **Q40 to Kian, alongside Q35 and Q38.** The `ShipTo`/delivery-company gap found this slice.
3. **TC18 to dev.** The cancel handler's own defensive gap, slice 05.
4. **TC5's re-run, TC7's SCALE-UI read, TC6's rewording** -- all still open from the slice 04
   wrap-up, unchanged, still small.
5. **Slice 02 (TC22)** is the only case left NOT RUN on this ticket. Independent, read only, whenever.

## Environment, current as of slice 06

Poller schedule **DISABLED**, SO watermark **UNSET**, confirmed before and after slice 06 (unchanged
-- this slice made no AWS writes). Ten synthetic orders exist, `QASYN-01-TC12` through
`QASYN-10-TC16`, all registered, unchanged by this slice. The two standing side-effect entries in
`SYNTHETIC-REGISTER.md` (slice 03's DLQ poison message, slice 04's `lineItemId` poison messages) and
slice 05's TC18 purge are all unchanged. AWS SSO for `staging` needed a fresh browser login at the
start of this slice -- expected, expires between sessions, needs a human.

---

## Wrap-up, 2026-09-09

Slices 05 and 06 both ran since the last wrap-up. **23 cases: 15 PASS, 1 FAIL, 5 BLOCKED, 1 written
not run, 1 NOT RUN.** Every case now has a run, a written verdict or a recorded block except TC22.

`QA-DOC.md`, `STATE.md`, the register and `SYNTHETIC-REGISTER.md` were all already current when this
wrap-up started; the slices did their own bookkeeping properly. What follows is what the wrap-up
found on top of that.

### The finding of this wrap-up: Q30 is not a question for Kian

Slice 05 ran Q30's picked-stage arm, got a narrow negative, and correctly said it did not settle the
risk. It then recommended taking Q30 to Kian alongside Q31, and `STATE.md`'s own follow-up list
carried that recommendation forward as item 1.

**That recommendation is now premature, and this wrap-up withdraws it.** Q30's register entry names
the two routes that would settle it, and the first is a source read of the poller. That route was
unavailable when slice 05 wrote it. **Slice 06 made it available**, four hours later and for an
unrelated reason: it needed to know where the `ShipTo` truncation lived, found that
`aws lambda get-function` returns a pre-signed URL to the artifact running in staging, and promoted
the technique to `../../tools/inspect-lambda-code.sh`. It has already read this exact function's bundle.

So Q30 sits at `TRIED 2` with a named, open, cheap route that QA can run. **Written as slice 07.**
Q30's register state line was also stale: the header said `TRIED 1` while the body said `TRIED 2`.
Corrected.

Asking Kian to check something we can check ourselves in twenty minutes spends goodwill that TC18,
Q35, Q38 and Q40 will need.

---

## Slice 07, 2026-09-09

Read only. No emit, no watermark write, no schedule change, no Cin7 call. Reused
`inspect-lambda-code.sh` unchanged.

**Q30 closes NEGATIVE, and it took the code with it.** Traced the poller's own dispatch loop:
```
var ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"];
var TERMINAL_STAGE = "Dispatched";
```
`Fully Picked` and `Partially Picked` are both eligible in the currently deployed poller, matching
dev's stated intent exactly. An order sitting at either stage with its Cin7 status still `Approved`
classifies `"eligible"` and goes through the ordinary update path, never the cancel path
(`withdrawOrder`, which does exist and does build a genuine `CANCEL_ORDER` -- just not for this
input). **The specific risk this ticket has been carrying since 2026-09-01 does not exist in the
staging build this whole plan tests against.**

**Bigger than the ticket: Q31 is stale, not just Q30 unblocked.** The poller function read here
carries `LastModified 2026-09-03T01:10:45Z` -- the exact timestamp `results/01-deployment-gate.md`
already recorded for the 2026-09-03 deploy. Q31's own evidence (BUSY-1159 slice 11) ran 2026-09-02,
one day earlier. Q31's own entry, written 2026-09-01, already named "the build is in progress and
staging predates the change" as the leading explanation, before any of this existed to confirm it.
Both Q30 and Q31 updated and moved to Answered in `../BUSY-1065-OPEN-QUESTIONS.md`.

**This is the ticket's last sign-off blocker, cleared.** Nothing further gates AC5. See
`results/07-poller-cancel-emit-source-read.md` for the full trace, including why this does not
cleanly match either of the slice's two named outcomes (it is a real mechanism, correctly gated,
not "no mechanism exists" and not "the mechanism fires on disappearance").

### Where the ticket stands now

Every case has a run, a written verdict, or a recorded block, except TC22 (slice 02, independent,
whenever). Nothing left gates sign-off that this session's own tools can still move -- what remains
(TC17's design gap, TC1/TC1b/TC3/TC4's fixture wall, TC18 and Q40's defects) all need a person, not
another slice.

### What slice 05 and 06 actually established

**TC18 FAIL, and it is a real defect.** A `CANCEL_ORDER` for an order with no `ORDER` row makes the
cancel handler throw an uncaught error rather than no-op benignly. SQS retried it, and within 90
seconds it tripped `staging-orders-cin7-cancel-order-errors` from OK to ALARM, on a topic with a real
subscriber. JJ purged the stuck message mid-session. The shape is exactly what a real poller emits,
so a redriven or duplicate cancel arriving after the row was removed would do the same.

**TC15 PASS both halves, with a structural finding worth carrying.** The header-level SCALE cancel is
triggered by the shipment becoming *empty of items*, the same path a full line removal takes, not a
distinct order-cancel mechanism. Also MEASURED: the SCALE-facing `shipmentId` is the literal reference
string, which is what the 25-character ceiling in the marking rule actually protects.

**Q40, new, CONFIRMED by source read.** The deployed sender builds `ShipTo` from a person's name only
and never reads `address.company`, throwing if both name fields are empty. The poller does carry
`deliveryCompany` through, under the exact field name the sender's own schema already declares, and
nothing downstream reads it. **TC1b cannot pass as written even once a wholesale order exists**, which
is independent of the fixture problem entirely.

**P2 settled.** Truncation lives in the sender, not the poller, so TC1b needs no wholesale order. That
is now moot for running it, given Q40, but it is settled.

### Standing trap, second occurrence

`describe-log-streams` returned a stale stream list against
`staging-shipping-manhattan-send-shipment` again, omitting an invocation that had already run and
producing a false "no send" read. Second time on the same function. Use `filter-log-events` against
the log group directly. Carried into `KICKOFF.md`'s standing list.

### Environment

Poller schedule **DISABLED**, SO watermark **UNSET**, confirmed before and after both slices. Ten
synthetic orders, `QASYN-01-TC12` through `QASYN-10-TC16`, all registered. `QASYN-10-TC16` is still
`OPEN` and live in SCALE staging with `sourceStage: "Fully Picked"`. Side effects in shared
infrastructure are unchanged and listed in `SYNTHETIC-REGISTER.md`. AWS SSO expires between sessions.

---

## Slice 02, 2026-09-09 -- the last slice on this ticket

Read only. No Cin7 writes beyond a failed one (below), no watermark write, no config change.

**Widening the taxStatus survey did not run.** `survey-cin7-orders.sh --max-pages 16` hit `HTTP 429`
on its very first page. Retried across 4 more attempts spaced 20 seconds apart, each already retrying
once internally -- still `429` every time, well past what a per-second or per-minute throttle would
need to clear. Read as the shared 5000/day cap already spent by other traffic today (this plan's own
SO poller schedule stays disabled throughout). Not hammered further -- every attempt spends the same
shared budget, and more attempts do not help if the cap is genuinely exhausted.

**Found the authoritative value set a different way instead.** Cin7's own published API
documentation (`api.cin7.com/api/Help/ResourceModel?modelName=TaxStatus`) enumerates the `TaxStatus`
type directly: `Undefined`, `Incl`, `Excl`, `Exempt` -- **four values, not the three the 1000-order
sample had ever shown.** This is a read of Cin7's public API schema, not its live order data, so
unaffected by the rate limit and outside the "GET-only against production order data" constraint's
scope entirely.

**Then reused `inspect-lambda-code.sh` a third time, and it turned up the fix has already landed.**
The deployed poller's `deriveOrderMoneyContext` now explicitly maps `Exempt` (`headerTaxRate: 0`,
confirmed flowing through to `taxPaid: 0` downstream) -- **this directly contradicts the historical
finding this case was written against** (40 log lines, all `Exempt`, hard-erroring on 3 real orders).
That finding was correct for the poller build it measured; this is the same 2026-09-03 build slice 07
already dated, and nobody had checked this specific function's tax handling against it until now.
`Incl` and `Excl` are mapped too (unchanged, always were). **`Undefined` is the one value that still
falls to the generic hard-error-and-alert path**, with nothing in the code marking that as
deliberate -- never observed on a real order, plausibly rare-to-nonexistent by what it represents, but
not confirmed either way. Small, worth a one-line confirmation from Kian, not a blocker.

See `results/02-taxstatus-coverage.md` for the full trace.

### The ticket, end to end

Every one of BUSY-1160's 23 cases now has a run, a written verdict, or a recorded block. Nothing
left needs another slice. What remains is entirely other people's: Kian (Q35, Q38, Q40, and TC22's
`Undefined` value), Lachlan (TC17's rejection-classification gap), dev (TC18's uncaught error). Q29 is
BUSY-1158's, not this ticket's, and was listed here in error.
`QA-DOC.md`'s Sign-off section carries the current, complete picture.

---

## Final wrap-up, 2026-09-09

Slices 07 and 02 both ran. **Every one of the 23 cases now has a run, a written verdict or a recorded
block. 16 PASS, 1 FAIL, 5 BLOCKED, 1 written not run. No case is left that another slice could move.**

The slices did their own bookkeeping well; `QA-DOC.md`, `STATE.md` and the register were all current
when this wrap-up started. What follows is what the wrap-up added or corrected on top.

### Q30 closes negative, and the risk this ticket carried all week does not exist

Slice 07 read the deployed poller's own artifact. `ELIGIBLE_STAGES` is
`["New", "Processing", "Fully Picked", "Partially Picked"]`, matching dev's stated intent verbatim. A
picked-stage order classifies as `eligible` and routes to `updateOrder`, never to `withdrawOrder`.
**The specific risk Q30 named does not exist in the deployed build.**

The cancellation-inference mechanism itself is real and does fire, for genuine loss of eligibility: a
stage outside the list, or `status` moving off `APPROVED`, on an order already persisted. That is the
design working as `CLAUDE.md` describes, not a defect, and it was not what Q30 asked about.

**This vindicates the call made at the previous wrap-up.** Q30 was one step from going to Kian, on
slice 05's own recommendation. The route that settled it was a twenty-minute source read using a
script slice 06 had built hours earlier for an unrelated question.

### Q31's CONFIRMED result is stale, and this matters beyond this ticket

Slice 07's read is against `LastModified 2026-09-03T01:10:45Z`, identical to the timestamp slice 01
already recorded for the deploy this whole plan tests. **Q31's evidence, BUSY-1159 slice 11, ran
2026-09-02, one day earlier.** So Q31 measured the poller as it stood before BUSY-1160 shipped, and
the eligible-stages list found now is what shipped with it.

INFERRED rather than directly re-measured, since confirming it against a live Cin7 order needs a
poller cycle this plan's slices are built to avoid. But the timestamps line up exactly and the
register's own Q31 entry already named this as the leading explanation before slice 07 existed. Both
Q30 and Q31 updated in the register. **Whoever picks up BUSY-1159 should know Q31's status changed**,
since that ticket's own work rested on it.

### TC22, closed properly rather than by sample

Cin7's published API schema enumerates exactly four `taxStatus` values: `Undefined`, `Incl`, `Excl`,
`Exempt`. That is a coverage target from an authoritative source, not the three-value observation a
1000-order sample gave. A third use of `inspect-lambda-code.sh` then found the `Exempt` fix has
already landed in the deployed poller, contradicting the historical hard-error behaviour this case
was written against. **`Undefined` is the one residual**: unhandled, never observed on a real order,
and not marked deliberate in the code. A one-line confirmation from Kian, not a blocker.

Slice 02 also hit the shared Cin7 daily cap (`HTTP 429`, 5,000/day, shared with the item master and
purchase order feeds) and correctly stopped rather than retrying into it. The widened survey never
ran and did not need to.

### Correction made at this wrap-up

`Q29` was listed in this file's own follow-up list and in `QA-DOC.md`'s sign-off as something left
for Kian on this ticket. **It is BUSY-1158's**, its evidence is that ticket's slice 03 TC7, and it
concerns a different function entirely. Removed from both.

### Where this leaves the ticket

Not signable, and nothing QA can do changes that. What remains is a design gap (TC17 has no defined
pass), a fixture that cannot be made (AC1's cases, and Q40 means TC1b could not pass even if it
could), a defect for dev (TC18), and small confirmations for Kian. **No open risk remains that
another slice could move.**

### Environment, final

Poller schedule **DISABLED**, SO watermark **UNSET**, confirmed at the end of every slice. Ten
synthetic orders, `QASYN-01-TC12` through `QASYN-10-TC16`, all registered. `QASYN-10-TC16` is still
`OPEN` and live in SCALE staging with `sourceStage: "Fully Picked"`. Side effects in shared
infrastructure are listed in `SYNTHETIC-REGISTER.md`. Clearing any of it is JJ's call.

---

## Slice 08 written, 2026-09-09. Three blocked verdicts reopened

JJ challenged three cases recorded as blocked. Two of the three challenges are correct and the
verdicts were reached too early.

**TC18's form was a layer short.** What ran emitted a cancel for a reference with no `ORDER` row at
all, which measures the orders-side handler with nothing to cancel. TC18 asks about a DELETE reaching
SCALE for a shipment SCALE never held. Two further forms are constructible: a duplicate cancel
against `QASYN-09-TC15`, already cancelled, and an order whose shipment never reached SCALE, which
slice 04's `lineItemId` finding shows how to build deliberately. The FAIL stands either way; these
determine whether it is broad or narrow.

**AC1's downstream half is testable and was written off.** The reasoning that a synthetic emit
carries `orderType` and therefore proves only the downstream half is correct, but it was allowed to
become "AC1 is untestable". Q40's defect lives in exactly that downstream half. A synthetic WHOLESALE
payload with a `deliveryCompany` demonstrates AC1 failing at runtime rather than by code read, and
settles TC2's drift row empirically for the first time. Only TC4, contact-group resolution, is
genuinely upstream. Not a repeat of the BUSY-1260 C5 error: a wholesale order is a designed-for
input, not a malformed one.

**TC17 is partly reachable, though not the half expected.** The wave still cannot be produced. But
the blocker that actually stops the case is that nothing defines a retryable rejection against a
permanent one, and that is readable in the sender's own code. It gives TC17 a defined pass and turns
Lachlan's question into a confirmation.

**Also folded in: Q38 is already answered by evidence in hand.** Slice 07 captured the poller's
dispatch loop for a different question. `Dispatched` returns `skip-terminal` and hits `continue`
before `skippedStages` exists; `Approved` returns `skip-counted` and is counted. That is the "separate
earlier code path" Q38 named as one of its two candidates, and it also explains why
`skippedLocallyTerminal` read zero, since that counter lives inside `updateOrder`, which those orders
never reach. Confirm once against the bundle, then close it.

Slice 08 covers all of it, ordered cheapest first, stoppable after any part. Part 1 is read only and
carries most of the value for shortening what goes to dev.

---

## Slice 08, 2026-09-09, ran in full except Part 4 (Part 1c made it unnecessary)

Parts 1 and 4 read only, as planned. Parts 2 and 3 emitted, reaching Manhattan SCALE staging. Poller
schedule DISABLED, SO watermark UNSET throughout. AWS SSO needed a fresh login at the start.

**Part 1a: Q38 confirmed against the bundle directly, not just the captured excerpt.** `Dispatched`
returns `skip-terminal` and hits `continue` before `skippedStages` exists in the loop; `Approved` (or
any non-eligible, non-`Dispatched` stage) returns `skip-counted` and is counted. Two genuinely
different branches. `TRIED 3, CONFIRMED`, closed. One design question left for Kian.

**Part 1b changed the shape of the rest of the slice.** The question was "does the poller reject
wholesale outright". It doesn't -- `isOutboundOrderType` routes WHOLESALE/RTV through a **complete,
dedicated `CREATE_OUTBOUND_ORDER` pipeline**, traced hop by hop to real, substantial, deployed
functions: `staging-orders-v2-create-transaction` (schema explicitly lists the outbound events,
comment `// CTC outbound shipments (WHOLESALE / RTV sales orders)`) -> `staging-orders-cin7-create-
outbound-order` (persists `ORDER`/`ITEM#<id>#<size>` in `staging-orders-v2`) -> `staging-shipping-
inbound-outbound-order-bridge` -> **`staging-shipping-manhattan-send-outbound-shipment`, a dedicated
Manhattan sender that does not exist for the native/ECOM path.** Every function's `LastModified` sits
in `2026-09-09T01:19-01:39Z` -- deployed within the two hours before this check, which is why R11
(2026-09-07) and R14 (2026-09-08) both correctly found no outbound infrastructure at all. Nothing was
wrong with those measurements; the account changed underneath them.

**Part 1c gave TC17 a defined pass.** Source read of `send-shipment`: a rejection IS classified
`"rejected"` and logged/alerted as permanent, exactly AC5's want. One nuance for Lachlan: the
classification only changes logging, not retry count -- every failure still retries the same way
before the DLQ.

**Part 2 found and fixed a harness bug, then got a clean, narrowing result.** Self-revising an
already-cancelled order copied its local `status: CANCELLED` into `itemChanges.added[].status`, a
value the schema never accepts. Fixed (`emit-synthetic-revision.sh`, maps `CANCELLED` -> `OPEN`).
The fixed re-emit was queued behind the original bad message in the same FIFO group; confirmed
resolved by end of session: `SalesOrderAlreadyCancelled`, clean, no throw, no alarm. **TC18's Form A
bug is specific to a missing `ORDER` row, not to cancel handling generally.** Form C not run, small
follow-up.

**Part 3 built `emit-synthetic-outbound-order.sh` and proved Part 1b's pipeline at runtime.** Two
emits: `QASYN-12-TC2` (WHOLESALE, multi-size) persisted correctly (`ITEM#<id>#M`/`#L`, one row per
size with its own quantity -- **TC3 PASS**; `ORDER`/`SHIPMENT` rows in the same tables ECOM uses,
under a dedicated handler chain -- **TC2 PASS, both drift readings partially right**) and reached
Manhattan, where it was **rejected**: `Invalid warehouse "CTC-WH"` -- exactly what the poller's own
`WAREHOUSE_BY_BRANCH_ID` lookup produces for the wholesale branch. **New defect, Q41**, real, not a
harness artefact. `QASYN-13-TC2RTV`, identical construction but the known-valid main-warehouse code,
was **accepted by Manhattan in full**, isolating the rejection to the warehouse code specifically.
Its own sender log: `Truncating Customer.ShipTo to 25 characters: "Cheap Thrills Returns
Warehouse"` -- **TC1b PASS, and this reverses Q40**: `ShipTo` is built from the delivery company,
correctly, in a sender Q40 never examined, because a real wholesale order never reaches the one Q40
did read.

**Net effect on the open-questions register**: Q38 closed. Q35's headline is unchanged (still needs
Kian and W1c) but its "the outbound family is unbuilt, full stop" line is corrected -- it now exists.
Q40 corrected from "confirmed defect" to "wrong function, no defect there." Q41 opened, the sharpest,
most consequential finding of the day: one real, narrow, well-isolated Manhattan configuration gap
stands between "the wholesale pipeline works" and "a real wholesale order gets through."

See `results/08-final-sweep-before-dev.md` for full detail, every code excerpt, and every log line
this summary compresses.

---

## RETEST-POST-1161, 2026-09-09. A second, unrelated redeploy touched every function this ticket rests on

A separate plan folder, `../retests/RETEST-POST-1161/`, exists because Kian deployed BUSY-1161 on 2026-09-09
and, in fixing it, redeployed the entire orders/shipping monorepo -- every function this ticket's
verdicts were measured against, native and outbound alike, got a new `LastModified`/`CodeSha256`
within one 01:xx-01:44 UTC window. **This ticket's own STATE.md said "nothing left needs another
slice" above; that call was correct for the 2026-09-03 build and is not overturned, but every verdict
resting on that build needed re-confirming against the new one before being trusted going forward.**

**RETEST-POST-1161 R0 (read only):** confirmed the redeploy is not the scoped fix Kian described --
`staging-orders-cin7-so-poller`, `staging-orders-cin7-update-order`, `staging-orders-cin7-cancel-order`,
the shared `staging-orders-v2-create-transaction`, and the entire outbound chain all changed. Direct
source reads found the shared handler changed only by addition (no native field stopped being
passed through, the version guard is unchanged, all five named attribution metrics are still present
verbatim) and confirmed Kian's warehouse claim (**Q41 closed**: `WAREHOUSE_BY_BRANCH_ID` is gone
entirely, replaced by one unconditional `CTC_WAREHOUSE = "CTC-QDC"` constant). It flagged TC1b/TC2/TC3
as the verdicts most likely to be stale (the whole outbound chain redeployed) and flagged two
environment items for explicit go-ahead before emitting: the `so-poller-stalled` alarm (explained,
predates this deploy) and a Manhattan-sender queue anomaly (1 message in-flight, no log activity in
12+ hours, cause unknown). Full detail: `../retests/RETEST-POST-1161/results/R0-build-identification.md`.

**RETEST-POST-1161 R1, all four parts now complete, across two sessions.** JJ gave explicit go-ahead
past R0's two flagged items before the first session's emits.

* **Part 1 (read only):** Q30/Q31's `ELIGIBLE_STAGES` finding, TC17's rejection classification, TC22's
  `Exempt`-mapped/`Undefined`-unhandled finding, and TC18 Form A's uncaught-error bug **all reproduce
  identically against the redeployed bundles.** No behaviour changed for any of the four.
* **Part 2 (emits):** re-ran the outbound chain with two fresh synthetic orders. **`QASYN-14-TC2WH`
  is Q41's runtime confirmation**, not just a source read: the exact WHOLESALE payload that Manhattan
  rejected pre-fix (`QASYN-12-TC2`, `CTC-WH`) now succeeds end to end when only the warehouse code is
  corrected to `CTC-QDC`, isolating the fix to that one variable. `QASYN-15-TC1B` reconfirmed TC1b's
  25-character truncation against the redeployed dedicated outbound sender. **TC1b, TC2, TC3 all
  PASS, reconfirmed against the new build.**
* **Part 3 (emits, native reconciliation), second session.** The first attempt stopped correctly at
  the Manhattan-sender anomaly (`0 waiting, 1 in-flight`, no activity in `send-shipment`'s log group).
  JJ amended the gate: characterise the message with four specific read-only checks (event source
  mapping, `ApproximateAgeOfOldestMessage`, received/deleted metrics, redrive policy), then proceed
  under a named outcome. **The anomaly turned out to be fully explained and unrelated to this
  redeploy**: the queue's actual consumer (`lambda:list-event-source-mappings` by queue ARN, not
  function name) is `staging-shipping-manhattan-manhattan-eda-queue-handler`, not `send-shipment` --
  the wrong log group had been checked twice, by R0 and by this slice's first attempt. The stuck
  message is `QASYN-12-TC2`, BUSY-1160 slice 08's own already-registered poison message
  (`Invalid warehouse "CTC-WH"`, pre-Q41-fix), retrying every ~25 minutes toward its own DLQ exactly as
  predicted, in its own FIFO message group. Proceeded: fresh order `QASYN-16-TC12B` ran a TC12-style
  version-guard triple (all three sub-cases clean against the redeployed `update-order`) then a cancel
  (clean against the redeployed `cancel-order` and `send-shipment`, header reached SCALE on the literal
  reference, order flipped not deleted). **TC12 and TC15 both reconfirmed at runtime.**
* **Part 4 (read only):** BUSY-1158's TC4b guard, in `staging-shipping-v2-dc-packing-shipment-create`
  (which redeployed today, unexpectedly for a "scoped outbound fix"), reads byte-identical in the new
  bundle. Reconfirmed by source read; no live post-redeploy invocation occurred to also confirm it at
  runtime.

Full detail, every log line and code excerpt: `../retests/RETEST-POST-1161/results/R1-targeted-retest.md`.

**What this changes on this ticket's own doc:** `QA-DOC.md`'s TC1b, TC2, TC3, TC12, TC15, TC18, TC22
rows now cite the 2026-09-09 redeploy in addition to their original evidence -- same verdicts, fresher
citations, TC12 and TC15 now runtime-confirmed rather than source-read-only. `SYNTHETIC-REGISTER.md`
gained seq 14, 15 and 16, plus a side-effects-table correction on the sender-queue routing. Q30, Q31
and Q41 updated in `../BUSY-1065-OPEN-QUESTIONS.md` (first session, unchanged by the second).

**Nothing outstanding.** All four parts of R1 are complete, every case in its scope reconfirmed against
the 2026-09-09 build. Nothing on this ticket needs a further RETEST-POST-1161 session.

---

## TC18 deferred to BUSY-1162, 2026-09-09, JJ's call

JJ's decision, after reading the drafted message for Kian: **dev is rolling the cancel-handler fix
into BUSY-1162, so TC18 is deferred rather than raised as BUSY-1160 work.** Read as referring to the
cancel handler's uncaught throw, which was the only fix in that message; the TC17
retry-versus-permanent nuance is a design question for Lachlan and was already carried as D5, so it
is untouched.

Recorded in three places:

* `../DEFERRED-TEST-CASES.md`, new **D18** under the BUSY-1162 section. Carries the evidence
  already held (`QASYN-08-TC18` slice 05, Form B narrowing from slice 08, the redeployed-bundle
  source read from RETEST-POST-1161 R1 Part 1), the reason it belongs to that ticket rather than a
  functional one (no named failure metric on the branch at all, so the only signal is a stack trace
  and an unattributed alarm), and the wrong version of the case to write, which is "an unknown cancel
  does not crash the lambda". A handled error that still rethrows passes that wording while leaving
  the alarm and the 8 hours of retries in place. Form C is noted as constructible and never run.
* `QA-DOC.md`: the TC18 row, the TC18 blockers bullet, the BUSY-1162 out-of-scope bullet, and the
  sign-off's FAIL paragraph. **The verdict stays FAIL**, since it is measured and reproducible, and
  the deferral is recorded beside it rather than replacing it. TC18 is no longer on the list of things
  waiting on Kian.
* **Confluence page 1929052164, version 14.**

D5 also updated in the same pass with slice 08's narrowing, which it predates: the classification half
of the taxonomy is already built and only the consequence is missing, so the question for that ticket
is narrower than "define the taxonomy".

**Nothing on this ticket needs another QA slice.** What remains is TC17 (needs a waved shipment),
AC1's upstream half and TC4 (need a real Cin7 wholesale order), TC6 and the AC2/AC3 limb (with
Lachlan), and Q35, Q38 and TC22's `Undefined` (with Kian).

---

## Final wrap-up, 2026-09-09. Kian's answers recorded, four drift items fixed

No testing this session. This is the wrap-up pass, and it found one class of drift worth naming: **the
answers Kian gave on 2026-09-09 had been acted on in conversation and never written into the
register.** Four questions were pasted to him, he answered all four, and only the warehouse one (Q41)
reached a file. So the register still listed two of them as open for Kian, and this ticket's own
sign-off still listed three items as waiting on him. That is the same error class as writing a status
doc from recall, just in the other direction: the files lagged the conversation.

Recorded now, all in `../BUSY-1065-OPEN-QUESTIONS.md`:

* **Q35's design half, ANSWERED.** "Wholesale and RTV land in the ticket I just deployed 1161. The
  tickets not being updated is probs what has claude freaking out." Checked against the files rather
  than taken on trust: it agrees with slice 08's independent trace of a dedicated outbound chain and
  with R1's runtime confirmation. **Q35's other half is untouched and is a data question**, does Cin7
  ever return a wholesale order at an eligible stage. That is what TC1's upstream half and TC4 wait
  on, and W1c would answer it, which is JJ's call because it needs production credentials.
* **Q38's remaining design question, ANSWERED.** "I'll investigate and fix that up in this
  observability work if it's still the case." That is BUSY-1162, so terminal-stage orders being
  excluded from `skippedStages` is not deliberate. Now **D19** in `../DEFERRED-TEST-CASES.md` as a
  re-test condition, with the wrong version of the case named.
* **Q42, new, and answered in the same breath.** TC22's `Undefined` residual item had been carried
  since 2026-08-28 with no Q number, which is why it kept reading as an open item with no state. Kian
  searched Cin7 and found the value on no order either, so two independent sweeps agree, and JJ's call
  is that it is not an issue.
* **C6, a correction to raise.** BUSY-1160's own AC1 text says wholesale rides the same records and
  sender as ECOM. Dev has moved wholesale to BUSY-1161 and says the tickets were never updated. The
  next person reading this ticket would otherwise test it against a design that no longer holds.

**Effect on this doc.** TC1, TC4 and TC22's rows and the sign-off now record dev's ownership statement
and JJ's call to defer AC1's pass or fail to BUSY-1161. **No verdict changed.** The measurements stand;
what changed is who owns the fixture that would move them. `QA-DOC.md` pushed to Confluence page
1929052164 as version 15.

**Nothing is open with Kian on this ticket.** Lachlan holds the AC2/AC3 quantity limb and TC17's
retry-versus-permanent nuance (D5). Everything else is deferred with an owner or blocked on a fixture
nobody here can produce.

### Drift checked and clean

Slices 01 to 08 all have result files. 23 case rows, and the sign-off's tally (18 PASS, 1 FAIL, 3
BLOCKED, 1 not runnable as written) re-derives from the table. Every BLOCKED row names what it waits
on. Local `QA-DOC.md` matches the Confluence page apart from markdown table-separator normalisation,
which is expected.

### One item the sign-off had been overclaiming

The sign-off said nothing on this ticket needs another QA slice. **TC5's SCALE half contradicts that.**
Its add-line emit was retracted in slice 04 because the harness built a non-numeric `lineItemId` and
the sender correctly refuses those; the harness was fixed in the same slice and the emit was never
re-run. So the row reads `PASS on insert/untouched; SCALE half UNKNOWN` and one emit under the fixed
harness would close it. AC2 does not depend on it, so it is JJ's call rather than a gate, but it is
runnable work and the doc now says so.
