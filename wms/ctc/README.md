# CTC QA

QA for the Cin7 and Manhattan SCALE WMS integrations at Universal Store. Lives at `wms/ctc/` in the private `QA` repo. Read `CONTRIBUTING.md` before your first commit. Test plans, execution machinery and the QA docs that go to Confluence and on to the E2E testers.

## Layout

```
QA/wms/ctc/
  tools/                      the toolset, shared across every epic
    cin7-sales-orders/        BUSY-1065
    cin7-item-master/         BUSY-1067
    common/                   every integration
    inspect-lambda-code.sh
    SCRIPTS-INDEX.md          read before writing any script
    previous-tooling/         superseded versions, dated, never run
  BUSY-1065-sales-orders/     one folder per epic
    BUSY-1158/                one folder per task
    BUSY-1159/
    BUSY-1160/
    BUSY-1161/
    retests/                  passes that span several tasks
    investigations/           questions chased outside any one task
    BUSY-1065-OPEN-QUESTIONS.md
    DEFERRED-TEST-CASES.md
  BUSY-1067-item-master/      finished epic, kept for the record
    BUSY-1115/  BUSY-1116/  BUSY-1117/
    retests/  investigations/  e2e/
```

| Epic | State |
|---|---|
| `BUSY-1065-sales-orders/` | In progress. BUSY-1161 is the live ticket |
| `BUSY-1067-item-master/` | Finished, all tasks Done |

**Epic folders and `tools/` sit side by side.** A new epic gets a new folder here; a new toolset from the engineer replaces the matching folder under `tools/` and the old one moves to `previous-tooling/` with the date.

**A task folder is self contained.** Its QA doc, plan, slices, results and its own `scripts/` all live together, and an IDE session opened there can read itself into the job with no conversation history.

```
BUSY-1161/
  CLAUDE.md       context for a fresh IDE session. Read first
  STATE.md        where we are. Read second
  QA-DOC.md       the artefact UAT and E2E read
  PLAN.md         the ordered plan
  KICKOFF.md      paste-ready prompt per slice
  SCRIPTS.md      index of scripts written for this task
  PROPOSALS.md    proposed cases and what happened to them
  TOOL-NOTES.md   bugs found in the testing tools themselves
  slices/         one file per sitting
  results/        one result file per slice
  scripts/        scripts specific to this task
```

## Paths

Paths inside a plan are written relative to **the task folder**, which is the folder an IDE session opens. From there, `../` is the epic and `../../tools/` is the toolset. A retest or investigation folder sits one level deeper, so it uses `../../` and `../../../tools/`.

## Standing rules

* **Cin7 is CTC's production system.** Every tool is GET-only against it and must stay that way. Test data means controlling what the poller re-reads, not making new records.
* **Credentials** live in `tools/.env`, auto-loaded, never printed, never committed or shared. AWS access is your own SSO profile passed as `--stage` and `--profile`.
* **No em dashes or double hyphens** in any doc, page or ticket for this work.
* **Scripts are saved, never run inline.** A command that exists only in a transcript cannot be reviewed, cannot be re-run identically, and gets rebuilt from scratch next time.
* **Result files are evidence.** They are not edited to match a later structure. Where one names a script by an old path, that script is in `tools/previous-tooling/`.
