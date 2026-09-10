# Tools index

Where a script lives, and whether anyone has checked it. **Read this before writing a new one.** Most of what a test needs already exists, and rebuilding it costs time, costs tokens, and quietly changes what gets asserted between runs.

## Two locations, one rule

* **Useful to more than one task** goes here in `tools/`, in the folder for its integration, and gets a row below.
* **Specific to one task** goes in that task's own `scripts/`, and gets a row in that task's `SCRIPTS.md`.

If a task script gets used by a second task, promote it here and move its row.

## What is where

The engineer's toolset is the current one for every integration. It carries its own documentation and this index does not duplicate it.

| Folder | Covers | Start here |
|---|---|---|
| `cin7-sales-orders/` | Cin7 sales orders to SCALE Shipments. Native ECOM and the outbound WHOLESALE and RTV family. BUSY-1065 | `cin7-sales-orders/README.md` |
| `cin7-item-master/` | Cin7 item master to SCALE Items, and the older catalog sync. BUSY-1067 | `cin7-item-master/README.md` |
| `common/` | Serves every integration | `common/README.md` |
| `previous-tooling/` | Superseded versions, kept so an older result file can still be read against the script that produced it | below |

`CLAUDE.md` at this folder's root briefs an AI assistant on the layout, the safety rules and the known traps.

## Written by QA, kept here

| Script | Purpose | Flow | Read only | Written for | Reviewed by |
|---|---|---|---|---|---|
| `inspect-lambda-code.sh` | Downloads a deployed Lambda's own code package and greps it for search terms, printing context, then deletes the download. Not repository access: it inspects the artefact already running, under existing credentials | all | yes | BUSY-1160 slice 06, where the 25-character ship-to truncation lives | not yet |

Every source-read verdict in the BUSY-1065 epic came from this script, and the engineer's toolset has no equivalent. It is the reason `previous-tooling` is not the only thing carried forward.

## previous-tooling

`previous-tooling/2026-09-10-testing-tools-so/` holds the toolset that preceded the engineer's, split the same way. Nothing there should be run. It exists because result files written before 2026-09-10 name those scripts by their old paths, and a reader checking an old verdict needs the script that actually produced it.

One row of that folder is worth knowing about even though it is retired. Its `cin7-sales-orders/check-ctc-consumer-guards.sh` checks **two consumers the current version dropped**, both verified live under BUSY-1158, and it counts log events with full pagination where the current one reverted to a pattern its own comment records as producing false zeroes. Do not rely on the current script's negative results without asking the engineer.

Add a folder here, dated, whenever a toolset is superseded. Do not delete the old one.

## Reviewed

Reviewed means a human has read the script and agrees it asserts what it claims. Until then a passing run proves the script ran, not that the system is correct.

Review is deferred by design, JJ's call: nothing gets a second reader until the bulk of testing is done. An empty Reviewed column is the expected state, not an open item. Keep stating the caveat in result files anyway, since it is what stops a green run being over read.
