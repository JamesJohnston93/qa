# BUSY-1159 IDE kick-off prompts

Open the IDE with `BUSY-1065-sales-orders/BUSY-1159` as the working folder, not the tooling root, or the `../../`
paths in the slices will not resolve.

Run `aws sso login --profile staging` first if the session has expired. It is a browser device-code
flow and needs a human.

## Current work, 2026-09-10. Start here

Slices 01 to 14 are done. **Slice 15 S2 has also run**, from a Cowork session on 2026-09-09, see
`results/15-non-pass-sweep-1.md`. Everything else in slices 15 and 16 is unrun.

**Both slice files were re-verified against the LLD on 2026-09-09 and nine of ten stages changed.**
The amendment lists are at the top of each slice file. Do not run a stage from memory of the
2026-09-08 version.

### TC2b is DONE. Do not re-run it

Ran 2026-09-10 from JJ's IDE session. **TC2b PASS, MEASURED**, applied to `QA-DOC.md`. Evidence
`results/17-tc2b-reallocation.md`, slice `slices/17-tc2b-reallocation.md` (bannered DONE). It produced
register corrections **C7** and **C8**. Its prompt has been removed from this file deliberately.

**Nothing left on this ticket can change a verdict by a test QA can run.** What remains is three cheap
added cases, one unrun sweep file, and work owned by other tickets or by E2E.

### Then the sweep stages, in this order. After slice 19, not before

| # | Stage | Note |
|---|---|---|
| 1 | `16-non-pass-sweep-2.md` **S1** | DLQ re-baseline. Perishable, still jumps the queue. **Gained a step 6**: read `MessageGroupId` on the sender FIFO queue, which is new case TC16b |
| 2 | `15-non-pass-sweep-1.md` **S3** | TC21b. **Gained a step 3** on the two hashes. Its pass claim narrowed to replay suppression |
| 3 | `16-non-pass-sweep-2.md` **S2** | TC9 by reading the existing emit. **Its step 1 no longer pauses the stage** |
| 4 | `16-non-pass-sweep-2.md` **S3** | TC9's DLQ third. **Pass condition inverted**, next working morning |
| 5 | `15-non-pass-sweep-1.md` **S1** | TC19. **Cut from four steps to one**, a single code read |

**Struck, do not run:** `15` **S2** has run. `15` **S5** is superseded by TC6b. `16` **S4** is
contingent and only if S2 is ambiguous. `16` **S5** is a question for JJ, not a stage.

### Slice 18 is DONE. Slice 19 is the priority, and it is new

**Slice 18 ran 2026-09-10**, all four stages. TC16b **PASS**, TC6b **UNTESTABLE** for want of a
fixture (zero multi-size styles across 100 ECOM orders), TC6c **INCONCLUSIVE** with three parts of
four measured. Bannered DONE, prompt removed. `results/18-unrun-cases.md`.

**`slices/19-empty-sizes-fallback.md`, TC6d, register Q43. Run this before the sweep stages.**

Slice 18's artefact read found the deployed poller **skips** a line whose `sizes[]` array is empty,
where **the LLD specifies a fallback to the line's own `code` and `qty` in five separate places** (§5's
detail-line table twice, §5's line-grain prose, §5's item-key contract, §11.1's poller test). A
`qty: 0` size is nothing and dropping it is right, which is what TC6c confirmed. **A single-size line
is a real line, and dropping it is a silent loss**: the counter increments, nothing alerts, and **LLD
§7's divergence check cannot see it**, because the order and the shipment record are both still created
with matching `lastModified`. The shipment is short a line and neither side knows.

**S1 is a free log read and it decides the disposition.** `skippedNoSizes` was added by the 2026-09-03
deploy and **its value has never been read on any cycle in any plan**. Non-zero on any cycle means a
real line has been dropped: a FAIL and a defect. All-zero across a stated window means the divergence
is latent: a drift row plus a correction. **Do not raise it with Kian before S1 runs**, per the
register's own rule.

**This is what holds the sign-off now.** It replaced three unrun cases as the blocking item.

### Also open, and all cheap

* **TC6c's reconciliation**, JJ's Cin7 side. Three named orders, `261110`, `261111`, `261113`, against
  the cycle at `2026-08-27T23:30:52.385Z` that recorded `skippedZeroQty:3`. Stored counts are 3, 4 and
  2, so the three shortfalls should total exactly 3. Any that does not attribute to a `qty: 0` entry is
  a lost row and a separate defect.
* **`262223`'s PK**, which differs between the populator's own logged event and the `origin_index`
  resolution. Eight of nine matched. One check.
* **`261644` and `261646`**, real ECOM orders at `status=OPEN` holding order-side items and zero
  shipment-side items, with the DIGITAL/INSTORE delivery-method exclusion ruled out. Found incidentally
  by TC6b's survey. **Not TC6c's shape**: that is a size-level absence, this is order-level, and
  reading one as the other would overclaim.

### Paste-ready prompt, any sweep stage

```
Read BUSY-1065-sales-orders/BUSY-1159/CLAUDE.md, then read ONLY section <S1|S2|S3> of
BUSY-1065-sales-orders/BUSY-1159/slices/<15-non-pass-sweep-1|16-non-pass-sweep-2>.md and run that one stage.

Read the "Amended 2026-09-09" block at the top of that slice file first. Nine of ten stages changed
on that date and the stage text you are running is the corrected one.

Do not read the other stages. Do not read QA-DOC.md. Do not edit QA-DOC.md.
Cin7 is CTC live production: read only, GET calls only, and nothing in this stage should need it.
Extract named fields only, never print or pipe a whole record: four log groups and the listOrders
gateway response carry unredacted customer data.
Tag every claim MEASURED, INFERRED or UNKNOWN. No em dashes or en dashes.
Any command with logic goes into scripts/ and is indexed in SCRIPTS.md before it is run.
Append your findings as one section to results/<matching file>.md, and propose QA doc row changes
rather than making them.
Stop and report if the stage's own "Stop and ask JJ if" list is triggered.
```

### Three traps this session must not fall into

1. **Case numbers collide across tickets.** BUSY-1160 has its own TC5 to TC19 meaning different
   things. 1160's TC9 is an address-only revision emitting no item lines, PASS. 1159's TC9 is a SCALE
   rejection parking on the DLQ, UNTESTABLE. Never carry a verdict across folders on a matching
   number.
2. **There are two hashes, not one.** `idempotencyId`'s trailing segment and the
   `lastEmittedPayloadHash` attribute hold different values, MEASURED on four real orders. Notes in
   this plan written before 2026-09-08 evening read as one hash serving both roles and are wrong. No
   step may assert a hash matching a computed expectation. **LLD §3 describes one hash in two homes,
   so the difference may be a drift row rather than a note. 15 S3 step 3 establishes which. JJ's call:
   verify it ourselves over coming sessions, raise it with nobody yet.**
3. **The monorepo checkout on this machine is stale and has no remote.** `~/Repos/monorepo` is branch
   `UNI-1167-cc-reminder-master`, HEAD dated **2026-02-12**, no `origin` configured, so it cannot be
   fetched forward. It holds no `cin7`, `orders-cin7`, `so-poller` or `ctc` path at all: it predates
   PR \#1568. It is good for the **pre-CTC** shape of the existing UNI consumers, which is what the
   LLD §3 consumer-guard audit is a stance about, and it evidences **nothing** about what the CTC
   build changed. **Do not cite it as repo access, and do not conclude a guard is absent from it.**

### Confluence is synced as of 2026-09-10

`QA-DOC.md` and the Confluence page match at **version 16, 29 cases: 21 PASS, 2 INCONCLUSIVE, 3
UNTESTABLE, 2 DEFERRED, 1 PROPOSED**. The local file stays the source; push the whole body, never a partial patch,
and do not reformat it on the way through.
---

## History below this line

Results for slices 01 to 14 are in `results/`. The current-build evidence lives in
`../retests/RETEST-1158-1159/`; read that plan's `STATE.md` before starting anything new here.

## Slice 10, PutEvents partial failure and the watermark

**Done and closed. Do not paste a prompt for this.** Gates A and B ran on 2026-09-01 and are clean,
results in `results/10-putevents-partial-failure.md`. The write half is deferred to BUSY-1162 and is
recorded as D1 in `../DEFERRED-TEST-CASES.md`. The slice file keeps the forced-test method for
that ticket to reuse.

## Slice 11, picked stage eligibility and cancellation on loss of eligibility

**Done and closed. Do not paste a prompt for this.** Results in
`results/11-picked-stage-eligibility.md`. Its `Fully Picked` reading has since been superseded: the
current build counts an ineligible wholesale order at `Approved` and drops one at `Dispatched`
uncounted, and TC14 is now deferred rather than blocked. See the QA doc's drift table and Q38.

## Manual, not an IDE session

`SCALE-UI-READS.md` covers TC1a and the SCALE halves of TC6, TC10 and TC18. A human in the Manhattan
SCALE staging UI, searching on Company `CTC` plus ShipmentId. Nothing blocks it and no AWS access is
needed.

## Not runnable, do not build a slice for these

* **TC14.** DEFERRED to a dev environment test, not a fixture hunt. No ECOM order can reach either
  picked stage until the confirmation leg writes those stages back into Cin7, and that leg is
  unbuilt. Six checks including a 1000 order population cross tab found none. Do not spend more
  Cin7 budget looking.
* **TC19.** ~~Not runnable.~~ **Superseded 2026-09-08.** `oversized:0` across 718 orders stands, but
  the case is now re-worded to a measured headroom against the size ceiling rather than a fixture
  hunt. See `slices/15-non-pass-sweep-1.md` S1.
* **TC13.** PASS on the current build. `lastEmittedPayloadHash` is persisted on the order row and
  matches the emitted payload, reversing the earlier absent reading. Nothing left to run.
* **TC9 and TC15.** UNTESTABLE. No dead letter fixture exists, no rejection has occurred since the
  deploy, and Cin7 is read only for everyone so one cannot be manufactured. Handed to E2E.

---

## Q33, carrier attribute population scan. CLOSED 2026-09-02, do not run

The prompt that was here has been removed so nobody runs it. The scan is no longer needed: the
missing `Carrier` was confirmed the same day as a deliberate omission pending a final decision, not a
defect, so the population shape of the `carrier` attribute answers a question that is no longer open.
See Q33 in `BUSY-1065-OPEN-QUESTIONS.md` and D16 in `DEFERRED-TEST-CASES.md`.

---

## Slice 13, payload hash hunt (TC13 re-test, TC13b, TC13c, TC13d). RAN, do not re-run

**Done.** Results in `results/13-payload-hash-hunt.md`. Its headline finding (the attribute is never
persisted) was reversed on the current build, where the attribute is present and matches the emitted
payload. The prompt below is kept only for its method.

Read-only throughout. No writes, no poller invoke, no watermark change. Run part 4 first if the
session has to be split, since its log route ages out around 26 September.

```
Working directory: /Users/james.johnston/Desktop/QA/wms/ctc
Slice file: BUSY-1065-sales-orders/BUSY-1159/slices/13-payload-hash-hunt.md
Read the slice file first and follow it. This prompt is context, not a substitute.

Why this exists, do not re-derive it:
  - TC13 is BUSY-1159's only remaining FAIL. It reads
    "lastEmittedPayloadHash written on create" and failed twice on direct
    DynamoDB attribute reads (slices 03 and 09).
  - But a payload hash IS computed. Slice 09 recorded
    idempotencyId CREATE_ORDER#CTC#261119#2026-08-28T00:30:03Z#e24af605
    and the epic defines idempotencyId as
    <event>#<origin>#<modifiedDate>#<payloadHash>. The trailing segment is
    the hash.
  - So the case is probably measuring the wrong thing. This slice decides
    whether TC13 gets rewritten, reassigned to BUSY-1158 as a schema gap, or
    stands as written.
  - Both prior attempts were attribute reads on staging-orders-v2 for orders
    that had only ever been created. A third read of that kind is worthless.
    Each part below closes a different route.

Do all four parts. Write results to
BUSY-1065-sales-orders/BUSY-1159/results/13-payload-hash-hunt.md, with a one-line verdict
per part and an explicit recommendation for what TC13 should say.

Redaction, not optional: the TRANSACTION row type in staging-orders-v2 carries
customerEmail, addressChanges and orderInfo. Print attribute NAMES freely.
Print VALUES only for attributes whose name matches /hash|idempotenc/i.
scripts/list-transaction-rows.sh already follows this rule; extend it rather
than writing something looser.

Part 1 (TC13b), free and needs no fixture: harvest idempotencyId from every
TRANSACTION row for the 12 known CTC references, split on '#', and report the
trailing segment's width, character set, presence rate, and whether it varies
by order. If any reference has two rows at the same modifiedDate, compare
their segments; that is the stability test.

Part 2 (TC13c), the most likely hiding place: dump full attribute NAME lists
for every row under one order's PK in staging-shipments (SHIPMENT#, ITEM#,
TRANSACTION#), which slice 09 never covered, and open the orders-table
TRANSACTION row's orderInfo payload keys, which slice 09 deliberately did not
open. Report any attribute matching /hash/i. Also note whether the hash is
queryable through the idempotency_index GSI.

Part 3 (TC13d first half): re-read order 261115's ORDER row attribute list.
It is the one order measured to have been polled more than once (TC4).
Compare against the list recorded in results/03-post-create-observation.md.
Note in the result that all 12 orders are now Dispatched and so have not been
re-polled recently, which makes a negative here weaker than it looks.

Part 4 (TC13d second half), the discriminator: recover an emitted event
payload, preferring the TRANSACTION audit record's stored payload from part 2,
falling back to the poller's `Pushed {"Entries":[...]}` log line. Compare its
key set against the persisted ORDER row's attributes. If the event carries the
hash and the row does not, Dynamoose saveUnknown:false is dropping an
undeclared attribute, which is a schema gap and BUSY-1158 TC1b's territory,
not a poller defect. Say which of the two states holds and name the evidence.

Stop and report if part 1 shows the trailing segment is not fixed width or does
not vary by order. That would mean it is not a hash and TC13 stands exactly as
written.

Any new script goes under BUSY-1065-sales-orders/BUSY-1159/scripts/ and is recorded in
SCRIPTS.md as not reviewed.
```

---

## Slice 14, does an ECOM order ever reach a picked stage in Cin7. RAN, do not re-run

**Done.** Results in `results/14-ecom-picked-stage-population.md`: zero ecom-shaped orders at either
picked stage across 1000 orders. TC14 is deferred on the back of it. The prompt below is kept only
for its method.

Cin7 API only, read-only, GET only. No AWS, no watermark, no schedule. Budget: 15 GETs maximum.

```
Working directory: /Users/james.johnston/Desktop/QA/wms/ctc
Slice file: BUSY-1065-sales-orders/BUSY-1159/slices/14-ecom-picked-stage-population.md
Read the slice file first and follow it. This prompt is context, not a substitute.

The question: do ECOM sales orders ever reach a picked stage in Cin7, or is
that structurally wholesale-only?

Why it matters: BUSY-1159 TC14 is BLOCKED on "no ECOM order has ever been
observed at Fully Picked or Partially Picked across five independent checks",
and that is currently one half of the only thing blocking sign-off on the
ticket. If ecom orders structurally never reach a picked stage, TC14 is NOT
APPLICABLE to ecom rather than blocked, and it closes.

The design insight, do not re-derive it: a stage is a snapshot, a date is a
record. All five prior checks asked "what stage is this order at right now",
which cannot see a stage an order passed through and left. Cin7 carries a
"Fully Picked Date" field. On order 261115 it is EMPTY while Fully Dispatched
and Invoice Date both read 31-08-2026 09:15, measured from the Cin7 UI today.
So that order reached dispatched with no picked date ever stamped. The date
field is the primary test; the stage cross-tab is supporting evidence.

Also do not re-derive: Cin7 DOES have Fully Picked and Partially Picked as
stage values. Slice 08 pulled 32 real orders with stage IN ('Fully Picked',
'Partially Picked') and got {"Fully Picked":29,"Partially Picked":3,
"Fraud Warning":1}. They are wholesale. The open question is ecom only.

Constraints, all hard:
  - GET only. Cin7 is CTC's production system. Never POST/PUT/PATCH/DELETE
    and never add one to a script.
  - Credentials auto-load from .env and are never printed. Do not pass them
    as flags, do not echo them, do not put them in any file.
  - Budget 15 Cin7 GETs total. Burst 3/s, 60/min, 5,000/day shared with three
    live pollers. Stop and ask before exceeding it.
  - Never print customer name, email, address or phone. Company name only
    where part 3 needs it.
  - Do not touch the watermark, the schedule or the poller. Not needed, and
    a replay is confounded for this question.

Report the actual stage and status vocabulary Cin7 returns, verbatim, not a
check against the values the LLD names. If a value appears outside {New,
Processing, Partially Picked, Fully Picked, Dispatched, Fraud Warning}, call
it out: the eligibility gate is written against a list nobody has verified is
complete.

Write results to BUSY-1065-sales-orders/BUSY-1159/results/14-ecom-picked-stage-
population.md with a one-line verdict, the sample size, and which of the
slice's three part 4 branches applies.

Script changes are additive to survey-cin7-orders.sh only, same pattern as
slice 02's taxStatus counter, recorded in SCRIPTS.md as not reviewed.
```
