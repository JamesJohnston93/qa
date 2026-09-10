# Slice 18, the three unrun cases. What a sign-off is waiting on

**DONE, 2026-09-10. Do not re-run.** All four stages ran, `results/18-unrun-cases.md`.
TC16b **PASS**, TC6b **UNTESTABLE** for want of a fixture, TC6c **INCONCLUSIVE** with a three-order
closing query. **It also surfaced TC6d**, the empty-`sizes[]` divergence, now `slices/19-empty-sizes-fallback.md`
and register **Q43**. Its KICKOFF prompt has been removed.

**Ticket:** BUSY-1159 only.
**Cases:** TC6b, TC6c, TC16b. All three are `PROPOSED` and none has ever run.
**Added:** 2026-09-10, at JJ's request, so every unrun case on this ticket has a slice.
**Depends on:** nothing that has not already run. Reads `QA-DOC.md`'s drift table for context only.

**Why this slice exists.** The 2026-09-10 sign-off is not blocked by a defect. It is blocked by these
three cases being unrun. Close them and the doc is signable with its four standing limits. All three
came out of the 2026-09-09 LLD re-verification, each naming an LLD clause nothing else in the table
reaches.

**Nothing here needs a fixture created, a watermark move, or the schedule enabled.** If a stage looks
like it needs one, it has drifted from what it was written to do. Stop.

All the plan's standing rules apply: `../CLAUDE.md`. Cin7 read only, GET only. Field allowlists on
every log read, never a whole record. Tag every claim MEASURED, INFERRED or UNKNOWN.

---

## Read this first: the hazard that governs S4

**Do not run `aws sqs receive-message` against `staging-shipping-manhattan-sender.fifo`, or against
its DLQ, at any point in this slice.**

`MessageGroupId` is not exposed by `GetQueueAttributes`. The only API that returns it is
`ReceiveMessage`, and receiving a message **increments its `ApproximateReceiveCount` and starts its
visibility timeout**. On this queue that does three kinds of damage:

1. **It corrupts slice 16 S3's evidence.** That stage counts receives to 21 against a
   `maxReceiveCount` of 20 to measure the parking mechanism. Every receive we make is a count S3 then
   misreads as a retry the system made.
2. **It can dead-letter a live message early**, including a real one, by pushing it over the limit.
3. **A FIFO receive blocks its message group** for the visibility timeout, which here is 1500 seconds.

An earlier draft of slice 16 S1 step 6 told a runner to read `MessageGroupId` off that queue directly.
**That instruction was wrong and has been corrected in place.** S4 below reaches the same LLD claim
without touching the queue.

---

## S1. Find the fixtures for TC6b and TC6c in one pass. Free, read only

Both TC6b and TC6c need a real order of a particular shape, and neither shape has ever been looked
for. **Run this before S2 or S3**, so a session does not spend two stages discovering there is no
fixture.

**Steps**

1. **TC6b's shape: an ECOM order carrying a style line with two or more sizes.** Per LLD §5 a Cin7
   `lineItems[]` entry is a **style**, and its `sizes[]` array holds the real item codes. So the shape
   is one `lineItems[].id` against two or more distinct `sizes[].code`. Read it from **our own tables**,
   not Cin7: the shipment items for a CTC order carry `sku` and `lineItemId`, so a style with two sizes
   shows up as two or more distinct `sku` values sharing one `lineItemId`. Survey the CTC orders already
   in `staging-orders-v2` and `staging-shipments` and report every order that has one, with its
   reference, the `lineItemId`, and the distinct `sku` count.
2. **TC6c's shape: an order carrying a `sizes[]` entry at `qty: 0`.** This one **cannot** be found from
   our tables, because §5 says a zero-quantity size produces no record at all, so the absence is
   invisible downstream by design. It has to come from the Cin7 side of an order we already hold.
   **Do not call Cin7 for this.** Instead report what our tables would show as the symptom, that is an
   order whose stored item rows do not reconcile to the Cin7 line total, and hand the Cin7 confirmation
   to JJ as a named query.
3. **Report the population, not just a hit.** How many CTC orders were surveyed, how many carry a
   multi-size style, and the largest distinct-size count seen. That number is what tells a later reader
   whether "no fixture" means rare or means never.

**Any script with logic here goes in `scripts/` with a row in `SCRIPTS.md` before it runs.** Check
`SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first: `inspect-ctc-order.sh` already reads back the whole
chain for one reference, so a survey may only need a loop over references it already prints.

**Reads as**

* One or more multi-size fixtures found: run S2 against the cleanest, preferring one whose style has
  two sizes with different quantities, for the reason in S2 step 2.
* None found across the whole CTC population: **that is TC6b's answer**, not a failure. It becomes
  UNTESTABLE-for-want-of-a-fixture with the population number attached, on the same footing as TC9,
  and it is handed to E2E. Say the number.
* Zero-quantity symptom found on an order: S3 can proceed on the reconciliation half. Otherwise TC6c
  goes to JJ as a Cin7 query and stays PROPOSED.

---

## S2. TC6b, a multi-size ECOM style. Free, read only, needs S1's fixture

**Current verdict:** PROPOSED, never run.

**What the LLD requires, and it is stated three times.** §11.5: "a multi-size style produces **one
detail line per size sharing one `ErpOrderLineNum`**". §5: "**Detail-line identity is the pair
(`ErpOrderLineNum`, `SKU.Item`), not `ErpOrderLineNum` alone.** Every size expanded from one style
carries that style's `lineItems[].id`, so the line number repeats across the sizes of a style", and "a
style line cannot carry the same size twice". §10.2 carries "sizes of one style collapse into a single
record" as a risk, mitigated by a test over a multi-size style.

**Why TC6 does not already cover this.** TC6's fixture `WOR19261` is a **single-size** style at
quantity 2. Its aggregation to one SCALE line at Total Qty 2 is correct and LLD-supported (§11.5,
"quantity ... aggregated from unit rows for ECOM"). The multi-size case is a different shape and it is
the one the identity-pair contract feeds into BUSY-1015/1016/1017. **Do not read TC6's PASS as
covering it.**

**Steps**

1. **Our side, the whole assertion.** For S1's fixture, read the shipment item rows: `SK`, `sku`,
   `lineItemId`, and whether a `quantity` attribute is present. Expect **one row per unit**, per LLD
   §5 and the ECOM column of the per-type matrix, so the row count equals the sum of `qty` across the
   style's sizes, with **distinct `sku` values sharing one `lineItemId`** and **no `quantity`
   attribute on any row**.
2. **State the shape precisely, because two rules combine here and it is easy to report half of it.**
   A style with size L at qty 2 and size S at qty 1 should give **three** item rows on our side (two
   carrying L's code, one carrying S's), all sharing one `lineItemId`, and **two** SCALE detail lines
   (L at quantity 2, S at quantity 1). Per-unit on our side, per-size at SCALE. Prefer a fixture with
   unequal quantities so the two rules are distinguishable in one reading; if the only fixture has
   qty 1 on every size, say so, because then per-unit and per-size are indistinguishable and the
   reading is weaker.
3. **The SCALE half is out of reach and must be said so, not skipped.** `ErpOrderLineNum` is not
   readable in the Planned Shipment Insights screens (D8), and the sender never logs its outbound XML,
   so the pair cannot be observed from either side. Record the SCALE half as **UNKNOWN, handed to
   E2E**, and do not infer it from our own rows.

**Reads as**

* Row count equals the summed quantity, distinct skus share one `lineItemId`, no `quantity` attribute:
  propose **TC6b PASS on the our-side half, MEASURED**, with the SCALE half UNKNOWN and named for E2E.
* One row per size rather than per unit, or a `quantity` attribute present: that contradicts §5's ECOM
  grain and the per-type matrix, and it would also put a foreign grain into the native shipment-item
  family, which §9.2 says every UNI consumer's one-row-is-one-unit assumption rests on. **That is a
  FAIL and a real defect.** Stop and report rather than continuing to S3.
* Sizes collapsed into a single record: that is §10.2's named risk realised. **FAIL**, stop and report.

---

## S3. TC6c, zero-quantity size entries. Free, read only

**Current verdict:** PROPOSED, never run.

**What the LLD requires.** §5: "**Zero-quantity sizes are skipped.** Cin7 emits `sizes[]` entries with
`qty: 0` ... No record and no `ShipmentDetail` is produced for them: a detail line with
`SKU.Quantity = 0` either creates a pick for nothing or is rejected, and neither is useful. **They are
counted, not alerted.**" §4 step 5: "Size entries with `qty: 0` are skipped **in both**", so it applies
to ECOM and not only to bulk. §11.5: "zero-quantity size entries produce no `ShipmentDetail`, **and the
remaining lines still reconcile to the line total**".

**The trap in this case, and it is why the reconciliation half matters.** A zero-quantity size that is
correctly skipped and a zero-quantity size that was never in the source look identical in our tables:
both are an absent row. **An absent row is not evidence of a skip.** The two things that can be
evidenced are the **counter** and the **reconciliation**, and the case must rest on those.

**Steps**

1. **The counter is the primary evidence.** §5 says these are counted. Find the counter the poller
   prints for skipped zero-quantity sizes and read it over a window that includes a known cycle. If no
   such counter exists in the poller's output, that is itself a finding against §5, because §5 says
   they are counted. Say which you found.
2. **Reconciliation, if S1 surfaced a candidate.** For an order whose Cin7 line total exceeds the sum
   of its stored item rows, confirm the difference is exactly the zero-quantity sizes and not a lost
   row. The Cin7 half of that comparison is **JJ's**, per the standing credentials rule; name the
   order and the query rather than making the call.
3. **Do not read an absent row as a pass**, per the trap above. If neither the counter nor a
   reconciliation candidate is available, the case stays PROPOSED and says why.

**Reads as**

* Counter present and non-zero over a window, with a reconciliation that accounts exactly: propose
  **TC6c PASS, MEASURED**.
* Counter present and zero across every window, with no candidate order: **not a pass.** It means the
  condition has not occurred in the population, so the case is UNTESTABLE-for-want-of-a-fixture with
  the window stated. Note that §5 records two zero-quantity sizes on the largest **wholesale** order,
  which is out of scope here, so ECOM may simply never produce one.
* No such counter in the poller's output: a finding against §5's "they are counted". Raise it as a
  drift row, not a defect, since nothing is lost by it.

---

## S4. TC16b, the FIFO message group. Free, read only, and it does not touch the queue

**Current verdict:** PROPOSED, never run.

**Read the hazard block at the top of this file before this stage.** The queue is not to be received
from.

**What the LLD requires, and why it is not TC16.** §3's message-group touch-point: "The populator's
fallback stringifies `undefined` into a truthy `\"undefined\"`, so every event lacking a
`message_group_id` lands in **one global FIFO group**, one poisoned message would serialise and then
block all Manhattan sends. **Transactions are safe** (the writer re-emits with `message_group_id` =
PK); **native domain events must be verified to carry it, and the populator fallback fixed as part of
this build.**" §10.2 carries it as a risk whose mitigation is "populator fallback fixed; native
domain-event emissions verified to carry `message_group_id` = order PK; covered with tests". §9.3:
"FIFO grouping is load-bearing".

**QA doc TC16 reads the transaction hop, which §3 says was never at risk.** This stage covers the two
things §3 actually asks for, and they are separate claims. Keep them separate in the result.

**Steps**

1. **Claim A, the populator fallback.** Resolve which function populates the Manhattan sender queue
   before assuming it: read the queue's event source mappings by queue ARN
   (`lambda:list-event-source-mappings`), and the rule targets that feed it. **Do not guess the name**,
   and note that three sessions on this epic have already misread this queue's consumer. Then
   `../../tools/inspect-lambda-code.sh` against the resolved populator, searching for the fallback: the
   literal string `undefined`, and `message_group_id` / `messageGroupId`. Report whether a truthy
   `"undefined"` fallback is still reachable in the deployed bundle.
2. **Claim B, native domain events carry the group.** The non-destructive route is the populator's own
   log line, which records the event it received and the group it assigned, so read that for the nine
   R13 references over their cycle window, field allowlist only, and report the `message_group_id` it
   assigned against the order PK. If the populator does not log the group, say so and fall back to the
   transaction records in DynamoDB, which per §3 carry `message_group_id` = PK. **State which source
   you used**, because the transaction record evidences the transaction hop and the populator log
   evidences the native-event hop, and only the second answers this case.
3. **Cite the incidental evidence rather than re-deriving it.** The roughly 5 pre-fix synthetic poison
   messages from the 2026-09-08 BUSY-1160 session **each sat in their own FIFO message group and
   blocked nothing while other traffic drained**, MEASURED. That is direct evidence that distinct
   groups were being assigned at that time. Cite it, and say it is incidental and pre-fix, so it does
   not carry the current build on its own.

**Reads as**

* Fallback not reachable in the deployed bundle, and the populator assigned the order PK as the group
  on all nine: propose **TC16b PASS, MEASURED**, with claims A and B stated separately.
* Fallback still reachable but every observed event carries a group: **not a pass.** §3's risk is that
  an event **lacking** the field collapses every Manhattan send into one group, so the guard being
  absent while the observed traffic happens to be well formed is a latent defect, not a passing test.
  Propose INCONCLUSIVE and raise the fallback as a finding with §10.2 cited.
* Any observed group equal to the literal `undefined`, or a single group shared across unrelated
  orders: **FAIL**, and it is the failure §3 predicts. Stop and report; this one blocks Manhattan sends
  generally, not just CTC.

---

## Deliverable

`results/18-unrun-cases.md`, one section per stage run, each naming the verdict it proposes and the
evidence behind it. **Propose row changes, do not edit `QA-DOC.md`**: it is at 28 cases and Confluence
is at version 15, and they are synced, so an edit here would desynchronise them.

If every stage lands, this ticket's sign-off can be re-derived and the doc becomes signable with its
four standing limits. Say so in the result if it does.

## Stop and ask JJ if

* A stage appears to need a fixture created, a watermark move, or the schedule enabled. None should.
* Anything wants a Cin7 call. S1 step 2 and S3 step 2 both end at a named query that is JJ's to run.
* **S2 finds per-size rows, a `quantity` attribute, or collapsed sizes**, all of which are FAILs
  against LLD §5 and §9.2 and change this ticket's sign-off.
* **S4 finds a shared or `undefined` message group**, which is broader than this ticket.
* You are about to receive a message from either Manhattan FIFO queue. Read the hazard block again.
