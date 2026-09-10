# Stress & graceful error-handling test cases — CTC/Cin7 pipeline (1114/1115/1116)

Execution-oriented companion to the per-ticket QA docs and `QA-BUNDLE-REPLAN.md`. These are the
**stress / volume** and **graceful error-handling** cases not covered by the functional TCs in the
Confluence docs. For IDE Claude to help drive later — all are **NOT RUN** until executed.

Read `CLAUDE.md` and `SESSION-FINDINGS-2026-08-05.md` first. All the standing guardrails apply:
Cin7 is prod read-only; preview before every watermark rewind (trigger-fan-in inflates cost against
the shared 5,000/day cap); the watermark is a single serialized lever; `--unset` between tests;
default to dry-run; and **anything that breaks a shared secret or forces a failure takes down the
whole combined CTC pipeline on staging — flag co-testers, save/restore, do it last.**

Drive levers: `emit-cin7-record.sh` (synthetic bus-injection, exact content), `cin7-watermark.sh`
(real-data replay), `check-status.sh` (queues/alarms), `tail-logs.sh --lambda cin7-poller|sender|buffer`.
Judge SCALE outcome from the **sender log / `rejectedTransactions`**, never HTTP status (always 200).

---

## Graceful error-handling (GE)

| ID | Ticket / AC | What it checks | How to drive | Expected | Cautions |
|---|---|---|---|---|---|
| GE1 | 1116 AC1 · 1115 AC4 | Record missing `item_code` reaching the sender | `emit-cin7-record.sh --missing-option-code --confirm` (blank `item_code`) | **Target:** INFO validation-failure log + per-record skip, batch continues, no uncaught exception. **Current (bug):** logs then throws, bisection isolates, poison → buffer DLQ after 10 retries. Record which. | Known crash-instead-of-skip defect — this TC is the regression guard for the fix |
| GE2 | 1115 AC1 · 1116 AC1 | Record missing `desc` (falls back displayname→vendor+colour+size) | `emit-cin7-record.sh` with blank `desc` (+ blank fallbacks) | Validation-failure logged, record skipped cleanly, never emitted onward; no crash; other items unaffected | ⚠ **NOT ACTUALLY TESTED (2026-08-07) — tooling gap.** The script auto-fills a default description whenever the value is empty (`if [[ -z "$DESC" ]]`), even from an explicit `--desc ""`, so a truly blank `desc` can't be put on the wire. `--desc " "` was used as a proxy and was simply **accepted** — which neither confirms nor rules out the fallback behaviour. **Blocked until `emit-cin7-record.sh` gets a `--desc-raw` escape hatch.** |
| GE3 | 1115 AC1 · 1116 AC2 | SCALE-rejected field value isolated mid-batch | `emit-cin7-record.sh --dimension-uom M --confirm` inside live traffic — `M` is used here purely as a **known-reject lever** to generate a poison record on demand | Single record rejected (`Invalid dimension um "M"`), bisection isolates it, all other items in the batch still `accepted`/deleted, poison drains to DLQ — no data loss | Verified once (181-item batch); re-run at larger scale. ⚠ **The `M` rejection is not a defect** — `MM` is the confirmed-correct value (closed with dev + design council 2026-08-07). This TC tests *batch isolation*, not the UOM mapping; never log it as a `DimensionUm` failure |
| GE4 | 1115 AC1 | Malformed / oversized / wrong-type field | `emit-cin7-record.sh` with an oversized `desc`, non-numeric weight, null vs empty | Mapper defaults-and-reports or the sender skips gracefully — never silent, never an uncaught crash | **PARTIAL (2026-08-07).** *Oversized `desc` — done:* 617 chars → `ManhattanSchemaValidationError` (`stringLength_100`), rejected not truncated, isolated cleanly to DLQ. **Manhattan's `Desc` limit is a hard 100 chars.** *Non-numeric weight — NOT tested, tooling gap:* the script's `num()` helper coerces unparseable values to `0` **before** building the payload (`--weight "not-a-number"` → `weight:0`), so this only ever tested the script's own sanitisation. **Blocked until a `--weight-raw` escape hatch exists.** |
| GE5 | 1116 AC1 | Forced failure at each poller stage | (a) invalidate `staging/catalog/cin7` → `/Products` auth fail; (b) block `/ProductOptions`; (c) fail `PutEvents` mid-emit (needs a hook — confirm with dev) | Cycle abandoned; watermark **byte-for-byte unchanged**; next 3-min cycle re-covers | **Destructive — whole CTC pipeline. Snapshot watermark; restore secret; last.** (a) is the only one cleanly QA-drivable today |
| GE6 | 1116 AC1 · 1115 | Manhattan endpoint unavailable (send-side failure) | Corrupt `staging/manhattan/oauth2` `client_secret` briefly | Sends fail as `client_error`; records stay on buffer, retry on flush, eventual DLQ; **poller + Cin7 side unaffected** (watermark still advances) | **Blast radius: every store's sends, not just CTC. Flag widely; restore immediately** |
| GE7 | 1116 AC4 · 1117 | DLQ landing + `send-dlq-depth` alarm behaviour | Let a GE1/GE3 poison run to `maxReceiveCount` (10, ~30 min) | Poison lands in `staging-catalog-manhattan-item-buffer-dlq.fifo`, body intact; alarm state matches depth threshold | **PASS — strongly reconfirmed 2026-08-07 with 4 concurrent unrelated poison items.** `QA-CS6-LONGDESC` landed ~02:12; `QA-DU2-M`/`-CM`/`-EA` landed by ~02:23 — each at exactly 10 retries / ~30 min from its own first failure, bodies verified byte-for-byte. Zero data loss, zero stuck messages, independent drain per item. DLQ now holds 6 inert test messages (2 pre-existing + these 4). ⚠ **Coverage limit:** this only covers faults that reach SQS — see the CS5 defect, where the failure happens *upstream* of the queue and the record can never reach any DLQ. |
| GE8 | 1117 (monitoring) | Validation-failure storm alarm coverage | Drive 11+ CTC validation failures in 15 min (GE1/GE2 repeated) | **Gap found:** no CTC/generic validation-failure alarm exists (only per-store `us`/`ps`), so a real storm alerts no one — confirm and record for 1117 sign-off | Not a fail of 1114-1116; a 1117 coverage hole |

## Stress / volume (ST)

| ID | Ticket / AC | What it checks | How to drive | Expected | Cautions |
|---|---|---|---|---|---|
| ST1 | 1115 AC1 | Fan-out on a high-option product | `find-cin7-product-by-id.sh` for a product with many options → narrow watermark rewind onto it | One record per option, all mapped and delivered; `recordsEmitted` = active option count | Preview first |
| ST2 | 1115 · sender packing | `≤1 MB` payload chunking under a big flush | `emit-cin7-record.sh` a large set into one ~3-min flush window (or a rewind that emits many) | Sender packs into one or more ≤1 MB grouped payloads; every item lands; no oversize failure | Smoke of the boundary, not the exact 1 MB edge (unit-tested) |
| ST3 | 1115 AC5 | Cin7 429 / rate-limit under pagination | Mock 429 at the `libs/cin7` boundary (dev-side) | ~350 ms spacing (<3/s); single `Retry-After` retry then throw → poller exits early, watermark untouched | Do **not** try to breach the real shared quota |
| ST4 | 1114 · 1116 | Sustained cadence soak (steady state) | Set a modest real watermark, leave the poller running for several hours | Every cycle completes, watermark advances, queues drain to 0/0 between cycles, no backlog/leak, alarms healthy | Watch the Cin7 budget over the soak |
| ST5 | 1116 AC3 · AC4 | Full-catalog reset volume + budget | `cin7-watermark.sh --set <old-date>` — **bounded look-back first**, measure, then extrapolate | Full modified-since range re-syncs; request count + duration recorded for the runbook; idempotent (before/after SCALE state) | **DEFERRED 2026-08-07 (JJ's call) — churn makes it unaffordable today.** Preview-only sizing, zero real cost: **1 hour back = 1,422 records**; **6 hours back = 4,949 records — essentially the entire 5,000/day cap in one window.** Churn is ~24 records/min vs ~1/min on 08-05/06 (**~24x**), so even the smallest useful look-back now rivals the historical *full* bulk reseed (~4,671) this test was meant to stay safely under. **Wait for a quiet-churn window and re-preview before committing.** Still the largest outstanding deliverable, with the TC8/TC9 runbook. |
| ST6 | 1116 AC2 | Coalesce under high duplicate volume | Freeze watermark so many options re-emit repeatedly within one flush | All duplicates collapse to a single SCALE upsert per item, `max(read_at)` wins; `BatchCoalesced` reflects the ratio | Judge net SCALE state, not one flush |
| ST7 | 1114 · buffer | Buffer backlog build-up and drain | Burst a large batch, watch `check-status.sh` queue depths | Depth spikes then drains cleanly to 0/0; no DLQ; in-flight vs waiting behave | — |
| ST8 | 1116 AC2 | Poison + healthy throughput at scale | Run GE1/GE3 poison alongside a large healthy batch | Poison isolation does not block throughput — healthy items keep delivering while the poison retries toward DLQ | **PASS — reconfirmed 2026-08-07 under a 5-way FIFO-group mix.** A known-good control record (`QA-POSTPOISON-CONTROL`) fired immediately behind a 4-poison batch was isolated and delivered in **~13 seconds** (01:51:34 batch attempt → 01:51:47 `accepted=1 rejected=0`), not the ~30-min poison-to-DLQ timescale. Bisection trace: `[M,CM,mm,EA,CONTROL]` → 3 rejected → `[mm,EA,CONTROL]` → `accepted:2` (mm + CONTROL) → `[CONTROL]` alone → accepted. **Nothing queues behind poison retries.** Also confirmed 08-05/06 at 181 items. |

---

## Progress summary (updated 2026-08-12 — supersedes the 08-07 block below)

**GE2 and GE4 are DONE, both FAIL.** The `--desc-raw` / `--weight-raw` escape hatches were added to
`emit-cin7-record.sh` on 2026-08-10 and both cases were run that day. Neither behaves as the
"graceful skip / silent default" the original test case assumed:

- **GE2 (blank `desc`)** — throws in `validateItemDownload`, same function as the missing-`item_code`
  crash, different named check.
- **GE4 (non-numeric `weight`)** — throws a raw `TypeError: value.toFixed is not a function` one
  level deeper in `roundToSchemaPrecision` (called from `mapToItemDownload`), with **no upstream type
  guard at all**.

Treat GE1 / GE2 / GE4 as **one systemic defect with three repros — the sender has no per-record
containment for a bad field value** — not three separate bugs. An uncaught throw aborts the whole
batch invocation before bisection isolates it. See `BUSY-1115-CLOSEOUT-RESULTS.md` for verbatim
errors and timestamps.

**GE4's oversized-`desc` half is now a moving target.** It found Manhattan's hard 100-char `Desc`
limit, enforced by **rejection**, not truncation (CS6). As at 2026-08-12 Kian has pushed a
**truncation** function to staging that changes our side of that behaviour — **untested**. See
`CTC-FIX-RETEST-BRIEF.md`, which re-tests it and probes the 100/101 boundary for the first time.
Tag any new desc-length result against **CS6 and GE4**.

**Coverage gap, not covered anywhere in this file or the extended one:** `colour` and `size`
**length limits**. Picked up as Groups C and D of `CTC-FIX-RETEST-BRIEF.md`.

**GE7 — do not trust a written DLQ baseline.** The depth has been 6, then 0 (purged), then 3, then 4.
Measure it at the start of every session. There is only one DLQ queue,
`staging-catalog-manhattan-item-buffer-dlq.fifo`; `send-dlq-depth` is an alarm watching it, not a
second queue. Note it has been in `ALARM` since 2026-08-10, saturated by the resident messages — a
new arrival will not produce a fresh transition or SNS publish.

---

## Progress summary (2026-08-07 — historical, see above for current)

**PASS / done:** GE3 (SCALE-reject isolation), GE7 (DLQ landing — reconfirmed with 4 concurrent
poison items), ST8 (poison + healthy throughput, ~13s control-record isolation).
**PARTIAL:** GE4 (oversized `desc` done — 100-char hard limit found; non-numeric weight blocked).
~~**BLOCKED — tooling:** GE2 and the rest of GE4 need `--desc-raw` / `--weight-raw` escape hatches in
`emit-cin7-record.sh`; the script sanitises its own input, so neither case has actually been
exercised yet.~~ — **RESOLVED 2026-08-10: flags added, both cases run, both FAIL. See the current
summary above.**
**BLOCKED — infrastructure/permissions:** GE5 (forced poller failure) — warm-container reuse plus
the permission classifier, three attempts. Needs JJ's own AWS session; fold into an ST4 soak.
**DEFERRED — budget:** ST5 (see the churn note above). **NOT RUN:** GE1 re-run as regression guard,
GE6, GE8, ST1, ST2, ST3, ST4, ST6, ST7.

**Also worth carrying into GE-family thinking:** the CS5 whitespace defect
(`EXTENDED-COVERAGE-TEST-CASES.md` §C) is a graceful-error-handling failure that this file's GE
cases would never have caught — it fails **upstream of SQS** in the buffer-populator, so it produces
no log in the usual places and can never reach a DLQ. Consider a GE9 covering "faults before the
queue" as a distinct class.

## Notes for execution order
1. Non-destructive stress first (ST1, ST2, ST6, ST7) — real-data or bus-injection, watermark restored.
2. Graceful-skip / rejection cases (GE1–GE4, GE7, GE8) — mostly bus-injection, bounded cost.
3. Destructive forced-failure last (GE5, GE6) and the budget-heavy reset (ST5, ST3) — coordinate, snapshot/restore, one at a time.
