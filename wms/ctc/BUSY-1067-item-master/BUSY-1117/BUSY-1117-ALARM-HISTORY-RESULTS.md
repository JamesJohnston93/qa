# BUSY-1117 — Alarm-history verification results (read-only AWS session)

**Session:** 2026-08-19, `--profile staging --region ap-southeast-2`. Followed
`FINAL-WRAPUP-RUNSHEET.md` §2 verbatim — exact log groups, alarm names, metric namespace and
windows as specified there. **Read-only throughout: no injection, no Cin7 calls, no watermark
writes, no config/alarm changes, no Confluence/Jira edits.** Ran V1–V6 (all six — time allowed).

Tags used throughout: **MEASURED** (directly observed this session), **INFERRED** (reasoned from
measured facts, not directly observed), **UNKNOWN** (not observable from available data).

---

## 1. Verdicts per AC

### AC1 — breaking the staging Cin7 credentials fires the watermark-staleness alarm within ~2 hours

> ⚠ **SUPERSEDED 2026-08-19, same day, by the concurrent forced-break session.** The analysis below
> (retrospective-only, organic 2026-08-05 episode predates the alarm's creation) still stands as the
> reason a retrospective read could never close this AC — but AC1 no longer needs to rely on it.
> A deliberately-forced blank-secret + immediate-cold-start test (`BUSY-1117-AC1-RERUN-LOG.md` /
> `-RESULTS.md`) produced a genuine live `OK`→`ALARM` transition on `watermark-stale` at
> `2026-08-19T08:14:49.319Z`. **New verdict: AC1 PASS (MEASURED), flagged** — time-to-alarm was
> **2h30m56s** from the last good cycle, ~31 min (~26%) over the AC's "~2 hours" language (traced to
> a CloudWatch period-bucket alignment offset, not a design gap). **Use `BUSY-1117-AC1-RERUN-RESULTS.md`
> as the current AC1 record; treat the PARTIAL verdict below as historical context only.**

**Verdict (historical, as of this session, now superseded above): STILL PARTIAL — and confirmed
unverifiable retrospectively, for a stronger reason than previously stated.**

MEASURED: the only real blank-credential episode is 2026-08-05. Filtering
`/aws/lambda/staging-catalog-cin7-cin7-item-poller` for `"Cin7 secret is missing required fields"`
over 2026-08-05T00:00Z–2026-08-06T00:00Z returns exactly **34** `Cin7PollerCycleFailed` events
(count matches the runsheet's expectation), first `2026-08-05T03:28:50.650Z`, last
`2026-08-05T23:35:45.629Z`.

⚠ **Correction to the historical framing:** this is **not** one continuous ~1h42m episode. The 34
events fall into **two distinct clusters** with a ~19.5-hour gap between them:
- Cluster A: `03:28:50.650Z` → `03:56:57.804Z` (29 events, ~28 min, 3-min cadence)
- Cluster B: `23:31:50.712Z` → `23:35:45.629Z` (5 events, ~4 min)

MEASURED (the critical finding): **both alarms did not exist yet on 2026-08-05.**
`describe-alarm-history` for both alarms over the full range 2026-08-01T00:00Z→2026-08-19T23:59Z
shows their `ConfigurationUpdate` "created" events on **2026-08-10**:
```
2026-08-10T04:47:45.344000+00:00  ConfigurationUpdate  Alarm "staging-catalog-cin7-poller-errors" created
2026-08-10T04:47:35.879000+00:00  ConfigurationUpdate  Alarm "staging-catalog-cin7-watermark-stale" created
```
So the targeted query over 2026-08-04T21:00Z–2026-08-06T12:00Z returned `"AlarmHistoryItems": []`
for both alarms — but this is **not** the "non-transition is itself a result" shape the ground
rules anticipated (that shape applies to a failing cycle never emitting
`Cin7PollerCycleComplete`). This is a harder gap: **there is no alarm to have transitioned.** The
5-day gap between the incident (08-05) and the alarms' creation (08-10) makes AC1 structurally
unable to close against this incident, full stop.

The alarm is correctly built and has since fired organically — `staging-catalog-cin7-watermark-stale`
is currently `ALARM` (since `2026-08-14T03:05:01.167Z`, "no datapoints were received for 8 periods")
— but per CLAUDE.md/AL6 that is the ordinary idle false-positive, not evidence of a genuine
credential-outage trip.

**What would close it:** a fresh, deliberately-forced credential outage (out of scope for a
read-only session and previously ruled out as unforceable without breaking the shared secret — see
Hard Constraint 6), or waiting for another organic blank-credential episode now that the alarm
exists. Neither has happened. **Flag, not filled: AC1 remains genuinely open.**

### AC2 — a single failed cycle raises no alarm; 3 consecutive poller errors do

**Verdict: SPLIT. Second half (AL2, single-failure-quiet) now PASS and properly evidenced. First
half (AL1+AL3, 3-consecutive-errors) still NOT RUN — and cannot be, yet.**

**Single-failure-quiet (AL2) — PASS, evidenced 2026-08-19.** The pinned 2026-08-13 sequence was
confirmed verbatim in `/aws/lambda/staging-catalog-cin7-cin7-item-poller`:
```
2026-08-13T04:01:50.610Z  {"metric":"Cin7PollerCycleStart","watermark":"2026-08-13T03:57:48.000Z"}
2026-08-13T04:02:15.612Z  ERROR {"metric":"Cin7PollerCycleFailed","message":"The operation was aborted due to timeout"}
2026-08-13T04:02:15.640Z  ERROR Invoke Error {"errorType":"TimeoutError","errorMessage":"The operation was aborted due to timeout",...}
2026-08-13T04:03:16.981Z  {"metric":"Cin7PollerCycleStart","watermark":"2026-08-13T03:57:48.000Z"}   <- same RequestId 35e911ab..., watermark unchanged
2026-08-13T04:03:20.750Z  {"metric":"Cin7PollerCycleComplete","newWatermark":"2026-08-13T04:03:08.000Z"}
```
`describe-alarm-history` for **both** alarms over `2026-08-13T03:00:00Z`–`2026-08-13T05:00:00Z`
(post-alarm-creation, so this window is real evidence):
- `staging-catalog-cin7-poller-errors`: **zero** `StateUpdate` entries — stayed `OK` throughout.
- `staging-catalog-cin7-watermark-stale`: **one** entry, `"Alarm updated from ALARM to OK"` at
  `2026-08-13T03:48:13.608Z` — **13 minutes before** the failure started (04:01:50Z), so it is
  unrelated to this episode (it's the alarm clearing from an earlier idle `ALARM`, not a reaction to
  it). Zero further transitions through 05:00Z — i.e. it stayed `OK` across the whole
  failure-and-recovery episode.

So the single `TimeoutError` demonstrably tripped neither alarm. **AL2 is now genuinely evidenced**,
not just "observationally PASS."

MEASURED, newly recorded: the three other isolated `TimeoutError` cycles on 2026-08-06 (never
previously written down):
```
2026-08-06T00:02:15.501Z
2026-08-06T03:02:17.129Z
2026-08-06T05:02:16.556Z
```
Alarm history for both alarms over 2026-08-06T00:00Z–23:59Z: both empty — but same caveat as AC1,
this is **before** the alarms existed (created 08-10), so it is not usable evidence either way.

**3-consecutive-errors half (AL1+AL3) — still NOT RUN, and currently untestable from history:**
MEASURED — `staging-catalog-cin7-poller-errors`' entire recorded history, full account, is exactly
two entries: created `2026-08-10T04:47:45.344Z`, then `INSUFFICIENT_DATA → OK` at
`2026-08-10T04:49:07.151Z`. **Zero further transitions through 2026-08-19.** The alarm has never
once left `OK` since it came into existence — meaning no 3-consecutive-poller-error episode has
recurred since 08-10 to test it against. This half remains unevidenced, not because the alarm is
wrong, but because nothing has happened to it yet.

### AC3 — dashboard shows fetched/emitted counts per cycle, watermark age, and 429 count, alongside per-company pipeline metrics

**Verdict: PASS — reviewed for the first time 2026-08-19. All four required series are wired.**

MEASURED via `aws cloudwatch get-dashboard --dashboard-name staging-catalog-manhattan-observability-dashboard`
(57 widgets total). All four AC3 series confirmed present and metric-backed, namespace
`staging-catalog-cin7`:

| Required series | Widget | Backing metric(s) |
|---|---|---|
| Products/options fetched per cycle | "Products fetched per cycle — primary vs. option-only trigger" / "Option rows fetched per cycle" | `Cin7ProductsFetchedPrimaryPerCycle`, `Cin7TriggeredProductsFetched`, `Cin7ProductOptionsFetched` |
| Records emitted per cycle | "Records emitted vs. skipped per cycle" | `Cin7RecordsEmittedPerCycle`, `Cin7RecordsSkippedPerCycle` |
| Watermark age | "Watermark age (ms)" | `Cin7WatermarkAgeMs` |
| 429 count | "429s (rate limited)" | `Cin7RateLimited` |

Per the ground rule (judge "is it wired," not "does it show data"): the 429 widget is present and
correctly wired, but will read zero — no 4xx of any kind has ever occurred in the poller's history;
this is expected, not a defect.

Per-company breakdown confirmed **log-level only**, exactly as documented: the dashboard's
"Defaulted fields" panels split by company via **metric-name suffix**
(`DefaultedField-weight-UNI` / `DefaultedField-weight-CTC`, etc. — 8 fields × 2 companies), not by
CloudWatch `Dimensions` — consistent with every sender metric carrying `Dimensions: []` (the
carried-over BUSY-1113 gap). Also confirmed present, beyond AC3's own four series: `Cin7InactiveSkip`,
`Cin7BlankItemCodeSkip`, `Cin7PageCapHit{Products,ProductOptions}`, a 7-day API-calls-per-day Logs
Insights widget, both send-side DLQ and enrich-side DLQ depth widgets, and a coalescing-ratio widget.

---

## 2. Exact replacement wording — for the QA DOC - BUSY-1117 AC table (page 1894088713)

Paste these three rows in place of the current AC1/AC2/AC3 rows. (AC4 is untouched — out of scope
for this session per the runsheet; it stays the known blocker on the SNS subscription / OQ-4.)

> ⚠ **Both rows below are now superseded — 2026-08-19, same day, by the concurrent forced-break
> session's live results.** Use the replacements immediately following instead of these two when
> pasting into the Confluence AC table.
>
> - **AC1 → PASS (MEASURED), flagged.** `watermark-stale` transitioned `OK`→`ALARM` at
>   `2026-08-19T08:14:49.319Z` on a genuine 8/8-breaching-period condition from a deliberately-forced
>   blank-secret + immediate cold-start test. Time-to-alarm from the last good cycle: **2h30m56s**,
>   ~31 min (~26%) over the "~2 hours" AC language — flagged for JJ's call on the literal wording, not
>   resolved here. Full evidence: `BUSY-1117-AC1-RERUN-RESULTS.md`.
> - **AC2 → PASS in full, AL1+AL3 now evidenced too.** The same forced-break session's
>   `staging-catalog-cin7-poller-errors` alarm transitioned `OK`→`ALARM` at `2026-08-19T05:53:32.119Z`,
>   reason `"Threshold Crossed: 3 datapoints [2.0 (05:50:00), 3.0 (05:47:00), 1.0 (05:44:00)] were
>   greater than the threshold (0.0)"` — a genuine 3-consecutive-error episode, exactly what AL1+AL3
>   needed and could not find organically (its entire prior recorded history was two entries with zero
>   transitions since creation). It also cleanly returned `ALARM`→`OK` at `09:51:32.119Z` on restore,
>   with no flapping in between. Combined with this session's AL2 result, **AC2 is now fully evidenced,
>   both halves.**

**Replacement wording:**

> | **AC1** — breaking the staging Cin7 credentials fires the watermark-staleness alarm within ~2 hours | **PASS (MEASURED), flagged (2026-08-19)** | A deliberately-forced blank-secret + immediate-cold-start test produced a genuine `staging-catalog-cin7-watermark-stale` `OK`→`ALARM` transition at `2026-08-19T08:14:49.319Z`, reason `"Threshold Crossed: no datapoints were received for 8 periods and 8 missing datapoints were treated as [Breaching]"` — the first live evidence for this AC (the one organic 2026-08-05 episode predates the alarm's own creation by 5 days and could never evidence it). Time-to-alarm from the last good `Cin7PollerCycleComplete` (`2026-08-19T05:43:53.242Z`) was **2h30m56s**, ~31 minutes (~26%) longer than the AC's "~2 hours" language — traced to a CloudWatch period-bucket alignment offset (measured), not a design or configuration gap. **Flagging the overshoot for a decision on the literal AC wording; the detection mechanism itself is proven correct.** Full trace: `BUSY-1117-AC1-RERUN-LOG.md` / `-RESULTS.md`. |
> | **AC2** — a single failed cycle raises no alarm; 3 consecutive poller errors do | **PASS, both halves evidenced (2026-08-19)** | **AL2 (single-failure-quiet):** as originally found this session — the pinned `2026-08-13` isolated `TimeoutError` cycle produced zero `poller-errors` transitions. **AL1+AL3 (3-consecutive-errors):** the same-day forced-break session supplied a genuine episode — `staging-catalog-cin7-poller-errors` transitioned `OK`→`ALARM` at `2026-08-19T05:53:32.119Z` on 3 consecutive breaching 180s periods (`2.0, 3.0, 1.0` errors, threshold `>0.0`), then cleanly `ALARM`→`OK` at `09:51:32.119Z` on restore with no flapping. |

**Original (now-superseded) rows, kept for reference:**

> | **AC1** — breaking the staging Cin7 credentials fires the watermark-staleness alarm within ~2 hours | **PARTIAL — confirmed unverifiable retrospectively (2026-08-19)** | The only real blank-credential episode (2026-08-05, 34 `Cin7PollerCycleFailed` = "Cin7 secret is missing required fields", in two clusters `03:28:50–03:56:57Z` and `23:31:50–23:35:45Z`) **predates the watermark-staleness alarm's existence by 5 days** — `staging-catalog-cin7-watermark-stale` was created `2026-08-10T04:47:35Z` (confirmed via `describe-alarm-history`, `ConfigurationUpdate`). No alarm history can exist for a period before the alarm was created, so this AC structurally cannot close against that incident. The alarm is correctly configured and has since fired organically from ordinary `UNSET` idle (currently `ALARM` since `2026-08-14T03:05:01Z`) — that is AL6's idle false-positive, not evidence of a genuine credential-outage trip. Closing AC1 needs either a fresh, deliberately-forced outage or another organic occurrence now that the alarm exists; neither has happened. |
> | **AC2** — a single failed cycle raises no alarm; 3 consecutive poller errors do | **SPLIT — AL2 (single-failure-quiet) now PASS and evidenced; AL1+AL3 (3-consecutive-errors) still NOT RUN** | **AL2: PASS.** The pinned 2026-08-13T04:01:50Z–04:03:20Z `TimeoutError` cycle (retried once, watermark held at `2026-08-13T03:57:48.000Z`) produced zero `staging-catalog-cin7-poller-errors` transitions and only one `staging-catalog-cin7-watermark-stale` transition (`ALARM→OK` at `03:48:13Z`, 13 minutes *before* the failure — unrelated to it), confirmed via `describe-alarm-history` for `2026-08-13T03:00–05:00Z`. Three further isolated `TimeoutError`s newly located on 2026-08-06 (`00:02:15.501Z`, `03:02:17.129Z`, `05:02:16.556Z`) predate alarm creation and can't be used as evidence. **AL1+AL3: still NOT RUN** — `staging-catalog-cin7-poller-errors`'s entire recorded history is exactly two entries (created `2026-08-10T04:47:45Z` → `OK` at `04:49:07Z`) with **zero transitions since**; it has never once left `OK`, meaning no 3-consecutive-failure episode has recurred to test it against. |
> | **AC3** — dashboard shows fetched/emitted counts per cycle, watermark age, and 429 count alongside per-company pipeline metrics | **PASS — reviewed 2026-08-19, all four series wired** | Pulled the dashboard body directly (`get-dashboard`, 57 widgets). All four confirmed present and metric-backed: products/options fetched per cycle (`Cin7ProductsFetchedPrimaryPerCycle`, `Cin7TriggeredProductsFetched`, `Cin7ProductOptionsFetched`), records emitted per cycle (`Cin7RecordsEmittedPerCycle`), watermark age (`Cin7WatermarkAgeMs`), 429 count (`Cin7RateLimited`). Per-company breakdown confirmed log-level only — split via metric-*name* suffix (e.g. `DefaultedField-weight-CTC`), not CloudWatch `Dimensions` (carried-over BUSY-1113 gap). The 429 widget is correctly wired but will read zero — no 4xx has ever occurred; expected, not a defect. |

---

## 3. Live figures measured (2026-08-19)

| Figure | Value | Source |
|---|---|---|
| Watermark | `UNSET`, **version 188**, `LastModifiedDate 2026-08-14T10:34:59+10:00` (`2026-08-14T00:34:59Z` UTC) | direct `ssm get-parameter` (not a script success message) |
| Buffer main queue (`...buffer.fifo`) | **0 visible / 0 in-flight** — clean idle | direct `sqs get-queue-attributes` |
| Buffer DLQ (`...buffer-dlq.fifo`) | **2 messages** (⚠ not 1 — see below) | direct `sqs get-queue-attributes`, confirmed by non-destructive peek (5s visibility timeout, no delete) |
| `staging-catalog-cin7-poller-errors` | `OK` | `check-status.sh` + `describe-alarms` |
| `staging-catalog-cin7-watermark-stale` | `ALARM` (since 2026-08-14T03:05:01Z, idle-caused) | `check-status.sh` + `describe-alarms` |
| `staging-catalog-manhattan-sender-validation-failures` | `OK` | `check-status.sh` |
| `staging-catalog-manhattan-send-dlq-depth` | `ALARM` (saturated, expected — threshold `depth>0`) | `check-status.sh` |

**DLQ depth correction:** the runsheet's V4 expected depth **1** (Plan D Run 1's poison,
`QA-D-T1-POISON-20260818T062710Z`). Live measurement is **2**. Peeked non-destructively (received
with 5s visibility timeout, did not delete) and identified both messages, bodies byte-for-byte intact:

```
1. MessageId a6f1e6b2-...  Sent 2026-08-18T06:27:30.724Z  MessageGroupId CTC#QA-D-T1-POISON-20260818T062710Z
2. MessageId 90530fb7-...  Sent 2026-08-18T07:08:16.706Z  MessageGroupId CTC#QA-D-R2-POISON-20260818T070751Z
```
The second message is Plan D **Run 2**'s poison (cross-tenant test, also run 2026-08-18) — the
runsheet's V4 note only accounted for Run 1's poison when it said "depth: 1." Not a defect, just a
number to correct in the docs. Both will age out on the same 4-day DLQ retention (~22 Aug).

`check-status.sh`'s two 2026-08-18 fixes are confirmed live: none of
`staging-catalog-cin7-poller-errors` / `staging-catalog-cin7-watermark-stale` /
`staging-catalog-manhattan-sender-validation-failures` report `NOT FOUND`. **AL7: FIXED-and-verified.**

---

## 4. Optional checks (V5, V6) — done, time allowed

**V5 — whitespace-transform upgrade attempt: still INFERRED, not MEASURED.** Searched the full
available poller log retention for the 13 target codes/fragments. Note: the runsheet's suggested
start date (2026-07-01) predates the log group's own existence
(`/aws/lambda/staging-catalog-cin7-cin7-item-poller` starts 2026-08-04T21:01:50Z per CLAUDE.md) —
so the real search window was 2026-08-04T21:00Z→2026-08-19T23:59Z, all that's available.

- Direct search on the base fragments (`WORSMU22`, `WOR121`, `WSMU22`, `NUSMU23-101A`, `WAYTCGML`,
  `WAYTCSML`): **0 matches**, 63,753 records / 33.3MB scanned, query status `Complete` (exhaustive,
  not truncated).
- Broader search on the shorter distinctive fragments (`171A`, `167BM`, `MTEST`, `WTEST`, `Knife`,
  `701I`, `702B`, `703H`, `107B`, `201F`, `174F`) returned 87 raw hits, but **all are false-positive
  substring collisions** with unrelated real product codes — e.g. `PDTC25-201F-XS/S/M/L/XL/XXL` and
  `WTH26-107B-*` / `WPW26-107B-*` are genuine, unrelated size-suffixed codes that happen to contain
  `201F` / `107B` as substrings. **Zero genuine hits for any of the 13 target codes.**

Per the ground rule: **absence of hits here proves nothing in either direction** — these are
older, low-churn products and the search window only covers the poller's own ~15-day retained
history, not the full account timeline the 13 codes were drawn from. The
`{company}#re.sub(r"\s+","_",code)` transform **remains INFERRED**. Did not spend Cin7 budget
trying to force one of these into a window.

**V6 — ERR4/AL8 near-miss datapoint: reconfirmed.** `get-metric-statistics` for
`SenderValidationFailures` (namespace `staging-catalog-manhattan`), 2026-08-13T04:00–05:30Z,
period 900s, statistic Sum:
```
04:00Z  Sum 64.0
04:15Z  Sum 93.0
04:30Z  Sum 55.0
04:45Z  Sum  9.0   <- the near-miss
```
Confirms exactly one 900s bucket in this window at `Sum = 9`, matching the documented
"near-miss of 9 against a threshold of 10." ⚠ Minor nuance: this API labels the bucket
`2026-08-13T04:45:00Z` (bucket start), while CLAUDE.md/the doc quote `2026-08-13T04:43:00Z` — likely
the alarm's own internal evaluation-window timestamp rather than this bucket-statistics label. The
substance is unaffected: there is exactly one near-miss datapoint (value 9) in this window, and no
other bucket comes close to the threshold. Confirms `staging-catalog-manhattan-sender-validation-failures`
is live and correctly wired — supports AL8's withdrawal (already applied; not part of this
session's AC scope, cited here only as corroboration).

---

## 5. Flagged — could not substantiate (not filled in)

- **AC1 cannot be closed from any existing data.** The one organic incident that could evidence it
  predates the alarm by 5 days. Nothing observed this session changes that; it needs either a new
  forced test (not permitted read-only, and previously ruled unforceable without breaking the
  shared secret) or a fresh organic occurrence.
- **AC2's 3-consecutive-errors half (AL1+AL3) is still untested.** `poller-errors` has never left
  `OK` since it was created — there is no episode in its lifetime to check it against. This is not
  a data-gap on my part; the alarm genuinely has no ALARM history to read.
- **V5's whitespace-transform mechanism stays INFERRED.** A negative result over a ~15-day window
  cannot rule it in or out for 13 low-churn products drawn from a much longer account history.
- **The 2026-08-13T04:43:00Z vs. 04:45:00Z timestamp discrepancy in V6** is unresolved — could be a
  labeling convention difference between alarm-internal evaluation and `get-metric-statistics`
  bucketing. Not chased further; doesn't change the substantive finding.

