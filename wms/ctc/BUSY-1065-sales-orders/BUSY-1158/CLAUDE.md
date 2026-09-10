# BUSY-1158 test plan, session context

You are a fresh IDE session working QA on **BUSY-1158, Prefactor: CTC-ready order and shipment
schema + consumer guards**, part of epic BUSY-1065 (Cin7 Sales Order Integration).

## What the system does

This ticket makes both services CTC-ready before any CTC order flows. The orders service gains the
`CIN7_SO` origin and a set of new fields on the order and order item. The shipping service gains
`company`, `orderType` and `cin7Id` on the shipment header and in the transaction payload block.
Every existing consumer of order and native shipment events is given an explicit stance on CTC
records, almost always to skip them. The ticket moves no orders itself.

## Scope discipline

**This plan is BUSY-1158 only.** The walking skeleton that moves an order from Cin7 to SCALE is
BUSY-1159 and has its own finished plan in `../BUSY-1159`. Do not run its cases here and do not edit
its files.

Six rows in `QA-DOC.md` carry evidence from BUSY-1159 slices and are marked as carried. They are not
re-run in this plan. If a slice here turns up something that contradicts a carried row, say so in the
result file and flag it for JJ rather than editing the BUSY-1159 doc.

## Source of truth

The LLD is the source of truth for the whole integration: Confluence page 1802698758, "LLD - Cin7:
Sales Orders and Branch Transfers to Manhattan SCALE WMS (CTC)". Section 3 holds the record model and
the consumer guard audit table, which is what this ticket is graded against. Where the Jira ticket or
an HLD disagrees with it, the LLD wins and the other artefact is a correction to raise, not a defect
to log.

There is no engineering QA handover page for this ticket and no PR. Kian's ticket comments of
2026-07-29, 2026-07-30 and 2026-08-18 are the only dev-side account of what was built.

The QA doc lives in Confluence space QD once published. Until then the draft is `QA-DOC.md` here,
mirrored in the Claude project "WMS integration QA".

## Open questions

Epic level register: `../BUSY-1065-OPEN-QUESTIONS.md`, at the root of the epic folder. If a slice
turns up a new one, add it there with the next Q number rather than leaving it in a result file, and
say in the result file which Q it became.

## Layout

```
BUSY-1065-sales-orders/BUSY-1158/
  CLAUDE.md      this file
  KICKOFF.md     paste-ready IDE prompt per slice, for JJ not for you
  PLAN.md        the ordered plan, manual and IDE separated
  STATE.md       where we are. Read this second.
  QA-DOC.md      the artefact UAT and E2E read
  slices/        one file per sitting
  results/       one result file per slice, written by the session that ran it
  SCRIPTS.md     index of scripts written for this ticket
  scripts/       the scripts themselves
  TOOL-NOTES.md  bugs found in the scripts themselves
  PROPOSALS.md   proposed cases and what happened to them
```

## How to work

1. Read `STATE.md`.
2. Read **only the one slice you were asked to run**. Do not read the others.
3. Run it. Write `results/NN-name.md` before the session ends, including a **Scripts written**
   section naming every script you saved and whether it is reviewed. Update `STATE.md` and, if you
   wrote a script, `SCRIPTS.md`.

## Scripts you write

**Never run a non trivial command only inline. Save it as a file first, then run the file.**

A command that exists only in a transcript cannot be reviewed, cannot be re-run identically, and has
to be rebuilt from scratch next time, which costs tokens and quietly changes what it asserts.

**The threshold.** Save it if it is more than about three lines, if it contains any logic (a loop, a
conditional, a parse, an aggregation), or if it will plausibly be run twice. A single
`aws ssm get-parameter` stays inline. Anything that reads logs and counts things does not.

**Where it goes.**

* Useful to more than this ticket, promote to `../../tools/` and add a
  row to `../../tools/SCRIPTS-INDEX.md`.
* Specific to this ticket, `scripts/` beside the plan, with a row in `SCRIPTS.md`.
* When in doubt start in `scripts/` and promote later.

**Before writing anything, read `SCRIPTS.md`, `../../tools/SCRIPTS-INDEX.md` and `../BUSY-1159/SCRIPTS.md`.**
Extending an existing script beats writing a new one that overlaps it. Fifteen sales order scripts
already exist across the shared toolset and the BUSY-1159 plan.

**Every script carries a header.** The `Does NOT` line is the one that earns its place.

```bash
#!/usr/bin/env bash
# <one line: what it does>
#
# Ticket:      BUSY-1158
# Cases:       TC4b, TC4c
# Asserts:     <the specific claim a pass supports>
# Does NOT:    <what a pass does not prove. Be honest here, this is the line
#              that stops a green run being over read>
# Side effects: read only | writes SSM | invokes a lambda | destructive
#
# Usage: ./name.sh --stage <stage> --profile <profile> [--flags]
```

**Rules that keep them trustworthy.**

* `set -euo pipefail` at the top, always.
* Cin7 calls are GET only, no exceptions. Never add `-X`, `-d` or `--data` to anything touching Cin7.
* Print what was actually sent and what actually came back, not a summary of it.
* Take `--stage` and `--profile` as arguments. Never hardcode an environment.
* Anything destructive gets a stage guard that checks the AWS account independently of the `--stage`
  argument, the way `clean-ctc-order.sh` does.
* **No customer name, email or address in output.** This matters more in this plan than in BUSY-1159,
  because TC5b is explicitly a question about an email field. Print presence and length, never the
  value. Redact at the source.

**After writing one.** Add its row to the index with the Reviewed column empty, name it in the result
file under Scripts written, and say plainly in the report that it has not been reviewed yet. A
passing run from an unreviewed script proves the script ran, not that the system is correct.

**If you change an existing script**, say so in `TOOL-NOTES.md` and re-run whatever earlier case
depended on the old behaviour, or note that it needs re-running. `check-ctc-consumer-guards.sh` in
particular is shared with BUSY-1159 and every carried guard verdict in this doc rests on it.

## Hard constraints

* **No em dashes or en dashes anywhere.** Hyphens only.
* **Evidence, not narration.** A clean PASS is a run count and the value observed. A FAIL is as long
  as it needs to be.
* **No timestamps in notes** unless the duration is itself the finding.
* **Tag every claim MEASURED, INFERRED or UNKNOWN.**
* **A skip and an absence look the same.** This ticket is almost entirely about consumers doing
  nothing. A consumer that logs no guard line has not passed, it has told you nothing. Say which of
  the two you observed.
* **Cin7 is CTC's live production system.** Read only, GET only. Never create, edit, approve or void
  a Cin7 record.
* **The tools are also under test.** A failing case is not a system defect until the script has been
  ruled out. Record tool fixes in `TOOL-NOTES.md`.
* **API budget.** Cin7 allows about 5,000 calls a day shared with the item master and purchase order
  feeds. This plan needs very few: only slice 02 wants a fresh CTC order, and staging usually already
  has one.

## Stop and ask JJ if

* a case is inconclusive twice in a row
* teardown fails, or the environment is left in an unknown state
* the blast radius turns out wider than the slice assumed
* a script looks wrong rather than the system under test
* a result contradicts a row carried from BUSY-1159

## Data handling, added 2026-09-08

**Extract fields, never print or pipe a whole record.** This has now bitten three times in three
sessions: `cut -c` on a multi-line log message (R1), a raw `filter-log-events --output text` dump
(R13), and an API response body printed before extraction (BUSY-1158 slice 05). The record does not
have to come from a log group: a gateway response carries the same customer fields. Route every read
through a named-field allowlist, and print presence and length rather than a value where the field
itself is the point.
