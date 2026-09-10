# Re-test brief — Kian's staging fixes: truncation + `item_code` whitespace

**For:** the IDE agent working in `~/Desktop/testing-tools/`
**Raised by:** JJ (QA) · **Date:** 2026-08-13 · **Rev 5** — runs without dev; limits discovered by probe (Kian away all week)
**Tickets:** BUSY-1115 (the two defects JJ logged 08-11) · related BUSY-1116, BUSY-1117
**Supersedes for `item_code`:** the CS5/ERR5 re-test brief (2026-08-10) — same defect, now with a fix in front of it
**Stage:** `staging` · **Region:** `ap-southeast-2` · **Method:** bus-injection only, zero Cin7 API budget

---

## 0. How to run this brief

**Observe and record. Do not diagnose, do not infer where code lives, do not recommend fixes.**

This brief deliberately contains **no predictions** about what each variant will do. Earlier revisions had them and they bias the run. For every variant the job is the same: put a known value on the wire, follow it, and write down exactly what happened and where. If a result surprises you, that is a result — record it and move on. Questions about whether a behaviour is *acceptable* go to the dev after the run, not into the results file as a verdict.

Where this brief says "record" or "capture", that is the deliverable. Where it says "expected", it means expected *by the ticket or the LLD* — still verify it, don't assume it.

---

## 1. Scope — read this before anything else

### In scope

Exactly four behaviours, all reached by **bus-injection onto `staging-catalog-manhattan-events`**:

Two facts that shape how you read every result:

- **`item_code` is the size-suffixed option code** (`productOptions.code` / `productOptionSizeCode`, e.g. `SMU23-135A-M`) — **not** the bare `productOptionCode` (`SMU23-135A`) that the LLD and the older QA docs describe. Corrected 08-07 against a real emitted payload. It matters for D3/D4: real codes are longer than the bare-code assumption implies.
- **Inject onto `staging-catalog-manhattan-events`** — the shared bus the buffer-populator listens on. The poller has its own separate bus (`staging-catalog-cin7-events`) plus a forwarding rule; `emit-cin7-record.sh` skips that hop deliberately and still reaches the populator correctly.

| Group | Behaviour under test |
|---|---|
| **A** | `item_code` whitespace handling — leading, trailing, interior, whitespace-only, blank, tab |
| **B** | `Desc` truncation at the 100-char limit |
| **C** | `Colour` truncation at its limit |
| **D** | `Size` and `Item` over-length handling |
| **E** | Happy-path regression — a clean record still lands |
| **F** | **Has the whitespace defect already destroyed a real record?** Historical log forensics + one Cin7 GET. Read-only, injects nothing — **run this first** |

### Out of scope — do not do these, even if they look relevant

- **Any Cin7 API call beyond the single GET in Group F.** No `preview-cin7-sync.sh`, no `find-cin7-item.sh`, no profiling sweeps. **Group F spends exactly one Cin7 request** — `find-cin7-product-by-id.sh --id 29942` — and nothing else in this pass may spend another. If you find yourself wanting a second, stop and ask.
- **Any watermark write.** No `cin7-watermark.sh --set`, no `--unset`. Don't touch the lever.
- **Any poller-path testing.** Bus-injection bypasses the poller by design. Poller-side behaviour (eligibility skip, trigger fan-in, watermark advance) is not being tested here — BUSY-1115 TC7 and BUSY-1116 PW6 stay NOT RUN.
- **Any destructive test.** No secret invalidation, no Lambda config or concurrency changes, no forced endpoint failures.
- **Any DLQ purge.** See §2.
- **Reading or reasoning about the implementation.** Don't go looking for the fix in the repo to explain a result. Record the observed behaviour; the code question is the dev's to answer.
- **Editing the Confluence QA docs or Jira.** JJ pushes those.
- **Fixing anything you find.** Including tooling gaps — note them, don't build them.

If something outside this list looks necessary to get an answer, **stop and flag it** rather than widening the pass.

---

## 2. Guardrails

1. **Bus-injection only.** Zero Cin7 calls, no watermark writes (§1).
2. **Do NOT purge the buffer DLQ. Confirm its depth empirically before you start — do not trust any number written down, including this one.** The documented baseline has been wrong twice: the CS5 brief said 6, the 08-10 run found 0 (JJ had reset it), the 08-11 run found 3 (TTL expiry) and added one, so the last recorded value is **4**. The queue's `MessageRetentionPeriod` is 4 days, so it drifts on its own. Record what you actually measure, use that as your baseline, and re-check after each variant — any change is a result.

   Known contents as of 08-11 (do not delete): `fc37d02c…` blank `item_code`, `0e7bbc03…` ERR2, `fed32265…` ERR4, `ef413fc6…` blank `item_code` from the 08-11 variant 4.
3. **One variant at a time**, each with its own clean log window. The single exception is **A7**, which deliberately puts two records in one flush window; it is marked as such.
4. **Run every variant dry first.** `emit-cin7-record.sh` defaults to a dry run and prints the exact `detail` JSON and PutEvents entry. Confirm the literal `item_code`, `desc` and `message_group_id` in that output, then re-run with `--confirm`. Beware the shell stripping a trailing space or tab — verify from the dry-run JSON, not from what you typed.
5. **Use `--desc-raw` / `--weight-raw` where the script would otherwise sanitise.** Both flags were added to `emit-cin7-record.sh` on 08-10 and verified. `--desc ""` still auto-fills; `--desc-raw ""` puts a genuinely blank `desc` on the wire. `--weight-raw` bypasses `num()`'s coercion. `item_code` is **not** sanitised by the script and can be put on the wire as-is.

---

## 3. Step 0 — two blocking gates

### Gate A — is the fix actually deployed to staging?

Kian said "pushed to staging" on 08-11/12. BUSY-1115 is still in **Review** and no Jira comment records this specific deploy. Confirm before interpreting a single result:

```
aws lambda get-function-configuration --function-name staging-catalog-manhattan-item-sender --query '[LastModified,Version]'
aws lambda get-function-configuration --function-name staging-catalog-manhattan-item-buffer-buffer-populator --query '[LastModified,Version]'
aws lambda get-function-configuration --function-name staging-catalog-cin7-cin7-item-poller --query '[LastModified,Version]'
```

Record all three timestamps at the top of the results file.

**If any predates 2026-08-11, do not stop — the pass still has value.** Kian is away all week, so there is nobody to confirm with, but you don't need him: **the pre-fix behaviour of every Group A variant was measured on 08-10 and again on 08-11** (§5). Running A1 and A2 tells you behaviourally whether a fix is present, regardless of what a timestamp says — if trailing whitespace now lands in SCALE, something changed; if it still throws in the populator with the identical error, it didn't.

So: record the timestamps as fact, note the mismatch, and **carry on**. Label those results **"deploy unconfirmed — fix presence inferred from behaviour"** rather than PASS/FAIL against a fix you can't prove is there. That distinction is the honest one and it's still a useful week's work.

### Gate B — the character limits are undocumented

The LLD §5 mapping table and the Manhattan *Connections* page contain **no field lengths**. The only limit evidenced is **`Desc` = 100** (from the observed `stringLength_100` rejection). The limits for **Colour**, **Size** and **Item** exist in the implementation but are recorded nowhere QA can read.

**Kian is away for the rest of the week (confirmed 2026-08-13), so asking is not an option and this pass runs without him.** Groups C and D are **not** blocked by that — the limits are cheaply discoverable by observation, because the two behaviours reveal themselves in different ways. Do this as **Step C0/D0**, before the boundary variants:

| Field | Behaviour | How to read the limit off one probe |
|---|---|---|
| `Colour` | truncates | Send a **200-char** colour, let it land, then read what SCALE actually **stored**. The stored length *is* the limit. One probe, no walking |
| `Desc` | truncates | Same method as a cross-check — the stored length should come back as **100**, which independently confirms the known value and proves the probe method works. Do this one **first** |
| `Size` | errors | Send a **200-char** size and read the **verbatim error**. Manhattan quotes the datatype in schema failures (`stringLength_100` is how the `Desc` limit was found in CS6), so the number is usually in the text. Our own validation may also name it |
| `Item` | errors | Same method. Note the `message_group_id` length too — SQS FIFO caps `MessageGroupId` at 128, which may bite before any field limit does |

Only if a probe reveals nothing — no stored value to measure, no number in the error — fall back to a **coarse walk** (say 200 → 100 → 50 → 25) to bracket it, and stop as soon as you have the boundary within a few characters. **Cap this at four probes per field.** If a limit still isn't established after that, mark that field's boundary variants **BLOCKED (limit undiscoverable)**, record what the probes did show, and move on — don't spend the session on it.

Run `Desc` first. It is the one field whose limit is already known, so if the probe method doesn't return 100 for `Desc`, the method is wrong and the other three numbers can't be trusted either.

Two things to expect while probing: an over-long value on an **erroring** field may become a poison record and add to the DLQ (fine — record it), and one on the **populator** side may vanish (also fine — record it). Neither is destructive. Record the four numbers you land on, and flag clearly that they were **measured by QA, not supplied by dev** — they need confirming with Kian next week before they go in any doc as fact.

Record the four limits at the top of the results file. Wherever this brief writes `<LIMIT_COLOUR>`, `<LIMIT_SIZE>`, `<LIMIT_ITEM>`, substitute the real value.

---

## 4. What to capture for every single variant

Same six things, every time. This is the spine of the results file.

1. The literal value from the **dry-run** output, and the `message_group_id` the script printed.
2. What the **populator** log shows — did it receive the event, did it accept or throw, verbatim error text if any.
3. What the **sender** log shows — validation, truncation, `ManhattanBatch received=M coalesced=N`, `accepted=N rejected=0`.
4. **DLQ delta** — buffer DLQ (baseline 6) and send DLQ, before and after.
5. **Populator `Invocations` **and** `Errors` metric deltas** (CloudWatch). **Read these carefully:** the 08-10/08-11 runs established that the deployed populator wraps its queue push in `try { … } catch (e) { console.log(e) }` — the SQS throw is swallowed and never rethrown, so the Lambda invocation completes normally. `Errors` stayed at **0** while `Invocations` incremented, across every whitespace variant. **`Errors = 0` therefore does not mean "no error occurred"** — it is the recorded pre-fix behaviour. Capture both numbers plus the log line, and note whether that relationship has changed.
6. **What SCALE actually stored** — the item, and the literal value of the field under test. For anything that didn't arrive, confirm it reached nothing at all.

If a variant produces an error, record **where it surfaced, the verbatim text, and whether the record ended up anywhere recoverable.** Don't characterise it beyond that.

---

## 5. Group A — `item_code` whitespace

### Recorded before-state — measured, not predicted

These are **measured results from the 08-10 and 08-11 runs**, before Kian's fix. They are the comparison baseline, not a forecast. Your job is to record what happens now and note whether it differs.

| Variant shape | Measured pre-fix behaviour (08-10, re-confirmed 08-11) |
|---|---|
| Interior space (`QA-CS5A INTERIOR`) | Populator threw `InvalidParameterValue: … MessageGroupId can only include alphanumeric and punctuation characters. 1 to 128 in length.` Record reached nothing — no buffer, no DLQ, no sender. Populator `Invocations=1, Errors=0` |
| Trailing space | Identical to the above |
| Whitespace-only (`"   "`) | Identical to the above — `CTC#   ` is still invalid |
| True blank (`""`) | Populator passed it cleanly (`CTC#` is valid). Sender threw `Error: ItemDownload failed validation for record CTC#: missing_item_code` at `validateItemDownload`, bisected, landed in the buffer DLQ at ~28 min. Sender `Errors` +10, matching `maxReceiveCount=10`. Buffer-handler `Errors` stayed 0 |
| Leading space / trailing tab | **Never run.** No before-state exists for A3 or A6 |

In all four measured cases the `message_group_id` the script put on the wire matched what the populator logged as received, exactly.

| # | `item_code` | What to observe |
|---|---|---|
| **A1** | `QA-FIX-A1 INTERIOR` | Interior space — the shape recorded in the CS5 evidence (`CTC#SMU23 135A`) and the case JJ found a real Cin7 product for. Where does it end up? |
| **A2** | `QA-FIX-A2-TRAILING ` | Trailing space. If it lands, what is the literal `Item` value in SCALE? |
| **A3** | ` QA-FIX-A3-LEADING` | Leading space. Same question |
| **A4** | `"   "` (spaces only) | Kian's new explicit error. **Where does it surface, and what does it leave behind** — populator log, sender log, DLQ, `Errors` metric |
| **A5** | `""` (true blank) | Control. The recorded prior behaviour (ERR1) was: passed the populator, uncaught throw in the **sender**, bisected, reached the buffer DLQ after ~10 retries / ~30 min. Record whether that is still what happens |
| **A6** | `QA-FIX-A6-TAB\t` (trailing tab) | Whether tab is handled the same way as a trailing space |
| **A7** | `QA-FIX-A7-DUP ` **and** `QA-FIX-A7-DUP` | **The two-record exception.** Fire both close enough to land in one ~3-min buffer flush. Record the sender's `received=M coalesced=N` line, then check SCALE: **one item or two?** |

```
# dry first — confirm the literal item_code and message_group_id in the printed JSON
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "QA-FIX-A1 INTERIOR"
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "QA-FIX-A2-TRAILING "
./emit-cin7-record.sh --stage staging --profile <profile> --item-code " QA-FIX-A3-LEADING"
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "   "
./emit-cin7-record.sh --stage staging --profile <profile> --item-code ""
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "QA-FIX-A6-TAB	"
```

Add `--confirm` only after the dry run shows the value you intended.

**One thing to note in the results, factually and without inference:** `emit-cin7-record.sh` builds `MESSAGE_GROUP_ID="${COMPANY}#${ITEM_CODE}"` itself (line 151), and per LLD §3.5 the poller does the same on the real path. The 08-11 run additionally decompiled the deployed populator bundle and recorded that it *reads* `event.detail.message_group_id` rather than deriving it, with no trim logic present at that time. So for each Group A variant, **record both** the `message_group_id` the script put on the wire **and** whatever the populator logged as received. If those differ, write down the difference. That comparison is a fact worth having in the file; what it implies is a question for the dev, not a conclusion for the results.

---

## 6. Group B — `Desc` truncation (limit = 100)

Use `--desc-raw` so the script's auto-fill doesn't interfere.

**Traceability — this is a re-test, not new coverage.** `CS6` (08-07) put a ~617-char desc through and got `ManhattanSchemaValidationError` / `stringLength_100`: **rejected, not truncated**, and it became a poison record on the normal bisection→DLQ path. `GE4` covers the same ground and is recorded PARTIAL. Tag your results against CS6 and GE4 so the backlog docs can be updated. The exact boundary (100 vs 101) has **never** been probed — B1/B2 are genuinely new.

`Desc` maps from Cin7 `name`, not `description` (which is HTML-wrapped) — FM3, verified 08-07. Irrelevant to bus-injection, but don't describe this as "the product description" in the results.

**Expect a crash, not a clean rejection, if a value goes wrong.** The sender has **no per-record containment for a bad field value** — one systemic defect with three known repros: missing `item_code` (ERR1), genuinely blank `desc` (ERR2, throws in `validateItemDownload`), and non-numeric `weight` (ERR4, raw `TypeError: value.toFixed is not a function` in `roundToSchemaPrecision`, no type guard at all). An uncaught throw aborts the **whole batch invocation** before bisection isolates it. If B4's multi-byte case breaks the payload, expect that shape rather than a tidy single-item rejection — and record it as such.

Note `CS4` already passed unicode content end to end (`Café™ Item ° 🎉 Naïve`, escaped and accepted, 08-07) — but at a length nowhere near the boundary. B4 is the boundary-plus-unicode combination, which is new.

| # | `desc` | What to observe |
|---|---|---|
| **B1** | Exactly 100 chars | Does it pass through untouched? |
| **B2** | 101 chars | Does it arrive, and is the stored value exactly 100 — not 99, not 101? |
| **B3** | ~500 chars | Does it arrive; any batch-level effect |
| **B4** | 105 chars with non-ASCII at the boundary — accented chars, an em-dash, a `™`, and an emoji straddling position 100 | What arrives in SCALE, and whether the batch was affected. Record the exact stored string, byte-for-byte if you can |

**Also capture for B1–B4:** whether the truncation is **reported anywhere** — a log line, a metric, a `missing_fields`-style marker — or whether it happens with no operator-visible signal. Record what you find either way. (Context, not a verdict: LLD §5 sets "default-and-report, never silent" for defaulted values; whether truncation is meant to follow the same rule is a question for the dev.)

---

## 7. Group C — `Colour` truncation (limit `<LIMIT_COLOUR>`)

Colour maps from Cin7 `customFields.products_1011` — **not** `optionLabel1`, which the LLD claims and which was blank on the real product checked (FM6, verified 08-07). Same shape as Group B.

**No existing test case covers colour or size length at all** — Groups C and D are new coverage, not a re-run.

| # | `colour` | What to observe |
|---|---|---|
| **C1** | Exactly `<LIMIT_COLOUR>` | Passes through untouched? |
| **C2** | `<LIMIT_COLOUR> + 1` | What arrives; exact stored value |
| **C3** | Non-ASCII at the boundary | As B4 |

Capture the same reporting question as Group B.

---

## 8. Group D — `Size` and `Item` over-length

These are the new error paths.

| # | Field | Value | What to observe |
|---|---|---|---|
| **D1** | `size` | Exactly `<LIMIT_SIZE>` | Accepted, unchanged? |
| **D2** | `size` | `<LIMIT_SIZE> + 1` | Which component rejects; verbatim error; where the record ends up; whether `SenderValidationFailures` (`Company=CTC`) increments |
| **D3** | `item_code` | Exactly `<LIMIT_ITEM>` | Accepted, unchanged? |
| **D4** | `item_code` | `<LIMIT_ITEM> + 1` | As D2. Also record the `message_group_id` length — SQS FIFO caps `MessageGroupId` at 128 chars, so note whether the code length or the group-id length is the operative constraint |

---

## 8b. Group F — is the defect live or theoretical? (RUN THIS FIRST)

Folded in from `CS5-LIVE-TRIGGER-CHECK.md` (written 2026-08-10, never run). **Read that file for the full method and reasoning; this is the short form.** It is purely observational — it injects nothing and changes nothing.

**⚠ Run Group F before any injection in this pass, and do not defer it.** Two reasons, both material:

1. Step F2's follow-up counts historical populator throws. **Every variant you inject in Groups A–E adds new ones.** Run it after, and you have to subtract your own noise from the number that matters.
2. Its answer is the single most decision-relevant output of the week. If a real record has already been destroyed, that reframes A1 from "an edge case QA synthesised" to "this has already silently eaten production data" — a different conversation with a different urgency.

### The question

CS5 has **only ever been reproduced by our own bus-injection**. No live trigger has been confirmed. Which of these it is decides how it gets raised:

> *"QA synthesised an input Cin7 would never send"* — or — *"this has already eaten a real record and nobody noticed."*

The previous "no live trigger" reassurance is **retracted**: it checked product 29942's `productOptionCode` (clean), but `item_code` is the **size-suffixed** `productOptions.code`. `'WTW23-922G  -XS'` is exactly that shape, with an **interior double space** — the variant a trim does not fix.

### F1 — the logs (free, zero Cin7 cost)

Poller / populator / sender log retention is **"None" (never expire)**, so the full history is queryable. Run a CloudWatch Insights query across all three log groups for `WTW23-922G`, over 90 days; **widen it if nothing comes back.** Exact command is in `CS5-LIVE-TRIGGER-CHECK.md` §4.

| What you find | What it means |
|---|---|
| Poller emitted it · populator logged the `InvalidParameterValue … MessageGroupId` throw · sender **silent** | **LIVE TRIGGER CONFIRMED** — the defect has already destroyed a real record |
| Poller emitted it · sender **accepted** it | The code was clean at emit time; padding lives in some other Cin7 field. Defect stays theoretical |
| Nothing at all | Inconclusive — 29942 may never have come through a poll window in range. Fall through to F2 |

### F2 — Cin7 (exactly one request)

```
./find-cin7-product-by-id.sh --id 29942
```

Read **`productOptions[].code`** — **not** `productOptionCode`. That distinction is the entire point.

Report the literal value **wrapped in delimiters** so whitespace is visible, e.g. `[WTW23-922G  -XS]`. Note how many options carry padding, and whether it is **interior**, leading/trailing, or both. **Interior is the finding that matters.**

### F3 — only if F1 confirms a live trigger

The question becomes *how widespread*, and the answer is still free: re-run the F1 query against the **populator log group alone**, over the widest window available, filtering `| filter @message like /MessageGroupId/`. That yields a count of genuinely lost records and their distinct `item_code`s.

**Report the count and the codes. Do not attempt to recover or re-send any of them** — that is JJ's decision, not this pass's.

### What to record

The three F1 outcomes with verbatim log lines; the literal delimited `productOptions[].code` values from F2; the F3 count and codes if reached; and **the verdict in one line: is CS5 live, or theoretical?**

## 9. Group E — regression

| # | Test | What to observe |
|---|---|---|
| **E1** | A wholly ordinary record: valid `item_code` with no whitespace, `desc` well under 100, normal `size` and `colour`, populated weight/dims | Does it land in SCALE unchanged, end to end, in the usual time? |

**Run E1 first** to establish the happy path is healthy before you start, **and again last** to confirm the pass left the pipeline working.

---

## 10. Where to look

Cadence is **3 minutes** (confirmed deployed — the ticket's 15-min and the LLD's 2-min are both wrong). Allow at least one full cadence interval plus the ~3-min buffer flush before concluding a record didn't arrive.

| Order | Log group / resource |
|---|---|
| 1 | `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-populator` |
| 2 | `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-handler` |
| 3 | `/aws/lambda/staging-catalog-manhattan-item-sender` |
| 4 | `staging-catalog-manhattan-item-buffer-dlq.fifo` — **measure the baseline, don't assume it** |
| 5 | *(There is no second, physically distinct "send" DLQ. `send-dlq-depth` is an alarm that watches the queue on row 4 — the name is just a label. Don't go looking for a queue that doesn't exist.)* |
| 6 | SCALE staging (`https://unvsstg.manhscale.com`) — the only place to confirm what was actually **stored** |
| 7 | CloudWatch: populator `Errors`; sender `SenderValidationFailures` (`Company=CTC`) |

**Tooling status — this gap is closed.** `tail-logs.sh --lambda populator` was added on 08-10 and verified against staging; it carries a DROP_HINT covering the `InvalidParameterValue … MessageGroupId` throw. Use it:

```
./tail-logs.sh --stage staging --profile <profile> --lambda populator --since 10m
```

(The 08-11 results file states the populator was unreachable via `tail-logs.sh` and fell back to `aws logs tail`. That contradicts the 08-10 change, which is present in the script today. Try the flag first; if it genuinely fails, record that as a finding — it means something regressed.)

---

## 11. What to report

Write results to `CTC-FIX-RETEST-RESULTS.md` in `testing-tools/`, **including Group F** — one file for the whole pass. (`CS5-LIVE-TRIGGER-CHECK.md` asks for its results in a separate `CS5-LIVE-TRIGGER-RESULTS.md`; that is superseded now it's folded in here. Give Group F its own clearly-headed section.) **Do not edit the Confluence QA docs or Jira** — JJ pushes those.

**If Group F confirms a live trigger, say so at the very top of the results file**, not buried under the variant tables. It is the finding that changes what happens next.

**Header of the file:** the three `LastModified` timestamps from Gate A (and whether they confirm the deploy or not); the four character limits from Gate B, **each marked as QA-measured, not dev-supplied**, with the probe that produced it; the buffer-DLQ baseline you measured; the date/time window of the run.

**Per variant:** the six items in §4.

**Status per variant:** PASS / FAIL / BLOCKED (tooling) / BLOCKED (limits unknown) / BLOCKED (deploy unconfirmed) / NOT RUN. Use BLOCKED rather than forcing a pass/fail when the harness couldn't reach the behaviour.

**A short factual summary at the end**, answering only what was observed:

- **Q1.** Where did each Group A variant end up — SCALE, DLQ, or nothing?
- **Q2.** For A4, D2 and D4 — which component raised the error, what did it say, and what was left behind (log entry, metric, DLQ message)?
- **Q3.** Did A5 (true blank) behave as previously recorded (sender crash → buffer DLQ after ~10 retries), or differently?
- **Q4.** Did A7 produce one SCALE item or two?
- **Q5.** For B and C — were the boundaries exact, was non-ASCII handled without breaking the payload, and was any truncation reported anywhere?
- **Q6.** Did E1 pass at the start and at the end?
- **Q7.** **Is CS5 live or theoretical** — one line, from Group F. If live: how many records, and which codes?

**Then a separate "Questions for dev" list** — things the run surfaced that need Kian to answer, stated as questions, not as findings. Anything you were tempted to write as a verdict goes here instead. **Kian is back next week, so this list queues rather than blocks** — it is an output of the pass, not a reason to pause it. Seed it with the four QA-measured character limits, which need confirming against the implementation before they go in any doc as fact.

---

## 12. What NOT to conclude

- **Manhattan always returns HTTP 200** regardless of outcome. Judge delivery from the sender's `accepted=N rejected=0` line, never the HTTP status.
- **Absence from the DLQ is not proof the test didn't run.** Distinguish "did not arrive anywhere" from "was never injected" using the dry-run output plus the populator log.
- **A quiet log is not automatically a pass or a fail** — say which log was quiet and for how long, and leave it there.
- **Do not extrapolate to poller-side behaviour.** Bus-injection bypasses the poller (§1). BUSY-1115 TC7 / BUSY-1116 PW6 remain NOT RUN. (`--missing-option-code`'s misleading usage text was corrected on 08-10 — it now states plainly that it is the ERR1 shape and does not cover TC7/PW6.)
- **`send-dlq-depth` has been in `ALARM` since 2026-08-10**, saturated by the pre-existing DLQ messages. A new DLQ arrival will therefore not produce a fresh alarm transition or SNS publish. That is a pre-existing state artefact, not evidence about the alert chain. Related: the alerts topic is actually `staging-catalog-manhattan-observability-alerts` (not `…-manhattan-alerts`) and had **zero subscriptions** as of 08-11.
- **Don't explain a result by reading the implementation.** Record what happened; the why goes to the dev.

---

## 13. Read these first

In this folder, in this order:

1. **`CS5-ERR5-RETEST-RESULTS.md`** (08-11) — the immediate before-state for Group A.
2. **`BUSY-1115-CLOSEOUT-RESULTS.md`** (08-10) — the same variants plus the tooling changes (`--desc-raw`, `--weight-raw`, `--lambda populator`) this brief depends on.
3. **`CLAUDE.md`** — folder context. Note its pointer to the closeout results still reads "in progress"; it is finished.

4. **`CS5-LIVE-TRIGGER-CHECK.md`** (08-10) — **now folded in as Group F and part of this pass** (JJ's call, 2026-08-13). Never run until now. Read it in full before running F; §8b here is the short form, that file has the exact queries and the reasoning.

## 14. Provenance

Assembled 2026-08-12 from: Kian's 08-11/12 message on the staging fixes; JJ's BUSY-1115 comment of 2026-08-11 (the two defects) and BUSY-1117 comment of the same day; the CS5/ERR5 re-test brief and results; the BUSY-1115 closeout results; `CS5-LIVE-TRIGGER-CHECK.md`; the CTC re-sync runbook draft; the BUSY-1114 QA test plan; and LLD [CTC Item Master Sync](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1765736449) §3.3, §3.5, §5, §8, §9.

**Rev 3 corrections** (reconciled against the on-disk results, which the project copy did not have): DLQ baseline 6 → confirm empirically, last recorded 4; populator `Errors` known to stay 0 by design of the swallowed catch; `tail-logs.sh --lambda populator` gap closed; `--missing-option-code` text already corrected; script line references updated; measured before-state added to Group A.
