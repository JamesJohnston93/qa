# BUSY-1116 QA doc — pending table updates

**For:** [QA DOC - BUSY-1116](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354632/QA+DOC+-+BUSY-1116) · **Drafted:** 2026-08-17 · **Status: NOT YET APPLIED** — JJ applies these by hand.

Source evidence: `BUSY-1116-PHASE0-RESULTS.md` … `-PHASE3-RESULTS.md`.
QA docs for [1114](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859387394) and [1115](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354640) were already updated in Confluence 2026-08-17.

**Group prefixes:** OV = overlap window · PW = poller watermark · TC/ERR/STR/ID/UP as existing.

---

## 1. Fix the broken numbering first

Doc has `TC7` = runbook page, `TC10` = runbook content, no TC8/TC9 — but Sign-off cites TC5–TC7 and TC8/TC9. Renumber:

- **TC7** = request budget + duration
- **TC8** = runbook published **and linked from the LLD**
- **TC9** = runbook content review

---

## 2. New table — group OV (insert above the main TC table)

| TC | AC | Test | Status | Evidence |
|---|---|---|---|---|
| OV1 | AC1 | What does the query actually ask for? | **PASS** | Δ = 0s in all 14 cycles. `where=modifiedDate>='<watermark>'` — string-identical to the watermark. `>=` in every occurrence in full history, zero bare `>`. Both endpoints share the floor (37 lines, 0 mismatches). **No overlap window exists — LLD §3.4 wrong, Kian's runbook right.** |
| OV2 | AC2 | Floor inclusive? Boundary record re-emits? | **PASS** | Two clean cases: watermark unmoved, 20/20 and 8/8 records re-emitted as exact subsets. Granularity = whole seconds. Collision count **UNKNOWN** — no per-record `modifiedDate` in logs. |
| OV3 | AC1 | Out-of-order arrival? | **PASS (cycle level)** | 15-cycle chain non-decreasing, zero regressions. Rules out a poller-side bug; does not settle Cin7 write lag. |
| OV4 | AC1/2 | Reconciliation: Cin7 truth set vs emit set | **PASS — 0 misses** | 763/763 found, **0.0% miss rate**. One non-emit = expected-ineligible (21757). ⚠ Covers only 33% of the window — 67% had been re-edited within 2.5–4.5h. Clean sample, not a full audit. |
| OV5 | AC1 | Write lag / clock skew | **PASS** | Min lag **+19.7s**, zero negatives across 763 samples. Clock skew ≈0s. |
| OV6 | AC1 | Verdict + doc correction | **DONE — conditional accept** | Defect trigger NOT met (no negative lag, no regression). **Evidence-bound accepted risk, not "proven safe."** Blind spot: does Cin7 stamp `modifiedDate` at transaction start or commit — **Q for Kian/vendor.** LLD replacement text drafted in `PHASE1-RESULTS.md` §3.2. |

---

## 3. Main TC table — replacement rows

| TC | Status | Note |
|---|---|---|
| TC1 | **BLOCKED — closes on dev attestation** | Both remaining levers confirmed **inapplicable, not untried**: no `MAX_PAGES_PER_RUN` env var (3 reads), no Cin7 base-URL var. Stop attempting. Attestation = Kian's BUSY-1116 comments 2026-07-31 + PR 1522 — ⚠ narrative on a personal dev stage, **not a test file / names / green CI run**. |
| TC2 | **BLOCKED — as TC1** | Was "Confirmed by dev" with no citation. |
| TC3 | **PARTIAL — new reason** | Sender layer **PASS** (controlled test: poison + control, control delivered in ~22s). Poller layer **UNVERIFIED and unobservable** — `Pushed` logs the request *before* the call, never a response or `FailedEntryCount`. **Success and partial failure are indistinguishable.** Watermark could advance past records never queued. Same shape as ERR5, one layer earlier. **Raise as a new finding — needs a source answer, not more QA.** |
| TC4 | **PASS — upgraded** | `watermarkAdvanced:true` on all 11 cycles, monotonic, zero failures. `recordsSkipped:18` reconciles exactly to the known-ineligible set. |
| TC5 | **PASS — was DEFERRED; the rationale was wrong** | 6h07m window converged in **one cycle**: 331 products, 2,270 records, **15 requests**. Old "6h ≈ whole daily cap" conflated records with requests. |
| TC6 | **PARTIAL — convergence only, by decision** | Zero rejections (18/18 success or transient), zero DLQ growth, buffer drained 0/0, 4 organic timeouts all necessarily retried OK. **No field-level diff — no Item Master screen exists in the SCALE staging UI** (every menu checked, both facilities; DIF Insight returned 0 rows unfiltered). Tooling gap, not a defect. **Q for Kian.** |
| **TC7** | **PASS** | 15 req / 2,270 records / ~60s. Session: 51 req / 4,289 records. Kian's 7-day reset: 90 req / 17,886 — same order of magnitude. Paste-ready block in `PHASE2-RESULTS.md` §8. |
| **TC8** | **FAIL — on the link only** | Runbook **published 2026-08-03** (page 1845100600) — this doc's "not yet authored" claim was 10 days stale. But **LLD link absent**: §3.4/§8 silent, §13 still lists it outstanding. **Needs Lachlan/Kian, not QA.** |
| **TC9** | **PASS, one thin area** | Procedure / reach / duration / budget all present. **"When to use" thin.** Our draft has that plus the stale-alarm trap, "don't reset for one SKU", `SAVE`-doesn't-clear, whitespace hazard. **Offer as additions to the repo copy — don't publish a competing page.** |

**Delete:** old `TC7` (runbook page) → new TC8. Old `TC10` (content, marked PASS) → new TC9. Note TC10 was PASS while the same doc said the page didn't exist.

---

## 4. Contradiction register (new small table)

| # | Doc says | Deployed | Verdict |
|---|---|---|---|
| C1 | `watermark − 5 min` | No overlap, exact watermark, `>=` | **LLD wrong** |
| C2 | `MAX_PAGES_PER_RUN`=30, env-settable | Not an env var; cap never fired (max 8 pages) | **Value UNKNOWN** — ask Kian |
| C3 | One `PutEvents` per record | Batched ≤10 (2,678 of 2,821 = exactly 10) | **LLD wrong** |
| C4 | 100-id chunking, 404 risk | Chunks ≤100, max hit; zero 4xx ever | **Confirmed** |
| C5 | 6h ≈ whole daily cap | 15 requests, 1 cycle | **Deferral wrong** |
| C6 | Runbook not authored | Published; LLD link missing | **Half-satisfied** |

---

## 5. STR / ERR changes

| TC | Was → Now | Note |
|---|---|---|
| STR1 | DEFERRED → **PASS** | 2,270 records / 331 products / 15 req / 1 cycle. |
| STR2 | PARTIAL → **PASS** | Ratio measured: 6,021 received → 5,604 coalesced = **417 (6.9%)**; one batch collapsed 158/538. |
| STR3 | PASS → **PASS, reconfirmed** | Now a deliberate controlled test, not just organic. |
| ERR1 | BLOCKED → **BLOCKED, closes on attestation** | Not re-run — would only reproduce existing evidence at cost. |
| ERR2 | NOT RUN → **DEFERRED (JJ, 2026-08-14)** | Blast radius = every store's sends. Secret never read or touched. Stated reason, not an untested gap. |
| ERR3 | PASS → **PASS, threshold now exact** | `send-dlq-depth`: **>0, 1×300s** — any single message fires it. In ALARM since 08-10. Reframe as a limit on *demonstration*, not knowledge. Landing reconfirmed 18→19, 11 receives, body intact. Don't confuse with the validation alarm's >10/900s. |
| ERR4 | CONFIRMED (gap) → **⚠ WITHDRAWN, finding was wrong** | `staging-catalog-manhattan-sender-validation-failures` **exists**, right metric, >10/900s, configured 08-10, and had a **real near-miss of 9/10** on 08-13. Missed because `check-status.sh` never checks it. **Real gap is narrower: zero SNS subscribers.** Don't conflate in the 1117 writeup. |
| ERR5 | FAIL → **FAIL, confirm-still-broken** | Populator `LastModified` still 2026-08-03 (3rd confirmation), no DLQ config. Fresh probe reproduced it; **`Invocations: 407`, `Errors: 0`** — exception swallowed at INFO. A DLQ alone would never fire; needs a code change. ⚠ **Severity uncertain** — real poller produced `CTC#WTW23-922G_-S` (underscore) and those options traversed fine, so bus injection may be unrepresentative. **Q1 to Kian decides live defect vs harness artefact. Ask before writing the ticket.** |

---

## 6. PW / ID / UP changes

| TC | Was → Now | Note |
|---|---|---|
| PW1 | NOT RUN → **N/A** | Subsumed by OV1/OV2/OV4; keep the ID as a pointer. |
| PW2 | PARTIAL → **N/A as written** | No overlap buffer exists, so overlap-duplicates can't happen. Duplication comes from the inclusive `>=` boundary. **Deliberately not upgraded to PASS.** |
| PW3 | NOT RUN → **PASS** | Pages 1–20 all exactly 250 rows; loop stopped on the page cap, never a short page. |
| PW4 | NOT RUN → **PASS** | ~700 ids chunked `100×6, 95–96`; zero 4xx. |
| PW5 | NOT RUN → **PASS** | Eligible = `Product.status=Public` AND `ProductOption.status=Primary`. Counter-examples for each half — note **`Active` is NOT eligible** (45827). |
| PW6 | NOT RUN → **unchanged** | See 1115 TC7 — closed on the ticket without QA execution or attestation. |
| PW7 | NOT RUN → **PASS** | 4 all-Disabled products emitted zero records; same run still emitted 4,979 from others. |
| PW8 | PARTIAL → **PARTIAL (natural form)** | Identical floor on both endpoints. No cap hit, so raise-then-clamp never exercised. Clamp half contingent on PW10. |
| PW9 | NOT RUN → **PASS** | No parse/convert step exists between watermark and query (character-identical, 15 cycles); clocks agree. The trap is procedural (hand-set watermark), mitigated by the script's UTC enforcement. |
| **PW10** *(new)* | — | **BLOCKED as designed.** No `MAX_PAGES_PER_RUN` env var, no SSM parameter, no other lever (3 reads + SSM sweep). No-op env write deliberately not attempted. **Cheapest close: ask Kian for the constant — knowing it doesn't require forcing it.** |
| ID3 / ID4 | NOT RUN → **PARTIAL** | Log evidence only; no field-level SCALE diff (see TC6). ID4 also supported by STR2's ratio. |
| UP3 | PARTIAL → **PARTIAL** | Unchanged in substance. |

---

## 7. Sign-off replacement

**Testing COMPLETE — Phases 0–3 all executed 2026-08-13/14. Phase 4 is documentation only.**

| AC | Verdict | To close |
|---|---|---|
| AC1 forced failure / watermark held | **PASS** — dev attestation + a real uninjected `TimeoutError` cycle where the watermark held and the retry advanced from the identical floor | Optional: harder citation from Kian |
| AC2 duplicates converge | **PASS on convergence, PARTIAL at field level** | Blocked on the missing SCALE item lookup |
| AC3 reset in one cycle | **PASS** | Nothing. **Reword** — real bound is the page cap, not the rate limit |
| AC4 runbook published **and linked** | **FAIL on the link only** | **Confluence edit by Lachlan/Kian — the long pole** |

**Three new tickets to raise:** the `PutEvents` response blind spot (TC3) · ERR5 confirmed unfixed (pending Kian on severity) · `check-status.sh` two-bug fix (doubled `cin7-cin7-`; never checks the sender-validation alarm).

**LLD corrections to hand over:** §3.4 overlap claim, §3.3 step 5 per-record emit. Text drafted in `PHASE1-RESULTS.md` §3.2.

**Also:** there is **no QA doc for BUSY-1117** in the QD space. Its findings currently live only inside the 1114/1115/1116 docs — worth creating one before that ticket signs off.
