# BUSY-1158 and BUSY-1159 re-test, session context

This folder is the 2026-09-04 re-test of BUSY-1158 and BUSY-1159 after Kian deployed BUSY-1160 plus fixes. Read PLAN.md for why each session exists. The ticket-level context still lives in ../../BUSY-1158/ and ../../BUSY-1159/, including their QA-DOC.md, STATE.md and results/.

## IDE session context

You are a fresh IDE session working QA on both BUSY-1158 (Prefactor: CTC-ready order and shipment schema + consumer guards) and BUSY-1159 (Walking skeleton: ECOM order from Cin7 to Shipment in SCALE staging), part of epic BUSY-1065 (Cin7 Sales Order Integration).

## Source of truth

The LLD is the source of truth for the whole integration: Confluence page 1802698758, "LLD - Cin7: Sales Orders and Branch Transfers to Manhattan SCALE WMS (CTC)". Where the Jira ticket, an HLD or the dev handover disagrees with it, the LLD wins and the other artefact is a correction to raise, not a defect to log.

## Open questions

Epic level register: `../../BUSY-1065-OPEN-QUESTIONS.md`, at the root of the epic folder. If a slice turns up a new one, add it there with the next Q number rather than leaving it in a result file.

## How to work

1. Read `STATE.md`.
2. Read only the one slice you were asked to run. Do not read the others.
3. Run it. Write `results/NN-name.md` before the session ends. Update `STATE.md`.

## Scripts you write

Never run a non-trivial command only inline. Save it as a file first, then run the file.

The threshold: save it if it is more than about three lines, if it contains any logic (loop, conditional, parse, aggregation), or if it will plausibly be run twice.

Where it goes: useful to more than this ticket, promote to `~/Desktop/QA/wms/ctc/` and add a row to `../../../tools/SCRIPTS-INDEX.md`. Specific to a ticket, save in `scripts/` beside the plan and add a row to `SCRIPTS.md`. Before writing anything, read `SCRIPTS.md`, `../../../tools/SCRIPTS-INDEX.md`, `../../BUSY-1158/SCRIPTS.md` and `../../BUSY-1159/SCRIPTS.md`.

Every script carries a header with ticket, cases, asserts, and a "Does NOT" line stating what a pass does not prove. Required rules:

- `set -euo pipefail` at the top, always.
- Cin7 calls are GET only, no exceptions. Never add `-X`, `-d` or `--data` to anything touching Cin7.
- Print what was actually sent and what actually came back, not a summary.
- Take `--stage` and `--profile` as arguments. Never hardcode an environment.
- Anything destructive gets a stage guard that checks the AWS account independently of the `--stage` argument.
- No customer name, email or address in output. Print presence and length, never the value.

## Hard constraints

- No em dashes or en dashes. Hyphens only.
- Evidence, not narration. A clean PASS is a run count and the value observed.
- No timestamps in notes unless the duration is itself the finding.
- Tag every claim MEASURED, INFERRED or UNKNOWN.
- Cin7 is CTC's live production system. Read only, GET only. Never create, edit, approve or void a Cin7 record.

## Poller, watermark and fixtures (BUSY-1159)

A poller in the orders service reads CTC sales orders from Cin7 every 2 minutes from a watermark held in SSM. Keep watermark windows narrow. Disable the poller schedule when not actively testing. Real values captured during runs live in fixtures.md.

## AWS environment

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=staging
aws sso login --profile staging     # browser device-code flow, needs a human, expires between sessions
```

Region is `ap-southeast-2` on every call.

## Watermark and poller schedule

Read the watermark before changing anything, and read it back after any set:

```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```

`--poller so` every time. **The flag defaults to `item`, and the wrong flag rewinds the item master
feed.**

As at 2026-09-02: poller schedule DISABLED since 2026-08-28, watermark
`2026-08-28T01:35:45.769Z`. Slice R0 re-confirms both. If either has moved, do not correct it, record
it and tell JJ.

A manual poller invoke invalidates the assumptions behind BUSY-1159 TC1 and TC11.

## Customer data in CloudWatch

The faulty sale worker and the dc-packing workers log unredacted customer data. See
`../../CTC-customer-data-in-cloudwatch.md`. When reading those log groups, extract only the fields you
need and never print a matched line whole.

**Width truncation is not redaction.** Do not use `cut -c`, `head -c` or any width-based cap to make
log output safe to print. Log messages contain embedded newlines, so a width cap applies per segment
and a full customer record prints anyway. This happened in R1 on 2026-09-04. Select fields explicitly
with `--query`, `jq` or a parser and print only those, or print presence and length instead of the
value.

**Extract fields, never print or pipe a whole record.** This has now bitten three times in three
sessions: `cut -c` on a multi-line log message (R1), a raw `filter-log-events --output text` dump
(R13), and an API response body printed before extraction (BUSY-1158 slice 05). The record does not
have to come from a log group: a gateway response carries the same customer fields. Route every read
through a named-field allowlist, and print presence and length rather than a value where the field
itself is the point.


## Credentials

Cin7 credentials live in `.env` beside the scripts, not in AWS. JJ runs production API calls himself
and writes any script that needs production credentials himself. Do not plan a step that requires you
to handle them.

## Cin7 is never written to, by anyone

This is a hard constraint, not a scoping preference: **nobody on this team edits Cin7, ever, JJ
included.** Cin7 is CTC's live production system and it stays read-only, full stop. There is no path
by which a test case gets a purpose-built fixture (an edited order, a manufactured rejection, a
manufactured repeated-option line) created in it. If a case's design assumes an edit can be made to
produce a fixture, that assumption is wrong regardless of who the plan names to make it.

**The practical consequence: this team can only test against whatever naturally occurs in Cin7.** A
case that needs a specific shape (a hard-error SKU, a reference over 25 characters, a repeated option
code, an order at a picked stage, a second revision of an existing order) either finds one already
sitting in live data or it does not run yet. Re-check opportunistically (cheap, read-only, like R5's
Gate A) rather than treating absence as a blocker to escalate every time. A slice or case that has no
other way to proceed except an edit is not blocked pending a person, it is not runnable as designed
and needs re-scoping, and that is worth raising as its own finding rather than parking it as "waiting
on JJ."

## Stop and ask JJ if

- a case is inconclusive twice in a row
- teardown fails or the environment is left in an unknown state
- the blast radius turns out wider than the slice assumed
- a script looks wrong rather than the system under test
