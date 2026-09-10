# Investigation scripts

Same rule as the test plans: saved as files, never run inline, header on every one. The Reviewed
column is filled by a human, never by the session that wrote the script.

Read `../../../tools/SCRIPTS-INDEX.md` and `../../BUSY-1159/SCRIPTS.md` before writing anything.
Fifteen scripts already exist on this epic, and `survey-cin7-orders.sh` in particular is the one
slice 01 should extend rather than duplicate.

| Script | Q | Purpose | What it does NOT check | Read only | Reviewed by |
|---|---|---|---|---|---|
| `../../../tools/cin7-sales-orders/survey-cin7-orders.sh` (extended, not new) | Q26 | Added a `taxStatus` counter (table and `--json` key `taxStatuses`) alongside the existing stage/status/carrier/branch/project counters | Does not tell you which orders are Exempt, only the count per value. Does not correlate taxStatus with stage, the way `carrierByStage` does for carrier | yes | not yet, purely additive to Kian's reviewed script, see `SCRIPTS-INDEX.md` |
