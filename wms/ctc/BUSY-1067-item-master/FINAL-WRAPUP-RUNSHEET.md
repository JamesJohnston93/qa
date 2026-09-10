# CTC item master — FINAL WRAP-UP RUNSHEET (rev 2)

> ## ✅ THIS IS THE FILE TO WORK FROM.
> **Rev 2 · 2026-08-18 · re-verified live against Jira, Confluence, the LLD, and the tooling folder.**
> Everything below is in the order to do it. **§2 is the AWS/IDE session — do that first**, because it
> is the only remaining *testing* and two of its results change wording on a live Confluence page.
>
> **Supersedes for planning purposes:** `REMAINING-WORK-PLAN.md`, `CTC-QA-STATE-INDEX.md` §4, and
> `CTC-HANDOVER-ACTION-LIST.md` §A–§F (that file is still the place to copy **paste-ready message text**
> from — Appendices 1–5). See §8 for which docs are current and which are historical.

---

## 0. Verified state — do not re-check these

| Check | Result (verified 2026-08-18) |
|---|---|
| Jira | 1113 **Done** · 1114 **Done** · 1115 **Done** · **1116 Review** · **1117 Review** — all last touched 14 Aug |
| QA testing | **COMPLETE.** Phases 0–3 (13/14 Aug) + Plans A, B, C, **D Runs 1 & 2** (18 Aug). **QA raises no Jira ticket and is raising none** |
| QA DOC - BUSY-1116 (1859354632) | **current** (v10, updated 18 Aug 22:30) — includes Plan D. **Do NOT re-apply `DRAFT-QA-DOC-BUSY-1116.md`** |
| QA DOC - BUSY-1117 (1894088713) | **current** (v2, created 18 Aug 22:26) — AC map present, AC4 = FAIL |
| E2E handover (1894973441) | **exists**, v1, linked from the 1117 doc |
| QA Doc 1114 / 1115 (1859387394 / 1859354640) | current, condensed |
| LLD (1765736449) | **unchanged since 4 Aug.** §3.4 still claims a 5-min overlap · §3.3 step 5 still says per-record emit · §3.2 still says 2-min cadence · §9 still says "60 consecutive cycles" · §5 still says `DimensionUm=M` · §12 OQ-4 still open · **no runbook link in §3.4 or §8, and §13 still lists it as scope** → **1116 AC4 is still blocked** |
| `check-status.sh` | both fixes **present in the script** (single `cin7-` prefix; sender-validation alarm added at line 96). **Not yet verified against live AWS** → §2 V4 |
| SCALE item-lookup path | **still not captured** (`CLAUDE.md` line 487) |
| Blockers | **One remaining, and it isn't QA work:** the LLD runbook link (1116 AC4). The 1117 AC4 SNS item has moved — see below. |

> ⚠ **Updated 2026-08-19, after this table was last verified.** The AWS verification session (§2)
> has now run — both the read-only V1–V6 pass (`BUSY-1117-ALARM-HISTORY-RESULTS.md`,
> `BUSY-1117-AC4-WIRING.md`) and, separately, a deliberately-forced live AC1 test
> (`BUSY-1117-AC1-RERUN-RESULTS.md`). **1117 AC1: now PASS (MEASURED), flagged** — live alarm fire
> confirmed, but ~31 min (~26%) over the "~2 hours" AC wording; JJ to judge. **1117 AC2: now PASS in
> full** — the forced-break session's `poller-errors` alarm supplied the missing 3-consecutive-error
> evidence (AL1+AL3), joining the already-closed AL2. **1117 AC5** ("empty cycles raise nothing"):
> **UNKNOWN** — no naturally-occurring empty active cycle exists in 7 days of retained logs to check
> against. **1117 AC4 blocker re-shaped, not closed:** the alerts topic is no longer at zero
> subscriptions (one confirmed manual email subscription now exists), but the SSM parameter
> `/catalog/manhattan-observability/alert-emails/staging` that OQ-4 was chasing **does not exist
> anywhere in the account** — there is no config to wire it to. See `BUSY-1117-AC4-WIRING.md` for the
> full trace; §3.2 below needs re-wording before it's sent. **Watermark returned to `UNSET`** at the
> end of this work (was left running self-sustaining after the forced-break test).

**What is actually left:** the LLD runbook link chase, the AC/LLD wording changes (now including the
new AC1/AC2/AC5 rows above), the remaining sends, and housekeeping. Nothing requires a new test to
be designed — the AWS verification session that was the one open testing item has now run.

---

## 1. Order of play

| # | Do | Where | Why this order |
|---|---|---|---|
| **1** | **Fire the two blocker chases + the Kian batch + the findings pack** | §3 | They're other people's actions — get them in flight before you sit down to anything else. 10 min |
| **2** | ✅ **DONE 2026-08-19 — the AWS verification session** | **§2** | Closed 1117 **AC1** (PASS, flagged — see §0), **AC2** (now PASS in full), and **AC3** (PASS, four series wired). **AC5 surfaced as UNKNOWN** along the way (not one of this row's original targets, but free evidence from the same session). |
| **3** | **Apply the AC/LLD wording changes** | §4 | Several depend on §2's verdicts, so don't start them first |
| **4** | **Send the merchandising + SCALE-team handovers** | §5 | S1 needs an owner; that's the point of sending it |
| **5** | **Housekeeping** | §6 | Only if time remains |

---

## 2. STEP 1 — the AWS / IDE session (read-only, ~35–40 min)

**Everything in this section is read-only.** No injection, no Cin7 calls, no watermark writes, no
config changes, no Confluence/Jira edits.

### 2.1 Connection details

| | |
|---|---|
| Region | `ap-southeast-2` |
| Profile | `staging` (all scripts take `--stage staging --profile staging`) |
| Log retention | **never-expire** on poller / populator / sender — every window below is still queryable |

### 2.2 Lambdas and log groups — the exact names

| Role | Lambda | Log group |
|---|---|---|
| **Cin7 poller** (all `Cin7*` metrics; 3-min cadence) | `staging-catalog-cin7-cin7-item-poller` | `/aws/lambda/staging-catalog-cin7-cin7-item-poller` |
| **Buffer populator** (the ONLY place CS5/ERR5 `MessageGroupId` evidence exists) | `staging-catalog-manhattan-item-buffer-buffer-populator` | `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-populator` |
| **Buffer handler** (`processWithBisect`, "Poison pill identified") | `staging-catalog-manhattan-item-buffer-buffer-handler` | `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-handler` |
| **Item sender** (`ManhattanBatch`, `accepted=/rejected=`, outgoing XML) | `staging-catalog-manhattan-item-sender` | `/aws/lambda/staging-catalog-manhattan-item-sender` |

`./tail-logs.sh --stage staging --profile staging --lambda cin7-poller|populator|buffer|sender --since <dur>`
wraps these.

### 2.3 Alarms, metrics and other resources

| Thing | Exact name |
|---|---|
| Watermark-staleness alarm (watches `Cin7PollerCycleComplete` **only**) | `staging-catalog-cin7-watermark-stale` |
| Poller-error alarm (3 consecutive cycles) | `staging-catalog-cin7-poller-errors` |
| Sender validation-failure alarm (`>10 in 900s`, configured 2026-08-10T04:51:19Z) | `staging-catalog-manhattan-sender-validation-failures` |
| Send-DLQ depth alarm (`depth > 0`, 1×300s — saturated) | `staging-catalog-manhattan-send-dlq-depth` |
| ⚠ **Not** the sender alarm — poller-side metric filter, don't confuse them | `staging-catalog-cin7-validation-failures` |
| Metric namespace (sender) | `staging-catalog-manhattan` — `SenderValidationFailures`, `ItemsSent`, `BatchCoalesced`, `ManhattanDefaultedField` (**all `Dimensions: []`**) |
| Dashboard | `staging-catalog-manhattan-observability-dashboard` |
| Alerts SNS topic (**zero subscriptions**) | `staging-catalog-manhattan-observability-alerts` |
| Intended recipients SSM param | `/catalog/manhattan-observability/alert-emails/staging` |
| Watermark SSM param | `/catalog/cin7-manhattan/item-watermark/staging` (currently `UNSET`, v188) |
| Buffer queue / DLQ | `staging-catalog-manhattan-item-buffer-buffer.fifo` / `staging-catalog-manhattan-item-buffer-dlq.fifo` |
| Poller's own bus → forwarding rule → shared bus | `staging-catalog-cin7-events` → `staging-catalog-manhattan-cin7-forwarding-rule` → `staging-catalog-manhattan-events` |

### 2.4 The verification map — what to look at, where, and over what window

All times **UTC** (Brisbane = UTC+10; add 10 h).

---

**V1 — 1117 AC1 + the "3 consecutive errors" half of AC2 (AL1 + AL3). ~10 min. Highest value in the list.**

*Step 1 — find the exact window of the real blank-credential episode.*
Log group `/aws/lambda/staging-catalog-cin7-cin7-item-poller`, **2026-08-05 00:00Z → 2026-08-06 00:00Z**
(Brisbane 5 Aug 10:00 → 6 Aug 10:00). Filter for `Cin7 secret is missing required fields`.
Expect **34 `Cin7PollerCycleFailed` events**, ≈1 h 42 m of continuous failure at 3-min cadence.
Record the **first and last timestamps** — that's your alarm window.

```
aws logs filter-log-events --profile staging --region ap-southeast-2 \
  --log-group-name /aws/lambda/staging-catalog-cin7-cin7-item-poller \
  --start-time $(date -u -d '2026-08-05T00:00:00Z' +%s)000 \
  --end-time   $(date -u -d '2026-08-06T00:00:00Z' +%s)000 \
  --filter-pattern '"Cin7 secret is missing required fields"' \
  --query 'events[].[timestamp,message]' --output text
```

*Console equivalent:* CloudWatch → Log groups → `/aws/lambda/staging-catalog-cin7-cin7-item-poller` →
**Search all log streams** → custom time range 2026-08-05 00:00 → 2026-08-06 00:00 UTC → search
`Cin7 secret is missing required fields`.

*Step 2 — did either alarm transition?*

```
aws cloudwatch describe-alarm-history --profile staging --region ap-southeast-2 \
  --alarm-name staging-catalog-cin7-watermark-stale \
  --history-item-type StateUpdate \
  --start-date 2026-08-04T21:00:00Z --end-date 2026-08-06T12:00:00Z --output json
```
Repeat for `staging-catalog-cin7-poller-errors`.

**How to read it:**
- `poller-errors` → ALARM inside the window = **AC2's "3 consecutive errors do alarm" half CLOSES.**
  (`SESSION-FINDINGS-2026-08-05.md` says it "tripped transiently, then self-cleared" — this pull is what
  turns that sentence into evidence.)
- `watermark-stale` → ALARM ≥2 h after the first failure = **AC1 CLOSES retrospectively.**
- ⚠ **A non-transition is still a result, not a null.** `watermark-stale` watches `Cin7PollerCycleComplete`,
  which a *failing* cycle never emits — so `INSUFFICIENT_DATA` is the expected shape of AL6's idle
  false-positive seen from the other side. **Record which one you saw and say so plainly.**
- ⚠ Do **not** try to force this by corrupting a valid secret. Warm containers defeated that for 80+ min
  on 6 Aug. A **blank** secret is the only reliable break — and you don't need to break anything here.

---

**V2 — the other half of AC2: a single failure must stay quiet (AL2). ~5 min.**

Four organic isolated `TimeoutError` cycles exist. **One is pinned exactly:**

```
2026-08-13T04:01:50.610Z  cycle starts, watermark = 2026-08-13T03:57:48.000Z
2026-08-13T04:02:15.612Z  ERROR {"metric":"Cin7PollerCycleFailed","message":"The operation was aborted due to timeout"}
2026-08-13T04:02:15.640Z  ERROR Invoke Error {"errorType":"TimeoutError"}
2026-08-13T04:03:16.981Z  same RequestId retries, watermark unchanged
2026-08-13T04:03:20.750Z  Cin7PollerCycleComplete, newWatermark 2026-08-13T04:03:08.000Z
```

- Poller log group, **2026-08-13 03:50Z → 04:15Z** — confirm the sequence above.
- The other three are on **2026-08-06**: same log group, **2026-08-06 00:00Z → 2026-08-06 23:59Z**, filter
  `TimeoutError`. Record their timestamps (they've never been written down).
- Then `describe-alarm-history` on **both** alarms for **2026-08-06 00:00Z → 2026-08-06 23:59Z** and
  **2026-08-13 03:00Z → 05:00Z**. **Expected: no StateUpdate at all.** That upgrades AL2 from
  "observationally PASS" to evidenced.

---

**V3 — 1117 AC3, currently NOT RUN (AL5). ~15 min.**

```
aws cloudwatch get-dashboard --profile staging --region ap-southeast-2 \
  --dashboard-name staging-catalog-manhattan-observability-dashboard
```
(`check-status.sh` also prints the console URL. Console: CloudWatch → Dashboards.)

Check which of AC3's **four series** are actually wired: **products/options fetched per cycle · records
emitted per cycle · watermark age · 429 count.**

⚠ Judge **"is the metric wired up"**, not "does it show data":
- **The 429 count will be permanently zero** — no 429, and no 4xx of any kind, has ever occurred.
- **Per-company breakdown is log-level only** — every sender metric carries `Dimensions: []` (BUSY-1113 gap).
- `recordsEmitted` *is* available per cycle from `Cin7PollerCycleComplete`, so that series is sourceable.
- If a series is absent from the dashboard JSON, **say so explicitly** — that's the AC3 finding.

---

**V4 — AL7 from FIXED to FIXED-and-verified, plus live environment state. ~5 min.**

```
./check-status.sh --stage staging --profile staging
```
Confirm **none** of these report `NOT FOUND`: `staging-catalog-cin7-poller-errors`,
`staging-catalog-cin7-watermark-stale`, `staging-catalog-manhattan-sender-validation-failures`.

Then, in the same session:
```
aws ssm get-parameter --profile staging --region ap-southeast-2 \
  --name /catalog/cin7-manhattan/item-watermark/staging
```
- ⚠ **Confirm `UNSET` from this direct read, never from a script's success message** — on 13 Aug an
  `--unset --confirm` reported success and the poller ran **11 more active cycles over ~33 min**.
- **Measure DLQ depth, never quote it.** Retention is 4 days; the old 19-message inventory aged out and
  the queue measured zero at 2026-08-18 06:27Z. Plan D's poison
  (`QA-D-T1-POISON-20260818T062710Z`, landed 06:57:42Z) **expires around 22 Aug** — if you want it as
  evidence, capture it now.

---

**V5 — optional, free (~15 min): upgrade the whitespace transform from INFERRED to MEASURED.**

Only worth doing if you'd rather not spend question **K6** on Kian. Poller log group, **full retention
(search from 2026-07-01 to now)**. Search for these 13 codes and, for any hit, quote the literal
`item_code` and `message_group_id` **side by side** — one hit showing a collapsed-underscore group id
proves `{company}#re.sub(r"\s+","_",code)`:

`Knife FightEAR` · `NUSMU23-101A - MTEST` · `NUSMU23-101A - WTEST` · `ONE WAYTCGML` · `ONE WAYTCSML` ·
`WOR121 - 701I` · `WOR121 - 702B` · `WOR121 - 703H` · `WORSMU22- 107B` · `WORSMU22- 201F` ·
`WSMU22- 167BM` · `WSMU22- 171A` · `WSMU22- 174F`

⚠ Search on the distinctive fragment (`171A`, `167BM`, `MTEST`, `WOR121`, `Knife`), because the emitted
`item_code` is the **size-suffixed** code, not the bare `productOptionCode`.
⚠ These are older low-churn products — **absence is NOT evidence either way. Say so rather than
concluding.** Do not spend Cin7 budget forcing one into a window.

---

**V6 — optional, 2 min: nail down the withdrawn ERR4 finding for good.**

```
aws cloudwatch get-metric-statistics --profile staging --region ap-southeast-2 \
  --namespace staging-catalog-manhattan --metric-name SenderValidationFailures \
  --start-time 2026-08-13T04:00:00Z --end-time 2026-08-13T05:30:00Z \
  --period 900 --statistics Sum
```
Expect the recorded **near-miss of 9 against a threshold of 10 at 2026-08-13T04:43:00Z**. Confirms the
alarm is live and correctly wired, which is the evidence behind AL8's withdrawal.

---

### 2.5 Paste-ready IDE kick-off — this is the whole session

**Check first:** AWS SSO is logged in for the `staging` profile (`aws sts get-caller-identity --profile
staging`). Then paste this and nothing else.

```
Read CLAUDE.md in ~/Desktop/testing-tools, then FINAL-WRAPUP-RUNSHEET.md — section 2 only.

Execute section 2's verification map: V1, V2, V3, V4, then V5 and V6 if there's time. Section 2 carries
every log group, alarm name, metric namespace, command and time window you need — use those exact names
and windows, do not go looking for your own.

READ-ONLY SESSION. Do not inject records, do not call Cin7 at all, do not touch the watermark, the
secret, any config or any alarm. Do NOT edit Confluence or Jira — JJ pushes those. Do NOT start on
sections 3, 4, 5 or 6 of the runsheet; they are not yours.

Ground rules from section 7 that matter for interpretation:
- A non-transition in V1 is a RESULT, not a null. cin7-watermark-stale watches Cin7PollerCycleComplete,
  which a failing cycle never emits, so INSUFFICIENT_DATA is the expected shape and is itself the
  finding. Report what you actually saw either way.
- V5's absence of log hits proves nothing in either direction. Say so plainly rather than concluding.
- Tag every claim MEASURED / INFERRED / UNKNOWN and quote log and alarm-history lines verbatim.

Write BUSY-1117-ALARM-HISTORY-RESULTS.md in the same folder, with:
1. a verdict per AC — 1117 AC1, AC2, AC3 — and per test case AL1, AL2, AL3, AL5, AL7
2. the exact replacement wording for those rows in the QA DOC - BUSY-1117 AC table (page 1894088713),
   for me to paste
3. the live figures you measured: watermark value, buffer queue depth, DLQ depth
4. anything you could not substantiate — flag it, don't fill it

Then tell me in one short list what changed versus the runsheet's section 0, so I can update it.
```

**Then come back here** — §2.6 is what to update with the results.

### 2.6 After the session

Update in this order: **`BUSY-1117-ALARM-HISTORY-RESULTS.md`** (new) → **QA DOC - BUSY-1117** AL1/AL2/
AL3/AL5/AL7 rows and the AC table (page 1894088713) → **`CTC-QA-STATE-INDEX.md`** §4 → **this file** §0.

---

## 3. STEP 2 — send these first (10 min, before §2 if you can)

- [ ] **3.1 — Chase the LLD runbook link (1116 AC4).** Owner **Lachlan / Kian.** Runbook page `1845100600`,
      published 3 Aug; LLD §3.4/§8 don't link it, §13 still lists it as scope. AC1–AC3 all PASS — **one
      hyperlink is holding 1116 in Review.** Fallback: descope AC4 to "runbook published", link tracked
      separately.
- [ ] **3.2 — Chase OQ-4, the alert distribution address (1117 AC4) — re-worded 2026-08-19.**
      `staging-catalog-manhattan-observability-alerts` is **no longer at zero subscriptions**: one
      confirmed manual email subscription now exists (added via an interactive SSO session, not
      traceable to any automation — `BUSY-1117-AC4-WIRING.md`). **But the SSM parameter OQ-4 was
      actually chasing — `/catalog/manhattan-observability/alert-emails/staging` — does not exist
      anywhere in the account**, confirmed by direct lookup and two account-wide sweeps. There is no
      dead config to wire up; the design this parameter implies (recipients sourced from SSM) was
      apparently never built. **Re-scope the chase:** either (a) decide the one manual subscription is
      the permanent intended state and document it as such, or (b) chase whoever owns OQ-4 to confirm
      whether the SSM-parameter design is still wanted at all. **Demonstrated, not theorised (still
      true — this predates the new subscription):** Plan D drove a real record to the DLQ on 18 Aug —
      10 retries over ~30 min, landed 06:57:42Z, saturated `send-dlq-depth`. Whether that specific
      alarm's fire reached the new subscriber is unconfirmed (it predates the subscription, per
      `BUSY-1117-AC4-WIRING.md`'s inference that it was added after 18 Aug). Fallback unchanged:
      descope AC4 **with a stated reason** — never leave it as an untested gap, it's measured.
- [ ] **3.3 — Send K1–K6 to Kian as one batch.** Text: action list **Appendix 1**. Only **K5** (is the
      coalesce out-of-order-safe?) affects a verdict — it's the sole PARTIAL under 1116 AC2.
- [ ] **3.4 — Send the findings pack to the project team** (`POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`).
      Text: **Appendix 2**. **Lead with "nothing is lost, no valid update is blocked, no cross-tenant
      impact"** or it reads as a fault report. **They** decide whether a ticket is needed.

---

## 4. STEP 3 — the wording you own

**Tickets / Confluence:**

- [ ] **4.1 — 1116 AC2 / AC3: scope to present values, not deletions.** `SAVE` is additive — measured 18 Aug
      on `QA-UP2-TEST` (explicit empty `<Color></Color>`, SCALE still reads `Green`). As written both ACs
      read as though a re-sync restores full fidelity. It doesn't.
- [ ] **4.2 — 1116 AC3: restate "within Cin7 rate limits" in *requests*.** A 6 h 07 m reset costs **15
      requests**, not thousands. The records-vs-requests conflation caused a five-week deferral.
- [ ] **4.3 — 1116 AC1 / AC4: scope the DLQ guarantee to faults that *reach* the queue.** The buffer-populator
      has no DLQ path at all (`LastModified` 3 Aug, never redeployed, no `DeadLetterConfig`).
- [ ] **4.4 — 1116 TC6: decide.** Reword to *"no duplicate items after a reset"* → clean **PASS**; or leave
      **PARTIAL** with the gap named. The literal ask is a before/after SCALE diff and no before-snapshot was
      ever taken. The underlying risk *is* closed (`WPDTC26-302F-*`, 8 unique sizes, no duplicates, after a
      500+ item batch that hit a `TimeoutError` and retried). **Your call.**
- [ ] **4.5 — Guard ID3 at PARTIAL.** No test ever inverted arrival order, so *"newer `read_at` wins
      regardless of arrival order"* is dev-attested only. Closed by **K5** or a deliberate out-of-order
      injection. **Don't let anyone quietly restore it to PASS.**
- [ ] **4.6 — 1117 ticket + LLD §9: correct the cadence rationale.** Deployed cadence is **3 min**; ticket
      says 15, LLD says 2. "8 cycles ≈ 2 hours" is really 24 min; "3 consecutive errors ≈ 45 min" is really
      9. **Correct the text, not the thresholds.**
- [ ] **4.7 — Paste Kian's AC1 confirmation from Teams into the 1116 doc.** Cited as "to be pasted at Phase
      4" and load-bearing for the strongest AC.

**LLD corrections to hand to Lachlan/Kian — seven, all documentation:**

- [ ] **4.8** §3.4 — **the `watermark − 5 minutes` overlap does not exist.** Query is
      `where=modifiedDate>='<watermark>'`, inclusive `>=`, Δ=0s across 14 cycles, zero bare `>` in full
      history. ⚠ **§14 lists "filter includes 5-minute overlap" as a unit test — that test asserts behaviour
      the deployed poller does not have.**
- [ ] **4.9** §3.3 step 5 — **not one `PutEvents` per record. Batched ≤10** (2,678 of 2,821 batches were
      exactly 10).
- [ ] **4.10** §5 — **no length column at all.** Add `Desc` **100** (truncates silently) · `Colour` **25**
      (truncates silently) · `Size` **25** (errors) · `item_code` **50** (errors). **Two truncate, two error —
      never state one behaviour for all four.**
- [ ] **4.11** §3.2 / §9 — **cadence is 3 minutes**, so "60 consecutive cycles" is wrong (see 4.6).
- [ ] **4.12** §5 — **source fields follow HLD §5.3, not CTC LLD §5** — notably `UserDef1 ← brand`, which the
      LLD omits entirely.
- [ ] **4.13** §5 — **`DimensionUm` says `M`; it must say `MM`.** `MM` is what the deployed mapper emits and
      it is correct (closed with dev + the design council 7 Aug). **`M` is a guaranteed Manhattan reject** —
      we used `dimension_uom=M` deliberately as a poison in Phase 3. Anyone building to the table as written
      would ship rejected items.
- [ ] **4.14** Replacement text for 4.8 and 4.9 is already drafted in `BUSY-1116-PHASE1-RESULTS.md` §3.2.
- [ ] **4.16** §4.2 / §7 — **the Cin7 secret is `{stage}/catalog/cin7`**, not `{stage}/cin7`. The LLD's name
      does not exist. Confirmed live and in Kian's runbook.
- [ ] **4.17** §3.4 / §4.2 — **the watermark parameter is `/catalog/cin7-manhattan/item-watermark/{stage}`**,
      not `/{stage}/cin7-manhattan/watermark`. The LLD's name does not exist. Anyone automating from the LLD
      today fails on `ParameterNotFound`.

> **➡ The runbook link (item 3.1 / 1116 AC4) has its own brief: `RUNBOOK-AC4-CLOSEOUT.md`.** Content review
> = **PASS**, so AC4 is one hyperlink. That file carries the three paste-ready LLD snippets (§3.4, §8, §13),
> four recommended runbook amendments for the repo copy, and two side-effects: **K1 shrinks to a one-line
> confirmation** (the runbook states the page cap: `MAX_PAGES_PER_RUN` default 30) and **contradiction C2
> resolves**. ⚠ It also corrects one of our own claims — **the runbook does NOT carry the `SAVE`-doesn't-clear
> caveat**; earlier docs said it did.

**Tooling doc:**

- [ ] **4.15 — Record the SCALE item-lookup navigation path in `CLAUDE.md`** (line 487 still says "capture
      it when you have it"). Also record that **`DIF Incoming Message Insight` is the wrong screen** — 0 rows
      with all filters cleared. Not finding it blocked four test cases for a week across three QA docs.

---

## 5. STEP 4 — remaining sends

- [ ] **5.1 — CTC merchandising (Appendix 4):** **M1** is any CTC field routinely *cleared* rather than
      overwritten? If yes, SCALE is carrying stale values today with **no recovery path**. **M2** products
      **30706 / 30707** (`NUSMU23-101A - MTEST` / `- WTEST`) are Public+Primary in Cin7 **production** —
      poller-eligible and shipping to SCALE right now.
- [ ] **5.2 — SCALE testing team (Appendix 4):** **S1** 100% of CTC items are `0.1 × 0.1 × 0.1 MM` (0 of
      ~3,257 records carry dimensions; our side is correct) — **we did not and will not test whether SCALE
      cubes or cartonises off item dimensions, and this has no owner. Get it one.** **S2** SCALE accepted an
      item code with a **double space** (product 29942, `WTW23-922G  -XS` … `-XXL`) — **trimming it later
      creates a SECOND item, not an update.**

---

## 6. STEP 5 — housekeeping (only if time remains)

- [ ] **6.1** Delete `_to_delete/` (`DRAFT-TICKET-SENDER-CONTAINMENT.md`, `FINDINGS-SENDER-CONTAINMENT.md`).
      Agents can't delete on your machine.
- [ ] **6.2** Confirm the four-product slot assignment — ids confirmed, roles still a proposal: 6202 `TEST1`
      = P3 burner (1 option) · 6203 `TEST2` = P1 golden · 6204 `TEST3` = P2 boundary · 6205 `TEST4` = P4
      reserve. ⚠ **Every option on all four is `optionStatus=Disabled`, so none can reach SCALE without a
      status flip — which is itself a Cin7 write.**
- [ ] **6.3** Decide the runbook end state — offer our draft's operational sections as **additions to the
      repo copy**, not a competing page (1116 TC9).
- [ ] **6.4** Close 1115 **TC7 (AC4)** and **TC10/TC11 (AC5)** retrospectively if the E2E handover needs
      them — TC7 was never executed and no organic 429 has ever occurred.

---

## 7. Three things not to get wrong

1. **QA raises no Jira ticket.** The batch-failure behaviour goes to the project team as **findings**; they
   decide. No issue has been created and none should be.
2. **Say both halves of the batch behaviour.** *"The sender has no per-record containment"* — true: its
   `.map()` has no try/catch (`validateItemDownload` `index.js:14863` → `Array.map` `14902` →
   `Runtime.handler` `14887`) and it dies in **113 ms** on the first bad element. *"Nothing is lost"* — also
   true: the **buffer-handler's** `processWithBisect` absorbs it, measured `21 → 10+11 → 5+5 → 2+3 → 1+1`
   with `"Poison pill identified"`, **20/20 valid records delivered, `rejected=0`**, and **5/5 UNI records
   delivered from the same batch as a CTC poison**. One half alone is either a false alarm or sounds like a
   cover-up. ⚠ **Every doc before 18 Aug credited the isolation to the sender. That was wrong.**
3. **Don't re-open what's closed.** Whitespace/ERR5 = **harness artefact, no ticket** · PutEvents/TC3 =
   **latent risk, no occurrence, dev note only — do not run Plan B2** · `DimensionUm=MM` = **correct and
   settled** · silent truncation of `Desc`/`Colour` = **expected, confirmed** · **never write to Cin7** —
   GET-only, `cin7-testset.sh` does not exist, and that absence is deliberate.

---

## 8. Doc map — current vs historical

**Work from these:**

| File | Role |
|---|---|
| **`FINAL-WRAPUP-RUNSHEET.md`** (this file) | **The ordered action list. Start here.** |
| `CTC-HANDOVER-ACTION-LIST.md` | **Appendices 1–5 only** — paste-ready message text and the IDE prompt |
| `CLAUDE.md` | IDE context + guardrails + resource names |
| `CTC-QA-STATE-INDEX.md` | Reconciled measured state. ⚠ **§1 and §4 have drifted** — it still calls the 1116 QA doc "stale" and Plan D Run 2 "optional". Both are wrong; §0 above supersedes it |
| `*-RESULTS.md` | **The measured record. Trust these over any brief or plan.** |
| `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` | The findings pack for the project team |

**Historical — do not action:**
`REMAINING-WORK-PLAN.md` (superseded by this file) · `DRAFT-QA-DOC-BUSY-1116.md`, `DRAFT-QA-DOC-BUSY-1117.md`,
`DRAFT-E2E-HANDOVER.md`, `BUSY-1116-QA-DOC-UPDATES.md` (**all applied to Confluence 18 Aug — re-applying
would undo the TC6/ID3 downgrades**) · `PLAN-A/B/C/D-*.md` and `PLAN-D-RUNSHEET.md` (executed; prompts kept
for the record) · `CTC-FIX-RETEST-BRIEF.md`, `CS5-ERR5-RETEST-BRIEF.md`, `CTC-FINAL-QA-PASS-BRIEF.md`,
`QA-BUNDLE-REPLAN.md`, `CS5-LIVE-TRIGGER-CHECK.md` (executed) · `STRESS-AND-ERROR-TEST-CASES.md`,
`EXTENDED-COVERAGE-TEST-CASES.md` (**case IDs still authoritative; their progress summaries are stale**) ·
`CIN7-WRITE-ACCESS-PLAN.md` (parked — no writes).

---

## 9. Evidence map — if anyone challenges a claim

| Claim | File |
|---|---|
| Batch containment, cross-tenant, bisection tree, stack trace | `MODEA-BATCH-CONTAINMENT-RESULTS.md` |
| Whitespace resolution + full-account scan (13 codes / 47 eligible options) | `CTC-WHITESPACE-REAL-PATH-RESULTS.md` |
| PutEvents reconciliation (31,731 = 31,731) + metric dimensionality | `CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md` |
| Overlap/watermark forensics, organic `TimeoutError`, LLD replacement text | `BUSY-1116-PHASE0-RESULTS.md` … `-PHASE3-RESULTS.md` |
| SCALE-end manual verification (coalesce key, upsert, SAVE-additive, no duplicates) | `PLAN-C-SCALE-MANUAL-CHECKS.md` |
| Blank-credential episode + resource-name reconciliation | `SESSION-FINDINGS-2026-08-05.md` |
| Field limits, `DimensionUm` resolution | `CTC-QA-STATE-INDEX.md` §2, `EXTENDED-COVERAGE-TEST-CASES.md` §A |
| Findings pack for the project team | `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` |
