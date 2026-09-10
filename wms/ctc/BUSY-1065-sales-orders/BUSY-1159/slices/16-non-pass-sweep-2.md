# Slice 16, non-PASS sweep 2, the injection-reachable rows

**Ticket:** BUSY-1159 only.
**Cases:** TC9, and a proposed re-word of TC15.
**Depends on:** `../BUSY-1160/results/03-synthetic-harness-and-fidelity.md` (**Gate A passed
2026-09-08**), `../BUSY-1160/results/04-revision-reconciliation.md`,
`../BUSY-1160/SYNTHETIC-REGISTER.md`, `results/07-failure-handling.md`,
`results/06-routing-and-isolation.md`.
**Runs after:** slice 15. Nothing here is cheaper than anything in slice 15, with the exception of S1,
which is free and should run first regardless.

**Rewritten 2026-09-08 evening.** The first version of this file planned a fresh poison message to
manufacture TC9's fixture. A BUSY-1160 session ran between 01:24 and 06:01 the same day and, as a side
effect, **appears to have already emitted it**. This version reads what exists before it emits
anything new. JJ's decision, 2026-09-08 evening: read the existing emit first, and only propose a
dedicated emit if that read comes back ambiguous.

---

## Amended 2026-09-09, re-verified against the LLD

Checked against LLD page 1802698758 as source of truth. **Three stages changed and one stop-and-ask
item is gone.**

1. **S3's pass condition inverted.** §6 and §11.5 classify a SCALE rejection as a **permanent**
   failure. 20 SQS redeliveries is the transient path, so receive count 21 confirms BUSY-1160's D5
   rather than passing AC8. TC9's expected result changes with it.
2. **S2's step 1 no longer pauses the stage.** The synthetic SKU's absence from the item master
   follows from §5's item-key contract, so it is a citation, not a manual SCALE read. Two corrections
   ride along: expect shipment-level rejection, and `wmsSentAt` is a header field with no per-line
   equivalent.
3. **S2 gained a competing cause**, §6's update-on-a-waved-shipment rejection.
4. **S1 gained a step** covering §3's message-group risk, which no QA doc case reaches today.

## Read this before touching the 1160 folder

**Case numbers collide across tickets.** BUSY-1160 has its own TC5, TC6, TC7, TC8, TC9, TC10, TC11,
TC13, TC14, TC18 and TC19. They mean entirely different things from 1159's cases of the same number,
and `../BUSY-1160/SYNTHETIC-REGISTER.md` labels its rows with 1160 numbers.

* 1160's **TC9** is "an address-only revision emits no item lines". PASS.
* 1159's **TC9**, this file's subject, is "a SCALE rejection throws, no `wmsSentAt`, the message parks
  on the DLQ". UNTESTABLE.

**Never carry a verdict across folders on a matching number.** Two corrections on this epic already
came from misreading which record did what.

## Why TC9 is reachable at all

TC9's acceptance criterion, AC8, lives entirely downstream of the poller:

`staging-orders-v2-event-bus` to `staging-orders-v2-eda-queue-populator` to `staging-orders-v2` to
the shipping worker to `staging-shipments` to `staging-shipping-manhattan-sender.fifo` to
`staging-shipping-manhattan-send-shipment` to SCALE, and on rejection to
`staging-shipping-manhattan-sender-dlq.fifo` (`maxReceiveCount` 20, `VisibilityTimeout` 1500s).
MEASURED, `results/02-create-end-to-end.md` and `results/07-failure-handling.md`.

Cin7 is the only read-only link in the chain and TC9 does not need it. Every hop from the bus onward
is staging AWS that QA can write to.

**Slice 15's out-of-scope list is amended, not overridden.** TC15 and TC14 stay out. Only TC9 moves.

## The fixture that may already exist

`../BUSY-1160/SYNTHETIC-REGISTER.md` seq 02, `QASYN-02-TC11`, seeded from real order `262211`.

* Its **pre-fix** add-line carried a non-numeric `lineItemId` (`QASYN<8hex>`). The Manhattan-side
  handler `staging-shipping-manhattan-manhattan-eda-queue-handler` refused to forward it:
  `"refusing to send a corrupted ErpOrderLineNum to SCALE"`. MEASURED, `../BUSY-1160/TOOL-NOTES.md`.
  **That is not TC9.** It is our own pre-send guard rejecting a shape real Cin7 data cannot produce,
  the BUSY-1260 C5 class of error. It never reached SCALE, so it evidences nothing about AC8's cause.
* Its **post-fix** add-line persisted with a valid numeric `lineItemId` (`9152082`) and a synthetic SKU
  of the form `QASYN-SKU-<6hex>`. MEASURED that it persisted. **Whether it reached SCALE, and what
  SCALE did with it, was never waited out.** UNKNOWN.

That post-fix line is TC9's fixture on its face: well formed, valid `lineItemId`, and an item code that
is by construction absent from the SCALE item master, which is exactly what real order `261073`
produced pre-deploy. **It is on its face only.** Whether the SKU is genuinely absent from SCALE's item
master is an assumption until S2 step 1 checks it, and whether SCALE validates the item master on an
add-line path at all is UNKNOWN.

---

## S1. Re-baseline the sender DLQ. Free, read only, five minutes

**Run this first, and run it even if JJ declines everything else in this file.** It is a doc
correction and it protects TC11's row from being misread.

**The contradiction, and it is now three-way.**

* The 2026-09-08 START HERE records "Stage 5 sender DLQ empty".
* `results/06-routing-and-isolation.md`, `results/01-environment-gate.md`, `fixtures.md` and
  `STATE.md` all record **exactly 3 dead-lettered**, consistently. Weight of local evidence says 3,
  and the START HERE line is the suspect one.
* **Since then, roughly 5 pre-fix synthetic messages have been retrying** in
  `staging-shipping-manhattan-sender.fifo`, one per affected synthetic order, each working through its
  own `maxReceiveCount` of 20 in its own FIFO message group. They are expected to dead-letter on
  their own within roughly 8 hours of their emit, which puts them landing overnight 2026-09-08.
  MEASURED that they exist and are retrying, INFERRED on the landing time.
  `../BUSY-1160/SYNTHETIC-REGISTER.md`, side-effects table.

**JJ's decision, 2026-09-08 evening: let them land, re-baseline, note it. Nothing is purged.**

**Steps**

1. Read `ApproximateNumberOfMessages` and `ApproximateNumberOfMessagesNotVisible` on
   `staging-shipping-manhattan-sender-dlq.fifo` and on `staging-shipping-manhattan-sender.fifo`.
   Record all four with a timestamp.
2. For each message now on the DLQ, extract the reference only, never the whole message. Separate
   `QASYN-` references from real ones. That split is the whole point of the stage.
3. Say which of the two doc statements was right, correct the wrong one, and record the real count.
4. **Record the new number as TC11's control baseline from this point forward, with the split.** The
   row must read as: baseline 3 real, plus N synthetic put there by QA on 2026-09-08, so growth beyond
   3 + N is what would indicate a leak. Without that note the next reader sees growth and reads it as
   a UNI leak into the CTC path, which would be wrong.
5. Cross-check the count against the register's side-effects table and reconcile any difference.
6. **Corrected 2026-09-10. Do not read `MessageGroupId` off this queue.** An earlier version of
   this step told you to. That was wrong: `MessageGroupId` is only returned by `ReceiveMessage`, and
   receiving **increments `ApproximateReceiveCount`** and starts a 1500 second visibility timeout on
   that message's group. On this queue that corrupts **S3's own evidence** (it counts receives to 21),
   can dead-letter a live message early, and blocks the group meanwhile. **TC16b is now owned by
   `18-unrun-cases.md` S4**, which reaches the same LLD claim through the populator's artefact and
   logs without touching the queue. Nothing to do here.

**Reads as.** Four numbers, a timestamp, and a reference split. This stage cannot fail.

**Note for the row, not a test.** `../BUSY-1160/` records that stage 5 is CTC-only, not shared with
UNI traffic, per `check-ctc-status.sh`. If that holds, TC11's no-growth control was never a strong
test of UNI leakage in the first place, because a UNI message has no route onto that queue to begin
with. TC11's PASS stands as measured. Flag the control's weakness as a doc note and let JJ decide
whether the row is re-worded. Do not re-run TC11.

---

## S2. TC9's immediate half, by reading what already exists. Free, read only

**Current verdict:** UNTESTABLE. Passed pre-deploy on `261073`, cannot be re-run on the current build,
handed to E2E.

**Why it is not a clean PASS.** The pass is on a build that no longer exists. AC8 has no evidence under
the deployed code.

**What this stage changes.** It stops planning a fresh poison message and instead reads the fate of an
add-line that was already emitted, whose item code is absent from the SCALE item master by
construction. If that read answers AC8, TC9 costs nothing.

**Gates.** Only two, and both already hold:

1. `../BUSY-1160/` Gate A passed: a no-mutation replay matched the poller's own real `Pushed` emit
   field by field, key set included, measured against a real `CREATE_ORDER` log line for order
   `#262208`. MEASURED.
2. S1 has run and the DLQ baseline is recorded.

**There is no poison-message gate on this stage.** It emits nothing.

**Steps, each able to end the stage early**

1. **The premise holds by construction, so this is a citation and not a read. Rewritten 2026-09-09,
   and the stage no longer pauses here.** §5: "`SKU.Item` is the Cin7 **product option code**, the
   cross-document contract with the CTC Item Master integration, **which loads SCALE's item master
   keyed on the same value**." The item master is loaded from Cin7 option codes. `QASYN-SKU-<6hex>` is
   not a Cin7 option code and cannot become one, so its absence follows from the item-key contract.
   `SKU.Item` is `stringLength_50` per §5's build rules, so the synthetic value is shape-valid and
   will be sent rather than refused locally. **Tag this INFERRED-from-design, not MEASURED**, and say
   so in the result file's first line. No manual SCALE item-master read is needed.
   **Expect shipment-level rejection, not line-level.** §5: "an id sent as an item key matches nothing
   in SCALE and **every line on the shipment fails**", and §9.4 says the same of an unloaded master.
   So step 4 should expect the whole transaction rejected, not one line.
2. Read the `staging-shipments` row for `QASYN-02-TC11`, field allowlist only: item count, the item's
   `SK`, `sku`, `lineItemId`, status, and the header's `wmsSentAt`.
   **`wmsSentAt` is not a discriminator on this order.** The register records that its advance
   reflects other activity, not this line's acceptance. Read it, do not conclude from it.
3. **Read the Manhattan sender's own log for this specific item.** `lineItemId` `9152082` and the
   item's `SK`. This is the load-bearing read: `../BUSY-1160/TOOL-NOTES.md` says plainly that any case
   needing "reaches SCALE" must check the handler's own log for that item, not assume a DynamoDB write
   is sufficient.
4. Read the SCALE response for the send carrying it: `acceptedTransactions` and
   `rejectedTransactions`.
5. Read the sender queue for a message still in flight in that item's FIFO message group.

**Reads as**

* **Sender threw or SCALE returned `rejectedTransactions > 0` naming the item, shipment row present,
  no `wmsSentAt` advance attributable to this send:** AC8's first two thirds are MEASURED on the
  current build. (**Corrected 2026-09-09:** an earlier draft read "no send stamped for this line".
  There is no per-line stamp. `wmsSentAt` is a **header** field, §3's record model.) Propose
  TC9 moves from UNTESTABLE to **PARTIAL PASS on a synthetic fixture**, with the row stating plainly
  that the input was injected, that injection proves the handler's behaviour given the input and not
  that the input occurs, and that the rejection cause is an absent item code. S3 then closes the DLQ
  third.
* **SCALE accepted it:** the premise in step 1 is false, or SCALE does not validate against the item
  master on this path. **That is a finding worth more than the case**, because TC9's whole pre-deploy
  pass rests on an absent option code being rejected. Record it, do not force TC9 through, and move to
  S4.
* **The item never produced an outward event at all:** INCONCLUSIVE, and **name which suppressor did
  it before writing anything.** The idempotency index on
  `<event>#<origin>#<modifiedDate>#<payloadHash>`, the version guard on stored `lastModified`, or the
  FIFO content dedup over 5 minutes. A bare absence is not a pass. The version guard names itself in
  the log as `SalesOrderStaleRevision`, MEASURED on `QASYN-01-TC12`, so its absence eliminates it by
  evidence rather than by inference.
* **Rejected, but for a different reason than the item code.** Added 2026-09-09. `QASYN-02-TC11` is an
  add-line onto a shipment that already sent successfully, so §6 names a competing cause the stage's
  suppressor list misses: "**Update/delete on a waved or completed shipment**, the HLD's flagship
  business rejection." Unlikely to bite, since the DC has waved nothing and a downloaded shipment
  rests at `In Pool`, but attribution is the entire value of this stage, so rule it out from SCALE's
  `message` rather than assuming. A third cause is §6's "`XML Schema Validation failed` messages are
  classified as our configuration bug", which is a different bucket again.
* **A retryable and a permanent rejection are indistinguishable:** `../BUSY-1160/` records that both
  arrive as HTTP 200 carrying `rejectedTransactions > 0`, with no discriminator named in the ticket or
  the LLD. If that is what you find, say so. It is the same specification gap 1160's TC17 carries, and
  it belongs on Lachlan's list, not in a verdict.

---

## S3. TC9's DLQ third. Free, and the fixture is already in flight

**Do not try to finish S2 and S3 in one sitting.** `maxReceiveCount` is 20 at a `VisibilityTimeout` of
1500 seconds, roughly 8 hours to park. INFERRED from the queue configuration, not measured on a real
parking event.

**This stage got cheaper.** The roughly 5 pre-fix synthetic messages from the 1160 session are already
retrying and should park overnight. They park for the **wrong reason** for TC9, our own pre-send guard
rather than a SCALE rejection, so they cannot evidence AC8's cause. **They can evidence the parking
mechanism itself**, which is AC8's third part and has never been measured on the current build.

Keep the two claims separate in the result file. Conflating them is how this stage goes wrong.

**The pass condition inverted on 2026-09-09. Read this before running the stage.**

An earlier version of this stage treated **receive count 21 as the measured pass**. Against the LLD it
is the opposite. §6: a `rejectedTransactions > 0` on HTTP 200 "is a failure ... the senders parse the
`interfaceResponse` and treat rejections as **permanent failures** despite the 200", and §11.5 says
the same, "`rejectedTransactions > 0` on HTTP 200 to **permanent-failure path**". §6 defines
**permanent** as "DLQ + SNS alert naming flow, company, `ShipmentId`, and the hop that failed", while
**transient** is the bucket where "SQS redrives each hop".

**So 20 redeliveries before parking is the transient path, and a stage that confirms 21 and calls it a
pass records the deviation as the specification.** This is BUSY-1160's **D5** reached from the other
side: classified permanent and alerted, but the caller rethrows on every branch so it redelivers 20
times anyway. **JJ's call 2026-09-09: cite D5, do not open a second defect.**

Second half of the same point, and it belongs in TC9's row rather than only in TC20's: §6's permanent
bucket requires an alert naming flow, company and `ShipmentId`. TC20 measured **both SNS topics at
zero subscribers**, so the permanent contract cannot be satisfied in staging whatever the retry count
does.

**Steps**

1. Read the DLQ the next working morning and compare against S1's baseline.
2. For each newly parked message, extract the reference and `ApproximateReceiveCount` only. Record the
   count. **21 evidences the parking mechanism and simultaneously confirms D5 on the current build.**
   It is not evidence that §6's permanent classification is implemented.
3. Separate: which parked because of the pre-fix `lineItemId` guard, and which, if any, parked because
   SCALE rejected the item code. Reference and the sender log line are what tell them apart.
4. Update `../BUSY-1160/SYNTHETIC-REGISTER.md`'s "Reached SCALE" column for each, and its side-effects
   table.

**Reads as**

* Parked at receive count 21: **the retry-to-DLQ mechanism is MEASURED on the current build**, and
  **D5 is confirmed on the current build in the same reading**. Propose the parking mechanism as AC8's
  third part, tagged as evidenced by a guard rejection rather than a SCALE rejection, and record
  against TC9 that the 20 redeliveries are the transient path where §6 requires the permanent one,
  citing D5.
* Combined with an S2 that found a real SCALE rejection on the same order: **AC8 is MEASURED end to
  end on the current build** and TC9's row becomes a full PASS on a synthetic fixture.
* Depth unchanged after a full working day: the retry path has changed since the pre-deploy build.
  That is a finding, not a failed test. Read the sender's log for the messages' fate.

**If inconclusive.** Measure the retry interval directly off the sender's log timestamps for one
message rather than waiting a second time.

---

## S4. A dedicated TC9 emit. Contingent, and needs JJ's go

**Do not run this unless S2 came back ambiguous**, meaning SCALE accepted the synthetic SKU, the item
never reached the sender, or step 1's absence premise could not be established.

If S2 answers TC9, this stage is dead and should be struck rather than carried to the next sweep.

**If it is needed, what it costs, and JJ decides before the first emit**

* One message parks permanently on `staging-shipping-manhattan-sender-dlq.fifo` and shifts S1's
  re-baselined control again.
* One rejected send hits Manhattan SCALE staging 20 times.
* The record stays in `staging-orders-v2` and `staging-shipments` with no Cin7 order behind it.

**The harness cannot do this today, and that is the real blocker.** `emit-synthetic-revision.sh`
accepts `--mutation none|add-line|remove-line|change-qty|change-address|cancel|bump-modified`. **There
is no option-code mutation**, and `add-line` generates its own `QASYN-SKU-` value rather than swapping
a code on an existing line. So this stage needs either a harness change or a deliberate reuse of
`add-line`'s generated SKU. If S2 already proves `add-line`'s generated SKU is rejected by SCALE, the
reuse is the answer and no harness change is needed.

**The C5 guard applies.** The mutation must be a value swap on a well formed field, leaving `SK` and
`sku` shape intact, and the emit must be registered in `../BUSY-1160/SYNTHETIC-REGISTER.md` under
`QASYN-<seq>-1159TC9`, under 25 characters, **before** the emit. Note in the Case column that the
record belongs to BUSY-1159 though the register lives in the 1160 folder. One register, not two.

---

## S5. TC15, still a question for JJ, not a stage

**Current verdict:** UNTESTABLE. Passed pre-deploy, handed to E2E. **Unchanged by anything the 1160
session found.**

**The honest position.** TC15 asks that a **poller cycle** containing one hard error order still sends
the valid orders in that cycle. Injection starts downstream of the poller, so the cycle half cannot be
reached this way. Anyone claiming otherwise is overclaiming.

What injection reaches is the downstream half: several synthetic transactions emitted together, one
carrying a rejected item, with the rest still reaching SCALE. That measures populator and sender
isolation. It does not measure cycle continuation or watermark advance, which are the parts the AC
cares about most.

The 1160 session gives this one piece of free support either way: the roughly 5 pre-fix poison
messages each sat in **their own FIFO message group and blocked nothing**, while other traffic drained.
MEASURED. That is downstream isolation observed incidentally, at no cost, and it can be cited in the
row without running anything.

**Recommendation: leave TC15 with E2E whole**, and cite the incidental isolation observation in the
row. The re-word buys a partial answer to a case E2E answers completely, and it costs a second poison
message. Raise it with JJ, do not assume.

---

## Not reachable by injection, do not try

* **TC19.** The poller builds and sizes the event, so the entry that would breach the limit is built
  upstream of the injection point. Emitting a deliberately oversized entry measures EventBridge's own
  API rejection, not our routing. Slice 15's S1 headroom measurement remains the right approach.
  **Not to be confused with BUSY-1160's TC19**, which is header survival and is PASS.
* **TC14.** Stage eligibility is resolved by the poller from Cin7's `stage`. Upstream. Stays deferred
  to a dev-environment test. BUSY-1160 folded the related Q30 picked-stage question into its own slice
  05 using `--source-stage`; that measures the **handler's** reaction to a claimed stage, not the
  poller's eligibility gate, so it does not close 1159's TC14.
* **TC22.** Forcing one `PutEvents` entry to fail while the call returns 200 is not something a caller
  can drive. Stays deferred to BUSY-1162.
* **TC21b.** Slice 15's S3 owns it, and its suppression is **poller-side**. The 1160 session's
  handler-side guard evidence does not transfer. Do not duplicate and do not cite it there.

## Deliverable

`results/16-non-pass-sweep-2.md`, one section per stage run. Propose row changes, do not edit
`QA-DOC.md` from this slice: it is at Confluence version 14 and synced separately.

## Stop and ask JJ if

* S2 step 1's item-master absence cannot be established programmatically. That read is his.
* S2 comes back ambiguous and S4 is therefore live. The emit is his call.
* S5's re-word is being considered.
* A synthetic record reaches SCALE in a state you did not intend.
* A stage's result contradicts something in the START HERE Closed section. That is a bigger finding
  than the case it came from.
