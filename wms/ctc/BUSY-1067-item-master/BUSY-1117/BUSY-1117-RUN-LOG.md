# BUSY-1117 AC1 + AC2 — Forced blank-secret run log

Stage `staging`, profile `staging`, region `ap-southeast-2`. Unattended long session, target ~2h20.
Sanctioned changes only: Cin7 secret `staging/catalog/cin7`, watermark parameter (step 1 only, if
needed), poller Lambda description field (step 6, cold start only). Tags: MEASURED / INFERRED / UNKNOWN.

Context: this follows on directly from `BUSY-1117-ALARM-HISTORY-RESULTS.md` (read-only session,
earlier 2026-08-19), which concluded AC1 is genuinely open and can only be closed by "a fresh,
deliberately-forced credential outage." This run is that forced outage.

---

## STEP 0 — PRE-FLIGHT (read-only)

Started: 2026-08-19T01:10:56Z

### 0a — describe-alarms (MEASURED, 2026-08-19T01:11Z)

**`staging-catalog-cin7-poller-errors`**
- MetricName: `Errors`, Namespace: `AWS/Lambda`, Dimensions: `FunctionName=staging-catalog-cin7-cin7-item-poller`
- Period: **180s**, EvaluationPeriods: **3**, DatapointsToAlarm: not set → defaults to 3 (M-of-M)
- Threshold: **0.0**, ComparisonOperator: `GreaterThanThreshold`, TreatMissingData: **`notBreaching`**
- AlarmActions: `staging-catalog-manhattan-observability-alerts` SNS topic
- Current StateValue: **OK** (since 2026-08-10T04:49:07.151Z, "3 datapoints were not greater than threshold (0.0)")

**`staging-catalog-cin7-watermark-stale`**
- MetricName: `Cin7PollerCycleComplete`, Namespace: `staging-catalog-cin7`, Dimensions: none
- Period: **900s**, EvaluationPeriods: **8**, DatapointsToAlarm: not set → defaults to 8 (M-of-M)
- Threshold: **0.0**, ComparisonOperator: `LessThanOrEqualToThreshold`, TreatMissingData: **`breaching`**
- AlarmActions: `staging-catalog-manhattan-observability-alerts` SNS topic
- Current StateValue: **ALARM** (since 2026-08-14T03:05:01.167Z, "no datapoints were received for 8 periods and 8 missing datapoints were treated as [Breaching]") — this is the ordinary-idle false positive per CLAUDE.md AL6 (watermark has been UNSET since then), not evidence of anything from this run yet.

### 0b — predicted time-to-ALARM arithmetic

**`poller-errors`:** Period 180s = poller cadence (3 min), so one poller cycle ≈ one datapoint. Needs
3 consecutive 180s periods each with `Errors > 0` (M-of-M=3, TreatMissingData irrelevant here since a
failing invocation *does* publish a datapoint). Arithmetic: first failing cycle lands within
T0 → T0+3min depending on schedule phase, then 3 consecutive failing periods = +2×180s more
(the period containing the first failure counts as period 1) = +360s, plus CloudWatch's own
metric-propagation/evaluation lag (typically 1 more period, up to +180s).
**Predicted: T0 + ~9 to ~12 minutes.** (MEASURED config → INFERRED prediction.)

**`watermark-stale`:** Period 900s (15 min), needs 8 consecutive periods with `Cin7PollerCycleComplete`
summed `<= 0` (TreatMissingData=breaching, so a period with literally zero completions counts as
breaching even without a datapoint). From the moment cycles stop completing: 8 × 900s = **7200s = exactly
2 hours**, plus evaluation lag. **Predicted: ~2h00m to ~2h15m after cycle completions actually stop**
(not necessarily T0 itself — depends on step 1's gate, see below).

### 0c — DECISION POINT: can watermark-stale fire during a credential failure?

`TreatMissingData` = **`breaching`** (MEASURED above). A failing cycle never emits
`Cin7PollerCycleComplete`, so once failures begin, every subsequent 900s period sums to 0 (breaching),
and after 8 consecutive such periods the alarm transitions to ALARM — this is exactly what
"breaching" on missing data enables. **This is NOT the notBreaching case — AC1 is NOT unsatisfiable
by design.**

**HOLD_FOR_AC1 = true.** Steps 5 and 6 must wait for the ~2h hold (or an earlier organic transition).

### 0d — watermark + poller activity (MEASURED, 2026-08-19T01:11-01:12Z)

Watermark param `/catalog/cin7-manhattan/item-watermark/staging`: value **`UNSET`**, Version **188**,
LastModifiedDate `2026-08-14T00:34:59.498Z` UTC.

Last 20 min of `/aws/lambda/staging-catalog-cin7-cin7-item-poller`: 7 events, all
`{"metric":"Cin7ItemPollerInactive","watermark":"UNSET"}` on the 3-min cadence (00:52:50Z →
01:10:50Z). **Poller is INACTIVE.** Step 1's gate applies — must activate before breaking, per
runsheet instruction ("a forced break against an inactive poller proves nothing").

### 0e — SNS subscription check (MEASURED, 2026-08-19T01:12Z)

`staging-catalog-manhattan-observability-alerts` topic: exactly one subscription, Protocol `email`,
Endpoint `james.johnston@universalstore.com.au`, SubscriptionArn is a real ARN (not the literal
`PendingConfirmation`) → **CONFIRMED**. No stop needed; AC4 evidence path is live.

### 0f — watermark-stale alarm history, 2026-08-18T00:00Z → now (MEASURED, 2026-08-19T01:13Z)

`describe-alarm-history` (StateUpdate) for `staging-catalog-cin7-watermark-stale`,
2026-08-18T00:00:00Z–2026-08-19T01:15:00Z: `"AlarmHistoryItems": []` — **zero transitions**. Confirms
it has sat in `ALARM` continuously since 2026-08-14T03:05:01Z (see 0a) with no state change across the
entire window — i.e. AL6's false-positive is still live and unchanged. Not INSUFFICIENT_DATA (the
alarm doesn't use that state per its config), so this is the "ALARM, static" shape, consistent with
ongoing idle rather than a new event.

**STEP 0 COMPLETE 2026-08-19T01:13Z.** HOLD_FOR_AC1=true. Poller is INACTIVE → proceeding to Step 1 gate.

---

## STEP 1 — GATE (activate the poller)

**2026-08-19T01:13Z — CHANGE MADE.** Watermark `/catalog/cin7-manhattan/item-watermark/staging`:
- Old value: `UNSET` (Version 188)
- New value: `2026-08-19T01:02:36.000Z` (now − 10 min at time of write, whole-second `.000Z` format
  matching poller's own writes) → **Version 189**
- Undo command (if this run needs to be aborted before step 6 does it properly):
  `aws ssm put-parameter --profile staging --region ap-southeast-2 --name /catalog/cin7-manhattan/item-watermark/staging --value "UNSET" --type String --overwrite`

Waiting for confirmation of ≥1 `Cin7PollerCycleComplete` before proceeding to Step 2.

**CONFIRMED 2026-08-19T01:14:06Z (MEASURED).** SSM propagation was fast this time (~1 min, not the
documented up-to-33-min worst case): `{"metric":"Cin7PollerCycleComplete","productsFetched":95,
"productsFetchedPrimary":0,"recordsEmitted":705,"recordsSkipped":0,"watermarkAdvanced":true,
"newWatermark":"2026-08-19T01:12:2...`. Poller is genuinely ACTIVE. **STEP 1 COMPLETE.**

---

## STEP 2 — BACK UP THE SECRET (2026-08-19T01:14Z)

`get-secret-value --secret-id staging/catalog/cin7` → SecretString written verbatim to
`~/cin7-secret-backup.json` (outside the repo folder, `chmod 600`). Confirmed: file is non-empty
(68 bytes) and parses as JSON with keys `["username", "apiKey"]` — matches the expected shape
(not printing the credential value itself in this log).

- **VersionId (current/AWSCURRENT):** `e3cc69af-90fc-43cc-9404-8dc8a48da3c3`
- **ARN:** `arn:aws:secretsmanager:ap-southeast-2:398353400186:secret:staging/catalog/cin7-RUasuv`
- Fallback restore path if the file is ever lost: `aws secretsmanager get-secret-value --profile staging --region ap-southeast-2 --secret-id staging/catalog/cin7 --version-stage AWSPREVIOUS` (valid only until this run's own put-secret-value in step 3 rotates AWSPREVIOUS to point elsewhere — the file is the primary restore path from that point on).

**STEP 2 COMPLETE.**

---

## STEP 3 — T0: BREAK THE SECRET

**T0 = 2026-08-19T01:15:05Z – 01:15:06Z UTC** (call issued 01:15:05Z, response received 01:15:06Z).

`put-secret-value --secret-id staging/catalog/cin7 --secret-string '{}'` → new VersionId
`fcf75d57-21e0-4a7a-81c2-95121263e6e4` (AWSCURRENT). Old version
`e3cc69af-90fc-43cc-9404-8dc8a48da3c3` is now AWSPREVIOUS. Secret is **blank** (`{}`, missing both
`username` and `apiKey`), not corrupted — matches the runsheet's requirement (corruption is
defeated by warm containers, blank is not).

**Undo command:** `aws secretsmanager put-secret-value --profile staging --region ap-southeast-2 --secret-id staging/catalog/cin7 --secret-string file:///Users/james.johnston/cin7-secret-backup.json` (this is exactly what step 6a will do).

**STEP 3 COMPLETE. Proceeding to Step 4 (AC2 verdict polling).**

---

## STEP 4 — AC2 VERDICT POLLING (2026-08-19T01:15Z – 01:36Z, 13 polls @ ~90s)

**MEASURED — UNEXPECTED RESULT: zero failed cycles in the full 20-minute window.** The poller
completed **8 consecutive successful cycles** after T0 with no gap in cadence and no error:

```
2026-08-19T01:16:59.065Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:16:13.000Z
2026-08-19T01:19:58.307Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:18:50.000Z
2026-08-19T01:22:52.723Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:22:35.000Z
2026-08-19T01:25:52.918Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:24:49.000Z
2026-08-19T01:28:58.193Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:28:47.000Z
2026-08-19T01:31:54.434Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:31:36.000Z
2026-08-19T01:34:52.309Z  Cin7PollerCycleComplete  newWatermark=2026-08-19T01:34:48.000Z
```
No `"Cin7 secret is missing required fields"` and no `Cin7PollerCycleFailed` at any poll.
`poller-errors` alarm: **StateValue OK throughout**, `StateUpdatedTimestamp` unchanged from before
T0 (2026-08-10T04:49:07Z) — never re-evaluated to a new state, consistent with zero errors.
`watermark-stale`: transitioned **ALARM→OK at 2026-08-19T01:15:49.318Z** (the idle false-positive
clearing now that real cycles are completing — this is the step 1 gate's effect, not step 3's), then
stayed OK throughout.

**INFERRED mechanism:** this is CLAUDE.md's documented warm-container secret-caching behaviour —
"Warm-container reuse defeated secret corruption for 80+ min" (Hard Constraint / prior forensic
history). The poller Lambda has been invoked continuously every ~3 min since before T0 (never went
cold), so its execution environment is almost certainly still holding the pre-break credentials in
memory (SDK-level Secrets Manager caching), and has not yet re-fetched the secret from the API to
discover it is now blank. **The blank secret write itself is confirmed correct** (Step 3, VersionId
`fcf75d57...`) — this is a caching/propagation-lag phenomenon, not a failed break.

**Per the runsheet's own fallback clause: "If nothing has transitioned by T0+20 min, that is also a
result: record it and move on."** Recorded. **Moving to Step 5.** Given CLAUDE.md's own prior
ceiling of "80+ min" for this exact caching effect, Step 5's extended hold (up to T0+2h15) is the
right vehicle to actually catch the eventual failure — continuing to watch both alarms (not just
watermark-stale) through the hold so the true AC2 verdict can still be captured whenever the cache
finally expires. **AC2 verdict is PENDING, not failed — carried into Step 5.**

---

## STEP 5 — HOLD (HOLD_FOR_AC1 = true)

Started 2026-08-19T01:36Z. Polling every 10 min until **T0+2h15 = 2026-08-19T03:30:05Z** or an
earlier `watermark-stale` ALARM transition, whichever comes first. Also watching `poller-errors` and
poller logs each poll (extension beyond the literal instruction, since AC2 was still pending when
this step started — the two questions share the same wait window so there is no cost to catching
AC2 here too). One line per poll, per the runsheet's readability instruction.

```
POLL 1 2026-08-19T01:39:09Z | watermark-stale=OK | poller-errors=OK | new_failed_cycles=0 | new_complete_cycles=8
POLL 2 2026-08-19T01:49:14Z | watermark-stale=OK | poller-errors=OK | new_failed_cycles=0 | new_complete_cycles=3
POLL 3 2026-08-19T01:59:19Z | watermark-stale=OK | poller-errors=OK | new_failed_cycles=0 | new_complete_cycles=4
```
Still no failures at T0+44min. Warm-container caching continuing to hold per CLAUDE.md's documented
"80+ min" precedent. Hold continues.

**⚠ 2026-08-19T02:09Z — background hold script (task `baanljc2y`) was killed/stopped externally**
(harness notification: status `killed`) at some point between its POLL 3 (01:59:19Z) and the
would-be POLL 4 (~02:09:19Z). No AWS state was affected by this — it only stopped this session's own
polling process. Checked directly on discovery:
- Both alarms still `OK` (unchanged from POLL 3).
- Poller logs 01:59Z→02:09Z: **3 more successful cycles**, no failures —
  `02:01:53.556Z`, `02:04:53.934Z`, `02:07:51.850Z`, all `Cin7PollerCycleComplete`.
- **No gap in evidence** — nothing was missed, just a ~10-min blind spot with no state change in it.

**Switching polling strategy for resilience:** rather than one long-lived background shell (which
just proved it can be killed by something outside this session's control over a 2h+ window), this
run now polls via short, independent scheduled check-ins — each one a fresh, fast, direct AWS query
run from the main loop itself, with results appended straight to this log. This has no single
long-running process to lose. Continuing the hold to the same target: T0+2h15 = 2026-08-19T03:30:05Z,
or an earlier watermark-stale ALARM transition.

**2026-08-19T03:48Z direct-poll check-in — MAJOR DEVELOPMENT: the break finally took effect.**
(Next scheduled check-in landed later than the intended ~20 min due to an apparent scheduling gap —
this poll covers 02:07:52Z → 03:48:01Z in one pass; nothing was lost, just observed in a single wider
window instead of several narrower ones.)

**The warm-container secret cache finally expired between the last success and the first failure:**
```
2026-08-19T02:46:55.782Z  Cin7PollerCycleComplete  (last success — newWatermark 2026-08-19T02:46:2...)
2026-08-19T02:49:52.445Z  Cin7PollerCycleFailed  {"message":"Cin7 secret is missing required fields"}
2026-08-19T02:49:52.485Z  Invoke Error {"errorType":"Cin7ConfigError","errorMessage":"Cin7 secret is missing required fields",...}
```
So the cache held for **T0+1h34m47s** (01:15:05Z → 02:49:52Z) — well past the documented "80+ min"
precedent, confirming that figure was itself an underestimate of the ceiling, not a fixed constant.
**MEASURED, matches the historical mechanism exactly, no corruption path needed.**

**AC2 — full verdict, now closeable: PASS.**
`poller-errors` alarm **transitioned OK→ALARM**:
```
StateValue: ALARM
StateUpdatedTimestamp: 2026-08-19T02:56:32.116Z
StateReason: "Threshold Crossed: 3 datapoints [1.0 (19/08/26 02:53:00), 3.0 (19/08/26 02:50:00), 1.0 (19/08/26 02:47:00)] were greater than the threshold (0.0)."
```
Predicted (Step 0b) was T0+9-12min *measured from the break*; actual was **6m40s from the first
failure** (02:49:52Z → 02:56:32Z), faster than predicted because the alarm's 180s periods are fixed
clock-aligned buckets (`:47:00–:50:00`, `:50:00–:53:00`, `:53:00–:56:00`), not floating from the
first failure — the first failure landed already ~2min into its bucket, effectively needing only
~2.1 buckets' worth of wall-clock time rather than a full 3. **AC2's first half (3-consecutive
poller errors → ALARM) is now genuinely evidenced, closing the gap the read-only session
(`BUSY-1117-ALARM-HISTORY-RESULTS.md`) left open.** AC2's second half (single-failure-quiet, AL2)
was already closed PASS in that same prior session.

**Full failed-cycle timestamp list, MEASURED, 59 events, 2026-08-19T02:49:52.445Z →
2026-08-19T03:47:50.689Z** (all `Cin7ConfigError: Cin7 secret is missing required fields`):
```
02:49:52.445  02:50:46.699  02:52:33.758  02:52:50.824  02:53:45.064  02:55:47.535  02:55:50.344
02:56:46.564  02:58:45.964  02:58:50.306  02:59:47.624  03:01:50.456  03:01:52.863  03:02:51.699
03:04:50.718  03:05:04.929  03:05:46.928  03:07:48.319  03:07:50.402  03:08:44.642  03:10:37.054
03:10:50.336  03:11:50.682  03:13:50.057  03:13:50.325  03:14:56.641  03:16:50.518  03:17:08.877
03:17:43.721  03:19:50.678  03:19:54.950  03:20:57.984  03:22:50.658  03:23:13.186  03:23:54.917
03:25:50.533  03:26:05.133  03:26:53.794  03:28:43.175  03:28:50.394  03:29:45.666  03:31:50.539
03:31:55.933  03:32:57.833  03:34:50.515  03:35:00.059  03:35:46.731  03:37:44.108  03:37:50.300
03:38:47.618  03:40:36.015  03:40:50.247  03:41:50.598  03:43:50.688  03:43:56.799  03:44:47.938
03:46:33.379  03:46:50.380  03:47:50.689
```
**MEASURED, new observation not previously on record:** failures repeat roughly every 1-3 minutes,
faster than the normal 3-min scheduled cadence, several with the *same RequestId* retrying seconds
apart (e.g. `1a02f366...` at 02:49:52 and 02:50:46; `c8dbb74e...` at 02:52:33, 02:52:50, 02:53:45).
**INFERRED:** the poller's own invocation/retry wiring re-attempts a failed cycle faster than a fresh
schedule tick would produce, so a sustained secret outage produces a noticeably higher error rate
than one failure per 3-min cycle. Not previously documented — worth a line in the handover.

**AC1 — T0+2h15 deadline (2026-08-19T03:30:05Z) reached and passed without a watermark-stale
transition.** At 03:48:01Z: `watermark-stale` StateValue **still OK**, `StateUpdatedTimestamp`
unchanged at `2026-08-19T01:15:49.318Z` (the step-1-gate clearing) — zero transitions since. **Per
the runsheet's own rule ("whichever comes first"), the hold's time box is now spent.**

**INFERRED extrapolation (not measured):** period math (900s × 8, clock-aligned to :00/:15/:30/:45)
from the last real completion (02:46:55.782Z, inside the 02:45-03:00 bucket) implies the first
breaching bucket starts 03:00:00Z, and the 8th consecutive breaching bucket closes at 05:00:00Z —
predicting a transition around **2026-08-19T05:00-05:05Z** if the secret stayed blank that long.
**This is a prediction, not a result — the run is not being extended to chase it.** The session's
own ~2h20 budget is already spent (T0+2h33 at this check-in) and Hard Constraint 6 plus the
runsheet's explicit T0+2h15 cutoff both point the same way: **stop holding now, restore immediately.**

**AC1 verdict: STILL NOT CLOSED within this run's observation window — but for a materially better
reason than the prior session's finding.** Not "unsatisfiable by design" (TreatMissingData=breaching
rules that out, step 0c) and not "no organic outage occurred" (this run manufactured one deliberately)
— purely a **timing-budget mismatch**: the warm-container cache ate 94 of the available 135 minutes
before any failure began, leaving only ~41 real failure-minutes inside the T0+2h15 window against the
120 minutes the alarm's own config requires. **Flag for JJ:** a future attempt with either a longer
budgeted hold (≥3h from T0, to absorb a worst-case ~95min cache delay plus the full 120min alarm
window) or a way to force a cold start *before* breaking the secret (defeating the cache without
forcing an artificial failure) would very likely close this cleanly. Not filled in — genuinely open.

**PROCEEDING TO STEP 6 NOW (restore + cold start + verify).**

---

## STEP 6 — RESTORE AND VERIFY

### 6a — restore secret (2026-08-19T03:48-03:49Z)

`put-secret-value --secret-id staging/catalog/cin7 --secret-string file:///Users/james.johnston/cin7-secret-backup.json`
→ new VersionId **`72375450-7b4c-4cd6-8ee2-b3e42ef73551`** (AWSCURRENT). Verified by immediate
`get-secret-value`: parses with keys `['apiKey','username']`, `username == 'ThrillsAU'` matches the
pre-break value recorded in Step 2. **Restore confirmed correct.**

### 6b — force cold start (2026-08-19T03:50:10Z)

Warm containers were proven in this very run to hold cached credentials for 94+ minutes (see the
AC2 section above), so a config-touch cold start is necessary, not optional.
`update-function-configuration --function-name staging-catalog-cin7-cin7-item-poller --description "cold start after QA AC1 run 2026-08-19T01:15:05Z"`
→ accepted, `LastModified 2026-08-19T03:50:10.000Z`, `LastUpdateStatus: InProgress` ("The function is
being created"). This is the one sanctioned non-secret/non-watermark change for this run (Lambda
description field only — no other config touched).

**Undo (if ever needed):** the description field has no prior semantic value to restore (it wasn't a
meaningfully-used field) — no undo command needed for this one, per the runsheet's own framing
("force a cold start" via this field is a one-way, low-impact touch).

### 6c — verify recovery — CONFIRMED 2026-08-19T03:55:12Z

**MEASURED, all three required conditions met:**

1. **Real `Cin7PollerCycleComplete` after restore:**
```
2026-08-19T03:51:24.324Z  Cin7PollerCycleComplete  productsFetched=261, recordsEmitted=1916, recordsSkipped=6, newWatermark=2026-08-19T03:49...
2026-08-19T03:52:53.093Z  Cin7PollerCycleComplete  productsFetched=4, recordsEmitted=35, newWatermark=2026-08-19T03:51:14.000Z
```
   First post-restore cycle cleared the backlog accumulated during the ~65-min outage (261 products,
   1916 records in one cycle vs. the usual 5-80) — expected given the watermark floor never moved
   while cycles were failing.

2. **`poller-errors` alarm transitioned back ALARM→OK:**
```
StateValue: OK
StateUpdatedTimestamp: 2026-08-19T03:53:32.118Z
```
   (was ALARM since 02:56:32.116Z — see AC2 section above). **Full alarm lifecycle for this run is
   now captured end-to-end: OK → ALARM (02:56:32Z) → OK (03:53:32Z).**

3. **Watermark advancing:** `/catalog/cin7-manhattan/item-watermark/staging` = `2026-08-19T03:51:14.000Z`,
   Version **223**, `LastModifiedDate 2026-08-19T03:52:53.074Z` UTC — moving forward under the
   poller's own writes, not stuck.

`watermark-stale` never left OK throughout this whole run (see AC1 section — it needed a 2-hour
zero-completion window that this run's failure period didn't reach before the T0+2h15 cutoff).

**STEP 6 COMPLETE. Recovery fully confirmed.**

### 6d — delete secret backup file

Recovery confirmed above → `~/cin7-secret-backup.json` deleted.

### 6e — watermark disposition — JJ's decision, not made here

The watermark was changed from `UNSET` (Version 188) to an active value in Step 1, and is **still
active** (Version 223, `2026-08-19T03:51:14.000Z`, self-sustaining — the poller is advancing it every
cycle on its own, no further action needed to keep it moving). **Per the task instructions, this run
does NOT reset it to `UNSET`.** JJ must decide:
- **Leave it active** — the poller keeps running live cycles every ~3 min, polling real Cin7
  production data (~960 requests/day standing cost per Hard Constraint 4), until someone unsets it.
- **Unset it** (idle, the normal resting state): `aws ssm put-parameter --profile staging --region ap-southeast-2 --name /catalog/cin7-manhattan/item-watermark/staging --value "UNSET" --type String --overwrite --confirm` (dry-run this first per Hard Constraint 5 — not run in this session).

---

## RUN COMPLETE — 2026-08-19T03:56Z

Total elapsed: T0 (01:15:05Z) → recovery confirmed (03:55:12Z) ≈ 2h40m, slightly over the ~2h20
estimate due to the unexpected 94-minute warm-container cache delay before the break took effect.

Final write-up: **`BUSY-1117-FORCED-BREAK-RESULTS.md`** — T0, all 59 failed-cycle timestamps, both
alarms' verbatim transition history, predicted-vs-actual, AC1/AC2/AC4/AC5 verdicts, every changed
value with undo commands, restore/recovery evidence, and confirmation of final state. **One open
item flagged for JJ:** the watermark is still active (not reset to `UNSET`) — his decision, not made
here. **One item needs JJ to check personally:** his email inbox around 02:56-02:57Z and 03:53-03:54Z
UTC for the AC4 SNS notifications (the subscription is confirmed live, but this session cannot read
an inbox to verify delivery).
