# Investigation tool notes

Traps found in the tooling and in AWS itself, not in the system under test.

## `get-metric-statistics` mis-buckets a multi-month range

Found slice 01, chasing Q2. A single call with `--period 86400` spanning many months returns daily
sums that do not match the same days queried individually, apparently bucketing some days into the
adjacent one. Re-querying single days, and 55 day chunks, gives internally consistent numbers that
also agree with the raw `REPORT` log lines.

**Chunk any range longer than about two months, and cross-check any non-zero day individually before
reporting it.** Both Q2's error table and Q25's account-wide figure were produced this way.

## `PutEventsFailedEntriesCount` has no dimensions

Found slice 01, chasing Q25. The metric exists in the `AWS/Events` namespace but AWS publishes it
account-wide with no dimensions at all, not even `EventBusName`. Any method that assumes a per-bus
figure cannot work. The project doc `Plan B, PutEvents partial-failure verification` assumes exactly
that, and has been annotated.

`FailedInvocations` **is** dimensioned by `RuleName`, which is why it was usable for context, but it
measures EventBridge failing to trigger a target rather than a publisher's own `PutEvents` result. It
is not a substitute.

## `REPORT.*Task timed out` returns nothing on this runtime

Carried over from BUSY-1260 and confirmed again here. The real marker is `Status: timeout` on the
`REPORT` line. Slice 01's Q2 timeout counts rest on the working pattern.

## `survey-cin7-orders.sh` extended, not replaced

Slice 01 added a `taxStatus` counter (table output and a `taxStatuses` key under `--json`). Purely
additive: the seven existing counters are untouched, so no earlier survey result is invalidated. The
new field has not been reviewed by a second person.
