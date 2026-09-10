# CTC item master QA — current state & results index

**As at:** 2026-08-18 · **Owner:** JJ (QA) · **Measured-state record.**

> ➡ **For what to DO next, work from `FINAL-WRAPUP-RUNSHEET.md` (rev 2)** — it carries the ordered
> action list and the AWS verification map. ⚠ **§1 and §4 below have drifted:** the 1116 QA doc is
> **no longer stale** (page 1859354632 applied 2026-08-18, v10), a **1117 QA doc now exists**
> (page 1894088713, v2), the E2E handover page exists (1894973441), and **Plan D Run 2 is COMPLETE
> and passed** (5/5 UNI controls delivered from a CTC poison's batch — cross-tenant risk CLOSED).
> The runsheet's §0 is authoritative on ticket and Confluence state.

**Ticket state:** BUSY-1113 **Done** · 1114 **Done** · 1115 **Done** · **1116 Review** · **1117 Review**

**Phases 0–3 ran 08-13/14. Plans A, B and C completed 2026-08-18. Plan D added the same day** after a gap in our own coverage surfaced — **Run 1 has passed and closed the batch-abort question** (see §3). Run 2 (cross-tenant) optional-but-worthwhile; Runs 3/5 dropped; Run 4 trimmed to the `weight` trigger. **→ `REMAINING-WORK-PLAN.md` and `PLAN-D-RUNSHEET.md` carry a kick-off prompt per session.**

---

## 1. Where things live

**`~/Desktop/testing-tools/`** — scripts, briefs and **all results files**. Source of truth for what was measured. Holds `CLAUDE.md` (agent context), the four `BUSY-1116-PHASE*-RESULTS.md` files, `BUSY-1116-QA-DOC-UPDATES.md` (drafted Confluence changes, **not applied**), and the three plan files `PLAN-A-*`, `PLAN-B-*`, `PLAN-C-*`.

**This project** — plans, briefs, current-state summaries. Each plan doc carries a kick-off prompt so a fresh session needs no other context.

**Confluence** — [QA Doc 1114](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859387394) and [QA Doc 1115](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354640) updated 2026-08-17, current. [QA DOC 1116](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354632) is **stale** — changes drafted in `BUSY-1116-QA-DOC-UPDATES.md`. **No QA doc exists for 1117** — worth creating before it signs off.

---

## 2. What the phased re-test settled

### The overlap question (group OV) — closed, benign

**No overlap window exists.** The poller queries from the watermark's **exact value**, inclusive (`>=`), no buffer — measured from the literal `where=` clause across **14 cycles**, Δ = 0s every time, both endpoints sharing the floor, zero bare `>` in full history. **LLD §3.4 is wrong; Kian's runbook is right.**

- **OV4 reconciliation: 0 unexplained misses**, 763/763. ⚠ Covers only 33% of the window — 67% had been re-edited within 2.5–4.5h. A clean sample, not a full audit.
- **OV5: min lag +19.7s, zero negatives**; clock skew ≈0.
- **Defect trigger NOT met** → **evidence-bound accepted risk, not "proven safe."** Remaining blind spot: does Cin7 stamp `modifiedDate` at transaction start or commit? Not observable from our side.
- Boundary re-emission proven twice (20/20 and 8/8, watermark unmoved). Granularity is **whole seconds**.

### The rewind — the deferral rationale was wrong, and this unlocked things

**6h07m converged in ONE cycle:** 331 products, 2,270 records, **15 requests**, ~60s. Whole session: 51 requests / 4,289 records. **Cost tracks pages and id-chunks, not record count.**

⚠ **Follow-on nobody spotted at the time: the rewind cap was a cost guardrail built on a wrong number, so several "unreachable" blockers are now reachable.** Most importantly **product 29942 is within reach** (~12 days ≈ 150–200 requests) — see Plan A Tier A2.

Coalescing measured: **6,021 received → 5,604 coalesced (417, 6.9%)**, one batch collapsing 158/538.

### Character limits — all four exact

| Field | Limit | Over-limit |
|---|---|---|
| `Desc` | **100** | truncates **silently** |
| `Colour` | **25** | truncates **silently** |
| `Size` | **25** | **errors** (`size_too_long`) |
| `Item` | **50** | **errors** (`item_code_too_long`) |

Not uniform — two truncate, two error. **LLD §5 has no length column; these belong in it.** The silence is **expected behaviour, confirmed by JJ 2026-08-18** — closed, not a finding.

---

## 3. The verification plans

| Plan | Verdict | Results file |
|---|---|---|
| **A** — whitespace `item_code` | ✅ **Harness artefact. NO TICKET.** Residual scanned and closed | `CTC-WHITESPACE-REAL-PATH-RESULTS.md` |
| **B** — `PutEvents` partial failure | ✅ **Latent risk, no occurrence. Note to dev, not a ticket. Do NOT run B2** | `CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md` |
| **C** — SCALE manual checks | ✅ **All 7 run by JJ.** Closed 1115 ID1/UP1/TC1/TC2/TC8 at the SCALE end, 1116 TC6/ID3/UP3 at field level | `PLAN-C-SCALE-MANUAL-CHECKS.md` |
| **D** — Mode A batch containment | ✅ **Run 1 PASSED 2026-08-18. 1 poison + 20 valid controls in one flush → ALL 20 DELIVERED within 36s, only the poison isolated, DLQ +1.** The batch-abort concern is **closed** | `MODEA-BATCH-CONTAINMENT-RESULTS.md` |
| `check-status.sh` two bugs | ✅ **Fixed** | verified in the script |

**Net: all four defects that were queued to raise are now either closed or downgraded.** The sender-containment one survives only as **findings for the project team** — Plan D Run 1 showed valid records are not lost, just delayed ~35s.

⚠ **New architectural fact from Run 1, previously undocumented anywhere:** isolation is **NOT the sender's**. The sender's `.map()` has no per-item try/catch (stack trace: `validateItemDownload` `index.js:14863` → `Array.map` `14902` → `Runtime.handler` `14887`) and dies in 113ms on the first bad element. **Recovery is one layer up** — `staging-catalog-manhattan-item-buffer-buffer-handler` wraps every sender call in `processWithBisect` and **recursively halves on any failure**: measured `21 → 10+11 → 5+5 → 2+3 → 1+1`, logging `"Poison pill identified"`. It is **content-agnostic** — Mode A throws and Mode B rejections are handled identically. Every doc that credited the sender with bisection was wrong.

### ⚠ Corrections and new findings from those passes

1. **The whitespace mechanism was documented wrongly and is now fixed everywhere.** Not *"assembled from
   separate clean fields"* — it is **`{company}#re.sub(r"\s+","_",code)`**, a whitespace-**run** collapse on
   `item_code`. Falsified the old theory via `size='S'` (not `'-S'`). The correction **strengthens** the
   conclusion: whitespace is sanitised *anywhere* in `item_code`, including the bare `productOptionCode`,
   so the residual is closed rather than unexercised. **MEASURED** fields, **INFERRED** transform — one free
   log grep or one Kian question upgrades it.
2. **Full-pipeline reconciliation is exact:** poller `recordsEmitted` = bus `MatchedEvents` = populator
   receipts = **31,731**, hour-by-hour, entire lifetime (175 cycles). Zero shortfall anywhere.
3. **⚠ `PutEventsFailedEntriesCount` carries ZERO dimensions** — a regional aggregate across every caller in
   the account, so it can **never** be scoped to our bus. Rule-scoped alternatives that do work:
   `Invocations`, `MatchedEvents`, `TriggeredRules`, `FailedInvocations` (the last has never fired for either
   of our rules, while it has for others in the account — so its absence is meaningful). **Feeds any future
   1117 monitoring design.**
4. **⚠ Products 30706 / 30707** (`NUSMU23-101A - MTEST` / `- WTEST`) look like **test products in Cin7
   PRODUCTION, Public + Primary — poller-eligible and shipping to SCALE.** Not this epic's problem; flag it.
5. **The Cin7 account is far larger than the CTC subset** — 24,641 products / 137,114 options / 95,506
   poller-eligible, vs the ~3,257 CTC records earlier docs sized. **Company-scope any full-account scan
   before treating it as CTC-relevant.**

## 4. Open items

**With Kian (JJ asking — not QA work):**

1. **The page-cap constant.** `MAX_PAGES_PER_RUN` isn't an env var and has never fired in ~41 days, so it can't be measured. Just need the number — it closes PW10 and PW8's forced-clamp half.
2. **Was the populator meant to be in the 11–12 Aug deploy?** Still `LastModified` 3 Aug, which is why ERR5 is unfixed.

**Needs a decision or a doc edit (not QA):**

3. **AC4 (1116) fails on the LLD link only.** Runbook published 2026-08-03 ([page 1845100600](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook)); LLD §3.4/§8 don't link it and §13 still lists it outstanding. **Lachlan/Kian. The long pole on 1116.**
4. **LLD corrections to hand over:** §3.4's overlap claim and §3.3 step 5 (emit is batched ≤10, not one per record). Replacement text drafted in `BUSY-1116-PHASE1-RESULTS.md` §3.2.
5. **⚠ NEW FINDING (measured 2026-08-18) — SCALE does not clear a field on an empty tag; `SAVE` is additive.** `QA-UP2-TEST` was sent `colour=Green`, then re-sent with `colour=""`; the XML carried an explicit present-but-empty `<Color></Color>` and **SCALE still reads `Green`**. **A field cleared in Cin7 never clears in SCALE, and no re-sync fixes it.** Confirms the runbook's caveat, which had never been measured. **Three consequences:** (a) 1115 UP2 is a **confirmed limitation**, not a pass — the sender behaves correctly, the boundary is Manhattan-side; (b) **it scopes 1116's idempotency argument** — convergence holds for values that are *present*, not for deletions, and AC2/AC3 should say so, because as written they read as though a reset restores full fidelity; (c) **it's an operational finding for the DC team** — stale values persist indefinitely with no signal and no recovery path. Belongs in the runbook and the E2E handover. **Worth asking merchandising whether any CTC field is routinely cleared rather than overwritten** — if so, SCALE is carrying stale values today. Pairs with the lifecycle gap (W22): things that stop being true in Cin7 don't stop being true in SCALE.
6. **Sender has no per-record containment — five repros of one gap:** missing `item_code`, blank `desc`, non-numeric `weight`, over-length `Size`, over-length `item_code`. **One defect, one fix.** Ready to raise.
7. **1117's "no alarm watches CTC validation failures" finding is WRONG.** `staging-catalog-manhattan-sender-validation-failures` exists, right metric, **>10 in 900s**, configured 2026-08-10, with a **real near-miss of 9/10** on 08-13. Missed because `check-status.sh` never checks it. **Real gap was narrower: zero SNS subscriptions.** Notification plumbing, not a missing alarm. ⚠ **Updated 2026-08-19: no longer zero** — one confirmed manual email subscription now exists on the alerts topic; the SSM parameter the design assumed still doesn't exist. See `BUSY-1117-AC4-WIRING.md` and `CLAUDE.md`'s corrected resource-table row.
7a. **⚠ NEW 2026-08-19 — 1117 AC1 and AC2 are now live-evidenced, not just dev-attested.** A deliberately-forced blank-secret + cold-start test produced a genuine `watermark-stale` fire (AC1: PASS, flagged — ~26% over the "~2h" wording, see `BUSY-1117-AC1-RERUN-RESULTS.md`) and supplied `poller-errors`' missing 3-consecutive-error evidence (AC2: now PASS in full). The same session found **AC5 ("empty cycles raise nothing") to be UNKNOWN** — no naturally-occurring empty active cycle exists in 7 days of retained logs to test it against. Watermark returned to `UNSET` at session end.
8. **`check-status.sh` has two bugs** — doubled `cin7-cin7-` in two alarm lookups, and it never checks the sender-validation alarm. Both one-line fixes.
9. **Decide the runbook end state.** Offer our draft's operational sections (when to use / when NOT to, the stale-alarm trap, "don't reset for one SKU", `SAVE` doesn't clear cleared fields, the mass-re-sync whitespace hazard) as **additions to the repo copy** — one source of truth, not a competing page.
10. **1115's TC7 (AC4) and TC10/TC11 (AC5) closed without QA evidence or attestation.** TC7 was never executed, and **no organic 429 has ever occurred**, so AC5 has no verification from either side. Cheap to close retrospectively if the E2E handover needs them.
11. **Handover note for the SCALE testing team (not a QA open item — JJ's scope call 2026-08-18):** no CTC product in Cin7 prod carries dimension data at all — 0 of ~3,257 records — so every CTC item in SCALE is `0.1 × 0.1 × 0.1 MM`. **What SCALE does with that (cubing, cartonisation) is that team's to test, not ours.** Also for them: SCALE accepted an item code containing a double space, and if that code is ever trimmed it creates a second item rather than updating the first.
12. **⚠ The Cin7 write allowlist — ids now recorded, and there's a problem with them.** The four editable products are **6202 (`TEST1`, 1 option), 6203 (`TEST2`, 4), 6204 (`TEST3`, 4), 6205 (`TEST4`, 4)** — all `testProduct`, all Public. **But every option on all four is `optionStatus=Disabled`, so all four are structurally ineligible and the poller will NEVER emit them.** These are the exact products Phase 1 used as the eligibility-gate negative examples (PW5/PW7 — zero records emitted, 100% skipped). **Consequence: the write-access plan's §4 end-to-end pass cannot work as written** — any test needing a record to reach SCALE must first flip an option `Disabled → Primary`, which is itself a write and must be reverted. Plan it deliberately (that's W19). ✅ Risk revised **down**: these are purpose-made test products, not real merchandise, so the earlier warning about breaking live stock/order links is much less severe; the real cost of a code edit is an orphaned SCALE item.
13. **Cin7 writes remain PROHIBITED and the tooling must NOT be built** until JJ explicitly asks — he has said its absence is currently a feature. `CLAUDE.md` now also carries a **mandatory disclosure protocol**: before any Cin7 edit, state the product id and slot, the field with its current and new value, the exact verb/URL/payload, the blast radius, and how it reverts — then wait. One edit, one disclosure, one approval; no batching.

**Closed 2026-08-18:**

- ~~**AC1 (1116) attestation is narrative only.**~~ **RESOLVED — Kian has confirmed it directly and JJ is clear to sign AC1 off.** Confirmation sits in Teams messages; **to be pasted into the QA doc / ticket at the Phase 4 documentation stage.** No further QA work, no citation to chase.
- ~~**Truncation silence.**~~ **Expected behaviour, confirmed by JJ.** Not a finding, not a ticket.
- ~~**No SCALE item-lookup screen exists.**~~ **It does exist** — JJ can verify manually. Now Plan C. Capture the navigation path when found; two sessions lost time to this.

---

## 5. Environment state (2026-08-14, carry into any new pass)

- **Watermark `UNSET`**, version 188 (re-confirmed 2026-08-18). Buffer queue **0/0**. ⚠ **Buffer DLQ measured at ZERO on 2026-08-18 — the 19 QA-evidence messages AGED OUT** (retention is 4 days; they dated 08-10 → 08-14). The §4 inventory is now a historical record, not live state, and the "don't purge without checking" warning is moot. Current depth **1** — the Plan D Run 1 poison.
- **`send-dlq-depth` threshold known exactly: `depth > 0`, 1×300s** — one message saturates it. In ALARM since 2026-08-10, so a fresh transition can't be demonstrated. **Limit on demonstration, not knowledge.**
- **Alerts topic has zero subscriptions** — nothing notifies anyone.
- **Cadence 3 min.** Ticket says 15, LLD says 2 — both wrong.
- **Log retention is never-expire** on poller/populator/sender — this is what made the whole OV forensic pass free, and it makes Plans A1 and B1 free too.
- **⚠ SSM lag is variable in BOTH directions.** On 08-13 an `--unset --confirm` reported success but the poller ran **11 more active cycles over ~33 min** (~1,108 records beyond the intended idle window, confirmed by direct SSM reads). On 08-14 a `--set` landed on the **very next cycle** (~1m39s). Always confirm with `get-parameter`; never re-write impatiently.
- **Watermark is a floor, not a window** — rewinding to X re-reads everything from X until now.
- **Rewind cost is cheap and measured.** Preview before every `--set` regardless.
- **Poller env vars:** `WATERMARK_PARAMETER_NAME`, `STAGE`, `CIN7_SECRET_NAME`, `AWS_NODEJS_CONNECTION_REUSE_ENABLED`, **`INTERNAL_EVENT_BUS_NAME`** — that last one is the lever for Plan B2. No `MAX_PAGES_PER_RUN`.
- **Eligibility is `Product.status=Public` AND `ProductOption.status=Primary`** — note `Active` is **not** eligible.
- **Four CTC products in Cin7 production are API-editable.** ⚠ Cin7 is the real production system — an option-**code** edit can break links to stock/orders inside Cin7 itself, independently of our pipeline. Containment rules in `claude/Cin7 write access — expanded coverage plan` §1–§3. Confirm merchandising ownership before any code edit.

---

## 6. Convention

Results files stay in `testing-tools/`; anything that changes the picture gets summarised back here so the next session starts from measured state. This page is the place to look first.

**Rewritten 2026-08-17 after drifting badly** (it had described 1115 as in Review and none of Phases 0–3 as run) and **updated 2026-08-18** with the plan triage. Keep it current.
