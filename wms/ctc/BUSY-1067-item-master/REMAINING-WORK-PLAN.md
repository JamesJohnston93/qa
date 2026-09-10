# CTC item master QA — remaining work plan

> ## ⚠ SUPERSEDED 2026-08-18 — work from `FINAL-WRAPUP-RUNSHEET.md` (rev 2).
> That file carries the ordered action list, the AWS/IDE verification session with exact log groups and
> time windows, and the current Confluence/Jira state. Kept here for the plan-by-plan verdicts and the
> historical session prompts.

**As at:** 2026-08-18 (re-verified against Jira, disk and Confluence) · **Owner:** JJ (QA)

> ## ✅ ALL TESTING IS COMPLETE. Only documentation and other people's edits remain.
>
> Phases 0–3 ran 2026-08-13/14. Plans A, B, C and **D** all completed 2026-08-18.
>
> **Plan D was the late addition** — a gap in our own coverage, since the batch-abort case had only ever
> been tested one record at a time. **Both its questions came back clean:** 20/20 valid records delivered
> alongside a poison (Run 1), and 5/5 **UNI** records delivered from the same batch as a **CTC** poison
> (Run 2), closing the cross-tenant risk. Runs 3/4/5 dropped with stated reasons.
>
> **Nothing further needs testing.** What's left: apply four drafts, two questions to Kian, and the LLD
> link from Lachlan/Kian — which is the only thing actually blocking 1116.

**Tickets (verified in Jira 2026-08-18, unchanged since 08-14):** BUSY-1113 **Done** · 1114 **Done** ·
1115 **Done** · **1116 Review** · **1117 Review**

---

## 1. What closed, and how

| Plan | Verdict | Evidence |
|---|---|---|
| **A — whitespace `item_code`** | ✅ **Harness artefact. NO TICKET.** Residual scanned and closed, not merely unexercised | `CTC-WHITESPACE-REAL-PATH-RESULTS.md` |
| **B — `PutEvents` partial failure** | ✅ **Latent risk, no occurrence. Note to dev, NOT a ticket. Do not run B2** | `CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md` |
| **C — SCALE manual checks** | ✅ **All 7 run.** Closed 1115 ID1/UP1/TC1/TC2/TC8 at the SCALE end and 1116 TC6/ID3/UP3 at field level | `PLAN-C-SCALE-MANUAL-CHECKS.md` |
| **D — Mode A batch containment** | ✅ **Run 1: 20/20 CTC controls delivered, DLQ +1. Run 2: 5/5 UNI controls delivered from a CTC poison's batch — cross-tenant risk CLOSED.** Runs 3/4/5 dropped | `MODEA-BATCH-CONTAINMENT-RESULTS.md` |
| **`check-status.sh` two bugs** | ✅ **Fixed** — correct alarm names, sender-validation alarm now checked | verified in the script |

**Net effect: all four defects that were queued to raise are closed or downgraded. QA raises nothing in Jira.**
The sender batch behaviour survives only as **findings for the project team**, and Plan D shrank it
considerably: valid records aren't lost or blocked, the worst case is **one buffer cycle (~3 min) plus a few
seconds**, and there's no cross-tenant impact. Only two questions remain for dev — the `weight` type guard
and DLQ handling.

⚠ **New architectural fact from Plan D, previously undocumented:** isolation is **not the sender's**. Its
`.map()` has no per-item try/catch and dies in 113ms on the first bad element (`validateItemDownload`
`index.js:14863` → `Array.map` `14902` → `Runtime.handler` `14887`). Recovery is one layer up —
`staging-catalog-manhattan-item-buffer-buffer-handler` wraps every sender call in `processWithBisect` and
**recursively halves on any failure** (`21 → 10+11 → 5+5 → 2+3 → 1+1`, logging `"Poison pill identified"`).
Proven **content-agnostic** and **tenant-agnostic**. Every doc that credited the sender with bisection was
wrong.

⚠ **The 19-message DLQ inventory has aged out** — measured at zero on 2026-08-18. Retention is 4 days and it
dated 08-10 → 08-14. The "don't purge without checking the inventory" warning carried across three docs is
moot; `BUSY-1116-PHASE1-RESULTS.md` §4 is now history, not live state.

### Three findings worth carrying beyond this epic

1. **⚠ The whitespace mechanism was documented wrongly (my error) and is now corrected everywhere.**
   Not *"the group id is built from separate clean fields"* — it is **`{company}#re.sub(r"\s+","_",code)`**,
   a whitespace-**run** collapse on `item_code`. The old theory is falsified by `size='S'` (not `'-S'`).
   The correction **strengthens** the conclusion: sanitisation covers whitespace anywhere in `item_code`,
   including the bare `productOptionCode`. **MEASURED** field values, **INFERRED** transform.
2. **⚠ `PutEventsFailedEntriesCount` carries ZERO dimensions** — a regional aggregate across every caller
   in the account, so it can **never** be scoped to our bus and can never answer a per-bus question. What
   *is* rule-scoped: `Invocations`, `MatchedEvents`, `TriggeredRules`, `FailedInvocations`. **Relevant to
   any future 1117 monitoring design** — don't design an alarm around a metric that can't be filtered.
3. **⚠ Products 30706 / 30707 (`NUSMU23-101A - MTEST` / `- WTEST`) look like test products sitting in Cin7
   PRODUCTION, Public + Primary — poller-eligible and shipping to SCALE.** Not this epic's problem, but
   somebody should know. **Not in any ticket. Raise it with whoever owns CTC data.**

---

## 2. Sessions — run each in a fresh IDE session

### S1 — Phase 4 documentation pack ✅ COMPLETE 2026-08-18

**Ran, delivered, and amended.** Four drafts on disk, ready for JJ to apply by hand:
`DRAFT-QA-DOC-BUSY-1116.md` · `DRAFT-QA-DOC-BUSY-1117.md` · `DRAFT-E2E-HANDOVER.md` ·
`POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`.

**Four amendments applied after review:** the 1117 draft gained the AC coverage map it was missing (and
**AC4 is a FAIL** — zero SNS subscribers, blocked on the distro address open since 31 July) · **ID3
downgraded to PARTIAL** (nothing ever tested out-of-order arrival, so it can't borrow UP3's evidence) ·
TC6's self-contradictory wording fixed · the ticket draft **replaced with a findings handover** — QA
raises nothing in Jira.

✅ **The 1116 draft's §7 has been updated with Plan D's results — it is now safe to apply.**

_Original prompt, retained for reference:_

Produces four drafts for JJ to apply (agents must not push Confluence or Jira):

1. **Replacement content for QA DOC - BUSY-1116** from `BUSY-1116-QA-DOC-UPDATES.md` — the TC renumbering
   (TC7/TC8/TC9), the new OV group, Phase 0–3 verdicts, the contradiction register, the AC-by-AC table.
   **Update it first** with the Plan A/B/C outcomes, which post-date the draft.
2. **A new QA doc for BUSY-1117** — none exists, and its findings live only inside the 1114/1115/1116 docs.
   Must include the **corrected** validation-alarm finding (the alarm exists; the real gap is zero SNS
   subscriptions) and the `PutEventsFailedEntriesCount` dimensionality limitation.
3. **The E2E handover section.**
4. ~~One ticket body~~ → **a findings handover, not a ticket.** Delivered as `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` — plain-language summary for the project team plus the questions to put to dev. **QA raises nothing in Jira.**

```
Read CLAUDE.md in ~/Desktop/testing-tools (request folder access if needed), then
REMAINING-WORK-PLAN.md, then BUSY-1116-QA-DOC-UPDATES.md.

No testing. Do not touch AWS, Cin7, the watermark or any config. Do NOT edit Confluence or Jira — I
push those. Produce drafts only.

Deliver four things:

1. Full replacement content for QA DOC - BUSY-1116 (page 1859354632), applying
   BUSY-1116-QA-DOC-UPDATES.md — but FIRST reconcile that draft against the newer results files
   CTC-WHITESPACE-REAL-PATH-RESULTS.md and CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md, which post-date it.
   Specifically: ERR5 closes as a HARNESS ARTEFACT (no ticket) with the corrected whitespace-run-collapse
   mechanism, and TC3's poller-layer question closes as "latent risk, no occurrence" (note to dev, not a
   ticket) with the 31,731-record hour-by-hour reconciliation as evidence. The check-status.sh bugs are
   fixed. Include the renumbering (TC7 budget/duration, TC8 published-AND-linked, TC9 content), the OV
   group, and the AC-by-AC sign-off table.

2. A new QA doc for BUSY-1117 — none exists. Include: the corrected validation-alarm finding (the alarm
   staging-catalog-manhattan-sender-validation-failures EXISTS and is correctly wired at >10 in 900s; the
   real gap is ZERO SNS subscriptions, which is notification plumbing not a missing alarm), the
   send-dlq-depth threshold (depth > 0, saturated since 08-10 so a fresh transition can't be shown), the
   cin7-watermark-stale idle false-positive, and the finding that PutEventsFailedEntriesCount carries no
   dimensions so it can never be scoped to a bus.

3. An E2E handover section: what we covered, what stays dev-attested, and the limits the E2E team needs —
   send-dlq-depth saturated, alerts topic with zero subscribers, SCALE does NOT clear a field on an empty
   tag (SAVE is additive, measured), 100% of CTC items are 0.1 x 0.1 x 0.1 MM, and SCALE accepted an item
   code containing a double space (trimming it later would create a second item, not an update).

4. NOT a ticket - a findings handover for the project team. They decide whether a ticket is needed, not
   us. Plain-language summary (no field names or code references) plus a separate short list of what to
   ask dev first. Note that two of the five triggers (over-length Size / item_code) may be intentional,
   since erroring rather than truncating was a deliberate dev choice - so the open question is whether
   erroring should abort the BATCH or just the RECORD.

Keep it concise, same style as the existing docs. Flag anything you can't substantiate from the results
files rather than filling the gap.
```

### S2 — Plan D ✅ COMPLETE 2026-08-18 — both questions closed

**Free (bus-injection only), ~45 min elapsed / ~10 min hands-on. Full plan + kick-off prompt:
`PLAN-D-MODEA-BATCH-CONTAINMENT.md`.**

**A gap in our own testing, found 2026-08-18.** All five Mode A repros (uncaught `validateItemDownload`
throws — including the over-length `Size`/`item_code` cases JJ observed) were deliberately sent **one at a
time, ~3 min apart**, on the brief's stated assumption that batching them would destroy the good records.
**That was a precaution, never a measurement.** Every fast-isolation result we cite is **Mode B**
(Manhattan rejecting a value, where the call completes) — which is not evidence for Mode A, because in
Mode A the send never happens.

**Rev 2 (2026-08-18): budget and blast-radius constraints lifted by JJ.** Testing takes priority over all
allowances — spend AWS calls, Manhattan sends, DLQ depth and Cin7 **GET** budget freely, rewind the
watermark, disturb the shared pipeline. **The one hard constraint remains: never write to Cin7.**

Five tiers, one session: **T1** scale (1 poison + 20 controls, DLQ delta is the headline) · **T2** all five
Mode A triggers, incl. the unguarded `weight` path · **T3** real traffic via a watermark rewind — the
representative case · **T4 ⚠ cross-tenant** · **T5** poison density and mixed Mode A/B.

**T4 is the standout, and Rev 1 had it backwards** — it was listed as a hazard to avoid. The buffer is
**shared** and batches are **not company-scoped**, so a CTC Mode A throw may be able to block **UNI**
records. If it can, that's a cross-tenant availability defect affecting a live integration outside CTC's
scope — considerably more serious than anything CTC-only, and nobody has ever tested it.

**✅ Both runs passed. Run sheet and per-run prompts retained in `PLAN-D-RUNSHEET.md` for the record.**
Runs 3/4/5 deliberately dropped — the bisection is proven content- and tenant-agnostic, so remaining
triggers route through the same recovery, and Run 4's only real value was sharpening a **code-intent**
question about the `weight` guard that a behaviour test can't answer. Ask dev instead.

### S3 — optional, free, ~15 min: upgrade the mechanism from INFERRED to MEASURED

Only worth doing if you'd rather not spend a question on Kian. Skip it otherwise.

```
Read CLAUDE.md in ~/Desktop/testing-tools, then CTC-WHITESPACE-REAL-PATH-RESULTS.md §5.3.

One task, free and read-only. No Cin7 calls, no watermark writes, no config changes.

The poller's message_group_id transform is currently INFERRED, not MEASURED: we believe it collapses each
whitespace run in item_code to a single underscore. Confirm it from retained logs.

Take the 13 productOptionCode values listed in §3 of that results file and search the full retained
poller log history for each. For any that appear, quote the literal item_code and the literal
message_group_id side by side. A single hit showing a collapsed-underscore group id upgrades the
transform to MEASURED.

Log retention is never-expire so this is free. These are older low-churn products, so they may not appear
in the retained window — absence is NOT evidence either way, and say so plainly rather than reaching for a
conclusion. Do not spend Cin7 budget to force one into a window.

Report findings and update CTC-WHITESPACE-REAL-PATH-RESULTS.md §4 with the verdict.
```

### S4 — optional build: the automation candidates

Only if you want them now. None blocks sign-off.

- **Programmatic SCALE state lookup** — the standing top automation candidate, and **newly feasible now
  the item lookup screen has been found**. Would turn the ~13-field-per-item eyeball pass into one
  command and make it a re-runnable regression guard. **Needs the navigation path captured first.**
- **`preview-cin7-sync.sh --until`** — a client-side upper bound. Needed for any future reconciliation.
- **Evidence-capture helper** — pull the poller/sender log lines for a given `item_code` + window.
  Write-up is now the main non-testing overhead.
- **`scan-bare-code-whitespace.sh` verdict fix** — its printed verdict counts fields that don't reach the
  group id and reported 2,942 when the real figure was 47. One-line filter fix so nobody trusts it later.

---

## 3. JJ-only — not agent work

| # | Action | Blocks |
|---|---|---|
| 1 | **Apply the 1116 QA doc changes** (from S1) | 1116 sign-off |
| 2 | **Chase the LLD link** — runbook published 2026-08-03 but §3.4/§8 don't link it and §13 still lists it outstanding. **Lachlan/Kian** | **AC4 — the long pole** |
| 3 | **Hand over the LLD corrections** — §3.4's overlap claim, §3.3 step 5's per-record emit. Text drafted in `BUSY-1116-PHASE1-RESULTS.md` §3.2 | 1116 doc accuracy |
| 4 | **Two questions to Kian:** the page-cap constant (closes PW10/PW8), and whether the populator was meant to be in the 11–12 Aug deploy. **Optional third:** is the group id built by collapsing whitespace runs in `item_code`? | PW10/PW8 |
| 5 | **Hand the sender findings to the project team** — `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`. **QA raises no ticket.** ⚠ **Run Plan D (S2) first** — it decides whether the finding is "delay only" or a real defect | — |
| 6 | **Send the dev note** on `PutEvents` — check and log `FailedEntryCount` even when zero. Defense-in-depth, not a defect | — |
| 7 | **Capture the SCALE item-lookup navigation path** into `CLAUDE.md` — two sessions lost time to this and it's recorded as a blocker in three QA docs | S4 automation |
| 8 | **Confirm the four-product slot assignment** (6203 golden, 6204 boundary, 6202 burner, 6205 reserve) | any future write work |
| 9 | **Flag products 30706 / 30707** — test products live in Cin7 production, poller-eligible | — |
| 10 | **Decide the runbook end state** — offer our draft's operational sections as additions to the repo copy rather than a competing page | 1116 TC9 |

---

## 4. Standing constraints — unchanged

- **🚫 No Cin7 writes.** The four ids are recorded for containment and disclosure, **not** as approval.
  `cin7-testset.sh` does not exist and **must not be built until JJ asks.** If a test seems to need a
  write: stop and tell JJ.
- **Do not run Plan B2.** It would deliberately strand real records to prove a behaviour that has never
  manifested across 175 cycles and ~2 weeks of real churn.
- **Do not run Plan A tiers A2 or A3.** Both were made unnecessary.
- **Do not edit Confluence or Jira** — JJ pushes those.
- **Watermark `UNSET`** (v188), buffer 0/0, DLQ **19** — all attributable QA evidence, don't purge without
  checking the inventory in `BUSY-1116-PHASE1-RESULTS.md` §4.
- **Bus injection is not always representative.** A FAIL from injection is **not** automatically a live
  defect — that misreading nearly produced a wrongly-raised ticket on this epic.
