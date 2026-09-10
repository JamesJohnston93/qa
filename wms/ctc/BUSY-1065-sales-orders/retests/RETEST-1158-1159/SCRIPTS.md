# RETEST-1158-1159 scripts

Scripts written for this re-test. Reusable ones get promoted to `../../tools/` and indexed in
`../../../tools/SCRIPTS-INDEX.md` instead.

**The Reviewed column is filled by a human, never by the session that wrote the script.** Until it is
filled, a passing run proves the script ran, not that the system behaved.

Read this file, `../../../tools/SCRIPTS-INDEX.md`, `../../BUSY-1158/SCRIPTS.md` and `../../BUSY-1159/SCRIPTS.md`
before writing anything. Extending an existing script beats writing a new one that overlaps it.

| Script | Slice | Purpose | What it does NOT check | Read only | Reviewed by |
|---|---|---|---|---|---|
| `read-deployed-builds.sh` | R0 | Loops a fixed list of order/shipment consumer lambdas and prints `LastModified`, first 12 chars of `CodeSha256`, `Version`, and whether each changed since a baseline date | Whether a changed function's behaviour actually changed, or whether an unchanged one is correct; metadata only | yes | |
| `watch-for-fixtures.sh` | R9 | Five checks for naturally-occurring Cin7 fixture shapes: a second revision on an already-sent order, a cancellation on one, a repeated option code, a known-absent SKU, a reference over 25 characters. Tags checks 3-5's hits `ELIGIBLE` or `PAST` against the poller's own eligible stages | Whether a hit proves any test case; a hit is a candidate, not a verified result. Check 1 does not distinguish a content edit from a bare stage progression, checked separately by hand. Check 4 only checks two known SKUs, not the full SCALE item master | yes | |
| `probe-poller-payload.sh` | R10 | Invokes the SO poller with a caller-supplied payload (mirrors `invoke-so-poller.sh`'s invoke-then-tail-logs shape) and prints its structured metric lines, to test whether the handler honours a window override | Whether the override changes fetched *content*, only whether the logged window reflects it. Not read only: it invokes the lambda each call | no, invokes | |
| `reconcile-poller-cycles.sh` | R11 Gate A | Sweeps every `Cin7SOPollerCycleComplete` line in the poller's full retained history, computes `ordersFetched` minus the sum of every printed disposition counter per cycle, prints the residual with timestamp and the exact counter names summed | Why a non-zero residual exists, or which order it belongs to. Does not distinguish a genuinely new counter from a typo in a field name | yes | |
| `gate-b-window-check.sh` | R11 Gate B | One Cin7 GET for CTC sales orders modified inside a given historical window, any stage, printing the company-name proxy per order | Whether a returned (or absent) order was actually processed by that cycle - that needs the cycle's own counters read separately. Cannot recover a window's membership once every order in it has been modified again since (Cin7 has no point-in-time query) | yes | |
| `skipped-stages-timeline.sh` | R11 Gate C | Sweeps the same cycle-complete history for every occurrence where `skippedStages` is non-empty, with timestamp and contents | Why the counter fires or stops firing, or whether the underlying stage gate itself changed | yes | |
| `faulty-sale-worker-duration-distribution.sh` | R11 Gate D1 | Sweeps `staging-inventory-check-order-faulty-sale`'s full history, splits CTC vs non-CTC by the `origin` field (extracted alone, never the surrounding record), reports warm-only Duration as counts and percentiles per group | What the worker does with the time, only how long it takes. Does not print customer name, email or address at any point | yes | |
| `dispatch-batch-weekday-weekend.sh` | R11 Gate E | Counts CTC order modifications per hour over a recent window, split weekday vs weekend, flags every 10+-orders-per-minute dispatch-batch signature with its timestamp | Whether next weekend repeats this weekend's pattern | yes | |
| `audit-poller-cycle-emits.sh` | R13 S2 | Reads the SO poller's `Pushed ... to EventBridge` lines for a given window and prints only safe fields per emitted order (origin, orderType, sourceStage, packingBrand, messageGroupId==orderId, lastEmittedPayloadHash) plus the cycle start/complete summary lines. Built because the raw log line carries customerEmail/name/address in the clear - this log group was not previously named in `CTC-customer-data-in-cloudwatch.md` | Whether `lastEmittedPayloadHash` was persisted onto the order row afterward (needs a separate DynamoDB read). Does not cover skipped/echoed orders, only ones actually created (skips have no per-order log line) | yes | |
| `scan-order-type-distribution.sh` | R14 W1b | Full-table scan of an orders/shipments-shaped table's header rows (`SK` match supplied by the caller, `eq:VALUE` or `prefix:VALUE`), tallying distinct `orderType` values including a `MISSING` bucket | Whether a record under a given `orderType` is well-formed or reachable by any other lookup. Full-history snapshot only, not point-in-time | yes | |

## Shared scripts this plan depends on

| Script | Where | Note |
|---|---|---|
| `check-ctc-status.sh` | tools root | Queue/DLQ depths, watermark, alarms for the sales-order pipeline. Used as-is in R0 Gate C |
| `cin7-watermark.sh` | tools root | Watermark read. `--poller so` every time |
