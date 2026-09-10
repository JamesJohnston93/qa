# Investigation, narrowing the open questions for Kian

You are a fresh IDE session. This is **not** a QA test plan and it produces no TC verdicts. The
deliverable is `FINDINGS.md`, written so JJ can put it in front of a developer without editing it.

## Why this exists

Six questions on epic BUSY-1065 are waiting on Kian. Several are answerable, or at least
substantially narrowable, from staging without him. Every question we settle ourselves is one he does
not have to context-switch into, and every question we narrow arrives with the boundary already drawn
instead of an open-ended ask.

Register: `../../BUSY-1065-OPEN-QUESTIONS.md`. Read the "At a glance" block and the Kian table before
starting. Do not renumber anything and do not answer a question in the register itself; findings go in
`FINDINGS.md` and JJ moves them across after he has read them.

## What is in scope

| Q | What we are trying to do to it |
|---|---|
| Q2 | **Done. Closed as a non-issue after slice 01, see the register.** Do not reopen it |
| Q25 | **Done for now. Slice 01 showed the metric is account-wide and cannot answer it, and JJ asked Kian directly on 2026-08-31.** Do not re-investigate; `FINDINGS.md` records the state and the simulation route |
| Q26 | Turn three known examples into a real population number, with timestamps |
| Q27 | Upgrade from "receives CTC records" to what it actually does with them |
| Q29 | Narrow only. Do not expect to close it |

Q10, whether QA gets repo access, is an ask and not investigable. Leave it alone.

## Hard rules

* **Read only. Nothing in this investigation writes, invokes, or changes configuration.** The
  `PutEvents` forcing test in `Plan B` is explicitly out of scope here: it needs JJ's sign-off and has
  real blast radius. Tier B1 only.
* **Cin7 is CTC's live production system. GET only, no exceptions.** Never add `-X`, `-d` or `--data`
  to anything touching Cin7.
* **Redaction is the standing hazard of this session, more than any other so far.** Two of the log
  groups you will read dump whole order records in the clear. `faulty-sale-worker-queue-handler` logs
  its entire SQS body at INFO, including customer email and address. The dc-packing workers log
  customer names. Extract the field you need with a narrow pattern and never print a matched line
  whole. See `../../BUSY-1158/TOOL-NOTES.md`.
* **No em dashes or en dashes anywhere.** Hyphens only.
* **Tag every claim MEASURED, INFERRED or UNKNOWN.** This document goes to a developer who will check
  it, so an inference presented as a measurement is worse here than anywhere else.
* Scripts are saved as files, never run inline, per the same rule as the test plans. Header format is
  in `../../BUSY-1158/CLAUDE.md`. Read `../../../tools/SCRIPTS-INDEX.md` before writing a new one,
  there are already fifteen scripts on this epic.

## The distinction that matters most

For each question, say which of these you achieved, and do not blur them:

**Closed.** We have the answer. Kian does not need to be asked at all.
**Narrowed.** The question is smaller and better posed than it was. Say exactly what is now known and
what remains.
**Unchanged.** We learned nothing. That is a legitimate outcome, and saying so is better than padding.

## Layout

```
investigations/kian-questions-2026-08-31/
  BRIEF.md      this file
  slices/       01 cheap reads, 02 behavioural
  results/      one per slice
  scripts/      anything saved
  FINDINGS.md   the deliverable, written at the end of slice 02
```

## Stop and ask JJ if

* a question turns out to need a write, an invoke or a config change to answer
* you find something that looks like a live defect rather than an open question
* slice 01 closes a question in a way that makes slice 02 pointless, which is a good outcome and
  worth telling him before spending the second session
