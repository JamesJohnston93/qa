# BUSY-1117 AC1 re-run log — Session A of 2

Stage `staging`, profile `staging`, region `ap-southeast-2`. All times UTC unless marked AEST
(UTC+10). Tags: **MEASURED** / **INFERRED** / **UNKNOWN** per repo convention.

Context: this is a re-run of the forced-secret-break test. The first attempt today
(T0=2026-08-19T01:15:05Z, see `BUSY-1117-FORCED-BREAK-RESULTS.md` / `BUSY-1117-RUN-LOG.md`) blanked
the secret but did not force a cold start, so warm Lambda containers served cached valid credentials
for 94 minutes, leaving only ~41-58 real failure-minutes inside the session window against the
120 minutes `watermark-stale` requires (8 x 900s, TreatMissingData=breaching). AC1 was left
**genuinely open, not FAIL**. This session (A) blanks the secret again and forces a cold start
**immediately**, then proves failure has started and stops — leaving collection + restore to
Session B later tonight.

Session A start (this log's first write): 2026-08-19T05:41:57Z (15:41:57 AEST).

---

## STEP 0 — PRE-FLIGHT (read-only)

**0a — Alarm configs (MEASURED, `describe-alarms` at 05:42Z):**

| | `staging-catalog-cin7-poller-errors` | `staging-catalog-cin7-watermark-stale` |
|---|---|---|
| Namespace | `AWS/Lambda` | `staging-catalog-cin7` |
| MetricName | `Errors` | `Cin7PollerCycleComplete` |
| Period | 180 | 900 |
| EvaluationPeriods | 3 | 8 |
| DatapointsToAlarm | (not set — uses M-of-M, i.e. 3 of 3) | (not set — 8 of 8) |
| Threshold | 0.0 (GreaterThanThreshold) | 0.0 (LessThanOrEqualToThreshold) |
| TreatMissingData | `notBreaching` | **`breaching`** |
| AlarmActions | `staging-catalog-manhattan-observability-alerts` | same |
| StateValue (05:42Z) | OK (`StateUpdatedTimestamp 2026-08-19T03:53:32.118Z`) | OK (`StateUpdatedTimestamp 2026-08-19T01:15:49.318Z`) |

**HARD GATE: `watermark-stale` has `TreatMissingData=breaching` — CONFIRMED. Proceeding.**

**0b — Watermark param (MEASURED, `get-parameter` at 05:41:5xZ):** `UNSET`, Version 238,
LastModifiedDate `2026-08-19T14:36:42.282+10:00` (= `04:36:42Z`). So it had been reset to idle
sometime after the prior run's report (which left it self-sustaining at v224, ~03:56Z) and now.

**0c — Last 15 min of poller logs (MEASURED, `filter-log-events` 05:26:50Z–05:41:50Z):** five
`Cin7ItemPollerInactive` / `watermark:"UNSET"` events at :28:50, :31:50, :34:50, :37:50, :40:50 —
poller is **INACTIVE**.

**0d — SNS subscription (MEASURED, `list-subscriptions-by-topic` at 05:42Z):** one subscription,
Protocol `email`, Endpoint `james.johnston@universalstore.com.au`, real `SubscriptionArn`
(`...:e386f94a-2dec-4d3b-bbaf-a4b3d2bdf9bb`) — **Confirmed, not PendingConfirmation.**

---

## STEP 1 — GATE (poller was INACTIVE → activated)

Poller was INACTIVE (0c), so per the gate: set watermark to now-10min in poller format.

- Dry run at 05:42Z: `2026-08-19T05:33:00.000Z` — old `UNSET`, requested `2026-08-19T05:33:00.000Z`.
- Confirmed write at 05:43:2xZ: `./cin7-watermark.sh --stage staging --profile staging --set 2026-08-19T05:33:00.000Z --confirm`
- **MEASURED, direct `get-parameter` read (not trusting the script's success message):**
  `Value: 2026-08-19T05:33:00.000Z`, `Version: 239`, `LastModifiedDate: 2026-08-19T15:43:26.437+10:00`.
- **MEASURED, first active cycle:** `Cin7PollerCycleComplete` at `2026-08-19T05:43:53.242Z` —
  `{"productsFetched":14,"productsFetchedPrimary":0,"recordsEmitted":91,"recordsSkipped":0,"watermarkAdvanced":true,"newWatermark":"2026-08-19T05:41:03.000Z"}`.

Gate satisfied — poller is ACTIVE. Watermark old value: `UNSET` (v238). New value:
`2026-08-19T05:33:00.000Z` (v239, now self-advancing).

---

## STEP 2 — BACK UP THE SECRET

**MEASURED, `get-secret-value` at 05:45Z:** current `staging/catalog/cin7` VersionId
`72375450-7b4c-4cd6-8ee2-b3e42ef73551` (AWSCURRENT) — this is the same VersionId the prior run's
restore produced, confirming nothing has changed it since.

Backup written to `/Users/james.johnston/cin7-secret-backup.json` (OUTSIDE the repo folder).
**Confirmed non-empty and parses as valid JSON**: keys `['username', 'apiKey']`, `username ==
'ThrillsAU'` (matches expected pre-break value).

**Exact restore command for Session B, to run by hand from a plain terminal, no Claude session:**

```
aws secretsmanager put-secret-value --profile staging --region ap-southeast-2 \
  --secret-id staging/catalog/cin7 \
  --secret-string file:///Users/james.johnston/cin7-secret-backup.json
```

Fallback restore path if the backup file is ever lost: VersionId `72375450-7b4c-4cd6-8ee2-b3e42ef73551`
is the current AWSCURRENT before this run's break — it becomes AWSPREVIOUS immediately after Step 3's
`put-secret-value`, retrievable via:
```
aws secretsmanager get-secret-value --profile staging --region ap-southeast-2 \
  --secret-id staging/catalog/cin7 --version-stage AWSPREVIOUS
```

---

## STEP 3 — T0, BREAK IT

`put-secret-value --secret-id staging/catalog/cin7 --secret-string '{}'` (BLANK, not corrupted).

**T0 = 2026-08-19T05:45:33Z – 05:45:34Z UTC** (= **2026-08-19T15:45:33-34 AEST**). New VersionId
`828a8366-2758-4a59-a0d9-61826fd2617b` (AWSCURRENT). Old VersionId `72375450-...` is now AWSPREVIOUS
(fallback restore path).

---

## STEP 4 — FORCE A COLD START IMMEDIATELY

`aws lambda update-function-configuration --function-name staging-catalog-cin7-cin7-item-poller
--description "QA AC1 re-run cold start 2026-08-19T05:45:33Z"` issued at **05:45:56Z** (~22s after
T0 — the whole point of this re-run vs. the first attempt).

**MEASURED, verified with a direct `get-function-configuration` read (not trusting the update
call's own response), at 05:46:0xZ:** `LastUpdateStatus: Successful`, `Description: "QA AC1 re-run
cold start 2026-08-19T05:45:33Z"`.

---

## STEP 5 — PROVE FAILURE HAS STARTED

Polled every 90s from 05:48:34Z. **Result: both conditions met at check 5 (05:54:44Z), well inside
the T0+15min budget** — dramatically faster than the first attempt because the cold start defeated
the warm-container credential cache immediately instead of 94 minutes in.

**MEASURED — every failed-cycle timestamp seen (`Cin7PollerCycleFailed` /
`Cin7 secret is missing required fields`), T0→05:54:44Z, 8 occurrences:**
```
05:46:52.430  05:47:47.710  05:49:51.427  05:49:53.311  05:50:47.690  05:52:50.741  05:53:01.961  05:53:55.989
```
First failure: **05:46:52.430Z** — only **~1m19s after T0**, ~55s after the cold-start config update
confirmed `Successful`. Error is the expected one: `Cin7ConfigError: Cin7 secret is missing required
fields`, at `_Cin7Connector.validateCredentials`, uncached — confirms the cold start defeated the
warm-container cache that broke the first attempt.

**MEASURED — `staging-catalog-cin7-poller-errors` OK→ALARM transition, verbatim
(`describe-alarm-history`):**
```
2026-08-19T05:53:32.119+00:00  Alarm updated from OK to ALARM
StateReason: "Threshold Crossed: 3 datapoints [2.0 (19/08/26 05:50:00), 3.0 (19/08/26 05:47:00),
1.0 (19/08/26 05:44:00)] were greater than the threshold (0.0)."
```
That's **7m59s from T0** — vs. the first attempt's 94-minute cache-absorption delay before failures
even began.

**Last `Cin7PollerCycleComplete` before failures began: `2026-08-19T05:43:53.242Z`**
(`{"productsFetched":14,...,"newWatermark":"2026-08-19T05:41:03.000Z"}`) — this is the only real
cycle that ran in the ~2min window between Step 1's gate activation and T0. Session B needs this
timestamp to compute the true start of the `watermark-stale` breaching window.

**Failure confirmed started: YES**, both required conditions satisfied well within budget.

---

## STEP 6 — === HANDOFF TO SESSION B ===

- **T0:** `2026-08-19T05:45:33Z – 05:45:34Z UTC` = **2026-08-19T15:45:33-34 AEST**
- **Cold-start time:** config update issued `2026-08-19T05:45:56Z` (~22s after T0), confirmed
  `LastUpdateStatus: Successful` by `2026-08-19T05:46:0xZ`
- **Last good `Cin7PollerCycleComplete` before failures:** `2026-08-19T05:43:53.242Z`
  (`newWatermark:"2026-08-19T05:41:03.000Z"`)
- **First failure timestamp:** `2026-08-19T05:46:52.430Z` (~1m19s after T0). **8 failed cycles
  observed so far** by end of this session (05:54:44Z), all `Cin7 secret is missing required
  fields`: `05:46:52.430, 05:47:47.710, 05:49:51.427, 05:49:53.311, 05:50:47.690, 05:52:50.741,
  05:53:01.961, 05:53:55.989`. Failures are ongoing — the secret is still blank at handoff.
- **`poller-errors` OK→ALARM transition, verbatim:**
  `2026-08-19T05:53:32.119+00:00  Alarm updated from OK to ALARM` — `"Threshold Crossed: 3
  datapoints [2.0 (19/08/26 05:50:00), 3.0 (19/08/26 05:47:00), 1.0 (19/08/26 05:44:00)] were
  greater than the threshold (0.0)."`
- **Secret VersionId (pre-break, AWSPREVIOUS now) and exact restore command:**
  Pre-break VersionId `72375450-7b4c-4cd6-8ee2-b3e42ef73551`. Backup file:
  `/Users/james.johnston/cin7-secret-backup.json` (confirmed non-empty, valid JSON, keys
  `['username','apiKey']`, `username=='ThrillsAU'`).
  ```
  aws secretsmanager put-secret-value --profile staging --region ap-southeast-2 \
    --secret-id staging/catalog/cin7 \
    --secret-string file:///Users/james.johnston/cin7-secret-backup.json
  ```
  Fallback (if backup file lost): `aws secretsmanager get-secret-value --profile staging --region
  ap-southeast-2 --secret-id staging/catalog/cin7 --version-stage AWSPREVIOUS`
- **Watermark:** changed in Step 1 (gate — poller was found INACTIVE). Old value `UNSET` (v238).
  New value `2026-08-19T05:33:00.000Z` (v239), then **self-advancing while cycles succeeded** up to
  `2026-08-19T05:41:03.000Z` before failures began. It is currently frozen at that value while the
  secret is blank (failed cycles don't advance it). **Per the standing instruction, this session did
  NOT reset it to `UNSET`** — that remains JJ's decision, to be made only after Session B.
- **Predicted `watermark-stale` ALARM window, arithmetic shown:**
  Alarm: `Cin7PollerCycleComplete` Sum, Period=900s, EvaluationPeriods=8,
  ComparisonOperator=LessThanOrEqualToThreshold, Threshold=0.0, TreatMissingData=breaching.
  Last real completion `05:43:53.242Z` falls in the `05:30:00–05:45:00` bucket. The first
  fully-empty bucket (assuming no restore before then) is `05:45:00–06:00:00`. Eight consecutive
  breaching 900s buckets from there: `05:45, 06:00, 06:15, 06:30, 06:45, 07:00, 07:15, 07:30`
  (8th bucket closes `07:45:00Z`). Adding CloudWatch's typical evaluation lag (~1-2 min, per this
  session's own `poller-errors` transition landing ~2min after its bucket's close):
  **predicted ALARM ≈ 2026-08-19T07:45Z–07:47Z UTC = 17:45–17:47 AEST.** (INFERRED extrapolation —
  not observed yet; depends on the secret staying blank until then.)
- **Earliest clock time worth running Session B:** predicted ALARM + 30min buffer ≈
  **2026-08-19T08:15Z–08:17Z UTC = 18:15–18:17 AEST.**

---

## STEP 7 — SIGN OFF (session ends here)

Session A ended at `2026-08-19T05:54:44Z` (`15:54:44 AEST`). Secret left blank intentionally.
No further polling performed. No restore performed. Watermark not reset to `UNSET`. Nothing else
touched — same three sanctioned changes as listed in the run brief (secret, watermark step 1 only,
Lambda description).

---

# Session B of 2 — read handoff, verdict, restore, recovery, AC5

Session B start: `2026-08-19T09:45:30Z` (`19:45:30 AEST`) — read the Session A handoff block above
in full before taking any action. All values below (T0, cold-start time, last good cycle, secret
VersionId, restore command) are taken verbatim from that block, not re-derived.

## STEP 1 — AC1 VERDICT (read-only, retrospective)

**`staging-catalog-cin7-watermark-stale` — MEASURED, `describe-alarm-history` T0→09:45:30Z:**

Exactly one `StateUpdate` in the window — **`OK` → `ALARM` at `2026-08-19T08:14:49.319+00:00`**
(`18:14:49.319 AEST`). Verbatim `newState.stateReason`:

```
Threshold Crossed: no datapoints were received for 8 periods and 8 missing datapoints were treated
as [Breaching].
```

Verbatim breaching `evaluatedDatapoints` (all missing, 900s buckets):
```
07:59:00  07:44:00  07:29:00  07:14:00  06:59:00  06:44:00  06:29:00  06:14:00  (all 2026-08-19)
```

**Elapsed:**
- From T0 (`05:45:33Z`): **2h29m16s** (149.3 min)
- From last good `Cin7PollerCycleComplete` (`05:43:53.242Z`): **2h30m56s** (150.9 min)

**Which baseline governs the AC's "~2 hours":** the **last-good-cycle** baseline, not T0. The alarm's
own definition (`Cin7PollerCycleComplete` Sum, 8×900s, `LessThanOrEqualToThreshold`,
`TreatMissingData=breaching`) measures elapsed time since the last real completion — that is the
staleness clock intrinsic to the alarm, and it's the only baseline that exists in a real (non-QA)
outage. T0 is a QA-procedural timestamp that happens to fall ~1m40s after the last good cycle in
this run; using it would understate the true detection latency by that margin. **Verdict should be
read against 2h30m56s.**

**Predicted vs. actual, arithmetic shown:** handoff predicted ALARM at `07:45–07:47Z` (8 consecutive
breaching buckets `05:45,06:00,...,07:30` assumed aligned to clock quarter-hours, +1-2min evaluation
lag). Actual transition: `08:14:49Z` — **gap of ~28-30 minutes.**
**Explanation (MEASURED offset / INFERRED mechanism):** the actual breaching buckets returned by
`describe-alarm-history` are `06:14, 06:29, 06:44, 06:59, 07:14, 07:29, 07:44, 07:59` — offset **14
minutes** from clock quarter-hours, not the `06:00/06:15/...` buckets the prediction assumed. The
8-bucket breaching sequence therefore starts 29 minutes later than predicted, which accounts for
essentially the entire gap. This is a property of how CloudWatch aligns this metric's evaluation
periods (INFERRED — not documented, not read from code), not an application defect.

**AC1 PASS (MEASURED)** — the alarm did transition to ALARM, on a genuine 8/8-breaching-period
condition, with a verbatim reason naming the correct metric. **Flag for JJ:** actual time-to-alarm
was **2h30m56s**, ~31 minutes (~26%) longer than the AC's "~2 hours" language, measured from the
correct (last-good-cycle) baseline. The detection mechanism itself is proven correct and did fire;
whether a 26% overshoot is acceptable against the literal AC wording is a call for JJ, not inferred
here.

**`staging-catalog-cin7-poller-errors` — full alarm history, T0→09:45:30Z (pre-restore):** exactly
one `StateUpdate` — `OK`→`ALARM` at `2026-08-19T05:53:32.119Z` (already recorded in Session A,
7m59s from T0). **No other transitions in the pre-restore window** — it stayed in ALARM
continuously from 05:53:32Z until the restore (Step 2).

**Total failed cycles (MEASURED, Logs Insights, T0→restore):** log lines matching
`Cin7PollerCycleFailed` = 242, but each Lambda invocation logs the message ~3× (internal SDK
retries within one invocation, not 3 separate cycles) — **by unique RequestId, 81 distinct failed
invocations**, `05:46:52.430Z` → `09:47:53.662Z` (the last one straddling the restore instant),
all `Cin7ConfigError: Cin7 secret is missing required fields`.

**SNS notification actions:** both alarms have `OKActions: []` — notifications fire **only** on the
`AlarmActions` (into-alarm) transition, never on the return to OK. Each alarm transitioned into
ALARM exactly once in the window (no flapping), so **at most one notification per alarm** could have
fired. **Correction to CLAUDE.md's "ZERO subscriptions" claim:** the topic
`staging-catalog-manhattan-observability-alerts` now has **one active subscription** —
`james.johnston@universalstore.com.au` (email, confirmed via `list-subscriptions-by-topic`). This is
new since the 2026-08-18 reconciliation. **Practical consequence: JJ's own inbox should have two real
alert emails from this run** (`poller-errors` @ 05:53:32Z, `watermark-stale` @ 08:14:49Z) — worth
checking to close the loop on whether the plumbing genuinely reaches a human, not just the topic.

## STEP 2 — RESTORE AND VERIFY

**a) Secret restore (MEASURED):** `put-secret-value` issued `2026-08-19T09:48:22Z`. Verified with a
direct `get-secret-value` (not the put's own response): `VersionId c92a3046-83e2-4948-a9de-cbb0c13b9a4b`,
stage `AWSCURRENT`, keys `['username','apiKey']`, `username=='ThrillsAU'`, `apiKey` non-empty.

**b) Cold start (MEASURED):** `update-function-configuration --description "restored after QA AC1
re-run 2026-08-19T05:45:33Z"` issued `2026-08-19T09:48:37Z`. Verified with a direct
`get-function-configuration` read (not the update's own response) ~10s later:
`LastUpdateStatus: Successful`, `Description` matches, `LastModified 2026-08-19T09:48:39Z`.

**c) Recovery — all four conditions confirmed (MEASURED):**

| Condition | Evidence |
|---|---|
| Real `Cin7PollerCycleComplete` after restore | First at `09:50:20.236Z`: `{"productsFetched":211,"recordsEmitted":1409,"recordsSkipped":2,"watermarkAdvanced":true,"newWatermark":"2026-08-19T09:49:03.000Z"}` |
| `watermark-stale` back to OK | `describe-alarm-history`: `ALARM`→`OK` at `2026-08-19T09:51:49.318Z` |
| `poller-errors` back to OK | `describe-alarm-history`: `ALARM`→`OK` at `2026-08-19T09:51:32.119Z` |
| Watermark past pre-break value (`05:41:03.000Z`) | direct `get-parameter`: `2026-08-19T09:59:08.000Z`, Version 246, still advancing |

**Total outage (data-flow gap):** last good cycle `05:43:53.242Z` → first post-restore cycle
`09:50:20.236Z` = **4h06m27s**.

**d) Recovery volume (MEASURED — also serves as BUSY-1116 recovery evidence):**

| Cycle | Time | productsFetched | recordsEmitted | recordsSkipped | newWatermark |
|---|---|---|---|---|---|
| catch-up | 09:50:20.236Z | 211 | 1409 | 2 | `2026-08-19T09:49:03.000Z` |
| 2 | 09:50:35.789Z | 1 | 1 | 0 | `2026-08-19T09:49:03.000Z` |
| 3 | 09:52:52.795Z | 1 | 1 | 0 | `2026-08-19T09:49:03.000Z` |
| 4 | 09:58:51.703Z | 3 | 18 | 0 | `2026-08-19T09:53:58.000Z` |
| **Total (4 cycles)** | | **216** | **1429** | **2** | |

The ~4h08m backlog (`05:41:03Z`→`09:49:03Z`) cleared in **one** cycle at the standard ≤100-id
chunking, consistent with the cost model (§ CLAUDE.md) — request cost tracks pages/chunks, not
record volume.

**e) Backup file:** deleted `~/cin7-secret-backup.json` after all four recovery points above were
independently confirmed by direct reads (not script success messages), per the standing instruction.
The pre-break secret remains recoverable as `AWSPREVIOUS` in Secrets Manager
(VersionId `72375450-7b4c-4cd6-8ee2-b3e42ef73551`) as a fallback even with the local file gone.

## STEP 3 — AC5 (read-only)

**a) Empty-cycle search, last 7 days (MEASURED):** `Cin7PollerCycleComplete` with
`"recordsEmitted":0` → **0 occurrences**. Also checked `"productsFetched":0` → **0 occurrences**.
Total `Cin7PollerCycleComplete` events in the 7-day window: **80** (first `2026-08-13T03:47:25.738Z`,
last today's recovery cycles). Total `Cin7ItemPollerInactive` (UNSET no-op) events in the same
window: **3,178**.

**This is not evidence that empty active cycles advance (or fail to advance) the watermark — it is
absence of the scenario entirely.** The watermark was `UNSET` (idle, zero Cin7 calls) for the
overwhelming majority of the last 7 days (3,178 inactive cycles vs. 80 real ones), and every one of
the 80 real cycles ran during a **deliberately-scoped QA test window** chosen precisely because it
contained known real changes. No naturally-occurring "poller active, but genuinely nothing changed"
cycle exists anywhere in the retained history.

**Verdict: UNKNOWN (do not infer).** Cannot say whether the watermark advances on a zero-record
active cycle — the scenario has never occurred in the observable window. This is a **structural gap
in evidence**, not a null result. **Production finding to flag regardless of the answer:** the
ticket itself states off-peak CTC months see very few changes; if a genuinely quiet *active* period
ever occurs in production and the watermark does *not* advance on it, `watermark-stale` will
false-positive exactly as CLAUDE.md already documents for the `UNSET` case — except this variant
would be indistinguishable from a real outage by anyone glancing at the alarm, because the poller
would show as "active" the whole time. Recommend closing this gap with a code read (does the
watermark write happen unconditionally on every completed cycle, or only when `recordsEmitted>0`)
rather than waiting for a naturally-occurring quiet window that may not arrive for months.

**b) First quiet cycle after restore:** none of the 4 post-restore cycles (Step 2d) had
`recordsEmitted:0` — all four emitted at least 1 record. **No empty cycle to observe. Verdict:
UNKNOWN (do not infer)** — consistent with (a).

## STEP 4 — See `BUSY-1117-AC1-RERUN-RESULTS.md` for the consolidated write-up.

## STEP 5 — SIGN OFF

Session B ended `2026-08-19T10:05:44Z` (`20:05:44 AEST`). Feed healthy: both alarms `OK`, watermark
advancing normally (`09:59:08.000Z`, v246, and climbing on the standard 3-min cadence). Only
change left standing beyond the two sanctioned actions: the Lambda `Description` breadcrumb
(expected, by design). Watermark **not** reset to `UNSET` — left self-sustaining per standing
instruction; JJ's decision.

---

## POST-SESSION — JJ decided: unset the watermark

`2026-08-19T10:09:20Z`: ran `./cin7-watermark.sh --stage staging --profile staging --unset --confirm`
(current value read by the script beforehand: `2026-08-19T10:05:06.000Z`). **Verified with a direct
`get-parameter` read (not the script's success message)**, per the standing SSM-caching caveat:
`Value: UNSET`, `Version: 249`, `LastModifiedDate: 2026-08-19T20:09:20.438+10:00`.

**Confirmed it actually held** (the 2026-08-13 precedent saw an `--unset` report success while the
poller kept running 11 more active cycles for ~33 minutes): checked the poller log group from
`10:09:20Z` onward — two `Cin7ItemPollerInactive` events (`10:10:50.536Z`, `10:13:50.460Z`), **zero**
`Cin7PollerCycleComplete` events. The poller picked up `UNSET` on its very next cycle this time —
no caching lag. **Idle state confirmed, MEASURED.**

This closes the one open item from Session B's write-up ("whether the watermark is now
self-sustaining, or whether JJ needs to decide") — JJ decided, and it's done.
