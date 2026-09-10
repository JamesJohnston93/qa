# RETEST-POST-1161 scripts

Scripts written during this plan's testing. Ticket specific ones live in `scripts/` beside this file.
Anything reusable beyond this plan gets promoted to `../../tools/` and moved to
`../../../tools/SCRIPTS-INDEX.md`.

**Check this file, `../../BUSY-1160/SCRIPTS.md` and the root index before writing anything new.**

| Script | Slice | Purpose | What it does NOT check | Read only | Reviewed by |
|---|---|---|---|---|---|
| `check-full-chain-deploy.sh` | R0 Gate A | `LastModified`, `CodeSha256` and `Version` for every function across the native, shared and outbound chains plus the four BUSY-1158 consumers, against a given baseline date. Extends `../../BUSY-1160/scripts/check-cin7-order-handler-deploy.sh`'s function list (native chain only, no sha/version) to cover the full changed-component table R0 needs | Correctness of the deployed code, only whether it redeployed since the baseline date. A same-day redeploy with no functional change still reads as changed | yes | not yet |
| `check-synthetic-orders-exist.sh` | R0 Gate D | Row count on `origin_index` for a comma-separated list of `QASYN-` references, so a purge is visible against `SYNTHETIC-REGISTER.md`'s own last-recorded counts | Content of those rows, only that they still exist. Does not read the register itself | yes | not yet |

## Built, 2026-09-09, slice R0

`check-full-chain-deploy.sh` -- built because `check-cin7-order-handler-deploy.sh` only covers the
eight native-chain functions and only reports a match/mismatch against one expected date, not
`CodeSha256`/`Version`, and R0 needs all three across 22 functions (native, the shared
`create-transaction` handler, the full outbound chain, and BUSY-1158's four consumers). Used once,
output folded into `results/R0-build-identification.md`'s changed-component table.

`check-synthetic-orders-exist.sh` -- built to replace an inline bash loop run once against
`origin_index` for all 11 distinct `QASYN-` orders (CLAUDE.md's own rule: a loop is not an inline
one-liner). Re-run once after being saved, identical output both times (row counts 1-13 across the
11 references, all present, none purged). Folded into Gate D.

## Notes

A row here is not a claim the script is correct. The Reviewed column is the only thing that says a
human has read it. Review is deferred by design, per `../../BUSY-1160/CLAUDE.md`'s standing rule --
nothing here gets a second reader until the bulk of testing is done. State the caveat in result files
anyway.
