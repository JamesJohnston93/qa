# Slice 01 results, cheap reads

Ran 2026-08-31. AWS session was live (`aws sts get-caller-identity --profile staging` succeeded
before starting), no SSO login needed.

## Q2, does the sales order handler batch 10 against 60 seconds

**Verdict: Narrowed.**

**Shape, MEASURED** (`aws lambda list-event-source-mappings` and `get-function-configuration`
against `staging-orders-v2-eda-queue-handler`):

* `BatchSize`: 10
* `MaximumBatchingWindowInSeconds`: 0
* Dispatcher `Timeout`: 60 seconds, `MemorySize`: 128 MB, `ReservedConcurrentExecutions`: none
* Worker `staging-orders-v2-create-order` (one of the functions the dispatcher invokes internally,
  per BUSY-1158 slice 01) also has `Timeout`: 60 seconds

The shape is not materially different from "10 against 60 seconds." It is the same shape. **This
does not close the question**, it narrows it to the question the slice anticipated: has this shape
ever actually failed on this dispatcher.

**History, MEASURED.** The dispatcher's log group has no retention limit (`retentionInDays: null`,
created 2025-01-28), so its full history is available. Pulling `Errors` with `period=86400` across
the whole range in one call is unreliable: a single call spanning many months mis-buckets some days'
sums into the adjacent day (confirmed by re-querying the same days individually and getting
different, internally consistent numbers). The numbers below come from single-day and 55-day-chunk
queries, cross-checked against each other and against raw `REPORT` log lines, which agree exactly.

Across the full retained period, five days show any `Errors`:

| Date (UTC) | Errors | Of which `Status: timeout` |
|---|---|---|
| 2025-08-15 | 80 | 70 |
| 2025-08-20 | 2 | 2 |
| 2025-09-30 | 1 | 0 |
| 2025-10-28 | 40 | 0 |
| 2026-05-28 | 20 | 0 |

Every other day in the ~19 month retained window shows zero errors of any kind, including every day
since 2026-05-28.

The 70 timeouts on 2025-08-15 are concentrated in a roughly three hour window, 03:00 to 06:00 UTC:
292 invocations that day, so about 24 percent of that day's invocations timed out with the literal
`Status: timeout` marker on the `REPORT` line (the `REPORT.*Task timed out` text pattern itself
returns nothing, confirming the BUSY-1259/1260 carried note that this runtime does not emit that
string). This is the same failure shape as BUSY-1260 (143 of 361, about 40 percent), smaller in
ratio but the same mechanism: a batch of up to 10 SQS messages redelivered whole when the Lambda
running it hits the 60 second wall.

**What this does not show.** `staging-orders-cin7-so-poller`'s own log group was created
2026-08-27, so the Cin7 sales order integration did not exist during either timeout incident
(2025-08-15 and 2025-08-20 are both over a year earlier). Neither incident can be a CTC record.
Nothing in the retained history shows a timeout since 2026-05-28, which covers BUSY-1159 slice 08's
718 order live run and everything since. **So: the shape is identical to the PO failure mode, and it
has demonstrably fired on this exact dispatcher before, but only for non-CTC order types, and not
since May 2026.** Q2 for Kian narrows from "does this shape exist" (yes) to "given the shape has
fired here before under conditions we cannot fully characterise from logs alone, is there a design
reason CTC volume would or would not trigger it the same way."

## Q25, has a PutEvents partial failure ever happened

**Verdict: Narrowed, and flagging per the slice's stop condition.**

**The metric cannot be scoped the way the slice assumed, MEASURED.**
`aws cloudwatch list-metrics --namespace AWS/Events` confirms `PutEventsFailedEntriesCount` exists,
but `list-metrics --metric-name PutEventsFailedEntriesCount` returns it with **no dimensions at
all**, not even `EventBusName`. It is an account-wide, all-buses total. The
`--dimensions Name=EventBusName,Value=staging-orders-v2-event-bus` call the slice describes would
return no data, because that dimension does not exist for this metric. This is worth recording on
its own: the retrospective method in the project doc assumes a per-bus figure that AWS does not
publish.

**Account-wide sum, MEASURED**, full retained window (chunked into 55 day windows to avoid the same
multi-month bucketing problem found in Q2, each chunk cross-checked against single-day queries where
nonzero):

* Zero everywhere except 2025-06-02 through 2025-06-17, roughly 46,000 failed entries total across
  that stretch (daily figures range from 81 to over 14,000).
* Zero every other day, including the entire period since.

**Why this is very likely not about this integration, MEASURED.** `staging-orders-cin7-so-poller`'s
log group and its EventBridge schedule rule (`staging-orders-cin7-so-poller-rule`) were both created
2026-08-27, fourteen months after the June 2025 spike. The Cin7 sales order poller did not exist
when those failures happened. `FailedInvocations` (a different, per-rule-dimensioned metric, used
here for context) lists several `newstore-*-catalog-table` and `newstore-*-shopify-*` rule names
active in the same account, consistent with a bulk catalog or product sync incident unrelated to
orders.

**What was checked for this integration specifically, MEASURED.** `FailedInvocations` dimensioned by
`RuleName=staging-orders-cin7-so-poller-rule` shows exactly one failed invocation, on 2026-08-27
(the rule's creation day), and that metric is about EventBridge failing to trigger the poller
Lambda on its `rate(2 minutes)` schedule, not about the poller's own `PutEvents` call succeeding
into the bus. It is not the same failure mode Q25 asks about, but it is the only bus-adjacent
per-rule signal available, and it is clean. Separately noted: this rule's current `State` is
`DISABLED`. Not investigated further, since it is outside Q25's scope, but worth surfacing since it
bears on whether the poller is running at all right now.

**Second half of B1 (poller emitted count vs downstream received count) was not attempted.** The
account-wide metric is flat for the entire period this integration has existed, so the marginal
value looked low against the time already spent reconciling the bucketing bug above. Skipping per
the slice's own allowance to skip when the metric is flat.

**Flagging per the slice's explicit stop condition: "the failed-entries metric has any non-zero
datapoint."** The account-wide metric did produce a non-zero stretch. My read is that it is not
connected to this integration, for the reasons above, but I am naming this plainly rather than
treating the "closes if sum is zero" criterion as met, since the sum is not zero and I cannot rule
the June 2025 incident out with certainty, only make it very unlikely. JJ should see this before
Q25 is treated as settled.

## Q26, how common is taxStatus Exempt

**Verdict: Narrowed** (the slice does not expect a close here, and it does not close, but three
examples are now a population figure).

**Log half, MEASURED.** `filter-log-events` against `/aws/lambda/staging-orders-cin7-so-poller`
with pattern `"taxStatus"` returns 40 lines, all `ERROR`, all the same message shape ("Unrecognised
Cin7 taxStatus \"Exempt\" ... refusing to guess a tax treatment"). Exactly three distinct order
references appear, matching the register: `WOR19267`, `261103`, `261105`. No taxStatus value other
than `Exempt` appears anywhere in this log group. First occurrence 2026-08-27T19:24:51Z, last
2026-08-28T01:55:09Z. The log group itself was only created 2026-08-27, so this is not a partial
window, it is the group's entire life to date.

**Cin7 half, MEASURED.** `survey-cin7-orders.sh` did not expose `taxStatus` before this session.
Extended it (purely additive, one new `Counter` and one new table/JSON key, the seven existing
counters are untouched) rather than writing a second surveyor. Ran it against the poller's own
filters (`isApproved=true`, `branchId IN (51908,51909)`), 4 pages, 1000 orders, 4 Cin7 GET calls:

| taxStatus | Count | Share |
|---|---|---|
| Excl | 598 | 59.8% |
| Incl | 390 | 39.0% |
| Exempt | 12 | 1.2% |

Only these three values appear in the sample. No other unrecognised taxStatus value exists in this
population.

**What this means for Kian.** Exempt is roughly 1 in 83 orders in this sample, not 1 in a thousand
and not 1 in 20. Per the slice's own framing, this is closer to "every one of those is permanently
stuck at this gate with no auto retry" than to "a curiosity," though 1.2 percent is a smaller share
than the higher end the slice flagged. The question for Kian is unchanged in kind (is Exempt meant
to be mapped, and if so to what) but now arrives with a real number attached instead of three
references.

## Scripts written

* `survey-cin7-orders.sh` at the tools root, extended, not new. Added a `taxStatus` counter (table
  output and `--json` key `taxStatuses`). Purely additive: the seven existing counters
  (`stage`, `status`, `logisticsCarrier`, `branchId`, `projectName`, `carrierByStage`,
  `distinctMemberIds`) are unchanged, so no earlier survey result is affected. Not yet reviewed for
  the new field. Rows added to `SCRIPTS-INDEX.md` (existing row annotated) and this investigation's
  `SCRIPTS.md`.

## Cin7 API budget used

4 GET calls (the `survey-cin7-orders.sh` run, `--max-pages 4`), plus the single 5-row sample pulled
by hand to confirm `taxStatus` exists in the raw payload before extending the script. 5 calls total,
against the shared 5,000/day cap.

## For slice 02

Q2 and Q25 are Narrowed, not Closed, so slice 02's FINDINGS.md still needs to cover all five
questions; nothing here makes slice 02 pointless. Q25 in particular carries a flag for JJ (above)
that is worth reading before slice 02 starts, since it concerns whether the retrospective method
in the project doc is usable at all for a bus-scoped question.
