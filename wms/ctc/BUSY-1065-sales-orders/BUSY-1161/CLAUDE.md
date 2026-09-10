# BUSY-1161 test plan, session context

You are a fresh IDE session working QA on **BUSY-1161, Outbound family: RTV end-to-end**, part of epic BUSY-1065 (Cin7 Sales Order Integration).

Ticket is in Review and assigned to JJ. 24 cases, all NOT RUN. Handover written by Kian 2026-09-09.

## What the system does

A poller in the orders service reads CTC sales orders from Cin7 every 2 minutes from a watermark held in SSM, resolves the contact `group` to an order type, and routes anything that is not ECOM down a **dedicated outbound path**, entirely separate from the native ECOM chain BUSY-1159 covers.

That path is: outbound order handler, then a bridge into the shipping service, then a materialiser that writes the shipment header and one line per size, then a sender that builds the Shipment XML from the persisted records and posts it to Manhattan SCALE staging. Header lifecycle is `PENDING_OUTBOUND` to `SENT_OUTBOUND`, plus `CANCELLED_OUTBOUND` and `REMOVED_OUTBOUND` for lines. Every hop is version-guarded on Cin7's `lastModified`.

**This ticket owns WHOLESALE as well as RTV**, despite the ticket text saying RTV only. Kian confirmed it on 2026-09-09 and the deployed code agrees. See correction C6 in the epic register.

## Source of truth

The LLD is the source of truth for the whole integration: Confluence page 1802698758, "LLD - Cin7: Sales Orders and Branch Transfers to Manhattan SCALE WMS (CTC)". Sections 3 and 5 are where this ticket lives. Where the Jira ticket, an HLD or the dev handover disagrees with it, the LLD wins and the other artefact is a correction to raise, not a defect to log.

**Four live drift rows** sit in `QA-DOC.md`. Read that table before writing any verdict that depends on the order type set, `AllocateComplete`, the warehouse code, or the RTV ship-to source.

The engineering handover is Confluence page 1961656356. It is the floor for coverage, not the ceiling.

## Open questions

Epic register: `../BUSY-1065-OPEN-QUESTIONS.md`. Deferred cases: `../DEFERRED-TEST-CASES.md`. A new question gets the next Q number there, not a line in a result file; say in the result file which Q it became.

## Layout

```
BUSY-1065-sales-orders/BUSY-1161/
  CLAUDE.md              this file
  PLAN.md                the ordered plan and why each slice is shaped as it is
  STATE.md               where we are. Read this second.
  QA-DOC.md              the artefact UAT and E2E read. 24 cases.
  KICKOFF.md             paste-ready prompt per slice
  slices/                one file per sitting
  results/               one result file per slice, written by the session that ran it
  SCRIPTS.md             index of scripts written for this ticket
  scripts/               the scripts themselves
  TOOL-NOTES.md          bugs found in the scripts themselves
  PROPOSALS.md           proposed cases and what happened to them
```

Read `STATE.md` next, then **only the one slice you have been asked to run**. Do not read the other slices. Loading seven slices to run one burns the session's context before any work happens.

## Synthetic records

Every synthetic order this plan emits is registered in `../BUSY-1160/SYNTHETIC-REGISTER.md` **before** the emit, continuing that file's sequence. Sixteen already exist and none has been cleared. That register is the only thing distinguishing them from real traffic.

Every reference is `QASYN-<seq>-<case>` and must never have been used before. A reused reference materialises and then silently never sends.

## Hard constraints

- **No em dashes or double hyphens** anywhere: result files, scripts, comments, Confluence.
- Plain nouns in prose, full resource names only in the QA doc's Services table.
- Evidence, not narration. Tag every claim MEASURED, INFERRED or UNKNOWN.
- A clean PASS note is evidence and a run count. A FAIL runs as long as it needs to.
- No dates or timestamps in test notes unless the timing is itself the finding.
- Cin7 is CTC live production. GET only, always. JJ runs anything needing production credentials himself.

## Tooling

**The engineer's toolset is at `../../tools/`**, beside the epic folders. `SCRIPTS.md` beside this file indexes what it gives this ticket; that toolset's own `CLAUDE.md` and READMEs are the detail.

`cin7-sales-orders/invoke-so-revision.sh` drives nearly every case here. Three things about it that catch people:

- **`--family outbound` is mandatory.** Five fixture basenames exist in both the ECOM and outbound sets with unrelated content, auto-resolution checks ECOM first, and naming the order type alone does not save it.
- **It reimplements the mapping in Python** rather than calling the deployed code. A clean run proves SCALE accepts that document, not that the deployed mapper builds it. Carry that caveat on every verdict except TC9's.
- **Fixture last-modified values ascend.** Re-applying an earlier scenario after a later one is an older save, and that is how the stale and out-of-order cases are driven. There is no flag to set the value.

`../../tools/inspect-lambda-code.sh` is still the only way to read a deployed artefact. The new toolset has no equivalent.

**Nothing reads a Shipment back from SCALE.** Every "reaches SCALE" expectation is a human read in the SCALE UI.

## Scripts are saved, never run inline

Save it if it is more than about three lines, contains any logic, or will plausibly run twice. Ticket-specific scripts go in `scripts/` and get a row in `SCRIPTS.md`; anything reusable is promoted to `../../` and indexed in `../../tools/SCRIPTS-INDEX.md`.

**Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` before writing anything.** Almost nothing should need writing on this ticket, because the engineer's toolset covers the drive surface. A scenario that does not exist is added by extending `make-wholesale-scenarios.py` in his folder, which is what its own README asks for, not by writing a competing emitter here.

Every script carries this header:

```bash
#!/usr/bin/env bash
# <one line: what it does>
#
# Ticket:       BUSY-1161
# Cases:        TC5, TC14
# Asserts:      <the specific claim a pass supports>
# Does NOT:     <what a pass does not prove>
# Side effects: read only | writes <what> | invokes <what> | destructive
#
# Usage: ./name.sh --stage <stage> --profile <profile> [--flags]
```

`set -euo pipefail` always. Print what was sent and what came back, not a summary. Take stage and profile as arguments, never hardcoded. No customer name, email or address in output that gets pasted anywhere. An emitting script's `Does NOT` line must say that a clean run proves the handler behaved given that input, not that the input occurs in real traffic.

Review is deferred by design, JJ's call. An empty Reviewed column is the expected state. Keep stating the caveat in result files anyway.
