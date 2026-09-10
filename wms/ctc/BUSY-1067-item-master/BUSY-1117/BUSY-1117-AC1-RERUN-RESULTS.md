# BUSY-1117 AC1 re-run — consolidated results (Session B of 2)

Stage `staging`, profile `staging`, region `ap-southeast-2`. All times UTC unless marked AEST
(UTC+10). Tags: **MEASURED** / **INFERRED** / **UNKNOWN** per repo convention. Full blow-by-blow
is in `BUSY-1117-AC1-RERUN-LOG.md` (Session A + Session B); this file is the standalone verdict
record.

---

## Timeline

| Event | Time (UTC) | Time (AEST) |
|---|---|---|
| T0 (Session A start of forced break) | `2026-08-19T05:45:33–34Z` | `15:45:33–34` |
| Cold-start config update (Session A) | issued `05:45:56Z`, confirmed `Successful` `~05:46:0xZ` | `15:45:56` / `~15:46:0x` |
| Last good `Cin7PollerCycleComplete` before break | `05:43:53.242Z` | `15:43:53` |
| First failure | `05:46:52.430Z` | `15:46:52` |
| `poller-errors` OK→ALARM | `05:53:32.119Z` | `15:53:32` |
| `watermark-stale` OK→ALARM | `08:14:49.319Z` | `18:14:49` |
| Last failure (pre-restore) | `09:47:53.662Z` | `19:47:53` |
| Secret restored (`put-secret-value`) | `09:48:22Z` | `19:48:22` |
| Cold start (Session B) | issued `09:48:37Z`, confirmed `Successful` `~09:48:47Z` | `19:48:37` / `~19:48:47` |
| First good cycle after restore (catch-up) | `09:50:20.236Z` | `19:50:20` |
| `poller-errors` ALARM→OK | `09:51:32.119Z` | `19:51:32` |
| `watermark-stale` ALARM→OK | `09:51:49.318Z` | `19:51:49` |
| Session B end | `10:05:44Z` | `20:05:44` |

**Total failed cycles: 81** distinct invocations (by unique RequestId; 242 log lines, ~3
`Cin7PollerCycleFailed` emissions per invocation from internal SDK retries — not 242 separate
cycles). All `Cin7ConfigError: Cin7 secret is missing required fields`.

**Total outage (data-flow gap):** last good cycle → first post-restore cycle = **4h06m27s**
(`05:43:53.242Z` → `09:50:20.236Z`).

---

## Both alarms' transition lines, verbatim

**`staging-catalog-cin7-watermark-stale`, OK→ALARM, `2026-08-19T08:14:49.319+00:00`:**
```
Threshold Crossed: no datapoints were received for 8 periods and 8 missing datapoints were treated
as [Breaching].
```
Breaching buckets (900s each): `06:14, 06:29, 06:44, 06:59, 07:14, 07:29, 07:44, 07:59` (2026-08-19).

**`staging-catalog-cin7-watermark-stale`, ALARM→OK, `2026-08-19T09:51:49.318+00:00`:**
```
Threshold Crossed: 1 datapoint [2.0 (19/08/26 09:36:00)] was not less than or equal to the threshold
(0.0) and 7 missing datapoints were treated as [Breaching].
```

**`staging-catalog-cin7-poller-errors`, OK→ALARM, `2026-08-19T05:53:32.119+00:00`** (recorded
Session A):
```
Threshold Crossed: 3 datapoints [2.0 (19/08/26 05:50:00), 3.0 (19/08/26 05:47:00), 1.0 (19/08/26
05:44:00)] were greater than the threshold (0.0).
```

**`staging-catalog-cin7-poller-errors`, ALARM→OK, `2026-08-19T09:51:32.119+00:00`:**
```
Threshold Crossed: 1 datapoint [0.0 (19/08/26 09:48:00)] was not greater than the threshold (0.0).
```

Neither alarm flapped — exactly one OK→ALARM and one ALARM→OK each across the whole window.

---

## Predicted vs. actual — AC1 timing

Handoff prediction: ALARM ≈ `07:45–07:47Z`, from 8 breaching buckets assumed aligned to clock
quarter-hours (`05:45, 06:00, ... 07:30`) starting immediately after the last-good-cycle bucket.

Actual: `08:14:49Z` — **gap of ~28-30 minutes.**

**Explanation:** the real breaching buckets (`06:14, 06:29, ..., 07:59`) are offset 14 minutes from
clock quarter-hours, not the `06:00/06:15/...` sequence the prediction assumed. The 8-bucket
breaching run therefore starts 29 minutes later than predicted, which accounts for essentially the
whole gap. **MEASURED** (the offset, from the literal `evaluatedDatapoints`); **INFERRED**
(the underlying CloudWatch period-alignment mechanism — not documented, not read from source).

**Elapsed-to-alarm:**
- From T0 (`05:45:33Z`): **2h29m16s** (149.3 min)
- From last good cycle (`05:43:53.242Z`): **2h30m56s** (150.9 min)

**Baseline for judging "~2 hours": last-good-cycle, not T0.** The alarm's own definition (Sum of
`Cin7PollerCycleComplete` over 8×900s, `TreatMissingData=breaching`) is a clock that starts at the
last real completion — that's the only baseline that exists in a genuine (non-QA) outage, and it's
what the alarm is mechanically measuring. T0 is a QA-procedural timestamp, not a property of the
failure itself.

---

## Verdicts

### AC1: **PASS (MEASURED)**, with a flagged timing gap

The alarm transitioned OK→ALARM on a genuine 8/8-breaching-period condition, with the correct metric
named in the reason. The detection mechanism is proven correct.

**Flag for JJ:** actual time-to-alarm was **2h30m56s** measured from the correct (last-good-cycle)
baseline — **~31 minutes (~26%) longer** than the AC's "~2 hours" language. This session does not
resolve whether that overshoot is acceptable against the literal AC wording; that's a call only JJ
can make, since it depends on how strictly "~2 hours" is meant. The overshoot traces to CloudWatch's
period-bucket alignment (see above), not to any gap in the alarm's own logic or configuration.

### AC5: **UNKNOWN (MEASURED absence of evidence, not a null result)**

Searched the poller log group across the last 7 days for `Cin7PollerCycleComplete` cycles with
`recordsEmitted:0` (or `productsFetched:0`): **zero occurrences**, out of 80 total real completions
(the other 3,178 poller invocations in the window were `Cin7ItemPollerInactive` no-ops while the
watermark sat `UNSET`).

**Cannot determine whether the watermark advances on a zero-record active cycle** — the scenario has
never occurred in the observable history. Every one of the 80 real cycles ran during a
deliberately-scoped QA test window chosen because it contained known changes; the watermark was
`UNSET` (not "active and quiet") the rest of the time. This is a structural gap in the evidence, not
proof either way.

**Production finding to flag regardless of the eventual answer:** the ticket itself notes off-peak
CTC months see very few changes. If a genuinely quiet *active* period occurs in production and the
watermark does not advance on it, `watermark-stale` will false-positive in a way that is
indistinguishable from a real outage to anyone watching the alarm (unlike the `UNSET` case, which at
least shows the poller as inactive). **Recommend resolving this by reading the poller source** (does
the watermark write happen unconditionally on every completed cycle, or gated on
`recordsEmitted>0`?) rather than waiting for a naturally-quiet window that may not arrive for months.

No empty cycle occurred in the four post-restore cycles either (Step 2d below) — **(b) is also
UNKNOWN**, consistent with (a).

---

## STEP 2 — Restore and recovery evidence

**Secret restore (MEASURED):** `put-secret-value` issued `09:48:22Z`. Verified by a direct
`get-secret-value` read (not the put's own response): `VersionId c92a3046-83e2-4948-a9de-cbb0c13b9a4b`,
stage `AWSCURRENT`, `username=='ThrillsAU'`, `apiKey` non-empty.

**Cold start (MEASURED):** `update-function-configuration --description "restored after QA AC1
re-run 2026-08-19T05:45:33Z"` issued `09:48:37Z`. Verified by a direct `get-function-configuration`
read ~10s later: `LastUpdateStatus: Successful`.

**All four recovery conditions confirmed (MEASURED):**

| Condition | Evidence |
|---|---|
| Real `Cin7PollerCycleComplete` after restore | `09:50:20.236Z` |
| `watermark-stale` back to OK | `09:51:49.318Z` |
| `poller-errors` back to OK | `09:51:32.119Z` |
| Watermark past pre-break value (`05:41:03.000Z`) | `09:59:08.000Z`, v246, still advancing |

**Recovery volume (also BUSY-1116 recovery evidence):**

| Cycle | Time | productsFetched | recordsEmitted | recordsSkipped |
|---|---|---|---|---|
| catch-up | 09:50:20.236Z | 211 | 1409 | 2 |
| 2 | 09:50:35.789Z | 1 | 1 | 0 |
| 3 | 09:52:52.795Z | 1 | 1 | 0 |
| 4 | 09:58:51.703Z | 3 | 18 | 0 |
| **Total** | | **216** | **1429** | **2** |

The ~4h08m backlog (`05:41:03Z`→`09:49:03Z`) cleared in one catch-up cycle at the standard ≤100-id
chunking — consistent with the cost model in CLAUDE.md (request cost tracks pages/chunks, not
record volume).

---

## Values changed, and exact undo commands

| Value | Old | New | Undo |
|---|---|---|---|
| Secret `staging/catalog/cin7` | `{}` (blanked in an earlier sanctioned test) | restored, `VersionId c92a3046-83e2-4948-a9de-cbb0c13b9a4b` | Not needed — this *is* the correct value. Pre-break version recoverable via `aws secretsmanager get-secret-value --profile staging --region ap-southeast-2 --secret-id staging/catalog/cin7 --version-stage AWSPREVIOUS` if ever needed (VersionId `72375450-7b4c-4cd6-8ee2-b3e42ef73551`). |
| Lambda `staging-catalog-cin7-cin7-item-poller` `Description` | `"QA AC1 re-run cold start 2026-08-19T05:45:33Z"` (Session A) | `"restored after QA AC1 re-run 2026-08-19T05:45:33Z"` | Cosmetic/breadcrumb only, no functional effect. Revert with `aws lambda update-function-configuration --profile staging --region ap-southeast-2 --function-name staging-catalog-cin7-cin7-item-poller --description "<original description, if any>"` — original description was not captured in either session's pre-flight, so revert-to-blank is `--description ""`. |
| Watermark SSM param | `UNSET` (v238) → `2026-08-19T05:33:00.000Z` (v239, Session A gate) → frozen at `2026-08-19T05:41:03.000Z` during outage → self-advancing to `2026-08-19T09:59:08.000Z` (v246) | **`UNSET` (v249)** — JJ decided to unset it; done and verified (see above) | Already reverted to the documented idle state. To re-activate: `cin7-watermark.sh --set <UTC-ISO8601> --confirm`. |
| Local file `~/cin7-secret-backup.json` | present | **deleted** | Not reversible from this session, but not needed — the pre-break secret is preserved as `AWSPREVIOUS` (VersionId above) independent of the local file. |

**What is left changed beyond the two sanctioned actions:** only the Lambda `Description` breadcrumb
(expected — that's the mechanism used to force the cold start, both times). No alarms, dashboards,
Cin7 data, Confluence, or Jira were touched.

---

## Watermark: RESOLVED — unset per JJ's decision

**Update (post-write-up):** JJ decided — unset it. `./cin7-watermark.sh --unset --confirm` run at
`10:09:20Z`; verified by direct `get-parameter` read: `Value: UNSET`, `Version: 249`. Confirmed it
actually held (no repeat of the 2026-08-13 caching-lag precedent) — the poller logged
`Cin7ItemPollerInactive` on its next two cycles (`10:10:50Z`, `10:13:50Z`) with zero further
`Cin7PollerCycleComplete` events. **Idle state confirmed, MEASURED.** Full detail appended to
`BUSY-1117-AC1-RERUN-LOG.md` under "POST-SESSION."

(Prior to this decision it had been self-sustaining: 4 real cycles since the restore,
`09:49:03Z` → `09:53:58Z` → `09:59:08Z`, no manual intervention, both alarms `OK` throughout.)

---

## Unsubstantiated / flagged, not filled

- **Predicted-vs-actual gap mechanism** (CloudWatch's exact period-alignment rule) is INFERRED, not
  read from AWS documentation or source — flagged above, not stated as fact.
- **AC5(a) and (b)** are explicitly UNKNOWN — no naturally-occurring empty active cycle exists in the
  retained history to observe. Not inferred either direction.
- **Original (pre-Session-A) Lambda `Description` value** was never captured by either session's
  pre-flight, so the exact revert-to-original text is unknown; the practical undo (blank string) is
  given instead.
- **Whether the two alarm emails actually reached JJ's inbox** is not verified from this session (no
  mailbox access) — the SNS subscription exists and both alarms only ever transitioned OK→ALARM
  once each with `AlarmActions` wired to that subscription, so delivery is expected but not
  confirmed end-to-end.
