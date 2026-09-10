# CTC item master — handover action list

**Built:** 2026-08-18 · **For:** JJ (QA) · **Verified live today** against Jira, Confluence, the LLD and the tooling folder.

---

## 0. State as verified just now — nothing here needs re-checking

| Check | Result |
|---|---|
| Jira | 1113 **Done** · 1114 **Done** · 1115 **Done** · **1116 Review** · **1117 Review** (all last touched 14 Aug) |
| QA DOC - BUSY-1116 (1859354632) | **current**, updated yesterday 22:30 — includes Plan D. **Do not re-apply `DRAFT-QA-DOC-BUSY-1116.md`** |
| QA DOC - BUSY-1117 (1894088713) | **current**, updated yesterday 22:26 — AC map present, AC4 = FAIL. **Do not re-apply the draft** |
| E2E handover page (1894973441) | exists, linked from the 1117 doc |
| LLD (1765736449) | **unchanged since 4 Aug.** §3.4 still claims the 5-min overlap · §3.3 step 5 still says per-record emit · §3.2 still says 2-min cadence · §9 still says "60 consecutive cycles" · §12 OQ-4 still open · **no runbook link anywhere in §3.4/§8, and §13 still lists it as scope** → **1116 AC4 is still blocked** |
| `check-status.sh` | both fixes **present in the script** (single `cin7-` prefix; `staging-catalog-manhattan-sender-validation-failures` added at line 96). Still **not verified against live AWS** |
| SCALE item-lookup path | **still not captured** — `CLAUDE.md` line 487 says "capture the navigation path when you have it" |
| AWS from this session | **not reachable.** No AWS CLI and no network on the device bridge; no credentials in the cloud sandbox. All AWS work must run from your IDE session |

---

## A. Fire off first — other people's actions (10 min, do before anything else)

- [ ] **A1 — Chase the LLD runbook link (1116 AC4).** Owner: **Lachlan / Kian.** Runbook page `1845100600` published 3 Aug; LLD §3.4 and §8 don't link it and §13 still lists it outstanding. AC1–AC3 all PASS — **this single hyperlink is the long pole on 1116.** Fallback if it won't happen: get AC4 descoped to "runbook published", link tracked separately.
- [ ] **A2 — Chase OQ-4, the alert distribution address (1117 AC4).** Owner: **whoever owns OQ-4, Lachlan to route.** `staging-catalog-manhattan-observability-alerts` has **zero subscriptions**. Not a QA action — you don't hold SNS subscription rights. Fallback: descope AC4 **with a stated reason**; do not let it sit as "untested" — it's measured.
- [ ] **A3 — Send the six questions to Kian** as one batch. Draft in Appendix 1.
- [ ] **A4 — Send the findings pack to the project team** (`POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`). Draft in Appendix 2. **QA raises no Jira ticket — they decide.**

---

## B. Testing you can still run in the next hour

**All read-only. Must run from your IDE session** (AWS creds live there, not in this session). One paste — prompt in **Appendix 5**. Expect ~35 min.

- [ ] **B1 — `describe-alarm-history` for `cin7-watermark-stale` across 2026-08-05.** A real blank-credential episode is already in the retained logs: **34 consecutive `Cin7PollerCycleFailed` = "Cin7 secret is missing required fields"**, ≈1 h 42 m at 3-min cadence. If the alarm transitioned, **1117 AC1 closes retrospectively and so does the "3 consecutive errors" half of AC2** (AL1 + AL3). Best value per minute in the whole list. ~10 min
- [ ] **B2 — Same pull, confirm the 4 organic single `TimeoutError` cycles did *not* fire it** (3× 6 Aug, 1× 13 Aug). Upgrades AC2's "single blip stays quiet" half from observational to evidenced. ~5 min
- [ ] **B3 — Review the observability dashboard against AC3's four series** (fetched/emitted per cycle, watermark age, 429 count). URL from `check-status.sh`. Judge **"is the metric wired up"**, not "does it show data": the 429 count is permanently zero (no 4xx ever) and per-company is log-level only (`Dimensions: []`, BUSY-1113 gap). Closes **AC3 / AL5**, currently NOT RUN. ~15 min
- [ ] **B4 — Re-run `check-status.sh` against live AWS.** Takes AL7 from FIXED to FIXED-and-verified. ~5 min
- [ ] **B5 — Optional, free (~15 min):** log-search the 13 `productOptionCode` values from `CTC-WHITESPACE-REAL-PATH-RESULTS.md` §3 to upgrade the `message_group_id` whitespace-collapse transform from **INFERRED** to **MEASURED**. Only worth it if you'd rather not spend question **K6** on Kian. Absence of hits proves nothing — say so.

---

## C. Docs and tickets you own

- [ ] **C1 — Hand the LLD corrections to Lachlan/Kian** (documentation only, no code changes). **Seven items, list in Appendix 3** — note item 7 (`DimensionUm`) is new: the LLD table says `M`, which Manhattan **rejects**; deployed behaviour is `MM` and was settled with dev + the design council on 7 Aug.
- [ ] **C2 — Reword 1116 AC2 / AC3 to scope to present values, not deletions.** `SAVE` is additive — measured 18 Aug on `QA-UP2-TEST`: an explicit empty `<Color></Color>` left SCALE reading `Green`. As written both ACs read as though a re-sync restores full fidelity. It doesn't.
- [ ] **C3 — Reword 1116 AC3's "within Cin7 rate limits" in *requests*.** A 6 h 07 m reset costs **15 requests**, not thousands. The records-vs-requests conflation caused a five-week deferral.
- [ ] **C4 — Scope 1116 AC1/AC4's DLQ guarantee to faults that *reach* the queue.** The buffer-populator class has no DLQ path at all.
- [ ] **C5 — Decide 1116 TC6: reword to "no duplicate items after a reset" → clean PASS, or leave PARTIAL with the gap named.** The literal ask is a before/after SCALE diff and no before-snapshot was ever taken. The underlying risk *is* closed (`WPDTC26-302F-*`, 8 unique sizes, no duplicates, after a 500+ item batch that hit a `TimeoutError` and retried). **Your call.**
- [ ] **C6 — Correct the cadence rationale on the 1117 ticket and LLD §9.** Deployed cadence is **3 min**; the ticket says 15, the LLD says 2. "8 cycles ≈ 2 hours" is really 24 minutes; "3 consecutive errors ≈ 45 min" is really 9. **Correct the text, not the thresholds.**
- [ ] **C7 — Paste Kian's AC1 confirmation from Teams into the 1116 doc.** It's cited as "to be pasted at Phase 4" and is load-bearing for the strongest AC.
- [ ] **C8 — Record the SCALE item-lookup navigation path in `CLAUDE.md`.** Not finding it blocked four test cases for a week and is logged as a blocker in three QA docs. Also record that **`DIF Incoming Message Insight` is the wrong screen** (0 rows with all filters cleared). *Send me the path and I'll write it in.*
- [ ] **C9 — Guard ID3.** It is **PARTIAL**, not PASS: no test ever inverted arrival order, so "newer `read_at` wins regardless of arrival order" is dev-attested only. Closed by **K5** or a deliberate out-of-order injection. **Don't let anyone quietly restore it to PASS.**

---

## D. Remaining sends

- [ ] **D1 — CTC merchandising: M1 + M2.** Draft in Appendix 4.
- [ ] **D2 — SCALE testing team: S1 + S2, and get S1 an owner** — that's the point of sending it. Draft in Appendix 4. Already written into the E2E handover page; it needs a human to accept it.

---

## E. Housekeeping — only if time remains

- [ ] **E1 — Delete `_to_delete/`** (`DRAFT-TICKET-SENDER-CONTAINMENT.md`, `FINDINGS-SENDER-CONTAINMENT.md`). Agents can't delete on your machine.
- [ ] **E2 — Confirm the four-product slot assignment.** IDs confirmed, roles still a proposal: 6202 `TEST1` = P3 burner · 6203 `TEST2` = P1 golden · 6204 `TEST3` = P2 boundary · 6205 `TEST4` = P4 reserve.
- [ ] **E3 — Confirm the watermark is `UNSET`** with a direct `get-parameter`. Never trust the script's success message — on 13 Aug an `--unset --confirm` reported success and the poller ran 11 more active cycles over ~33 min.
- [ ] **E4 — Measure DLQ depth, never quote it.** Retention is 4 days and depth decays on its own. The old "19 messages, don't purge without checking the inventory" warning is **moot** — those aged out; the queue measured zero at 06:27Z on 18 Aug and holds Plan D's single poison.
- [ ] **E5 — Decide the runbook end state** — offer our draft's operational sections as additions to the repo copy rather than a competing page (1116 TC9).

---

## F. Three things not to get wrong

1. **QA raises no Jira ticket.** The batch-failure behaviour goes to the project team as findings; they decide.
2. **Say both halves of the batch behaviour.** *"The sender has no per-record containment"* — true, its `.map()` has no try/catch and it dies in **113 ms** on the first bad element. *"Nothing is lost"* — also true, the **buffer-handler's** `processWithBisect` absorbs it (`21 → 10+11 → 5+5 → 2+3 → 1+1`, **20/20 valid delivered, rejected=0**, and **5/5 UNI records delivered from the same batch as a CTC poison**). One half alone is either a false alarm or sounds like a cover-up. Every doc before 18 Aug credited the isolation to the sender — that was wrong.
3. **Don't re-open what's closed.** Whitespace/ERR5 = harness artefact, no ticket · PutEvents/TC3 = latent risk, no occurrence, dev note only, **do not run Plan B2** · `DimensionUm=MM` = correct and settled · silent truncation of `Desc`/`Colour` = expected · **never write to Cin7** — GET-only, and the absence of write tooling is deliberate.

---

# Appendix 1 — Questions for Kian (paste as one message)

> Hi Kian — CTC item master QA is finished and I'm writing the handover. Six things I can't answer from outside the code. None of them blocks sign-off except K5, which is one PARTIAL on 1116 AC2.
>
> 1. **What's the page-cap constant?** The LLD calls it `MAX_PAGES_PER_RUN` = 30 and env-settable, but it's neither an env var nor an SSM parameter, and it's never fired in ~41 days (max 8 pages). I only need the number — I don't need to force it.
> 2. **Does the poller check `PutEvents`' `FailedEntryCount`?** The `Pushed {"Entries":[…]}` line logs the outbound request *before* the call, and `FailedEntryCount` appears 0 times in full retained history — so success and partial failure look identical from outside. Reconciliation is clean (31,731 = 31,731, hour by hour, full lifetime), so this is defence-in-depth, not a defect.
> 3. **Is the missing `weight` type guard known and accepted?** A non-numeric weight isn't caught by `validateItemDownload` at all — it dies deeper as `TypeError: value.toFixed is not a function` in `roundToSchemaPrecision`, so **no validation reason is logged**. The other four triggers each have a named check in front of them. Diagnosability rather than risk — bisection contains it either way.
> 4. **What's the intended handling for records that reach the DLQ** — manual re-drive, fix-and-resend, or investigate-and-drop? Asking because nothing currently notifies anyone, so in practice a record sits there unnoticed, and the DC team needs a documented action.
> 5. **Is the sender's coalesce out-of-order-safe** — does a newer `read_at` win *regardless of arrival order*? This is the only thing keeping 1116 AC2's ID3 at PARTIAL: we proved no-duplicates-after-a-retry and that two sequential SAVEs land in order, but nothing ever inverted arrival order.
> 6. *(optional)* **Confirm the poller collapses each whitespace run in `item_code` to a single underscore** when building `message_group_id` — i.e. `{company}#re.sub(r"\s+","_",code)`. Only upgrades our evidence grade; the conclusion doesn't change.

---

# Appendix 2 — Findings note to the project team (paste, then attach the pack)

> **CTC item master — one behaviour for you to decide on. QA is not raising a ticket.**
>
> **Nothing is lost, no valid update is blocked, and there's no cross-tenant impact.** Starting there because the detail reads like a fault report otherwise.
>
> When a single CTC record is malformed in a particular way, the component that sends items to the warehouse stops on that record and doesn't complete the send. The layer above it recovers automatically: it splits the batch in half repeatedly until it isolates the bad record, then delivers everything else. We measured this on 18 August — **20 out of 20 valid records were delivered alongside a deliberately bad one, and nothing was rejected.** We also ran the same test with records from another company in the same batch: **all 5 were delivered**, so a CTC data error cannot block another company's item sync.
>
> **The cost is a delay, not a loss** — worst case one buffer cycle (~3 minutes) plus a few seconds. The bad record ends up in a holding queue, where **nobody is currently notified about it** (that's the 1117 AC4 gap, blocked on the alert distribution address).
>
> **What we'd ask dev before deciding anything:** two of the five triggers (an over-length size or item code) may be intentional — erroring rather than truncating was a deliberate choice — so the real question is whether erroring should abort the **batch** or just the **record**.
>
> Full detail and evidence: `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`. Happy to raise a ticket if you want one — that's your call, not ours.

---

# Appendix 3 — LLD corrections (hand over with A1/A3)

All documentation, no code changes.

1. **§3.4 — the `watermark − 5 minutes` overlap does not exist.** The deployed query is `where=modifiedDate>='<watermark>'`, string-identical, inclusive `>=`, zero bare `>` in full history. ⚠ **§14 lists "filter includes 5-minute overlap" as a unit test — that test asserts behaviour the deployed poller does not have.**
2. **§3.3 step 5 — not one `PutEvents` per record.** Batched ≤10 (2,678 of 2,821 batches were exactly 10).
3. **§5 has no length column at all.** Add: `Desc` **100** (truncates silently) · `Colour` **25** (truncates silently) · `Size` **25** (errors) · `item_code` **50** (errors). **Not uniform — two truncate, two error. Never state one behaviour for all four.**
4. **Cadence is 3 minutes** — §3.2 says 2, the ticket says 15, both wrong. This one matters beyond documentation: §9's "60 consecutive cycles" and the ticket's "8 cycles ≈ 2 hours" are both derived from the wrong number. **Correct the text, not the thresholds.**
5. **§5 source fields follow HLD §5.3, not CTC LLD §5** — notably `UserDef1 ← brand`, which the LLD omits entirely.
6. **Replacement text for 1 and 2 is already drafted** in `BUSY-1116-PHASE1-RESULTS.md` §3.2.
7. **⚠ NEW — §5's `DimensionUm` static says `M`. It must say `MM`.** `MM` is what the deployed mapper emits and it is correct — closed with dev and the design council on 7 Aug. `M` is a **guaranteed Manhattan reject**; we used `dimension_uom=M` deliberately as a poison record in Phase 3. Anyone implementing to the LLD table as written would ship rejected items.

---

# Appendix 4 — Merchandising and SCALE-team sends

**To CTC merchandising:**

> Two things off the back of CTC item master QA — neither is a QA finding against your data.
>
> 1. **Is any CTC field routinely cleared rather than overwritten?** (barcodes on discontinued lines, seasonal colour attributes, that sort of thing.) We measured on 18 August that the warehouse system's save is **additive**: we sent a test item `colour=Green`, then re-sent it with colour blank — the message carried an explicit empty colour and **SCALE still reads `Green`.** A field cleared in Cin7 will never clear in SCALE, and **no re-sync fixes it.** If the answer is yes, SCALE is carrying stale values today with no recovery path.
> 2. **Did you know products 30706 and 30707 are live?** `NUSMU23-101A - MTEST` and `- WTEST`, both Public/Primary in Cin7 **production** — so they're eligible for the poller and shipping to SCALE right now. Looks like test data. Not a defect in this integration; just something the catalogue owner should know.

**To the SCALE testing team:**

> Two limits from CTC item master QA that you need to carry into E2E. Both are in the handover page; item 1 needs an owner and currently has none.
>
> 1. **100% of CTC items in SCALE are dimensioned `0.1 × 0.1 × 0.1 MM`.** No CTC product in Cin7 production carries dimension data at all — 0 of ~3,257 emitted records; 1,652 of 1,658 preview candidates missing every dimension field. **Our side is correct** — the data arrives as Cin7 holds it. **What we did not and will not test: whether SCALE cubes or cartonises off item dimensions.** If it does, the entire CTC catalogue is dimensioned identically in a system that may use that for pick/pack or slotting. **Who owns this?**
> 2. **SCALE accepted an item code containing a double space.** Product 29942's six options exist as `WTW23-922G  -XS` … `-XXL`, double space intact. Functionally fine today. **Latent rename hazard: if that code is ever trimmed or normalised, it creates a SECOND item rather than updating the first.** Anyone doing data cleanup on CTC item codes in SCALE must know before touching whitespace.

---

# Appendix 5 — IDE prompt for section B (paste into a fresh session)

```
Read CLAUDE.md in ~/Desktop/testing-tools, then the QA DOC - BUSY-1117 test-case table
(Confluence page 1894088713) if you can reach it, else DRAFT-QA-DOC-BUSY-1117.md.

READ-ONLY session. No injection, no Cin7 calls of any kind, no watermark writes, no config
changes, no Confluence or Jira edits. Four tasks, then write results.

1. AL1 + AL3 (BUSY-1117 AC1 and half of AC2). Pull
   aws cloudwatch describe-alarm-history for staging-catalog-cin7-watermark-stale covering
   2026-08-04 through 2026-08-07, and also for staging-catalog-cin7-poller-errors over the same
   window. A real blank-credential episode exists on 2026-08-05: 34 consecutive
   Cin7PollerCycleFailed = "Cin7 secret is missing required fields", ~1h42m at 3-min cadence.
   Report every StateUpdate transition verbatim with timestamps. State plainly whether each
   alarm transitioned to ALARM, and if it did not, whether the reason is visible from the
   history (e.g. INSUFFICIENT_DATA because cin7-watermark-stale watches
   Cin7PollerCycleComplete, which a failing cycle never emits — that is AL6's idle
   false-positive mechanism working in reverse and is a legitimate finding, not a null result).

2. AL2 (the other half of AC2). Confirm the 4 organic isolated TimeoutError cycles
   (3x 2026-08-06, 1x 2026-08-13) produced NO alarm transition in the same history.

3. AL5 (AC3). Get the observability dashboard URL from check-status.sh, then inspect the
   dashboard definition via aws cloudwatch get-dashboard and report which of AC3's four series
   are actually present: products/options fetched per cycle, records emitted per cycle,
   watermark age, 429 count. Judge "is the metric wired up", not "does it show data" — no 429
   has ever occurred and per-company breakdown is log-level only because every sender metric
   carries Dimensions: []. If a series is missing from the dashboard, say so explicitly.

4. AL7. Re-run ./check-status.sh and confirm against live AWS that no alarm reports NOT FOUND —
   specifically staging-catalog-cin7-poller-errors, staging-catalog-cin7-watermark-stale and
   staging-catalog-manhattan-sender-validation-failures. Also record the measured DLQ depth and
   confirm the watermark is UNSET with a direct ssm get-parameter, not the script's message.

Tag every claim MEASURED / INFERRED / UNKNOWN and quote log and alarm-history lines verbatim.
Write BUSY-1117-ALARM-HISTORY-RESULTS.md with a verdict per AC (AC1, AC2, AC3) and tell me
exactly which words to change in the QA DOC - BUSY-1117 AC table. Do not edit Confluence.
If describe-alarm-history returns nothing for the window, say so and do not infer a pass.
```
