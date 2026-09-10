# RETEST-1158-1159 state

Date: 2026-09-04

## Results so far

| Slice | Date | Outcome | Notes |
|-------|------|---------|-------|
| R0 | 2026-09-04 | PASS (gate), one flag for JJ | BUSY-1160 plus fixes confirmed deployed (Gate A: update/create-transaction and cancel-order handler families exist, all last-modified 2026-09-03. Gate B: 24-row build table in results/R0-build-identification.md, six named targets unchanged, everything else changed). Poller DISABLED, watermark `2026-08-28T01:35:45.769Z`, both unchanged (Gate C). **Flag for JJ, not a hard stop:** the stage-5 Manhattan-sender DLQ that held the three known parked references (`261070`, `261073`, `261089`) is now empty, drained since the last BUSY-1159 session - TC9/TC15 re-runs need fresh evidence, not the existing DLQ state. **Gate D: the CTC split named in Q27's dev answer has NOT landed.** `faulty-sale-worker-queue-handler` is unchanged since 2026-03-04, same unconditional `TRANS_CREATE_ORDER` rule, no origin/company filter, no intermediate lambda. R1 against this consumer tests the pre-1160 shape. See `results/R0-build-identification.md` for the full table and both DLQ reads. |
| R5 | 2026-09-04 | INCONCLUSIVE, flag for JJ | Fixture existed today only: `1065881Sep26` (`Fully Picked`, wholesale). Controlled single-cycle measurement (narrow watermark window, one manual poller invoke, watermark restored to `2026-08-28T01:35:45.769Z` at teardown, poller left DISABLED). Result matches neither of the two outcomes Q31 was watching for: `skippedStages` came back completely empty (not the `{'Fully Picked': 1}` slice 11 measured, and the target was not sent either). A second wholesale order swept into the same cycle (`UQLD160-3711A`, `Dispatched`) also vanished with zero counter entry and zero log line. Every ECOM order in the same cycle (6 of them) was fully accounted for (5 created, 1 named hard-error). **Both silently-missing orders are wholesale; this looks like a wholesale-side exclusion, not the stage gate the slice set out to re-measure.** Q31 does not close. TC14's ECOM fixture half stays blocked, unrelated. See `results/R5-eligibility-gate.md`. |
| R4 | 2026-09-04 | PASS on TC1/TC1b(corrected)/TC8/TC16/TC11/TC10/TC18(our side); TC6 re-confirmed on old fixture only; **TC9/TC15 NOT RE-VERIFIED** | Found 4 fresh unprocessed ECOM orders (`261842`, `261843`, `261844`, `WOR19169A`), none previously touched. Narrow watermark window checked for blast radius (4 orders) before enabling the schedule at `02:47:05Z`; one scheduled cycle (no manual invoke) completed `02:48:02.509Z`, all 4 created cleanly, `skippedStages={}`; schedule disabled `02:48:26Z` (81s window); watermark restored to `2026-08-28T01:35:45.769Z` at teardown. All 4 reached SCALE (`wmsSentAt` set). **TC1b's raw modified-to-sent gap reads as a 24-minute FAIL but is an artefact of the orders' pre-existing dwell time with the schedule disabled, not send-path latency** - the real signal, cycle-complete-to-`wmsSentAt`, is 37-46 seconds across all 4, matching the prior 73s baseline. TC8/TC16 row counts and MessageGroupId=orderId confirmed clean. TC11 bus-isolation depths unchanged before/after. TC10 freshly re-verified (`WOR19169A` is Worship-branded, `packingBrandMisses=0`). TC6 could not be re-run fresh (none of the 4 had a repeated option code); the existing `WOR19261` fixture still shows the right shape but predates the 2026-09-03 deploy, so TC6 is not proven under the changed code yet. TC18 our-side half PASS (`261106` field lengths, no values printed); SCALE half is R6's. **TC9/TC15 not attempted**, per the slice's own instruction that a fresh DLQ rejection is JJ's to find or create, not manufactured this session. `shipmentId` field found on the shipment header row (`staging-shipments`), gives R6 a direct lookup instead of searching by `cin7Id`. See `results/R4-create-path-regression.md`. |
| R1 | 2026-09-04 | TC4f FAIL (expected, per R0 Gate D); TC4c PASS; TC4d INCONCLUSIVE; write-side UNKNOWN | Read-only, independent, ran after R4. Q27 half 1 (split exists) already false per R0. Q27 half 2 ("cannot execute, fields absent"): the queue-handler synchronously invokes a named downstream worker (`staging-inventory-check-order-faulty-sale`, an inventory-service function) for every message including CTC, gets `StatusCode 200` back both times. No bail line, no error, in either log group for either reference (`261115`, `WOR19261`). Duration for both CTC invocations (144-275ms, both warm) is well above the warm non-CTC baseline (15-36ms) - INFERRED (not MEASURED) as more consistent with running further than an instant bail. **Write side:** `staging-inventory-bus` catch-all log confirms MEASURED zero events in tight windows around both CTC invocations (pipeline itself confirmed live via a wider-window check). `staging-inventory-v2` table check is **UNKNOWN, not a negative**: its key schema (`sku`+`store`) uses formats (numeric SKU IDs, `ABS#n` store codes) that don't match Cin7's SKU/branch identifiers, so no query could be constructed that actually tests presence or absence - flagged as a real gap, not resolved. TC4c re-confirms R0's subscriber set plus the `cancel-order` family, nothing new. TC4d still no guard line and no `pickslipUrl` on the shipment header, same standoff as before, code changed under it regardless. Audit item 8 (`orders-dn-rec-eda-queue-handler`): confirmed never invoked in either window. **One process note:** a mid-session `cut -c` truncation mistake briefly printed unredacted customer data to this session's own tool output (not written to any file); corrected immediately, flagged as a tooling issue via feedback, not a system finding. See `results/R1-faulty-sale-worker-ground-truth.md`. |

| R9 | 2026-09-04 | Built, check 1 HIT (69/70), check 3/4/5 hit but PAST, check 2 clean | `scripts/watch-for-fixtures.sh` built and run. **Check 1: 69 of 70 already-sent CTC references now show a later Cin7 `modifiedDate` than what we stored**, including three of R4's own four orders (`261842`, `261843`, `261844`, all now `Dispatched`; `WOR19169A` correctly excluded, still `Processing`, genuinely unrevised). Spot-checked one (`261115`) for content: same two SKUs, same count, no line/qty/address diff - **this is a stage progression (Processing to Dispatched), not a content edit**, so check 1 unblocks R3's actual scope (TC3, TC21, TC21b) but does not yet prove a TC4-shaped fixture. TC4 and the version guard's discriminating half stay parked. Check 2 (cancelled/voided): 0. Checks 3/4/5 each found a real candidate (`#261755` repeated option code, `#261779` carries the known-absent `TH25-318B-28`, one 39-character reference) but all are already `Dispatched`, tagged `[PAST]` - past the stage window the poller can create from, not usable today. Also confirmed independently: zero CTC shipments in `staging-shipments` are allocated to store `51908`, corroborating R5/R8 that wholesale orders never reach this table. Also established: Cin7's `reference` filter needs a literal `#` prefix for every reference shape, not just numeric ones. See `results/R9-fixture-watcher.md`. |

| R8 | 2026-09-04 | STOPPED before Gate B, blast radius | Gate A found a wholesale order at an eligible stage: `MAPY004700-9377779363539B` (`New`, branch 51908, `THE ICONIC`, contact group `Retailer - Majors`, confirmed WHOLESALE). But it has sat unrevised for ~24 hours, and the only ECOM control available is today's traffic - bounding a window from just before this order to now, counted directly before committing anything, is **223 orders across both CTC branches**, 30-50x every window run so far this pass (R4: 4-8, R5: 6-8). **Stopped before Gate B**, per the root `CLAUDE.md`'s "blast radius wider than the slice assumed" condition, not Gate A's own "no fixture" condition - a fixture exists, it just cannot be reached without an unacceptably wide sweep given how stale it is. No watermark write, no invoke. R5's confound (wholesale and already-excluded-stage perfectly correlated) stays unresolved. **Recommend a sixth check on `watch-for-fixtures.sh`: a wholesale order at `New`/`Processing` caught within an hour or two of entering that stage**, paired with a same-window ECOM control - not built yet, needs the user's steer first. See `results/R8-wholesale-exclusion.md`. |

| R3 | 2026-09-04 | STOPPED before any case, blast radius | Baseline captured for all four R4 orders (1 transaction row, 4 order rows, 4 shipment rows, `wmsSentAt` set, each). **Between R9 finishing and this slice starting (~11 minutes), a large dispatch batch moved roughly 90-100 orders through Cin7** (`03:25:06Z` to `03:26:29Z`, one tight burst). Three of the four targets (`261842`, `261843`, `261844`) now sit inside that burst; the fourth (`WOR19169A`, the one Worship-branded order of the four) still has not moved at all, over 90 minutes after creation - INFERRED, not confirmed, that the brand difference may be why it wasn't swept into whatever just dispatched the other three. **No watermark placement captures all four targets without also sweeping the ~100-order burst**, and since the poller schedule has been off, none of those ~100 have ever been polled - a window that wide would be a mass first-time CREATE, not an update-guard check. Stopped, per the slice's own listed condition ("the poller's actual window sweeps in references beyond the four"). No watermark write, no invoke, no schedule change. **Two slices in a row (R8, then R3) have now stopped for a blast-radius reason within 15 minutes of each other** - flagged as a pattern, not just two one-offs. See `results/R3-update-semantics-no-cin7-write.md`. |

| R2 | 2026-09-04 | STOPPED at precondition gate | `list-ctc-shipment-states.sh` (full table scan, 178,975 rows): all **79** CTC shipment headers still `OPEN` (was 70 at slice 04, grown from this pass's own sends, distribution unchanged: 100% `OPEN`). Per the slice's own instruction, stops here, TC4e stays BLOCKED, unchanged since slice 04. **Documentation inconsistency found and flagged, not fixed**: the slice file itself still says "Depends on: R3, do not run before R3 has produced a change," while `KICKOFF.md`'s revision says the opposite (R2 independent, "any route off OPEN will do"). Moot this run since R3 didn't move anything either way, but the slice file should be updated to match `KICKOFF.md` before the next handoff. See `results/R2-lifecycle-gated-consumers.md`. |

| R10 | 2026-09-04 | Gate A: location returned, flagged for JJ. Gate B: NO working upper bound. Gate C: not a single daily batch | **Gate A**: `staging-orders-cin7-so-poller`'s deployed code IS downloadable (presigned S3 URL, ~386KB artifact). Not downloaded, not read - JJ's decision, flagged. **Gate B, the load-bearing answer**: four payload spellings tried against live invokes (`modifiedBefore`, `modifiedTo`, `until`, combined `modifiedSince`+`modifiedBefore`), **every one ignored** - the fetch window is always `[watermark minus 5 min, invoke time]`, ordersFetched=0 on all four probes, no side effects. **Staleness and blast radius are confirmed structurally identical for this handler; no cheap path exists to reach an already-stale fixture.** R3's four orders, R8's `THE ICONIC` order, and every `[PAST]`-tagged R9 candidate stay unreachable. **Gate C**: the "single daily batch" premise is wrong. 1,617 orders over ~4.5 days show a clean daily active/quiet cycle (active ~UTC 21:00-06:00, ~AEST business hours; ~15 hours/day otherwise near-zero activity), but *within* the active window there are 22 distinct elevated-volume events (10-455 orders each), spaced 12-136 minutes apart (median 40) - **no reliable safe gap exists within the active window**, only the daily quiet period itself is genuinely clear. **This corrects the "wait for traffic to settle" line below**: waiting does not help reach an already-stale target (it only gets further away), though it does help for fresh, no-fixture-dependent probes. Findings written to `../../BUSY-1159/TOOL-NOTES.md` since they constrain every future watermark-touching case on this poller. See `results/R10-reachability.md`. |

## Next

**R10 answered the open question from the last round: no, waiting will not help reach R3's or R8's
existing targets, and there is no cheap technical fix (no payload override works).** The three
practical paths forward, per R10's recommendation: (1) ask Kian directly whether an upper-bound
mechanism exists under some other name; (2) get JJ's decision on Gate A's code-readability question,
which could settle several other INCONCLUSIVE/UNKNOWN findings too (BUSY-1158 TC1b, TC7, TC7b, Q27's
write side, the 1160 version guard's real behaviour, R5's wholesale-drop mechanism); (3) stop trying to
reach R3/R8's stale targets and focus on catching a **fresh** fixture early in a business-hours window
small enough to be safe, which is what R9 rev 2 (per `KICKOFF.md`) is designed to support with its new
reachability classification per candidate.

R6 and R7 are not IDE sessions.

Open decisions for the user, none actioned unilaterally:

1. **R8's wholesale question**: build a sixth fixture-watcher check for a freshly-eligible wholesale
   order (paired with a same-window ECOM control), or accept a wider-blast-radius window deliberately
   with sign-off.
2. **R3's four orders and R8's `THE ICONIC` order are not recoverable** (R10 confirmed no upper-bound
   override exists). TC3, TC21, TC21b, TC4, the version guard's discriminating half, TC6, TC9 and TC15
   all now depend on catching a **fresh** occurrence early, within a small, live-counted window during
   the active period - not on re-attempting these specific stale targets with a cleverer window.
3. **`R2-lifecycle-gated-consumers.md`'s stale "Depends on: R3" header** should be corrected to match
   `KICKOFF.md`'s revision before the next session reads only that slice file.
4. **Gate A's code-readability finding** (the deployed poller artifact is downloadable, ~386KB, not
   opened) needs JJ's decision: read it (which could settle several other stuck questions - BUSY-1158
   TC1b/TC7/TC7b, Q27's write side, the 1160 version guard, R5's wholesale-drop mechanism) or leave QA
   black-box as designed.

**Hard constraint, still governing everything above: nobody writes to Cin7, ever, not JJ either.** It
is CTC's live production system and stays read-only, full stop. See `CLAUDE.md`'s "Cin7 is never
written to, by anyone" section. Every stalled case above depends on a naturally occurring fixture,
caught early - re-check opportunistically (cheap, read-only, per R9/R9 rev 2) rather than treating any
of this as a queue item pending a person.

R5's wholesale-silent-drop finding is unresolved and flagged for JJ/Kian, did not recur in R4 (all 4
of R4's fresh orders were ECOM and all sent cleanly).

## 2026-09-07, desk findings and the next slice

Nothing was run against AWS. Two desk checks and one doc change.

**Next slice is R11**, `slices/R11-pre-kian-confirmation.md`, kickoff in `KICKOFF.md`. Six gates, B0
then A to E, all read only, no watermark and no invoke. It exists because four findings are queued for
Kian and three of them rest on one cycle, two invocations or an unmeasured premise.

**LLD 1802698758, checked directly.** No order-type exclusion exists at any poller gate. The Cin7
query filters `branchId IN (51908, 51909)` at step 2, so wholesale orders are fetched on purpose; step
3 classifies contact group and skips only `Retail - Shop`, "skipped and counted"; step 4 is the
eligibility stage check. Section 7 names the counters the poller must emit. **R5's uncounted
disappearance therefore fails the LLD's own principle**, and the "designed exclusion" reading is
closed.

**But R5 may have looked in the wrong place.** Section 9.3: WHOLESALE, RTV and STORE_PICK never emit
native domain events, they go straight to the outbound family. `inspect-ctc-order.sh` checks native
rows and the shipment header only. R11 Gate B0 checks the outbound family for `1065881Sep26` and
`UQLD160-3711A` before the finding goes anywhere near Kian.

**TC14 is probably deferred, not blocked.** The LLD has both picked stages eligible for all order
types and says they exist in the set because the confirmation leg writes them into Cin7 on first pick.
That leg is not built. So no ECOM order can currently be at a picked stage, which explains nine
fruitless searches. INFERRED, needs one confirmation.

**Jira.** No ticket covers the CTC split Kian described on 2026-08-31. BUSY-1164, "Consumer guards:
CTC fulfilment events must not trigger UNI machinery", is in Review under Lachlan and describes a
guard inside the consumer, the opposite design. **BUSY-1160 is now in Review and assigned to JJ**, so
QA owns its verdict and its 23 cases are all still NOT RUN. BUSY-1161 and BUSY-1162 are In Progress on
Kian.

**Doc changes made.** The "width truncation is not redaction" rule is promoted from R3's slice file
into `CLAUDE.md`, per `FINDINGS-2026-09-04.md`. Open decision 3 above is already done: R2's slice
header was corrected on 2026-09-04 and now reads "nothing but its own precondition".

## 2026-09-07, R11 run

| Slice | Date | Outcome | Notes |
|-------|------|---------|-------|
| R11 | 2026-09-07 | Six gates run, all read only | **Gate B0: does NOT retire R5's wholesale finding, makes it stronger.** `staging-orders-v2` has zero rows for both wholesale references (re-confirmed, 3 days after R5); the LLD's outbound family is not deployed anywhere in the account (no lambda, no EventBridge rule, zero DynamoDB rows for any outbound-lifecycle status system-wide); and BUSY-1160 (JJ, Review) and BUSY-1161 (Kian, In Progress) contradict both the LLD and each other on where WHOLESALE belongs - BUSY-1160 says it rides the native family (already measured empty), BUSY-1161 scopes the outbound family to RTV only. New open question **Q35**, for Kian: which design is authoritative. **Gate A:** built `scripts/reconcile-poller-cycles.sh`, swept all 582 cycles in retained history (2026-08-27 to 2026-09-04). Residual is non-zero on 291 of 576 pre-deploy cycles and 1 of 6 post-deploy (R5's own, residual=1, matching R5's stated arithmetic exactly - not wrong). Reading: the counters have never fully balanced; this is not a new 2026-09-03 regression. **Gate B: UNRUNNABLE AS DESIGNED.** Built `scripts/gate-b-window-check.sh`, verified correct against a live window, but Cin7's `modifiedDate` is mutable current-state only - every historical cycle's order set (even R5's own, 3 days old) returns zero orders on replay because every order in it has been modified again since. The wholesale/stage confound stays UNKNOWN from this gate specifically (Gate B0 already established the drop is real regardless). **Gate C:** built `scripts/skipped-stages-timeline.sh`. Last non-empty `skippedStages` occurrence is 2026-09-02, before the deploy; zero on all 6 post-deploy cycles including R5's, which contained a genuine `Fully Picked` order. Q31 splits into a MEASURED counter regression and an UNKNOWN eligibility-set question. **Gate D1:** built `scripts/faulty-sale-worker-duration-distribution.sh` (one regex bug found and fixed for cold-start detection, documented in the script). n=32 warm CTC vs n=129 warm non-CTC: CTC median (3.49ms) is *below* non-CTC median (27.02ms), reversing R1's INFERRED claim from n=2. **Gate D2:** CloudWatch `ConsumedWriteCapacityUnits` on `staging-inventory-v2` is MEASURED zero at both of R1's known CTC invocation windows, closing Q27's write side. **Gate D3:** customer PII field names (presence only, no values) confirmed still present as of the most recent CTC invocation (261844, 2026-09-04), not just historically. **Gate E:** built `scripts/dispatch-batch-weekday-weekend.sh`. The genuine AEST weekend (Sat/Sun business hours) shows ~2 orders across 45 hours and zero dispatch-batch signatures; all 16 batch signatures found cluster in Monday's AEST business day. Favourable, flagged for JJ per the slice's own stop condition, not acted on. TC14's confirmation-leg premise strengthened (one more corroborating negative: BUSY-1163 is ingest-only, no Cin7-write lambda found anywhere), still INFERRED. No watermark set, no schedule change, no poller invoke, no Cin7 write anywhere in this slice. See `results/R11-pre-kian-confirmation.md` for the full gate-by-gate detail and the revised question list for Kian. |

## Next

**Ready for Kian.** Four items queued (wholesale drop, Q31, Q27 mechanism, Q27 write side) all now
carry a post-gate status per `results/R11-pre-kian-confirmation.md`'s revised question list, plus new
**Q35** (which design owns WHOLESALE). Gate E's favourable weekend reading is a separate decision for
JJ (watermark write to catch a fresh weekend fixture), not for Kian. Gate B's finding (Cin7 has no
point-in-time query, so no historical cycle's order-set membership can ever be reconstructed by replay)
should be treated as a standing constraint on any future slice that considers re-querying an old
window, the same way R10's upper-bound finding constrains forward-looking windows.

### Correction, 2026-09-07, same day

R11 and R12 were written read only and R12 told a session not to attempt a behavioural check because
the schedule is off. **Wrong conclusion from a true fact.** A question about redeployed code cannot be
answered by rows the old code wrote. `slices/R13-fresh-data-verification.md` is now the primary slice:
watermark forward, schedule enabled for a bounded window, every question verified against fresh orders,
then a second cycle minutes later for the second-sighting cases R3 could never reach with stale
targets, then a third once an order progresses stage naturally.

R11's Gate A, B and C keep their value as history context and date a regression, which one fresh cycle
cannot do. R12 is now R13's static pre-flight, and its job is to write the prediction down before the
watermark moves.

## 2026-09-07, R13 run

| Slice | Date | Outcome | Notes |
|-------|------|---------|-------|
| R13 | 2026-09-07 | One live cycle, watermark forward + schedule enabled for a bounded window (06:30:23Z-06:33:34Z), both undone at teardown | **K1 CLOSED, MEASURED behaviourally** (was INFERRED from code SHA): all 9 fresh CTC creates traced end to end through `faulty-sale-worker-queue-populator` -> SQS -> `faulty-sale-worker-queue-handler` -> `staging-inventory-check-order-faulty-sale`, zero filtered anywhere - the split has not landed. **Q36 (counter leakage) got its largest, cleanest measurement yet: residual 36 of 56 orders fetched in one cycle**, fully traced to a 43-order confirmed-WHOLESALE batch at `Dispatched` (`reconcile-poller-cycles.sh`, unmodified). **The R5 wholesale silent-drop reproduces on fresh data and extends to a stage never tested before** (`Dispatched`, not just `Fully Picked`/`Partially Picked`), at ~40x R5's scale. **New: Q38** - `skippedStages` correctly counted 4 confirmed-wholesale orders at `Approved` but gave zero counter and zero log line to the 43 at `Dispatched`, both spot-checked genuinely wholesale by contact-group resolution - the drop is stage-name-specific, not a blanket counter failure. Q35 (wholesale destination) still did not separate: the one candidate that looked like a fresh wholesale-at-eligible-stage order (`#262210`, company-name proxy) resolved to genuine ECOM on the poller's own contact-group check. **K11 reversed**: `lastEmittedPayloadHash` (TC13 measured absent after create) is now present on the stored order row, value matching the emitted payload, on both a create and an echoed order. K6 and K4 reconfirmed on fresh data (K4 twice, two independent cycles). PII in `faulty-sale-worker-queue-handler` reconfirmed present on today's build. **New finding: `{stage}-orders-cin7-so-poller`'s own log also carries unredacted customer PII**, not previously named in `CTC-customer-data-in-cloudwatch.md` - flagged, not fixed. **Possible good news, unverified**: `staging-inventory-check-order-faulty-sale`'s previously-documented PII echo appears absent on all 9 fresh invocations tested today, same day as that function's redeploy - flagged as a candidate fix, not claimed closed. TC1/TC1b/TC8/TC16/TC11 all PASS on 9 fresh orders. A second cycle fired naturally before the schedule was disabled (S3, unplanned but exactly on-spec): TC21 PASS (no duplicate write), TC21b stays INCONCLUSIVE (suppression works, guard not named in the log, same standing verdict). TC10 not testable (no fresh Worship order in window). TC6/TC18/TC9/TC15 not found this window, not deeply chased (cheap-first). S4 not attempted (no order had progressed stage naturally within the session). **One process mistake, corrected in-session**: a raw log dump briefly printed unredacted customer PII to this session's own tool output (never written to a file) before the extraction method was fixed to field-name-only regex extraction (same class of incident as R1's `cut -c` mistake on 2026-09-04). Teardown: schedule DISABLED, watermark UNSET (per JJ's instruction, not restored), DLQ depths unchanged from baseline. New script `scripts/audit-poller-cycle-emits.sh` (read only, safe-fields-only extraction from the poller's `Pushed` log lines). See `results/R13-fresh-data-verification.md` for full detail and the revised question list.|

## Next

**Open items for JJ**: (1) `CTC-customer-data-in-cloudwatch.md` should be updated to add
`{stage}-orders-cin7-so-poller` to its list of log groups with unredacted customer data - not
edited this session. (2) The apparent PII-echo removal in
`staging-inventory-check-order-faulty-sale` deserves a second independent check on a different
fresh order before being treated as a real fix. (3) New **Q38** (why `skippedStages` counts a
wholesale order at `Approved` but not at `Dispatched`) needs a scope decision - resolve now, or wait
for Kian's Q35 answer since it may be moot once the correct destination family is settled.

**Still open, unchanged by R13**: Q35 (wholesale destination - no confirmed-wholesale order reached
an eligible stage this cycle), K5 (Manhattan sender DLQ still empty, no rejection fixture), TC6/TC9/
TC15/TC18/TC14 (all still opportunistic, none found yet).

## 2026-09-08, handover point

**Read the project doc "START HERE, BUSY-1158, 1159 and 1160 status (2026-09-08)" first.** It is the
single entry point and it supersedes every earlier START HERE and PLAN.md's ordering.

Environment now: schedule DISABLED, **watermark UNSET** (R13 unset it rather than restoring the old
value), DLQ empty, 79 CTC shipments all `OPEN`.

Docs published: BUSY-1158 page 1929642002 at version 8, BUSY-1159 page 1929805827 at version 14, both
in sync with their local `QA-DOC.md`. Both docs had a cleanup pass this day.

Next slice is `slices/R14-wholesale-shape-and-bundling.md`, and BUSY-1158's `slices/05-listorders-gateway.md`
is written and unrun. R11, R12 and R13 are done; R12 is now only R13's static pre-flight and R11's
Gate B is recorded as unrunnable by any method.

Do not re-run: Q27's write side, the R1 duration signal (retracted), the four upper-bound payload
spellings, or anything the project doc's "Closed" section lists.

## 2026-09-08, R14 run

| Slice | Date | Outcome | Notes |
|-------|------|---------|-------|
| R14 | 2026-09-08 | W1: neither premise survives. W2: no bundle found anywhere | **W1a**: swept all 137 table names in the account for anything resembling `outbound`/`transfer`/`wholesale`/`rtv` - zero matches, extends R11 Gate B0's two-table check to the whole account. **W1b, the decisive test**: full-table scan of `staging-orders-v2` (13,054 `ORDER` header rows) and `staging-shipments` (30,802 `SHIPMENT#` header rows), tallying distinct `orderType` values across each table's complete retained history. **`orderType` has only ever been `ECOM`** (90 and 88 rows) or absent (12,964 and 30,714 rows, expected since it's a CTC-only field) - never `WHOLESALE`, `RTV`, `STORE_PICK` or anything else, ever, in either table. **Kian's "different shape" premise is falsified**, not just unconfirmed. W1c not attempted (needs a watermark write and the schedule enabled, the slice's own stop condition - not run without asking). **W2a**: read all 16 log lines of R13's exact cycle (`RequestId f624e53d`, `ordersFetched=56 created=9`), safe fields only - no line names a bundle, group or aggregate, and none references any of the 43 `Dispatched` wholesale references; the one `group` hit is `message_group_id`, the FIFO key, not a wholesale grouping. **W2b**: the poller's CloudWatch namespace (`staging-orders-cin7`) has one relevant metric, `SoPollerCycleComplete` - a bare unlabelled execution counter, `Sum=1` per cycle, no dimensions, no breakdown. **W2c**: diffed a pre-deploy cycle (2026-09-02) against post-deploy - same six log-line types both sides; the deploy added 6 fields to the existing summary line (`updated`, `cancelled`, `staleSkipped`, `echoSkipped`, `skippedLocallyTerminal`, `skippedNoSizes`), all directly explained by BUSY-1160's own scope, none shaped like a bundle. `skippedLocallyTerminal` (the LLD's named terminal-stage counter, the most plausible landing spot for `Dispatched` records) read 0 on both R13 cycles. **W2d**: since W2a-c are all negative, the Approved/Dispatched asymmetry stands with no compensating record anywhere - the 43 are not double-counted elsewhere, they are unaccounted for, full stop. **Register updated**: Q35 strengthened (Kian's premise falsified, still his to answer), Q36 corroborated (already closed, now with an independent negative), Q38 moved `TRIED 1` -> `TRIED 2, negative`, raisable with Kian now. No new Q raised. One script written, `scan-order-type-distribution.sh`, unreviewed, promotion candidate once reviewed given how many future BUSY-1160/1161/1219 slices will need this same lookup. See `results/R14-wholesale-shape-and-bundling.md`. |

## Next

**R14 is done. Both of the premises it was built to test are now falsified rather than merely
untested.** The wholesale destination question (Q35) and the counter-leak mechanism question (Q38)
are both now squarely design/code questions for Kian, not open QA avenues - R14's own recommendation
is not to keep searching AWS state for either, since this session already swept every place a QA
session could think to look (tables by name, full table contents, the complete cycle log, custom
metrics, and the pre/post-deploy field diff) and found nothing three separate ways.

Per the BUSY-1160 plan's own `STATE.md` (`../../BUSY-1160/STATE.md`), R14 was the item slice 06 was
waiting on. Slice 06 (`../../BUSY-1160/slices/06-wholesale-and-blocked.md`) can now read this result and
proceed, though given R14's finding (no wholesale record has ever existed in either table), slice 06
should expect the same negative rather than a settled destination to test against.

BUSY-1158's `slices/05-listorders-gateway.md` is still written and unrun, independent of R14.

## Correction, 2026-09-10: R14's `orderType` claim needs narrowing

Appended, not edited: the R14 row above stands as the history of what was measured on 2026-09-08.

R14 recorded **"`orderType` has only ever been `ECOM` ... never `WHOLESALE`, `RTV`, `STORE_PICK` or
anything else, ever, in either table"**, from a full scan of 13,054 `ORDER` header rows and 30,802
`SHIPMENT#` header rows. True as measured. **The blanket form is now false.**

BUSY-1159 slice 18's independent full scan on 2026-09-10 found **4 non-ECOM records** in
`staging-orders-v2`: `QASYN-12-TC2` and `QASYN-14-TC2WH` carrying `orderType: WHOLESALE`, and
`QASYN-13-TC2RTV` and `QASYN-15-TC1B` carrying `RTV`. All four are **QA's own synthetic injections**,
re-typed from real ECOM order `262208`, and seq 13 to 15 were emitted by RETEST-POST-1161 R1 on
2026-09-09, after R14 ran. `../../BUSY-1160/SYNTHETIC-REGISTER.md` seq 12 to 15.

**What survives, and it is the part the downstream reasoning actually rests on: no *real* Cin7
wholesale or RTV order has ever been stored, under any shape.** Kian's "different shape" premise is
still falsified and Q35 is unaffected.

**Why this is worth a correction rather than a footnote.** Three places cite R14's blanket form:
BUSY-1159 slice 15's out-of-scope list, this register's Q35 and Q38 notes, and the 2026-09-09 START
HERE. A session that queries `orderType` after reading any of them will find `WHOLESALE` rows and
conclude either that R14 was wrong or that real wholesale traffic has started. Both are wrong, and the
only thing distinguishing these four rows from real records is the synthetic register. Recorded as
**C9**. Slice 15's citation is already narrowed in place.
