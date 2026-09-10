# Slice 08, final sweep before anything goes to dev

**Purpose:** narrow every open dev question to its sharpest form, and re-attempt three cases that were
called blocked too early
**Cases:** TC18 (second and third form), TC1, TC1b, TC2, TC3 (AC1's downstream half), TC17's
classification half. Plus Q35, Q38, Q40
**Depends on:** nothing. The harness and `../../tools/inspect-lambda-code.sh` both exist
**Estimated:** two sittings. **Stop after any part**, each one stands alone

Parts 1 and 4 are read only. Parts 2 and 3 emit and reach Manhattan SCALE staging.

## Why this slice exists

Three cases on this ticket were recorded as blocked on grounds that do not survive a second look, and
one open question is already answered by evidence sitting in a result file. JJ pushed back on all
three. He was right.

**Ordered cheapest first.** Part 1 is read only and is the part that most directly shortens what goes
to dev. Everything after it is optional if time runs out.

---

## Part 1, source reads. Read only, no emits

### 1a. Q38 closes from evidence already captured. Confirm, do not re-derive

`results/07-poller-cancel-emit-source-read.md` already contains the answer and nobody connected it.
Q38 asks why `skippedStages` counts a wholesale order at `Approved` but gives nothing to one at
`Dispatched`, and names two candidates: a stage-name omission, or an entirely separate earlier code
path. The captured dispatch loop shows the second:

```
if (eligibility === "skip-terminal") continue;      <- Dispatched exits here
...
if (eligibility === "skip-counted") {
  skippedStages.set(stage2, ...)                    <- Approved counted here
```

`Dispatched` is `TERMINAL_STAGE`, so it returns `skip-terminal` and hits `continue` **before** the
counter exists. `Approved` is simply absent from `ELIGIBLE_STAGES`, returns `skip-counted`, and is
counted. This also explains why `skippedLocallyTerminal` read zero on those cycles: that counter
lives inside `updateOrder`, which the 43 never reached.

**Confirm the excerpt against the bundle once**, then close Q38 in the register as
`TRIED 3, CONFIRMED` with the mechanism named. What is left for Kian is one design question, not an
investigation: **is the silent `skip-terminal` path deliberate, or should terminal-stage orders be
counted like every other skip.**

### 1b. Q35, does the poller reject wholesale, or does wholesale simply never arrive eligible

The classifier reads only `{status, stage, isLocallyDispatchedOrFulfilled}`. **No order type, no
contact group.** So eligibility is type-blind, and every wholesale order measured to date was
excluded by stage, which is exactly the confound R13 could never separate.

But `createOrder(order, reference, cin7, contactGroupCache, counters)` takes a contact-group cache,
so type resolution happens downstream of the gate and could still reject there.

Read `createOrder` and the contact-group branch in the same bundle. Establish:

* whether an unmapped or wholesale contact group causes a reject, an alert, or a normal create
* what `orderType` value it writes, and from what
* whether anything in the poller treats WHOLESALE differently from ECOM at all

**Reads as.** If wholesale creates normally, Q35 stops being "why are they dropped" and becomes
"they are not dropped, they have never reached an eligible stage", which is a data question for
Kian, not a defect. If it rejects, that is the mechanism Q35 has been asking for since 2026-09-07,
and it is a one-line answer instead of an open investigation.

### 1c. TC17's real blocker, how a rejection is classified

TC17 cannot get a waved shipment. That is not the half blocking the case. **Nothing defines how a
retryable rejection is told from a permanent one**, and both arrive as an HTTP 200 with
`rejectedTransactions > 0`.

Read `staging-shipping-manhattan-send-shipment` for what it does with a response carrying
`rejectedTransactions > 0`: does it throw, retry, alert, classify, or ignore. Also look for whether
anything distinguishes rejection reasons.

**Reads as.** Whatever it does, TC17 gains a defined pass for the first time, and Lachlan's question
changes from "how should this work" to "the deployed sender does X, is that the intent". That is a
far shorter conversation and it is the whole reason this case has been stuck.

---

## Part 2, TC18 in two more forms. Emits

The form already run emitted a cancel for a reference with **no `ORDER` row at all**. That measured
the orders-side handler with nothing to cancel, and it threw. Useful, and a real finding, but it is
not what TC18 asks. TC18 is about a DELETE reaching SCALE for a shipment SCALE never held.

**Form B, the cheap one. A duplicate cancel.** Take an order already cancelled, `QASYN-09-TC15` is
sitting there in exactly that state, and emit a second `CANCEL_ORDER` against it with a fresh hash
and a newer `modifiedDate`. The `ORDER` row exists, so the header-missing throw cannot fire. This is
the redrive scenario slice 05's own result file called realistic.

**Form C, the one that actually matches TC18's wording.** Build an order whose shipment exists in
DynamoDB but never reached SCALE, then cancel it, so the DELETE goes to SCALE for a shipment it does
not hold. Slice 04 already found the mechanism: a non-numeric `lineItemId` makes the Manhattan
handler refuse to forward, correctly. Create a synthetic order that way deliberately, confirm from
the sender's own log that nothing reached Manhattan, then cancel it.

**For both:** name the outcome with the handler's own attribution line, and say which of the three
forms TC18's verdict should rest on. If all three throw, the defect is broader than slice 05
recorded and that strengthens the report to dev. If form B and C are benign, the original FAIL
narrows to "only when no `ORDER` row exists", which is a more precise and more useful defect.

**Do not purge anything without asking JJ.** Form B or C may trip the same errors alarm the first
form did. Expect it, watch for it, and stop if it fires rather than letting it retry.

---

## Part 3, AC1's downstream half. Emits

**This is the part that was wrongly written off.** A synthetic emit cannot prove the poller resolves a
contact group to WHOLESALE, which is TC4 and stays out of reach. It can prove everything downstream
of that, and Q40 says that is exactly where the defect is.

Construct a `CREATE_ORDER` carrying `orderType: WHOLESALE` and a `deliveryCompany`, seeded from a real
order for shape as always. **This is a designed-for input, not a malformed one**, so it does not
repeat the BUSY-1260 C5 error: the LLD and the ticket both say wholesale orders flow through this
path.

Run the pair, because the two halves fail differently:

| Emit | Address shape | Expected, per Q40's source read |
|---|---|---|
| 1 | `deliveryCompany` set, **and** a person name | `ShipTo` carries the person's name, company ignored |
| 2 | `deliveryCompany` set, **no** person name | The sender throws `refusing to send a shipment with an empty ShipTo` |

Either outcome demonstrates AC1 failing at runtime with a trace, rather than by code read alone.
That is materially stronger evidence to hand Kian.

**While those orders exist, settle TC2 and TC3 as well.** TC2 asks which record family a wholesale
order uses, and both drift rows currently read "unresolved by the build" because no wholesale order
has ever existed to look at. Now one does. Record what is actually written: native shipment rows, or
outbound records, or nothing. **State the ceiling plainly in the verdict**: this is what the handlers
do given a WHOLESALE payload, and whether the poller would ever construct one is Q35, Part 1b above.
Latent, not realised, and say so.

TC3, one row per size with a quantity, is answerable off the same order if the payload can carry a
multi-size style. If the harness cannot construct that, say so and leave TC3 blocked rather than
forcing it.

---

## Part 4, optional. A forced rejection without a wave

Only if Part 1c leaves the classification unclear.

A reference over 25 characters is already known to hard-error at the sender. That is not a post-wave
rejection, so it does not make TC17 pass, but it does exercise the rejection path and shows what the
sender actually does with a failure response. If Part 1c answered it from the code, skip this
entirely.

---

## Standing constraints

* **Cin7 is CTC production. READ ONLY, GET calls only.** Nothing in this slice needs a Cin7 call.
* **Poller schedule stays DISABLED and the watermark stays unset.** Nothing here needs either.
* Every synthetic record in `SYNTHETIC-REGISTER.md` **before** the emit, `QASYN-` prefix, under 25
  characters except where Part 4 deliberately exceeds it. The register is the only thing separating
  synthetic records from real ones.
* Seed from a real persisted order, mutate only what the case needs, never hand-write from the LLD.
* Attribution comes from the handlers' own named log lines, not from poller counters, which never
  move for an injected transaction.
* Extract fields, never print or pipe a whole record. A redactor must recurse.
* Use `filter-log-events` against a log group directly. `describe-log-streams` has produced a false
  "no send" read twice on the Manhattan sender.
* Tag every claim MEASURED, INFERRED or UNKNOWN.

## Stop and ask JJ if

* an alarm fires and stays firing, before purging anything
* a synthetic wholesale order reaches SCALE in a state that looks like real traffic
* Part 1b finds the poller rejects wholesale outright, which is a defect finding and changes what
  goes to Kian
* any part would need the poller schedule, a watermark write or a Cin7 call

## Write results to

`results/08-final-sweep-before-dev.md`, then update `STATE.md`, the affected rows in `QA-DOC.md`
(TC1, TC1b, TC2, TC3, TC17, TC18), both wholesale drift rows, and Q35, Q38, Q40 in
`../BUSY-1065-OPEN-QUESTIONS.md`.

**The deliverable is not just verdicts.** It is the shortest possible form of each remaining dev
question, so JJ can raise them without a paragraph of preamble each.
