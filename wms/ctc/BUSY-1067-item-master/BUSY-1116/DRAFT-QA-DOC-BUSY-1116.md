# QA DOC - BUSY-1116 — full replacement content

**Target:** Confluence page 1859354632 · **Drafted:** 2026-08-18 · **Status: DRAFT — JJ applies by hand, not yet pushed.**

**Basis:** `BUSY-1116-QA-DOC-UPDATES.md` (2026-08-17 draft), reconciled against two results files that
post-date it — `CTC-WHITESPACE-REAL-PATH-RESULTS.md` and `CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md`
(both 2026-08-18) — plus `PLAN-C-SCALE-MANUAL-CHECKS.md` (2026-08-18). Two rows changed materially
from the 08-17 draft: **TC3** and **ERR5**, both now closed with no ticket. Everything else below is
the 08-17 draft carried forward unchanged.

**Testing status: COMPLETE.** Phases 0–3 executed 2026-08-13/14. Plans A, B, C (the three follow-up
questions the Phase 0–3 pass left open) all completed 2026-08-18. Phase 4 is documentation only.

---

## 1. Numbering fix

The live doc has `TC7` = runbook page, `TC10` = runbook content, no TC8/TC9, but its own Sign-off
section cites TC5–TC9. Renumber:

- **TC7** = request budget + duration
- **TC8** = runbook published **and linked from the LLD**
- **TC9** = runbook content review

Delete old TC7 (runbook page) → folds into new TC8. Old TC10 (content, marked PASS) → new TC9.

---

## 2. New table — group OV (insert above the main TC table)

| TC | AC | Test | Status | Evidence |
|---|---|---|---|---|
| OV1 | AC1 | What does the query actually ask for? | **PASS** | Δ = 0s in all 14 cycles. `where=modifiedDate>='<watermark>'` — string-identical to the watermark. `>=` in every occurrence in full history, zero bare `>`. Both endpoints share the floor (37 lines, 0 mismatches). **No overlap window exists — LLD §3.4 wrong, Kian's runbook right.** |
| OV2 | AC2 | Floor inclusive? Boundary record re-emits? | **PASS** | Two clean cases: watermark unmoved, 20/20 and 8/8 records re-emitted as exact subsets. Granularity = whole seconds. Collision count **UNKNOWN** — no per-record `modifiedDate` in logs. |
| OV3 | AC1 | Out-of-order arrival? | **PASS (cycle level)** | 15-cycle chain non-decreasing, zero regressions. Rules out a poller-side bug; does not settle Cin7 write lag. |
| OV4 | AC1/2 | Reconciliation: Cin7 truth set vs emit set | **PASS — 0 misses** | 763/763 found, 0.0% miss rate. One non-emit = expected-ineligible (21757). ⚠ Covers only 33% of the window — 67% had been re-edited within 2.5–4.5h. Clean sample, not a full audit. |
| OV5 | AC1 | Write lag / clock skew | **PASS** | Min lag +19.7s, zero negatives across 763 samples. Clock skew ≈0s. |
| OV6 | AC1 | Verdict + doc correction | **DONE — conditional accept** | Defect trigger not met (no negative lag, no regression). Evidence-bound accepted risk, not "proven safe." Blind spot: does Cin7 stamp `modifiedDate` at transaction start or commit — **Q for Kian/vendor.** LLD replacement text drafted in `PHASE1-RESULTS.md` §3.2. |

---

## 3. Main TC table — replacement rows

| TC | Status | Note |
|---|---|---|
| TC1 | **BLOCKED — closes on dev attestation** | Both remaining levers confirmed inapplicable, not untried: no `MAX_PAGES_PER_RUN` env var (3 reads), no Cin7 base-URL var. Stop attempting. Attestation = Kian's BUSY-1116 comments 2026-07-31 + PR 1522 — ⚠ narrative on a personal dev stage, not a test file / names / green CI run. |
| TC2 | **BLOCKED — as TC1** | Was "Confirmed by dev" with no citation. |
| **TC3** | **RESOLVED 2026-08-18 — latent risk, no occurrence. Note to dev, NOT a defect ticket.** | Sender layer **PASS** (controlled test: poison + control, control delivered in ~22s). Poller layer: `PutEvents` response handling remains **UNKNOWN by direct code inspection** — the `Pushed {"Entries":[...]}` line logs the outbound request *before* the call, never a response or a `FailedEntryCount` check (0 occurrences of the string, full history, independently re-verified). **But the observable consequence of not checking it has never occurred.** Two independent hour-by-hour cross-checks across the poller's **entire recorded lifetime** (175 cycles, 2026-08-04→08-14): poller `recordsEmitted` = bus `MatchedEvents` = populator receipts = **31,731, exactly, in every hour**, zero shortfall in either reconciliation. A partial `PutEvents` failure would show as a poller-side count exceeding the bus/populator count in some hour — it never does. Separately: `PutEventsFailedEntriesCount` carries **zero dimensions account-wide** (455-day sum 100,373 against 157M account-wide calls, ours ≈3,174 calls ≈0.002%) — it cannot be scoped to our bus, so it could never have answered this question even if pulled. What is bus/rule-scoped (`Invocations`, `MatchedEvents`, `TriggeredRules`, `FailedInvocations`) was used instead, and `FailedInvocations` has never fired for either of our rules while it has for other rules in the same account. **Verdict: do not run Tier B2** — it would deliberately strand real records to prove a behaviour with zero evidence of ever occurring across ~2 weeks of real churn. **Recommended note to dev:** check and log `FailedEntryCount` on the `PutEvents` response even when zero — defense-in-depth, not a fix for an observed defect. See `CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md`. |
| TC4 | **PASS — upgraded** | `watermarkAdvanced:true` on all 11 cycles, monotonic, zero failures. `recordsSkipped:18` reconciles exactly to the known-ineligible set. |
| TC5 | **PASS — was DEFERRED; the rationale was wrong** | 6h07m window converged in one cycle: 331 products, 2,270 records, 15 requests. Old "6h ≈ whole daily cap" conflated records with requests. |
| TC6 | **PARTIAL — the before/after diff was never taken; the risk it protected against is separately closed** | Established: zero rejections (18/18 success or transient), zero DLQ growth, buffer drained 0/0, 4 organic timeouts all necessarily retried OK. **Not established, and stated plainly: no before-snapshot of SCALE item state was captured** — JJ deliberately skipped it on 2026-08-14 when no Item Master screen could be found, so TC6's literal ask (compare item state before vs after a reset) has no evidence and cannot be marked PASS. **What has since been closed is the underlying concern:** the screen was later found, and Plan C check 5 confirmed `WPDTC26-302F-*` exists as **8 unique sizes with no duplicates** after a 500+ item batch that hit a `TimeoutError` and was retried — the case most likely to duplicate, and it didn't. That closes the duplicate-creation risk (see UP3/ID4) without closing TC6 as written. **Recommend either rewording TC6 to "no duplicate items after a reset" — which is PASS — or leaving it PARTIAL with this gap named.** |
| **TC7** | **PASS** | 15 req / 2,270 records / ~60s. Session: 51 req / 4,289 records. Kian's 7-day reset: 90 req / 17,886 — same order of magnitude. Paste-ready block in `PHASE2-RESULTS.md` §8. |
| **TC8** | **FAIL — on the link only** | Runbook **published 2026-08-03** (page 1845100600) — this doc's "not yet authored" claim was 10 days stale. But LLD link absent: §3.4/§8 silent, §13 still lists it outstanding. Needs Lachlan/Kian, not QA. |
| **TC9** | **PASS, one thin area** | Procedure / reach / duration / budget all present. "When to use" thin. Our draft has that plus the stale-alarm trap, "don't reset for one SKU", `SAVE`-doesn't-clear, whitespace hazard. Offer as additions to the repo copy — don't publish a competing page. |

---

## 4. Contradiction register

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
| STR2 | PARTIAL → **PASS** | Ratio measured: 6,021 received → 5,604 coalesced = 417 (6.9%); one batch collapsed 158/538. |
| STR3 | PASS → **PASS, reconfirmed** | Now a deliberate controlled test, not just organic. |
| ERR1 | BLOCKED → **BLOCKED, closes on attestation** | Not re-run — would only reproduce existing evidence at cost. |
| ERR2 | NOT RUN → **DEFERRED (JJ, 2026-08-14)** | Blast radius = every store's sends. Secret never read or touched. Stated reason, not an untested gap. |
| ERR3 | PASS → **PASS, threshold now exact** | `send-dlq-depth`: >0, 1×300s — any single message fires it. In ALARM since 08-10. Reframe as a limit on *demonstration*, not knowledge. Landing reconfirmed 18→19, 11 receives, body intact. Don't confuse with the validation alarm's >10/900s. |
| ERR4 | CONFIRMED (gap) → **WITHDRAWN, finding was wrong** | `staging-catalog-manhattan-sender-validation-failures` exists, right metric, >10/900s, configured 08-10, and had a real near-miss of 9/10 on 08-13. Missed because `check-status.sh` never checked it — **now fixed** (2026-08-18: doubled `cin7-cin7-` alarm-name bug fixed; this alarm name added to the checked list). Real gap is narrower: zero SNS subscribers. Don't conflate in the 1117 writeup. |
| **ERR5** | FAIL → **RESOLVED 2026-08-18 — harness artefact, no ticket** | Populator `LastModified` still 2026-08-03, no `DeadLetterConfig` — genuinely unfixed **as a latent gap**, but nothing currently reaches it. **Full-account scan** (24,641 products / 137,114 options / 95,506 poller-eligible, ~99 GETs, GET-only): 13 products / 47 poller-eligible options carry whitespace in the bare `productOptionCode` — not the script's own printed "2,942," which was a field-matching artefact (it counted `productOptionSizeCode`, `supplierCode`, `styleCode`, none of which reach the group id). **Mechanism corrected.** The prior write-up ("group id assembled from separate clean fields, `{company}#{productOptionCode}_{size}`") is **falsified**: product 29942's `size` field reads `'S'`, not `'-S'`, so that construction predicts `CTC#WTW23-922G_S`, which is not what the logs show. The construction that reproduces the observed `CTC#WTW23-922G_-S` exactly is **`{company}#re.sub(r"\s+","_",code)`** — the poller collapses each whitespace run in `item_code` to a single underscore. This sanitises whitespace *anywhere* in `item_code`, including the bare `productOptionCode`, so the 13 residual products are sanitised the same way 29942 was. **SCALE-end confirmation (Plan C check 6):** all six of 29942's options exist in SCALE staging with the interior double space intact (`WTW23-922G  -XS` … `-XXL`, copied verbatim from the dashboard) — proof the record travelled the real poller path end to end. **Verdict: CS5/ERR5 is a harness artefact.** Bus-injection's raw `{company}#{item_code}` concatenation is not what the poller does, so a FAIL produced by injection here was never a live defect. **DO NOT RAISE THE TICKET.** Tags: field inventory and scan counts **MEASURED**; the collapse transform is **MEASURED (field values) + INFERRED (transform)** — exact string reproduction plus falsification of the alternative, not a code read. **Residual, low severity, kept on record:** the populator still has no containment for a raw-whitespace group id and swallows the exception at INFO (`Invocations: 407, Errors: 0`) — latent for any *future* producer that raw-concats without the poller's sanitiser, not a current risk. See `CTC-WHITESPACE-REAL-PATH-RESULTS.md`. |

---

## 6. PW / ID / UP changes

| TC | Was → Now | Note |
|---|---|---|
| PW1 | NOT RUN → **N/A** | Subsumed by OV1/OV2/OV4; keep the ID as a pointer. |
| PW2 | PARTIAL → **N/A as written** | No overlap buffer exists, so overlap-duplicates can't happen. Duplication comes from the inclusive `>=` boundary. Deliberately not upgraded to PASS. |
| PW3 | NOT RUN → **PASS** | Pages 1–20 all exactly 250 rows; loop stopped on the page cap, never a short page. |
| PW4 | NOT RUN → **PASS** | ~700 ids chunked `100×6, 95–96`; zero 4xx. |
| PW5 | NOT RUN → **PASS** | Eligible = `Product.status=Public` AND `ProductOption.status=Primary`. Counter-examples for each half — note `Active` is NOT eligible (45827). |
| PW6 | NOT RUN → **unchanged** | See 1115 TC7 — closed on the ticket without QA execution or attestation. |
| PW7 | NOT RUN → **PASS** | 4 all-Disabled products emitted zero records; same run still emitted 4,979 from others. |
| PW8 | PARTIAL → **PARTIAL (natural form)** | Identical floor on both endpoints. No cap hit, so raise-then-clamp never exercised. Clamp half contingent on PW10. |
| PW9 | NOT RUN → **PASS** | No parse/convert step exists between watermark and query (character-identical, 15 cycles); clocks agree. The trap is procedural (hand-set watermark), mitigated by the script's UTC enforcement. |
| PW10 | — | **BLOCKED as designed.** No `MAX_PAGES_PER_RUN` env var, no SSM parameter, no other lever (3 reads + SSM sweep). No-op env write deliberately not attempted. Cheapest close: ask Kian for the constant — knowing it doesn't require forcing it. |
| **ID3** | NOT RUN → **PARTIAL — deliberately NOT upgraded to PASS** | ⚠ ID3's actual claim is *"newer `read_at` wins **regardless of arrival order**"*. Plan C check 5 proves **no duplicates after a retry**, and UP1 proves two sequential SAVEs apply in the order sent — **neither tests out-of-order arrival**, which is the specific thing ID3 asserts. No test ever inverted arrival order against `read_at`. Recording as PARTIAL rather than borrowing UP3's evidence for a different claim. Closing it would need either a deliberate out-of-order injection or dev attestation on the sender's coalesce ordering. |
| **ID4** | NOT RUN → **PASS** | Coalescing across a straddled flush is evidenced by STR2's measured ratio (6,021 received → 5,604 coalesced, one batch collapsing 158/538) plus Plan C check 5's no-duplicate field-level result. |
| UP3 | PARTIAL → **PASS (upgraded 2026-08-18)** | Same evidence as ID3 above — no duplicates after rewind + retry. ⚠ Scope note from Plan C check 3: idempotency holds for values that are **present**, not for **deletions** (see §7 AC2 below). |

---

## 7. Sign-off replacement

**Testing COMPLETE — Phases 0–3 executed 2026-08-13/14. Plans A, B, C completed 2026-08-18. Phase 4 is documentation only.**

| AC | Verdict | To close |
|---|---|---|
| AC1 forced failure / watermark held | **PASS** — dev attestation + a real uninjected `TimeoutError` cycle where the watermark held and the retry advanced from the identical floor | Optional: harder citation from Kian |
| AC2 duplicates converge | **PASS** — convergence and field-level idempotency both now confirmed (ID3/ID4/UP3, Plan C check 5). ⚠ **Scoped to present values only** — Plan C check 3 measured that SCALE does not clear a field on an empty tag (`SAVE` is additive), so the convergence argument holds for values that exist, not for deletions. Reword AC2's text to say so explicitly | Wording edit only |
| AC3 reset in one cycle | **PASS** | Nothing. Reword — real bound is the page cap, not the rate limit |
| AC4 runbook published and linked | **FAIL on the link only** | Confluence edit by Lachlan/Kian — the long pole |

**Tickets to raise: none from Plan A or Plan B.** Both closed 2026-08-18 without a defect:

- **TC3 / `PutEvents` blind spot** → note to dev only (log `FailedEntryCount`), not a ticket. See §3.
- **ERR5 / whitespace** → harness artefact, not a ticket. See §5.
- **`check-status.sh` two bugs** → already fixed 2026-08-18 (correct alarm names; sender-validation alarm now checked). No ticket needed.

**QA is raising NO tickets from this epic — and no Jira ticket has been created.** One behaviour is handed
to the project team as **findings** for them to decide on, tracked separately and not part of 1116's own AC
set: the sender's invocation aborts when a single record fails validation.

✅ **RESOLVED 2026-08-18 by Plan D — the concern is closed and much smaller than it looked.**
**Run 1:** 1 over-length-`Size` poison + **20 valid controls** in one flush → **all 20 delivered**,
`rejected=0`, only the poison isolated, DLQ **+1**. **Run 2:** 1 CTC poison + **5 valid UNI controls** →
`ManhattanBatch received=6 coalesced=6` (confirming the batch is **not** company-scoped) and **all 5 UNI
records delivered**, none reaching the DLQ. **So a CTC data error cannot block UNI item sync** — the
cross-tenant risk is closed too.

⚠ **The mechanism was mis-attributed in every prior doc, including this one.** Isolation is **not the
sender's** — its `.map()` has no per-item try/catch and dies in **113ms** on the first bad element
(`validateItemDownload` `index.js:14863` → `Array.map` `14902` → `Runtime.handler` `14887`). Recovery
happens one layer up: `staging-catalog-manhattan-item-buffer-buffer-handler` wraps every sender call in
`processWithBisect` and **recursively halves the batch on any failure** — measured
`21 → 10+11 → 5+5 → 2+3 → 1+1`, logging `"Poison pill identified"`. Proven **content-agnostic** (Mode A
throws and Mode B rejections handled identically) and **tenant-agnostic**. **State both halves when
describing this to dev:** the sender genuinely has no containment; the handler absorbs it.

**Worst-case cost to a co-batched valid record: one buffer cycle (~3 min) plus a few seconds of bisection.**
The 36s (Run 1) vs 77s (Run 2) difference is **where in the 3-minute polling cycle the records were sent**,
not batch size or failure type.

**What remains for dev — two questions, neither a defect:** the `weight` type-guard gap (no validation check
in front of it, so a failure logs no reason — a diagnosability issue, not a risk, since the bisection
contains it anyway) and what should happen to records that reach the DLQ, given nothing notifies anyone.
Handover pack: `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`. Evidence:
`MODEA-BATCH-CONTAINMENT-RESULTS.md`.

**LLD corrections to hand over:** §3.4 overlap claim, §3.3 step 5 per-record emit. Text drafted in `PHASE1-RESULTS.md` §3.2.

**BUSY-1117 QA doc:** now drafted — see `DRAFT-QA-DOC-BUSY-1117.md`. None existed before; its findings previously lived only inside the 1114/1115/1116 docs.

---

## Not substantiated by the results files — flagged, not filled in

- **OV6 / TC1 / TC2's Kian citation** — "Kian's BUSY-1116 comments 2026-07-31 + PR 1522" is repeated from
  the 08-17 draft; no results file in this pass re-verified that citation still resolves. Confirm before
  publishing if that matters to the reviewer.
- **AC2/AC3 exact reworded sentences** — flagged that wording needs to change (deletions scope, page-cap
  bound) but the literal replacement sentence for the Confluence page itself is JJ's call, not drafted
  here, since neither results file supplies exact replacement prose.
