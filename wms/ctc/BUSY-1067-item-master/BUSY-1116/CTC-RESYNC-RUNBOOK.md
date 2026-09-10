# Runbook — CTC item sync: forced re-sync via watermark reset

**Deliverable of:** [BUSY-1116](https://universalstore.atlassian.net/browse/BUSY-1116) AC4 · **Tests:** QA Doc BUSY-1116 TC8 / TC9
**LLD:** [CTC Item Master Sync](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1765736449) §3.4, §8
**Status:** DRAFT for review — authored 2026-08-10 from measured findings to date.
**Two figures in §5 are derived, not measured** (flagged inline). TC7 closes them.
**Validated on:** `staging` only. See §9 before using this in production.

---

## 1. What this is, and when to use it

The CTC poller tracks one SSM parameter — the **watermark** — holding the UTC timestamp of the most
recent Cin7 `modifiedDate` it has successfully processed. Every cycle it asks Cin7 for everything
modified since that point, emits one record per product option, and advances the watermark only after
a fully successful cycle.

Writing an **older** timestamp into that parameter forces the poller to re-read and re-emit everything
modified since — a full re-sync. This is the recovery path when SCALE and Cin7 have drifted.

**Use it when:**

- SCALE item data is known to be stale or wrong across many items, and Cin7 is correct
- A defect or outage caused a window of changes to be missed and you know roughly when
- After a fix, to replay a period that was processed incorrectly

**Do NOT use it for:**

- **A single missing item.** Set a narrow window around that item's `modifiedDate` instead — a broad
  reset to fix one SKU is disproportionate and slower to verify.
- **Ordinary transient failures.** The poller is self-healing by design: any failure abandons the
  cycle with the watermark untouched, and the 3-minute schedule *is* the retry. A failed cycle
  re-covers itself on the next pass with no operator action.
- **Fields cleared in Cin7.** See §6 — a re-sync may not clear a field that was emptied at source.

**Symptom that looks like it needs this but doesn't:** the `cin7-watermark-stale` alarm. It
false-positives during ordinary `UNSET` idle, because the poller no-ops without emitting the
`Cin7PollerCycleComplete` metric the alarm watches. **Check whether the watermark is simply `UNSET`
before concluding anything is broken.**

---

## 2. Before you start

| Check | How | Expected |
|---|---|---|
| Current watermark noted | `./cin7-watermark.sh --stage <stage> --profile <profile>` | Record the exact value — this is your restore point |
| Pipeline is quiet | `./check-status.sh` | Queues 0/0 |
| DLQ baseline noted | `./check-status.sh` | **Measure it — do not trust a written number.** Inert synthetic QA messages are parked in `staging-catalog-manhattan-item-buffer-dlq.fifo` as evidence, and the count has been 6, then 0 (purged 08-10), then 3, then 4 — plus a 4-day retention that expires them on its own. `send-dlq-depth` reads **red** because of them and is **not** a real signal; it has been in `ALARM` since 08-10, so a new arrival won't produce a fresh transition. Note today's actual depth so you can tell new arrivals apart. There is only one DLQ queue — `send-dlq-depth` is an alarm watching it, not a second queue |
| Co-testers warned | — | The pipeline is **shared** (CTC + UNI/PO/SO). A large re-sync affects everyone's sends |
| Window previewed | §3 step 2 | Never skip this |

**One watermark, one lever.** There is a single parameter, so watermark-driven activity **cannot run
concurrently**. Confirm nobody else is mid-test before you write it.

---

## 3. Procedure

### Step 1 — Choose the look-back point

The watermark is **always UTC, ISO 8601, ending in `Z`** — e.g. `2026-07-20T00:00:00.000Z`. AEST is
UTC+10 (UTC+11 in daylight saving), so **subtract 10 hours** from local time. The script rejects
anything that doesn't match that format, which catches most mistakes but not a correct-format wrong-zone
value — a 10-hour error looks perfectly valid.

### Step 2 — Preview it (never skip)

```
./preview-cin7-sync.sh --since 2026-07-20T00:00:00.000Z
```

GET-only, never touches the watermark, never emits. It mirrors the poller's real logic — same queries,
same `/ProductOptions` trigger fan-in, same active-status gate, same field mapping — and prints what a
real cycle would produce, tagging each record `[primary]` or `[trigger]`.

Read the output for:

- **total records** — pipeline load and duration
- **`[trigger]` share** — usually the bulk; option edits don't bump the parent product's `modifiedDate`
- **`Hit --max-pages` warnings** — ⚠ see §5, this means the window is **truncated**, not just large
- **distinct productIds referenced only via `/ProductOptions`** — drives the phase-3 refetch cost

Two things the preview does **not** do: it queries from `--since` exactly, whereas the real poller
queries from **`watermark − 5 minutes`**, so a real cycle pulls slightly more; and it does consume Cin7
API calls itself (§5).

### Step 3 — Dry-run the write

```
./cin7-watermark.sh --stage <stage> --profile <profile> --set 2026-07-20T00:00:00.000Z
```

Without `--confirm` this validates and shows current-vs-requested without writing.

### Step 4 — Commit

```
./cin7-watermark.sh --stage <stage> --profile <profile> --set 2026-07-20T00:00:00.000Z --confirm
```

### Step 5 — Wait, and do not re-write

**The write is not visible to the Lambda on the next cycle.** SSM/Secrets caching means the cycle
immediately after typically still logs the old value, and the one after that (~3–6 min) picks it up.

> ⚠ **Confirm the write landed with a direct `get-parameter` (or re-run the script with no `--set`).
> Do not re-write it.** A second write is how a reset's cost and record volume get accidentally doubled.

Allow ~10 minutes total (poll cycle + ~3-minute buffer flush) before expecting anything in SCALE.

### Step 6 — Watch it run

```
./tail-logs.sh --stage <stage> --profile <profile> --lambda cin7-poller
./tail-logs.sh --stage <stage> --profile <profile> --lambda sender
```

Success per cycle is `{"metric":"Cin7PollerCycleComplete", ..., "watermarkAdvanced":true}`.
`Cin7PollerCycleFailed` means the cycle aborted and the watermark is untouched — it will re-cover on
the next pass.

**Manhattan always returns HTTP 200 regardless of outcome.** Judge delivery from the sender's
`accepted=N rejected=0` line, never the HTTP status.

### Step 7 — Confirm completion, then stand down

The re-sync is done when the watermark has advanced to approximately now and cycles return to normal
volume. Then **return the poller to idle** — see §8.

---

## 4. How far back a reset reaches

Everything with `modifiedDate >= (watermark − 5 minutes)`, across **both** endpoints:

- `/v1/Products` — the primary poll
- `/v1/ProductOptions` — **triggers only**; the poller collects parent product IDs and re-reads those
  products **in full**, so records are always built from a complete product read

Only `Product.status = Public` **and** `ProductOption.status = Primary` are emitted; everything else is
logged as `Cin7InactiveSkip`. The watermark advances to the max `modifiedDate` across **both** primary
and triggered products.

The practical reach is therefore *"every product whose product record OR any of its options changed
since the timestamp"* — which, because option edits do **not** bump the parent product's `modifiedDate`
(confirmed empirically, OQ-2), is substantially more than a naive read of `/Products` would suggest.

---

## 5. Expected duration and request budget

### Two different units — do not conflate them

This is the single most important thing on this page. **Records emitted** and **Cin7 API requests** are
different quantities, and the daily cap is on requests.

| Unit | What it measures | Cap |
|---|---|---|
| **Records** | One per eligible product option. Drives pipeline load, Manhattan sends, duration | No hard cap; a throughput concern |
| **Cin7 API requests** | HTTP calls to `api.cin7.com` | **5,000/day, shared across every stage on one prod token** |

A page returns up to **250** rows, and triggered products are refetched in ID batches of **100**. So
thousands of records cost tens of requests, not thousands.

### Measured record volumes

| Window | Records | Products | Source |
|---|---|---|---|
| ~70 min (2026-08-05) | 755 (64 `[primary]` + 691 `[trigger]`) | 100 triggered | Preview |
| 1 hour (2026-08-07) | 1,422 | 194 triggered | Preview |
| 6 hours (2026-08-07) | 4,949 | 678 triggered | Preview |
| Actual rewind (2026-08-06) | **4,304 records, drained in ~33 min** | — | Live run |

**Churn varies enormously** — ~24 records/min on 08-07 versus ~1/min on 08-05/06, a 24× swing.
**Re-measure at the start of every session; never reuse an older window's estimate.**

### Derived request cost — ⚠ NOT YET MEASURED

Applying the page arithmetic to the 6-hour figure above:

| Phase | Requests |
|---|---|
| `/Products` pages | ~1–2 |
| `/ProductOptions` pages (4,949 ÷ 250) | ~20 |
| Triggered by-id refetch (678 ÷ 100) | ~7 |
| **Total** | **~30 requests** |

**~30 requests is ~0.6% of the 5,000/day cap — not the ~100% implied by reading the record count as a
request count.** The preview costs roughly the same again, so preview-then-run is on the order of 60
requests.

> ⚠ **This arithmetic is derived from the preview script's request pattern, not measured against Cin7's
> actual counter. BUSY-1116 TC7 exists to measure it and is NOT RUN.** Treat it as the working
> hypothesis, not a guarantee. If it holds, the "a reset may consume the daily cap" concern recorded
> against TC5 is unfounded and the deferral should be revisited.

### Where the budget actually goes

An **active** poller at 3-minute cadence runs **480 cycles/day**, each making at least two requests
(`/Products` page 1 + `/ProductOptions` page 1) even on an empty window — **~960+ requests/day standing
cost**, roughly 20% of the shared cap, before anyone resets anything.

**This is why `--unset` when idle matters far more than avoiding resets.** An `UNSET` poller makes
**zero** Cin7 calls.

### The real constraint on a large reset: truncation, not cost

`preview-cin7-sync.sh` defaults to `--max-pages 20` **per endpoint**, and the real poller has the same
`MAX_PAGES_PER_RUN` bound. At 250 rows/page that is a 5,000-row ceiling per endpoint per cycle.

The 6-hour window above (4,949 records) sits **right on that ceiling**. A larger window will hit it.

> ⚠ **BUSY-1116 AC3 says a reset "re-syncs the full modified-since range within Cin7 rate limits, one
> cycle". The likely failure mode is not the rate limit — it is that a large range does not complete in
> one cycle at all, because pagination is capped.** Whether the poller resumes across cycles or silently
> drops the remainder is **unverified**. Establish this before relying on a wide reset.

**Practical guidance until TC7 and the above are settled:** start with a bounded look-back, watch for
`Hit --max-pages` in the preview, and if you see it, split the reset into sequential narrower windows
rather than one wide one.

### Duration

The one live datapoint: **4,304 records drained fully in ~33 minutes**, with ~10 transient
`network_error`/`TimeoutError` events and **zero permanent failures, zero new DLQ arrivals**. Depth
fluctuated rather than falling monotonically (organic traffic plus timeout-driven redelivery), then
cleared. Sustained high volume degrades **gracefully — slower and noisier, not lossy**.

Rough planning figure: **~2,000 records per 15 minutes**, dominated by the downstream pipeline rather
than the Cin7 read.

---

## 6. Why the re-sends are safe (idempotency)

1. The sender **coalesces** by `(company, item_code)`, keeping `max(read_at)` — duplicates arriving in
   one flush collapse into a single send.
2. Manhattan items are written with `Action=SAVE`, i.e. **upsert** — a re-send of unchanged data is a
   no-op in effect.
3. **Verified:** BUSY-1116 TC4 (PASS) — re-covered and overlapping windows converged to a single SCALE
   upsert per item with no duplicate side-effects. The poller's built-in 5-minute overlap exercises
   this on every ordinary cycle.

**Caveat — `SAVE` is additive.** Whether a field *cleared* in Cin7 is cleared or retained in SCALE is
**untested** (BUSY-1115 UP2, NOT RUN). Do not assume a re-sync repairs a deletion. If your drift
involves emptied fields, verify one item by hand before trusting the whole run.

**Caveat — full-reset idempotency is only partially evidenced.** TC6 is PARTIAL: convergence is proven
for overlap windows, but a before/after comparison across a genuine full reset has not been done,
because TC5 was deferred.

---

## 7. Hazards during a large re-sync

Volume raises the odds of hitting known defects that are rare at normal throughput.

| Hazard | What happens | What to do |
|---|---|---|
| **Whitespace in `item_code`** | `message_group_id` inherits it, SQS FIFO rejects it, and the **buffer-populator throws upstream of the queue**. It has no DLQ and no retry policy — the record **vanishes with no trace in the buffer or sender logs and no DLQ entry** | Highest-risk defect in a mass re-sync. If an item is later reported missing from SCALE and appears in **neither** the logs nor the DLQ, check `staging-catalog-manhattan-item-buffer-buffer-populator` logs directly |
| **Missing `item_code`** | Crashes the sender (uncaught throw). Bisection isolates it, other items keep sending, poison lands in the DLQ after exactly 10 retries (~30 min) | No action — self-resolving, but expect DLQ arrivals and ~30 min of retry noise |
| **`Desc` over 100 characters** | Manhattan **rejects, does not truncate** (`stringLength_100`). Becomes a poison record | Expect a handful in a wide reset; they isolate cleanly |
| **Batch timeouts** | 400+ item coalesced batches exceed Manhattan's ~25s timeout | Transient, retried successfully within the same minute. Not lossy |
| **Poison does not block throughput** | Verified: a known-good record fired behind a 4-poison batch was isolated and delivered in **~13 seconds** | No action — informational |
| **No alarm on CTC validation failures** | There is **no alarm** on the generic/CTC `SenderValidationFailures` (only per-store). 80+ failures in ~25 min alerted nobody | **Watch the sender logs actively during a reset. Do not rely on alarms to tell you it went wrong** |

---

## 8. Teardown

1. **Return the watermark to idle** — this is the norm between sessions, not a nicety:
   ```
   ./cin7-watermark.sh --stage <stage> --profile <profile> --unset --confirm
   ```
   `UNSET` is the "never run yet" sentinel; the poller logs `Cin7ItemPollerInactive` and **makes no
   Cin7 calls at all** until an operator sets a real date. In production, leave the watermark **live**
   instead — `UNSET` there would stop the integration.
2. `./check-status.sh` → queues back to **0/0**.
3. Purge any **new** send-DLQ arrivals your run created. Leave the six pre-existing inert QA messages.
4. **Record the measured record count, request count and duration** into this page's §5 — each real run
   is the only way these figures improve.

---

## 9. Open items — read before using this in production

1. **Request cost is derived, not measured** (§5). BUSY-1116 TC7 closes it.
2. **Pagination truncation on wide windows is unverified** (§5) — the most likely reason a reset would
   fail to deliver what AC3 promises.
3. **Prod resource names are unconfirmed.** Everything here is validated on `staging` and uses
   `/catalog/cin7-manhattan/item-watermark/{stage}`. The prod parameter, secret and poller names must be
   confirmed before this procedure is run against production.
4. **No reset has ever actually been executed.** TC5 is DEFERRED. This procedure is assembled from the
   watermark tooling, one large rewind (08-06) and preview-only sizing — it has not been walked
   end-to-end as written.
5. **`SAVE` semantics for cleared fields** are untested (§6).
6. **AC3 wording** — recommend amending "within Cin7 rate limits, one cycle" to reflect the pagination
   bound rather than the rate limit.

---

## 10. Provenance

Assembled 2026-08-10 from: QA Docs [BUSY-1114](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859387394),
[BUSY-1115](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354640),
[BUSY-1116](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354632); the QA bundle re-plan;
and direct reads of `cin7-watermark.sh`, `preview-cin7-sync.sh` and `emit-cin7-record.sh` in
`testing-tools/`. Command syntax verified against the scripts as of 2026-08-10.

**Before publishing:** link this page from the LLD (§3.4 / §8) to satisfy BUSY-1116 AC4, and re-check
§5's figures against whatever TC7 measures.
