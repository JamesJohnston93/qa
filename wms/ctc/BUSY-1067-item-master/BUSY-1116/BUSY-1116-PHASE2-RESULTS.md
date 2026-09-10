# BUSY-1116 Phase 2 Results — Bounded rewind (the measurement phase)

**Date:** 2026-08-14 · **Author:** Claude (QA forensics session) · **Scope:** Phase 2 of `BUSY-1116-RETEST-PLAN.md` Rev 2 only. Real Cin7 GET calls (previews) + one real watermark write/unset cycle. No Cin7 writes. No destructive actions. Watermark left `UNSET` at the end, confirmed.

**Method note (same convention as Phase 0/1):** every claim is tagged **MEASURED** (a literal quoted log line, or a direct AWS CLI read, cited with source), **INFERRED** (a conclusion drawn from measured facts, reasoning stated), or **UNKNOWN**.

---

## 0. Entry check and PW10 — read before anything else

**C5 entry condition: CONFIRMED, per Phase 0/1.** Both already established that request cost tracks pages/id-chunks, not record count. This phase adds a fresh, larger confirmation (§2). **6-hour rewind cap is in force.**

**PW10 (force `MAX_PAGES_PER_RUN=1` via live env var): BLOCKED, re-confirmed fresh this session.** Re-ran `aws lambda get-function-configuration` on `staging-catalog-cin7-cin7-item-poller` at session start — env vars are still exactly `WATERMARK_PARAMETER_NAME, STAGE, CIN7_SECRET_NAME, AWS_NODEJS_CONNECTION_REUSE_ENABLED, INTERNAL_EVENT_BUS_NAME`. Also checked SSM (`describe-parameters` filtered on `page` and `cin7`) for any alternate config lever — none found. **No env var, no SSM parameter, and no other config surface exists to force the cap.** Consistent with Phase 0/1's finding. **Did not attempt a no-op env-var write** (adding a key the code doesn't read would prove nothing and would itself be an unreviewed Lambda config change on shared infrastructure). **PW10 is recorded as BLOCKED-as-designed — this is a genuine tooling gap in the kick-off plan (it assumed a lever that doesn't exist on this deployment), not a QA failure.** Resuming it needs either a source-code-confirmed alternate mechanism or a deliberate redeploy with a different constant — both out of QA's read-only/no-deploy remit. **PW8 was run in its natural (non-forced) form instead** — see §4.

---

## 1. Window selection and sign-off

Two previews were run (both GET-only, `preview-cin7-sync.sh`), real time ≈2026-08-13T23:49–23:50Z:

| Window | Requests | Would-emit | Pages hit |
|---|---|---|---|
| 1h (`--since` 22:49:06Z) | 7 (1 Products + 4 ProductOptions + 2 trigger-chunks) | 968 (8 primary + 960 trigger) | 4/20 ProductOptions pages |
| 6h (`--since` 17:50:08Z) | 14 (1 + 9 + 4) | 2,184 (8 primary + 2,176 trigger) | 9/20-30 ProductOptions pages |

Cost tracked pages/chunks, not records, at both sizes — matching C5. Churn this session was much lower than the 08-07 baseline (CLAUDE.md's "24×" figure), so the decision was to go straight to the full 6-hour window rather than stepping incrementally, for the best TC5/TC7/STR1 figures.

**JJ's explicit sign-off obtained before writing anything** (per CLAUDE.md hard constraint — dry run shown, blast radius stated, asked in chat): approved the 6-hour window and approved using `claude-in-chrome` on the SCALE UI for TC6's before/after item-state capture.

**TC6 method changed mid-session, also by explicit JJ direction.** No Item Master / item-lookup screen could be found in the SCALE staging WMS UI after checking every top-level menu category (Receiving, Order Planning, Shipping, Cross Application incl. Configuration, Inventory, Work, Performance Management, System Management) in both the `UNI-QDC` and `CTC-QDC` facility contexts. The nearest analogue, **DIF Incoming Message Insight**, returned **0 records with every filter cleared and "Today Only" toggled off** — unexplained, and not chased further (out of scope for this phase; flagged for whoever next needs a UI-based item lookup). **JJ's call: skip the field-level snapshot, treat TC6 as convergence-only** (queue/DLQ state + sender accept/reject log evidence, no before/after item-field diff). This is recorded as a **methodology change, not a shortcut taken unilaterally** — see §6 for what TC6 rests on instead.

---

## 2. TC5 / STR1 / TC7 — the bounded rewind, measured

### 2.1 The write

```
Dry run shown and approved, then:
./cin7-watermark.sh --stage staging --profile staging --set 2026-08-13T17:50:08.000Z --confirm
Confirmed via direct get-parameter (not just script output): Version 175, Value 2026-08-13T17:50:08.000Z,
LastModifiedDate 2026-08-14T10:00:11+10:00 (=00:00:11Z)
```

Pre-write baseline (MEASURED): DLQ 18 waiting / 0 in-flight (unchanged from Phase 1's inventoried, all-inert figure). Buffer queue 0/0. Watermark previously `UNSET`.

### 2.2 The rewind cycle — MEASURED, verbatim

**SSM write picked up faster than the documented ~2-cycle caution**: next cycle started at `00:01:50.533Z`, ~1m39s after the write landed — the very next cycle, not the one after.

```
Cin7PollerCycleStart   watermark: 2026-08-13T17:50:08.000Z          (00:01:50.533Z)
Cin7PollerCycleComplete  productsFetched:331  productsFetchedPrimary:1
                          recordsEmitted:2270  recordsSkipped:18
                          watermarkAdvanced:true  newWatermark:2026-08-13T23:57:04.000Z
                                                                       (00:02:50.701Z)
```

**The entire 6h07m backlog (17:50:08Z → 23:57:04Z) converged in a single cycle.** This is the best-case outcome the plan's own sizing sanity check named ("it should converge in one cycle; if it doesn't, that itself is a C2 finding") — it did.

**Request tally for this one cycle (MEASURED, literal `Cin7ApiCallMade` paths):**

| Endpoint | Calls | Detail |
|---|---|---|
| `/Products` (primary) | 1 | page 1, floor `modifiedDate>='2026-08-13T17:50:08.000Z'` — identical literal to `/ProductOptions`, consistent with OV1 |
| `/ProductOptions` | 10 | pages 1–10, 250 rows each except the last |
| `/Products` (triggered, id-chunked) | 4 | chunk sizes summing to 330 (productsFetched 331 − primary 1), each call ≤100 ids, confirming C4's chunking again under real load |
| **Total** | **15** | for 2,270 emitted records / 331 products |

**Zero `Cin7ItemPollerPageCapHit`** despite 10 ProductOptions pages in one cycle — cap (whatever its real value is) not hit. **Zero `Cin7PollerCycleFailed`** anywhere in the test window.

**`recordsSkipped:18`** matches exactly the 18 `Cin7InactiveSkip` items from Phase 1's preview evidence (8× `Checkmate Shirred Mini Dress`, 1× `LIGHTER-ALL`, 9× `Gift Voucher` options) — same known-ineligible set, not a new finding, cross-checked as a sanity control.

### 2.3 TC7 — request budget, both scoped and whole-session

| Scope | Requests | Records emitted | Ratio (req/record) |
|---|---|---|---|
| The single rewind cycle | 15 | 2,270 | 0.0066 |
| Whole test session (11 cycles, 00:01:50–00:34:56, ~33 min, includes normal live cadence after the rewind cycle plus the trailing pre-unset cycle) | 51 (27 `/Products` + 24 `/ProductOptions`, MEASURED literal path counts) | 4,289 (sum of all 11 `Cin7PollerCycleComplete.recordsEmitted`) | 0.0119 |
| Kian's cited 7-day reset (runbook, not re-measured this session) | 90 | 17,886 | 0.0050 |

**Verdict: CONFIRMED, same order of magnitude as Kian's figure, both far below the "1 request per record" assumption that drove the original TC5 deferral.** The whole-session ratio is a little higher than the single-cycle ratio because most of the trailing cycles are small, high-request-per-record live-churn cycles (a `/Products` primary page + a few small trigger chunks for only 70–190 records) — consistent with C5's earlier finding that a *light* cycle still costs a request floor (≥1 Products + ≥1 ProductOptions + ≥1 trigger-chunk) regardless of how few records it carries.

### 2.4 STR1 — reset volume, recorded

2,270 records / 331 products / 15 requests / 1 cycle for the deliberate 6h07m rewind itself. See §2.3 table for the fuller-session figures.

---

## 3. TC4 — re-covered window converges

**PASS, MEASURED.** `watermarkAdvanced:true` on every one of 11 cycles, monotonic advance, zero regressions, zero failed cycles. The single rewind cycle cleanly absorbed the entire backlog with `recordsSkipped` matching the known-ineligible set exactly (no unexpected skips). Convergence to live real-time cadence took 10 further cycles after the rewind cycle (00:04:54 → 00:34:56), each a normal small live-churn cycle (10–47 products, 72–367 records) — i.e., the poller was fully "caught up" within one cycle and every cycle after that was just tracking new real edits, not still draining backlog.

---

## 4. PW8 — watermark = max across both endpoints (natural form, not forced)

**PASS, MEASURED, natural-form only — the forced-clamp variant (a deliberately capped endpoint) was not tested, since it depends on PW10, which is blocked (§0).**

In the rewind cycle, `/Products` and `/ProductOptions` used the **identical literal floor** (`2026-08-13T17:50:08.000Z`), consistent with OV1's Phase 0 finding. Neither endpoint hit its page cap in this cycle, so `resolveWatermark()`'s documented raise-then-clamp behavior was never exercised — there was nothing to clamp. **This case remains only partially proven**: the "raise across both endpoints to the combined max" half is confirmed by every cycle's `newWatermark` deriving cleanly from the max `modifiedDate` seen; the "clamp back down when one endpoint is capped" half is untested and stays contingent on PW10 being un-blocked.

---

## 5. STR2 — coalesce ratio under real duplicate volume

**MEASURED**, from all 18 `ManhattanBatch` lines logged by the sender across the whole test window (`{"metric":"ManhattanBatch","received":N,"coalesced":M}`):

| received | coalesced | collapsed |
|---|---|---|
| 534 | 534 | 0 |
| 267 | 267 | 0 |
| 267 | 267 | 0 |
| 534 | 534 | 0 |
| 267 | 267 | 0 |
| 267 | 267 | 0 |
| 537 | 517 | 20 |
| 268 | 268 | 0 |
| 269 | 249 | 20 |
| 534 | 430 | 104 |
| 267 | 243 | 24 |
| 267 | 187 | 80 |
| 538 | 380 | **158** |
| 253 | 243 | 10 |
| 368 | 367 | 1 |
| 265 | 265 | 0 |
| 191 | 191 | 0 |
| 128 | 128 | 0 |
| **6,021 total** | **5,604 total** | **417 (6.9%)** |

**Verdict: real, measurable coalescing occurred** — one batch alone collapsed 158 of 538 received (29%). The 6,021/5,604 totals exceed the poller's own distinct 4,289 `recordsEmitted` for the session; this is expected, not a discrepancy — see §6's explanation of retried (re-received) messages inflating the sender-side received/coalesced tallies without corresponding to new distinct records. **This directly answers the plan's instruction to "measure the ratio explicitly, not just convergence."**

---

## 6. TC6 / ID3 / UP3 — convergence-only evidence (per JJ's methodology change, §1)

No field-level SCALE item-state snapshot was taken (before or after) — this was an explicit, JJ-approved scope reduction after the Item Master UI lookup could not be located (§1). What follows is what the logs and queue state *do* establish, and what they explicitly do **not**:

**Established (MEASURED):**
- **Zero Manhattan rejections.** Every one of the 18 `ManhattanRequestOutcome` events was either `success` (14) or `network_error` (4) — **never `rejected`**. No schema/validation failures anywhere in this real ~4,289-record sample.
- **Zero new DLQ arrivals.** DLQ held at 18 waiting / 0 in-flight throughout — identical before, during, and after the rewind (checked repeatedly; a live monitor also watched continuously and reported no growth).
- **Buffer queue fully drained to 0/0** by the end of the session (after the trailing 306-record cycle from the SSM-unset lag finished processing) — every message that entered the FIFO queue was eventually deleted (processed), none stuck, none exhausted to the DLQ.
- **An organic, real transient-failure-and-recovery instance, larger than any previously recorded:** 4 of 18 sender invocations hit `{"metric":"ManhattanRequestOutcome","outcome":"network_error","code":"TimeoutError","durationMs":~27000}` on very large batches (500+ items, e.g. the batch containing all 8 sizes of product 49292 `WPDTC26-302F-*` plus ~525 others) — durations close to the sender's 30s Lambda timeout. **Because the DLQ never grew and the buffer queue fully drained, every one of these messages was necessarily retried successfully** (SQS FIFO only removes a message on successful processing or after `maxReceiveCount` retries land it in the DLQ — neither of the latter happened). This is a fresh, larger real-world confirmation of the CLAUDE.md-documented "network_error IS organically triggerable... degrades gracefully, not lossy" behavior, not a new finding but a good regression check under real load.

**Explicitly NOT established (the gap this scope reduction leaves):**
- Whether any specific item's **field values** are identical/correctly-updated before vs. after the rewind (TC6's literal ask).
- Whether a **duplicate SCALE-side upsert** occurred for any item as opposed to a clean single update (ID3/UP3's literal ask) — inferred-safe from the absence of any error/rejection signal and from OV1–OV2's already-measured inclusive-floor/coalescing mechanism (Phase 0/1), but **not independently re-verified this session at the item-field level**.

**Verdict: TC6/ID3/UP3 — PARTIAL, log-evidence-only.** No red flags found in what could be measured; the field-level idempotency claim itself rests on Phase 0/1's existing mechanism evidence plus this session's clean-queue/zero-rejection outcome, not on a fresh before/after diff. **Flag for whoever next has access to (or can find) a working Item Master lookup — this is the one genuine coverage gap this phase leaves open**, and it's a process/tooling gap (no findable screen), not a defect.

---

## 7. Teardown

```
./cin7-watermark.sh --stage staging --profile staging --unset --confirm
Confirmed via get-parameter: Version 188, Value "UNSET"
```

**check-status.sh, final state:**
```
staging-catalog-manhattan-item-buffer-buffer.fifo: 0 waiting, 0 in-flight
staging-catalog-manhattan-item-buffer-dlq.fifo:    18 waiting, 0 in-flight   <- unchanged from pre-test baseline
```

**Nothing new to purge** — DLQ depth is identical to the Phase 1-confirmed baseline (18, all pre-existing/inert QA evidence from named prior sessions). A live monitor watched the DLQ continuously through the whole test and reported zero growth events.

**One SSM-lag note for the record:** the poller ran one extra cycle (00:31:54→00:34:56, 306 records) on the old watermark before picking up the `UNSET` write — expected behavior per the documented SSM-write-lag gotcha, not an error. Those 306 records drained normally through the buffer with no DLQ impact.

---

## 8. Figures for the runbook's request-budget section

```
Bounded rewind test — 2026-08-14, BUSY-1116 Phase 2
Window: 6h07m (2026-08-13T17:50:08Z -> 23:57:04Z, actual max modifiedDate reached)
Cycles to converge: 1 (single cycle absorbed the entire window)
Records: 2,270 emitted, 18 skipped (known-ineligible), 0 rejected
Requests: 15 (1 Products-primary + 10 ProductOptions pages + 4 triggered-id-chunks of <=100 ids)
Duration: cycle start 00:01:50.533Z -> complete 00:02:50.701Z (~60s execution)
Page cap: not hit (10/20-30 pages used)
Whole test session (rewind + 10 subsequent live cadence cycles, ~33 min):
  51 requests total, 4,289 records emitted, 0 cycle failures, 0 page-cap hits
Compares to Kian's cited 7-day reset: 90 requests / 17,886 records (ratio same order of magnitude)
```

---

## 9. What Phase 3 needs to pick up

1. **PW10 needs a different mechanism or a decision to drop it.** No env var, no SSM parameter exists on the deployed poller to force `MAX_PAGES_PER_RUN`. Confirmed independently twice now (Phase 0, Phase 2). Whoever owns Phase 3/4 should either get a source-level answer from Kian/dev on the real constant name (if it's hardcoded, a value could still be confirmed by asking, even without QA being able to force it) or formally close PW10 as untestable-by-QA.
2. **PW8's forced-clamp half is still unproven** — same PW10 dependency.
3. **TC6/ID3/UP3 need a working Item Master or item-state lookup method if field-level verification is ever required.** The SCALE staging WMS UI's left-nav has no such screen under any category checked (both `UNI-QDC` and `CTC-QDC` facilities); `DIF Incoming Message Insight` returned 0 rows unfiltered, unexplained. This is worth a direct question to JJ or Kian outside of a test session — this phase spent real effort on it and came up empty, so a repeat attempt without new information is unlikely to succeed.
4. **The 4 organic `network_error`/`TimeoutError` events this session are good evidence to cite for TC3's re-framing** (Phase 3, C3: mid-emit failure is now a partial-batch failure under the batched ≤10-per-`PutEvents` emit and independently a partial-batch failure at the sender's coalesced-send layer too) — both layers were exercised for real this session, not just theorized.
5. **DLQ is still the same 18 inert messages** — nothing new for Phase 3's "purge only new arrivals" instruction to act on yet.
6. **Watermark confirmed `UNSET`**, version 188, as of session end.
