# BUSY-1116 Phase 0 Results — Deploy state, OV1–OV3, contradiction register

**Date:** 2026-08-13 · **Author:** Claude (QA forensics session) · **Scope:** Phase 0 of `BUSY-1116-RETEST-PLAN.md` Rev 2 only. Read-only. Zero Cin7 API calls made. No watermark writes. No config changes. Watermark left `UNSET` throughout (it was already `UNSET` at session start and remains so).

**Method note up front:** every tag below is one of **MEASURED** (a literal quoted log line, or a direct AWS CLI read, cited with source), **INFERRED** (a conclusion drawn from measured facts, reasoning stated), or **UNKNOWN** (genuinely not establishable read-only in this session). Do not treat INFERRED as MEASURED anywhere below.

---

## 1. Group OV — overlap window & missed-record determination (TOP PRIORITY)

### Data source

The poller was last redeployed **2026-08-12T22:45:44Z** (MEASURED, `get-function-configuration`). All log evidence used for OV1–OV3 is drawn from the **only active-watermark window that exists in retained logs after that redeploy**: a run on **2026-08-13, 03:46:50Z–04:28:52Z** (documented separately in `CTC-FINAL-QA-PASS-RESULTS.md`). This yielded **16 `Cin7PollerCycleStart` events / 15 completed cycles + 1 failed cycle** — this is the full available population, not a sample I truncated. Extending it would require opening a new watermark window, which Phase 0's zero-Cin7-cost constraint forbids.

**Historical context (MEASURED, informational only, not used for the verdict):** `Cin7PollerCycleStart` fired 201 times across the full ~41-day retained history (43 on 08-05, 132 on 08-06, 10 on 08-07, 16 on 08-13). All but the 08-13 ones predate the 08-12 redeploy. The `Cin7ApiCallMade` metric — the log line that carries the literal `where=` clause — **does not exist at all in the 08-05/06/07 logs** (a targeted search for `Cin7ApiCallMade` on 2026-08-06 returned zero rows). So the pre-redeploy code logged no literal query string at all; **only the current (post-08-12) deployed code exposes the where-clause literally**, and only the 08-13 window can answer OV1 for *current* behaviour. This also means the pre/post code comparison that would explain "why do two docs disagree" can't be settled from logs (see §4).

### OV1 — What does the query actually ask for?

**MEASURED.** Verbatim log line, `/aws/lambda/staging-catalog-cin7-cin7-item-poller`, `2026-08-13T03:46:50.979Z`:
```
{"metric":"Cin7ApiCallMade","path":"/api/v1/Products?where=modifiedDate%3E%3D%272026-08-13T02%3A38%3A00.000Z%27&order=modifiedDate+ASC&rows=250&page=1","status":200}
```
URL-decoded: `where=modifiedDate>='2026-08-13T02:38:00.000Z'&order=modifiedDate ASC&rows=250&page=1`.

The immediately preceding line, same request (`b4264ba1-bd3d-4960-8069-d472f890baec`), same timestamp second:
```
{"metric":"Cin7PollerCycleStart","watermark":"2026-08-13T02:38:00.000Z"}
```

**The floor literal equals the watermark literal, character for character. `watermark − since = 0` for this cycle.**

I extracted the floor for both endpoints across every cycle where the data exists (all 15 completed + the 1 that reached the API call before failing = the same request retried). Full table:

| Cycle start (UTC) | Watermark in force | `/Products` floor | `/ProductOptions` floor | Δ (watermark−floor) |
|---|---|---|---|---|
| 03:46:50.358 | 2026-08-13T02:38:00.000Z | 2026-08-13T02:38:00.000Z | 2026-08-13T02:38:00.000Z | 0s |
| 03:49:51.220 | 2026-08-13T03:46:43.000Z | 2026-08-13T03:46:43.000Z | 2026-08-13T03:46:43.000Z | 0s |
| 03:52:51.145 | 2026-08-13T03:48:54.000Z | 2026-08-13T03:48:54.000Z | 2026-08-13T03:48:54.000Z | 0s |
| 03:55:50.620 | 2026-08-13T03:51:45.000Z | 2026-08-13T03:51:45.000Z | 2026-08-13T03:51:45.000Z | 0s |
| 03:58:50.440 | 2026-08-13T03:55:02.000Z | 2026-08-13T03:55:02.000Z | 2026-08-13T03:55:02.000Z | 0s |
| 04:01:50.610 *(failed — TimeoutError, see §5)* | 2026-08-13T03:57:48.000Z | *(never reached the API call)* | — | — |
| 04:03:16.981 *(retry of the same invocation)* | 2026-08-13T03:57:48.000Z | 2026-08-13T03:57:48.000Z | 2026-08-13T03:57:48.000Z | 0s |
| 04:04:50.601 | 2026-08-13T04:03:08.000Z | 2026-08-13T04:03:08.000Z | 2026-08-13T04:03:08.000Z | 0s |
| 04:07:50.548 | 2026-08-13T04:03:08.000Z | 2026-08-13T04:03:08.000Z | 2026-08-13T04:03:08.000Z | 0s |
| 04:10:50.681 | 2026-08-13T04:06:44.000Z | 2026-08-13T04:06:44.000Z | 2026-08-13T04:06:44.000Z | 0s |
| 04:13:50.525 | 2026-08-13T04:10:31.000Z | 2026-08-13T04:10:31.000Z | 2026-08-13T04:10:31.000Z | 0s |
| 04:16:50.509 | 2026-08-13T04:12:11.000Z | 2026-08-13T04:12:11.000Z | 2026-08-13T04:12:11.000Z | 0s |
| 04:19:50.608 | 2026-08-13T04:16:01.000Z | 2026-08-13T04:16:01.000Z | 2026-08-13T04:16:01.000Z | 0s |
| 04:22:50.569 | 2026-08-13T04:18:47.000Z | 2026-08-13T04:18:47.000Z | 2026-08-13T04:18:47.000Z | 0s |
| 04:25:50.564 | 2026-08-13T04:18:47.000Z | 2026-08-13T04:18:47.000Z | 2026-08-13T04:18:47.000Z | 0s |
| 04:28:50.424 | 2026-08-13T04:25:08.000Z | 2026-08-13T04:25:08.000Z | 2026-08-13T04:25:08.000Z | 0s |

**MEASURED, headline: Δ = 0s in all 14 cycles where the API call was actually reached. Never 300s. Never varies. `/Products` and `/ProductOptions` always share the identical floor within a cycle — cross-checked programmatically over every historical `Cin7ApiCallMade` line matching `modifiedDate%3E%3D` (37 total lines across all 15 cycles, including repeated-page calls): zero mismatches between the two endpoints in any cycle.**

**Comparison operator (MEASURED):** every single occurrence of the where-clause across the full retained history uses `%3E%3D` (`>=`). A count of lines containing `modifiedDate%3E%3D` (`>=`) vs. lines containing the strict superset pattern `modifiedDate%3E` (`>` or `>=`) returned **37 and 37** — identical. **Zero occurrences of a bare `>`.** The floor derives directly from the watermark value read at cycle start (MEASURED — string-identical every time).

**Verdict on OV1: Kian's runbook is right, LLD §3.4 is wrong, for the currently deployed poller.** There is no 5-minute (or any) overlap subtracted. The query floor is the raw watermark value, inclusive (`>=`), identical for both endpoints, with zero cycle-to-cycle variance across every cycle sampled.

I also searched the full poller log history for any keyword suggesting an overlap constant exists anywhere in the code's logging surface — `overlap`, `OVERLAP_MS`, `LAG_MS`, `skew` (case-insensitive) — **zero matches** across 47,711 scanned log records. **INFERRED** (absence-of-evidence, not a code read): no overlap constant appears to be logged or referenced; consistent with, but not conclusive proof of, "no overlap exists in code." I did not read source code — this is a log-only finding, flagged UNKNOWN at the code level, MEASURED at the observed-behaviour level.

### OV2 — Is the floor inclusive, and does the boundary record re-emit?

**MEASURED, directly from the operator:** the where-clause uses `>=` (see OV1). This alone establishes the floor is inclusive by construction, not inference.

**MEASURED, direct behavioural confirmation — two clean cases found where an entire cycle's emitted record set is exactly the previous cycle's boundary re-appearing:**

1. Cycle at **04:03:16.981** completed with:
   `{"metric":"Cin7PollerCycleComplete","productsFetched":19,"productsFetchedPrimary":0,"recordsEmitted":144,"recordsSkipped":0,"watermarkAdvanced":true,"newWatermark":"2026-08-13T04:03:08.000Z"}`
   The very next cycle, **04:04:50.601**, started at watermark `2026-08-13T04:03:08.000Z` (i.e. exactly that boundary) and completed:
   `{"metric":"Cin7PollerCycleComplete","productsFetched":3,"productsFetchedPrimary":0,"recordsEmitted":20,"recordsSkipped":0,"watermarkAdvanced":true,"newWatermark":"2026-08-13T04:03:08.000Z"}` — **the watermark did not move**, yet **20 records were fetched and emitted again**. I diffed the `item_code` sets of `Cin7RecordEmitted` between the two cycles programmatically: **all 20 item_codes from the 04:04:50 cycle are an exact subset of the 144 emitted in the 04:03:16 cycle** (overlap = 20/20).
2. Same pattern at **04:19:50.608 → 04:22:50.569**: cycle 1 completes with `newWatermark:"2026-08-13T04:18:47.000Z"`; cycle 2 starts at that exact watermark, emits 8 records, and completes with `newWatermark` **unchanged** at `2026-08-13T04:18:47.000Z`. Diffed item_codes: **all 8 are an exact subset of the prior cycle's emitted set** (overlap = 8/8).

This is the clearest available evidence: **the boundary record(s) — those whose `modifiedDate` equals the just-advanced watermark — are refetched and re-emitted whole in the next cycle**, exactly as an inclusive floor predicts. (Downstream coalescing in the buffer is what absorbs this in practice — consistent with the existing "PW2 overlap re-emit" expectation in the plan, except here the mechanism is Cin7's own inclusive index boundary, not a poller-side 5-minute buffer.)

Beyond these two clean isolated cases, item_code-set overlap between consecutive cycles was checked across **all 15 cycle-to-cycle transitions**: 13 of 15 showed nonzero overlap (ranging 8–116 items), 2 showed zero overlap. This is **consistent with** (not separately proof of) the same mechanism operating continuously — but I flag it as **INFERRED**, not MEASURED, for the general case, because without a per-record `modifiedDate` in the logs I cannot rule out that some of that overlap is coincidental re-edits within the ~3-minute cycle gap rather than boundary re-fetch. The two clean zero-watermark-advance cases above are the only ones where the *mechanism itself* is unambiguously proven (the watermark literally not moving while records repeat is only explicable by boundary re-fetch, not by coincidental re-edit).

**Timestamp granularity (MEASURED):** every single watermark/`newWatermark` value observed across all 15 cycles — in the cycle table above and throughout the wider 201-event historical set — has a **millisecond field of exactly `.000`**. E.g. `2026-08-13T04:03:08.000Z`, never `.347Z` or similar. This strongly indicates Cin7's `modifiedDate` is exposed (or at least filterable) only at **whole-second granularity**.

**Collision count — records sharing an identical `modifiedDate` within one cycle (UNKNOWN):** the poller's logs never emit a per-record `modifiedDate` field — not in `Cin7RecordEmitted` (`{"metric":"Cin7RecordEmitted","item_code":"..."}`, no timestamp field), not in the `Pushed` EventBridge payload (the full emitted-record JSON was inspected verbatim — fields are `message_group_id, read_at, item_code, company, size, colour, ean, additional_eans, weight, height, length, width, conversion_rate, dimension_uom, qty_uom, desc, product_group_id, sub_group_id, is_giftcard, brand, missing_fields` — **no `modifiedDate` at all**). The two clean cases above (20/20 and 8/8 full-set boundary repeats) are consistent with **at least** that many records sharing the exact boundary second in those two instances, but an exact collision count across the dataset **cannot be established from these logs** — it requires either a code change (log the field) or direct Cin7 GETs correlating `item_code` → `modifiedDate` (Phase 1, OV4/OV5 territory, and even then only for the sampled window). **Flag this as a genuine Phase 0 limitation, stated rather than guessed at.**

**Verdict on OV2: floor is inclusive (`>=`, proven from the operator directly), and the boundary-reappearance behaviour this predicts is directly observed in two clean cases with zero ambiguity. Granularity is whole seconds. Collision frequency is UNKNOWN from available logs.**

### OV3 — Does out-of-order arrival actually happen?

**What Phase 0's logs can and cannot show here, stated plainly:** the poller's own logs give me the **watermark chain** (start-of-cycle floor vs. previous cycle's advanced maximum) but never a per-record `modifiedDate`, so I can directly test the *cycle-level* claim ("did any cycle's floor ever regress, or fail to equal the immediately preceding cycle's max") but **cannot** directly test the *record-level* claim ("did any individual record's `modifiedDate` fall below the previous cycle's max and still get fetched late") — that needs OV4/OV5's reconciliation against Cin7's own API response field, which is Phase 1 scope.

**MEASURED — cycle-level chain, full 15-cycle sequence, checked for monotonicity:**

```
02:38:00.000 → 03:46:43.000 → 03:48:54.000 → 03:51:45.000 → 03:55:02.000 → 03:57:48.000
→ 03:57:48.000 (retried invocation, same floor — see §5) → 04:03:08.000 → 04:03:08.000 (unchanged)
→ 04:06:44.000 → 04:10:31.000 → 04:12:11.000 → 04:16:01.000 → 04:18:47.000 → 04:18:47.000 (unchanged)
→ 04:25:08.000 → 04:28:45.000
```

Every single transition is **non-decreasing**. Zero cases of the watermark moving backward. Every cycle's starting floor is **string-identical** to the immediately preceding cycle's `newWatermark` — never earlier (which would indicate an overlap being applied) and never later (which would indicate a skip). This is the same dataset already used for OV1/OV2, cross-checked once more for this specific question.

**Distribution requested by the plan ("cycle N−1 max − modifiedDate, where positive"):** across all 15 observed cycles, this value is **0 for every cycle in every case I can measure** — because I can only measure it at cycle-boundary granularity (watermark vs. watermark), and by construction (OV1's inclusive-exact floor) the boundary can never show a positive value at this resolution: the next cycle's floor is defined to equal the previous max exactly, so nothing "before" that floor is ever queried, and nothing after it is skipped over. **This is not the same as proving no individual record arrived with a `modifiedDate` earlier than when the poller could see it** (write-lag / index-visibility lag) — that is a *pre-fetch* phenomenon Cin7-side, invisible to a poller-side log no matter how the floor is set, and it's exactly what OV5 is for.

**Verdict on OV3 (Phase 0 slice only): checked 15 cycles, zero cases of cycle-level regression or overlap found. This rules out a poller-side bug (skipping ahead, double-subtracting, applying a stale watermark) but does NOT settle whether Cin7-side write/commit lag can cause a record to be permanently missed — that remains open pending OV4 (reconciliation sweep) and OV5 (lag/skew sizing) in Phase 1.** Per the plan's own decision rule (§3): if OV1 confirms no overlap (it does, definitively) and OV5 later shows real write lag, that is a design defect regardless of what OV4's sampled window shows. **Phase 0 cannot close this question on its own — by design, per the phase split in the plan.**

### Headline verdict for group OV (Phase 0 slice)

> **The currently deployed poller (as of the 2026-08-12T22:45:44Z build) queries Cin7 from the watermark's exact value, inclusive (`>=`), with zero overlap buffer, identically for both `/Products` and `/ProductOptions`, with zero cycle-to-cycle variance across every cycle observed. This is measured directly from the literal `where=` clause in 14 real cycles, corroborated by two clean cases of exact boundary-record re-emission with an unmoved watermark. LLD §3.4's "watermark − 5 minutes" is not what the current code does. Kian's runbook is correct on this point.**
>
> **This does NOT yet answer whether the absence of an overlap is safe.** That depends on Cin7-side write/commit-lag (OV5) and a real reconciliation sweep (OV4), both explicitly out of Phase 0's scope. Do not read "no overlap confirmed" as "no defect" — they are different questions, and the plan's own decision rule says so.

---

## 2. Deploy state — all four Lambdas

| Field | `cin7-item-poller` | `buffer-populator` | `buffer-handler` | `item-sender` |
|---|---|---|---|---|
| **LastModified** | **2026-08-12T22:45:44Z** | **2026-08-03T13:02:56Z** ⚠ unchanged | 2026-07-15T04:42:13Z | **2026-08-12T22:46:32Z** |
| Runtime | nodejs20.x | nodejs18.x | nodejs18.x | nodejs20.x |
| Timeout | 300s | 60s | 900s | 30s |
| MemorySize | 128MB | 128MB | 128MB | 128MB |
| ReservedConcurrentExecutions | **1** | *(none set)* | **1** | *(none set)* |
| EventInvokeConfig | none (`ResourceNotFoundException`) | none | none | none |
| DeadLetterConfig | not present | **not present (`null`)** | not present | not present |
| Env vars | see below | see below | see below | see below |

**Poller env vars (MEASURED, `get-function-configuration`):**
```
WATERMARK_PARAMETER_NAME=/catalog/cin7-manhattan/item-watermark/staging
STAGE=staging
CIN7_SECRET_NAME=staging/catalog/cin7
AWS_NODEJS_CONNECTION_REUSE_ENABLED=1
INTERNAL_EVENT_BUS_NAME=staging-catalog-cin7-events
```
**⚠ Flag: no `MAX_PAGES_PER_RUN`, no `CIN7_ID_FILTER_BATCH_SIZE`, no overlap/lag/skew-shaped variable of any kind.** The retest plan's kick-off prompt expected to find these as env vars. They are **not configurable via environment on this deployment** — either hardcoded in the Lambda's bundled code, or the names differ from what's expected. This means C2's page-cap value (claimed `30` by Kian) and any id-chunk-size constant **cannot be confirmed from the environment** — only from behaviour (see §3, C2/C4), and behaviourally the cap has never been exercised (see below), so **the actual configured number remains UNKNOWN, not just unconfirmed.**

**Buffer-populator env vars:** `AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`, `QUEUE_NAME=staging-catalog-manhattan-item-buffer-buffer.fifo`. No overlap-shaped vars (expected — this Lambda has nothing to do with the watermark).

**Buffer-handler env vars:** `PROCESSING_LAMBDA_ARN` (points at the sender), `QUEUE_URL`, `VISIBILITY_TIMEOUT=180`, `AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`.

**Sender env vars:** `STAGE=staging`, `ALERT_TOPIC_ARN=arn:aws:sns:...staging-catalog-manhattan-observability-alerts`, `AWS_NODEJS_CONNECTION_REUSE_ENABLED=1`.

**⚠ ERR5 gate re-confirmed (MEASURED):** `buffer-populator` `LastModified` is still **2026-08-03T13:02:56Z** — unchanged since the earliest recorded baseline. **It has not been redeployed.** Per the plan's own framing (§5.1, and Phase 3's ERR5 note), this means the whitespace-in-`item_code` silent-drop defect is **still live** and any Phase 3 re-test of ERR5 is a confirm-still-broken, not a re-test of a fix. Also reconfirmed directly: **no `DeadLetterConfig`, no `EventInvokeConfig`** on this Lambda, and its EventBridge trigger rule's target (`staging-catalog-manhattan-stagingcatalogmanhattanit-n7R392VRxAsr` on bus `staging-catalog-manhattan-events`, matching `detail-type: manhattan_item_enriched`) has **no RetryPolicy, no DeadLetterConfig** either (`list-targets-by-rule` returns only `Id` and `Arn`, no retry/DLQ fields present) — exactly the gap CLAUDE.md describes.

**EventBridge cadence (MEASURED):** rule `staging-catalog-cin7-cin7-item-poller-schedule`, `rate(3 minutes)`, `State: ENABLED`. Matches documented cadence.

**Current watermark (MEASURED, direct `get-parameter`, not CLI display):**
```
Value: "UNSET", Version: 174, LastModifiedDate: 2026-08-13T14:28:54+10:00 (= 04:28:54Z)
```
Correctly idle. Left untouched this session.

**`check-status.sh --stage staging --profile staging` (MEASURED, re-run this session):**
```
staging-catalog-manhattan-item-buffer-dlq.fifo: 18 waiting, 0 in-flight
(all other queues: 0/0)
staging-catalog-manhattan-send-dlq-depth: ALARM
staging-catalog-cin7-cin7-poller-errors: NOT FOUND (tooling name mismatch — see below)
staging-catalog-cin7-cin7-watermark-stale: NOT FOUND (tooling name mismatch — see below)
```
DLQ depth is **18**, not the plan's last-recorded baseline of "9 waiting / 1 in-flight at 2026-08-13T01:06:59Z" — it has grown since then (consistent with the plan's own repeated warning that this number always drifts and must be measured fresh, not assumed).

**⚠ `check-status.sh` tooling bug, confirmed (MEASURED):** the script looks up alarms named `staging-catalog-cin7-cin7-poller-errors` and `staging-catalog-cin7-cin7-watermark-stale` (double `cin7-cin7`) and reports them "NOT FOUND". Direct `describe-alarms --alarm-name-prefix staging-catalog-cin7` shows the **real** alarm names have only a single `cin7-`:
```
staging-catalog-cin7-poller-errors        State: OK   (AWS/Lambda Errors, FunctionName=cin7-item-poller)
staging-catalog-cin7-watermark-stale      State: OK   (staging-catalog-cin7 namespace, metric Cin7PollerCycleComplete)
staging-catalog-cin7-validation-failures  State: OK   (staging-catalog-cin7 namespace, metric ManhattanValidationFailure)
```
**Confirmed: this is a `check-status.sh` name-construction bug, not a missing-infrastructure gap.** Both alarms exist and are correctly `OK` (idle, as expected while watermark is `UNSET`).

**⚠ New alarm found, `staging-catalog-cin7-validation-failures` — re: the CLAUDE.md note that "no alarm watches CTC validation failures":** this alarm **does now exist** (state `OK`), watching a custom metric `ManhattanValidationFailure` in namespace `staging-catalog-cin7` with **zero dimensions** (`Dimensions: []`). This is worth flagging carefully rather than declaring the gap closed: it lives in the **`staging-catalog-cin7`** namespace (the poller's own namespace), not `staging-catalog-manhattan` where `SenderValidationFailures` (the sender's generic-failure metric CLAUDE.md documents as CTC's only current failure signal) lives. **I cannot confirm from a read-only pass alone whether this new alarm is actually fed by the sender's CTC validation failures, or is a separate/different signal from the poller side (e.g. a Manhattan-response validation check inside the poller's own code path) — the metric name `ManhattanValidationFailure` and its home namespace don't unambiguously say.** This needs a **live-fire check** (does triggering `SenderValidationFailures` for a CTC record also move this alarm's underlying metric?) to confirm scope, which is beyond Phase 0's read-only mandate. **Flag as: possibly-resolved BUSY-1117 gap, NOT confirmed — carry to Phase 1/BUSY-1117 sign-off, don't close the ticket item on this alone.**

**SNS subscriptions on `staging-catalog-manhattan-observability-alerts` (MEASURED):** `list-subscriptions-by-topic` → **0 subscriptions.** Confirms the plan's standing note: nothing notifies anyone, regardless of alarm state.

---

## 3. C2–C5 resolutions

### C2 — page cap

**MEASURED:** `Cin7ItemPollerPageCapHit` (or any message containing "PageCapHit") — **zero occurrences in the full retained log history** (a broad search for "Cap" also returned zero real hits; the only matches were the substring "Cap" inside product names like "6 Panel Cap"). **The highest page number ever logged for a `modifiedDate`-based (non-triggered) fetch, across all history, is `8`** (8 pages × 250 rows = up to 2,000 rows in one cycle, cycle at 03:46:50 which emitted 1,764 records). This is well short of any documented cap (20 in our draft runbook, 30 per Kian).

**Verdict: the page cap has never been hit in this environment's logged history, at any churn rate observed so far — including the highest-volume cycle sampled (1,764 records / 8 pages).** Whether the cap is 20, 30, or something else **cannot be confirmed** — it's not in the env vars (§2) and has never fired in logs. This is a genuine **UNKNOWN**, not a confirmed `30`. **PW10 in Phase 2 (deliberately forcing a cap hit via a page-limited env var) remains the only way to settle the actual value and resume-behaviour** — Phase 0 cannot close this from logs alone because the event has simply never happened.

### C3 — batched emit

**MEASURED.** Parsed every `Pushed {"Entries":[...]}` line in the full retained history (2,821 such lines) and counted `DetailType` occurrences per line (one per batched record):

| Batch size | Count of `Pushed` calls |
|---|---|
| 10 | 2,678 |
| 9 | 8 |
| 8 | 14 |
| 7 | 14 |
| 6 | 23 |
| 5 | 15 |
| 4 | 16 |
| 3 | 17 |
| 2 | 16 |
| 1 | 20 |

**Maximum ever observed: 10. 95% of all batches are exactly 10 (the trailing/partial batches account for the rest, as expected when a cycle's total record count isn't a multiple of 10).** **Confirms C3 exactly: batched, ≤10 records per `PutEvents` call.**

### C4 — triggered-product id-chunking

**MEASURED — chunk sizes.** Parsed every `Products?where=id+in+(...)` call in the full retained history (17 such calls found): sizes observed were `{1, 3, 4, 6, 9, 11, 15, 19, 21, 24, 26, 29, 33, 47, 100}`. **Maximum chunk size ever observed: exactly 100.** Confirms the claimed 100-id chunking — every chunk observed is ≤100, and 100 itself appears twice (i.e. it is being hit, not just theoretically available).

**MEASURED — 404s.** Searched the full poller log history for any 4xx HTTP status in a logged API response (`"status":4` pattern, catching 400/403/404/429 etc.): **zero occurrences.** (A naive search for the literal substring "404" is contaminated by Lambda `RequestId`s that happen to contain "404" as digits — e.g. `...404b-9091...` — so I used the structured `"status":4` pattern against the logged `Cin7ApiCallMade` status field specifically, which avoids that false-positive.) **Confirmed: zero 404s in the poller's entire logged history.**

### C5 — request budget (gates the 6-hour rewind cap for Phase 2)

**MEASURED**, per-cycle request counts for the 15 cycles in the 08-13 window (each `Cin7ProductsFetched`/`Cin7ProductOptionsFetched`/`Cin7TriggeredProductsFetched` line = one HTTP request):

| Cycle (newWatermark) | productsFetched (triggered) | recordsEmitted | Products pages | ProductOptions pages | Triggered id-chunk calls | Approx total requests this cycle |
|---|---|---|---|---|---|---|
| 03:46 (→03:46:43) | 247 | 1,764 | 1 | 8 | 3 | ~12 |
| 03:49 (→03:48:54) | 24 | 172 | 1 | 1 | 1 | ~3 |
| 03:52 (→03:51:45) | 4 | 20 | 1 | 1 | 1 | ~3 |
| 03:55 (→03:55:02) | 29 | 193 | 1 | 1 | 1 | ~3 |
| 03:58 (→03:57:48) | 11 | 97 | 1 | 1 | 1 | ~3 |
| 04:03 (→04:03:08) | 19 | 144 | 1 | 1 | 1 | ~3 |
| 04:04 (→04:03:08, unchanged) | 3 | 20 | 1 | 1 | 1 | ~3 |
| 04:07 (→04:06:44) | 33 | 183 | 1 | 1 | 1 | ~3 |
| 04:10 (→04:10:31) | 19 | 111 | 1 | 1 | 1 | ~3 |
| 04:13 (→04:12:11) | 15 | 82 | 1 | 1 | 1 | ~3 |
| 04:16 (→04:16:01) | 9 | 72 | 1 | 1 | 1 | ~3 |
| 04:19 (→04:18:47) | 21 | 162 | 1 | 1 | 1 | ~3 |
| 04:22 (→04:18:47, unchanged) | 1 | 8 | 1 | 1 | 1 | ~3 |
| 04:25 (→04:25:08) | 26 | 177 | 1 | 1 | 1 | ~3 |
| 04:28 (→04:28:45) | 6 | 52 | 1 | 1 | 1 | ~3 |

**Total for this ~42-minute, ~4,300-record window: ~15 cycles, roughly 45–50 total Cin7 HTTP requests** (dominated by the one heavy first cycle's 8-page `/ProductOptions` pull; every other cycle in this sample needed only ~3 requests regardless of whether it emitted 20 or 190 records, because **triggered products are fetched in one chunked call per batch of ≤100 ids, not one call per record**).

**This directly supports Kian's claim that request cost tracks pages and id-chunks, not raw record count**, consistent with his cited "7-day reset: 17,886 records for 90 requests." A single heavy cycle here (1,764 records) cost ~12 requests; a light cycle (8 records) still cost ~3 requests (the floor for any active cycle: 1 Products page + 1 ProductOptions page + at least 1 triggered-id chunk, when there's anything to fetch). **Verdict: C5 is confirmed from this measured sample — request cost is dominated by page/chunk counts, not record counts. This supports raising the rewind cap to 6 hours per the plan's conditional (§2), though this is a 42-minute sample, not the 6-hour figure itself — Phase 2 should still measure its own real window rather than extrapolating linearly, since churn rate is stated elsewhere to vary significantly session to session.**

---

## 4. Contradicts existing docs — callout list

1. **LLD §3.4 ("`watermark − 5 minutes`") is wrong for the currently deployed poller.** Measured floor is the exact watermark value, zero offset, in all 14 measurable cycles. Kian's runbook is correct on this specific point. *(This is OV1's finding, restated here for the register.)*
2. **The retest plan's Phase 0 kick-off expected `MAX_PAGES_PER_RUN` and `CIN7_ID_FILTER_BATCH_SIZE` to appear as poller Lambda environment variables.** They do not. The poller's env vars are only `WATERMARK_PARAMETER_NAME, STAGE, CIN7_SECRET_NAME, AWS_NODEJS_CONNECTION_REUSE_ENABLED, INTERNAL_EVENT_BUS_NAME`. If these constants exist, they're hardcoded in the deployed bundle, not env-configurable — meaning **PW10's plan of "set `MAX_PAGES_PER_RUN=1` as a live env var, no deploy" (Phase 2) will not work as written** — there is no such env var to set. This needs to be flagged back to whoever wrote PW10 before Phase 2 starts.
3. **`check-status.sh` has a real naming bug** (double `cin7-cin7-` in its alarm lookups for `poller-errors` and `watermark-stale`), causing it to report "NOT FOUND" for two alarms that exist and are healthy. Not an infra gap — a script bug. Worth a one-line fix.
4. **A `staging-catalog-cin7-validation-failures` alarm now exists**, which may or may not close the "no alarm watches CTC validation failures" gap CLAUDE.md and BUSY-1117 describe — **its actual coverage of the sender's CTC failures is unconfirmed** (different namespace than the sender's own metrics; see §2). Don't mark BUSY-1117's gap closed on this alone.
5. **DLQ depth has grown to 18** (waiting), up from the plan's last-recorded 9/1 baseline. Consistent with the plan's own repeated warning to always re-measure, not reuse a stale number — flagged here as the fresh baseline for whichever phase runs next.
6. **The buffer-populator Lambda is still not redeployed** (`LastModified` unchanged at 2026-08-03T13:02:56Z). ERR5 remains a live, unfixed defect — Phase 3 should treat any ERR5 case as confirm-still-broken, exactly as the plan already anticipates.

---

## 5. Bonus finding — an organic, real forced-failure event (relevant to blocked TC5/1116 TC1-TC2)

Not asked for explicitly, but found while assembling the OV1 cycle table and worth surfacing because the plan documents TC5 (1114) / TC1–TC2 (1116) as **blocked-by-infrastructure** ("forcing a poller failure from outside is NOT reliably achievable").

**MEASURED**, verbatim, same log group:
```
2026-08-13T04:01:50.610Z  cycle starts, watermark = 2026-08-13T03:57:48.000Z
2026-08-13T04:02:15.612Z  ERROR  {"metric":"Cin7PollerCycleFailed","message":"The operation was aborted due to timeout"}
2026-08-13T04:02:15.640Z  ERROR  Invoke Error {"errorType":"TimeoutError", ...}
                          END RequestId: 35e911ab-... / REPORT Duration: 25225.03 ms
2026-08-13T04:03:16.981Z  SAME RequestId (35e911ab-...) starts again, watermark = 2026-08-13T03:57:48.000Z  (unchanged)
2026-08-13T04:03:20.750Z  Cin7PollerCycleComplete ... newWatermark:"2026-08-13T04:03:08.000Z" (advances normally)
```

A genuine, organic mid-cycle `TimeoutError` occurred (not injected by this session — nothing was touched). **The watermark held at its pre-failure value across the failed attempt and was only advanced by the subsequent successful retry, using the exact same pre-failure floor.** This is a real, live instance of exactly the behaviour 1114 TC5 / AC2 was never able to confirm via deliberate injection. It's not a substitute for a deliberately controlled test (I don't know what caused the timeout, and can't reproduce it on demand), but it is **direct organic evidence, fully consistent with AC2's requirement**, and worth citing in the 1114/1116 sign-off discussion rather than leaving that AC resting solely on "blocked, never executed."

Historical note, same mechanism, larger scale: `Cin7PollerCycleFailed` fired **38 times total** across the full log history — 34 were `"Cin7 secret is missing required fields"` (the known 08-05/06 blank-credential incident already documented in CLAUDE.md) and 4 were `TimeoutError` (including the one above). I did not check whether the watermark held across all 34 of the historical secret-failure incidents — that would need the same pairwise-cycle check repeated 34 times and is not central to Phase 0; flagging as available-but-not-exhaustively-checked.

---

## 6. What Phase 1 needs to pick up

1. **OV4 (reconciliation sweep) and OV5 (write-lag/skew sizing) are the load-bearing remainder of the overlap question.** Phase 0 conclusively answers "is there an overlap" (no) but cannot answer "is that safe" — that needs Cin7's own `modifiedDate` field pulled directly via GET (not available in poller logs at all) and correlated against poller read-time. This is explicitly Phase 1 scope per the plan and could not be done read-only-from-logs-only in Phase 0.
2. **Collision frequency (OV2's "records sharing an identical modifiedDate" count) is UNKNOWN** — the poller never logs a per-record `modifiedDate`. Phase 1's OV4 pull (direct Cin7 GET with client-side upper bound) is the only way to get this, since it reads the field directly from Cin7 rather than from poller logs.
3. **The actual configured page-cap value is UNKNOWN**, not just "30 per Kian, unconfirmed" — it's not in the environment and has never fired in ~41 days of logs, including a 1,764-record single cycle. PW10 (Phase 2) is designed to force it, but **as written it assumes a settable env var (`MAX_PAGES_PER_RUN`) that this session confirmed does not exist on the deployed Lambda.** Whoever runs Phase 2 needs to either find the real mechanism (redeploy with a different constant? a different env var name?) or flag PW10 as blocked before spending any watermark budget on it.
4. **The `staging-catalog-cin7-validation-failures` alarm's actual coverage is unconfirmed.** Phase 1 or the BUSY-1117 sign-off should verify by checking whether a live sender-side CTC validation failure actually increments the metric this alarm watches, before declaring that documented gap closed.
5. **Pre-redeploy (pre-08-12) poller behaviour cannot be reconstructed from logs** — the `Cin7ApiCallMade` metric that carries the literal where-clause didn't exist in the code before the redeploy. If anyone wants to know "did the OLD code actually have the 5-minute overlap the LLD describes," that can't be answered from logs; it would need a source-code diff, which is out of QA's read-only AWS scope entirely (would need repo access, not covered by this session's remit).
6. **DLQ's 18 waiting messages have not been inventoried or classified** (which are inert prior QA evidence vs. anything new) — that's explicitly Phase 1's `ERR3` baseline task, not attempted here since it wasn't in this session's task list beyond noting the raw depth.
