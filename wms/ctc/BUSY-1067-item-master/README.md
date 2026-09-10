# BUSY-1067, Cin7 Item Master Integration

Cin7 product options flow through a poller into the shipping service and are sent to Manhattan SCALE as Items, so a SKU on a shipment resolves to something SCALE knows. The generalisation to multi-company (`company` plus `item_code`) is what let CTC join the existing UNI catalog sync.

**This epic is finished.** All four tasks below are Done in Jira. The folder is here for the record, for the gotchas that carry into other epics, and because the E2E handover came out of it.

## Tasks

| Folder | Task | Jira |
|---|---|---|
| `BUSY-1115/` | Full CTC extraction and mapping: ProductOptions triggers, complete field set, defaults | Done |
| `BUSY-1116/` | CTC poller watermark resilience and re-sync runbook | Done |
| `BUSY-1117/` | CTC poller monitoring and alerting: watermark staleness, errors, email alerts | Done |
| none | BUSY-1113 (multi-company item contract) and BUSY-1114 have no files of their own. `QA-BUNDLE-REPLAN.md` explains why: 1114, 1115 and 1116 were bundled on one deploy and tested together | Done |

## Everything else here

| Path | What it is |
|---|---|
| `retests/` | Passes that span several tasks: the CS5/ERR5 whitespace re-test, and the re-test of Kian's staging fixes |
| `investigations/` | Plans A to D and their results, the bare-code scan and its 111 pages of captured product data, the Cin7 write-access question |
| `e2e/` | The BUSY-1067 E2E session plan, its six IDE prompts, and the draft handover |
| `CTC-QA-STATE-INDEX.md` | The START HERE for this epic |
| `FINAL-WRAPUP-RUNSHEET.md`, `REMAINING-WORK-PLAN.md`, `CTC-HANDOVER-ACTION-LIST.md` | Close-out |
| `_to_delete/` | Superseded drafts, kept until someone bins them |

## A note on paths in these documents

This folder was flat until 2026-09-10. Its documents refer to scripts and to each other by **bare filename**, which was correct when everything sat in one directory. Those mentions were deliberately not rewritten: this is finished work and editing 50 documents to chase filenames risks more than it fixes.

Where to find what they name:

| Named as | Now at |
|---|---|
| `CLAUDE.md` | this folder's root |
| `check-status.sh`, `cin7-watermark.sh`, `preview-cin7-sync.sh`, `tail-logs.sh`, `trigger-test-change.sh`, `find-cin7-item.sh` and the rest | `../tools/previous-tooling/2026-08-18-testing-tools-1067/cin7-item-master/`, which is the version that produced these results. Current equivalents are in `../tools/cin7-item-master/` and have since changed |
| `emit-cin7-record.sh`, `find-cin7-product-by-id.sh` | `../tools/cin7-item-master/`. Unique to this epic, promoted rather than retired |
| `scan-bare-code-whitespace.sh` | `investigations/bare-code-scan/`, beside the data it produced |
| another `BUSY-11xx-*.md` or a `PLAN-*.md` | its task or investigation folder above |

## Carried-over gotchas

The QA docs for BUSY-1045 and BUSY-1113 are the best structural models in the QD space. The brevity rules in the `qa-doc` skill were derived from what had to be cut from BUSY-1048 and BUSY-1117, so neither of those is a model to copy.
