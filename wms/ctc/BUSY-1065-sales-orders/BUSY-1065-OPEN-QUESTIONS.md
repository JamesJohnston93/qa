# BUSY-1065 open questions register

Epic: Cin7 Sales Order Integration. Opened 2026-08-27, revised same day after a documentation sweep, revised again 2026-08-28 after BUSY-1159 slices 01 to 07 and the cleanup audit.

Kian and Lachlan are unavailable. Eleven of the original 24 were answerable from the LLDs, the HLDs, the Connections page and sibling Jira tickets without asking either of them. Those have moved to Answered at the foot. What remains needs a person, a test run, or both.

**How to use this.** One row per question. Add new ones at the bottom with the next Q number, never reuse a number. When one is answered, move it to Answered with the answer and the date, and update whatever doc or test it affected. Anything that changes what counts as correct also needs the LLD corrected, since the LLD is the source of truth for the integration.

**Blocking** means a test cannot produce a trustworthy verdict without the answer. **Non blocking** means we proceed on the stated assumption and revisit.

## At a glance

42 questions allocated, Q1 to Q42, no gaps and no duplicates. **13 open, 3 answered verbally with fixes in flight, 2 reassigned, 22 answered, 1 unverified pending an unresolved population gap.** The next new
question is **Q43**. **Q43 was opened on 2026-09-10** from BUSY-1159 TC6d, the empty-`sizes[]` skip, and reached
`TRIED 2, negative` the same day. One route remains, JJ's Cin7 occurrence query, and no counter-based
route can settle it. That day's other findings are settled facts needing a
document edit, so they are corrections **C7, C8 and C9**, not questions. Q10
carries a correction from the same day about the stale local monorepo checkout. **Q41 closed 2026-09-09, from RETEST-POST-1161 slice R0**: a direct read of the
redeployed poller found `WAREHOUSE_BY_BRANCH_ID` gone entirely, replaced by a single constant
(`CTC_WAREHOUSE = "CTC-QDC"`) passed unconditionally into every command builder, native and outbound
alike -- confirming Kian's own description of the fix ("removed the CTC-WH... everything should flow
to the one CTC-QDC warehouse regardless of branch") by source read, not by re-trusting the claim. Moves
to Answered. **Q41 was raised 2026-09-09, from the same BUSY-1160 slice 08 session that
closed Q38 and corrected Q35/Q40**: a real Manhattan rejection, not a code read, found the wholesale
warehouse code the poller constructs (`CTC-WH`) is not configured in Manhattan SCALE -- isolated
cleanly from a second emit using the known-valid main-warehouse code, which was accepted in full. Q30, Q31 and Q32 were raised 2026-09-01; Q31 was CONFIRMED by BUSY-1159 slice 11
on 2026-09-02. **Q33 was opened and closed on 2026-09-02**: the behaviour behind it turned out to be a
deliberate decision, so the test it called for was withdrawn before it ran. **Q34 was raised
2026-09-04**, from the RETEST-1158-1159 pass: Cin7 is never edited by anyone, which retires "JJ
creates a fixture" as an option for several cases across the epic, not just one slice. **Q35 was raised
2026-09-07**, from R11 of the same pass: the LLD and the two build tickets that would implement it
(BUSY-1160, BUSY-1161) disagree on which family a WHOLESALE order lands in, and as measured neither
destination currently holds anything. **Q36, Q37 and Q38 were all raised 2026-09-07, from R13** (the
same pass's fresh-data-verification slice): Q36 measures how large the poller's counter leak is on the
current build (closed by QA directly, no person needed); Q37 is a measured gap between the LLD and
deployed state (`origin_index` GSI absent) whose "why" is a decision, not a fact, for whoever owns
BUSY-1103; Q38 narrows Q31 part 1 to why one ineligible stage name gets counted and another does not.
**Q39 was raised 2026-09-08**, from BUSY-1158 slice 05: the listOrders gateway returns a live CTC order
unfiltered, matching the LLD, but who calls the endpoint and whether they assume Universal Store only
could not be traced from infrastructure. **R14, also 2026-09-08 (RETEST-1158-1159)**, strengthened
Q35 against Kian's own "different shape" theory (a full-history table scan falsifies it), corroborated
Q36's closed answer with an independent negative, and gave Q38 its second, differing-kind attempt -
`TRIED 2, negative`, moved from its own bucket into "Open, for Kian" below since two attempts is this
register's own bar for raisable. **Q40 was raised 2026-09-09**, from BUSY-1160 slice 06: a direct read
of the deployed sender's own code found `ShipTo` is built only from a person's name, never from a
wholesale order's delivery company, despite the schema already having a slot for it -- `TRIED 1,
CONFIRMED` by source read, no live test needed. **Also 2026-09-09, BUSY-1160 slice 07** read the
deployed poller's own eligibility logic and found `Fully Picked`/`Partially Picked` already match
dev's intent in the currently deployed build -- **Q30 closes negative, and Q31 is superseded**: its
evidence measured a poller build from one day before the deploy this whole plan tests against. Both
move to Answered. **Then, same day, BUSY-1160 slice 08** traced the poller's WHOLESALE/RTV routing
all the way to a dedicated Manhattan sender that did not exist when R11 measured "the outbound family
is unbuilt" two days earlier -- it now is, deployed within hours of this check. **Q38 closes
(`TRIED 3, CONFIRMED`) by direct code read. Q40 is corrected**: the `fullName`-only gap it found is
real but belongs to a code path a genuine wholesale order never reaches; the dedicated outbound
sender already builds `ShipTo` from the delivery company correctly, proven by two real emits, one of
which reached full Manhattan acceptance. Q40 moves to Answered. **Q35's headline is unchanged** (which
design is authoritative, does Cin7 ever return an eligible wholesale order) but its "unbuilt" claim is
now stale, corrected in place.

| State | Q numbers |
|---|---|
| Open, for Kian | none. **Q35 and Q38 both answered by him directly on 2026-09-09**, see the block under this table |
| Withdrawn from the Kian ask 2026-09-09 | Q10 (no longer pressing), Q29 (now QA's, see its entry) |
| Open, for Lachlan | Q15, Q16, Q17, Q18, Q19 |
| Open, for the project team | Q22, Q23, Q34, Q37, Q39 |
| Answered verbally, fix in flight | Q25, Q26, Q27, Q35 (design half), Q38, Q42 |
| Reassigned to a later epic | Q5, Q28 |
| Answered | Q1, Q2, Q3, Q4, Q6, Q7, Q8, Q9, Q11, Q12, Q13, Q14, Q20, Q21, Q24, Q30, Q31, Q33, Q36, Q40, Q41 |
| Unverified, gated on a fixture that has never existed | Q32 |

**Kian answered four questions directly on 2026-09-09**, pasted to him by JJ and recorded here for the first time at that day's wrap-up. Recorded as his statements, checked against what the files measured, per this register's own rule that an answer is evidence rather than settled fact.

1. **Q35's design half, answered.** "Wholesale and RTV land in the ticket I just deployed 1161. The tickets not being updated is probs what has claude freaking out." So the **LLD's outbound design is authoritative**, BUSY-1161 owns WHOLESALE as well as RTV, and BUSY-1160's own AC1 text describing wholesale riding the native records is stale ticket text rather than an alternative design. **This agrees with what BUSY-1160 slice 08 traced independently** (a complete dedicated outbound pipeline with its own Manhattan sender) and with R1's runtime confirmation. Correction C6 below. Q35's other half, whether Cin7 ever returns a wholesale order at an eligible stage, is a data question and is untouched by this.
2. **Q41, answered and since confirmed by source read.** See Q41's own entry.
3. **Q38's remaining design question, answered.** "I'll investigate and fix that up in this observability work if it's still the case." The observability work is **BUSY-1162**, so terminal-stage orders being silently excluded from `skippedStages` is not deliberate. Becomes a re-test condition rather than a question, D19 in `DEFERRED-TEST-CASES.md`.
4. **Q42, new and answered in the same breath.** "I searched Cin7 and couldn't find any orders with Undefined. All had the other 3 values so I figured Undefined is probably worth pausing on and fixing?" This is BUSY-1160 TC22's one residual item, which had never been given a Q number. Now Q42, answered verbally, fix in flight. JJ's read, same day: not an issue, since no real order carries the value.

**Q30 and Q31 closed 2026-09-09, BUSY-1160 slices 06/07.** Q31's picked-stage-skip finding was real
for the poller build it measured (2026-09-02) but that build predates the 2026-09-03 deploy this
plan tests against; a source read of the currently deployed poller found the eligible-stages list
already matches dev's intent. Q30's own risk (a picked order's cancellation deleting a live SCALE
job) does not exist in the current build as a result. Neither needs raising with Kian in the form
these entries were written. Q27 must still be answered before BUSY-1158's AC5 is signed off, which is
now the only hard gate left in the list.

**Q1 reopened 2026-09-01, after two contradictory dev answers in one day. Read this carefully before acting on it.**

Dev first said picked stages are never sent to Manhattan, then corrected himself: **the eligible stages are New, Processing, Partially Picked and Fully Picked**, matching the LLD. He had been working on a different code path, the one that ignores the payload Manhattan sends back when it partially or fully picks an order, since that would not change state in Manhattan. Take the second answer as the intent.

That leaves a contradiction with measured evidence, which is now **Q31**. Do not record Q1 as settled and do not record the LLD as wrong. The LLD is right.

Q2, Q25 and Q26 were worked on directly in the investigation at
`investigations/kian-questions-2026-08-31`, slice 01, 2026-08-31. **Q2 closed as a non-issue.** Q25,
Q26 and Q27 were then answered by Kian verbally on 2026-08-31 with fixes in flight, and have moved out
of the open tables. Q11, Q12 and Q13 sit under Answered but were never questions:
they were stale acceptance criteria, and live in the corrections table as C1 to C3.

The tables below are grouped by who owes the answer, not by number, so read this index first if you
are looking for one Q in particular.

**Verification states were added 2026-09-01** and are filled in for the live questions and for those
with a documented attempt history. Questions answered before that date are grandfathered and carry
none. Anything raised from here needs one.

A question marked **asked** has been put to the person named and is waiting on them. Do not re-ask it,
and do not treat it as unowned work.

Anything under **answered verbally, fix in flight** is closed as far as dev is concerned. Those become
test cases on the ticket named, not questions. Do not raise them with him again.

## How a question earns the right to be asked

Added 2026-09-01, after three questions were filed against people before QA had tried to answer any
of them.

**A question of fact about the system is QA's to answer.** Dev acts on evidence, not on a suspicion
nobody has tested. Asking him to check something we have not checked is asking him to do our job, and
it spends goodwill we will want for the findings that are real.

Every question of fact carries a verification state. **No question of fact may be raised with a person
until it reaches `EXHAUSTED`.**

| State | Means | May be raised |
|---|---|---|
| `NOT TRIED` | Nobody has attempted it | No |
| `TRIED n` | n attempts, each named, with what it ruled out | No |
| `EXHAUSTED after n` | No further route exists, and every closed route is named | **Yes** |
| `RAISED` | To whom, and when | Already raised |
| `NOT TESTABLE` | See the exemption below | **Yes** |

**Two attempts minimum, and they must differ in kind.** Re-running the same check on a wider window is
not a second attempt. A retrospective log read and a controlled run with a chosen fixture are two
attempts. An aggregate observation and a single-order run with a control are two attempts. The point
is to close a different route each time, not to accumulate a number.

**`EXHAUSTED` requires naming what closed each route**, not a count. "Tried twice, gave up" is
`TRIED 2`. "Log content cannot distinguish a guarded skip from an unwired consumer, and no non-CTC
baseline exists in the population, so only a code read settles it" is `EXHAUSTED`. The named routes
are also what makes the eventual ask short: the person can see immediately why it reached them.

**Incidental evidence counts as an attempt only if it was capable of answering the question.** An
observation made while testing something else can be attempt 1, but say that it was incidental,
because an incidental result is usually an aggregate and aggregates rarely attribute cause.

### The exemption: intent and decisions are not testable

QA can test what a system does. It cannot test what someone meant to build, what the business wants,
or what a value ought to map to. Those go straight to the person, marked `NOT TESTABLE, decision` or
`NOT TESTABLE, access` with one line saying why.

"Is `Exempt` meant to be a mapped tax status" is a decision. "Does the poller refuse `Exempt` today"
is a fact, and QA answers it. Split a question that is both, and only send the half that needs a
human.

---

## Q33, new 2026-09-02. CLOSED the same day, `NOT TESTABLE, decision`

**Is `Carrier` dropped on every CTC order, or only on the two measured?** The question is withdrawn.
It only mattered if the omission was accidental, and it is not.

**Answer, 2026-09-02, relayed verbally by james.johnston.** No ticket, message or meeting is named as
the source, and that gap is open: this one sentence is what turns a warehouse-visible gap from a defect
into a deferral. `Carrier` is deliberately not sent for now, pending a final decision, and a later task
owns it. The working assumption behind that decision is that carrier is chosen when
warehouse staff pick the order and mark it ready to ship, then flows back to us, which makes it an
inbound value belonging to the confirmation leg rather than something the outbound send should carry.

**The population scan planned as attempt 2 was withdrawn before it ran**, and its KICKOFF prompt
removed. Whether the omission is systemic no longer decides anything.

**What was measured, and it still stands as the baseline the later task changes from:**

| Where | Value |
|---|---|
| Cin7 API, SO `261115`, `logisticsCarrier` | `Australia Post` |
| `staging-orders-v2` order row | `carrier: UNASSIGNED` |
| Manhattan SCALE, shipments `261115` and `261111` | absent |

Nothing is mapped at the poller, so this is not a partial or conditional omission.

**The live item this leaves is a document correction, for Lachlan, not Kian.** The LLD's per-type
matrix still sends `Carrier` from `logisticsCarrier` on ECOM, WHOLESALE and RTV, which no longer
describes the intended build. Recorded as design drift on BUSY-1159 and as **D16** in
`DEFERRED-TEST-CASES.md`, where no receiving ticket is named yet.

---

## Q32, new 2026-09-01. Falls out of Q31, stays gated after slice 11

**Verification: `NOT TRIED`.** Gated behind Q31, which now has an answer, and the answer keeps this
one moot for now: Q31 confirmed the deployed poller currently skips `Fully Picked` rather than
processing it, so no order at that stage is created at all under today's code, and there is nothing to
read a quantity from. Revisit only once the picked-stage gate is fixed (or found already fixed) and an
order actually reaches SCALE from a picked stage, ECOM or wholesale either would answer the mapping
question even though only ECOM matters for this ticket.

**When a `Partially Picked` order is sent to Manhattan, does it carry the ordered quantity or the outstanding quantity?**

If picked stages are eligible, as dev confirmed, then an order Cin7 says is partially picked will be sent to SCALE as a warehouse job. The mapping in LLD section 5 maps `SKU.Quantity` from `lineItems[].sizes[].qty`, and ECOM expands to one row per unit. **Nothing in the mapping distinguishes the ordered quantity from what is still outstanding**, and `AllocateComplete` is `Y` for ECOM and WHOLESALE regardless.

So on the face of the design, an order with 3 of 5 units already picked is sent as a job for 5. Whether that is intended, and what SCALE does with it, is unanswered.

`qtyShipped` exists on the order item schema for this kind of purpose, declared under BUSY-1158 and populated by the confirmation leg (BUSY-1015 to BUSY-1017), so the field is there but nothing in this epic writes or reads it.

**Three possible answers, and they are very different tickets:**

* Ordered quantity is correct, because Cin7's picked state reflects something that does not affect what the warehouse must pick. Then nothing to do, and it is worth one line in the LLD saying so.
* Outstanding quantity is intended and the mapping is incomplete. A defect, and a mapping change.
* It cannot happen in practice for ECOM, because an ECOM order never reaches a picked stage before it is sent. Consistent with everything QA has observed, since no ECOM order has ever been seen at either stage. Then the case belongs to WHOLESALE, where all 32 observed picked-stage orders were.

**Try the evidence route before asking.** If slice 11 finds picked-stage orders are processed, the next order sent from one will show its quantities in the transaction row and in SCALE, which answers this directly by reading rather than asking. If they are skipped, the question is moot until that is fixed. Either way Q31 comes first, and this only reaches dev if the mapping turns out to send ordered quantities on a partially picked order and we can show it.

**Relevant to BUSY-1159 TC14 and to BUSY-1160's line reconciliation cases.**

## Q30, new 2026-09-01. CLOSED NEGATIVE 2026-09-09. History, no action

**Verification: `TRIED 3, CONFIRMED NEGATIVE` by direct source read of the deployed poller. Answered
by QA, never raised with anyone.**

**Section reconstructed 2026-09-09.** The original was lost when this entry was collapsed into the
Answered bucket during the R1 pass; there was no backup. Rebuilt from the quoted content in
`BUSY-1065-sales-orders/BUSY-1160/` slice and result files and the project's own status docs. **Dates, verdicts
and quoted values are as those files record them; the wording of the original entry is not preserved
verbatim.** Kept because this question's history is the reason it never reached a person, and because
losing that history is how a closed finding gets re-opened by a future session.

**Did an order reaching `Fully Picked` in Cin7 get read as a cancellation, and did that DELETE its
live SCALE shipment?**

**Attempt 1, 2026-09-02, BUSY-1159 slice 11 Part 3. Inconclusive on population.** Checked all 12 CTC
orders the plan had ever sent. Every one was `Dispatched`, none had reached a picked stage, so the
live case never arose. Each still carried exactly one `CREATE_ORDER` transaction and an intact,
`wmsSentAt`-set shipment header, no cancel and no DELETE. Recorded at the time as "nothing to learn",
explicitly not a pass, because the population never tested the actual question.

The question did not dissolve when Q31 resolved. Q31 resolved in the direction that kept it live: the
poller measured on 2026-09-02 treated `Fully Picked` as ineligible, against dev's stated intent, so an
order sent while `New`/`Processing`, picked in the warehouse, and written back by the confirmation leg
would move to a picked stage and, under that build, be read as having lost eligibility.

**2026-09-08, moved back to QA.** Attempt 1 had failed for want of a fixture nobody controlled.
BUSY-1160's synthetic injection harness removed that dependency: a synthetic revision could put an
order at a picked stage directly. Folded into BUSY-1160 slice 05 as an extra arm on TC16, with the
instruction not to raise it with anyone until that had run.

**Attempt 2, 2026-09-08, BUSY-1160 slice 05. `TRIED 2, negative on the layer tested`, and it did not
settle the question.** A synthetic `UPDATE_ORDER` carrying `sourceStage: "Fully Picked"` applied
cleanly, `sourceStage` was written to the `ORDER` row, order status stayed `OPEN`, no outward event,
`wmsSentAt` unchanged. What that measured is that **the reconciliation handler has no stage-based
logic at all**: `sourceStage` is stored as inert metadata whatever its value, with no independent
safety check on the handler side. It could not measure what the real poller sends when a tracked order
reaches a picked stage, because that decision is made upstream of where injection starts.

Combined with Q31 and with slice 05's own TC15, which confirmed a `CANCEL_ORDER` executes
unconditionally (flip plus a header DELETE, no stage check), the risk got sharper rather than smaller.
The entry named the only two routes that could settle it, the first being a source read of the poller.

**2026-09-09, held back from Kian.** That source read had been unavailable when attempt 2 was written
and had since become available: BUSY-1160 slice 06 built `inspect-lambda-code.sh` for an unrelated
question and had already read this exact function. Written as BUSY-1160 slice 07 rather than sent.

**Attempt 3, 2026-09-09, BUSY-1160 slice 07. CLOSED NEGATIVE.** Direct read of the deployed poller:

```
var ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"];
var TERMINAL_STAGE = "Dispatched";
```

Both picked stages are eligible, matching dev's stated intent verbatim. A picked-stage order
classifies as `eligible` and routes to `updateOrder`, never to `withdrawOrder`. **The specific risk
this question named does not exist in the deployed build.**

The cancellation-inference mechanism is real and does fire, but for genuine loss of eligibility: a
stage outside the list, or `status` moving off `APPROVED`, on an order already persisted. That is the
design working as intended, and it was never what this question asked about.

**Reconfirmed 2026-09-09 against the post-BUSY-1161 redeploy**, RETEST-POST-1161 R1 Part 1a. The
poller's `CodeSha256` changed again that day; `ELIGIBLE_STAGES` is byte-identical. See
`BUSY-1065-sales-orders/RETEST-POST-1161/results/R1-targeted-retest.md`.

**Why this entry is worth keeping.** It was one step from being raised with Kian on slice 05's own
recommendation, and the route that answered it appeared by accident, from an unrelated question, four
hours later. A question of fact about the system is QA's to answer, and this is the case that shows
what that is worth.

## Q31, new 2026-09-01. CONFIRMED 2026-09-02, STALE as of 2026-09-09, RECONFIRMED CLOSED 2026-09-09 against the post-BUSY-1161 redeploy

**Update 2026-09-09, from RETEST-POST-1161 R1 Part 1a
(`BUSY-1065-sales-orders/RETEST-POST-1161/results/R1-targeted-retest.md`).** A second redeploy landed the same day
(BUSY-1161, unrelated to this question), changing `staging-orders-cin7-so-poller`'s `CodeSha256` again
(`LastModified 2026-09-09T01:20:09Z`). Re-read directly: `ELIGIBLE_STAGES` is still
`["New", "Processing", "Fully Picked", "Partially Picked"]`, byte-identical to the 2026-09-03 build
BUSY-1160 slice 07 read. **Both Q30 and Q31 stay closed against the current build, not just the one
slice 07 measured.** Nothing further to raise with Kian; this update exists so a future session does
not have to re-derive whether the 2026-09-09 redeploy touched this.

**Verification: `TRIED 2, CONFIRMED` -- against the pre-2026-09-03 poller. `TRIED 3, superseded`
against the currently deployed one.** Read this whole entry as a historical record of a bug that
most likely no longer exists, not as raisable with dev in its original form. See the update at the
foot of this entry before acting on anything above it.

* **Attempt 1, incidental, slice 08 and slice 04.** A 3 day aggregate showed both picked stages in `skippedStages`, and a separate single observation showed a type-skip leaving `skippedStages` empty. Ruled out: that the two counters are the same bucket. Did not settle: attribution on any named order, because the aggregate cannot attribute and all 32 orders in it were wholesale, which is skipped on type regardless.
* **Attempt 2, `BUSY-1065-sales-orders/BUSY-1159/slices/11-picked-stage-eligibility.md`, run 2026-09-02.** A named `Fully Picked` order (`975303Sep26`, WHOLESALE) and a same-cycle wholesale control at stage `New` (`UQLD160-3773`), both inside one bounded poll (`modifiedSince 2026-09-02T02:04:00.000Z`, `modifiedBefore 2026-09-02T03:32:52.889Z`). Confirmed by a direct re-scan of that exact window that the target was the *only* picked-stage order in it, so the result attributes unambiguously.

**Does the deployed poller skip `Fully Picked` and `Partially Picked`, when the intent is that both are eligible?**

**Yes, for `Fully Picked`, MEASURED directly rather than inferred from an aggregate.** The cycle:
`ordersFetched=48 created=2 skippedCounted=4 skippedStages={'Fully Picked': 1} skippedZeroQty=1`.
The control reproduced slice 04's `1038295Dec26` finding under today's code: type-skip,
`skippedCounted` incremented, no stage key at all (`New` absent from `skippedStages`). That rules out
the one alternative explanation left standing: that `skippedStages` records the stage of *any* skipped
order regardless of reason. With that ruled out, the target alone carrying a `Fully Picked` tag the
control does not share can only mean the stage check independently flags `Fully Picked` as ineligible.

`Partially Picked` was not itself represented in slice 11's narrower window (0 such orders fell inside
it), so it stays INFERRED to share the same fate via the same check, not independently re-measured.

Dev confirmed on 2026-09-01 that the eligible stages are New, Processing, Partially Picked and Fully
Picked. **The poller's own behaviour on staging, now measured at the single-order level, does not
match that.**

**Most likely explanation, still worth leading with:** the build is in progress and staging predates
the change. Dev described the picked-stage handling in the present tense as something he was working
on. So this is probably "not deployed yet" rather than a defect, but it is now confirmed evidence
rather than a suspicion, and Kian should reconcile it: either confirm the fix is not yet on staging, or
treat it as a live defect.

**What makes it worth his time, now on file:** `975303Sep26`, `Fully Picked`, the cycle line above, and
`UQLD160-3773` as the control showing the same cycle does not tag every skip with its stage. That pair
is unambiguous and takes him a minute to act on. Full detail in
`BUSY-1065-sales-orders/BUSY-1159/results/11-picked-stage-eligibility.md`.

**Blocks BUSY-1159 TC14** (the fixture, not the mechanism, stays the blocker now), **and Q30 below no
longer dissolves** since this resolved in the direction that keeps that risk live.

**Update 2026-09-09, from BUSY-1160 slice 07
(`BUSY-1065-sales-orders/BUSY-1160/results/07-poller-cancel-emit-source-read.md`).** A source read of the
currently deployed poller (`staging-orders-cin7-so-poller`, `LastModified 2026-09-03T01:10:45Z` --
the identical timestamp `results/01-deployment-gate.md` already recorded for the deploy this whole
plan tests against) found:
```
var ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"];
```
**`Fully Picked` and `Partially Picked` are both in the eligible list, matching dev's stated intent
exactly.** The attempt-2 evidence above (`975303Sep26`) is real and was correctly attributed at the
time, but it was measured 2026-09-02, **one day before** the 2026-09-03 deploy this code read is
against. **"The build is in progress and staging predates the change" -- the leading candidate named
above on 2026-09-01 -- is INFERRED to be exactly what happened**, not independently re-measured
against a live Cin7 order (that would need a poller cycle this plan's slices are built to avoid), but
the timestamps line up exactly and nothing else explains the discrepancy as cleanly. **Superseded, not
retracted: the finding above was correct for the build it measured, that build is no longer what is
deployed.** Nothing further to raise with Kian on this specific point -- if anything, worth telling
him the fix he was working on has landed, not asking him to check it.

**Verification: `TRIED 3, CONFIRMED NEGATIVE` by direct source read of the deployed poller
(BUSY-1160 slice 07). Closed -- see the update at the foot of this entry for the finding.**

Attempt 1 was slice 11
Part 3, read-only, against orders already sent, run 2026-09-02.

**Does an order reaching `Fully Picked` in Cin7 get read as a cancellation, and does that DELETE its live SCALE shipment?**

**Slice 11 Part 3 checked all 12 CTC orders this plan has ever sent** (`fixtures.md`): every one is now
`Dispatched`, none reached a picked stage, so the live case did not arise. Each still carries exactly
one `CREATE_ORDER` transaction and an intact, `wmsSentAt`-set shipment header, no cancel, no DELETE.
**That is "nothing to learn", not a pass**, since the population never tested the actual question.
Gated the negative as planned: BUSY-1160 slice 01 Gate A (cancellation deployment) is still `NOT RUN`
per its own `STATE.md`, so deployment status stays unconfirmed regardless of what a future sighting
would show.

**This question does NOT dissolve. Q31 resolved in the direction that keeps it live, which reverses
the note this question was raised with.** Q31 confirmed the deployed poller currently treats
`Fully Picked` as *ineligible*, contrary to dev's stated intent. That means: today, an order that is
sent to Manhattan while `New`/`Processing`, gets picked in the warehouse, and has its picked quantities
written back to Cin7 by the confirmation leg, would move to a picked stage and, under the **current**
deployed poller, be read as having lost eligibility. If BUSY-1160 ships its inferred-cancellation logic
against this same poller before the picked-stage gate is fixed, a genuinely live, in-progress warehouse
job would be a real candidate for a DELETE, not a hypothetical one.

Two documented rules still interact and nobody has looked at the pair from Cin7's side: dev confirmed
on 2026-09-01 that an order with any item picked must never reach Manhattan (once eligible processing
is fixed), and BUSY-1160 infers a cancellation from **loss of eligibility** rather than from `isVoid`,
sending a header DELETE to SCALE on the same `ShipmentId`. Its TC16 expects an order losing eligibility
any way other than `Dispatched` to emit a cancel. **Whether Cin7 ever actually moves a
Manhattan-fulfilled order to a picked stage is still the open hinge**, and this session's population
(all 12 sent orders went straight to `Dispatched`) offers no evidence either way.

**Worth raising with Kian alongside Q31**, and worth BUSY-1160 confirming its cancellation slice
sequences after the picked-stage gate is fixed, not before. Genuinely new, not a re-raise of Q1, Q25,
Q26 or Q27.

**Update 2026-09-08, and it moves this question back to QA.** Attempt 1 failed for want of a
fixture: no CTC order in the population had ever reached a picked stage. **BUSY-1160's synthetic
injection harness removes that dependency.** A synthetic revision can put an order at `Fully Picked`
or `Partially Picked` directly and the cancel path's response is then measured rather than waited
for. That is a differing-in-kind attempt 2, a controlled emit with a chosen stage and a same-window
control, not a wider re-run of attempt 1's read-only population check.

Folded into BUSY-1160 slice 05 as an extra arm on TC16, `BUSY-1065-sales-orders/BUSY-1160/slices/05-cancellation-and-isolation.md`.
**Do not raise this with anyone until that has run.** If a picked-stage revision produces a header
DELETE, it would delete a warehouse job in progress, and that is a finding worth taking to a person
with evidence attached rather than a suspicion worth asking about now.

**Gates BUSY-1160 TC15 and TC16.** Settle before either is run.

**Update 2026-09-08, slice 05 ran the arm. `TRIED 2, negative on the layer tested -- does NOT settle
the actual risk, still open.`** A synthetic `UPDATE_ORDER` self-revision carrying
`orderInfo.sourceStage: "Fully Picked"` against a live synthetic shipment (`QASYN-10-TC16`,
`wmsSentAt` already set) was applied as an ordinary content-neutral update (`SalesOrderUpdated`,
`added:0 removed:0 addressChanged:false`) and produced **no outward event, no DELETE** --
`wmsSentAt` unchanged throughout. Full detail in
`BUSY-1065-sales-orders/BUSY-1160/results/05-cancellation-and-isolation.md`.

**Read this result narrowly. It is not the same question this entry actually asks.** Synthetic
injection happens downstream of the poller: the session chose to construct an `UPDATE_ORDER`
transaction itself. What it measured is that **the reconciliation handler has no stage-based logic
at all** -- `sourceStage` is stored as inert metadata, whatever the poller decides to send is what
happens, with no independent safety check on the handler side. It did **not** and **cannot** measure
what the real poller actually sends when a tracked order reaches `Fully Picked` in Cin7, because
that decision is made entirely upstream, before the point where injection starts.

**Combined with Q31, the risk gets sharper, not smaller.** Q31 confirmed the deployed poller
currently drops `Fully Picked` orders out of its eligible query result set. If the poller's own
disappearance-detection logic (whatever previously-tracked-order-now-missing means to it, itself
unmeasured -- no source read, no live poller cycle against a real picked-stage order) reads that
absence as loss of eligibility, it would emit `CANCEL_ORDER`, not `UPDATE_ORDER` -- and BUSY-1160
slice 05's TC15 (same session, same result file) independently confirmed a `CANCEL_ORDER` is
executed unconditionally: flip plus a header DELETE to SCALE, with **no stage check of any kind**.
Today's arm proves the reconciliation layer would not stop that DELETE if it happened. It does not
prove whether the poller would actually send it.

**Still gates sign-off, not just the arm.** The only two routes that settle it: a source read of the
poller's own cancellation-inference logic (does it fire from stage-based disappearance, and if so
does it distinguish `Dispatched`-disappearance from any other kind), or a live poller cycle against a
real Cin7 order that reaches `Fully Picked` while still tracked (needs Q31's poller-side stage bug
fixed first, or the same disappearance would just look like Q31 all over again with no cancel visible
either way). Neither route is available to downstream-only synthetic injection. **Recommend this goes
to Kian alongside Q31 before BUSY-1160 ships**, not closed on today's negative.

**Update 2026-09-09, slice 07 took the first of the two routes above: `TRIED 3, CONFIRMED NEGATIVE`
by direct source read of the deployed poller. Closes.** Full trace in
`BUSY-1065-sales-orders/BUSY-1160/results/07-poller-cancel-emit-source-read.md`. The mechanism this question
worried about is real -- an already-tracked order that Cin7 returns classified ineligible this cycle
is withdrawn (`withdrawOrder` builds and emits a genuine `CANCEL_ORDER`, the same event slice 05's
TC15 proved executes unconditionally downstream). **But `Fully Picked` and `Partially Picked` are not
classified ineligible in the currently deployed poller**:
```
var ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"];
var TERMINAL_STAGE = "Dispatched";
```
This matches dev's stated intent exactly. An order sitting at either picked stage with its Cin7
status still `Approved` (the ordinary case) classifies `"eligible"`, is routed to the normal update
path, and never reaches `withdrawOrder`. **The specific risk this question named -- a picked order's
live SCALE job being deleted -- does not exist in the poller currently deployed to staging.**

**This also means Q31, below, is stale, not merely superseded.** The poller function read this slice
carries `LastModified 2026-09-03T01:10:45Z`, the identical timestamp `results/01-deployment-gate.md`
already recorded for the 2026-09-03 deploy this whole plan tests against. Q31's own evidence
(BUSY-1159 slice 11) ran 2026-09-02, one day earlier. INFERRED, not independently re-measured against
a live Cin7 order (that would need a poller cycle this plan's slices are built to avoid), but the
timestamps line up exactly and Q31's own entry already named this as the leading explanation before
today. **The eligible-stages bug Q31 found most likely shipped fixed in the same 2026-09-03 deploy
that introduced the cancellation-inference logic this question was worried about.**

**Closed. No longer BUSY-1160's sign-off blocker.** Worth a short note to Kian alongside Q31's own
close-out (not a raise -- there is nothing to ask, only to tell him the current staging build already
does what he intended), but does not gate anything further.

## Q43, new 2026-09-10 from BUSY-1159 TC6d. CLOSED the same day as a correction, not answered

**Closed 2026-09-10, JJ's call: TC6d passes on no evidence of loss and the divergence is carried as
correction C10.** The occurrence question below was never answered and is not being pursued: the only
remaining route was a Cin7 query, and JJ declined it as not worth holding the ticket for. **The
question is closed, not resolved**, and C10 is where it now lives. If the shape is ever observed in
real traffic this reopens as a defect with the evidence below already in place.

Everything from here down is the state at closure, kept as the record.

**Does the poller's empty-`sizes[]` skip ever drop a real line?**

The LLD says an empty `sizes[]` means a single-size item and the line's own `code` and `qty` are used
directly. It says so in **five** places: §5's detail-line table twice, §5's line-grain prose, §5's
item-key contract paragraph, and §11.1's poller test ("an empty `sizes[]` falls back to the line's own
`code`/`qty`").

**The deployed poller skips instead.** MEASURED 2026-09-10, `inspect-lambda-code.sh` against
`staging-orders-cin7-so-poller`: `expandLineItems` opens
`const sizes = lineItem.sizes ?? []; if (!sizes.length) { skippedNoSizesCount += 1; continue; }`, with
no fallback on that branch. The line produces no order item, so no shipment item and no
`ShipmentDetail`.

**Why it is worth a question rather than just a correction.** A `qty: 0` size is nothing and dropping
it is correct (TC6c). A single-size line is a real line. Dropping it is a **silent** loss: the counter
increments, nothing alerts (the sibling `qty < 0` branch does `console.warn`; this one does not), and
**§7's divergence check cannot see it**, because the order and the shipment record are both still
created and their `lastModified` still match. The shipment is short a line and neither side knows.

**`TRIED 2, negative`.** Two attempts, different in kind, one route left.

**Attempt 1**, the artefact read above, which established the divergence but not whether the
condition occurs. **Closed route:** source alone cannot answer occurrence.

**Attempt 2, run 2026-09-10**, `BUSY-1065-sales-orders/BUSY-1159/slices/19-empty-sizes-fallback.md` S1: swept every
`Cin7SOPollerCycleComplete` line in `staging-orders-cin7-so-poller`'s full retained history, new script
`scripts/check-skipped-no-sizes.sh` (BUSY-1159, not yet reviewed). 584 cycle-complete lines fetched,
window 2026-08-27T01:34:50Z to 2026-09-10T01:47:27Z (the log group's own earliest retained event to
now). **Correction to this entry's own prior framing: the log group's retention is confirmed
unlimited (`retentionInDays: null`), not 30 days.** The real limit on this attempt's strength is not
retention, it is that the schedule has been disabled almost the entire time: only 8 of the 584 cycles
carry the `skippedNoSizes` field at all (added by the **2026-09-03** deploy per R11, which records that
date in six places; `2026-09-04T01:33:31Z` is the first observed cycle to carry it, not the deploy.
Confirmed by spot-checking a 2026-09-02 cycle and finding the field genuinely absent, not a parse
miss), spanning
`2026-09-04T01:33:31Z` to `2026-09-07T06:32:38Z`, the last cycle before the schedule went quiet (no
cycle has run since, confirmed by a direct 4-day tail read). **All 8 are zero. Largest value seen: 0.**

**MEASURED, negative, on a small sample (8 cycles, about 3 days of activity), not a large one.** This
is weaker than "the counter has run for weeks and never fired"; it is "the counter has existed for 3
days of actual poller activity and has not fired in that window." Say so plainly if this is cited.

**Closed route, and it is the one that decides what is left: running more cycles cannot answer this.
Occurrence depends on Cin7 line shape, not on cycle count**, so enabling the schedule would produce
cycles rather than fixtures, and no counter-based route can settle it however long it runs. That is
what takes this from "sample too small, sweep again later" to "one route remains".

Attempt 3, JJ's Cin7 query for whether an empty `sizes[]` occurs at all on a CTC order, is now the only
route, per `slices/19-empty-sizes-fallback.md` S2, `results/18-unrun-cases.md`'s 100-reference list if
a sample is wanted.

**Do not raise this with Kian yet.** The disposition per the slice's own framing: a drift row plus a
correction (LLD says one thing, deployed build does another, nothing lost yet), not a defect, unless
Attempt 3 finds Cin7 does produce an empty `sizes[]` and it reached an eligible order without
triggering the counter, which would be a contradiction worth stopping on rather than closing quietly.

**One distinction to keep straight, because it decides who acts next.** The **non-conformance against
LLD §5 is already measured** and needs no further QA evidence; what attempt 3 settles is the blast
radius. So **whether to escalate before attempt 3 runs is JJ's judgement call, not a question of fact
QA can answer**, and it should not sit in this register waiting for evidence that would not change it.

## Still open, for Kian (build)

| Q | Question | Why it matters | Meanwhile | Blocking |
|---|---|---|---|---|
| C9 | BUSY-1159 slice 15, this register's Q35/Q38 notes, and the 2026-09-09 START HERE | All three cite R14 (2026-09-08) at "full-history strength" for **"`orderType` has only ever held `ECOM`, and no wholesale record has ever been stored under any shape"**. **That is no longer true.** BUSY-1159 slice 18's independent full scan on 2026-09-10 found **4 non-ECOM records** in `staging-orders-v2`: `QASYN-12-TC2` and `QASYN-14-TC2WH` (`WHOLESALE`), `QASYN-13-TC2RTV` and `QASYN-15-TC1B` (`RTV`). All four are **QA's own synthetic injections**, re-typed from real ECOM order `262208` by the BUSY-1160 session and RETEST-POST-1161 R1, and seq 13 to 15 postdate R14's run. **The substantive point survives and should be restated rather than dropped: no *real* Cin7 wholesale or RTV order has ever been stored.** The blanket version is what has to go, because a future session querying `orderType` will find `WHOLESALE` rows and conclude either that R14 was wrong or that real wholesale traffic has begun. Both would be wrong. `SYNTHETIC-REGISTER.md` is the only thing distinguishing these four from real records. |
| Q10 | **`NOT TESTABLE, access`. Withdrawn from the Kian ask 2026-09-09.** Is monorepo or build access available to QA for this epic? | It was not during the purchase order pass, which made a preview script unbuildable. | Assume not. **`inspect-lambda-code.sh` has since answered Q38, Q35, Q40 and TC17 by reading deployed artifacts, with no repository access at all.** Not worth Kian's time unless something specifically needs pre-deploy source. **Corrected 2026-09-10: a monorepo checkout does exist on JJ's machine**, `~/Repos/monorepo`, and a Cowork session can read it. It is branch `UNI-1167-cc-reminder-master`, HEAD **2026-02-12**, **no git remote configured** so it cannot be fetched forward, and it holds no `cin7`, `orders-cin7`, `so-poller` or `ctc` path at all: it predates PR #1568. It is usable for the **pre-CTC** shape of the existing UNI consumers, which is what the §3 consumer-guard audit is a stance about, and for nothing the CTC build added. It was used that way once, on BUSY-1159 slice 15 S2, and the finding it produced had to be settled against a deployed artefact anyway. **Conclusion unchanged, and the answer stays `NOT TESTABLE, access`: this is not repo access and must not be cited as such.** | No |
| Q29 | **`EXHAUSTED after 2`, and no longer Kian's as of 2026-09-09.** Its own closing route was "only a source read settles it", and `inspect-lambda-code.sh` now does exactly that against any deployed function. **This is QA's to attempt on BUSY-1158 before it is asked.**, attempt 1 the UNI baseline log trace in BUSY-1158 slice 03, attempt 2 the CTC-side timing comparison in investigation slice 02. Closed routes: a UNI order cannot separate inference from an explicit field because they agree, and a CTC order is filtered out before the code that would set either runs. Only a source read settles it. Does `staging-shipping-v2-dc-packing-shipment-create` resolve `company` from an explicit field or from `brand`, and why does the value it computes never reach the saved row? | BUSY-1158 slice 03, TC7 (2026-08-31, MEASURED, a genuinely warehouse fulfilled Universal Store order, `brand US`, `wmsId` present, created same day). Its logs show `brand: 'US'` on the incoming record, an in-memory shipment object with `company: undefined`, an external warehouse/ERP response carrying its own `"company":"UNIVERSAL"`/`"brand":"UNIVERSAL"` fields, a mid-pipeline object with `company: 'UNIVERSAL'`, then the final object built for saving shows `company: null`. The persisted `staging-shipments` row for this shipment has no `company` attribute at all, consistent with the `null`. This is a Universal Store order, so inference-from-`brand` and an explicit field agree on the answer either way, and AC8 cannot be told apart from the old behaviour on this class of order (TC7's own known limit). What is new here: the worker clearly does compute a `company` value mid-flight and then does not keep it. | Not a defect on its own, since the eventual state (no `company` on a UNI row) may be entirely intentional if `company` is meant to be a CTC-only persisted field. Named for Kian: is the mid-pipeline `company`/`UNIVERSAL` value read from the external warehouse response, from `brand`, or from a stored field, and is discarding it before save on a UNI order deliberate. | No |

## Still open, for Lachlan (design, owns the LLD)

| Q | Question | Why it matters | Meanwhile | Blocking |
|---|---|---|---|---|
| Q15 | Where does the RTV ship to value come from? | Deferred to be settled against a real RTV order during build. Affects BUSY-1161. | Out of scope for BUSY-1159. Raise before BUSY-1161 testing starts. | No, later |
| Q16 | LLD OQ-1: what is `customFields.orders_1004` on branch transfers? | If it is an expected delivery or dispatch by date it should replace `createdDate` as `ScheduledShipDate`. Affects BUSY-1219. | LLD default stands, `ScheduledShipDate = createdDate`. | No, later |
| Q17 | LLD OQ-2: can `isApproved` and branch ids be filtered server side on `GET /v1/BranchTransfers`? | Affects API budget on a fourth poller against a shared cap. | Gates run in code regardless. | No, later |
| Q18 | LLD OQ-3: does Cin7 hard delete branch transfers? | If it does, a deleted transfer disappears from the poll and the SCALE shipment is never removed. | Assumed soft, as for sales orders. Verify in UAT by deleting a staging transfer. | No, later |
| Q19 | Confirmation leg: the branch transfer stage vocabulary, whether `qtyTransferred` is writable, and whether `PUT /v1/BranchTransfers` merges or replaces the line array. | These constrain the download side's eligibility gate, and the branch transfer PUT is the one place a confirmation write touches a mapped field rather than an echo. | Out of scope here. Carry into the confirmation epic. | No, later |

## Still open, for the project team

| Q | Question | Why it matters | Meanwhile | Blocking |
|---|---|---|---|---|
| Q22 | **`TRIED 1`, not raisable.** Attempt 1, slice 04: `survey-cin7-orders.sh` does not expose delivery country at all. An obvious attempt 2 exists, a small script pulling `deliveryCountry` across a page, and it has not been built. What volume of CTC ecommerce orders has a non Australian delivery address? | Only the eight Australian states and Australia are mapped. Anything else is a deliberate hard error that stops the order at the feed, with no auto retry. CTC sells internationally, so this could be a material share of real orders. | Checked in slice 04: `survey-cin7-orders.sh` does not expose delivery country at all (confirmed from its `--json` output keys). Still unanswered. Would need a small new script pulling `deliveryCountry` from the raw Cin7 payload across a page, real number not a text summary. Not built yet, see PROPOSALS.md. | No |
| Q23 | **`NOT TESTABLE, decision`.** Who owns the QA sign off on the dev handover, and what is the exit criterion for the epic? | The handover's QA owner row is unassigned, and there is no checklist tying each case back to an epic level exit criterion. | JJ signs off ticket by ticket. | No |

## Answered verbally, verify when the fix lands

Kian answered these in conversation on 2026-08-31 and has fixes in flight. **Nothing here is waiting on him and nothing here should be raised with him again.** He is mid-build, and re-asking a question he has already answered and committed to fixing costs goodwill we will want later. Each row says what to verify once the change is deployed, and each becomes a test case on the ticket named, not a question.

| Q | What he said | What we verify on re-test, and where |
|---|---|---|
| Q25 | There is no batching: one order per `PutEvents` call. The call throws if it fails, so the watermark does not move and the poll ends there, retried next cycle. | **BUSY-1159.** One entry per call is confirmable from the logs directly. The part worth a case is narrower than the original question: a rejected entry returns HTTP 200 with `FailedEntryCount: 1` rather than throwing, so confirm the watermark actually holds on that specific shape and not only on an SDK exception. The bus-name config trick in `Plan B` produces exactly that response, on `kian-dev` rather than staging. Do not raise this with him again, test it. **Slice 10, 2026-09-01, both free gates run and clean, MEASURED:** one entry per call confirmed across all 70 real calls in the integration's retained history, two independent counters in the poller's own output agreeing; and zero shortfall between what the poller pushed and what `staging-orders-v2-eda-queue-populator` received, 70/70 idempotencyIds matched, full population not a sample. That also completes the log-correlation half of Plan B's B1.2, which the 08-31 investigation explicitly skipped. Risk is latent, not realised. **The remaining `kian-dev` write half was deferred to BUSY-1162 on 2026-09-01, JJ's decision with dev's agreement, and is D1 in `DEFERRED-TEST-CASES.md`. Nothing here is live work on BUSY-1159.** |
| Q26 | **`NOT TESTABLE, decision`** on the half that reached him, whether `Exempt` should be mapped and to what. The factual half, which values the poller refuses today, was QA's and is answered. He only mapped the tax options he saw while testing. He will check the Cin7 docs for the full list and wrap the fix into the BUSY-1160 work. | **BUSY-1160.** Needs a case in that ticket's QA doc: every `taxStatus` value Cin7 returns is either mapped or refused deliberately. Our sample had `Excl` 598, `Incl` 390, `Exempt` 12 per 1000, so `Exempt` is the one to prove. Two things to check that we never resolved: whether the three orders already refused get picked up after the fix or need a watermark rewind, since the error skips the order and lets the cycle advance past it; and why twelve orders carried `Exempt` while only three ever hit the gate. |
| Q27 | The lambda cannot execute on a CTC order because the fields it needs are absent, so it is wasted invocations rather than a correctness problem. He is splitting CTC out a layer up so it never reaches the lambda and no guard is needed. Accepted as the answer, 2026-08-31. | **BUSY-1158, AC5.** Verify CTC references stop appearing in that log group entirely once the split lands. That also ends the customer data exposure on this path as a side effect, so confirm both in the same read. **The audit table gap is not fixed by this** and is Lachlan's, not his: the consumer is still missing from the LLD table that section 11 derives the regression tests from, so the method that missed it is untouched. |


## Reassigned to a later epic

Not closed, and not for BUSY-1158 or BUSY-1159. Both concern consumers that only react to a shipment leaving `OPEN`, and BUSY-1158 slice 04 confirmed no CTC shipment on staging ever has. The evidence sits here so the receiving epic inherits it rather than rediscovering it. JJ's call, 2026-08-31.

| Q | Question | Why it matters | Where it goes |
|---|---|---|---|
| Q5 | Does the inventory service move stock in response to a CTC shipment event? | Kian raised it himself as a silent correctness risk with no owner. Nothing alerts, because nothing fails. Infra confirmed, BUSY-1158 slice 01, MEASURED: two lambdas are wired to the shipping bus with no origin or company filter, `staging-inventory-core-shipment-inventory-eda-queue-handler` (`TRANS_SHIPMENT_ITEM_ALLOCATED`, `TRANS_SHIPMENT_REJECTED`, `SHIPMENT_FULFILLED`) and `ShipmentItemRejectedEventWorker-queue-handler` (`TRANS_SHIPMENT_ITEM_REJECTED`). Neither has ever been seen firing on a CTC record. | Mainly BUSY-1015 to BUSY-1017, since fulfilment is theirs. **But rejection is not:** the sender does a DELETE to SCALE on rejection, LLD process step 12, which is BUSY-1160. Leave a pointer on 1160 for the rejection path so it does not fall between the two. |
| Q28 | **`EXHAUSTED after 2`**, attempt 1 the infra sweep in BUSY-1158 slice 01, attempt 2 the live log trace in slice 02. Closed routes: a real skip and an unguarded run leave the same trace, and both live samples were themselves CTC so no non-CTC baseline exists in the population. Settled only by a code read or one genuine non-CTC order. Does `staging-shipping-v2-generate-pickslip` actually skip CTC shipments, and if so why does it leave no trace? | Kian's 2026-07-29 comment records a CTC skip guard and a regression test on pickslip generation. Live against `261115` and `261116`, BUSY-1158 slice 02, MEASURED: invoked, record logged twice, exits clean with no third line, no `"CTC"` or `"skip"` text, no call to `staging-shipping-v2-update-pickslip-url`, and no `pickslipUrl` field on either shipment row. Sibling consumers on the same dispatcher log an explicit line when they skip. Both live samples were themselves CTC orders, so there is no non-CTC baseline to compare the two-line shape against. | Whoever picks up the shipment work. The point to preserve is that live behaviour neither confirms nor contradicts dev's claim, so start from that rather than rediscovering it. Settled by a code read or one genuine non-CTC order's log trace. |


## Corrections to raise, no answer needed

These are settled. They need someone to edit a document, not to make a decision.

| Ref | Document | Correction |
|---|---|---|
| C1 | BUSY-1159 AC3 | Says a present order yields an update. The build creates on first sight only, and update is BUSY-1160. Reword or mark the update half as deferred. |
| C2 | BUSY-1159 AC4 | Says one record per line carrying a quantity. The LLD says ECOM is one record per unit with no quantity field, and withdrew the earlier quantity passthrough. The build follows the LLD. |
| C3 | BUSY-1159 AC9 | Says the sender test asserts alphabetical element ordering. The build follows the XSD declared sequence, because SCALE rejected alphabetical. The LLD should also record that the switch has now happened. |
| C4 | Purchase orders LLD 1796702216 §9.1 | Says the purchase order integration holds a private Cin7 budget not shared with the sales order pollers. The sales orders LLD says one credential carries three pollers against one 5,000 per day cap, and flags that the two documents must agree. §8 of the same purchase order LLD already describes a shared credential, so §9.1 contradicts its own §8. |
| C6 | BUSY-1160 AC1 | Says wholesale rides the same records and the same sender as ECOM. **Kian, 2026-09-09: wholesale and RTV land in BUSY-1161**, and the deployed code agrees (a dedicated `CREATE_OUTBOUND_ORDER` chain with its own Manhattan sender, traced in slice 08 and confirmed at runtime in RETEST-POST-1161 R1). His own note is that the tickets were never updated. Reword AC1, or move its wholesale half to BUSY-1161, so the next reader is not testing 1160 against a design dev has already moved. |
| C7 | Sales orders LLD 1802698758 §3, §9.3 and §11.3 | All three say the native-path handlers are untouched by this integration. §3: "**No change is required to any of them**". §9.3: "no CTC-specific emission path, and no change to those handlers", fallout "**zero new code on the native path**". §11.3: "**assert that `create-shipment-items` is unmodified**". **The deployed file carries a CTC-specific path**: `isCTCOriginKey`, `existingCtcShipment`, `createCtcShipment`, `attachItemsToOpenShipment`, in a four-way branch. MEASURED 2026-09-10 on the 2026-09-09 build via `inspect-lambda-code.sh`; the pre-CTC version of the same file, from a 2026-02-12 checkout, had two branches and no guard. **The build is right and the document is stale**: that modification is exactly the guard §3's audit row and §9.2 require, and it is what makes §11.3's "reallocation is not triggered" half true, so the "unmodified" clause is the one to change. Two things the reword should not bury: §11.3's other half, "a CTC order and a UNI order of the same size produce structurally identical item records", is no longer obviously true and nothing has tested it; and `attachItemsToOpenShipment` is a native-path behaviour the LLD does not describe anywhere. Evidence `BUSY-1065-sales-orders/BUSY-1159/results/17-tc2b-reallocation.md`. **Lachlan owns the LLD, so this is his edit, with Kian to confirm the intent.** |
| C8 | Sales orders LLD §9.2 | Says "**`company` is what every consumer guard keys on**", and §3's dc-packing row says the explicit `company` field replaces brand inference. The guard measured on 2026-09-10 keys on the **`origin` prefix** (`CTC#`), not on `company`. Same outcome, so not a defect. Worth correcting because **BUSY-1158's consumer-guard audit searches deployed artefacts for these guards**: a search for `company` alone would miss an origin-prefix guard and could report a guarded consumer as unguarded. |
| C10 | Sales orders LLD 1802698758 §5 and §11.1 | Both specify that an empty `sizes[]` means a single-size item and the line's own `code` and `qty` are used directly. §5 says it three times (the detail-line table's `SKU.Item` and `SKU.Quantity` rows, and the line-grain prose "Where `sizes[]` is empty the style is a single-size item and `lineItems[].code` and `lineItems[].qty` are used directly"), §5's item-key paragraph a fourth, and §11.1's poller test a fifth. **The deployed poller skips the line and counts it via `skippedNoSizes`.** MEASURED 2026-09-10, `BUSY-1065-sales-orders/BUSY-1159/results/18-unrun-cases.md`. **BUSY-1159 TC6d was passed on 2026-09-10 on no evidence of loss** (`skippedNoSizes` read 0 across the 8 cycles carrying it, about 3 days of poller activity), **so this correction is now the only record that the build and the LLD disagree.** Either the LLD drops the fallback, or the build implements it. **Which way it goes is a design decision, not a QA finding**, but the consequence if the shape occurs is worth putting in front of whoever decides: the line is lost silently, the counter increments, nothing alerts, and §7's divergence check cannot see it because the order and the shipment record are both still written with matching `lastModified`. Unmeasured: whether Cin7 ever produces the shape on a CTC order. **Lachlan owns the LLD; Kian confirms which side was intended.** |
| C5 | Both HLDs | `ShipmentID` and `ERPOrder` casing, and `Warehouse = 'UNI-CTC'` as a constant. Both wrong, and the warehouse one would be accepted by SCALE and picked from the wrong stock pool. Full errata list is in the epic base context doc. |

## Answered

**Q1. Are `Fully Picked` and `Partially Picked` eligible stages?** Yes, unambiguously, and the LLD says so in five places including its own risk table. §9.1: an SO is sent when `status = APPROVED` and `stage` is New, Processing, Fully Picked or Partially Picked. The two Picked stages are in the set on purpose, because the confirmation leg writes them into Cin7 on the first pick and that write bumps `modifiedDate`. Were they ineligible, the next poll would read every order's first pick as a previously sent order losing eligibility, treat it as a cancellation, and send SCALE a DELETE for a shipment the warehouse is actively picking. What stops the same poll re-sending the order is the payload hash echo guard, not a stage filter.

The dev handover lists `Fully Picked` among observed skipped stages, which now reads as a probable conformance defect rather than a disagreement. TC14 was rewritten from an open investigation into a defect hunt, and slice 01 gained a cheap log history check that may confirm it before any polling. Answered from the LLD, 2026-08-27.

**Correction to the above, 2026-08-28, from slice 08.** A live 3 day, 718 order window put real `Fully Picked`/`Partially Picked` orders in front of the poller for the first time in this plan (`skippedStages` showed 29 and 3). Checked all 32 by company name directly against Cin7: every one is a wholesale account (surf shops, retailer chains, one marketplace), branch 51908 or 51909, zero are ECOM. `skippedStages` tallies the current Cin7 stage of every order the poller does not create, any channel, not specifically ECOM orders excluded for being in that stage. TC14 stays BLOCKED, no ECOM order in either stage has yet been observed, but on much stronger evidence than slice 04's smaller sample: this session did not just fail to find one, it positively identified the 32 real candidates in the window and ruled every one out by name. The dev handover's observation is very plausibly wholesale orders in these stages, unrelated to ECOM eligibility, which weakens rather than confirms the "probable conformance defect" reading above. Not closed either way, since no ECOM order at these stages has been directly observed yet.

**Q3. Is the BUSY-1258 message group fix epic wide or purchase order only?** Epic wide, explicitly. The ticket says the blast radius is wider than its own epic, other flows publish through the same populator, and the fix should check current callers rather than being scoped to CTC purchase orders. Status is To Do, slated for Sprint 41, 7 to 21 September, so the defective fallback is very likely still live. TC16 was reframed to expect a failure and to make sure this flow lands on the caller list. Answered from Jira, 2026-08-27.

**Correction to the above, 2026-08-27, from slice 06.** TC16 read real `MessageGroupId` values directly off 3 live DLQ messages for this CTC SO flow: all three are distinct, order-specific, non-`undefined` values. Live evidence says this specific flow's message grouping is not defective today, contrary to the expectation that it would be on BUSY-1258's affected-caller list. Either this flow was never actually affected by the populator fallback the ticket describes, or something already isolates it. Does not contradict that BUSY-1258 is epic-wide in principle, only narrows which flows are observed to be affected in practice. Worth naming to whoever picks up BUSY-1258, so this flow is not assumed broken without checking.

**Q6. Is the event cap 240 KB or 256 KB?** Both LLDs say 256 KB consistently, alongside a 400 KB DynamoDB item cap and a 1 MB SCALE payload limit. The 240 KB figure comes from the purchase order QA pass, so it is a measured effective ceiling rather than a second document. The likely reason, INFERRED not measured, is that 256 KB is an EventBridge entry cap counting the envelope as well as the payload. TC19 now records the real tripping size if one is ever seen. Answered from both LLDs, 2026-08-27.

**Q9. Does a programmatic SCALE shipment lookup exist?** No. Every documented Manhattan interface is one directional: three POST download endpoints into SCALE, and a file drop out of it on a 10 minute cycle. Nothing reads a shipment back by id. The SCALE side tools, Warehouse Alerts, Interface Error Insight, Process History Insight and Audit Log Insight, are UI only and searchable by Company plus `ShipmentId`. The manual verification cases in the plan stay manual. Answered from the Connections page, 2026-08-27.

**Q11, Q12, Q13.** All three are stale acceptance criteria on BUSY-1159 rather than questions. Moved to the corrections table as C1, C2 and C3. 2026-08-27.

**Q14. Mandatory fields and CommentType.** Deferred by design, and deliberately so. The LLD's per type matrix gives "established on first staging send" as the answer for all four order types, because every element on `Shipment` is optional in the XSD, so mandatory-ness is SCALE application behaviour and only discoverable by sending. Valid `CommentType` values are SCALE configuration, confirmed during build.

Three things land on that same first send: the mandatory field set, the `CommentType` values, and the element ordering rule. TC1 in slice 02 was assumed to **be** the first ECOM staging send, so slice 02 gained a capture job to record what SCALE accepted and rejected and feed it back into the LLD matrix. Answered from the LLD, 2026-08-27.

**Correction to the above, 2026-08-27, from slice 02.** The "first send" premise is false. The sender log already showed successful sends for three other references roughly 17 minutes before slice 02's TC1 ran, and the poller schedule was live against real Cin7 traffic before slice 01 started (see `results/01-environment-gate.md`). Separately, the sender lambda never logs its outbound XML, only the SCALE response, so the capture job cannot be completed from logs for any order, past, present or future. It is fully deferred to TC1a's manual SCALE UI read (Interface Error Insight / Audit Log Insight). Raised as a correction rather than a new Q, since no new fact is in dispute, the plan's assumption about this environment was simply wrong.

**Q20. Is the Cin7 budget shared or private?** The two LLDs genuinely conflict, and the sales orders LLD wins as the later document and the designated source of truth. It says `${stage}/orders/cin7` carries three pollers, PO, SO and BT, at roughly 2,160 base calls a day against one 5,000 cap, metered on a single metric, with the item master poller on the catalog service's separate credential and outside this budget. The purchase orders LLD §9.1 calls the budget private and unshared, contradicting its own §8. Treat the budget as shared. The purchase orders LLD needs correcting, logged as C4. Answered from both LLDs, 2026-08-27.

**Q7. Which AWS CLI profile should QA use for staging, and does QA have every permission in the handover's access table?** Profile `staging`, SSO role AWSPowerUserAccess, account 398353400186. Confirmed empirically in slice 01: `sts get-caller-identity`, Secrets Manager describe/get, CloudWatch alarms, SNS subscriptions, and `logs filter-log-events` all worked with this profile. The SSO session expires and needs a manual `aws sso login --profile staging` refresh, a browser device-code approval, when it does. Answered from slice 01, 2026-08-27.

**Q8. Are the two staging secrets populated, and is the CTC item master complete in SCALE staging?** Both halves now answered. Secrets: both `staging/orders/cin7` (68 chars) and `staging/manhattan/oauth2` are populated, not empty, and the watermark already holds a real timestamp rather than `UNSET`. Contrary to this register's original note, someone (presumably Kian) populated both ahead of slice 01 running. Item master: confirmed incomplete. At least 4 SKUs are absent from the SCALE staging item master, found via real "does not exist" rejection messages over 2 calendar days: `TH25-318B-28`, `WPR25-104A-10`, plus 2 references whose specific missing SKU was not captured (`261070`, `261073`, `261089` are the ones with a message parked on the DLQ, confirmed in slice 06; `261104` was seen retrying in slice 02 but its DLQ status was not re-checked). TC9 in slice 07 used one of these directly rather than needing to manufacture a rejection. Answered from slices 01, 02, 06 and 07, 2026-08-27.

**Q4. Who writes `lastEmittedPayloadHash`, and is it written on create?** Not written on create, confirmed by direct read. TC13 in slice 03 read the order row for the first real create in this plan (`staging-orders-v2`, `PK 7e02c7f6-aa5d-5596-8a81-6a0c9313cd29`, `SK ORDER`) and `lastEmittedPayloadHash` is absent, along with any attribute resembling a hash under another name. The "who" half remains open: no ticket in the epic claims it, and this reading only proves create-time behaviour, not which future ticket is meant to own it. **Both halves answered 2026-09-02 by BUSY-1159 slice 13, and the framing above is superseded.** A hash IS computed on every emit, 8 hex characters, present and distinct across all 12 references, carried as the trailing segment of `idempotencyId`. It is never exposed as a named attribute anywhere, and the emitted event's key set matches the persisted rows exactly, so nothing is being dropped by `saveUnknown: false`. Not a schema gap. The "who writes it" half is answered by default: nobody does, and nobody is meant to under the current emit shape. TC13 was withdrawn from BUSY-1159 and reframed as D17 on the confirmation epic. **The severity line above was wrong and is retracted**: a duplicate emit yields an identical SAVE on the same `ShipmentId`, a no-op pre-wave and DLQ noise post-wave, not double-picking, and the post-wave half is INFERRED from an unrun case. What survives is a decision for Lachlan, `NOT TESTABLE, decision`: is `lastEmittedPayloadHash` a real requirement or stale LLD text.

**Q2. Does the sales order handler's batch and timeout shape put CTC orders at risk?** No, and it should not have been carried this far. MEASURED, investigation slice 01, 2026-08-31: `staging-orders-v2-eda-queue-handler` runs `BatchSize` 10, `MaximumBatchingWindowInSeconds` 0, `Timeout` 60s, `MemorySize` 128 MB, fanning each message out to `staging-orders-v2-create-order`, `-placed-order` and `-validate-address`. Its full retained history, back to 2025-01-28, holds exactly two days with timeouts, 2025-08-15 and 2025-08-20, and none since. A 718 order backfill on 2026-08-28 went through it with zero errors.

Closed on JJ's reasoning, 2026-08-31, and it is the right call: the only incident is a year old on a different traffic profile, and this is the shared dispatcher already carrying all Universal Store order traffic, so CTC is a marginal addition to a load it is demonstrably handling. **The question only ever existed because the same shape failed on the purchase order flow.** That transfer hypothesis is not supported by anything measured here, and raising a year-old incident on someone else's flow would have cost credibility on the questions that do matter.

Left as a note rather than a question: if a timeout is ever seen on this dispatcher, the marker is `Status: timeout` on the `REPORT` line, and 128 MB against a 10 message batch is where to look first. Do not re-raise it without a live occurrence.

**Q21. Is BUSY-1014 in this epic?** No. Its parent is BUSY-1021, the LLD epic, and its status is Done. Out of scope. Answered from Jira, 2026-08-27.

**Q24. When does alert routing land?** BUSY-1162 is slated for Sprint 41, 7 to 21 September, under fix version WMS CTC Integration with a 2026-10-08 release date. Its acceptance criteria describe alert content and the divergence check but never name SNS or subscription wiring, so who attaches a human to the topic is still not written down anywhere. TC20 records the subscriber count each run. Partially answered from Jira, 2026-08-27, with the wiring question folded into Q23.

---

## Q34, new 2026-09-04, from the RETEST-1158-1159 pass

**Cin7 is never edited by anyone, JJ included.** It is CTC's live production system and stays
read-only, full stop. Clarified directly by JJ during the 2026-09-04 re-test after `BUSY-1065-sales-orders/retests/RETEST-1158-1159`
slice R3 was found to be designed around JJ making a sequence of live Cin7 edits (a quantity change,
a line add, a line removal, an address change, a replay, a later edit) one at a time. That premise is
invalid: no test case in this epic can rely on a purpose-built Cin7 fixture, ever, from anyone.

**Every case that needed a manufactured fixture is affected, not just R3.** TC4, TC3, TC21, TC21b and
the BUSY-1160 version-guard cases (R3's whole scope) have no other way to observe a second revision of
an order except a naturally occurring one. TC9 (item-master-absent SKU), TC15 (over-25-character
reference) and TC6 (repeated option code, re-proven under the changed 2026-09-03 build specifically)
are in the same position: each was previously framed as "JJ's to find or create" in the BUSY-1159 plan
and in `RETEST-1158-1159/slices/R4-create-path-regression.md`; the "create" half of that framing does
not exist.

**What this means going forward:** these cases stay unverified against the current build until a
matching real order occurs naturally, which is opportunistic and unscheduled, not a queue item pending
a person. Re-check cheaply and read-only when convenient (the same spirit as R5's Gate A, which checks
in under 5 minutes and stops if nothing qualifies). Not blocking sign-off resolution by itself, but
worth the project team knowing that BUSY-1160's reconciliation behaviour (line add/remove, address
change, version guard discrimination) may go unverified for this entire re-test pass for lack of a
fixture nobody can create. Open, for the project team.

## Q35, new 2026-09-07, from R11 (`BUSY-1065-sales-orders/retests/RETEST-1158-1159`), pre-Kian confirmation

**The LLD and the two build tickets that would implement it disagree on where a WHOLESALE order
lands, and as measured today neither destination holds anything.** LLD 1802698758 section 9.2 and 9.3
are explicit: the family split is customer orders (ECOM) versus bulk stock movements (WHOLESALE, RTV,
STORE_PICK), and WHOLESALE goes to the `OUTBOUND_SHIPMENT` family, never the native one. But:

* **BUSY-1160** ("Native updates: wholesale mapping, line reconciliation, cancellation", in Review,
  JJ) describes the opposite: "Both ECOM and WHOLESALE ship to an external address via a carrier with
  `AllocateComplete = Y`, so wholesale rides the same records and the same sender" - the native family,
  not outbound.
* **BUSY-1161** ("Outbound family: RTV end-to-end", In Progress, Kian) scopes the outbound family to
  "RTV as its only order type from sales orders." STORE_PICK moved out to BUSY-1219. WHOLESALE is not
  named anywhere in BUSY-1161's scope.

So under the LLD's own design, under BUSY-1160's stated approach, and under BUSY-1161's stated scope,
there is no single build ticket that currently claims WHOLESALE as its own. MEASURED as of 2026-09-07:
neither destination holds anything for either of R5's two vanished wholesale orders
(`1065881Sep26`, `UQLD160-3711A`), or for wholesale generally. `staging-orders-v2` (the order-chain
table, shared by all four order types per the LLD, upstream of the native/outbound split entirely)
has zero rows under either order's origin key. `staging-shipments`' outbound-family lifecycle statuses
(`PENDING_OUTBOUND`, `SENT_OUTBOUND`, `CANCELLED_OUTBOUND`, `REMOVED_OUTBOUND`) return zero rows
system-wide, not just for these two references, and no Lambda or EventBridge rule matching "outbound"
exists in the account at all - the outbound family is unbuilt, full stop. Branch 51908 (Wholesale
Warehouse) has zero rows of any kind in `staging-shipments`, confirmed independently by R9's `
allocated_store_index` sweep on 2026-09-04 and unchanged on re-check.

**Ask Kian directly: which design is authoritative for WHOLESALE, and which ticket (if either) owns
building it?** Until one build ticket claims it, a wholesale order that reaches an eligible stage will
continue to vanish with no counter and no destination, regardless of which of the three readings above
turns out to be the intended one. Open, for Kian.

**R14, 2026-09-08, strengthens this against Kian's own first premise.** He offered "wholesale orders
land in AWS but have a different shape or identifier" as a candidate explanation on 2026-09-07. R14
tested that directly with a full-table scan of `staging-orders-v2` (13,054 header rows) and
`staging-shipments` (30,802 header rows) - the complete retained history of both tables, not just the
handful of specific references R5 and R13 checked. `orderType` has taken exactly one value, ever, in
either table: `ECOM` (90 and 88 rows respectively). No `WHOLESALE`, `RTV`, `STORE_PICK` or any other
value has ever been written. **The "different shape" premise is now falsified, not just
unconfirmed.** Does not change who answers this or what it unblocks - the design-ownership question is
still Kian's alone - but rules out one of his own two explanations before he needs to spend time on
it. See `BUSY-1065-sales-orders/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`.

**Update 2026-09-09, from BUSY-1160 slice 08 (`BUSY-1065-sales-orders/BUSY-1160/results/08-final-sweep-before-
dev.md`): the "outbound family is unbuilt, full stop" line above is no longer true, and it changed
within the last two days, not because anything in this register was wrong at the time.** A source
read of the deployed poller (Part 1b) found `createOrder` already routes `WHOLESALE`/`RTV` through a
dedicated `createOutboundOrder`/`CREATE_OUTBOUND_ORDER` path, and tracing it end to end found every
hop deployed and real: `staging-orders-v2-create-transaction` (schema explicitly lists
`CREATE_OUTBOUND_ORDER`/`UPDATE_OUTBOUND_ORDER`/`CANCEL_OUTBOUND_ORDER`, comment `// CTC outbound
shipments (WHOLESALE / RTV sales orders)`) -> `staging-orders-cin7-create-outbound-order` (persists
`ORDER`/`ITEM#<id>#<size>` rows in `staging-orders-v2`) -> `staging-shipping-inbound-outbound-order-
bridge` -> `staging-shipping-manhattan-send-outbound-shipment`, **a dedicated Manhattan sender for
outbound shipments that does not exist for the native/ECOM path.** Part 3 then ran two synthetic
`CREATE_OUTBOUND_ORDER` emits and confirmed this at runtime, not just by code read: one reached
Manhattan and was rejected only on an unconfigured warehouse code (`CTC-WH`, itself real -- the
poller's own lookup produces it); the other, with a known-valid warehouse, was **accepted by
Manhattan** (`OUTBOUND_SHIPMENT_SENT`).

**Why this does not contradict R11/R14's own measurements**, checked rather than assumed: every
function in this chain carries a `LastModified` in the narrow window `2026-09-09T01:19-01:39Z` --
today, a few hours before this check, and after R11 (2026-09-07) and R14 (2026-09-08) both ran their
"no outbound infrastructure exists" sweeps. **The outbound family was not built when R11 measured it
absent. It is built now.** R11 and R14's negatives were both correct for the state of the account at
the time; nothing about their method was wrong.

**ANSWERED 2026-09-09 by Kian, design half.** "Wholesale and RTV land in the ticket I just deployed
1161. The tickets not being updated is probs what has claude freaking out." The LLD's outbound design
is authoritative, BUSY-1161 owns WHOLESALE as well as RTV, and BUSY-1160's AC1 text is stale rather
than a competing design. **Checked against the files rather than taken on trust: it agrees with what
slice 08 traced independently** (the dedicated outbound chain and its own Manhattan sender) and with
RETEST-POST-1161 R1's runtime confirmation of that chain. Correction C6 raises the ticket text.
**The other half is still open and is a data question, not a design one: does Cin7 ever return a
wholesale order at an eligible stage.** Nobody has produced one, and it is what BUSY-1160's TC1
upstream half and TC4 wait on. W1c would answer it; the call is JJ's, since it needs Cin7 production
credentials.

The paragraph below was written before that answer and is kept for the reasoning it records.

**This still does not answer this question's own headline (which design is authoritative, and does
Cin7 ever return a wholesale order at an eligible stage) -- Q35's core is unchanged and still needs
Kian and W1c.** What it does answer: **there is now a real, working destination for a wholesale order
to land in**, and record-family ambiguity (does it ride ECOM's tables or its own) resolves as both
readings being partially right -- same `staging-orders-v2`/`staging-shipments` tables as ECOM, under
an entirely separate, dedicated handler chain and schema. Whoever raises this with Kian should lead
with "the pipeline exists and works, here is the one warehouse-code gap left," not with "wholesale
mapping is unimplemented."

## Q36, new 2026-09-07, from R13 (`BUSY-1065-sales-orders/retests/RETEST-1158-1159`). MEASURED, closed by QA

**How large is the SO poller's counter leak on the current (post-2026-09-03) build, and where does it
originate?** Two attempts, differing in kind, both closed the same way. R11 Gate A swept the poller's
entire retained history (582 cycles, 2026-08-27 to 2026-09-04) and found the counters have never fully
balanced: 292 of 582 cycles carry a non-zero residual, 291 of them pre-deploy, the largest being a
399-order gap on a wide backfill cycle. R13 then ran one live, chosen-window cycle against fresh
Cin7 data (56 orders fetched) and got the largest residual measured on any narrow, live-schedule cycle
to date: **`ordersFetched=56, summed=20, residual=36`**. Every one of the 56 references was named and
traced: the 9 created and the 4 `skippedStages={"Approved":4}` are fully accounted for by origin; the
remaining 43, all confirmed genuinely WHOLESALE by contact-group resolution (not the company-name
proxy alone), sit at `Dispatched` and get `skippedCounted(4) + skippedZeroQty(3) + residual(36) = 43`
between them, with no per-order log line for any of the three counters to say which of the 43 landed
where. **Answered as far as QA can take it**: the leak is real, large, reproducible on fresh data, and
concentrated in wholesale orders at `Dispatched`. What remains is not a fact QA can extract from more
logs (`reconcile-poller-cycles.sh` and `gate-b-window-check.sh` are both exhausted for this purpose,
see R11 Gate B and R13) but a code-level mechanism question, folded into **Q38** below rather than
re-opened here.

**R14, 2026-09-08, corroborates from the opposite direction.** Rather than measuring the leak's size
again, R14 searched independently for a compensating record that would explain where the 43 went: the
full raw log for the exact cycle (16 lines, all known types, nothing naming a bundle, group or
aggregate), the poller's CloudWatch custom metric namespace (`SoPollerCycleComplete` is a bare
unlabelled execution counter, no per-disposition breakdown), and a pre/post-deploy diff of every
distinct log-line type the poller produces (identical six types before and after 2026-09-03; the
deploy added fields to the existing summary line, not a new line type). All three came back negative.
**The leak is not hiding anywhere this session could find** - reinforces "closed by QA" rather than
changing it. See `BUSY-1065-sales-orders/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`.

## Q37, new 2026-09-07, from R13. MEASURED absent, twice, 3 days apart

**Does `staging-shipments` carry the `origin_index` GSI the LLD says BUSY-1103 delivers?** No.
`describe-table` (the only authoritative source; there is no other route to a GSI list) shows the same
7 GSIs on both 2026-09-04 (R11) and 2026-09-07 (R13): `allocated_store_index`, `customer_index`,
`idempotency_index`, `status_index`, `pending_action_index`, `shipment_index`, `event_index`. No
`origin_index` on either check. This is not a "tried twice the same way" gap in confidence - a GSI
either exists on a table or it does not, and `describe-table` is unambiguous - but it IS a decision
question, not a fact QA can settle further: is BUSY-1103 not yet merged to this account, was the GSI
descoped, or does the LLD cite the wrong ticket? `NOT TESTABLE, decision` on the "why" half. **Open,
for whoever owns BUSY-1103** (unclear from Jira at time of writing - flagged for JJ to route). Blocks
nothing directly tested so far (both `inspect-ctc-order.sh`'s fallback via the order's own `PK` and
R11 Gate B0's wider `status_index` sweep worked around its absence), but any future case that assumes
this GSI exists will fail the same way Gate B0 nearly did.

## Q38, new 2026-09-07, from R13. `TRIED 3, CONFIRMED` 2026-09-09, mechanism answered

**Why does `skippedStages` count a wholesale order at `Approved` but give zero counter and zero log
line to one at `Dispatched`, when both are the same order type and both are LLD-ineligible stages?**
R13's one fresh cycle held both in the same fetch: 4 confirmed-WHOLESALE orders at `Approved`
(contact group `Retailer - Domestic`, spot-checked) landed cleanly in `skippedStages={"Approved":4}`;
43 confirmed-WHOLESALE orders at `Dispatched` (contact group `Retailer - Majors`, spot-checked) got no
counter and no log line of any kind, part of R13's residual-36 measurement (see Q36). This narrows
Q31 part 1 (does the counter fire at all post-deploy - it does, MEASURED) to a sharper question: which
stage names does the counter's own logic recognise, and does `Dispatched` fall through a different,
earlier code path entirely (consistent with R11 Gate B0's wholesale/native-family findings) rather than
being an omission from a stage-name list. **Only one route had been closed as of 2026-09-07** (the live
measurement above) - a second, differing-kind attempt (most likely a code read of the poller's stage
classification, which R10 and R11 both left as JJ's call rather than QA's to take unilaterally) had not
been tried.

**R14, 2026-09-08, is the second attempt, differing in kind, and it is negative.** Rather than another
live measurement of the same shape, R14 searched for a compensating record that would explain the
asymmetry: the full raw cycle log (no bundle, group or aggregate line, and no reference to any of the
43), the poller's CloudWatch metrics (no per-disposition breakdown exists at all), and the pre/post
deploy field-set diff (the one plausible landing spot, `skippedLocallyTerminal`, the terminal-stage
counter `Dispatched` should hit by the LLD's own design, read `0` on both cycles in the same window
that produced the 43). **This rules out "the 43 are counted somewhere else under a different name" -
they are not counted anywhere.** It does not settle the actual mechanism question (stage-name omission
from a list, versus an entirely separate, earlier code path) - that still needs the code read.
**`TRIED 2, negative`** - per this register's own rule, two differing-kind attempts is the bar for
raisable, not exhaustion of every possible route. **Raisable with Kian now**, carrying both attempts:
R13's live measurement and R14's completeness sweep. See
`BUSY-1065-sales-orders/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`.

**Update 2026-09-09, `TRIED 3, CONFIRMED`, from BUSY-1160 slice 08 Part 1a
(`BUSY-1065-sales-orders/BUSY-1160/results/08-final-sweep-before-dev.md`).** The code read R13/R14 said was
needed has now happened. `Dispatched` and `Approved` genuinely go through two different branches of
the same function, not one branch with a stage-name omission:
```
if (eligibility === "skip-terminal") continue;      // Dispatched exits HERE, before any counter
...
if (eligibility === "skip-counted") {
  skippedStages.set(stage2, ...)                    // Approved (and any other non-eligible,
}                                                     // non-Dispatched stage) is counted HERE
```
`Dispatched` is `TERMINAL_STAGE` and returns `"skip-terminal"`, which hits `continue` before the loop
ever reaches the `skippedStages.set(...)` line. `Approved` (or any stage that is neither eligible nor
`Dispatched`) returns `"skip-counted"`, which does reach it. This also explains why
`skippedLocallyTerminal` read zero on the same cycles: that counter lives inside `updateOrder`, which
the 43 `Dispatched` orders never reached at all (they exit in the earlier per-order loop, before
`updateOrder` is ever called). **Closed.** One question left for Kian, and it is a design one, not an
investigation: is silently excluding terminal-stage orders from `skippedStages` deliberate, or should
they be counted like every other skip, just under their own disposition.

**That design question was RAISED and ANSWERED 2026-09-09.** Kian: "I'll investigate and fix that up
in this observability work if it's still the case." The observability work is BUSY-1162, so the
exclusion is not deliberate. **Nothing is open here.** It becomes a re-test condition on that ticket,
D19 in `DEFERRED-TEST-CASES.md`: after the fix, a terminal-stage order should appear under its own
disposition rather than in no counter at all. Q38 itself stays closed.

## Q39, new 2026-09-08, from BUSY-1158 slice 05 (`BUSY-1065-sales-orders/BUSY-1158`)

**Who calls `staging-orders-v2-list-orders` (`GET /orders` on `staging-orders-v2-events-api`), and
does any of them assume Universal-Store-only results?** MEASURED: the endpoint applies no store-based
filtering that could be observed. `GET /orders?status=OPEN` returned a live `CIN7_SO`/`store: CTC`
sales order (`261071`) and a `CIN7_PO`/`store: CTC` purchase order on page one, mixed in with
`SHOPIFY_ECOM`/`store: PS`, `SHOPIFY_ECOM`/`store: US` and `NEWSTORE`/`store: US` rows, with no
per-store grouping or exclusion in the response shape. This matches the LLD's "listOrders starts
working once CTC exists in Stores" description (TC9 PASS on this reading), but the LLD is silent on
who consumes the endpoint and whether they were built assuming Universal Store only. Not traceable
from infrastructure this session: the API's one usage plan has a single, generically named API key,
not one per client; no event source mapping or other trigger reaches the function outside this one
API Gateway method; a name-based sweep of Lambda functions for an obvious BEFE/CX/admin caller found
none (closest hits, `staging-tp-befe-*`, are Team Portal auth/session functions, unrelated). A full
sweep of every function's environment variables for this API's id, across roughly 1,466 functions in
the account, was judged out of proportion to this slice and not attempted. **Open, for whoever knows
the client side of this API** (unclear from AWS alone - flagged for JJ to route, same shape as Q37).
Non blocking for TC9 itself, since Gate B's own question (does the gateway include or exclude CTC) is
answered; blocking only if a downstream consumer turns out to assume Universal-Store-only rows.

## Q40, new 2026-09-09, from BUSY-1160 slice 06 (`BUSY-1065-sales-orders/BUSY-1160`). Corrected same day, slice 08

**Verification: `TRIED 2, CORRECTED`.** Slice 06's finding below is accurate about the function it
read and wrong about which function a real wholesale order reaches. **Read the update at the foot of
this entry before raising anything with Kian** -- the original framing below would misrepresent the
defect if quoted on its own.

**Does the deployed Manhattan sender ever construct `ShipTo` from a wholesale order's delivery
company, or does it read only a person's name?** Slice 06 set out to answer a narrower question --
whether the LLD's 25-character `ShipTo` truncation lives in the poller or downstream, so TC1b could
be decided runnable off the synthetic harness without a real wholesale order (P2,
`BUSY-1065-sales-orders/BUSY-1160/PROPOSALS.md`). Since neither monorepo nor build access exists for this epic
(Q10), the check was done by downloading both functions' deployed code directly via `aws lambda
get-function` (a different avenue from the blocked one -- inspecting an already-deployed artifact
with existing AWS credentials, not a source repository) and grepping the bundles.

**MEASURED: truncation lives entirely downstream, in `staging-shipping-manhattan-send-shipment`.**
`ShipTo` does not appear anywhere in `staging-orders-cin7-so-poller`'s bundle (0 matches). The
sender's own code:
```
var SHIP_TO_MAX_LENGTH = 25;
...
function truncateShipTo(customer) {
  if (customer.ShipTo.length <= SHIP_TO_MAX_LENGTH) { return customer; }
  console.warn(`Truncating Customer.ShipTo to ${SHIP_TO_MAX_LENGTH} characters: "${customer.ShipTo}"`);
  return { ...customer, ShipTo: customer.ShipTo.slice(0, SHIP_TO_MAX_LENGTH) };
}
```
called unconditionally from `serializeShipmentDownload`, on whatever ends up in `Customer.ShipTo`.
**This part settles P2 cleanly: TC1b runs off the synthetic harness, no wholesale order needed.**

**But the same read found something bigger underneath it.** `ShipTo` has exactly one construction
site in the whole bundle, and it is unconditional:
```
Customer: { Company: "CTC", ShipTo: fullName(address), ShipToAddress: { ... } }
...
function fullName(address) {
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  if (!name) {
    throw new Error("Shipment shipping address carries no firstName or lastName — refusing to send a shipment with an empty ShipTo to SCALE.");
  }
  return name;
}
```
`fullName` reads only `firstName`/`lastName`. It never reads `address.company` -- confirmed absent
from every occurrence of `company` in the sender's bundle except schema definitions. **The schema is
wholesale-aware** (`company: { type: String, required: false }` sits right next to `lastName: {
type: String, required: false } // don't require a first name` on the shipping-address sub-schema,
and the shipment model's `orderType` enum already lists `WHOLESALE`/`STORE_PICK`/`RTV` alongside
`ECOM`) -- but nothing reads that field when building `ShipTo`. Separately confirmed
MEASURED, in the poller: `order.deliveryCompany` is carried through as `addressChanges.shipping.company`
(conditionally, when Cin7 supplies it), never merged into `firstName`/`lastName`. So the poller does
pass the company name through, under the name the schema already expects, and the sender simply
never looks at it.

**Consequence: even a synthetic `WHOLESALE` emit would not produce AC1's "ShipTo is the delivery
company" today.** A wholesale order whose shipping address genuinely has no person name would hit the
`fullName` guard and be refused outright (`"refusing to send a shipment with an empty ShipTo"`); one
that happens to carry a contact person's name alongside the company would silently send the person's
name as `ShipTo`, never the company. Either way, AC1's own worked example does not hold against the
deployed code, independent of R14's finding that no wholesale order has ever reached the system --
this is a code gap, not a fixture gap.

**Not run as a live test this slice**, by design -- slice 06 is read-only and TC1b's actual run
belongs wherever P2 sends it (slice 04's territory, per the proposal), not here. This entry is the
evidence that run would need going in, not a substitute for it.

**Raise with Kian**: is the `fullName`-only `ShipTo` construction a known gap awaiting a follow-up
PR, or does the intended fix land somewhere this read did not reach (a step between the poller and
the sender that was not inspected). Full detail in
`BUSY-1065-sales-orders/BUSY-1160/results/06-wholesale-and-blocked.md`.

**Update 2026-09-09, from BUSY-1160 slice 08
(`BUSY-1065-sales-orders/BUSY-1160/results/08-final-sweep-before-dev.md`): the gap above is real but does not
apply to a genuine wholesale order, because that order never reaches `staging-shipping-manhattan-
send-shipment` at all.** Slice 08 traced the poller's own routing (`createOrder` ->
`isOutboundOrderType` -> `createOutboundOrder`) and found `WHOLESALE`/`RTV` orders are diverted to a
**dedicated `CREATE_OUTBOUND_ORDER` pipeline before they ever reach the native create-order path**
this entry's `fullName(address)` finding was read from. That pipeline has its own sender,
`staging-shipping-manhattan-send-outbound-shipment`, with its own `ShipTo` construction
(`deriveShipTo`, at the poller: company checked before any person name) that this entry never
examined.

**Proven at runtime, not just re-read.** Two synthetic `CREATE_OUTBOUND_ORDER` emits
(`emit-synthetic-outbound-order.sh`, built for this) reached this dedicated sender. Its own log:
```
WARN Truncating Customer.ShipTo to 25 characters: "Cheap Thrills Returns Warehouse"
```
`ShipTo` was built from the delivery company and truncated to 25 characters, correctly, exactly per
AC1/TC1b. One emit was then rejected by Manhattan on an unrelated, real defect (an unconfigured
warehouse code, `CTC-WH` -- see Q35's update); the other, with a known-valid warehouse, was
**accepted by Manhattan** (`OUTBOUND_SHIPMENT_SENT`).

**Corrected, not withdrawn: this entry's own code excerpt is accurate, and the "raise with Kian"
framing above is wrong.** `fullName(address)`-only `ShipTo` construction is real in
`send-shipment`, and if a wholesale order were ever mistakenly routed through the native path it
would misbehave exactly as described -- but the deployed poller does not route it there. **Nothing
to raise with Kian on this specific point.** The real, narrower defect is the `CTC-WH` warehouse gap,
now Q35's problem to carry, not this entry's.

## Q41, new 2026-09-09 from BUSY-1160 slice 08, CLOSED 2026-09-09 from RETEST-POST-1161 slice R0, RUNTIME-CONFIRMED 2026-09-09 from R1

**Verification: `TRIED 3, CONFIRMED` -- a real Manhattan rejection (BUSY-1160 slice 08), a direct
source read of the redeployed fix (RETEST-POST-1161 R0), then a real Manhattan acceptance on the exact
previously-rejected payload with only the warehouse code corrected (RETEST-POST-1161 R1 Part 2).
Closed, not raisable.**

**Runtime confirmation, RETEST-POST-1161 R1 Part 2
(`BUSY-1065-sales-orders/RETEST-POST-1161/results/R1-targeted-retest.md`).** R0's source read closed this on code
alone; R0 itself flagged that it had not re-run the live case. R1 did: `QASYN-14-TC2WH` re-emitted
seq 12's WHOLESALE payload (`262208` shape, `"Cheap Thrills Wholesale Pty Ltd"`, two-size multi-line
item) with every field identical except the warehouse code, corrected from the harness's stale
default (`CTC-WH`, what the old poller produced) to `CTC-QDC` (what the fixed poller now produces
unconditionally). MEASURED: no `ManhattanRejectionError`, `OUTBOUND_SHIPMENT_SENT` with
`sentLineIds:["3494647#L","3494647#M"]` -- accepted in full. Since the warehouse code is the only
variable that changed from a payload that was rejected, this isolates the fix as cleanly as a live
test can. **Nothing further to verify on this question.**

**Closing read, RETEST-POST-1161 R0 (`BUSY-1065-sales-orders/retests/RETEST-POST-1161`).** Kian said on 2026-09-09 "I've
removed the CTC-WH in this latest deploy... everything should flow to the one CTC-QDC warehouse
regardless of branch in Cin7." R0 read the redeployed `staging-orders-cin7-so-poller`
(`LastModified 2026-09-09T01:20:09Z`, `CodeSha256 iI9VFACg8rAo6QvIG49S/aoiIeDWLLesHeFedTbA6zo=`,
different from every prior baseline) directly: `WAREHOUSE_BY_BRANCH_ID` is gone from the code
entirely, no `"CTC-WH"` string anywhere in the bundle. Replaced by a single constant,
`var CTC_WAREHOUSE = "CTC-QDC"`, passed as `warehouse: CTC_WAREHOUSE` unconditionally into every
command builder this function has -- `buildCreateOrderCommand`, `buildUpdateOrderCommand`,
`buildCancelOrderCommand` and their three outbound counterparts alike. There is no branch read left to
key off; the fix is not "both branches map to CTC-QDC," it is "there is no longer a branch-keyed
lookup at all." **MEASURED, confirms Kian's claim exactly, closes the question dev-side.**

**What this does not close.** Whether Manhattan SCALE itself now has a `CTC-QDC` warehouse correctly
provisioned for wholesale traffic is a live-send question, not a code-read one; R0 did not re-run
`QASYN-12-TC2` or `QASYN-13-TC2RTV`. Q40's own finding (`ShipTo` from delivery company, dedicated
outbound sender) is unaffected by this change and stands as already Answered.

**Original finding below, for the record.**

**Is Manhattan SCALE missing a warehouse configuration for the wholesale warehouse, or is the code
sending the wrong code?** A synthetic `CREATE_OUTBOUND_ORDER` (`QASYN-12-TC2`, WHOLESALE, full detail
in `BUSY-1065-sales-orders/BUSY-1160/results/08-final-sweep-before-dev.md`) traced cleanly through the entire
outbound pipeline (Q35's update, same session) to the dedicated outbound sender,
`staging-shipping-manhattan-send-outbound-shipment`, which called the real Manhattan API and got a
real rejection:
```
ManhattanRejectionError: Manhattan rejected shipment QASYN-12-TC2: SHIPMENT XML Download  ended. : Invalid shipment (QASYN-12-TC2):Invalid warehouse "CTC-WH". -
```
**Not a synthetic-payload artefact.** `"CTC-WH"` is exactly what the poller's own lookup produces for
the wholesale branch:
```
var WAREHOUSE_BY_BRANCH_ID = { 51909: "CTC-QDC", 51908: "CTC-WH" };
```
This code has been deployed and would produce the identical string for any real wholesale order from
branch 51908, synthetic or not. **Isolated as specific to the warehouse code, not the pipeline**: a
second synthetic emit (`QASYN-13-TC2RTV`), identical in every other respect but with the warehouse
forced to the known-valid `CTC-QDC`, was **accepted by Manhattan** in full
(`OUTBOUND_SHIPMENT_SENT`). Only the warehouse code differed between the rejected and accepted emits.

**Consequence if unfixed**: every wholesale order from the wholesale warehouse (branch 51908) would
be rejected by Manhattan the moment the outbound pipeline is exercised for real, regardless of
anything else about AC1 being correctly implemented (and per Q35/Q40's update, it is). This is now the
single concrete blocker standing between "the wholesale pipeline works" and "a real wholesale order
would actually get through."

**Raise with Kian**: is `"CTC-WH"` the code Manhattan's own configuration should have, and does
provisioning it there fix this, or does the code need to send a different string. Not testable further
by this plan -- Manhattan's own warehouse configuration is outside AWS-CLI reach.

## Q42, new 2026-09-09 from BUSY-1160 TC22, ANSWERED the same day by Kian

**Is refusing `taxStatus: "Undefined"` with a hard error deliberate?** Cin7's own API docs give four
values. BUSY-1160 slice 02 read the deployed code and found the fix already in for three of them
(`Exempt` no longer hard-errors); `Undefined` still hard-errors, and nothing said whether that was
intended. `TRIED 2, CONFIRMED` on the factual half by then: a retrospective sweep found the value on
no real order, and a direct code read found the branch. The remaining half was
`NOT TESTABLE, decision`, so it was fair to ask.

**Carried on BUSY-1160's TC22 row as "1 residual item" from 2026-08-28 onward and never given a Q
number until this wrap-up.** That is why it kept being described as an open item with no state:
it was not in this register at all.

**ANSWERED 2026-09-09 by Kian.** "I searched Cin7 and couldn't find any orders with Undefined. All had
the other 3 values so I figured Undefined is probably worth pausing on and fixing?" His search agrees
with QA's own: two independent sweeps, no occurrence. **JJ's call the same day: not an issue, since no
real order carries the value.** Fix in flight rather than open, and the re-test is one line, that the
fourth value stops hard-erroring, whenever it lands. `BUSY-1065-sales-orders/BUSY-1160/results/02-taxstatus-coverage.md`.

## Closed from evidence, 2026-09-07. JJ's calls after R11 and R13

Four items were queued as questions for Kian and are closed from measurement instead. **JJ's
direction, 2026-09-07: where QA has the evidence, write the verdict, do not ask the question.**

**BUSY-1158 AC5 passes, with the guard absent and no side effect.** MEASURED, R13: all 9 fresh CTC
orders reached `faulty-sale-worker-queue-handler` (populator forwarded 9, handler consumed 9 across 4
SQS batches, `staging-inventory-check-order-faulty-sale` invoked 9 times), EventBridge rule still
unconditional `{"detail-type":["TRANS_CREATE_ORDER"]}`, no origin or company filter. **Nothing
downstream fires:** zero events on `staging-inventory-bus` in tight windows (R1), zero
`ConsumedWriteCapacityUnits` on `staging-inventory-v2` over the invocation buckets (R11 Gate D2, metric
confirmed live by a Sum=2.0 datapoint one minute earlier), and warm durations of 3.49ms median across
32 CTC invocations against 27.02ms across 129 non-CTC (R11 Gate D1), consistent with a fast bail. No
UNI machinery is triggered, which is what AC5 exists to prevent. The split Kian described on
2026-08-31 has not landed and is not needed for AC5 to pass. Residual exposure is logging only, which
belongs to BUSY-1162.

**TC4f needs rewording, not running.** It is written as "no CTC reference in the log group at all
after the CTC split lands". The split is not coming and AC5 passes without it, so the case as written
is unachievable. Rewrite it to the AC's intent (no downstream side effect on a CTC record) or withdraw
it. Currently sits NOT RUN.

**AC8, `company`: verified as discovered.** MEASURED on fresh data both sides, R13: CTC shipment
header carries `company: CTC`; a fresh UNI shipment header has no `company` attribute at all. Matches
the LLD's static `CTC` and its statement that the explicit field replaces brand inference in
dc-packing. **Documented limit:** on a UNI order the new behaviour cannot be distinguished from the
old, so TC7 and TC7b are NOT APPLICABLE on that class of order rather than INCONCLUSIVE. Q29's
mid-flight `UNIVERSAL` value being discarded before save is consistent with `company` being CTC only
and is not pursued further.

**`origin_index` is on the orders table and always has been.** JJ, 2026-09-07: it is not coming to
`staging-shipments` and that is not changing. The lookup path is the order's own PK to the shipment
row, which `inspect-ctc-order.sh` already does. The LLD's claim that BUSY-1103 delivers `origin_index`
on shipments is a document correction for Lachlan, not a build gap. Q37 closed.

**TC9 and TC15 are untestable in staging.** No DLQ fixture exists (stage 5 sender DLQ at 0 waiting, 0
in-flight, re-checked 2026-09-07), Cin7 is read only so a rejection cannot be manufactured, and
`kian-dev` is not a staging environment so a fixture parked there proves nothing for staging QA.
Recorded as UNTESTABLE with the reason and handed to E2E, not left BLOCKED pending a person.

**The poller's 5 minute lookback is correct behaviour, not a gap.** The watermark is set to the newest
`modifiedDate` seen after all pages are processed, each cycle fetches `[watermark - 5 min, invoke
time]`, and the cadence is 2 minutes, so consecutive windows overlap and nothing can fall between two
of them. Re-covered orders are suppressed by the echo guard (`echoSkipped=2` measured on R13's second
cycle). **The only consequence is for QA:** a watermark set for a test is effectively 5 minutes
earlier, so a narrow window always carries an extra 5 minutes of traffic. That is what widened R5's
intended 6-order window to the 8 the poller fetched. Recorded in TOOL-NOTES, not raised with dev.

**Still with Kian:** repo or build access, and whether QA may read the deployed poller artifact.
**Handed to Kian as a dev-environment ask, not a question:** ECOM orders at `Fully Picked` and
`Partially Picked`, the only two stages in the LLD's eligible set never observed for an ECOM order.
