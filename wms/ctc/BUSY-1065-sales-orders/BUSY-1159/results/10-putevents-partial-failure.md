# Result: Slice 10, PutEvents partial failure and the watermark

**Ticket:** BUSY-1159
**Verdict:** Gate A PASS (MEASURED). Gate B clean match, no shortfall (MEASURED). Gate C and the write
half NOT RUN, by session constraint: this session runs on `staging` only, and the write half is
`kian-dev`-only per the slice itself. TC22 stays NOT RUN in the QA doc, now with two free gates closed
in its favour rather than none.

## Session constraint, stated up front

This session was told to work directly on `staging`, not `kian-dev`, and to skip anything that needs
that environment. The slice's own Gate C already routes any coordination need to JJ, and the write
half is explicitly `kian-dev`-only ("Do not run any part of the write half against staging"). Both are
skipped here for that reason, not because a gate failed. Gates A and B are explicitly staging-native
per the slice text and were run in full.

## Gate A, confirm the batch size from our own evidence

**MEASURED, one entry per call, no exception found.**

Pulled every `Pushed {"Entries":[...]}` line from `/aws/lambda/staging-orders-cin7-so-poller`'s full
retained history (log group created 2026-08-27, so this is the integration's entire life to date, not
a sample): 70 lines. Parsed the `Entries` array length on all 70: every one is exactly 1.

Cross-checked a second way: summed the `created` field across all 575 `Cin7SOPollerCycleComplete`
lines in the same window. Total is 70, exactly matching the `Pushed` line count. Two independent
counters in the poller's own log output agree.

Also confirms the `DetailType`/`EventBusName`/`Source` fields present on each entry:
`DetailType: CREATE_TRANSACTION`, `EventBusName: staging-orders-v2-event-bus`,
`Source: orders-cin7.cin7-so-poller.lambda`. This is what Gate B's filter targets.

**Verdict: one entry per call, confirmed. Proceed to Gate B as the slice assumes.**

## Gate B, is the cheaper answer already available

**MEASURED, clean match, no shortfall.**

The slice asks for a per-cycle comparison of the poller's emitted count against what the buffer
populator logged receiving, across a decent sample of cycles. Identified the buffer populator by
reading the wiring directly rather than guessing from the name: `aws events list-targets-by-rule`
against `staging-orders-v2-event-bus`'s CREATE_TRANSACTION-matching rule
(`staging-orders-v2-stagingordersv2edastagingordersv2-BPFYsObMftNG`, event pattern confirmed to
include `CREATE_TRANSACTION`) resolves to one Lambda target:
`staging-orders-v2-eda-queue-populator`. This is a different component from the
`*-buffer-populator` pair named elsewhere in this plan's fixtures (those are the BigQuery reporting
buffers, which CTC records are guarded away from by design, per `check-ctc-consumer-guards.sh`'s
`SKIP-MARKER` rows on the reporting streams; they would show a clean 0 for a reason unrelated to
PutEvents delivery).

Rather than the CloudWatch-metric approach (used for Q25 in the separate
`investigations/kian-questions-2026-08-31` session and found there to be an account-wide, unscoped
metric with no per-bus dimension, plus a known multi-month bucketing trap on `--period 86400`), this
ran a direct log correlation, matched by `idempotencyId` rather than by count alone:

* Poller side: same 70 `Pushed` lines from Gate A, `idempotencyId` extracted from each entry, 70
  distinct values.
* Populator side: `filter-log-events` against `/aws/lambda/staging-orders-v2-eda-queue-populator`
  for `"cin7-so-poller.lambda" "Received event"` in the identical window (this log group's
  retention predates the poller's, so no coverage gap): 70 lines, 70 distinct `idempotencyId`
  values. (A broader filter on just `CIN7_SO` returns 420 lines / 210 distinct events, because a
  CTC order's `CREATE_TRANSACTION` event triggers further internal events, e.g. `TRANS_CREATE_ORDER`,
  that loop back through the same bus and populator, 210 = 70 x 3. Restricting to the poller's own
  `Source` isolates the exact record the poller itself pushed, which is what this gate asks about.)
* Set comparison: the two 70-item `idempotencyId` sets are identical. Zero pushed-but-not-received,
  zero received-but-not-pushed, over the integration's entire retained history, not a sample window.

This exceeds "a decent sample of cycles": it is the full population available in CloudWatch to date,
covering all 575 poller invocations and all 70 real creates.

**Per the slice's own decision text**, a clean match across the sampled cycles "does not prove the
code checks the response, but it does establish the risk as latent rather than realised, and it is a
legitimate stopping point." That is the outcome here. No shortfall was found on any cycle, so the
escalate-and-stop branch ("a shortfall in any cycle where the watermark still advanced") does not
apply, and there is nothing to tell JJ urgently about.

**Verdict: latent risk, not realised. Legitimate stopping point per the slice's own criteria,
independent of the environment constraint that also rules out the write half this session.**

## Gate C and the write half

Not attempted. Gate C is explicitly JJ's coordination call on Kian's stage, and the write half is
explicitly `kian-dev`-only per the slice text. This session's standing instruction is to skip anything
needing that environment. Two independent reasons point the same way: Gate B's clean-match outcome
already gives JJ a legitimate stopping point without forcing the write half, and the environment
constraint means it could not run this session regardless.

**No `INIT_START` confirmation attempted**, since the invocation that would need one (the forced
config-change cycle) never ran.

## Decision rule

None of the three rows in the slice's decision table apply: they all describe an outcome of the write
half, which did not run. TC22 is not being reported as PASS, FAIL, or the table's third row
(inconclusive from a missing `INIT_START`). It is NOT RUN, same as before this session, but now
carrying two clean read-only gates in evidence rather than none.

## Fails if / Blocked if conditions

Neither of Gate A's or Gate B's stop conditions fired (more than one entry per call; a shortfall on a
cycle where the watermark advanced). Gate C's stop condition (coordination window not confirmed) and
the revert-related stop conditions in the write half section do not apply, since neither was reached.

## Scripts written

* `scripts/putevents-vs-populator.sh`, new, not reviewed yet. Compares the poller's `Pushed` lines
  against the populator's `Received event` lines for the same window, matched by `idempotencyId`,
  and prints any shortfall or extra by id. Re-run twice against slightly different windows during
  this session (bounded to the last observed event, and again to "now") to confirm it is stable and
  the schedule being DISABLED since 2026-08-28 has not silently introduced a gap. Both runs: 70
  pushed, 70 received, no shortfall. Row added to `SCRIPTS.md`.

## Teardown

Nothing changed. Every step this session was `aws logs filter-log-events`, `aws events
list-targets-by-rule`/`describe-rule`, or a local read of an already-downloaded log dump. Poller
schedule confirmed still DISABLED (`staging-orders-cin7-so-poller-rule`), matching the state left at
the end of slice 09/08. Watermark not read or touched this session, no reason to: nothing here needed
a new cycle, the full existing log history already answered both gates.

## For whoever picks up TC22 next

* Gates A and B are done and do not need re-running unless the poller schedule is re-enabled and a
  long stretch of new activity accumulates; if so, re-run `putevents-vs-populator.sh` over the new
  window rather than trusting this result to still cover it.
* What is left is exactly what the slice originally scoped: Gate C (JJ agrees a short window with
  Kian on `kian-dev`) and the forced write test that follows it. Nothing found this session changes
  that scope or narrows it further.
* Cross-reference: `investigations/kian-questions-2026-08-31/results/01-cheap-reads.md` ran the
  CloudWatch-metric half of the same underlying question (Q25) on staging and explicitly skipped the
  log-correlation half "since the account-wide metric is flat for the entire period this integration
  has existed." That skipped half is what this slice's Gate B just did, on staging, and it also came
  back clean.
