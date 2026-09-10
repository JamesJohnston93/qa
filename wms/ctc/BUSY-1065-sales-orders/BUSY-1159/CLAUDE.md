# BUSY-1159 test plan, session context

You are a fresh IDE session working QA on **BUSY-1159, Walking skeleton: ECOM order from Cin7 to Shipment in SCALE (staging)**, part of epic BUSY-1065 (Cin7 Sales Order Integration).

## What the system does

A poller in the orders service reads CTC sales orders from Cin7 every 2 minutes from a watermark held in SSM. Eligible ECOM orders become an order plus order items in the orders table, the existing trickle down builds a shipment header and items, and a sender posts ShippingDownload XML to Manhattan SCALE staging. Only the create path exists in this ticket. Updates, cancellation, wholesale and RTV are later tickets.

## Source of truth

The LLD is the source of truth for the whole integration: Confluence page 1802698758, "LLD - Cin7: Sales Orders and Branch Transfers to Manhattan SCALE WMS (CTC)". Where the Jira ticket, an HLD or the dev handover disagrees with it, the LLD wins and the other artefact is a correction to raise, not a defect to log.

The QA doc lives in Confluence space QD once published. Until then the draft is held in the Claude project "WMS integration QA".

## Open questions

Epic level register: `../BUSY-1065-OPEN-QUESTIONS.md`, at the root of the epic folder.

Kian and Lachlan are unavailable, so several facts this plan depends on are unconfirmed. Every entry in the register carries what we do in the meantime, so no slice is blocked on an unanswered question. If a slice turns up a new one, add it there with the next Q number rather than leaving it in a result file, and say in the result file which Q it became.

## Layout

```
BUSY-1065-sales-orders/BUSY-1159/
  CLAUDE.md      this file
  PLAN.md        the ordered plan, manual and IDE separated
  STATE.md       where we are. Read this second.
  fixtures.md    real values captured during the run
  slices/        one file per sitting
  results/       one result file per slice, written by the session that ran it
  SCRIPTS.md     index of scripts written for this ticket
  scripts/       the scripts themselves
  TOOL-NOTES.md  bugs found in the scripts themselves
  PROPOSALS.md   proposed cases and what happened to them
```

## How to work

1. Read `STATE.md`.
2. Read **only the one slice you were asked to run**. Do not read the others. Loading nine slices to run one burns the context before any work happens.
3. Run it. Write `results/NN-name.md` before the session ends, including a **Scripts written** section naming every script you saved and whether it is reviewed. Update `STATE.md` and, if you wrote a script, `SCRIPTS.md`.

## Scripts you write

**Never run a non trivial command only inline. Save it as a file first, then run the file.**

An inline one liner that exists only in a transcript cannot be reviewed, cannot be re-run identically next time, and has to be rebuilt from scratch on the next pass, which costs tokens and quietly changes what it asserts. Almost every test case here gets repeated, so a script is the deliverable, not scaffolding.

**The threshold.** Save it if it is more than about three lines, if it contains any logic (a loop, a conditional, a parse, an aggregation), or if it will plausibly be run twice. A single `aws ssm get-parameter` stays inline. Anything that reads logs and counts things does not.

**Where it goes.**

* Useful to more than this ticket, promote to `../../tools/` and add a row to `../../tools/SCRIPTS-INDEX.md`.
* Specific to this ticket, `scripts/` beside the plan, with a row in `SCRIPTS.md`.
* When in doubt start in `scripts/` and promote later.

**Before writing anything, read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md`.** Extending an existing script beats writing a new one that overlaps it. Nine sales order scripts already exist.

**Every script carries a header.** This is what makes it reviewable, and the honest part is the fourth line.

```bash
#!/usr/bin/env bash
# <one line: what it does>
#
# Ticket:      BUSY-1159
# Cases:       TC5, TC14
# Asserts:     <the specific claim a pass supports>
# Does NOT:    <what a pass does not prove. Be honest here, this is the line
#              that stops a green run being over read>
# Side effects: read only | writes SSM | invokes a lambda | destructive
#
# Usage: ./name.sh --stage <stage> --profile <profile> [--flags]
```

**Rules that keep them trustworthy.**

* `set -euo pipefail` at the top, always. A silently swallowed non zero exit is how a broken script reports a pass.
* Cin7 calls are GET only, no exceptions. Never add `-X`, `-d` or `--data` to anything touching Cin7.
* Print what was actually sent and what actually came back, not a summary of it. A script that prints its own conclusion and hides the evidence cannot be checked.
* Take `--stage` and `--profile` as arguments. Never hardcode an environment.
* Anything destructive gets a stage guard that checks the AWS account independently of the `--stage` argument, the way `clean-ctc-order.sh` does.
* No customer name, email or address in output that will be pasted anywhere. Redact at the source.

**After writing one.** Add its row to the index with the Reviewed column empty, name it in the result file under Scripts written, and say plainly in the report that it has not been reviewed yet. A passing run from an unreviewed script proves the script ran, not that the system is correct. JJ or a dev fills the Reviewed column, and that is the point of saving them.

**If you change an existing script**, say so in `TOOL-NOTES.md` and re-run whatever earlier case depended on the old behaviour, or note that it needs re-running.

## Hard constraints

* **No em dashes or en dashes anywhere.** Hyphens only.
* **Evidence, not narration.** A clean PASS is a run count and the value observed. A FAIL is as long as it needs to be.
* **No timestamps in notes** unless the duration is itself the finding.
* **Tag every claim MEASURED, INFERRED or UNKNOWN.** Several corrections on this project came from an inference recorded as fact.
* **Cin7 is CTC's live production system.** Read only, GET only. Never create, edit, approve or void a Cin7 record. Never add anything but a plain `curl` GET to a Cin7 script.
* **The tools are also under test.** A failing case is not a system defect until the script has been ruled out. Confirm it sent what it printed, targeted the right stage, and is not swallowing a non zero exit. Record tool fixes in `TOOL-NOTES.md`.
* **Redact before pasting.** Upstream handlers log customer name, email and delivery address in the clear. Strip them from any excerpt that goes into a ticket, page or chat.
* **API budget.** Cin7 allows about 5,000 calls a day shared with the item master and purchase order feeds. Keep watermark windows narrow. Disable the poller schedule when not actively testing.

## Stop and ask JJ if

* a case is inconclusive twice in a row
* teardown fails, or the environment is left in an unknown state
* the blast radius turns out wider than the slice assumed
* a script looks wrong rather than the system under test

## Data handling, added 2026-09-08

**Extract fields, never print or pipe a whole record.** This has now bitten three times in three
sessions: `cut -c` on a multi-line log message (R1), a raw `filter-log-events --output text` dump
(R13), and an API response body printed before extraction (BUSY-1158 slice 05). The record does not
have to come from a log group: a gateway response carries the same customer fields. Route every read
through a named-field allowlist, and print presence and length rather than a value where the field
itself is the point.
