# BUSY-1160 test plan, session context

You are a fresh IDE session working QA on **BUSY-1160, Native updates: wholesale mapping, line reconciliation, cancellation**, part of epic BUSY-1065 (Cin7 Sales Order Integration).

Deployed to staging 2026-09-03. Ticket is in Review and assigned to JJ. 23 cases, all NOT RUN.

## What the system does

A poller in the orders service reads CTC sales orders from Cin7 every 2 minutes from a watermark held in SSM. BUSY-1159 built the create path: an eligible ECOM order becomes an order plus order items, the trickle down builds a shipment header and items, and a sender posts ShippingDownload XML to Manhattan SCALE staging.

**This ticket is everything that happens after first sight.** The poller does no diffing at all: it emits one transaction per revision carrying the full current line set. The orders service handlers reconcile against that set, inserting new lines, updating changed quantities in place under the same item key, and marking vanished lines removed. The cancel handler flips the order without physical deletion. All three are version-guarded on the order's stored `lastModified`, and each publishes exactly one outward event per revision. Wholesale arrives as the second native order type, with the delivery company as `ShipTo` and an order type stamp on the header.

The ticket originally had the poller doing the diffing and **the LLD explicitly rejects that design**. Anything written against the old shape is stale.

## Source of truth

The LLD is the source of truth for the whole integration: Confluence page 1802698758, "LLD - Cin7: Sales Orders and Branch Transfers to Manhattan SCALE WMS (CTC)". Sections 3, 5, 9.1, 11.2 and 11.5 are the ones this ticket lives in. Where the Jira ticket, an HLD or the dev handover disagrees with it, the LLD wins and the other artefact is a correction to raise, not a defect to log.

This ticket's QA doc has **three live drift rows** where the LLD and the ticket disagree outright. Read the drift table in `QA-DOC.md` before writing a verdict that depends on either.

The QA doc lives in Confluence space QD once published. BUSY-1160 has no page yet, deliberately.

## Open questions

Epic level register: `../BUSY-1065-OPEN-QUESTIONS.md`, at the root of the epic folder. Currently Q1 to Q39.

If a slice turns up a new one, add it there with the next Q number rather than leaving it in a result file, and say in the result file which Q it became.

Deferred cases: `../DEFERRED-TEST-CASES.md`. D17 is this ticket's TC20.

## Layout

```
BUSY-1065-sales-orders/BUSY-1160/
  CLAUDE.md              this file
  PLAN.md                the ordered plan and why each slice is shaped as it is
  STATE.md               where we are. Read this second.
  QA-DOC.md              the artefact UAT and E2E read. 23 cases.
  SYNTHETIC-REGISTER.md  every synthetic record this plan creates
  slices/                one file per sitting
  results/               one result file per slice, written by the session that ran it
  SCRIPTS.md             index of scripts written for this ticket
  scripts/               the scripts themselves
  TOOL-NOTES.md          bugs found in the scripts themselves
  PROPOSALS.md           proposed cases and what happened to them
```

## How to work

1. Read `STATE.md`.
2. Read **only the one slice you were asked to run**. Do not read the others. Loading six slices to run one burns the context before any work happens.
3. Run it. Write `results/NN-name.md` before the session ends, including a **Scripts written** section naming every script you saved and whether it is reviewed. Update `STATE.md` and, if you wrote a script, `SCRIPTS.md`.

## Synthetic records, the thing that makes this ticket different

Most of this ticket is driven by injecting a synthetic transaction onto `staging-orders-v2-event-bus` rather than by waiting for a real Cin7 edit. **Cin7 is the only read-only link in the chain**, and everything downstream of the poller is staging AWS that QA can write to. JJ approved this on 2026-09-08, and approved synthetic records running all the way through to Manhattan SCALE staging.

### The routing contract, MEASURED. Two stages, not one

Do not re-derive this. Detail in `results/01-deployment-gate.md` and
`results/03-synthetic-harness-and-fidelity.md`.

**Stage 1, what the poller actually emits, and what the harness must emit.** MEASURED from a real
`Pushed ... to EventBridge` line: `Source: "orders-cin7.cin7-so-poller.lambda"`,
`DetailType: "CREATE_TRANSACTION"`, bus `staging-orders-v2-event-bus`. This routes to the **shared**
`staging-orders-v2-eda-queue-populator`, then the shared `staging-orders-v2-eda-queue-handler`, which
persists the `TRANSACTION` audit row, enforces idempotency and applies the version guard. The verb
(`CREATE_ORDER` / `UPDATE_ORDER` / `CANCEL_ORDER`) travels in `Detail.event`, **not** in `DetailType`.

**Stage 2, what that handler re-emits.** `TRANS_CREATE_ORDER` / `TRANS_UPDATE_ORDER` /
`TRANS_CANCEL_ORDER`, each routing to its own cin7-specific populator
(`staging-orders-cin7-update-order-eda-queue-populator`, `-cancel-order-...`) and on to the
reconciliation handlers.

**Both hops are real and a session must not conflate them.** Slice 01's result file recorded stage 2
and called stage 1 a mistake; slice 03 measured stage 1 directly and found both descriptions correct
about different hops. **Inject at stage 1.** A harness injecting `TRANS_UPDATE_ORDER` directly skips
the shared transaction chain, and with it the `idempotency_index` and the `TRANSACTION` audit trail,
so it would not be testing what the poller does.

No rule on the bus filters on `source`, across all 19 rules: routing is on `detail-type` alone.
`events:PutEvents` is permitted, confirmed by policy simulation against the real role and resource,
and the bus carries no restrictive resource policy.

### Two hashes, not one. MEASURED by slice 03

`idempotencyId`'s trailing hash segment and `orderInfo.lastEmittedPayloadHash` are **different
values on the same order**, confirmed across four real orders (`#262208`, `#262210`, `#262211`,
`#262216`). They are two independently computed hashes. Earlier notes in this plan said "a payload
hash is computed on every emit and carried as the trailing segment of `idempotencyId`", which reads
as one hash serving both roles. It does not. Neither algorithm is known without a code read, and the
harness keeps both fields equal to whatever it is given, so **any case that depends on a hash's
value matching something specific is out of the harness's reach**. Cases that need a hash merely to
be new or different are fine.

### The four rules

None is optional.

**1. Seed from reality, mutate one thing.** Every synthetic payload starts from a **real persisted CTC order** read out of `staging-orders-v2`, never hand-written from the LLD. The LLD is the specification, not the observed shape. Mutate only the field under test, one mutation per emit: a payload carrying two mutations cannot attribute its own result.

This epic has already paid for getting it wrong. **BUSY-1260's C5 findings came off hand-built direct-invoke payloads and were retracted**, because the poller builds the item `SK` and `sku` itself so those malformed states could not arise from Cin7 data. TC45 went back to NOT RUN and TC55 was removed. A test proving the system mishandles input it can never receive is worse than no test, because it costs dev time to dismiss.

**2. Do not source a seed from poller log lines.** `staging-orders-cin7-so-poller` carries unredacted customer data in its `Pushed` lines. Rebuild from the persisted record, which the schema has already shaped. Replace customer fields with obvious placeholders rather than carrying a real person's details into a deliberately fake order.

**The register is the only thing separating synthetic records from real ones.** Slice 01 measured
that no rule on the bus filters on `source`, so nothing at the infrastructure level distinguishes an
injected event from a real poller event: they route identically and land in the same tables. The
`QASYN-` reference and `SYNTHETIC-REGISTER.md` are not housekeeping, they are the entire separation
mechanism. Treat a missing register row the way you would treat a missing stage guard on a
destructive script.

**3. Mark and register every record, before the emit.** Reference is `QASYN-<seq>-<case>`, for example `QASYN-01-TC6`. Sequence is a running two-digit number across the whole plan, never reused. **Under 25 characters**, which is the SCALE `ShipmentId` ceiling that hard-errored the 33-character split child in BUSY-1159 slices 01 and 07. Write the `SYNTHETIC-REGISTER.md` row **before** the emit, so a failed emit still leaves a trace. Teardown is JJ's call, never a default, and the register is never cleared silently.

**4. State the ceiling in every verdict.** Injection proves the handler behaves correctly **given an input**. It cannot prove the input occurs. Write "the handler reconciles a quantity change in place", never "quantity changes work".

## A negative result names its cause

Three mechanisms can silently swallow a synthetic transaction, and "nothing happened" cannot tell them apart:

1. **The idempotency index**, keyed `<event>#<origin>#<modifiedDate>#<payloadHash>`
2. **The version guard** on the order's stored `lastModified`
3. **The FIFO content dedup**, 5 minutes, on the orders-to-shipping queue

**Every negative result names which one, with evidence**: a handler log line, a counter, or an absence measured against a same-window control that did fire. **A bare absence is INCONCLUSIVE, not a PASS.**

BUSY-1159's TC21b is the precedent. Its expected result was that the guard suppressing a replay be named. No guard was named, the case was recorded as a PASS, and the audit moved it to INCONCLUSIVE because it had failed on its own terms.

They key on different things, which is what lets a slice isolate one. **A payload with a new `payloadHash` and an older `modifiedDate`** gets past the idempotency index and past the FIFO dedup by construction, so anything that stops it is the version guard.

**The version guard passes on an equal timestamp, not only a newer one**, because Cin7 `modifiedDate` has whole second precision and two edits inside one second carry the same value. A case asserting strict inequality reports a false defect against correct code.

## Scripts you write

**Never run a non trivial command only inline. Save it as a file first, then run the file.**

An inline one liner that exists only in a transcript cannot be reviewed, cannot be re-run identically next time, and has to be rebuilt from scratch on the next pass, which costs tokens and quietly changes what it asserts. Almost every test case here gets repeated, so a script is the deliverable, not scaffolding.

**The threshold.** Save it if it is more than about three lines, if it contains any logic (a loop, a conditional, a parse, an aggregation), or if it will plausibly be run twice. A single `aws ssm get-parameter` stays inline. Anything that reads logs and counts things does not.

**Where it goes.**

* Useful to more than this ticket, promote to `../../tools/` and add a row to `../../tools/SCRIPTS-INDEX.md`.
* Specific to this ticket, `scripts/` beside the plan, with a row in `SCRIPTS.md`.
* When in doubt start in `scripts/` and promote later.

**Before writing anything, read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md`.** Extending an existing script beats writing a new one that overlaps it. The shared toolset already covers most of this, and BUSY-1158, BUSY-1159 and RETEST-1158-1159 each have their own `SCRIPTS.md`.

**Every script carries a header.** This is what makes it reviewable, and the honest part is the fourth line.

```bash
#!/usr/bin/env bash
# <one line: what it does>
#
# Ticket:      BUSY-1160
# Cases:       TC6, TC12
# Asserts:     <the specific claim a pass supports>
# Does NOT:    <what a pass does not prove. Be honest here, this is the line
#              that stops a green run being over read>
# Side effects: read only | writes SSM | invokes a lambda | emits to the bus | destructive
#
# Usage: ./name.sh --stage <stage> --profile <profile> [--flags]
```

**Rules that keep them trustworthy.**

* `set -euo pipefail` at the top, always. A silently swallowed non zero exit is how a broken script reports a pass.
* Cin7 calls are GET only, no exceptions. Never add `-X`, `-d` or `--data` to anything touching Cin7.
* **Anything that emits defaults to `--dry-run`.** Print the constructed payload with customer fields redacted and emit nothing. Emitting requires an explicit flag.
* Print what was actually sent and what actually came back, not a summary of it. A script that prints its own conclusion and hides the evidence cannot be checked.
* Take `--stage` and `--profile` as arguments. Never hardcode an environment.
* Anything destructive gets a stage guard that checks the AWS account independently of the `--stage` argument, the way `clean-ctc-order.sh` does.
* No customer name, email or address in output that will be pasted anywhere. Redact at the source.

**After writing one.** Add its row to the index with the Reviewed column empty, name it in the result file under Scripts written, and say plainly in the report that it has not been reviewed yet. A passing run from an unreviewed script proves the script ran, not that the system is correct.

**Review is deliberately deferred and is not a blocker.** JJ's call: nothing gets a second reader until the bulk of testing is done. The scripts are saved so they can be re-used when a case has to be revisited, not so they can be signed off one at a time. So write the row, say plainly in the result file that it is unreviewed, and move on. Do not chase a review, do not treat an empty Reviewed column as an open item, and do not hold a verdict waiting for one. The honest caveat still goes in the report every time: an unreviewed script means the verdict rests on the script having done what it printed.

**If you change an existing script**, say so in `TOOL-NOTES.md` and re-run whatever earlier case depended on the old behaviour, or note that it needs re-running.

## Hard constraints

* **No em dashes or en dashes anywhere.** Hyphens only.
* **Evidence, not narration.** A clean PASS is a run count and the value observed. A FAIL is as long as it needs to be.
* **No timestamps in notes** unless the duration is itself the finding.
* **Tag every claim MEASURED, INFERRED or UNKNOWN.** Several corrections on this project came from an inference recorded as fact.
* **Cin7 is CTC's live production system.** Read only, GET only. Never create, edit, approve or void a Cin7 record. Synthetic records are created on the AWS side and never in Cin7.
* **The poller schedule stays DISABLED and the watermark stays unset for slices 01 to 05.** Injection does not involve the poller. If a slice seems to need the schedule, it has drifted. Slice 06 and R14 are the deliberate exceptions.
* `cin7-watermark.sh` defaults to `--poller item`. Every sales order call needs `--poller so`. The wrong flag rewinds the item master feed.
* **The tools are also under test.** A failing case is not a system defect until the script has been ruled out. Confirm it sent what it printed, targeted the right stage, and is not swallowing a non zero exit. Record tool fixes in `TOOL-NOTES.md`.
* **Redact before pasting.** Upstream handlers log customer name, email and delivery address in the clear. Strip them from any excerpt that goes into a ticket, page or chat.
* **API budget.** Cin7 allows about 5,000 calls a day shared with the item master and purchase order feeds. Slices 03 to 05 make no Cin7 calls at all, which is one of the reasons this plan is shaped the way it is.
* **SCALE reads are in Order Planning > Planned Shipment Insights.** Shipping Insights lists post-wave shipments only, and reading an absence off it is how BUSY-1159 briefly concluded SCALE was accepting documents without creating shipments.

## Stop and ask JJ if

* a case is inconclusive twice in a row
* teardown fails, or the environment is left in an unknown state
* the blast radius turns out wider than the slice assumed
* a script looks wrong rather than the system under test
* a synthetic record reaches SCALE in a state you did not intend
* a mutation produces a change on an order it was not aimed at

## Data handling

**Extract fields, never print or pipe a whole record.** This has now bitten **five times in four days**: `cut -c` on a multi-line log message (R1), a raw `filter-log-events --output text` dump (R13), an API response body printed before extraction (BUSY-1158 slice 05), and twice in BUSY-1160 slice 03, where a top-level-only redactor missed a nested `addressChanges.shipping` object. The record does not have to come from a log group: a gateway response carries the same customer fields, and so does a DynamoDB row.

**A redactor must recurse.** The slice 03 failure is the instructive one: the allowlist was correct and was applied only at the top level, so a nested object walked straight past it. Verify a redactor against known-PII strings before trusting it, the way slice 03 did after the second incident (`safe-read-order.py`), rather than assuming an allowlist is doing what it looks like it does.

Four log groups carry unredacted customer data: `{stage}-orders-cin7-so-poller`, `staging-faulty-sale-worker-queue-handler`, `staging-inventory-check-order-faulty-sale`, `staging-shipping-v2-dc-packing-shipment-create`. So does the `listOrders` gateway response. See `../CTC-customer-data-in-cloudwatch.md`.

Route every read through a named-field allowlist, and print presence and length rather than a value where the field itself is the point.
