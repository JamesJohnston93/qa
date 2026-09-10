# testing-tools — Manhattan / Cin7 QA harness (IDE context)

You are helping **JJ (QA)** run manual/exploratory QA on the **Catalog → Manhattan SCALE WMS**
item-sync pipeline and its **CTC/Cin7** extension. This folder is **QA tooling, not shipped code** —
it lives outside the monorepo on purpose. Scripts wrap AWS CLI + Cin7's API so QA can drive and
observe the deployed pipeline without deep CLI/AWS familiarity.

**Last reconciled: 2026-08-19.** Read `README.md` for full walkthroughs; this file is the fast
context + **guardrails**.

**2026-08-19 update — BUSY-1117 AC1 CLOSED live, AC5 open, SNS subscription now exists:** a
deliberately-forced blank-secret + cold-start test (two sessions, see `BUSY-1117-AC1-RERUN-LOG.md` /
`-RESULTS.md`) produced a genuine `watermark-stale` OK→ALARM transition — the first time this AC has
had live evidence rather than an unverifiable retrospective gap (the one organic 2026-08-05 episode
predated the alarm's own creation by 5 days). **AC1: PASS (MEASURED)**, but flagged — actual
time-to-alarm was **2h30m56s** from the last good cycle, ~31 min (~26%) over the AC's "~2 hours"
language; JJ to judge whether that overshoot matters against the literal wording. **AC5 (empty
cycles raise nothing): UNKNOWN** — zero naturally-occurring "active but zero-record" cycles exist
anywhere in 7 days of retained logs (the watermark sits `UNSET` almost all the time; every real
cycle ran during a deliberately-scoped QA window with known changes), so whether the watermark
advances on a genuinely quiet active cycle has never been observed either way. **Also: the alerts
SNS topic is no longer at zero subscribers** — see the corrected row below. Full recovery was
verified (secret restored, cold start forced, all four recovery conditions confirmed by direct
reads) and the watermark has been **returned to `UNSET`** at the end of this work.

---

## STATE — where the epic actually is

> ### ➡ WORK FROM `FINAL-WRAPUP-RUNSHEET.md` (rev 2, 2026-08-18).
> It is the single ordered action list for finishing this epic: the read-only AWS verification session
> first (exact log groups, alarm names and time windows in its §2), then the sends, AC/LLD wording
> changes and housekeeping. `REMAINING-WORK-PLAN.md` is superseded by it. `CTC-QA-STATE-INDEX.md` is
> still the measured-state record but its §1 and §4 have drifted — the runsheet's §0 is authoritative
> on ticket/Confluence state.

**Tickets:** BUSY-1113 **Done** · 1114 **Done** · 1115 **Done** · **1116 Review** · **1117 Review**

**Phases 0–3 executed 2026-08-13/14; Plans A, B, C and D ALL COMPLETE as of 2026-08-18.**
Plan D existed because a gap in our own coverage turned up: whether an uncaught validation throw takes
co-batched valid records down with it was never tested. **Runs 1 and 2 answered it — it does not, and
there is no cross-tenant impact either** (see the bisection facts below). Run 4 optional, Runs 3/5
dropped. **Read `REMAINING-WORK-PLAN.md`.**

**✅ CONFLUENCE IS NOW UP TO DATE — do not re-apply the drafts.** Applied 2026-08-18:
`QA DOC - BUSY-1116` (page 1859354632, v10) · `QA DOC - BUSY-1117` (page 1894088713, v2 — created this
day; none existed before) · `CTC Item Master — E2E / downstream handover` (page 1894973441, NEW).
The on-disk `DRAFT-QA-DOC-*.md` / `DRAFT-E2E-HANDOVER.md` files are now **historical drafts, not pending
work.** ⚠ Two claims were deliberately DOWNGRADED on the live 1116 page and the drafts may not reflect
it: **TC6 → PARTIAL** (no before-snapshot of SCALE state was ever taken) and **ID3 → PARTIAL**
(out-of-order arrival was never tested). Do not "restore" them to PASS.
**No Jira ticket has been created and QA is raising none** — findings go to the project team instead.

**Read these first, in this order:**

0. **`FINAL-WRAPUP-RUNSHEET.md`** — the ordered remaining-work list (rev 2, 2026-08-18).
1. **`CTC-QA-STATE-INDEX.md`** — the reconciled current state: measured results, environment quirks,
   open items with owners. Mirrored in the *WMS integration QA* project.
2. **`POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`** — the findings pack handed to the project team.
   ⚠ `BUSY-1116-QA-DOC-UPDATES.md` and the `DRAFT-*.md` files are **APPLIED and historical** — see above.

**Plans A, B and C are complete. Plan D Run 1 is done and passed.** See **`PLAN-D-RUNSHEET.md`** for the
remaining Plan D prompts, and **`REMAINING-WORK-PLAN.md`** for everything else.

| Plan | Question | File |
|---|---|---|
| **A** | ✅ **COMPLETE 2026-08-18 — harness artefact, no ticket. Residual scanned and closed.** | `PLAN-A-WHITESPACE-REAL-PATH.md` · results: `CTC-WHITESPACE-REAL-PATH-RESULTS.md` |
| **B** | ✅ **ANSWERED 2026-08-18 — latent risk, no occurrence. Note to dev, no ticket. DO NOT run B2.** | `PLAN-B-PUTEVENTS-PARTIAL-FAILURE.md` · results: `CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md` |
| **C** | ✅ **COMPLETE 2026-08-18** — all 7 checks run by JJ. | `PLAN-C-SCALE-MANUAL-CHECKS.md` |
| **D** | ✅ **Run 1 PASSED 2026-08-18 — 20/20 valid controls delivered in ~35s, only the poison isolated. The batch-abort concern is CLOSED.** Run 2 (cross-tenant) optional-but-worthwhile; Run 4 trimmed to the `weight` trigger; Runs 3/5 dropped. | `PLAN-D-MODEA-BATCH-CONTAINMENT.md` · `PLAN-D-RUNSHEET.md` |

**Results files** (the measured record — trust these over any brief or plan):
`BUSY-1116-PHASE0-RESULTS.md` … `-PHASE3-RESULTS.md` · `CTC-FINAL-QA-PASS-RESULTS.md` ·
`CTC-FIX-RETEST-RESULTS.md` · `BUSY-1115-CLOSEOUT-RESULTS.md` · `CS5-ERR5-RETEST-RESULTS.md` ·
`SESSION-FINDINGS-2026-08-05.md` / `-08-07.md`

⚠ **Older briefs and backlogs are historical.** `CTC-FIX-RETEST-BRIEF.md`, `CS5-ERR5-RETEST-BRIEF.md`,
`CTC-FINAL-QA-PASS-BRIEF.md`, `QA-BUNDLE-REPLAN.md` and `CS5-LIVE-TRIGGER-CHECK.md` have all been
**executed**. `STRESS-AND-ERROR-TEST-CASES.md` and `EXTENDED-COVERAGE-TEST-CASES.md` still hold the
case definitions and IDs (use them for tagging), but **their own progress summaries are stale** —
trust this file, `CTC-QA-STATE-INDEX.md` and the results files.

---

## Pipeline in one picture

```
Cin7 Omni (PRODUCTION — read-only EXCEPT four allowlisted products, see Hard Constraint 1)
  └─ cin7-item-poller Lambda  (poll /Products AND /ProductOptions from the watermark's EXACT value;
     options are triggers-only → full product read, chunked <=100 ids; fan out 1 record per ELIGIBLE
     option; emit via PutEvents BATCHED <=10 records per call)
        └─ poller's OWN bus  staging-catalog-cin7-events
             └─ forwarding rule (staging-catalog-manhattan-cin7-forwarding-rule,
                pattern detail-type=manhattan_item_enriched)
                  └─ shared internal bus  staging-catalog-manhattan-events  (company=UNI|CTC)
                        └─ buffer-populator → buffer (FIFO, ~3-min flush, coalesce)
                             → sender (full ItemDownload mapping) → Manhattan SCALE staging
```

CTC is a **second tenant** of the shared UNI pipeline. Every record carries `company` (`UNI`|`CTC`);
CTC is statically `Company=CTC` in Manhattan. CTC is **not** catalog-backed — no `--store` flag, no
DynamoDB table, no `us`/`ps` dimension. The poller is a **singleton per stage** with
`ReservedConcurrentExecutions: 1`, so scheduled and manual runs cannot race, and its only test lever
is the **watermark** — a single SSM parameter, so watermark-driven tests **cannot run concurrently**
and must be serialized.

---

## HOW WE TEST

**There is no Cin7 sandbox and no Cin7 staging.** The only Cin7 environment is **production**.
**Staging's poller reads prod Cin7**, so genuine prod edits flow into staging continuously.

**Primary method:** find a real product of the shape a test needs (`find-cin7-item.sh`,
`find-cin7-product-by-id.sh`), then use the **watermark** to control which window staging re-reads
(`preview-cin7-sync.sh` first, then `cin7-watermark.sh --set … --confirm`).

**Bus-injection is the fallback** for exact controlled content — `emit-cin7-record.sh` PutEvents a
synthetic record onto `staging-catalog-manhattan-events`, **bypassing the poller entirely**. Prefer
live where the poller's own behaviour is the point. **Synthetic-payload gotcha (BUSY-1113):** use
`desc` (not `description`) and include `additional_eans: []`, or the sender throws instead of
validating.

⚠ **Bus injection is not always representative — this cost a week and nearly a wrongly-raised ticket.**
It builds `message_group_id` by raw `"{company}#{item_code}"` concatenation. **The real poller does not** —
it **collapses each whitespace run in `item_code` to a single underscore**
(`{company}#re.sub(r"\s+","_",code)`), so whitespace never reaches the group id from any source field.
⚠ **Do not repeat the earlier "assembled from separate clean fields" theory — it was falsified.** See the
whitespace gotcha for the evidence. **When a result depends on the group id, or on any
of the poller's own pre-emit logic, injection cannot answer it — and a FAIL from injection is not
automatically a live defect.**

---

## HARD CONSTRAINTS — do not violate

1. **🚫 CIN7 IS PRODUCTION. DO NOT WRITE TO CIN7. GET-ONLY, NO EXCEPTIONS, TODAY.**

   Four CTC products were made API-editable on 2026-08-13 and their ids ARE now recorded (table
   below) — **but the write path is still NOT open and you must not use it**, because:

   - **`cin7-testset.sh` does not exist.** Every Cin7 script in this folder is GET-only, so there is
     no sanctioned write path and no enforcement of the allowlist in code.
   - **JJ has not authorised writes.** Recording the ids was for containment and disclosure, not
     approval.

   **Therefore: no agent may issue a POST/PUT/PATCH/DELETE to Cin7 under any circumstances, and must
   not hand-roll one via `curl`/`aws`/a script to work around this.** If a test appears to require a
   Cin7 write, **stop and tell JJ** — do not improvise. Writing to the wrong product is
   unrecoverable: these are live production records.

   **DO NOT BUILD THE WRITE TOOLING UNTIL JJ EXPLICITLY ASKS.** He has said the absence of it is
   currently a feature, not a gap. Do not offer to build it, do not scaffold it "ready to go", do not
   add a write flag to an existing script.

   **When JJ does ask, the write path opens only when ALL of the following exist:** `cin7-testset.sh`
   with the four ids hard-coded and un-bypassable (refuse any other id, exit non-zero, **no override
   flag, no env var**) · read-modify-write enforced internally · a `fixtures/` snapshot taken first ·
   dry-run by default, `--confirm` to write · an append-only `fixtures/write-log.jsonl` · and
   `cin7-codes-register.md` for every code minted on the burner.

   ⚠ Even then, an option-***code*** edit is risky beyond QA — it can break links to stock, orders
   and history **inside Cin7 itself**, independently of our pipeline, and it mints a permanently
   orphaned SCALE item. Confirm ownership with CTC merchandising first, and only ever on the burner
   product. Full rules: *Cin7 write access — expanded coverage plan* in the project, §1–§3.

   **ALLOWLIST — recorded 2026-08-18 by JJ. These four product ids, and NOTHING else, are ever
   writable. Any other id: refuse and stop.**

   | Product id | Code | Name | Options | Product status | Suggested slot |
   |---|---|---|---|---|---|
   | **6202** | `TEST1` | `test Product` | **1** | Public | **P3 burner** — only product whose option codes may change (1 option = 1 orphan SCALE item per code edit) |
   | **6203** | `TEST2` | `testProduct` | 4 | Public | **P1 golden** — fully-populated fixture; codes never change |
   | **6204** | `TEST3` | `testProduct` | 4 | Public | **P2 boundary** — field-value probes; codes never change |
   | **6205** | `TEST4` | `testProduct` | 4 | Public | **P4 reserve** — pristine negative control; never edited |

   Slot assignment is a **proposal pending JJ's confirmation**; the four ids are confirmed.

   ⚠⚠ **CRITICAL — ALL FOUR ARE STRUCTURALLY INELIGIBLE AS THEY STAND. The poller will NEVER emit
   them.** Every option on all four is `optionStatus=Disabled`, and eligibility requires
   `Product.status=Public` **AND** `ProductOption.status=Primary`. These are exactly the products
   Phase 1 used as the negative examples for the eligibility gate (PW5, PW7 — each contributed
   **zero** emitted records, 100% of options skipped).

   **Consequence: the write-access plan's §4 end-to-end pass cannot work as written.** No edit to
   content will make a record flow, because the option never becomes eligible. **Any test that needs a
   record to reach SCALE must FIRST flip an option from `Disabled` to `Primary`** — which is itself a
   write, changes the product's meaning as a fixture, and must be reverted afterwards. Plan that
   deliberately (it is W19 in the write-access plan) rather than discovering it mid-pass.

   ✅ **Risk note, revised down:** these are purpose-made test products (`TEST1`–`TEST4`,
   `testProduct`), not real merchandise. The earlier warning about breaking live stock/order links
   inside Cin7 is **much less severe than originally stated**. The genuine remaining cost of an option
   **code** edit is that it mints a permanently orphaned SCALE staging item.

   **MANDATORY DISCLOSURE — JJ's standing instruction, 2026-08-18.** Any time a Cin7 edit is
   contemplated, state ALL of the following to JJ **before** it happens, and wait:
   - the exact **product id** and which slot it is
   - the exact **field**, its **current value**, and the **new value**
   - the exact **HTTP verb, URL and full payload** that will be sent
   - **blast radius** — what flows downstream, what SCALE items it creates or changes
   - **how it will be reverted**, and whether the revert is clean, leaves residue, or is one-way
   No batching several edits behind one approval. No "and while I was there". One edit, one
   disclosure, one approval.
2. **`preview-cin7-sync.sh` before EVERY rewind.** The `/ProductOptions` trigger-fan-in means even
   short windows sweep in unrelated products. The **5,000/day** cap is one shared prod token across
   every stage and consumer, and consumption is invisible to co-testers.
   ⚠ **But see the cost model below — the old "6 hours ≈ the whole daily cap" figure was wrong.**
3. **Watermark values are UTC** (`…Z`, AEST − 10h). `cin7-watermark.sh` enforces this.
4. **`UNSET` the watermark whenever not mid-test** (`--unset --confirm`) — it deactivates the poller
   and is the expected idle state. An `UNSET` poller makes **zero** Cin7 calls; an active one costs
   ~960 requests/day standing.
5. **Default to dry-run.** Show the dry run and get JJ's OK before adding `--confirm`.
6. **Never break shared staging secrets or force a failure without flagging first.**
   `staging/catalog/cin7` → the CTC pipeline. `staging/manhattan/oauth2` → **every store's sends**
   (UNI, PS, CTC) — this is why ERR2/"Manhattan unavailable" was deferred by JJ on 2026-08-14.
   **History:** `staging/catalog/cin7` was once found with blank `username`/`apiKey`, silently masked
   because an `UNSET` watermark meant the poller never read it. If the poller stops with
   `"Cin7 secret is missing required fields"`, check the secret's actual value before assuming a new
   bug — a redeploy may have reset it.

---

## ⚠ THE COST MODEL — the old figures in every older doc are WRONG

**Superseded:** *"churn is ~24× baseline; 1 hour = 1,422 records; 6 hours = 4,949 ≈ the entire
5,000/day cap."* That conflated **records** with **requests**.

**Measured 2026-08-14: request cost tracks PAGES and ID-CHUNKS, not record count.**

| Window | Actual cost |
|---|---|
| 6h07m rewind (331 products, 2,270 records) | **15 requests**, one cycle, ~60s |
| Whole 33-min test session (11 cycles, 4,289 records) | **51 requests** (~1% of the daily cap) |
| Kian's 7-day reset (17,886 records) | 90 requests |

A light cycle still costs a **~3-request floor** (1 `/Products` page + 1 `/ProductOptions` page + ≥1
trigger chunk) regardless of how few records it carries.

⚠ **Follow-on nobody spotted at the time: the old rewind cap was a cost guardrail built on a wrong
number, so several "unreachable" blockers are now reachable.** Most importantly **product 29942
(modified 2026-08-06) is within reach** — a rewind to before then is ~12 days ≈ 150–200 requests.
That is Plan A Tier A2 and it is the cheapest route to settling the whitespace question.

**Still preview before every `--set`.** The guardrail stands even though the cost doesn't — blast
radius on a shared pipeline is a separate concern from budget.

---

## Resource names — reconciled against live staging

| Component | Confirmed deployed name | Notes |
|---|---|---|
| Watermark SSM param | `/catalog/cin7-manhattan/item-watermark/staging` | the QA-doc/LLD name does not exist |
| Cin7 secret | `staging/catalog/cin7` | the QA-doc name (`staging/cin7`) does not exist |
| Poller Lambda | `staging-catalog-cin7-cin7-item-poller` | `LastModified 2026-08-12T22:45:44Z`, timeout 300s, 128MB, reserved concurrency **1** |
| Poller cadence | **3 minutes** | live logs — not the ticket's 15-min or LLD's 2-min |
| **Poller env vars** | `WATERMARK_PARAMETER_NAME`, `STAGE`, `CIN7_SECRET_NAME`, `AWS_NODEJS_CONNECTION_REUSE_ENABLED`, **`INTERNAL_EVENT_BUS_NAME`** | Confirmed by three independent reads. **There is NO `MAX_PAGES_PER_RUN` and no Cin7 base-URL var** — so the page cap can't be forced and neither can an endpoint failure. `INTERNAL_EVENT_BUS_NAME` **is** the one usable lever (Plan B2) |
| Poller's own bus | `staging-catalog-cin7-events` | poller PutEvents here, **not** directly onto the shared bus. A forwarding rule relays onward |
| Shared internal bus | `staging-catalog-manhattan-events` | what the buffer-populator listens on; where `emit-cin7-record.sh` injects |
| **Buffer populator** | `staging-catalog-manhattan-item-buffer-buffer-populator` | Sits **between the EventBridge rule and the SQS queue**, upstream of the handler. **No `EventInvokeConfig`, no `DeadLetterConfig`**, and its EventBridge target has no retry/DLQ policy. `LastModified 2026-08-03T13:02:56Z` — **never redeployed**, confirmed four times |
| Buffer handler / queue / DLQ | `...-buffer-handler` · `...-item-buffer-buffer.fifo` / `...-item-buffer-dlq.fifo` | **Only ONE DLQ queue exists** |
| Item sender | `staging-catalog-manhattan-item-sender` | `LastModified 2026-08-12T22:46:32Z`, timeout 30s |
| Send-DLQ alarm | `staging-catalog-manhattan-send-dlq-depth` | **Threshold known exactly: `depth > 0`, 1 × 300s period** — any single message fires it. In ALARM since 2026-08-10, so a fresh transition cannot be demonstrated. **A limit on demonstration, not on knowledge** |
| Validation-failure alarm | `staging-catalog-manhattan-sender-validation-failures` | **EXISTS and is correctly wired** — `SenderValidationFailures`, namespace `staging-catalog-manhattan`, threshold **>10 in 900s**, configured 2026-08-10T04:51:19Z. See the withdrawn finding below |
| Dashboard | `staging-catalog-manhattan-observability-dashboard` | renamed by the BUSY-1117 deploy; `check-status.sh` auto-detects |
| Alerts SNS topic | `staging-catalog-manhattan-observability-alerts` | ⚠ **STALE CLAIM CORRECTED 2026-08-19: no longer zero subscriptions.** One confirmed email subscription now exists (`james.johnston@universalstore.com.au`, added via an interactive SSO session — MEASURED, `list-subscriptions-by-topic` + `get-subscription-attributes`). All four alarms checked (`poller-errors`, `watermark-stale`, `sender-validation-failures`, `send-dlq-depth`) route `AlarmActions` there; `OKActions`/`InsufficientDataActions` are empty on all four, so only the into-ALARM transition ever notifies. **The intended-recipients SSM param `/catalog/manhattan-observability/alert-emails/staging` does not exist anywhere in the account** (confirmed by direct lookup and two account-wide sweeps) — it isn't unwired, there is no config there to wire. The one real subscription is unrelated to that param. See `BUSY-1117-AC4-WIRING.md` for the full trace. |
| Manhattan | `staging/manhattan/oauth2` · `https://unvsstg.manhscale.com` | Region `ap-southeast-2` |

**Emitted record shape:** `detailType manhattan_item_enriched`, `company:"CTC"`,
`item_code:<size-suffixed option code>`, `message_group_id:"CTC#<same>"`, `read_at`, plus the mapped
fields. ⚠ `item_code` is the **size-suffixed** code (`SMU23-135A-M`), **not** the bare
`productOptionCode`. ⚠ **The record carries NO `modifiedDate` field at all** — which is why several
forensic questions (per-record lag, timestamp collision counts) can't be answered from poller logs.

---

## Scripts

| Script | Does | Writes? |
|---|---|---|
| `find-cin7-item.sh` | Find a real Cin7 product/option by status | No — GET-only |
| `find-cin7-product-by-id.sh` | Pull specific product(s) by id, all options | No — GET-only |
| `preview-cin7-sync.sh` | Dry-run a candidate watermark: exact poller queries, trigger-fan-in, full mapping, what would emit/skip. **Its `--max-pages` default (20) is NOT the poller's deployed cap. It has no upper bound** — apply one client-side for reconciliation work | No |
| `cin7-watermark.sh` | View / set / unset the watermark (the lever) | Set only with `--confirm` |
| `check-status.sh` | Queue depths, alarm states, dashboard URL | No |
| `tail-logs.sh --lambda cin7-poller\|sender\|buffer\|populator` | Stream deployed Lambda logs. `populator` is the **only** place CS5/ERR5 evidence exists | No |
| `emit-cin7-record.sh` | Bus-injection: PutEvents a synthetic record onto the shared bus, bypassing the poller. Flags include `--desc-raw`, `--weight-raw`, `--company CTC\|UNI`, `--no-barcode`, `--blank-category`. Dry-run by default | **Yes** — shared bus only, never Cin7; `--confirm` required |

✅ **`check-status.sh`'s two bugs were FIXED 2026-08-18** — the doubled `cin7-cin7-` alarm lookups now
use the correct single-`cin7-` names, and `${STAGE}-catalog-manhattan-sender-validation-failures` is now
in the checked list. Its alarm summary can be trusted again.
**New script:** `scan-bare-code-whitespace.sh` — GET-only full-account scan for whitespace in Cin7 code
fields. ⚠ **Its printed verdict is unreliable** (it flags any field ending in `code`, so it counts
`productOptionSizeCode`, `supplierCode` and `styleCode` — none of which reach the group id, and it
reported 2,942 "eligible hits" when the real figure is 47). **Read the per-field breakdown, not the
verdict.**

⚠ `emit-cin7-record.sh --missing-option-code` does **not** test the poller-side eligibility skip —
bus injection bypasses the poller. The script's note was corrected 2026-08-10.

UNI/PS scripts (`trigger-*.sh`, `find-*-variant.sh`, `find-parent-product.sh`) are catalog-backed and
**not** part of CTC testing — leave their `us`/`ps` behaviour untouched.

---

## MEASURED FACTS — established, do not re-derive

### The watermark and the query floor

- **There is NO overlap window.** The poller queries from the watermark's **exact value**, inclusive
  (`>=`), with no buffer subtracted. Measured from the literal `where=` clause across **14 cycles**:
  `watermark − since = 0s` every time, never 300s, never varying, and `/Products` and
  `/ProductOptions` **always share the identical floor** within a cycle (37 log lines, zero
  mismatches). **Zero occurrences of a bare `>` in the entire retained history.**
  ⚠ **LLD §3.4's `watermark − 5 minutes` is WRONG.** Kian's published runbook is right. Any unit test
  asserting a 5-minute overlap is asserting behaviour the deployed poller does not have.
- **Duplicates still occur, via the inclusive `>=` boundary.** Directly observed twice: a cycle
  emitted 144 records and advanced to `04:03:08.000Z`; the next started at exactly that value,
  re-emitted **20 records that are an exact subset of the 144**, and left the watermark unmoved. Same
  at `04:18:47.000Z` (8/8). Downstream coalescing absorbs it.
- **Cin7 `modifiedDate` granularity is whole seconds** — every value observed has `.000` ms.
- **Write-visibility lag: minimum +19.7s, zero negative values across 763 samples.** Cin7-vs-local
  clock skew ≈0. So the absent overlap is an **evidence-bound accepted risk, not proven safe.**
  Remaining blind spot: does Cin7 stamp `modifiedDate` at transaction **start or commit**? Not
  observable from the consumer side.
- **Full-pipeline reconciliation is exact.** Poller `recordsEmitted` = bus `MatchedEvents` = populator
  receipts = **31,731**, hour-by-hour across the entire lifetime (175 successful cycles). Zero shortfall.
- **The poller's whole recorded history:** 175 successful cycles, 31,731 records emitted, 38 failed
  cycles (34 blank-credential, 4 `TimeoutError`), log group starts 2026-08-04T21:01:50Z.
- **The Cin7 account is much larger than the CTC subset:** 24,641 products / 137,114 options / 95,506
  poller-eligible. Earlier docs sized CTC at ~3,257 records. **Any full-account scan result needs
  company-scoping before it's treated as CTC-relevant.**
- **Reconciliation found 0 unexplained misses** (763/763). ⚠ That sample covers only 33% of its
  window — 67% had been re-edited within 2.5–4.5 hours. A clean sample, not a full audit.
- **Watermark is a floor, not a window** — rewinding to X re-reads everything from X until now.
- **The poller emits BATCHED, ≤10 records per `PutEvents`** — max observed 10, and 2,678 of 2,821
  batches are exactly 10. ⚠ **LLD §3.3 step 5 (one call per record) is WRONG.**
- **`PutEvents` responses are never checked or logged — but RESOLVED 2026-08-18 as "latent risk, no
  occurrence". Note to dev, NOT a defect ticket. Do NOT run Plan B2.**
  The `Pushed {"Entries":[...]}` line is the outbound request logged **before** the call, never followed
  by a response or a `FailedEntryCount` check (0 occurrences, full history, independently re-verified).
  So the code's handling stays **UNKNOWN** from outside. But the observable *consequence* has never
  occurred: **poller `recordsEmitted` = bus `MatchedEvents` = populator receipts = 31,731, exactly,
  hour-by-hour, across the pipeline's entire lifetime** (175 successful cycles, 2026-08-04 → 08-14).
  Zero shortfall in either reconciliation, in any hour. A partial `PutEvents` failure would show as a
  poller count exceeding the bus count — it never does.
  ⚠ **Plan-limitation worth remembering: `PutEventsFailedEntriesCount` carries ZERO dimensions** — it is
  a regional aggregate across every caller in the account (455-day sum 100,373 against 157M calls, ours
  being ~3,174 calls ≈ 0.002%). **It cannot be scoped to our bus, so it can never answer this question.**
  What *is* bus/rule-scoped: `Invocations`, `MatchedEvents`, `TriggeredRules`, `FailedInvocations` —
  and `FailedInvocations` has **never** fired for either of our rules (while it has for other rules in
  the same account, so its absence is meaningful, not just missing). Relevant to any future 1117
  monitoring design.
  **Recommended note to dev:** check and log `FailedEntryCount` at the call site even when zero, so the
  blind spot stops being permanently unobservable. Defense-in-depth, no evidence of loss.
- **The page cap has never fired** in ~41 days at any observed churn, including a 1,764-record /
  8-page cycle. Its configured value is **UNKNOWN** — not in the environment, never logged. **JJ is
  asking Kian for the number; don't try to force it.**

### Eligibility and mapping

- **Eligibility is `Product.status = Public` AND `ProductOption.status = Primary`.** Everything else
  is `Cin7InactiveSkip`. Live counter-examples for each half: `productStatus=Internal` (21757),
  `optionStatus=Disabled` (6202–6205), and the non-obvious one — **`optionStatus=Active` is NOT
  eligible** (45827). Only `Primary` counts.
- **Triggered parents are refetched chunked at ≤100 ids.** Max chunk observed exactly 100 and
  genuinely hit; **zero 4xx of any kind in the poller's entire history** (so also zero 429s).
- **Records are always built from a full product read.** Proven on a named record: a cycle with
  `productsFetchedPrimary:0` emitted `PA26-102I-XS` carrying `brand`, item class and colour — three
  product-level fields the sparse `/ProductOptions` response does not contain.
- **Source fields follow HLD §5.3, not CTC LLD §5** — `Desc` ← `name` · `Size` ← bare
  `productOptions.size` · `Color` ← `customFields.products_1011` · `ItemClass` ← `CTC-` + first of
  `categoryIdArray` · `UserDef1` ← `brand` (the LLD omitting it is the gap) · `Weight` default `0`
  sentinel (LLD right here). **The LLD is the stale document. Doc corrections, not code bugs.**
- **`DimensionUm=MM` is CORRECT AND SETTLED — never record it as a failure.** Confirmed with dev +
  the design council. SCALE **rejects** `M`, `CM`, `EA`; accepts `MM`, **case-insensitively** (`mm`
  works). `ConvQty` stays `1`. A supplied non-blank value passes through unchanged. **No bug, no
  partial, no failure status anywhere.**
- **`CTC-000` `ItemClass` fallback works**; a populated `categoryIdArray[0]` gives `CTC-<id>`, no
  zero-padding.
- **Element ordering** is alphabetical *except* `InventoryTracking`, which emits after
  `Item`/`ItemClass`. Reproducible, cosmetic.
- **⚠ No CTC product in Cin7 production carries dimension data at all** — 0 of ~3,257 real records
  emitted across 15 cycles, and 1,652 of 1,658 preview candidates were missing exactly
  `dimension_uom, qty_uom, height, length, width, conversion_rate`. **So 100% of CTC items in SCALE
  are `0.1 × 0.1 × 0.1 MM`.** Barcode by contrast is populated on 99.5%, colour on 100%.
  **Scope call (JJ, 2026-08-18): what SCALE does with those dimensions is NOT ours to test** — a
  separate SCALE testing team owns that side. Our scope is that the data arrives correctly. **Record
  it as a handover note for that team** (100% of CTC items are `0.1 × 0.1 × 0.1 MM`) and do not carry
  it as a QA open item.

### Manhattan field limits — all four exact, QA-measured

| Field | Limit | Over-limit behaviour |
|---|---|---|
| `Desc` | **100** | **truncates silently** |
| `Colour` | **25** | **truncates silently** |
| `Size` | **25** | **errors** — `reason:"size_too_long"`, then the uncaught `validateItemDownload` throw |
| `Item` (`item_code`) | **50** | **errors** — `reason:"item_code_too_long"`, same path |

**Not uniform — two truncate, two error.** Never state a single behaviour for all four.
Truncation cuts on **whole characters**, so multi-byte content inside the boundary survives.
**The silence is EXPECTED behaviour, confirmed by JJ 2026-08-18** — not a finding, not a ticket.
⚠ **LLD §5 has no length column at all** — these belong in it.
⚠ Apparent tension to be aware of: the sender-side path **truncates** `Desc` at 100, but a 617-char
value reaching Manhattan's own schema is **rejected** (`stringLength_100`). Which you see depends on
whether the value passed through the truncation step. Worth one line of clarification from dev.

### Failure behaviour

- **The sender has NO per-record containment — five repros of ONE gap.** Missing `item_code`, blank
  `desc`, non-numeric `weight`, over-length `Size`, over-length `item_code` all throw **uncaught**,
  drag the whole batch through bisection, retry exactly 10× over ~30 min, and land in the DLQ with
  bodies byte-for-byte intact. `item_code`/`desc` fail at named checks in `validateItemDownload`;
  `weight` is deeper — `TypeError: value.toFixed is not a function` at `roundToSchemaPrecision`, with
  **no upstream type guard at all**. **Treat as one systemic defect with five repros, not five bugs.**
- **⚠ BISECTION IS THE BUFFER-HANDLER'S, NOT THE SENDER'S — corrected 2026-08-18. Every earlier doc
  attributed this to the sender and that was wrong.**
  `staging-catalog-manhattan-item-buffer-buffer-handler` polls the queue on a strict 3-min schedule and,
  on **any** batch failure, **recursively bisects** to isolate the offender. Measured tree from a
  21-record batch: **21 → 10+11 → 5+5 → 2+3 → 1+1**, landing exactly on the single poison. It logs
  `"Poison pill identified"`, plus `"Sent 21 messages to processor."` / `"Deleted 20 messages from the
  queue."` — those lines are the fastest way to read what happened.
- **It is content-agnostic and it protects valid records — MEASURED AT SCALE 2026-08-18 (Plan D Run 1).**
  1 over-length-`Size` poison + **20 valid controls** in one flush: **all 20 delivered**
  (`accepted=3`, `accepted=5`, `accepted=1`, `accepted=11`, `rejected=0` throughout) **within ~35
  seconds** of the last send, and **only the poison** was isolated to retry alone. **So an uncaught
  validation throw does NOT cost co-batched valid records — it costs seconds.** This closes the
  Mode-A-versus-Mode-B question that Plan D existed to answer.
- Manhattan returns **counts only** (`accepted:1, rejected:1`) and never says *which* item failed, which
  is why isolation needs the bisection rather than a read of the response. Earlier single-control
  measurements: ~22s and ~13s.
- **The sender's lack of containment is confirmed at code level (stack trace, 2026-08-18).**
  `validateItemDownload` at `index.js:14863`, called from `Array.map` at `14902`, propagating out of
  `Runtime.handler` at `14887` — **no per-item try/catch.** It died in **113ms** on the first array
  element. So "the sender has no per-record containment" is literally true; the consequence is absorbed
  one layer up by the handler's `processWithBisect`. **Say both halves when describing this to dev.**
- **Poison position affects how fast the sender dies, not the outcome.** Sent first → died on element 0
  in 113ms, validating nothing after it. Bisection isolates it regardless.
- **`network_error`/`TimeoutError` IS organically triggerable and is transient, not lossy.** Under
  backlog the sender coalesces 500+ item batches that exceed Manhattan's ~25–30s timeout. On
  2026-08-14, 4 of 18 invocations hit it — and because the DLQ never grew and the buffer drained to
  0/0, **every one was necessarily retried successfully.**
- **⚠ WHITESPACE IN `item_code` DESTROYS THE RECORD — no queue, no sender, no DLQ, no trace.**
  `message_group_id` inherits raw whitespace; SQS FIFO rejects it (`InvalidParameterValue: …
  MessageGroupId can only include alphanumeric and punctuation characters`) and the throw happens in
  the **buffer-populator, upstream of the SQS queue**, which has no DLQ and no retry policy.
  **Strictly worse than the sender crash, which at least preserves the record.**
  All five shapes reproduce it by injection: interior space, leading, trailing, tab, whitespace-only.
  A **true blank** is a different path (populator passes `CTC#`, sender crashes, DLQ preserves it).
  **CONFIRMED STILL UNFIXED 2026-08-14** — the populator has never been redeployed. Fresh probe
  reproduced it, and the metric picture is now proven: **`Invocations: 407`, `Errors: 0`**, because
  the exception is **caught and logged at INFO** and the invocation completes normally.
  **Two consequences: a `DeadLetterConfig` alone would NEVER fire, and an alarm on populator `Errors`
  would see nothing.** An interior space also survives any leading/trailing trim. **A working fix
  needs a code change** — sanitise the whole value **and** re-throw or emit an explicit metric.
  ⚠ **RESOLVED 2026-08-18 — HARNESS ARTEFACT, NOT A LIVE DEFECT. DO NOT RAISE THE TICKET.**
  Two independent passes settled this, and the residual is closed rather than merely unexercised.
  **(a) SCALE end:** all six of product 29942's options exist in SCALE staging **with the interior
  double space intact** (`WTW23-922G  -XS/-S/-M/-L/-XL/-XXL`, copied verbatim from the dashboard), so
  the records travelled the real poller path end to end.
  **(b) Cin7 end, full-account scan (24,641 products / 137,114 options / 95,506 poller-eligible, ~99
  GETs):** only **71 option rows carry whitespace in the bare `productOptionCode`** — 47
  poller-eligible, across **13 products, all interior whitespace**. Not a large exposure.
  **⚠ THE MECHANISM — an earlier version of this file had it WRONG. Do not reason from the old one.**
  ~~"the group id is assembled from separate clean fields, `{company}#{productOptionCode}_{size}`"~~ is
  **falsified**: 29942's option data reads `productOptionCode='WTW23-922G'`, `code='WTW23-922G  -S'`,
  **`size='S'`** — not `'-S'` — so that construction would produce `CTC#WTW23-922G_S`, which is **not**
  what the logs show.
  **The correct mechanism: the poller COLLAPSES each whitespace run in `item_code` to a single
  underscore** — `{company}#re.sub(r"\s+","_",code)`. That reproduces the observed
  `CTC#WTW23-922G_-S` character-for-character, and explains why **two spaces became ONE underscore**.
  **MEASURED** for the field values, **INFERRED** for the transform (no code read).
  **Why the correction matters: it inverts the residual.** Under the wrong theory, whitespace in the
  bare `productOptionCode` was the one shape that could still reach the populator's raw-concat path.
  Under the correct one, **the poller sanitises whitespace wherever it appears in `item_code`**, so
  those 13 products are sanitised exactly as 29942 was. **There is no reachable path.**
  **Residual, low severity, keep on record:** the populator still has no containment for a raw-whitespace
  group id and swallows the exception at INFO. Nothing currently reaches it. Any **future** producer that
  raw-concats without the poller's sanitiser would lose records silently.
  **Free upgrade available (optional):** search retained poller logs for any of the 13 codes and read the
  literal `message_group_id`. One hit showing a collapsed underscore turns the transform from INFERRED to
  MEASURED. Cheaper still: one question to Kian.
  ⚠ **For the SCALE team's handover:** SCALE accepted an item code containing a double space. Fine
  functionally, but **if that code is ever trimmed, it creates a second item rather than updating the
  first.**
  ⚠ **Unrelated finding from the same scan, worth someone knowing:** products **30706** and **30707**
  (`NUSMU23-101A - MTEST` / `- WTEST`) look like **test products sitting in Cin7 PRODUCTION, Public and
  Primary — i.e. poller-eligible and shipping to SCALE.** Not a QA finding for this epic; flag it.

- **Forcing a poller-side failure from outside is NOT achievable — five levers assessed, none
  available.** Warm-container reuse defeated secret corruption for 80+ min; a Lambda config update
  did **not** force a cold start; concurrency-0 and malformed-SSM writes were blocked by the
  permission classifier; and there is **no `MAX_PAGES_PER_RUN` and no Cin7 base-URL env var** to
  point at a black hole. **Stop attempting this.**
  **But the AC branch is organically evidenced:** on 2026-08-13 a real uninjected `TimeoutError`
  fired mid-cycle at watermark `03:57:48.000Z`; the same RequestId retried and **the watermark was
  still `03:57:48.000Z`, unchanged**, then advanced normally on success. Historically
  `Cin7PollerCycleFailed` has fired 38× (34 blank-credential, 4 `TimeoutError`).
  **Kian has separately confirmed the dev-side integration tests and JJ is clear to sign AC1 off** —
  confirmation is in Teams, to be pasted into the docs at the Phase 4 stage.
  ⚠ **AC1 now additionally has live QA evidence, not just dev-side confirmation — 2026-08-19.** The
  one organic blank-credential episode (2026-08-05) predates `watermark-stale`'s own creation
  (2026-08-10) by 5 days, so it could never evidence this AC (see `BUSY-1117-ALARM-HISTORY-RESULTS.md`).
  A deliberately-forced blank-secret + immediate-cold-start test closed that gap: `watermark-stale`
  transitioned `OK`→`ALARM` at `2026-08-19T08:14:49.319Z` on a genuine 8/8-breaching-period
  condition. **AC1: PASS (MEASURED)**, flagged — actual time-to-alarm from the last good cycle was
  **2h30m56s**, ~31 min (~26%) over the "~2 hours" AC language (traced to a CloudWatch period-bucket
  alignment offset, not a design gap). Full detail: `BUSY-1117-AC1-RERUN-RESULTS.md`.
- **`cin7-watermark-stale` fires from ordinary idle, not just a real outage.** While `UNSET` the
  poller no-ops logging only `Cin7ItemPollerInactive`, never `Cin7PollerCycleComplete` — the only
  metric the alarm watches. So it trips after ~2h of *any* idle gap. **Check whether the watermark
  has simply been idle before treating it as signal.**
- **AC5 ("empty cycles raise nothing") is UNKNOWN, not evidenced either way — 2026-08-19.** Searched
  7 days of retained poller logs for a `Cin7PollerCycleComplete` with `recordsEmitted:0`: zero
  occurrences, out of only 80 real completions (the other 3,178 poller invocations in the same window
  were `Cin7ItemPollerInactive` no-ops while `UNSET`). Every real cycle ran during a
  deliberately-scoped QA window chosen because it contained known changes, so a genuinely
  active-but-empty cycle has never been observed. **Whether the watermark advances on a zero-record
  active cycle is unknown** — if it does not, `watermark-stale` will false-positive through a
  genuinely quiet production period (which the ticket itself says off-peak CTC months are) in a way
  indistinguishable from a real outage. Resolve by reading the poller source, not by waiting for a
  naturally-quiet window. See `BUSY-1117-AC1-RERUN-RESULTS.md`.

### SCALE-side behaviour

- **An item lookup screen DOES exist in SCALE staging** (JJ confirmed 2026-08-18). Two earlier
  sessions failed to find it and `DIF Incoming Message Insight` returns 0 rows with all filters
  cleared — **capture the navigation path when you have it**; that dead end is recorded as a blocker
  across three QA docs.
- **The coalesce key is `(company, item_code)`, confirmed at the SCALE end.** `item_code 3141592`
  injected as CTC and UNI 8 seconds apart inside one buffer window exists as **two distinct items**.
  No cross-company collision.
- **Create → update upserts cleanly.** `QA-UP1-TEST` sent `Red`/`Small` then `Blue`/`Large` in
  separate buffer windows shows **one item reading Blue/Large**. No duplicate.
- **Rewind idempotency confirmed at field level (2026-08-18).** `WPDTC26-302F-*` exists as **8 unique
  sizes (4,6,8,10,12,14,16,18), no duplicates** — after a 500+ item coalesced batch that hit a
  `TimeoutError` and was retried. **That was the case most likely to duplicate, and it didn't.**
  Closes 1116 TC6 / ID3 / UP3 at field level.
- **Real-data field mapping confirmed at the SCALE end** for `PA26-102I-XS`/`-XXL` — every mapped
  field matches the sender XML.
- **⚠ SCALE does NOT clear a field on an empty tag — `SAVE` is additive. Measured 2026-08-18.**
  `QA-UP2-TEST` was sent `colour=Green`, then re-sent with `colour=""`; the outgoing XML carried an
  explicit present-but-empty `<Color></Color>`, and **SCALE still reads `Green`.**
  **Consequence: a field cleared in Cin7 never clears in SCALE, and no re-sync will fix it.** This
  confirms the runbook's `SAVE`-doesn't-clear caveat, which had never been measured. **It scopes the
  re-sync idempotency argument: convergence holds for values that are PRESENT, not for deletions.**
  Belongs in the runbook and the E2E handover, not just a QA doc.
- **SCALE applies no barcode validation and does not de-duplicate** — a non-numeric barcode and
  duplicate barcodes were both accepted. Garbage in Cin7 propagates silently.
- **Empty `<XRefs/>` (no barcode) is accepted, not skipped — confirmed at the SCALE end 2026-08-18.** `QA-TEST-NOBARCODE-1` exists in SCALE with no barcode. Closes 1115 TC8 / AC6 at both ends.
- **`CTC-000` `ItemClass` fallback confirmed at the SCALE end 2026-08-18** — `QA-TEST-BLANKCAT-1` reads `CTC-000`. Closes 1115 TC2 at both ends.
- **Manhattan always returns HTTP 200** — judge from the sender log / `rejectedTransactions`, never
  HTTP status.
- **Coalesce window ~3 min.** Measured ratio under real duplicate volume: **6,021 received → 5,604
  coalesced = 417 collapsed (6.9%)**, one batch collapsing **158 of 538 (29%)**.

### Metrics and alarms

- **`Company`-dimension gap (BUSY-1113) — CONFIRMED three times.** Every sender metric carries
  `Dimensions: []` (`ItemsSent`, `SenderValidationFailures`, `ManhattanDefaultedField`,
  `BatchCoalesced`, `RequestOutcome-success`). `Company=CTC` exists **only in log text**. Per-store
  breakup exists as separate metric *names* (`ValidationFailures-us`/`-ps`) but there is **no `-ctc`
  variant**. 1115 AC3 holds at **log level only** — accepted on that basis on both tickets.
- **⚠ WITHDRAWN — "No alarm watches CTC validation failures." This earlier finding was WRONG.**
  `staging-catalog-manhattan-sender-validation-failures` **exists**, watches the correct metric in
  the correct namespace, threshold **>10 in 900s**, targets the shared alerts topic, and was
  configured `2026-08-10T04:51:19Z` — before the investigation that "found" it missing. It even
  recorded a **real near-miss datapoint of 9 against a threshold of 10** at `2026-08-13T04:43:00Z`.
  It was missed only because `check-status.sh` never checks that name.
  **The real gap was narrower: the alerts topic had ZERO SNS subscriptions, so even a genuine fire
  notified nobody.** That is notification plumbing, not a missing alarm — **do not conflate the two
  in the BUSY-1117 writeup.** ⚠ **Updated 2026-08-19: no longer zero** — see the corrected resource-
  table row above and `BUSY-1117-AC4-WIRING.md`. One confirmed email subscription now exists; the
  SSM param this alarm's intended-recipients design assumed (`/catalog/manhattan-observability/
  alert-emails/staging`) still does not exist anywhere in the account.
- ⚠ There is also a `staging-catalog-cin7-validation-failures` alarm on the **poller's** log group
  (metric filter on `ManhattanValidationFailure`). **It is a poller-side signal and does NOT watch
  sender/CTC item validation failures** — don't mistake it for the one above.

### SSM / Secrets caching

**⚠ Lag is VARIABLE IN BOTH DIRECTIONS and must never be assumed.** Documented behaviour is ~2
cycles. Observed extremes:

- **2026-08-13:** an `--unset --confirm` reported success but the poller ran **11 more active cycles
  over ~33 minutes**, confirmed by direct SSM reads showing it still advancing the value in real
  time — **~1,108 records and 30+ Cin7 calls beyond the intended idle window.**
- **2026-08-14:** a `--set` landed on the **very next cycle** (~1m39s).

**Always confirm with a direct `get-parameter`. Never re-write impatiently** — a second write is how
a rewind's cost gets doubled. A *blank* secret is the exception: it fails local validation on every
read regardless of caching.

---

## Environment state — last measured 2026-08-14

- **Watermark `UNSET`**, version 188. **Buffer queue 0/0.**
  ⚠ **Superseded 2026-08-19: watermark is `UNSET` again, version 249**, following the BUSY-1117 AC1
  forced-break re-run and recovery (see the 2026-08-19 update at the top of this file). Versions
  188→249 reflect the intervening week of active QA sessions (Plans A–D, forced-break attempts),
  not drift — always confirm the current value with a direct `get-parameter` read rather than
  trusting this line, per the standing SSM-caching caveat below.
- **⚠ Buffer DLQ measured at ZERO on 2026-08-18 06:27Z — the 19 QA-evidence messages have AGED OUT.**
  **DLQ message retention is 4 days**, and that inventory dated from 08-10 → 08-14, so it expired
  naturally rather than being purged. **Consequence: the "don't purge without checking the inventory"
  warning carried across three docs is now moot** — the inventory in `BUSY-1116-PHASE1-RESULTS.md` §4 is
  a historical record, not a live queue state. Current depth: **1** (`QA-D-T1-POISON-20260818T062710Z`,
  landed 06:57:42Z after exactly 10 retries).
  **DLQ depth is a moving number and it decays on its own — always MEASURE it, never assume.**
- **`send-dlq-depth` reads red because of those messages and is NOT a real signal** — its threshold
  is `depth > 0`, so one message saturates it.
- **Log retention is never-expire** on poller / populator / sender. This is what made the whole
  overlap forensic pass free, and it makes Plans A1 and B1 free too. **Reach for retained logs before
  spending any Cin7 budget.**

---

## Gaps to build (JJ automates repetitive QA)

- **`cin7-testset.sh`** — the sanctioned Cin7 write path, if write-based testing goes ahead.
  Hard-coded allowlist of four product ids, refuse anything else, **no override flag**; dry-run by
  default; read-modify-write enforced internally; `snapshot`/`restore`/`diff` against `fixtures/`; and
  an append-only `fixtures/write-log.jsonl` recording send/response timestamps, field, before, after
  and returned `modifiedDate`. **Build the logging in from the first write or the latency measurements
  are lost.** Also `cin7-codes-register.md` — every code ever minted on the burner product, since
  orphan SCALE items are permanent.
- **Programmatic SCALE state lookup** — still the top automation candidate. Field-by-field passes mean
  eyeballing ~13 fields per item repeatedly, and four test cases were blocked for a week purely
  because nobody could find the UI screen. A scripted read + expected-value diff would turn the whole
  checklist into one command and make it a re-runnable regression guard.
- **`check-status.sh` fixes** — the two naming/coverage bugs above. One line each.
- **`preview-cin7-sync.sh --until`** — a client-side upper bound, needed for any reconciliation work.
- **Pre-session Cin7 call-count check** against the 5,000/day cap.
- **A run-log / evidence capture helper** — capturing the relevant poller/sender log lines for a given
  `item_code` and time window. Write-up is now the main non-testing overhead.

---

## Working style

Be concise. Default to read-only / dry-run; surface the exact command and its blast radius before any
`--confirm` or secret change. Always pass `--stage` and `--profile`.

**Tag every claim MEASURED / INFERRED / UNKNOWN** and quote literal log lines rather than
paraphrasing — the results files follow this convention and it is what makes them trustworthy months
later. **Prefer retained CloudWatch logs over new Cin7 calls.** When a test needs a controlled input,
reach for the watermark (real data) or bus-injection (synthetic) before considering a Cin7 write.

**Do not edit Confluence or Jira — JJ pushes those.**
