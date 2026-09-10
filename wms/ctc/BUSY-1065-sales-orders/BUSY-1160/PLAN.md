# BUSY-1160 test plan

Native updates: wholesale mapping, line reconciliation, cancellation. Epic BUSY-1065.
Built 2026-09-01. **Rewritten 2026-09-08** after the 2026-09-03 deploy, the R14 overlap and JJ's
decision to drive the ticket with synthetic records. `QA-DOC.md` is the artefact UAT reads; this file
is how it gets filled in.

Laid out the same way as `../BUSY-1159`: `PLAN.md`, `STATE.md`, `KICKOFF.md`, `slices/`, `results/`,
`scripts/`.

## What changed on 2026-09-08, read this before anything else

The 2026-09-01 plan said this ticket was not sliceable end to end, for two reasons. Both have moved.

**1. The build is deployed.** BUSY-1160 went to staging 2026-09-03 and the ticket is now in Review and
assigned to JJ. Slice 01's Gate A is no longer "is anything there", it is "what is there". The other
two gates it carried have moved out, see below.

**2. The fixture problem is solved, for most of the ticket.** The old plan's central claim was that
every revision case waits on a real CTC user editing a real order, because Cin7 is production and QA
cannot change one. That is still true of Cin7. It was wrong about the consequence.

**Cin7 is the only read-only link in the chain.** Everything from `staging-orders-v2-event-bus`
onward is staging AWS that QA can write to, and this ticket's acceptance criteria are almost entirely
downstream of the poller. Putting a synthetic transaction on that bus exercises the populator, the
reconciliation handlers, the version guard, the shipping workers and the sender to SCALE. That covers
AC2, AC3, AC4, AC6 and AC7 in full plus AC5's cancel half, which is 14 of the 23 cases, including
every case the old plan had parked on a fixture nobody controls.

**JJ's decision, 2026-09-08:** synthetic records run all the way through to Manhattan SCALE staging.
The DC team is not yet looking at Manhattan, so the blast radius is low, but every synthetic record is
marked as obviously QA created. See "The synthetic marking rule" below, which is not optional.

**Slice 01 raised the stakes on that rule.** It measured that no rule on `staging-orders-v2-event-bus`
filters on `source`, across all 19 rules: routing is on `detail-type` alone. So an injected event and
a real poller event are indistinguishable at the infrastructure level, and the account role is
`PowerUserAccess` plus `IAMFullAccess`. **The `QASYN-` reference and `SYNTHETIC-REGISTER.md` are the
only separation between synthetic and real records.** Not one safeguard among several, the only one.

**3. R14 absorbed slice 01's other two gates.** `../retests/RETEST-1158-1159/slices/R14-wholesale-shape-and-bundling.md`
is written and unrun. Its W1 settles the wholesale record family and measures whether a wholesale
population exists at all, which is exactly what slice 01's old Gate B and Gate C did. Running both
would mean two table scans and two result files that can disagree. **R14 runs first and slice 06
reads its answer.** Slice 01 keeps Gate A only.

## The rule that makes synthetic results credible

This project has already been burned by hand-built payloads. BUSY-1260's C5 findings came off
hand-built direct-invoke payloads and were retracted, because the poller builds the item `SK` and
`sku` itself, so the malformed states those tests drove could not arise from real Cin7 data. A test
that proves the system mishandles input the system can never receive is worse than no test, because
it costs dev time to dismiss.

**So: seed from reality, mutate one thing.**

* Every synthetic payload starts from a **real persisted CTC order** read out of `staging-orders-v2`
  with `inspect-ctc-order.sh`, or from a real captured emit.
* **Never hand-write a payload from the LLD.** The LLD is the specification, not the observed shape,
  and the two have already diverged on three rows of this ticket's own drift table.
* Mutate **only the field under test**. A synthetic revision is then faithful in shape and invented
  only in the delta, which is the thing being measured.
* Do **not** source the seed by dumping poller log lines. `staging-orders-cin7-so-poller` carries
  unredacted customer data in its `Pushed` lines. Rebuild from the persisted record instead, which is
  already redacted by the schema. See `CLAUDE.md` and `../CTC-customer-data-in-cloudwatch.md`.

Slice 03 exists to prove this discipline holds before any case rests on it, and no slice past 03 runs
until its fidelity gate passes.

## The three suppressors, and why a negative result is worthless without attribution

Three independent mechanisms can silently swallow a synthetic transaction, and a naive "nothing
happened" cannot tell them apart:

1. **The idempotency index.** `idempotency_index` on the orders table, keyed
   `<event>#<origin>#<modifiedDate>#<payloadHash>`. Same key, dropped.
2. **The version guard.** Stored `lastModified` on the order. Incoming value older, dropped. It
   passes on an **equal** timestamp, not only a newer one, because Cin7 `modifiedDate` has whole
   second precision. A test asserting strict inequality reports a false defect.
3. **The FIFO content dedup.** The orders-to-shipping queue deduplicates on content over a 5 minute
   window. Identical content inside that window is dropped with no trace.

This is the exact failure that put BUSY-1159's TC21b at INCONCLUSIVE: a suppression fired, and
nothing named which guard did it, so the case failed on its own terms after being recorded as a pass.

**Standing rule for this plan: every negative result must name which of the three suppressed it, with
evidence.** The design lever is that they key on different things, so they can be isolated:

* To test the **version guard alone**, emit a payload with a **new** `payloadHash` (so the
  idempotency index lets it through) and an **older** `modifiedDate`. Anything that stops it is the
  version guard.
* To test the **idempotency index alone**, re-emit an identical payload after the 5 minute FIFO
  window has passed.
* To test **neither**, vary content and space emits more than 5 minutes apart.

## The synthetic marking rule

Not optional, and it applies to every record any slice in this plan creates.

* **Order reference:** `QASYN-<seq>-<case>`, for example `QASYN-01-TC6`. Sequence is a running
  two-digit number across the whole plan, never reused. **Keep it under 25 characters**, which is the
  SCALE `ShipmentId` ceiling that hard-errored the 33-character split child in BUSY-1159 slices 01
  and 07.
* The prefix is deliberately not a Cin7 reference shape. Real ones look like `#262208`, `WOR19261`,
  `261115`. Nobody should ever have to work out whether a `QASYN-` record was a real order.
* **Every synthetic record is logged in `SYNTHETIC-REGISTER.md`** as it is created: reference, seed
  order, case, what was mutated, timestamp, and whether it reached SCALE. A synthetic record that is
  not in the register is indistinguishable from a real one in six weeks, and this integration is
  already carrying two corrections that came from misreading which order did what.
* **Teardown is a decision, not a default.** The cancel path issues a DELETE on the shipment id, so
  the mechanism to remove them exists and slice 05 exercises it. Whether to clear the register at the
  end is JJ's call once the DC team starts using Manhattan. Do not clear it silently.

## What synthetic injection does not cover

Say this in the QA doc rather than letting it be discovered at handover.

* **AC1's mapping half.** TC1, TC1b and TC4 turn on contact group resolving to order type, which
  happens **inside the poller** against a real Cin7 contact. A synthetic emit already carries
  `orderType`, so it proves the downstream half only. Needs a real wholesale order. That is R14 and
  slice 06.
* **TC17.** Needs a shipment the DC has actually waved in SCALE staging. Nobody has waved one, and
  the case has no defined pass either way. Slice 06, blocked, and it stays blocked.
* **Whether Cin7 actually emits revisions in the shapes we invent.** Synthetic testing proves the
  handlers behave correctly given an input. It cannot prove the input occurs. Every synthetic result
  carries that caveat, and the honest form is "the handler reconciles a quantity change correctly",
  never "quantity changes work".

## Slices

| # | Slice | State | Runnable |
|---|---|---|---|
| 01 | Deployment gate, what landed on 2026-09-03 | **Rewritten 2026-09-08** | Yes, read only |
| 02 | taxStatus coverage | Written 2026-09-01, unchanged | Yes, read only, independent |
| 03 | Synthetic injection harness and fidelity gate | **Written 2026-09-08** | Yes, after 01 |
| 04 | Revision reconciliation, synthetic | **Written 2026-09-08** | Yes, after 03 passes |
| 05 | Cancellation and isolation, synthetic | **Written 2026-09-08** | Yes, after 03 passes |
| 06 | Wholesale mapping and the blocked remainder | **Written 2026-09-08** | Partly, after R14 |

Prerequisite outside this plan: **R14**, which **ran 2026-09-08**. Result in
`../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`. It found that `orderType` has only
ever held the value `ECOM` across the full retained history of both tables, so **no wholesale order
has ever been stored anywhere under any shape**. Slice 06 was rewritten against that answer.

### Case coverage, all 23

| Slice | Cases |
|---|---|
| 02 | TC22 |
| 03 | TC12 |
| 04 | TC5, TC6, TC7, TC8, TC9, TC10, TC11, TC13, TC14, TC19 |
| 05 | TC15, TC16, TC18, TC20, TC21 |
| 06 | TC1, TC1b, TC2, TC3, TC4, TC17 |

### Slice 01, deployment gate

Read only. One job now: characterise what the 2026-09-03 deploy actually contains, because every NOT
RUN row in the QA doc was written on 2026-08-28 against a design that had not shipped. The old Gate B
and Gate C moved to R14.

### Slice 02, taxStatus coverage

Unchanged from 2026-09-01. Read only, independent of everything else, still runnable today. TC22,
from Kian's answer that he mapped only the `taxStatus` values he happened to see while testing.

### Slice 03, synthetic injection harness and fidelity gate

The keystone. Builds `scripts/emit-synthetic-revision.sh` and then proves it faithful before anything
rests on it. Its fidelity gate is a real order's own emit replayed unchanged, which is TC12 and the
harness validation at the same time.

Nothing in slices 04 or 05 is credible until this passes. If it does not pass, that is a complete and
useful session, and the plan reverts to waiting on real Cin7 edits.

### Slice 04, revision reconciliation

TC5 to TC11, TC13, TC14, TC19. The body of the ticket. Every case is a seeded order plus one mutation.

The trap already in the QA doc: **SCALE `SAVE` is additive**, so a field cleared in Cin7 never clears
without an explicit overwrite, and a removal test that only checks for an absent value passes
wrongly. TC7 must assert the removal marker on the orders side and the line's absence on the SCALE
side, and treat either alone as INCONCLUSIVE.

Second trap: **detail line identity is the pair `ErpOrderLineNum` and `SKU.Item`, never the line
number alone**, because every size expanded from a style shares the style's line id. TC10 asserting
on the number alone would report stable identity that is not there.

### Slice 05, cancellation and isolation

TC15, TC16, TC18, TC20, TC21. Cancellation is now drivable, which is the single biggest change from
the 2026-09-01 plan, where it was the least reachable thing on the ticket.

TC20 was reframed on 2026-09-02 after BUSY-1159 slice 13: a payload hash **is** computed on every
emit and carried as the trailing segment of `idempotencyId`; the named `lastEmittedPayloadHash`
attribute is never exposed, by the shape of the emit rather than by a schema gap, and no echo-skip
counter exists in the poller's output. The case asserts a behaviour, no second send, and waits on the
confirmation leg being built. See D17 in `../DEFERRED-TEST-CASES.md`.

### Slice 06, wholesale mapping and the blocked remainder

TC1, TC1b, TC2, TC3, TC4, TC17. **Do not start before R14 has reported.** Its shape depends on R14's
answer to the family question, and a wholesale mapping case written against the wrong family reads
the wrong resources entirely.

TC17 is in here to be recorded as blocked with its reason, not to be run.

## Standing constraints

* **Cin7 is CTC's live production system. READ ONLY, GET calls only, for everyone including JJ.** No
  order created, edited, approved or voided, ever. Synthetic records are created on the AWS side and
  never in Cin7.
* **The poller schedule stays DISABLED for slices 03, 04 and 05, and the watermark stays unset.**
  Injecting on the bus does not involve the poller at all. This is a real benefit: no Cin7 API
  budget, no backlog risk, no watermark writes, no interaction with real traffic. Do not re-enable
  the schedule for these slices, and if a slice seems to need it, that is a signal the slice has
  drifted into BUSY-1159's territory.
* Slice 06 and R14 may need the schedule, and that is the deliberate exception.
* `cin7-watermark.sh` defaults to `--poller item`. Every sales order call needs `--poller so`. The
  wrong flag rewinds the item master feed.
* AWS SSO for the `staging` profile expires between sessions and needs a human in a browser.
* JJ runs production API calls and writes any script needing production credentials himself. The
  synthetic harness needs **staging** credentials only, so it is an IDE session's to build.
* **Extract fields, never print or pipe a whole record.** Three sessions in three days printed
  customer data by accident.
* No script in either plan has been reviewed by a second person, and **that is deliberate**. JJ's
  call: review waits until the bulk of testing is done, and the scripts are saved to be re-used when
  a case has to be revisited. An empty Reviewed column is not an open item and no session should
  chase one. The caveat still goes in every result file: a verdict resting on a script proves the
  script ran, not that the system behaved.
* Read `../../tools/SCRIPTS-INDEX.md` and `SCRIPTS.md` before writing anything new, and follow the header
  rule in `CLAUDE.md`. Scripts are saved, never run inline.

## Superseded

`scripts/watch-for-revisions.sh`, proposed 2026-09-01 as the fixture finder for the old slice 04, is
**no longer needed for this plan**. Synthetic injection replaces it. It retains some value as a way
of finding real revisions to corroborate synthetic results, which is worth doing before sign-off, but
it is no longer on the critical path and nothing here waits on it.

The 2026-09-01 `PLAN.md`, `STATE.md` and slice 01 are kept as `*.bak-20260908`.
