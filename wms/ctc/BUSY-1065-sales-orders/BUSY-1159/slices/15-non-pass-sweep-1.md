# Slice 15, non-PASS sweep 1

**Ticket:** BUSY-1159 only. Nothing in this file touches 1158, 1160 or the epic questions.
**Cases:** TC19, TC2 (reallocation half), TC21b, TC1a, TC6, plus three doc corrections.
**Depends on:** `results/09-echo-guard-and-replay.md`, `results/12-scale-ui-manual-reads.md`,
`results/13-payload-hash-hunt.md`, `results/08-resilience-sizing.md`,
`../retests/RETEST-1158-1159/results/R11-pre-kian-confirmation.md` and `R13-fresh-data-verification.md`.

## Amended 2026-09-08 evening, after a full BUSY-1160 session

This file was written 02:52. A BUSY-1160 session then ran 01:24 to 06:01 and changed things under it.
**No file in the BUSY-1159 folder was written after 02:52**, so the plan itself is not tainted. What
moved is shared state, sibling results and two facts this file rests on. The four amendments below
are applied inline; nothing else in this file changes.

1. **R14 has run.** The out-of-scope note below said "when R14 runs, its result feeds TC5". It ran at
   03:13, `../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`. Verdict: `orderType` has
   only ever held `ECOM` across the full retained history of both tables, and no table exists under an
   outbound-family name across all 137 in the account. No wholesale order has ever been stored, under
   any shape. MEASURED. That closes the epic-level thread P16 and P17 sat behind. Do not re-run it.
2. **S3's hash prerequisite was written on a conflation and is corrected below.** The two hashes are
   different values, MEASURED on four real orders.
3. **S3's re-word is AGREED by JJ, 2026-09-08 evening.** The stage may run. The plan's
   inconclusive-twice stop is satisfied.
4. **Case numbers collide across tickets and the 1160 folder is now full of them.** BUSY-1160 has its
   own TC5, TC6, TC7, TC8, TC9, TC10, TC11, TC13, TC14, TC18 and TC19, and they mean entirely
   different things. `../BUSY-1160/SYNTHETIC-REGISTER.md` labels rows with 1160 case numbers.
   **1160's "TC19 PASS" is header survival. 1159's TC19 is the event size limit.** Never carry a
   verdict across folders on a matching number.

## Amended 2026-09-09, re-verified against the LLD

The whole file was checked against LLD page 1802698758 as source of truth before any stage ran. **Four
of the five stages changed and one shrank to a single step.** JJ's calls are recorded inline.

1. **S1 lost three of its four steps.** The 256 KB limit is named in §4 step 6 and §6, so step 1 was
   never open, and its two candidate ceilings were both wrong. §10.2 already carries the headroom
   figure, and it is a wholesale figure. TC19's breach is not an ECOM condition.
2. **S2 was rewritten and then ran.** Its step 4 premise was false: three reallocation consumers are
   wired. See `../results/15-non-pass-sweep-1.md`. TC2 is proposed for a split into TC2 and TC2b.
3. **S3 gained a step and its pass claim narrowed.** The echo guard's own LLD acceptance needs the
   confirmation leg, so a re-poll can only pass on replay suppression.
4. **S4 gained two pre-checks.** Two of its three hunted fields are conditional in the LLD, so a
   manual read without the source value cannot be interpreted.
5. **S5 is superseded** by a multi-size-style case the LLD names and nothing covers.

## How to run this file

Five stages, ordered cheap first. **Run one stage per sitting and read only that stage.** Each stage
is self-contained and names its own fixtures. Write `results/15-non-pass-sweep-1.md` incrementally,
one section per stage, rather than one file at the end.

This is sweep 1 of several. The goal of a sweep is not to finish, it is to move a verdict or to
replace a test that cannot move one. **If a stage comes back inconclusive, do not re-run it as
written on the next sweep. Rewrite the case so the evidence is reachable, and say in the result file
what changed and why.**

All the plan's standing rules apply: `../CLAUDE.md`. Cin7 read only, GET only. Field allowlists on
every log read, never a whole record. Tag every claim MEASURED, INFERRED or UNKNOWN.

## Scope

**In scope, the two live non-PASS verdicts:**

* TC19, BLOCKED
* TC21b, INCONCLUSIVE

**In scope, the PASSes carrying an unmeasured half.** These are marked PASS today but each rests on
an inference, a pre-deploy fixture or a search that was narrower than the claim. They are the rows a
reviewer at handover is most likely to push back on.

* TC2, the no-reallocation half, INFERRED only
* TC1a, three of the LLD section 5 fields not found on the screens opened
* TC6, proven on a pre-deploy fixture only

**Out of scope, do not re-open, re-test or re-ask.** These are closed in the 2026-09-08 START HERE
and a sweep that re-litigates them wastes its run.

* TC15, UNTESTABLE. The cycle half is upstream of the injection point, handed to E2E.
* TC9, **amended 2026-09-08 after this file was written.** The "none is manufacturable" premise was
  retired by JJ's synthetic injection decision the same morning: AC8 sits downstream of the poller and
  is drivable. Moved to `16-non-pass-sweep-2.md`. Still out of scope for **this** file.
* TC14, DEFERRED. Handed to dev for a dev environment test.
* TC22, DEFERRED to BUSY-1162. The read only half is done and found no occurrence.
* TC7. The shipment-side UNI comparison moved to BUSY-1158 as its TC3b and TC7 (P10). Leave it there.
* The 5 minute lookback, the absent upper bound, the R1 duration signal, the CTC split, `origin_index`,
  and inventory consumption on a shipment leaving `OPEN`. All settled.
* The AC5 counter accounting, Q38, P16 and P17. **R14 ran 2026-09-08 at 03:13 and answered it at
  full-history strength: `orderType` has only ever held `ECOM`, and no wholesale record has ever been
  stored under any shape. MEASURED.** **Narrowed 2026-09-10, correction C9: the blanket form is now
  false.** Slice 18's independent full scan found four non-ECOM records, `QASYN-12-TC2` and
  `QASYN-14-TC2WH` (`WHOLESALE`), `QASYN-13-TC2RTV` and `QASYN-15-TC1B` (`RTV`), all of them QA's own
  synthetic injections and three of them created after R14 ran. **The surviving claim is that no
  *real* Cin7 wholesale or RTV order has ever been stored**, which is what this out-of-scope note
  actually rests on. Do not cite the blanket version. Nothing is left here for a 1159 sweep to add. TC5's row can cite
  R14 directly. What remains is Q35, a design question with Kian about which family is supposed to
  hold a wholesale order, and it is not a test.

---

## S1. TC19, confirm the oversize routing guard exists. Free, one code read

**Current verdict:** BLOCKED. `oversized:0` across 718 orders at the widest window sampled.

**Rewritten 2026-09-09 against the LLD. Three of the four original steps are struck.** They set out
to measure headroom the LLD has already measured, on the wrong order type.

**The limit is named in the LLD, so step 1 was never an open question.** It is **256 KB**, the
EventBridge entry cap, stated in §4 step 6 and §6, with the **400 KB DynamoDB item cap** second
because §9.2 says "the transaction writer persists the item array inline". The SQS FIFO limit is not
in the LLD's chain at all, so the original step 1's two candidates were wrong in both directions.

**The headroom number is also already in the LLD, and it is a wholesale number.** §10.2: "the largest
real order in the book is **83 size rows, about 7% of the cap**, against 6,634 units which would be
5.4x over it. The ceiling is style lines multiplied by sizes." §6 adds it is "far above ordinary
orders but not unreachable on a large multi-size wholesale order."

**So the risk TC19 guards is not an ECOM risk.** ECOM is per-unit and §3 calls it "a handful of units
to a person's address". Measuring a DynamoDB row-size proxy across the ECOM population to derive a
breach point would duplicate the LLD's arithmetic and then read, at handover, as coverage of a ceiling
ECOM cannot approach. Per R14 no wholesale order has ever been stored under any shape, so the ceiling
cannot be approached from this ticket either.

**Steps, one**

1. **Check the guard is real, not just the counter.** `oversized` is printed on every cycle, so the
   counter exists. Whether an oversized order is **routed to the error path** rather than split or
   dropped is a separate claim that a counter reading zero does not evidence. This is now answerable:
   §11.1 names "oversize routing" as a poller unit test, and `inspect-lambda-code.sh` reads the
   deployed artefact. Search the deployed poller for the oversize branch and say plainly which of the
   two you evidenced, the counter or the routing.

**Reads as**

* Routing branch present in the artefact: propose TC19 moves from BLOCKED to **PASS**, citing §10.2's
  own 83-rows-at-7% figure as the headroom rather than a measured proxy, with the row stating that
  the breach the case asks for is a **wholesale** condition and is **deferred to BUSY-1161** where
  that order type lives. Tag the headroom INFERRED-from-design, not MEASURED.
* Routing branch absent, only the counter: that is a real gap against §4 step 6 and §6, both of which
  say "never split or truncated". Raise it. It is still BUSY-1161's to carry, but it is a finding.

**Either way the row must record** that LLD §6 requires the oversize route to raise **an alert**, and
that TC20 measured both SNS topics at zero subscribers, so the alert half cannot be satisfied in
staging whatever the routing does.

---

## S2. TC2, the no-reallocation half. Free, source read. RUN 2026-09-09, see the result file

**Rewritten and then run 2026-09-09.** Route changed before it ran: the LLD asserts
reallocation-not-triggered through the §11.3 trickle-down test and the §11.6 consumer-guard
regression, not through a live log silence, so the search went to source. A monorepo checkout was
reachable for the first time on this epic.

**Outcome is in `../results/15-non-pass-sweep-1.md`. Summary, and read the caveat.**

* **The stage's own step 4 premise was false.** It offered "if no reallocation consumer is wired in
  staging at all" as the stronger finding. Three are wired, and one sits on the exact hop the LLD
  names. Recording that absence would have put a false negative in the QA doc.
* **The chain, MEASURED:** `SHIPMENT_ITEM_CREATE` to `create-shipment-items.ts`, which emits a
  `REALLOCATION` transaction, to `create-transaction.ts`, which relabels it `TRANS_REALLOCATION`, to
  `allocate-shipment-items.ts`. The LLD §3 audit row's **trigger is right**; its consumer is one hop
  further on.
* **`create-shipment-items.ts` has two branches and no company guard.** B2B transfer, or an `else`
  commented "Regular orders, trigger reallocation". `grep -nE "isB2BTransfer|company|CTC"` returns
  only the branch flag. A CTC ECOM order is not a B2B transfer, so on that version it takes the else
  branch. MEASURED.
* **LLD §11.3 asks for two things that cannot both hold** on that version: "reallocation is not
  triggered" and "assert that `create-shipment-items` is unmodified". The emit lives inside that
  file. One of the two clauses is wrong as written. INFERRED, and it is a document problem before it
  is a defect.
* **Caveat that governs all of the above.** The checkout is dated **2026-02-12** with **no git
  remote**, so it cannot be fetched forward, and it predates PR \#1568. It evidences the pre-CTC
  shape of the existing consumers, which is what the §3 audit is a stance about, and it evidences
  **nothing** about what the CTC build changed. What the deployed build does is **UNKNOWN**.

**What is left, and it is cheap. Needs AWS, so it is JJ's IDE session.**

Per §3 the chain "persists the audit record in the order's partition" at `SK = TRANSACTION#<epoch-ms>`,
so a `REALLOCATION` emit leaves an audit record carrying an `idempotencyId` prefixed `REALLOCATION#`
**in the partition TC2 already read**. No log group, no bus rule walk, no name sweep.

1. For each of the nine R13 references (`#262208`, `#262210`, `#262211`, `#262216`, `#262217`,
   `#262219`, `#262221`, `#262222`, `#262223`), query the order partition for `TRANSACTION#` records
   and report any whose `idempotencyId` begins `REALLOCATION#`. Field allowlist only. **Decisive on
   its own.**
2. Then `inspect-lambda-code.sh` against the deployed create-shipment-items function, searching
   `company` and `CTC`, which tells the two §11.3 clauses apart instead of guessing.

**Reads as**

* A `REALLOCATION#` record on any of the nine: **reallocation IS triggered for CTC ECOM orders.** That
  is a FAIL against AC7 and against LLD §9.2, a real defect, not a partial pass.
* None on all nine, and a `company` guard in the artefact: the build guarded it and §11.3's
  "unmodified" clause is the wrong one. Correction for Kian, verdict PASS.
* None on all nine and no guard in the artefact: contradiction. Stop and take it to JJ before writing
  a verdict.

**Proposed row change either way:** split TC2. The stamps half stays PASS and MEASURED. A new **TC2b**
carries the no-reallocation half, at **INCONCLUSIVE** until step 1 runs. The old row's
PASS-with-an-INFERRED-caveat is no longer defensible in either direction.

---

## S3. TC21b, stop asking for a log line and discriminate instead. Read only, one fixture read

**Current verdict:** INCONCLUSIVE, twice. Per `../CLAUDE.md` a case inconclusive twice in a row stops
and goes to JJ. **This stage is that stop.** It is written, but it needs JJ's agreement to re-word the
case before it runs, because the re-word changes what a pass would mean.

**Why it is not a clean PASS.** The case as written asks for the guard that suppressed the re-poll to
be **named**. Suppression works: `echoSkipped` fired 2 against the 2 re-swept orders on the current
build and did not exist before it. But no per-order log line names the guard, and no such line will
appear without a code change. The case is asking for evidence the system does not produce.

**What this stage changes.** Attribute the suppression by discrimination rather than by naming. The
question becomes: is the suppression attributable to the payload hash echo guard, and to nothing
earlier in the pipeline?

**JJ agreed this re-word on 2026-09-08 evening.** The stage may run.

**Prerequisite, do this first and do not skip it.** Slice 13's TC13c measured that no retrievable
standalone hash existed anywhere, and that measurement is **pre-current-build and now contradicted**:
R11 and R13 found `lastEmittedPayloadHash` present on create, matching the emitted payload, and
unchanged by an echo. Re-state it on one current-build order row before using it.

**Corrected 2026-09-08 evening, and this changes what step 2 may compare.** There are **two distinct
hashes, not one**. The BUSY-1160 session measured on four real orders that `idempotencyId`'s trailing
segment and the `lastEmittedPayloadHash` attribute **hold different values**. MEASURED,
`../BUSY-1160/` correction 4. Notes carried in this plan since 2026-09-02 read as one hash serving
both roles and they are wrong. So:

* Say which hash every step is reading. `lastEmittedPayloadHash` is a named attribute on the order
  row and is the retrievable one. The `idempotencyId` suffix is a different value inside a key string.
* **No step may assert a hash matching a computed expectation.** Asserting one changed across an event
  is fine, and is what step 2 needs.

**Do not cite the BUSY-1160 synthetic evidence in this stage.** That session characterised the
handler-side idempotency index and version guard by injecting downstream of the poller. TC21b's
suppression is **poller-side**: slice 09 measured the re-polled order was fetched but never reached
the emit step. The two are different mechanisms at different hops and the evidence does not transfer.
Anyone who cites `SalesOrderStaleRevision` or the QASYN-07 identical-modifiedDate result here is
answering a different question.

**Steps**

1. **Discriminate by arithmetic, the cheapest genuinely new evidence.** On a cycle whose window is
   known to hold M orders never seen before and K orders already created, the counters should read
   `created = M` and `echoSkipped = K` exactly, with no residual. R13's counters have never balanced
   at population scale, so run this on the smallest window that holds a known mix, where every order
   in the window is individually accounted for by hand. A counter set that balances exactly on a
   hand-checked window is a far stronger claim than one that balances in aggregate.
2. **Discriminate by payload change, if a fixture allows it.** TC21's fixture is an unchanged second
   sighting. TC4's fixture is a second sighting where the Cin7 record changed. If the guard is a
   payload hash comparison, a changed payload hashes differently and that guard should not fire.
   **Test the premise before relying on it:** compare the two orders' stored `lastEmittedPayloadHash`
   values and the payload field set, and establish whether the TC4 edit actually changed a field the
   payload carries. A `modifiedDate` move alone may not. If the payload fields are identical, the
   fixture does not discriminate, and this half waits for one that does.
3. **Establish whether the two hashes differ by input or only by encoding.** Added 2026-09-09.
   §3 describes **one** hash in two homes: `idempotencyId = <event>#<origin>#<modifiedDate>#<payloadHash>`,
   and "the hash is taken over the mapped payload ... the poller stores it on the order as
   `lastEmittedPayloadHash`". The measurement says the two hold different values. If the **inputs**
   differ, then the idempotency key and the echo guard carry two different definitions of "changed",
   and §3's stated reason for putting the hash in the key at all, that two edits inside one second
   share a timestamp and one would be dropped as a replay with nothing to see it, may not hold.
   Establish which it is from the deployed artefact via `inspect-lambda-code.sh`. If the inputs
   differ, it is a Design drift row against §3, not a wording fix. **JJ's call 2026-09-09: verify
   ourselves over the coming sessions, do not raise it with anyone yet.**
4. **Record the elimination, not the conclusion.** Slice 09 already measured that a re-polled order
   was fetched but neither created nor counted in any skip bucket, meaning it never reached the emit
   step. Combined with step 1, say which guards are ruled out and which one remains, and stop there.

**Reads as**

* Counters balance exactly on a hand-checked window and the hash is retrievable and unchanged across
  an echo: propose TC21b moves to **PASS on replay suppression**, with the row stating plainly that
  the mechanism is identified by elimination and not by a log line.
  **Corrected 2026-09-09, and this is a narrower claim than the stage originally proposed.** The
  LLD's own acceptance for the echo guard is not a re-poll at all. §6: "**If the counter is ever zero
  while confirmations are flowing, the hash is over the wrong fields**", §9.1: "echo skips should
  track pick confirmations one for one", and §11's UAT list: "a SCALE 300 on a sent record changes
  nothing in SCALE and raises no alert (echo guard)". All three need the confirmation leg, which does
  not exist. TC21b's fixture is an unchanged re-poll, which measures replay suppression and not the
  guard doing its job. So the row passes on replay suppression and **hands the echo guard's own
  acceptance to the confirmation epic, citing §6's zero-counter tell**. Do not write a row implying
  the guard was verified against its purpose.
* Both fixtures suppress identically with the stored hash unchanged and the payload demonstrably
  different: the suppression happened earlier than the hash comparison, at the existence check. That
  is a **FAIL against the mechanism the LLD implies**, and it is a Design drift row, not a defect.
* Fixture does not discriminate and no window holds a hand-checkable mix: stay INCONCLUSIVE, and this
  case is then out of QA's reach without repo access. It goes on the Kian ask beside the artifact
  read, and it is removed from future sweeps rather than carried forward a fourth time.

---

## S4. TC1a, re-read on current-build orders and close the three not-found fields. Manual, JJ only

**Current verdict:** PASS, on `261115` and `261111`, read 2026-09-02 post-deploy against live
staging. Three fields not found on the screens opened.

**Why it is not a clean PASS.** Three of the LLD section 5 fields, `OrderDate`, `ErpOrderLineNum` and
`CustomerPO`, were not found on the screens opened, and the result file is explicit that this is not
proven absent. The sender never logs its outbound XML, so this UI read is the only route to them.

**Fixtures.** R13's nine fresh orders. Take two, and prefer `#262208`, whose shipment header carries a
`shipmentId`. Search in **Order Planning > Planned Shipment Insights** on Company `CTC` plus
`ShipmentId`, which is the Cin7 reference unchanged with no prefix. Not Shipping Insights: that screen
lists post-wave shipments only and holds none of ours.

**Two things to settle before spending a manual read. Added 2026-09-09.**

**1. Two of the three fields are conditional in the LLD, so "not found" is uninterpretable without
the source value.**

* `OrderDate` = `createdDate` (§5). Always present on a Cin7 order, so absence in SCALE **would be a
  genuine defect**.
* `CustomerPO` = `customerOrderNo` (§5 per-type matrix). §5 is explicit that the build "**omits the
  element entirely when the source value is absent** rather than sending an empty one, and never
  fabricates a placeholder". A Shopify-originated ECOM order may well carry no `customerOrderNo`.

So **read `customerOrderNo` on the chosen R13 orders from the stored order row first**. Without it the
stage can only report not-found again, which is where the case already sits.

* `ErpOrderLineNum` is unconditional, `lineItems[].id` per §5, typed `decimal_19_5`. Absent in the UI
  is a UI limitation (D8), not a mapping gap, and §5's identity rule makes it load-bearing for
  BUSY-1015/1016/1017 rather than for this row.

**2. Step 2's brand-map premise contradicts the QA doc, and the contradiction is not this stage's to
absorb.** Step 2 says the map keys on `Shopify V2_thrills` with a space while the captured value is
`ShopifyV2_thrills` with none. **LLD §5 confirms the map key carries the space**
(`Shopify V2_thrills` and `Shopify V2_thrillsusa` to `THRILLS`). But QA doc TC10 records "the brand
map resolves on **both** `projectName` spellings, so `packingBrandMisses` reading zero is
trustworthy." Both cannot be true. If the captured value has no space and the map requires one,
`packingBrand` never resolves on a Thrills order and the zero counter means nothing was attempted.
**Settle it from the deployed artefact before the manual read**, since it decides whether step 2 is a
confirmation or a defect hunt.

**Steps**

1. The three not-found fields, deliberately, on screens other than the ones already opened. The
   earlier read covered the search results grid, the shipment detail panel and one line drill-in. The
   goal is to convert each field to present or absent, not to re-confirm the eleven that matched.
2. `UserDef3` on a Thrills order specifically. `WORSHIP` resolved on the Worship order, and
   `packingBrandMisses` has read zero, but the brand map keys on `Shopify V2_thrills` with a space
   while the captured value is `ShopifyV2_thrills` with none. R13's orders are the first chance to see
   `THRILLS` land on a current-build Thrills order.

**Reads as**

* All three fields resolved to present or absent: TC1a's row is rewritten with the full field set and
  loses its not-found caveat.
* Still not found after a deliberate hunt: record **absent on the screens available to QA**, which is
  a different and defensible claim, and hand the mandatory-field question to E2E, who see the SCALE
  side properly.

---

## S5. TC6, opportunistic only. Do not spend a sweep waiting on it

**Current verdict:** PASS on `WOR19261`, a pre-deploy fixture. Both halves proven. No fresh
repeated-option-code order has appeared since, so it is not proven under the current code.

**What to do.** Nothing dedicated. When any other stage pulls a window of fresh orders, check whether
one carries the same option code twice, and if so read its rows. `ErpOrderLineNum` is not readable in
the UI, so the line identity pair stays unobserved either way, recorded as D8.

**Superseded in value, 2026-09-09.** TC6's fixture `WOR19261` is a **single-size** style at qty 2,
and its aggregation to one SCALE line at Total Qty 2 is correct and LLD-supported (§11.5, "quantity
... aggregated from unit rows for ECOM"). The case the LLD actually names is a **multi-size** style:
§11.5 "a multi-size style produces **one detail line per size sharing one `ErpOrderLineNum`**", §5's
identity-pair rule, and §10.2's "sizes of one style collapse into a single record" risk. That is a
different fixture and it has never been tested. It is proposed as a new case rather than a re-run of
this one, and a multi-size ECOM order is ordinary traffic so a fixture probably already exists. Spend
the opportunistic look there, not here.

**Do not** enable the schedule or move the watermark for this case alone. The pre-deploy pass is
adequate evidence for a handover as long as the row says which build it was proven on, and it does.

---

## Doc corrections found while writing this plan. Free, no testing needed

1. **Slice 13 ran and has no rows in the QA doc.** P18. TC13b, TC13c and TC13d each produced a
   measured outcome. TC13c's is superseded by the current build, and `results/13-payload-hash-hunt.md`
   now carries a note saying so, see S3's prerequisite. Do not add a row carrying the dead measurement.
2. **SCALE-UI-READS.md is marked CLOSED and says TC1a FAILed on `Carrier`.** The QA doc records
   `Carrier` as a deliberate omission and a Design drift row, not a failure, and the result file
   records the same-day correction. The read sheet's header is stale and will mislead the next reader.

## Deliverable

`results/15-non-pass-sweep-1.md`, one section per stage run, each carrying the verdict it proposes
and the evidence behind it. Propose row changes, do not edit the QA doc from this slice: the doc is
synced separately and it is at Confluence version 14.

## Stop and ask JJ if

* ~~S3's re-wording is not agreed.~~ **Agreed 2026-09-08 evening. No longer a stop.**
* Any stage needs the watermark moved or the schedule enabled. Nothing in this file should need
  either, and if one appears to, the stage has drifted from what it was written to do.
* A stage's result contradicts something in the START HERE Closed section. That is a bigger finding
  than the case it came from.
