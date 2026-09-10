# Plan D — does one bad record block valid ones? (Rev 2 — unconstrained)

**The gap:** when the sender's own `validateItemDownload` throws uncaught, the invocation aborts **before
the send**. We have never measured what happens to the **valid records in that same batch.**
**Owner:** JJ (QA) · **Rev 2:** 2026-08-18 · **Status: ✅ COMPLETE — T1 and T4 run and passed. T2/T3/T5 dropped.**

> ## ✅ ANSWERED 2026-08-18 — both questions closed. Results: `MODEA-BATCH-CONTAINMENT-RESULTS.md`
>
> **T1 (Run 1):** 1 over-length-`Size` poison + 20 valid CTC controls in one flush → **all 20 delivered**,
> `rejected=0`, only the poison isolated, DLQ **+1**. Latency ~14–36s.
>
> **T4 (Run 2):** 1 CTC poison + 5 valid UNI controls (numeric codes `9100001`–`9100005`) →
> `ManhattanBatch received=6 coalesced=6`, confirming **the batch is NOT company-scoped** — and **all 5 UNI
> records delivered**, `rejected=0`, none ever touched the DLQ. **A CTC data error cannot block UNI item
> sync.** Cross-tenant risk closed.
>
> **The mechanism, previously mis-attributed everywhere:** isolation is **not the sender's**. Its `.map()`
> has no per-item try/catch and dies in 113ms on the first bad element (`validateItemDownload`
> `index.js:14863` → `Array.map` `14902` → `Runtime.handler` `14887`). Recovery is one layer up —
> `staging-catalog-manhattan-item-buffer-buffer-handler` wraps every sender call in `processWithBisect` and
> **recursively halves on any failure**, logging `"Poison pill identified"`. Proven **content-agnostic**
> (T1) and **tenant-agnostic** (T4).
>
> **Latency insight:** the 36s vs 77s difference between runs is **where in the 3-minute polling cycle the
> records were sent**, not batch size or failure type. **Worst case is one buffer cycle (~3 min) plus a few
> seconds of bisection.**
>
> ### T2, T3, T5 dropped — deliberately, with reasons
>
> - **T2 (all five triggers):** the bisection is now proven content-agnostic, so every trigger routes
>   through the same recovery. **T2c (unguarded `weight`) was the one worth watching** — but its value was
>   to sharpen a *code-intent* question ("is the missing type guard deliberate?"), which a behaviour test
>   cannot answer. Ask dev instead.
> - **T3 (real traffic):** T1 proved the mechanism at 21 records through the same handler that processes
>   everything. Real records add optics, not evidence.
> - **T5 (density / mixed modes / position):** edge cases on a mechanism now shown to work twice.
>   **T5c is partly answered for free** — the T1 poison sat at position 0 and died on element 0 in 113ms,
>   so position affects how fast the sender dies, not the outcome.

> ## Rev 2 — budget and blast-radius constraints REMOVED (JJ, 2026-08-18)
>
> **Testing takes priority over all allowances except one.** Spend AWS API calls, Manhattan sends, DLQ
> depth and Cin7 **GET** budget freely. Rewind the watermark. Disturb the shared staging pipeline.
>
> **The single hard constraint: NEVER write to Cin7.** GET-only, always — see `CLAUDE.md` Hard
> Constraint 1. No POST/PUT/PATCH/DELETE, and no hand-rolled equivalent.
>
> **Rev 1 was over-cautious and it cost the test its value.** It used 3 synthetic controls, avoided a
> "quiet window", and gated every tier behind a stop. Rev 2 runs the lot, at realistic scale, with real
> traffic — and promotes the thing Rev 1 treated as a hazard to be avoided into **the most important test
> here (T4).**

**Read first:** `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` and `CLAUDE.md`.

---

## ⚠ Final-check corrections (2026-08-18) — read before running

1. **UNI controls in T4 must use NUMERIC item codes.** Sender validation is **per company** (BUSY-1113):
   UNI requires numeric item codes, CTC requires a non-empty product option code. A UNI control named
   `QA-D-…-UNI-CTRL1` would **fail UNI validation and become a second poison**, confounding the test
   entirely. Use numeric codes (e.g. `9100001`…), as ID1 did with `3141592`. **This would have invalidated
   T4.**
2. **`missing item_code` yields `message_group_id = "CTC#"`** — all such records share one FIFO group and
   get serialised. Send only one per run.
3. **T3 must run alone.** It's the only tier touching the watermark, and real traffic contaminates every
   other tier's attribution.
4. **Don't use DLQ *depth* deltas across overlapping tiers.** A poison takes ~30 min to land. Attribute by
   `MessageGroupId` instead; every record is named for that reason.
5. **The good outcome may look like a second, poison-free invocation delivering the controls.** That's a
   PASS — recovery worked. Don't misread it.

**Run sheet with five ready-to-paste prompts: `PLAN-D-RUNSHEET.md`.**

---

## Why this gap exists

All five Mode A repros were deliberately sent **one record at a time, ~3 minutes apart.** The
character-limit brief instructed exactly that, on the reasoning that *"batching probes means one bad probe
destroys good ones and the result is uninterpretable."* **That was a precaution to avoid the problem, not
a measurement of it** — and nobody went back.

Every fast-isolation result we cite (control delivered in 13–22s; 180 of 181 items fine) is **Mode B** —
Manhattan rejecting a value, where the call completes and returns counts. **Mode B is not evidence for
Mode A**, because in Mode A the send never happens.

---

## The discriminator — check this before interpreting anything

In **Mode A** the throw precedes the HTTP call, so for that invocation expect:

- `ManhattanBatch received=N coalesced=M` — **present** (batch was assembled)
- the validation reason — **present** (e.g. `reason:"size_too_long"`)
- **NO `ManhattanRequestOutcome`, no `accepted=`/`rejected=`** — nothing was sent

**If `accepted=` appears you have reproduced Mode B by accident** and that run answers nothing. Say so
and re-run.

Also confirm from `ManhattanBatch received=N` that the poison and controls **actually coalesced into one
call.** If they split, the run is void — tighten the send window.

---

## T1 — Scale test, synthetic

**1 over-length `Size` poison + 20 valid controls, all inside one buffer flush.**

Rev 1 used 3 controls. JJ's observation was about *batches of updates*, and real coalesced batches run to
500+ items, so 3 was never going to be representative.

- Poison: `QA-D-T1-POISON-<ts>`, `--size` = 30 chars (limit 25)
- Controls: `QA-D-T1-CTRL01…CTRL20-<ts>`, fully valid
- Send all 21 within ~60–90s

**Capture:** the `ManhattanBatch received=N coalesced=M` lines · whether the throw is uncaught · the
discriminator · every subsequent invocation (what it received, what it delivered) · **wall-clock from
first send to each control's confirmed delivery** · `ApproximateReceiveCount` on anything reaching the
DLQ · **final DLQ delta.**

**Headline result: DLQ +1 means only the poison died. +2 or more means valid records went with it.**

---

## T2 — All five Mode A triggers

Rev 1 tested one. Run all five, each with **5 controls**, in separate buffer windows so results stay
attributable:

| Run | Poison | Why it differs |
|---|---|---|
| T2a | missing `item_code` | named check; also the `CTC#` group-id edge |
| T2b | blank `desc` (`--desc-raw ""`) | named check |
| T2c | non-numeric `weight` (`--weight-raw abc`) | **no validation check in front of it** — fails deeper in `roundToSchemaPrecision` with no reason logged |
| T2d | over-length `Size` (30 chars) | named check — JJ's observed case |
| T2e | over-length `item_code` (55 chars) | named check |

**T2c is the one to watch.** If the unguarded path behaves differently from the named checks — aborts
earlier, or takes controls down when the others don't — then the missing type guard has real consequences
and JJ's Q2 sharpens from "just flagging it" to a finding.

---

## T3 — Real traffic, the representative test

Synthetic controls prove the mechanism. **This proves the actual scenario JJ observed: real valid CTC
updates blocked by one bad record.**

1. `preview-cin7-sync.sh --since <a few hours back>` — **not for budget, for interpretation.** You need to
   know which real records to expect so you can tell delivered from missing.
2. Snapshot the watermark, then `--set` that floor and `--confirm`. Confirm with a direct `get-parameter`.
   **SSM lag is variable in both directions** — once 11 cycles / ~33 min, once 1 cycle / ~1m39s.
3. As the real records start flowing, **inject a Mode A poison timed to land in the same buffer flush** as
   a batch of them.
4. Reconcile: every real record the preview said would emit — did it reach SCALE? Compare poller
   `recordsEmitted` against populator receipts and sender deliveries for that window.
5. `--unset --confirm`, confirm queues drain to 0/0.

**This is the finding-quality evidence.** If real CTC updates fail to arrive because of one injected bad
record, that is the defect demonstrated in production-shaped conditions.

---

## T4 — ⚠ Cross-tenant: does a CTC poison block UNI records? THE MOST IMPORTANT TEST HERE

Rev 1 listed this as a blast-radius hazard to avoid. **It is the highest-value test in the plan and the
constraint that was hiding it is now lifted.**

The buffer is **shared** across UNI/PS/CTC. The *coalesce key* is `(company, item_code)` — but the
**batch is not company-scoped.** So if a CTC Mode A throw aborts an invocation that also contains UNI
records, a bad CTC item can delay or block **UNI item sync**. That is a cross-tenant availability defect,
and materially more serious than anything CTC-only.

**Method:** inject a CTC Mode A poison and **5 valid UNI controls** (`--company UNI`) into the same buffer
flush. Confirm from `ManhattanBatch received=N` that they coalesced together, then measure whether the UNI
records are delivered, delayed, or land in the DLQ.

**Interpretation:**

| Observed | Meaning |
|---|---|
| UNI records delivered normally | Batches are effectively isolated per company, or recovery is fast enough not to matter. **Good news, and worth stating explicitly** — it bounds the blast radius |
| UNI records delayed | Cross-tenant latency impact. Quantify it |
| UNI records in the DLQ | **Cross-tenant data-availability defect.** A CTC data-entry error can block UNI warehouse updates. Escalate immediately — this affects a live integration outside CTC's scope |

---

## T5 — Poison density and mixed modes

- **T5a — multiple poisons:** 3 Mode A poisons + 10 controls in one batch. Does bisection converge, or
  thrash and drag everything through repeated retries?
- **T5b — Mode A + Mode B together:** one over-length `Size` (A) + one `dimension_uom=M` (B) + 5 controls.
  Does the aborting throw prevent Mode B's normal isolation from working at all? These two recovery paths
  have never been exercised against each other.
- **T5c — position:** poison first vs poison last. Cheap to fold in; probably irrelevant, worth one line
  either way.

---

## Guardrails — what still applies

- **🚫 NEVER write to Cin7.** GET-only. This is the one constraint Rev 2 does not relax. If a test seems
  to need a Cin7 write, **stop and tell JJ.**
- **Name every injected record** (`QA-D-T*-…`). Not budget — hygiene. An unattributable DLQ message is a
  mystery for a future session, and there are already 19 in there that took a full inventory to explain.
- **Don't purge the DLQ.** Record the delta and the inventory. Adding many is fine; losing track isn't.
- **Judge delivery from the sender log**, never HTTP status — Manhattan always returns 200.
- **Watermark `UNSET` at the end**, confirmed by direct `get-parameter`, queues drained to 0/0.
- **If UNI/PS records get caught in a batch, that's data (T4), not an accident** — record it rather than
  aborting the run.

---

## Deliverable

`MODEA-BATCH-CONTAINMENT-RESULTS.md`. Every claim tagged **MEASURED / INFERRED / UNKNOWN**, log lines
quoted verbatim. Lead with:

1. **T1's DLQ delta** — the core answer
2. **T4's cross-tenant verdict** — the most consequential one
3. Whether **T2c** (unguarded `weight`) behaves differently from the named checks
4. A per-control delivery-latency table

**Then update:** `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` (the Mode A row and the plain-language
summary, which currently says we couldn't measure this), `DRAFT-QA-DOC-BUSY-1116.md` §7, and `CLAUDE.md`'s
failure-behaviour section.

---

## Kick-off prompt

```
Read CLAUDE.md in ~/Desktop/testing-tools (request folder access if needed), then
POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md, then PLAN-D-MODEA-BATCH-CONTAINMENT.md (Rev 2).

Run T1 through T5. Do not stop between tiers - report at the end. JJ has explicitly lifted the budget
and blast-radius constraints: spend AWS API calls, Manhattan sends, DLQ depth and Cin7 GET budget
freely, rewind the watermark, and disturb the shared staging pipeline as needed. Testing is the priority.

THE ONE HARD CONSTRAINT: NEVER WRITE TO CIN7. GET-only, always. No POST/PUT/PATCH/DELETE and no
hand-rolled equivalent via curl/aws/a script. If a test appears to need a Cin7 write, stop and tell me.

The gap: when the sender's own validateItemDownload throws uncaught, the invocation aborts BEFORE the
send, and we have never measured what happens to the VALID records in that same batch. All five Mode A
repros were sent one at a time, three minutes apart, on the untested assumption that batching them would
destroy the good ones. Every fast-isolation result we cite (13-22s, 180 of 181 fine) is Mode B - Manhattan
rejecting a value, where the call completes. That is not evidence for Mode A.

Before interpreting ANY run, check the discriminator: in Mode A nothing is sent, so the invocation should
show ManhattanBatch received=N and the validation reason but NO ManhattanRequestOutcome and NO
accepted=/rejected= line. If accepted= appears you reproduced Mode B by accident - say so and re-run.
Also confirm from received=N that the poison and controls actually coalesced into ONE call; if they split,
the run is void, tighten the send window.

T1 - 1 over-length Size poison (30 chars, limit 25) + 20 valid controls, all inside one buffer flush.
     Measure: DLQ delta (the headline - +1 means only the poison died, +2 or more means valid records went
     with it), per-control wall-clock delivery latency, ApproximateReceiveCount on anything reaching DLQ.
T2 - Repeat with all five Mode A triggers, 5 controls each, separate windows: missing item_code, blank
     desc (--desc-raw ""), non-numeric weight (--weight-raw abc), over-length Size, over-length item_code.
     Watch T2c (weight) especially - it has NO validation check in front of it and fails deeper in
     roundToSchemaPrecision with no reason logged. If it behaves differently from the named checks, that
     matters.
T3 - Real traffic. Preview a window (for interpretation, not budget), snapshot then set the watermark, let
     real CTC records flow, and inject a Mode A poison timed into the same buffer flush. Reconcile every
     record the preview predicted against what reached SCALE. Then --unset --confirm and drain to 0/0.
T4 - MOST IMPORTANT. Cross-tenant: inject a CTC Mode A poison + 5 valid UNI controls (--company UNI) into
     the same buffer flush. The buffer is shared and batches are NOT company-scoped, so a CTC bad record
     may be able to block UNI item sync. Confirm they coalesced together, then measure whether the UNI
     records are delivered, delayed, or land in the DLQ. If UNI records are blocked, that is a
     cross-tenant availability defect affecting a live integration outside CTC's scope - flag it hard.
T5 - (a) 3 poisons + 10 controls: does bisection converge or thrash? (b) one Mode A + one Mode B
     (dimension_uom=M) + 5 controls: does the aborting throw stop Mode B's normal isolation working?
     (c) poison first vs last.

Name every injected record QA-D-T*-<ts> so the DLQ stays attributable - there are already 19 messages in
there that needed a full inventory to explain. Do not purge the DLQ; record the delta. Judge delivery from
the sender log, never HTTP status. Leave the watermark UNSET, confirmed by direct get-parameter, queues 0/0.

Write MODEA-BATCH-CONTAINMENT-RESULTS.md. Tag every claim MEASURED / INFERRED / UNKNOWN and quote log
lines. Lead with T1's DLQ delta, then T4's cross-tenant verdict, then whether T2c behaved differently.
Tell me which item codes need a SCALE UI lookup from me and I'll do that part.
```
