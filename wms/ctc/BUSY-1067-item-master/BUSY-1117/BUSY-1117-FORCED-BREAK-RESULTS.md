# BUSY-1117 — Forced blank-secret run: AC1 + AC2 results

**Session:** 2026-08-19, `--stage staging --profile staging --region ap-southeast-2`. Follows on
directly from the same day's read-only session (`BUSY-1117-ALARM-HISTORY-RESULTS.md`), which
concluded AC1 was genuinely open and could only be closed by "a fresh, deliberately-forced
credential outage." This run is that forced outage. Full step-by-step trace is in
`BUSY-1117-RUN-LOG.md`; this file is the FINALLY summary requested by the run brief.

Tags: **MEASURED** (directly observed this session), **INFERRED** (reasoned from measured facts,
not directly observed), **UNKNOWN** (not observable from available data).

---

## T0 and headline result

**T0 = 2026-08-19T01:15:05Z – 01:15:06Z UTC** — `staging/catalog/cin7` set to `{}` (blank, not
corrupted).

**The break took ~94 minutes to actually manifest**, not the ~9-12 min the pre-flight arithmetic
predicted. **MEASURED cause:** the poller Lambda had been continuously warm (invoked every ~3 min
without a break) since before T0, so its execution environment held cached, pre-break credentials.
Last successful cycle on cached creds: **2026-08-19T02:46:55.782Z**. First failure:
**2026-08-19T02:49:52.445Z**. This exceeds the previously-documented "warm-container reuse defeated
secret corruption for 80+ min" ceiling in `CLAUDE.md` — confirming that figure was itself an
underestimate, not a fixed constant.

---

## Every failed-cycle timestamp (59 events, MEASURED)

All `Cin7ConfigError: Cin7 secret is missing required fields`, `2026-08-19T02:49:52.445Z` →
`2026-08-19T03:47:50.689Z`:

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

**MEASURED, new observation, not previously on record:** failures repeat every ~1-3 minutes during
the outage — faster than the normal 3-min scheduled cadence — with several sharing the same
RequestId retrying seconds to minutes apart (e.g. `1a02f366...` at 02:49:52 and 02:50:46;
`c8dbb74e...` at 02:52:33, 02:52:50, 02:53:45). **INFERRED:** the poller's own retry wiring
re-attempts a failed cycle faster than a fresh schedule tick, so a sustained secret outage produces
a materially higher invocation/error rate than one failure per 3-min cycle. Worth a line in any
future handover — not previously documented anywhere in this repo.

---

## Both alarms' transition lines, verbatim (MEASURED)

**`staging-catalog-cin7-poller-errors`** (`describe-alarm-history`, StateUpdate,
2026-08-19T01:15:00Z–04:00:00Z):
```
2026-08-19T02:56:32.116000+00:00  Alarm updated from OK to ALARM
2026-08-19T03:53:32.118000+00:00  Alarm updated from ALARM to OK
```
Full ALARM StateReason at the transition:
```
Threshold Crossed: 3 datapoints [1.0 (19/08/26 02:53:00), 3.0 (19/08/26 02:50:00),
1.0 (19/08/26 02:47:00)] were greater than the threshold (0.0).
```

**`staging-catalog-cin7-watermark-stale`:** **zero StateUpdate transitions during the outage.**
It cleared its pre-existing idle-ALARM once (ALARM→OK) at `2026-08-19T01:15:49.318Z` — that was
Step 1's gate activating the poller, not a reaction to the break — and then stayed **OK** for the
entire remainder of the run, including through the whole 58-minute failure window. It never reached
ALARM during this session.

---

## Predicted vs actual

| Alarm | Predicted (Step 0b, from T0) | Actual |
|---|---|---|
| `poller-errors` | ALARM at T0+9-12 min | Failures didn't even *start* until T0+94min (cache); once they started, ALARM in **6m40s from first failure** (02:49:52Z→02:56:32Z) — faster than the naive 9-min estimate because the alarm's 180s periods are fixed clock-aligned buckets, not floating from the first failure, and the first failure landed ~2min into its bucket |
| `watermark-stale` | ALARM at ~2h after cycle completions stop (8×900s) | **Did not fire within this run's observation window.** INFERRED extrapolation from period math (last real completion 02:46:55Z, clock-aligned 15-min buckets, 8 consecutive breaching buckets): predicted **~2026-08-19T05:00-05:05Z** if the secret had stayed blank that long — but the run stopped holding at the T0+2h15 cutoff (03:30:05Z) per the runsheet's own rule, and the secret was restored at ~03:48Z, well before that predicted time |

---

## AC verdicts

### AC1 — breaking staging Cin7 credentials fires the watermark-staleness alarm within ~2 hours

**Verdict: STILL NOT CLOSED — but the reason has changed and materially improved.**

Previously (`BUSY-1117-ALARM-HISTORY-RESULTS.md`): unverifiable because the only real historical
credential outage (2026-08-05) predates both alarms' creation (2026-08-10). This run fixed that by
forcing a fresh outage under live alarms — and **confirmed AC1 is not unsatisfiable by design**
(Step 0c: `TreatMissingData=breaching` on `Cin7PollerCycleComplete`, so a sustained failure legitimately
starves the metric and can trip the alarm).

What actually blocked closure this time: **a timing-budget mismatch, not a design or environment
problem.** The warm-container secret cache absorbed 94 of the 135 minutes budgeted for the hold,
leaving only ~41-58 real failure-minutes inside the T0+2h15 window against the 120 minutes the
alarm's own config requires (8 × 900s). The session stopped at the instructed T0+2h15 cutoff and
restored the secret rather than extending past the ~2h20 session budget.

**Flag for JJ, not filled in:** a future attempt with either (a) a longer budgeted hold (≥3h from
T0, to absorb a worst-case ~95min cache delay *plus* the full 120min alarm window), or (b) forcing a
cold start *immediately before* breaking the secret (defeating the cache without needing an extra
~90 min to exhaust it naturally), would very likely close this cleanly on the first attempt.
**Genuinely open — do not mark PASS or FAIL, it is neither.**

### AC2 — a single failed cycle raises no alarm; 3 consecutive poller errors do

**Verdict: PASS — both halves now evidenced.**

- **Second half (3 consecutive poller errors → ALARM): PASS, newly evidenced this session.**
  `poller-errors` transitioned OK→ALARM at `2026-08-19T02:56:32.116Z` after exactly 3 consecutive
  180s periods each with `Errors > 0` (`1.0, 3.0, 1.0`), matching the alarm's own
  `EvaluationPeriods=3` / `Threshold=0.0` / `GreaterThanThreshold` config exactly. Recovered cleanly
  ALARM→OK at `03:53:32.118Z` once real cycles resumed.
- **First half (single failure raises no alarm): PASS, evidenced in the prior read-only session**
  (`BUSY-1117-ALARM-HISTORY-RESULTS.md`, the 2026-08-13 single-`TimeoutError` episode — confirmed
  `poller-errors` stayed OK throughout).

**AC2 is fully closeable now — both halves measured, on real incidents, under live alarm configs.**

### AC4 — alarm notifications arrive by email via the shared alerts topic subscription

**Verdict: LIKELY PASS — inferred, not directly confirmable from CLI, needs JJ's inbox check.**

The prior draft QA doc (`DRAFT-QA-DOC-BUSY-1117.md`, written 2026-08-18) recorded AC4 as a hard FAIL
because the alerts topic had **zero subscriptions**. **That has changed since:** this session's Step
0e (2026-08-19T01:12Z) confirmed exactly one subscription on
`staging-catalog-manhattan-observability-alerts` — Protocol `email`, Endpoint
`james.johnston@universalstore.com.au`, with a real `SubscriptionArn` (not the literal
`PendingConfirmation` string) → **CONFIRMED**, not pending.

Given that subscription, `poller-errors`' `ActionsEnabled=true`, and a genuine OK→ALARM transition
did occur at `02:56:32.116Z` (see AC2) — **CloudWatch will have published to the SNS topic on that
transition**, and SNS will have attempted delivery to the confirmed email endpoint. This is
**INFERRED from AWS's documented alarm-action behaviour, not directly observed** — this session has
no way to read an inbox. **JJ: please check for an email from AWS SNS around 2026-08-19T02:56-02:57Z
UTC (12:56-12:57 AEST) re: `staging-catalog-cin7-poller-errors` in ALARM, and again around 03:53-03:54Z
UTC for the OK recovery — if both arrived, AC4 closes PASS outright.**

### AC5 — empty cycles (zero items fetched) raise nothing

**Verdict: UNCHANGED — not exercised this session.** This run's scenario (blank-secret failure) is a
different code path from AC5's scenario (a real watermark producing a legitimate zero-record cycle).
Carrying forward the prior finding (`DRAFT-QA-DOC-BUSY-1117.md`): PASS with a documented caveat —
holds for a cycle that runs with a real watermark and logs `Cin7PollerCycleComplete` finding nothing;
does not hold for the `UNSET` no-op branch, which is a genuinely different code path. Not retested
here; no new evidence either way.

---

## Every value changed, and its exact undo command

| What | Old value | New value | Current status | Undo command |
|---|---|---|---|---|
| Watermark `/catalog/cin7-manhattan/item-watermark/staging` | `UNSET` (v188) | `2026-08-19T01:02:36.000Z` (v189), then advanced by the poller's own writes to `2026-08-19T03:55:12.000Z` (v224) as of this report | **Still active — self-sustaining, poller advances it every cycle on its own.** Not reset to `UNSET`. **JJ's decision, not made here** (see below) | `aws ssm put-parameter --profile staging --region ap-southeast-2 --name /catalog/cin7-manhattan/item-watermark/staging --value "UNSET" --type String --overwrite` (dry-run/confirm per Hard Constraint 5 before running) |
| Secret `staging/catalog/cin7` | VersionId `e3cc69af-...` (`{"username":"ThrillsAU","apiKey":"..."}`) | Blanked to `{}` at T0 (VersionId `fcf75d57-...`), **restored** to the original content at 03:48-49Z (new VersionId `72375450-...`, content verified byte-identical in shape: keys `['apiKey','username']`, `username == 'ThrillsAU'`) | **Restored and confirmed working** — poller completing real cycles on it since 03:51:24Z | Already done — this *is* the undo. Fallback if ever needed again: the pre-break version `e3cc69af-...` remains in Secrets Manager version history (though no longer AWSPREVIOUS, which now points to the blank `fcf75d57-...`) |
| Poller Lambda `staging-catalog-cin7-cin7-item-poller` description | (whatever it was before — not recorded, was not a meaningfully-used field) | `"cold start after QA AC1 run 2026-08-19T01:15:05Z"` | Set, `LastUpdateStatus: Successful` | No undo needed — this field carries no functional meaning for the Lambda; left as a breadcrumb of this run. If cosmetic reversion is wanted: `aws lambda update-function-configuration --profile staging --region ap-southeast-2 --function-name staging-catalog-cin7-cin7-item-poller --description ""` |

**Nothing else was touched.** No alarms, no dashboards, no other Lambda config, no Cin7 writes, no
Confluence, no Jira — matches the run's stated scope exactly.

---

## Restore and recovery evidence (MEASURED)

- Secret restore: `put-secret-value` at ~2026-08-19T03:48-49Z → VersionId `72375450-7b4c-4cd6-8ee2-b3e42ef73551`
  (AWSCURRENT). Verified immediately by `get-secret-value`: parses, keys `['apiKey','username']`,
  `username == 'ThrillsAU'` (matches pre-break value).
- Cold start forced: `update-function-configuration --description "cold start after QA AC1 run
  2026-08-19T01:15:05Z"` at `2026-08-19T03:50:10Z` → `LastUpdateStatus: Successful` confirmed at
  final check.
- First real post-restore success: `2026-08-19T03:51:24.324Z`
  `{"metric":"Cin7PollerCycleComplete","productsFetched":261,"productsFetchedPrimary":0,
  "recordsEmitted":1916,"recordsSkipped":6,"watermarkAdvanced":true,"newWatermark":"2026-08-19T03:49...`
  — the backlog accumulated during the ~65-min outage cleared in one cycle (261 products vs. the
  usual 5-80), as expected since the watermark floor never advanced while cycles were failing.
- `poller-errors` confirmed OK: `StateUpdatedTimestamp 2026-08-19T03:53:32.118Z`.
- `watermark-stale` confirmed OK throughout (never left it): `StateUpdatedTimestamp
  2026-08-19T01:15:49.318Z`, unchanged.
- Watermark confirmed advancing under its own power: `2026-08-19T03:55:12.000Z`, Version 224, as of
  the final check at `2026-08-19T03:56:22Z`.
- `~/cin7-secret-backup.json` deleted after recovery was confirmed.

---

## Confirmation nothing is left changed (except the one flagged item)

- Secret: **restored and verified**, poller running real production cycles on it. ✅ Nothing left
  changed.
- Poller Lambda config: `LastUpdateStatus: Successful`, `State: Active`. Only the `description` field
  differs from before this run (cosmetic, flagged above, no functional impact). ✅
- Alarms (`poller-errors`, `watermark-stale`): both **OK**, neither modified in configuration, only
  their natural state transitioned and recovered as a *consequence* of the break/restore. ✅ No alarm
  config was touched.
- Watermark: **NOT reset to `UNSET`** — it is still active and self-sustaining. **This is the one
  thing intentionally left different from the pre-run state, per the task's explicit instruction not
  to decide this. JJ needs to choose:** leave it running live cycles against production Cin7 (~960
  requests/day standing per Hard Constraint 4), or unset it back to idle.
- No Cin7 writes were made at any point (GET-only throughout, per Hard Constraint 1).
- No dashboards, no other alarms, no Confluence, no Jira touched.

**Everything asked to be substantiated has been. The one open item (AC1's full closure, and AC4's
inbox confirmation) is flagged above, not filled in.**
