# BUSY-1116 — full re-test plan, phased

> **Provenance:** mirror of the claude.ai Project doc `claude/BUSY-1116 phased re-test plan (2026-08-13).md`
> in the **"WMS integration QA"** project. Not in Confluence or Jira. The project copy is authoritative —
> if this file and the project doc disagree, the project doc is newer. Keep this copy in `testing-tools/`
> for IDE sessions. Exported 2026-08-13.

**Rev 2 · 2026-08-13** (Rev 1 same day) · **Owner:** JJ (QA) · **Ticket:** [BUSY-1116](https://universalstore.atlassian.net/browse/BUSY-1116) (Review, assigned JJ) · **QA doc:** [QA DOC - BUSY-1116](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354632/QA+DOC+-+BUSY-1116)

**Rev 2 changes (JJ):**

1. **The overlap question gets its own dedicated test group, at top priority** — §3, group **OV1–OV6**. Rev 1 buried it as one row (PW1) with a thin method. The objective is now explicit: **establish the exact deployed behaviour as measured fact, and correct whichever document is wrong.** Not "probably".
2. **Rewind cap raised from 1 hour to 6 hours**, conditional on Phase 0 confirming C5 below. Kian's measured 7-day reset (90 requests) says the cost concern was misplaced; 6 hours is the agreed working ceiling anyway.

**Why this exists:** fixes have been deployed (PR [1522](https://github.com/UniversalStore/monorepo/pull/1522) plus the 08-12 poller/sender redeploys), and **every case on the QA doc is being re-run from scratch** rather than patched selectively. This plan slices that re-run into **five phases with hard stopping points**. At each stop: testing stops, findings go into the docs, and a **new IDE session** starts the next phase. Each phase carries its own kick-off prompt.

**Read first:** the project's `CTC QA — current state & results index` — measured environment state. This plan assumes it.

---

## 1. The thing that changes the plan: Kian's runbook is published, and it disagrees with our docs

The QA doc records the runbook as *"not yet created — the single largest outstanding deliverable across 1114/1115/1116"*. It **was** published on **2026-08-03**: [CTC Item Poller Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook) (BUSY space, Kian, "source of truth is the repo copy — this page mirrors it").

It documents deployed behaviour that contradicts the QA doc, the LLD, **and** our own draft runbook on six points. **Nothing below is QA-verified — it is the dev-documented claim, and each one is now a test.**

| # | Our docs say | Kian's runbook says (deployed) | Why it matters |
|---|---|---|---|
| **C1** | Poll runs from `watermark − 5 min` (LLD §3.4, QA doc, our draft runbook §3) | **"No overlap window.** The poller queries from the watermark's exact value, with no buffer subtracted for clock skew or write lag" | If true, the LLD is wrong **and** there is a **permanent-miss window**: a record written to Cin7 with a `modifiedDate` behind an advancing watermark is never re-read. Coalescing cannot save a record that is never fetched. **→ group OV, §3, top priority** |
| **C2** | `--max-pages 20`; "whether the poller resumes across cycles or **silently drops the remainder** is unverified" (draft runbook §5 open item 2) | `MAX_PAGES_PER_RUN` **30**. A capped cycle advances over what it *did* process, logs `Cin7ItemPollerPageCapHit`, next cycle resumes. `resolveWatermark()` **raises** to the later endpoint max then **clamps** back to a capped endpoint's own max | Turns the biggest unknown in AC3 into a testable claim. Forcible cheaply — see **PW10** |
| **C3** | Emit = one `PutEvents` per record (LLD §3.3 step 5) | **Batched: ≤10 records per `PutEvents` call**, sized so a dense cycle stays inside the 300 s Lambda timeout | Changes TC3's meaning: mid-emit failure is now a **partial-batch** failure, not a per-record one |
| **C4** | PW4 unverified; where-clause-length 404 risk | Triggered parents refetched **chunked at 100 ids/request** (the 404 bug Kian found and fixed during live testing) | PW4 becomes directly verifiable — a 1-hour window already pulls ~194 triggered products |
| **C5** | "1 hr = 1,422 records, 6 hr = 4,949 ≈ the whole 5,000/day cap" → **TC5 DEFERRED on cost** | **7-day reset measured: 17,886 records for 90 requests**, 2,611 products, 3 cycles, ~6 min | **The deferral rationale conflates records with requests.** Confirmed in Phase 0 ⇒ TC5/STR1 un-deferred and the rewind cap moves to 6 hours (§2) |
| **C6** | Runbook not authored; AC4 wide open | Published 08-03 | AC4 is **half** satisfied. The LLD link is **confirmed absent** — §3.4 and §8 have no runbook link; §13 still lists it as an outstanding deliverable. **AC4 fails on the link, not the page** |

Also from that page, worth carrying: the poller is limited to **single concurrent execution** (scheduled and manual runs cannot race) — which is also the mechanism behind the warm-container reuse that defeated TC1/TC2 injection on 08-06.

### Housekeeping — TC numbering on the QA doc is broken

The table has `TC7` = "check the runbook page" and `TC10` = "review runbook content", with no TC8/TC9 — but the Sign-off section refers to "TC5–TC7 (bounded reset)" and "the runbook (TC8/TC9)". Renumber to match the sign-off and use it consistently from here:

- **TC7** — reset request budget + duration measured
- **TC8** — runbook published **and linked from the LLD**
- **TC9** — runbook content review

---

## 2. Standing guardrails (every phase)

- **Preview before every `--set`.** `preview-cin7-sync.sh` is GET-only. No exceptions, including "obviously small" windows.
- **Rewind cap: 6 hours** (JJ, 2026-08-13 — raised from 1 hour). **Conditional:** Phase 0's C5 measurement must confirm that request cost tracks *pages and id-chunks*, not record count, before any window beyond 1 hour is committed. If C5 comes back the other way, drop back to 1 hour and re-open with dev. Do not exceed 6 hours unilaterally even if the cost is trivial — the ceiling is also about blast radius on a shared pipeline, not just budget.
  - Sizing sanity: 6 hours ≈ **4,949 records / ~678 triggered products** at 08-07 churn ⇒ ~20 `/ProductOptions` pages + ~7 id-chunks, comfortably inside the deployed page cap of 30. It should converge in **one cycle**; if it doesn't, that itself is a C2 finding.
  - Still out of reach at 6 hours: product **29942** (modified 08-06), the only known live-shaped whitespace fixture. ERR5 via the poller path stays blocked.
- **Snapshot the watermark first**, `--unset --confirm` at every phase stop. An `UNSET` poller makes **zero** Cin7 calls; an active one costs ~960 requests/day standing.
- **One watermark, one lever** — serialize. Confirm no co-tester is mid-run before writing it.
- **SSM writes take ~2 cycles (~6 min) to land.** Confirm with `get-parameter`. **Never re-write impatiently** — that is how a reset's cost doubles.
- **Judge delivery from the sender log** (`accepted=N rejected=0`), never HTTP status — Manhattan always returns 200.
- **Measure DLQ depth at the start of every phase.** Last recorded 9 waiting / 1 in-flight at 2026-08-13T01:06:59Z. It is not a fixed number, and `send-dlq-depth` has been saturated in ALARM since 08-10 — it is not a signal.
- **Alerts topic has zero subscriptions.** Nothing notifies anyone. Watch logs actively.
- **Coordinate before anything destructive** — the pipeline is shared (CTC + UNI/PO/SO).
- **Tag every observation with ticket + AC** so 1114/1115/1116 stay individually signable.

---

## 3. TOP PRIORITY — group OV: overlap window & missed-record determination

**Objective:** state, as measured fact, *exactly* what the deployed poller queries for and whether any record can be permanently missed. One of LLD §3.4 (`watermark − 5 min`) and Kian's runbook ("no overlap window") is wrong. **The deliverable is a definitive answer plus a correction to whichever document is wrong** — and, if a miss is real, a defect ticket. "Probably no overlap" is not an acceptable outcome of this pass.

**Why it outranks everything else in this plan:** every other case here is about a fault that is *visible* — a throw, a DLQ arrival, a rejected batch. This one is about a record that is silently never fetched. Nothing downstream can detect it, no alarm covers it, and coalescing — the mechanism every idempotency argument in the LLD and both runbooks rests on — is irrelevant to it. If it's real, it is the most serious defect on this integration, and it has been sitting inside a contradiction between two documents for ten days.

**Cost:** OV1–OV3 and OV5 are free (log forensics; retention is never-expire). OV4 costs a handful of GETs. **No writes anywhere in this group.**

| ID | Test | Method | Verdict shape |
|---|---|---|---|
| **OV1** | **What does the query actually ask for?** | For **≥20 consecutive cycles**, extract per cycle: (a) the watermark value read at cycle start, (b) the **literal** `where=` clause sent to `/Products`, (c) the same for `/ProductOptions`. Compute `watermark − since` per cycle. Expect **0 s** (Kian) or **300 s** (LLD). Also record: the comparison operator (`>=` vs `>`), whether both endpoints use the same floor, and whether the floor derives from the watermark or something else | An exact expression, quoted from a log line — never inferred. If the delta is neither 0 nor 300 s, or varies between cycles or endpoints, that is a finding in itself |
| **OV2** | **Is the floor inclusive, and does the boundary record re-emit?** | The watermark advances to max `modifiedDate` **M** of cycle N. If the floor is `>= M`, the record whose `modifiedDate == M` must reappear in cycle N+1 (then coalesce downstream). Find such a pair in the logs and confirm. Also establish **timestamp granularity** (second vs millisecond) and count records sharing an identical `modifiedDate` within one cycle | Inclusive / exclusive, proven. **If exclusive:** any second record sharing that exact timestamp is lost — and the collision count tells you how often that shape occurs in real data |
| **OV3** | **Does out-of-order arrival actually happen?** | For each cycle N, compute `min(modifiedDate)` across emitted records and compare against (a) the watermark in force at the start of cycle N, and (b) cycle N−1's max. Record the distribution of `(cycle N−1 max − modifiedDate)` where positive | Records with `modifiedDate` **below the previous cycle's max** can only be returned by a floor below that max ⇒ **direct proof the overlap exists AND that it is load-bearing**. None across 90 days ⇒ either no overlap, or overlap present but lag never materialised — disambiguate with OV1's measured floor. **This is the case that decides whether the 5-minute overlap was doing real work** |
| **OV4** | **Reconciliation sweep — Cin7 truth set vs poller emit set.** The decisive test | Pick a **settled** historical window W (60–90 min, ≥24 h old). Build the Cin7 truth set read-only for both endpoints over W (`preview-cin7-sync.sh --since` + client-side upper bound — the preview has no upper bound). Build the emit set from poller logs for the cycles covering W. **Diff both directions.** Classify every record present in Cin7 but absent from emits: expected ineligible (`Cin7InactiveSkip` — status gate), page-cap clamp, re-modified since W (**inconclusive**, exclude), or **unexplained** | **Any unexplained miss is a data-loss defect.** Report it as a rate (misses / eligible records in W), not just a yes/no. A clean diff does **not** prove safety on its own — pair it with OV3/OV5, because the exposure is structural even if one window happens not to catch it |
| **OV5** | **Size the exposure: write lag and clock skew** | Per record, compute `(poller read time − modifiedDate)`; take the **minimum** across many records and cycles. Separately compare Cin7's timestamps against poller wall-clock for skew, including any **negative** lag (a `modifiedDate` in the future relative to the poller) | A minimum near zero ⇒ Cin7 exposes records essentially immediately and a zero-overlap floor is *nearly* safe. A materially positive minimum, or any negative value, **quantifies the miss window in seconds** — which is the number that decides whether this is a defect or an accepted risk |
| **OV6** | **Verdict, correction and escalation** | Write a single measured statement: exact floor expression · inclusivity · timestamp granularity · whether out-of-order arrival occurs · measured lag/skew · OV4 miss rate. Then correct **whichever** document is wrong (LLD §3.4 or the runbook — at least one is), and raise a defect if OV4/OV5 show real exposure | The paragraph that goes into the QA doc, the index page and the ticket. **Also carry one question to Kian/dev:** does Cin7 stamp `modifiedDate` at transaction *start* or *commit*? Commit-time stamping with slow transactions is exactly the write lag the overlap existed to absorb, and it is not answerable from our side |

**Decision rule, agreed up front so the result isn't argued after the fact:** if OV1 confirms no overlap **and** OV3 or OV5 shows real out-of-order arrival or write lag, that is a **design defect regardless of whether OV4 catches a miss in the sampled window** — the exposure is structural, and a clean sample only means the window was quiet. Conversely, if OV1 shows the 5-minute overlap **is** deployed, then Kian's runbook is wrong on its own "Deployed configuration" section, which is worth flagging on its own merits since that page is the operational source of truth.

**Split across phases:** OV1, OV2, OV3 run in **Phase 0** (free, log-only). OV4 and OV5 run in **Phase 1**. OV6 is written at the Phase 1 stop.

---

## 4. Phase map

Cheap → expensive, read-only → destructive. Each phase ends at a natural stop: nothing in flight, watermark idle, docs updatable.

| Phase | Name | Cin7 cost | Destructive? | Cases | Stop condition |
|---|---|---|---|---|---|
| **0** | Deploy state, **OV1–OV3**, contradiction register | **Zero** | No | **OV1, OV2, OV3**, deploy verification, C1–C6 documentary, TC8, TC9, AC1 attestation chase | Overlap behaviour measured; register resolved doc-side; deploy state recorded |
| **1** | **OV4–OV6** + read-only extraction edges | Low (previews + GETs) | No | **OV4, OV5, OV6**, PW1, PW2, PW3, PW4, PW5, PW7, PW9, ERR3 baseline, ERR4 recheck | OV verdict written; every PW case has a verdict or a stated blocker |
| **2** | Bounded rewind — the measurement phase | Moderate (previewed, ≤6 h) | Watermark write only | TC4, TC5, TC6, TC7, TC8 figures, STR1, STR2, PW8, PW10, ID3, ID4, UP3 | Watermark `--unset`, queues 0/0, budget figures recorded |
| **3** | Failure injection | Low–moderate | **Yes** | TC1, TC2, TC3, ERR1, ERR2, ERR5, STR3, ERR3 alarm threshold | Everything reverted, DLQ reconciled |
| **4** | Runbook reconciliation & sign-off | Zero | No | AC4 close, AC amendments, sign-off table, E2E handover | Ticket movable out of Review |

**Results files** (in `~/Desktop/testing-tools/`, one per phase): `BUSY-1116-PHASE0-RESULTS.md` … `-PHASE4-RESULTS.md`. Summary of anything that changes the picture goes back into the project per the §9 convention on the index page.

---

## 5. Phase 0 — Deploy state, OV1–OV3, contradiction register

**Zero Cin7 cost. Read-only. This is the phase that makes the rest of the plan honest** — several 08-06/08-07 blockers may simply no longer exist.

**Lead with OV1–OV3 (§3).** Everything else in this phase is bookkeeping by comparison.

### 5.1 Deploy state to record (all four lambdas)

| Lambda | Record | Why |
|---|---|---|
| `staging-catalog-cin7-cin7-item-poller` | `LastModified`, `Timeout`, `MemorySize`, all env vars (esp. `MAX_PAGES_PER_RUN`, `CIN7_ID_FILTER_BATCH_SIZE`, **anything overlap/lag/skew-shaped**), `ReservedConcurrentExecutions` | Confirms PR 1522 is actually on staging and pins C1/C2/C4. An env var controlling the overlap would answer OV1 outright — but **still confirm against the logged where-clause**, since a var can exist and be unused |
| `staging-catalog-manhattan-item-buffer-buffer-populator` | `LastModified`, `EventInvokeConfig`, `DeadLetterConfig`, EventBridge target retry policy | **ERR5 gates on this.** Was `2026-08-03T13:02:56Z` (i.e. not redeployed) as at 08-13 — if still so, ERR5 is a confirm-still-broken, not a re-test |
| `staging-catalog-manhattan-item-buffer-buffer-handler` | `LastModified` | Baseline |
| `staging-catalog-manhattan-item-sender` | `LastModified` | Was 08-12T22:46:32Z; confirms the truncation/validation fixes under test |

Also: EventBridge schedule cadence (expect 3 min), watermark current value, `check-status.sh` (expect 0/0), DLQ depth, `send-dlq-depth` state, SNS subscription count on `staging-catalog-manhattan-observability-alerts`.

### 5.2 Resolve the register documentarily where possible

| Case | Do | Verdict shape |
|---|---|---|
| **C1 overlap** | **→ group OV, §3.** Not a one-liner | |
| **C2 page cap** | Read `MAX_PAGES_PER_RUN` from env; search 90 days of poller logs for `Cin7ItemPollerPageCapHit` — if it ever fired, the next cycle's resume behaviour is already in the logs, free | Cap value confirmed; historical evidence of resume-vs-drop |
| **C3 batched emit** | Search logs for emit batch lines / `PutEvents` entry counts per cycle | Batch size confirmed |
| **C4 id-chunking** | Search for `Cin7TriggeredProductsFetched` counts vs distinct id counts in a high-trigger cycle; confirm no `404` in 90 days | Chunking confirmed, 404 absent |
| **C5 budget** | Count `Cin7ProductsFetched` / `Cin7ProductOptionsFetched` / `Cin7TriggeredProductsFetched` lines across several historical cycles → requests/cycle at real churn | **Gates the 6-hour cap in §2.** Establish requests-per-cycle *before* spending anything in Phase 2 |
| **C6 runbook** | Confirmed already: page exists, **LLD link absent** (§3.4/§8 silent, §13 still lists it outstanding). Also review the page against AC4's four required contents | **TC8 = FAIL (link)**, TC9 = verdict on content |

### 5.3 TC9 — runbook content review (already partly done, record it)

AC4 requires: reset procedure ✅ · how far back a reset reaches ✅ · expected duration ✅ (measured, 3-cycle table) · request budget ✅ (90 requests/7 days) · when to use it ⚠ **thin** — the page opens with mechanics, not a "when to use / when NOT to" section. Our draft runbook §1 has exactly that, plus the `cin7-watermark-stale` false-positive trap, the "don't reset for one missing SKU" guidance, and the `SAVE`-doesn't-clear-fields caveat. **Recommendation: don't publish a competing page — offer those sections to Kian as additions to the repo copy.** Decide in Phase 4.

### 5.4 AC1 attestation chase (blocks nothing, but needed for sign-off)

TC1/TC2/ERR1 are dev-owned. Kian's 31 Jul comment says all three forced-failure cases are covered, the second-endpoint case added last. **Get the test file + test names + last green run** into the QA doc's dev-tested table. Currently *"Awaiting dev confirmation"* — and AC1 has no verification from either side until it lands.

### Phase 0 stop → update: OV1–OV3 findings, deploy-state table, register verdicts, TC8/TC9 status, renumbering, and the 6-hour cap confirmed or reverted.

### Phase 0 kick-off prompt

```
Read BUSY-1116-RETEST-PLAN.md in this folder (Rev 2) and CLAUDE.md. Phase 0 only — READ-ONLY, zero
Cin7 API calls, no watermark writes, no config changes. Stop at the end of Phase 0 and do not start
Phase 1.

PRIORITY — do group OV first (plan §3, cases OV1, OV2, OV3). The question: does the deployed poller
query Cin7 from the watermark's EXACT value, or from watermark-5min? The LLD §3.4 and every QA doc
say 5-minute overlap; Kian's published runbook says no overlap window at all. One is wrong. If there
is no overlap, a record written to Cin7 with a modifiedDate behind an advancing watermark is never
fetched again - silent data loss that nothing downstream can detect and coalescing cannot fix.
I want the exact deployed behaviour established as measured fact, quoted from log lines, not inferred:

  OV1 - For >=20 consecutive cycles, extract the watermark value read at cycle start and the LITERAL
        where= clause sent to /Products and to /ProductOptions. Compute watermark-minus-since per
        cycle. Record the comparison operator (>= vs >), whether both endpoints use the same floor,
        and whether it varies cycle to cycle.
  OV2 - Is the floor inclusive? The watermark advances to max modifiedDate M; if the floor is >= M,
        the record with modifiedDate == M must reappear in the next cycle. Find such a pair and
        confirm. Establish timestamp granularity (second vs millisecond) and count records sharing
        an identical modifiedDate in one cycle.
  OV3 - Does out-of-order arrival actually happen? Per cycle, compare min(modifiedDate) of emitted
        records against the watermark in force and against the previous cycle's max. Records below
        the previous max prove an overlap exists AND that it is load-bearing. Give me the
        distribution, not just a yes/no.

Then the rest of Phase 0:
1. Deploy state for all four lambdas (poller, buffer-populator, buffer-handler, sender): LastModified,
   timeout, memory, ALL env vars (flag anything overlap/lag/skew-shaped), reserved concurrency,
   EventInvokeConfig / DeadLetterConfig. Plus EventBridge cadence, current watermark value,
   check-status.sh, DLQ depth, send-dlq-depth alarm state, SNS subscription count on the
   observability-alerts topic.
2. Contradictions C2-C5 from CloudWatch logs only (retention is never-expire, so historical queries
   are free):
   C2 - MAX_PAGES_PER_RUN value; search 90 days for Cin7ItemPollerPageCapHit and, if found, what the
        NEXT cycle did (resumed vs skipped ahead).
   C3 - emit batch size per PutEvents call.
   C4 - triggered-product id chunk size; confirm zero 404s in 90 days.
   C5 - count Cin7ProductsFetched / Cin7ProductOptionsFetched / Cin7TriggeredProductsFetched per
        cycle across several historical cycles to get requests-per-cycle at real churn. This gates
        whether Phase 2 may use a 6-hour rewind window.

Write BUSY-1116-PHASE0-RESULTS.md. Put the OV findings first and at length - method, the actual log
lines as evidence, and an explicit MEASURED vs INFERRED marker on every claim. Flag anything that
contradicts the QA doc or Kian's runbook. Do not change any AWS resource. Do not set the watermark.
If something can't be established read-only, say so and stop rather than reaching for a write.
```

---

## 6. Phase 1 — OV4–OV6, then read-only extraction edges

Preview + GETs + log forensics. No watermark writes. **OV4/OV5 first** — they are the decisive half of the overlap question.

| TC | Test | Expected | Method |
|---|---|---|---|
| **OV4** | Reconciliation sweep: Cin7 truth set vs poller emit set | Every eligible record in a settled window was emitted | §3. **Any unexplained miss is a data-loss defect** — report as a rate, classify every diff |
| **OV5** | Write lag / clock skew sizing | Minimum `(read time − modifiedDate)` near zero | §3. This is the number that turns "no overlap" into either an accepted risk or a defect |
| **OV6** | Verdict + document correction | A single measured statement; the wrong document identified and corrected | §3. Written at the Phase 1 stop |
| **PW1** | Watermark boundary | No record at or after the last watermark is skipped | **Subsumed by OV1/OV2/OV4** — keep the ID for QA-doc traceability, point it at the OV evidence |
| **PW2** | Overlap re-emit | Duplicates emitted then coalesced | **Verdict depends on OV1.** If no overlap window exists, PW2 as written is N/A and convergence rests entirely on re-covered windows (TC4) plus Cin7's inclusive `>=` floor — say so explicitly rather than marking it PASS by association |
| **PW3** | Pagination boundary (250/251) | Page 2 fetched, nothing truncated | `preview-cin7-sync.sh` on a window sized to straddle 250 rows; confirm the page-2 fetch |
| **PW4** | Trigger id-chunking / where-clause 404 | Parents fetched in 100-id chunks, no 404 | Preview a window with >100 distinct triggered products (1 hour gave ~194) + confirm chunk count in historical logs. **C4 says this is the fix; prove it** |
| **PW5** | Option status filtering | Confirm which statuses emit | Kian's runbook states `Product.status = Public` **and** `ProductOption.status = Primary` only, everything else `Cin7InactiveSkip`. Find a mixed-status product in preview output and confirm |
| **PW7** | Product with zero eligible options | No emit, cycle still completes | Preview + a historical cycle where all of one product's options were skipped |
| **PW9** | UTC / DST | Correct window, no 10/11-hour skew | Preview with a UTC boundary value; confirm the returned range matches. Brisbane is UTC+10, no DST — the trap is a correct-format wrong-zone value, which validates fine. **Overlaps OV5's skew check — do them together** |
| **ERR3** | DLQ baseline | Depth + message inventory recorded | Read-only. Separate the inert QA evidence records from any new arrivals |
| **ERR4** | Validation-failure alarm gap | Still no generic/CTC `SenderValidationFailures` alarm | Re-confirm post-deploy; belongs to BUSY-1117 sign-off |

**Phase 1 stop → update:** the OV6 verdict (into the QA doc, the index page and the ticket), PW verdicts, and a defect raised if OV4/OV5 warrant one.

### Phase 1 kick-off prompt

```
Phase 1 of the BUSY-1116 re-test plan (BUSY-1116-RETEST-PLAN.md in this folder, Rev 2). Read
BUSY-1116-PHASE0-RESULTS.md first. Read-only + preview-cin7-sync.sh + direct Cin7 GETs only. No
watermark writes, no config changes. Stop at the end of Phase 1.

PRIORITY - finish group OV (plan §3): OV4, OV5, then write OV6.

  OV4 is the decisive test. Pick a settled historical window W (60-90 min, at least 24h old). Build
  the Cin7 truth set read-only for BOTH endpoints over W (preview-cin7-sync.sh --since plus a
  client-side upper bound - the preview has no upper bound). Build the emit set from poller logs for
  the cycles covering W. Diff both directions. Classify EVERY record present in Cin7 but absent from
  the emits as one of: expected-ineligible (Cin7InactiveSkip status gate), page-cap clamp,
  re-modified-since-W (inconclusive, exclude it), or UNEXPLAINED. Report unexplained misses as a rate
  over eligible records, not a yes/no. A clean diff does NOT prove safety on its own.

  OV5 - size the exposure. Per record, compute (poller read time - modifiedDate); take the MINIMUM
  across many records and cycles. Check for Cin7 clock skew against poller wall clock, including any
  negative lag. This number decides whether a zero-overlap floor is an accepted risk or a defect.

  OV6 - write the verdict: exact floor expression, inclusivity, timestamp granularity, whether
  out-of-order arrival occurs, measured lag/skew, OV4 miss rate. Then say which document is wrong -
  LLD §3.4 or Kian's runbook - and draft the correction. Decision rule from the plan: if there is no
  overlap AND OV3 or OV5 show real lag or out-of-order arrival, that is a design defect even if OV4's
  sample came back clean, because the exposure is structural. Draft the defect writeup if so.

Then PW2, PW3, PW4, PW5, PW7, PW9 plus the ERR3 DLQ baseline and ERR4 alarm-gap recheck, per the
method column. PW1 is subsumed by the OV evidence - point it there for traceability. Preview before
anything and keep every window as narrow as the case allows.

Write BUSY-1116-PHASE1-RESULTS.md: OV first and in full, then one section per PW case with method,
evidence, verdict (PASS/FAIL/BLOCKED/N-A) and a measured-vs-inferred marker.
```

---

## 7. Phase 2 — Bounded rewind (the measurement phase)

The only phase that spends real budget. **Entry conditions:** Phase 0's C5 requests-per-cycle baseline exists, and the 6-hour cap is confirmed by it (else fall back to 1 hour). Watermark writes only — no config changes except the deliberate, reverted `MAX_PAGES_PER_RUN` probe in PW10.

**Sequence matters:** PW10 first (cheapest, and it de-risks the cap question before a real rewind), then the bounded rewind carrying TC4–TC7 / STR1 / STR2 / PW8 / ID3 / ID4 / UP3 together — one rewind serves many cases because the bundle exercises them at once.

| TC | Test | Expected | Notes |
|---|---|---|---|
| **PW10** *(new)* | **Force a page-cap hit cheaply:** set `MAX_PAGES_PER_RUN=1` as a Lambda env var, rewind a narrow window that exceeds 250 rows on one endpoint | `Cin7ItemPollerPageCapHit` logged; watermark advances **only** over what was processed; the **next** cycle resumes and converges; **zero records dropped** | **Closes the single biggest AC3 unknown** (draft runbook §5 open item 2 / C2) without a deep expensive window. The env change is live, needs no deploy, and **does not survive a deploy** — revert it explicitly and prove it reverted. Verify records in = records out across the two cycles |
| **TC5** | Bounded rewind — **up to 6 hours** (≈4,949 records / ~678 triggered products at 08-07 churn) | Full modified-since range re-syncs within rate limits | **Previously DEFERRED on a rationale C5 says is wrong.** Preview, commit, measure. Start at 1 hour and step up only if the measured request cost matches the C5 prediction — don't open at 6 |
| **TC7** | Request budget + duration | Requests counted, duration recorded, compared against Kian's 90-requests/7-days figure | Count `Cin7*Fetched` log lines per cycle. **Closes draft runbook §5's derived-not-measured flag** |
| **TC4** | Re-covered window converges | One SCALE upsert per item | Already PASS; re-run as regression under the new batched emit |
| **TC6** | Idempotency across a real reset | Before/after SCALE item state identical, no duplicates | Was PARTIAL only because TC5 was deferred. Pick 3–5 named items, capture SCALE state before **and** after |
| **STR1** | Reset volume + budget | Recorded | Same run as TC5/TC7 |
| **STR2** | Coalesce under high duplicate volume | `BatchCoalesced` ratio reflects the duplicate ratio | Measure the ratio explicitly this time, not just convergence |
| **PW8** | Watermark = max across **both** endpoints | Confirmed where the two endpoints have different maxima | Now testable against the documented **raise-then-clamp** `resolveWatermark()` — a capped endpoint should clamp the combined value down. Pairs naturally with PW10 |
| **ID3** | `read_at` last-write-wins | Newer `read_at` wins regardless of arrival order | Sender log |
| **ID4** | Coalesce across a straddled flush | Net SCALE state = single upsert | Time an emit to straddle the ~3-min flush |
| **UP3** | Idempotent re-send | No duplicate, no side effect | Falls out of TC6 |

**Also record for the runbook:** measured records, requests, duration, cycles-to-converge, and any `PageCapHit`. Those figures are this phase's deliverable.

**Phase 2 stop → update:** TC5/TC6/TC7 statuses, the runbook's §5 figures, C2 and C5 verdicts, watermark `--unset`, queues 0/0, new DLQ arrivals purged.

### Phase 2 kick-off prompt

```
Phase 2 of the BUSY-1116 re-test plan (BUSY-1116-RETEST-PLAN.md in this folder, Rev 2). Read the
Phase 0 and Phase 1 results files first. This phase spends real Cin7 budget - the guardrails in §2 of
the plan are hard rules. Stop at the end of Phase 2.

Entry check: Phase 0's C5 measurement must show request cost tracking pages and id-chunks rather than
record count. If it does, the rewind cap for this phase is 6 HOURS (raised from 1 hour by JJ). If it
doesn't, stay at 1 hour and flag it.

Order:
1. PW10 first. Set MAX_PAGES_PER_RUN=1 on the poller (live env var, no deploy), rewind a previewed
   window that exceeds 250 rows on one endpoint, and prove the page-cap path: Cin7ItemPollerPageCapHit
   fires, the watermark advances only over what was processed, the next cycle resumes, and records in
   equals records out across the two cycles. Then REVERT the env var explicitly and confirm it's gone.
   Do PW8 alongside this - a capped endpoint should clamp the combined watermark down.
2. Then the bounded rewind carrying TC4, TC5, TC6, TC7, STR1, STR2, ID3, ID4, UP3 together. Start at
   1 hour, preview first, and step up toward 6 hours only if the measured request cost matches the C5
   prediction. Snapshot the watermark first. For TC6, capture SCALE state for 3-5 named items BEFORE
   the rewind.
3. Count requests properly: Cin7ProductsFetched / Cin7ProductOptionsFetched /
   Cin7TriggeredProductsFetched per cycle. Kian's runbook claims a 7-day reset cost 90 requests for
   17,886 records; our QA doc deferred TC5 believing a 6-hour window would eat the 5,000/day cap.
   Settle which is right, with numbers.

Teardown before you stop: watermark --unset --confirm, check-status.sh back to 0/0, purge only NEW
DLQ arrivals (leave the pre-existing inert QA evidence messages), and record measured records /
requests / duration / cycles-to-converge.

Write BUSY-1116-PHASE2-RESULTS.md with the measured figures in a form that can be pasted straight
into the runbook's request-budget section.
```

---

## 8. Phase 3 — Failure injection (destructive)

**Coordinate on staging before starting.** Blast radius is the whole shared CTC pipeline.

| TC | Test | Status going in | Approach this pass |
|---|---|---|---|
| **TC1 / TC2 / ERR1** | Force `/Products`, then `/ProductOptions` to fail | BLOCKED — three attempts on 08-06 defeated by warm-container credential caching; concurrency-0 and malformed-SSM writes blocked by the tooling permission classifier | **Do not repeat the 08-06 attempts.** Two cheaper levers, in order: (a) an **invalid `MAX_PAGES_PER_RUN`** (non-numeric) env value — a config-parse throw at init fails the cycle with the watermark untouched; weak (fails before fetch) but it proves the exit-early contract cheaply and reverts instantly; (b) if a Cin7 base-URL env var exists, point it at an unroutable host for one cycle. If neither works, **stop trying** — AC1 closes on the dev attestation from §5.4, which AC1 itself names as its evidence |
| **TC3** | Mid-emit failure | PARTIAL (sender-side organic fault characterised; poller-side unproven) | **Re-frame for C3:** emit is now batched ≤10 per `PutEvents`. Test whether a **partial batch** failure leaves the watermark untouched, and whether records already emitted in that cycle are re-covered next cycle (they should be — coalescing absorbs them) |
| **ERR5** | Whitespace `item_code` upstream of the queue | **FAIL (defect)** — record vanishes with no trace | **Gated on §5.1.** If the populator is still `LastModified 2026-08-03`, this is unfixed: confirm-still-broken by bus injection, don't re-litigate. If it **has** been redeployed, re-run all five whitespace shapes (interior / leading / trailing / tab / whitespace-only) and check `Errors` actually increments now, not just `Invocations`. Remember the poller path substitutes an underscore (Group F, 08-13) — bus injection's raw `{company}#{item_code}` concatenation is **not** representative, so a bus-injection FAIL is not automatically a live defect |
| **STR3** | Poison + healthy throughput | PASS | Regression only — one control record behind a poison batch |
| **ERR3** | DLQ landing + alarm threshold | PASS on landing; **alarm fire threshold never pinned down** | Saturated in ALARM since 08-10, so the threshold cannot be established end-to-end here. State it as an environment limit rather than leaving it open indefinitely |
| **ERR2** | Manhattan endpoint unavailable | NOT RUN | **Last, or defer.** Blast radius is every store's sends. Only with explicit coordination and immediate restore; deferring with a stated reason is a legitimate outcome |

**Phase 3 stop → update:** every injection verdict, all levers reverted and *proven* reverted, DLQ reconciled.

### Phase 3 kick-off prompt

```
Phase 3 of the BUSY-1116 re-test plan (BUSY-1116-RETEST-PLAN.md in this folder, Rev 2). DESTRUCTIVE
phase on a shared staging pipeline - JJ has coordinated. Read the Phase 0-2 results first. Stop at the
end of Phase 3.

Cases: TC1, TC2, TC3, ERR1, ERR5, STR3, ERR3 alarm threshold, ERR2 (last, or defer with a reason).

Hard constraints:
- Do NOT repeat the 08-06 injection attempts (secret corruption, forced cold start, reserved
  concurrency 0, malformed SSM write). They are documented as defeated by warm-container reuse and
  the tooling permission classifier. Try the two cheaper levers listed against TC1/TC2 in the plan,
  and if neither works, stop and record AC1 as closing on the dev integration-test attestation.
- ERR5 is gated on the Phase 0 populator LastModified. If the populator was not redeployed, this is
  a confirm-still-broken, not a re-test - and bus injection is not representative of the poller path
  for this defect.
- TC3 must be tested against the NEW batched emit (<=10 records per PutEvents), i.e. a partial-batch
  failure, not a per-record one.
- Revert every lever explicitly and prove it reverted. Reconcile the DLQ before stopping.

Write BUSY-1116-PHASE3-RESULTS.md, and list anything left reverted-but-unverified at the top.
```

---

## 9. Phase 4 — Runbook reconciliation & sign-off

No testing. This is the phase that closes the ticket.

1. **AC4 — the LLD link.** Confirmed absent. Needs a Confluence edit to LLD §3.4/§8 linking page 1845100600, and §13's outstanding-deliverable row cleared. Not QA's page to edit unilaterally — raise with Lachlan (LLD owner) / Kian.
2. **Correct the overlap documentation** — whichever way OV6 lands. If there is no overlap, LLD §3.4's `watermark − 5 minutes` bullet is wrong and every doc that inherited it (both runbooks, all three QA docs) needs the same correction. If there **is** an overlap, Kian's runbook's "Deployed configuration" section is wrong — and that page is the operational source of truth, so it matters.
3. **Reconcile the two runbooks.** Kian's published page mirrors the repo copy and carries the measured figures; our draft carries the operational judgement his page is thin on (when to use / when NOT to, the `cin7-watermark-stale` false-positive trap, "don't reset for one missing SKU", `SAVE` doesn't clear cleared fields, the whitespace hazard during mass re-sync). **Offer those as additions to the repo copy rather than publishing a second page** — one source of truth. Our draft then becomes provenance, not a deliverable.
4. **AC amendments to recommend:**
   - **AC3** — "within Cin7 rate limits, one cycle": the real bound is the **page cap**, not the rate limit, and a capped cycle legitimately takes several cycles. Reword to Phase 2's measured behaviour.
   - **AC1/AC4** — scope the DLQ guarantee explicitly to faults that **reach the queue**; the buffer-populator class (ERR5) has no DLQ path at all and currently reads as covered when it isn't.
   - **Overlap** — per OV6, plus a defect ticket if a miss window is real.
5. **Update the QA doc** with the corrected TC numbering, all re-test statuses, and a clean AC-by-AC coverage map (same shape as the 1115 map in the index doc §6).
6. **E2E handover section** — what this pass covers, what remains dev-attested, and the environment limits E2E should know: `send-dlq-depth` saturated, alerts topic with zero subscribers (nothing alarms), and whatever OV6 concludes about silent misses.

---

## 10. Known-unclosable in this environment — state, don't chase

- **`send-dlq-depth` alarm fire threshold** — saturated in ALARM since 08-10; a new arrival causes no fresh transition.
- **End-to-end alert chain** — alerts topic has zero subscriptions.
- **AC1 live forced failure** — infrastructure limit, not a missing hook. Dev attestation is the intended evidence.
- **ERR5 via the poller path** — the only known live-shaped fixture (product 29942, modified 08-06) is outside even the 6-hour rewind cap, and Cin7 is read-only so the shape can't be authored.
- **429 handling** — needs mocking at the `libs/cin7` boundary; BUSY-1115 TC10/TC11, dev-side.
- **Cin7's `modifiedDate` stamping semantics** (transaction start vs commit) — vendor behaviour, not observable from our side. Question for dev/vendor; it bounds how much of OV5's lag can ever be designed away.
