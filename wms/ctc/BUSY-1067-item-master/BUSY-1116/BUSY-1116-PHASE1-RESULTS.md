# BUSY-1116 Phase 1 Results — OV4–OV6 + read-only extraction edges

**Date:** 2026-08-13 · **Author:** Claude (QA forensics session) · **Scope:** Phase 1 of `BUSY-1116-RETEST-PLAN.md` Rev 2 only. Read-only against AWS. **Real (read-only) Cin7 API calls made** — this phase spends real, bounded Cin7 budget; see §3 for the full tally. No watermark writes (`cin7-watermark.sh` was never invoked; the one `ssm get-parameter` read at the end is read-only and confirms `UNSET`, unchanged since Phase 0). No AWS config changes. No Cin7 writes. No DLQ purge.

**Method note (same convention as Phase 0):** every claim is tagged **MEASURED** (a literal log line, a direct Cin7/AWS API response, cited with source), **INFERRED** (a conclusion drawn from measured facts, reasoning stated), or **UNKNOWN**. Read Phase 0 (`BUSY-1116-PHASE0-RESULTS.md`) first — this file assumes its OV1–OV3 findings and deploy-state table.

---

## 0. Window choice for OV4/OV5 — the tradeoff, stated up front

Phase 0's OV1–OV3 evidence comes from the **only** population of logs that carries the literal `Cin7ApiCallMade` where-clause (the metric didn't exist in the code before the 2026-08-12T22:45:44Z redeploy): 15 completed cycles + 1 failed cycle, wall-clock **2026-08-13 03:46:50Z–04:28:52Z**, with a watermark chain running from **02:38:00.000Z** (the floor of the first, backlog-clearing cycle) through **04:28:45.000Z** (the last cycle's `newWatermark`).

The plan asks for a reconciliation window **≥24h old** to be "settled." That is not available: only post-redeploy logs are representative of the *currently deployed* code's actual query behaviour, and the entire post-redeploy population is under 5 hours old at the time this phase ran (session start ≈2026-08-13T06:58Z real wall clock, i.e. ~2.5h after the window's own end).

**Decision:** use the **entire** available post-redeploy population as window **W**, bounded exactly by the evidence already in hand — `W = [2026-08-13T02:38:00.000Z, 2026-08-13T04:28:45.000Z]` (110.75 minutes of Cin7 `modifiedDate` span; this is also exactly the span the real poller cycles queried and advanced across in Phase 0). This is the best available trade-off: fully covered by post-redeploy logs (representative of deployed code), and as old/settled as this constraint allows (~2.5–4.5h by the time each sub-analysis ran, not 24h).

**This trade-off had a measurable consequence, discovered while doing OV4 (see §1.3): at this environment's real churn rate, a window only 2.5–4.5 hours old already showed ~67% of its own real emissions "eroded" (re-modified again before this session's re-query could see their original state). A genuine 24h-old window, if post-redeploy logs existed for one, would likely have shown far more erosion under the same churn regime — this is INFERRED, not tested, but the measured 67% at 2.5–4.5h makes it a reasonable expectation. This is worth carrying forward: "pick a settled 24h+ window" and "only post-redeploy logs are trustworthy" are in real tension in a high-churn environment, and this session hit that tension directly rather than avoiding it.**

---

## 1. OV4 — Reconciliation sweep: Cin7 truth set vs poller emit set

### 1.1 Method

**Emit set (MEASURED, from CloudWatch Logs, zero additional Cin7 cost):** pulled the full raw log event set for `/aws/lambda/staging-catalog-cin7-cin7-item-poller` across `2026-08-13T03:46:00Z`–`04:30:00Z` (3,796 events, paginated via `filter-log-events`), parsed every `Cin7PollerCycleStart` / `Cin7RecordEmitted` / `Cin7PollerCycleComplete` / `Cin7InactiveSkip` line, and reconstructed all 15 cycles' emitted-`item_code` lists. Cross-check: every reconstructed per-cycle count matched the cycle's own logged `recordsEmitted` figure exactly (e.g. cycle at 03:46:50 → 1,764 reconstructed = 1,764 logged), confirming the reconstruction is complete and accurate. **Total: 3,257 `Cin7RecordEmitted` events, 2,282 distinct `item_code`s** across the 15 cycles (duplicates are the boundary re-emissions Phase 0's OV2 already explained).

**Truth set (MEASURED, direct Cin7 GETs, real budget spent — see §3):** `preview-cin7-sync.sh --since 2026-08-13T02:38:00.000Z` mirrors the poller's real query logic exactly but has no upper bound — it fetches everything from `--since` to **actual real "now"**, not to W's end. Two runs were made (see §3 for why — a research note, not a recommendation to repeat): the first with the unmodified script; the second with a QA-only working copy (`/private/tmp/.../scratchpad/phase1/preview-with-raw.sh`, **not** a change to the checked-in script — same GET-only calls, same URLs, same credentials — it only persists the temp working directory and additionally reads the option-level `modifiedDate` field that the original script's final report doesn't surface) so the option's own `modifiedDate` — not just the parent product's — could be pulled directly from Cin7's own `/ProductOptions` response, keyed by `(productId, code)`.

Both runs hit the script's own `--max-pages 20` cap on `/ProductOptions` (5,000 rows fetched, spanning `modifiedDate` 02:40:32Z–06:30:11Z) before reaching true "now" — **this had zero effect on W's coverage**, because W ends at 04:28:45Z, which falls entirely inside page 3/4 of the 20 fetched (see the per-page min/max table below); the cap was reached far past W, fetching unrelated later data that was simply discarded by the W-filter, not truncating anything inside W.

```
options-page-1.json  n=250  min=2026-08-13T02:40:32Z  max=2026-08-13T03:22:36Z
options-page-2.json  n=250  min=2026-08-13T03:22:36Z  max=2026-08-13T03:24:52Z
options-page-3.json  n=250  min=2026-08-13T03:24:52Z  max=2026-08-13T04:28:11Z
options-page-4.json  n=250  min=2026-08-13T04:28:11Z  max=2026-08-13T05:00:10Z   <- W_end (04:28:45) falls here
options-page-5..20   ...    (all later than W_end — irrelevant to this window, discarded by filter)
```

**Truth-set construction logic (matches the real poller's actual behaviour, not a naive per-row filter):** the real poller, once a product is triggered by *any one* eligible option's `modifiedDate ≥ floor`, does a **full product re-read** and emits **every** eligible option of that product — regardless of each individual option's own `modifiedDate`. So the correct truth set for W is: (a) find every **qualifying productId** — one whose */ProductOptions* raw row has `modifiedDate` in `[W_start, W_end]` (114 distinct productIds found); (b) take **every** eligible (`Product.status=Public` and `ProductOption.status=Primary`) option of those qualifying products from the full-product-read data already fetched (763 distinct `item_code`s). One further skip (`productId 21757`, `Non Inventory`, `productStatus=Internal`) is a qualifying product with zero eligible options — see §1.4.

### 1.2 Diff

```
Emit-set (real poller, 15 cycles, distinct item_codes):      2,282
Truth-set-for-W (erosion-free, option modifiedDate confirmed
  still inside W on live re-query, 114 qualifying products):    763
Truth-set members ALSO found in the emit-set:                   763
Truth-set members ABSENT from the emit-set:                       0
```

**MEASURED: 0 unexplained misses. Miss rate = 0/763 = 0.0% on the erosion-free sample.**

### 1.3 The erosion finding (important caveat on what "763" represents)

763 is **not** an estimate of W's full true population — it is only the subset of that population whose option-level `modifiedDate`, re-read live 2.5–4.5 hours after the fact, **still** falls inside `[W_start, W_end]`. Cross-checking against the full emit-set: of the **2,282** distinct items the real poller actually emitted during W, only **763 (33.4%)** still show a current `modifiedDate` inside W on re-query; the other **1,519 (66.6%)** have already been modified again in the intervening 2.5–4.5 hours, so their current state can no longer be used to verify their original W-eligibility. **This is not evidence of a miss** — these 1,519 are already confirmed present in the real emit-set (the poller demonstrably emitted them at the time); it is a **methodological ceiling**: at this environment's measured churn rate, a live-requery reconciliation method has a shelf life of a few hours before most of its own evidence self-destructs. **MEASURED** (both the 2,282 and 763 counts are direct); the implication for a 24h-old window is **INFERRED** (§0).

### 1.4 Classification of the one non-emitted, truth-set-adjacent item

| item | productId | classification | evidence |
|---|---|---|---|
| `Non Inventory` | 21757 | **expected-ineligible** (`Cin7InactiveSkip`) | `productStatus=Internal`, `optionStatus=Active` (not `Primary`) — fails **both** halves of Kian's runbook's eligibility rule. **Independently corroborated by a real log line from the actual 15 cycles**: `{"metric":"Cin7InactiveSkip","productId":21757,"optionCode":"Non Inventory","productStatus":"Internal","optionStatus":"Active"}` — the same product, same reason, logged live during the real window. |

No page-cap-clamp cases found in W (page cap was hit, but only far past W — §1.1). No `UNEXPLAINED` cases.

### 1.5 OV4 verdict

**MEASURED. 0/763 unexplained misses (0.0%) on an erosion-free sample covering 114 qualifying products / 763 eligible item_codes.** The plan's own caution applies directly: **this is a clean sample, not proof of safety** — it covers only the third of the window's real activity that happened to survive un-re-edited long enough for this session to check it. Pair with OV5.

---

## 2. OV5 — Write lag / clock skew sizing

### 2.1 Method and a methodology correction made mid-analysis

For each of the 763 erosion-free truth-set items, computed `(poller read time) − (record's own triggering-option modifiedDate)`. "Poller read time" = the **start timestamp of the specific cycle whose `[floor, newWatermark]` interval actually contains that item's `modifiedDate`** — not just "any cycle that ever emitted this item_code again." That correction mattered: item_codes are **not** guaranteed to appear only in one cycle or in immediately-consecutive cycles — several were emitted, at different points, across multiple **non-consecutive** cycles because the underlying option was **genuinely edited more than once** during the observation window (each edit independently satisfying a later cycle's floor). A naive "match to the earliest cycle mentioning this item_code" approach produces spurious large negative lags (down to **−10,499s** in one case) that are artefacts of comparing a *later* real edit's `modifiedDate` against an *earlier* cycle's read time for the *same* item_code — not evidence of clock skew. After correcting to "the cycle whose advance-window actually contains this exact `modifiedDate` value" (unique fit found for all 763, zero unresolved), the negative values disappeared entirely.

**This correction itself is a real finding, not just a bookkeeping fix: it demonstrates directly that under real churn, the same `item_code` can be legitimately re-emitted multiple times across non-adjacent cycles as it keeps getting edited — a live, empirical instance of exactly the "repeated modification" scenario the whole overlap/miss question is about, just not a miss in this instance because each edit was individually caught.**

### 2.2 Results (MEASURED, 763 samples, all uniquely resolved)

```
min:    +19.681 s   (item PH26-215E-* [6 sizes], productId 48266;
                     modifiedDate 2026-08-13T04:10:31.000Z;
                     poller cycle started 2026-08-13T04:10:50.681Z)
max:  +3978.358 s   (~66 min; item DTC24-101F-* [6 sizes], productId 36730;
                     modifiedDate 2026-08-13T02:40:32.000Z, caught by the FIRST,
                     backlog-clearing cycle that started at 03:46:50 — this is
                     "poller-was-idle" catch-up lag, not per-record Cin7 write lag;
                     the watermark had presumably been UNSET/idle before this
                     session's window began)
median: +1318.358 s
mean:   +1258.4 s (dominated by the same first heavy cycle's backlog — not
                   representative of steady-state, single-cycle behaviour)
Negative-lag count: 0 / 763
```

**MEASURED headline: minimum lag is +19.681 seconds, positive, well under the ~180s poll cadence. Zero negative values in 763 correctly-matched samples.**

### 2.3 Clock skew check

One direct Cin7 GET (`/api/v1/Products?rows=1&page=1`), comparing the response's `date` header against local UTC wall-clock immediately before/after the call:

```
local before: 2026-08-13T07:12:55Z
local after:  2026-08-13T07:12:55Z
Cin7 response header: date: Thu, 13 Aug 2026 07:12:55 GMT
Cin7 x-azure-ref:      20260813T071255Z-...
```

**MEASURED: exact match, 0s skew at 1-second header resolution.** Caveat: this compares Cin7's clock against the **local shell's** wall clock, not literally the poller Lambda's own clock — but every OV1 watermark/`Cin7ApiCallMade` timestamp used throughout Phase 0 and this phase comes from CloudWatch's own authoritative ingestion clock, and those values align with the logged watermark literals with zero drift across 15 cycles, so there is no independent reason to suspect AWS-vs-Cin7 skew beyond what this single direct check already shows. **Flagged: proxy measurement, not a literal same-process comparison — MEASURED for what it checked, INFERRED for "the poller Lambda's own clock specifically."**

### 2.4 What this measurement can and cannot rule out

This measures "time from the value stamped as `modifiedDate` to when the poller could read it" — it is blind to the one scenario the plan explicitly flags as unanswerable from our side: **if Cin7 stamps `modifiedDate` at transaction *start* rather than at *commit*,** a record could sit invisible to the API for a real interval *after* its timestamp is already fixed. Such a record would show up in our data either (a) with a large-but-still-positive lag indistinguishable from the idle-catchup pattern already seen in the max/mean above, or (b) not at all if the watermark had already advanced past its stamped value before it became queryable — which is exactly what OV4 is designed to catch, and OV4 found zero such cases in its (erosion-limited) clean sample. **This distinction is UNKNOWN from our side** — it is the same open question to Kian/dev the plan already names, and this phase's evidence neither confirms nor rules it out; it only shows no *measured* instance of it up to the resolution this method allows.

### 2.5 OV5 verdict

**MEASURED: minimum lag +19.681s, zero negative values, clock skew ≈0 (single direct check).** No evidence of real problematic write lag or clock skew at the resolution this method can see. The commit-vs-transaction-start stamping question remains genuinely open and is not something this phase (or any read-only QA pass) can settle.

---

## 3. OV6 — Verdict, document correction, decision-rule application

### 3.1 The measured statement (for the QA doc, the index page, and the ticket)

> **The currently deployed CTC item poller (build `2026-08-12T22:45:44Z`) queries Cin7 from the watermark's exact literal value, inclusive (`>=`), identically for `/Products` and `/ProductOptions`, with zero measured cycle-to-cycle variance across 15 real cycles (Phase 0, MEASURED). Timestamp granularity is whole seconds. The boundary record at the watermark's exact value is re-fetched and re-emitted in full whenever the watermark doesn't advance past it (two clean 20/20 and 8/8 cases, Phase 0, MEASURED) — downstream coalescing absorbs this, consistent with idempotent convergence (TC4). Out-of-order arrival at the cycle level was checked across all 15 cycles and never occurred (Phase 0 OV3, MEASURED) — no cycle's floor ever regressed or skipped ahead. A direct reconciliation sweep against Cin7 (this phase, OV4) found 0 unexplained misses out of 763 eligible records checkable without churn-erosion ambiguity (0.0% miss rate on that sample — NOT a full-window audit; ~67% of the window's other real emissions had already been re-edited again by the time of the recheck and could not be independently verified). Measured write-visibility lag (this phase, OV5) has a minimum of +19.7 seconds and zero negative values across 763 samples, well inside the poller's own ~3-minute cadence; clock skew between Cin7 and the local check clock was ≈0. Whether Cin7 stamps `modifiedDate` at transaction start or commit remains unknown and is not answerable from the consumer side.**

### 3.2 Which document is wrong

**LLD §3.4's "watermark − 5 minutes" is wrong for the currently deployed poller.** Kian's runbook ("no overlap window") is correct.

**Suggested correction text** (for LLD §3.4, replacing the "watermark − 5 minutes" bullet):

> The poller queries both `/Products` and `/ProductOptions` using `modifiedDate >= <watermark>` — the exact watermark value, with **no buffer subtracted** for clock skew or write lag. The comparison is inclusive; a record whose `modifiedDate` equals the current watermark will be re-fetched (and re-emitted) on the next cycle if the watermark has not yet advanced past it, and is absorbed by downstream coalescing. This has been directly verified against live production logs (BUSY-1116 Phase 0/1, 2026-08-13): 15 consecutive cycles showed a literal, character-for-character match between the watermark and the query floor, with zero variance. A reconciliation sweep against a live Cin7 window found no unexplained misses in the checkable (erosion-free) sample, and measured write-visibility lag had a minimum of +19.7 seconds with no negative values observed — i.e. no measured case of Cin7 exposing a record's `modifiedDate` change to the API *after* the value had already been superseded by a later watermark advance. This does not prove the absence of a miss window under all conditions (see BUSY-1116 Phase 1 §2.4) — Cin7's `modifiedDate` stamping semantics (transaction-start vs commit) are not observable from the consumer side.

### 3.3 Decision-rule application (per the plan's own §3 rule)

> *"if OV1 confirms no overlap AND OV3 or OV5 show real out-of-order arrival or write lag, that is a design defect regardless of what OV4's sampled window shows."*

- **OV1: no overlap confirmed.** Yes (Phase 0, MEASURED).
- **OV3: real out-of-order arrival?** Checked at the only granularity available (cycle-level watermark chain, 15 cycles) — **zero cases found** (Phase 0, MEASURED at that granularity; record-level out-of-order arrival is a different, finer-grained question OV3 explicitly could not answer on its own and deferred to OV4/OV5).
- **OV5: real write lag?** **Zero negative-lag cases**; minimum positive lag +19.7s, comfortably inside a single ~180s poll cycle. No measured case of lag large enough, or in the wrong direction, to have caused (or to plausibly cause) a record to be skipped by a subsequent watermark advance.

**The trigger condition is NOT met on the evidence gathered.** Per the plan's own rule, this means: **state plainly that the risk is accepted on current evidence, not escalate to a defect.** This is explicitly **not** the same as "proven safe" — §2.4 states the specific blind spot (transaction-start vs commit stamping) that this phase's method cannot rule out, and §1.3 states that OV4's clean sample covers only a third of the window's real activity due to churn erosion. **No defect writeup is drafted for this phase's evidence.** If a future phase (or a lower-churn/quieter window, or dev's answer on Cin7's stamping semantics) produces a negative lag value, an out-of-order cycle, or an unexplained OV4 miss, that changes this conclusion immediately per the same rule — this is a **conditional, evidence-bound accept**, not a closed question.

**Carry forward to Kian/dev, verbatim per the plan:** does Cin7 stamp `modifiedDate` at transaction start or at commit? This is the one input this QA pass structurally cannot obtain, and it bounds how much confidence OV5's positive-lag-only result can carry.

---

## 4. Read-only extraction-edge cases (plan §6 table)

### PW1 — Watermark boundary
**Verdict: N/A (traceability pointer only), per the plan.** Fully subsumed by OV1 (exact-floor proof), OV2 (boundary re-emission proof), and OV4 (this phase's reconciliation). No separate test run.

### PW2 — Overlap re-emit
**Verdict: N/A as originally written — restated, not upgraded to PASS.** OV1 (Phase 0, MEASURED) confirms there is no overlap window at all, so "duplicates from an overlap buffer, then coalesced" cannot happen — there is no buffer to produce them. What **does** happen and **was directly observed** (Phase 0 OV2, and again implicitly in this phase's OV5 dataset) is duplication from the **inclusive `>=` floor re-covering the exact boundary value** when the watermark doesn't advance past it, absorbed by downstream coalescing (TC4, out of this phase's scope). Convergence rests on that mechanism plus TC4, not on a 5-minute overlap. **MEASURED** (via OV1/OV2), stated per the plan's explicit instruction not to mark this PASS by loose association.

### PW3 — Pagination boundary (250/251 rows)
**Verdict: PASS. MEASURED, fresh live evidence.** Both preview runs this session paged `/ProductOptions` straight through the 250-row boundary with no truncation: pages 1–20 each returned exactly 250 rows (`"Fetched /ProductOptions page N: 250 row(s)"`, N=1..20) before the script's own `--max-pages 20` cap was hit — the stop condition never fired from "page returned <250 rows," it fired from the explicit page cap, confirming the pagination loop itself does not truncate at a 250-row page. Corroborates Phase 0's historical finding (highest real cycle: 8 pages / 1,764 records, no truncation).

### PW4 — Trigger id-chunking / where-clause 404 risk
**Verdict: PASS. MEASURED, fresh live evidence.** This session's own truth-set fetch triggered **696–700 distinct productIds** referenced only via `/ProductOptions` (comfortably >100), chunked into 7 batches: `100, 100, 100, 100, 100, 100, 95–96`. **Zero 4xx/404 responses** across all 7 chunk fetches (all returned HTTP 200, confirmed by the script's own fail-fast `cin7_get` which would have aborted the whole run on a non-200). Corroborates Phase 0's historical zero-404 finding (17 chunk calls across ~41 days) with a fresh, larger (700-id) live sample.

### PW5 — Option status filtering
**Verdict: PASS. MEASURED, live evidence.** Confirmed Kian's runbook rule directly from this session's own preview output — the "Would SKIP" list contains concrete disqualifying examples for every documented reason:
- `productStatus=Internal`, `optionStatus=Active` (productId 21757, "Non Inventory") — fails on **product** status, independently corroborated by a real `Cin7InactiveSkip` log line from the actual poller (§1.4).
- `productStatus=Public`, `optionStatus=Disabled` (productIds 6202–6205, "TEST1"–"TEST4") — fails on **option** status alone.
- `productStatus=Public`, `optionStatus=Active` (not `Primary`) (productId 45827, "Checkmate Shirred Mini Dress") — fails on option status even though `Active` sounds eligible; only `Primary` counts.

### PW7 — Product with zero eligible options
**Verdict: PASS. MEASURED, 4 live examples, cycle completed cleanly regardless.** ProductIds 6202 (1 option, Disabled), 6203/6204/6205 (4 options each, all Disabled) each contributed **zero** emitted records — 100% of their options skipped — while the same single preview run still successfully emitted 4,979 records from other qualifying products. This directly confirms a product with zero eligible options does not break or short-circuit the cycle.

### PW9 — UTC / DST boundary
**Verdict: PASS. MEASURED, via combination of existing evidence — no separate live injection needed.** Two independent facts jointly settle this: (1) Phase 0's OV1 showed the literal watermark string and the literal query floor string are **character-for-character identical** across all 15 real cycles — there is no date-parsing or timezone-conversion step anywhere between reading the watermark and building the query, so no code path exists where a UTC value could be silently reinterpreted as local time; (2) this phase's §2.3 clock-skew check shows Cin7's own server clock and the local UTC wall-clock agree exactly (07:12:55 both). Between them: no transformation step exists to introduce a timezone bug, and the two clocks in play agree. **The "trap" the case describes (a correctly-formatted-but-wrong-timezone value) is a human/procedural risk when a watermark is set by hand, not a code defect** — `cin7-watermark.sh`'s own UTC-format enforcement (CLAUDE.md hard constraint #3) is the actual mitigation for that, not something this phase re-tests. No additional live `--since` probe was run for this case since the existing evidence already answers it without further Cin7 spend.

### ERR3 — DLQ baseline
**Verdict: DONE. MEASURED, read-only peek, zero purge.** `check-status.sh` confirms depth unchanged at **18 waiting / 0 in-flight** (identical to Phase 0's measurement — no drift, no new arrivals since). Peeked all 18 messages via `aws sqs receive-message` with a short (5s) `--visibility-timeout` (messages return to the queue automatically; nothing deleted, nothing purged) across 3 batches, de-duplicated by `MessageId`. **All 18 are identifiable, pre-existing QA-injected evidence records from documented prior sessions**, not new/unexplained arrivals:

| Age (SentTimestamp) | Group / item_code shape | Matches documented session |
|---|---|---|
| 2026-08-10 05:35–05:45 | `CTC#` (blank item_code), `QA-ERR2-BLANKDESC`, `QA-ERR4-BADWEIGHT` | CS5/ERR5 + ERR2/ERR4 crash-and-bisect tests, 08-10 |
| 2026-08-11 00:48 | `CTC#` (blank item_code) | CS5-ERR5 retest, 08-11 |
| 2026-08-13 00:16–00:37 | `QA-D0-SIZE200/100/50`, `QA-D0-ITEM100/75` (synthetic long strings) | CTC-FIX-RETEST / boundary-length tests, earlier today |
| 2026-08-13 03:59–04:24 | `QA-B2-SIZE37/31/28/26`, synthetic long `S`-strings | Same-day boundary-length tests, Group B — falls **inside** this phase's own OV window |

No message body resembles a genuine, unexplained production record. **Zero new arrivals since Phase 0's measurement.**

### ERR4 — Validation-failure alarm gap
**Verdict: SETTLED READ-ONLY — corrects Phase 0's flag, and corrects CLAUDE.md's documented gap.** Phase 0 found a new alarm, `staging-catalog-cin7-validation-failures`, and flagged its coverage as unconfirmed, suggesting a live-fire test might be needed. This phase settled it two ways, both read-only:

1. **`describe-metric-filters` on the poller's own log group** shows `staging-catalog-cin7-validation-failures` watches `ManhattanValidationFailure` in namespace `staging-catalog-cin7`, fed by a metric filter **on the poller's own log group** (`{ $.metric = "ManhattanValidationFailure" }`) — this is a **poller-side** signal, unrelated to the sender's validation checks. **Confirms Phase 0's suspicion: this alarm does not watch sender/CTC-item validation failures at all.**
2. **However — a full `describe-alarms` sweep across every alarm mentioning "validat" found a fourth alarm Phase 0 missed entirely: `staging-catalog-manhattan-sender-validation-failures`.** This one **does** watch the correct metric — `SenderValidationFailures` in namespace `staging-catalog-manhattan` (the metric CLAUDE.md documents as the one CTC failures land in, since it carries `Dimensions: []` and there is no `-ctc` variant). Full detail:
   ```
   AlarmName: staging-catalog-manhattan-sender-validation-failures
   MetricName: SenderValidationFailures / Namespace: staging-catalog-manhattan
   Threshold: >10 in a 900s (15 min) period — matches CLAUDE.md's documented "11 in 15 min" bar
   AlarmActions: arn:...:staging-catalog-manhattan-observability-alerts (the zero-subscriber topic)
   ConfigurationUpdated: 2026-08-10T04:51:19Z (existed before this session, before Phase 0 even)
   Current state: OK, but with a REAL recent near-miss datapoint:
     "recentDatapoints":[9.0] at 2026-08-13T04:43:00Z, threshold 10.0 — 1 short of firing,
     just after this phase's OV window (04:28:45Z)
   ```
   **This directly contradicts CLAUDE.md's documented defect ("No alarm watches CTC's own validation failures... alerts no one") and Phase 0's characterization ("no CTC/generic validation-failure alarm").** The alarm exists, is correctly configured, targets the right metric, and was actively close to firing for real just outside this session's window. **The real remaining gap is unchanged and separate: the alarm's target topic has zero SNS subscribers (Phase 0, confirmed again not touched this phase), so even a real fire notifies no one.** That is a notification-plumbing gap, not a missing-alarm gap — the two should not be conflated in the writeup.
3. **Root cause of the miss:** `check-status.sh` only checks a **hardcoded** alarm list (`grep` of the script confirms it checks `${STAGE}-catalog-manhattan-${s}-validation-failures` per store, `send-dlq-depth`, and the two `cin7-*` poller alarms) — it never checks `staging-catalog-manhattan-sender-validation-failures` at all. **This is a tooling gap in `check-status.sh`, distinct from the already-known double-`cin7-cin7-` naming bug** — worth a one-line fix (add this alarm name to the script's list) alongside that other fix.

**Net correction to carry into sign-off: BUSY-1117's "no alarm watches CTC validation failures" finding is WRONG as stated — an alarm does exist and is correctly wired to the right metric. The real, still-open gap is narrower: zero SNS subscribers on the alert topic, which was already known and unrelated to this specific claim.**

---

## 5. Cin7 API call tally (this session)

| Action | Requests |
|---|---|
| Preview run #1 (`--since 2026-08-13T02:38:00.000Z`, unmodified script, initial truth-set attempt) | 1 (`/Products` p1) + 20 (`/ProductOptions` p1–20) + 7 (triggered id-chunks) = **28** |
| Preview run #2 (same `--since`, QA research copy that also persists raw option-level `modifiedDate` — needed because run #1's report only surfaces product-level `modifiedDate`) | **28** (identical shape) |
| Single direct GET for the clock-skew header check (§2.3) | **1** |
| **Total this phase** | **≈57 requests** |

**Against the 5,000/day shared cap: ≈1.1%.** Low, as the plan expected for this phase.

**Self-flagged process note:** the plan's guardrail says "don't re-run [preview] repeatedly for the same window." This phase ran the **same** `--since` value twice (run #1 was rendered insufficient for OV5 only after inspecting its output — it doesn't expose per-option `modifiedDate`, only per-product). In hindsight the raw-data-capturing copy should have been the *first* call, avoiding the duplicate spend. The actual cost impact was small (28 extra requests, ~0.6% of the daily cap) but the guardrail was not followed to the letter — noted here rather than glossed over.

No `cin7-watermark.sh --set`/`--confirm`/`--unset` calls were made. No AWS resource configuration was changed. Watermark confirmed still `UNSET`, `LastModifiedDate` unchanged from Phase 0's own reading (`2026-08-13T14:28:54+10:00` = `04:28:54Z`) — untouched this session.

---

## 6. What Phase 2 needs to pick up

1. **PW10 is still blocked as Phase 0 already flagged** — there is no `MAX_PAGES_PER_RUN` env var on the deployed poller Lambda (confirmed again not to exist; this phase did not re-check env vars, deferring to Phase 0's direct `get-function-configuration` read). Phase 2 needs a different mechanism to force a page-cap hit, or to treat PW10 as blocked and say so, before spending any watermark budget on it.
2. **Churn-driven evidence erosion is real and fast — plan accordingly.** This phase measured ~67% of a window's own emissions "erode" (get re-modified again) within 2.5–4.5 hours. Any Phase 2/3 test that wants to correlate a specific record's before/after state (e.g. TC6's "capture SCALE state for 3–5 named items before and after") should capture **both** the Cin7-side and SCALE-side state as close to the actual test action as possible — waiting even a couple of hours materially degrades the ability to reconstruct what a record looked like at test time.
3. **`staging-catalog-manhattan-sender-validation-failures` alarm exists, is correctly configured, and had a near-miss datapoint (9/10) just after this phase's window (2026-08-13T04:43Z).** Worth a quick look at what caused that spike (it's close enough in time to be checked cheaply from already-retained logs) before Phase 2/3 assume the CTC pipeline was quiet in that gap.
4. **`check-status.sh` has two separate naming/coverage bugs**, not one: the already-known double-`cin7-cin7-` typo (Phase 0), and now this phase's finding that it never checks `staging-catalog-manhattan-sender-validation-failures` at all. Both are one-line fixes; worth doing before relying on the script's alarm summary again.
5. **DLQ is inventoried and clean** — all 18 messages are confirmed pre-existing QA evidence from named prior sessions (08-10, 08-11, 08-13 earlier today), zero new/unexplained arrivals. Phase 3's "purge only new arrivals" guardrail has nothing new to purge as of this phase's end.
6. **OV6's residual open question is unchanged and carries forward as-is**: does Cin7 stamp `modifiedDate` at transaction start or commit? Not answerable read-only; needs Kian/dev. This bounds confidence in the OV5 "no negative lag" result (§2.4) and should accompany the OV6 verdict wherever it's pasted (QA doc, index page, ticket).
7. **The two-preview-run duplication (§5) is a process note for whoever runs Phase 2's previews** — build any research-copy tooling needs (e.g., wanting a field the stock script doesn't print) into the *first* call, not a follow-up, to avoid doubling spend on an identical window.
