> # ⚠ SUPERSEDED — do not execute this brief
>
> **This pass was run twice (2026-08-10 and 2026-08-11) and is complete.** Results are in
> `BUSY-1115-CLOSEOUT-RESULTS.md` and `CS5-ERR5-RETEST-RESULTS.md`. All three of its questions are
> answered: interior spaces reproduce the defect (so trim-alone is insufficient), whitespace-only
> behaves as ERR5 not ERR1, and the two-path populator/sender model holds.
>
> **The active brief is now `CTC-FIX-RETEST-BRIEF.md`**, which re-tests the same ground against
> Kian's 08-11/12 staging fixes. Keep this file as the historical record of what was asked and why.
>
> **Also note:** the "is this defect live or only ever ours?" question this brief left open is
> **now being answered** — `CS5-LIVE-TRIGGER-CHECK.md` was folded into `CTC-FIX-RETEST-BRIEF.md`
> as **Group F** on 2026-08-13 and runs first in that pass.
>
> **Three things in here are known-wrong and were corrected downstream — don't act on them:**
> §2.2 says the DLQ baseline is 6 (it is a moving number — measure it); §5 says `tail-logs.sh`
> cannot reach the populator (`--lambda populator` was added 08-10); and §5's hypothesis that the
> populator's `Errors` metric would increment was **refuted** — the exception is swallowed in a
> `catch` that only logs, so `Errors` stays at 0.

# Re-test brief — CS5 / ERR5: `item_code` whitespace vs true blank

**For:** the IDE agent working in `~/Desktop/testing-tools/`
**Raised by:** JJ (QA) · **Date:** 2026-08-10 · **Rev 2** — gate pre-answered, see §3
**Tickets:** BUSY-1115 (CS5) · BUSY-1116 (ERR5) · related BUSY-1114 (ERR1)
**Stage:** `staging` · **Region:** `ap-southeast-2`

---

## 1. Why this re-test exists

Two FAILs are recorded across the QA docs. They are both `item_code` defects but they fail at
**different points in the pipeline**, and the existing evidence does not cleanly separate them.

| Case | Value reaching the populator | `MessageGroupId` built | Recorded outcome |
|---|---|---|---|
| **ERR1** (FAIL ①) | `item_code` missing / empty | `"CTC#"` — valid characters | Passes populator → **sender** throws uncaught in `validateItemDownload` → bisected → lands in buffer DLQ after exactly 10 retries (~30 min). Record **preserved**. |
| **CS5 / ERR5** (FAIL ②) | `item_code` **containing whitespace** | `"CTC#SMU23 135A"` — **invalid characters** | SQS FIFO rejects → `staging-catalog-manhattan-item-buffer-buffer-populator` throws **upstream of the queue** → no `DeadLetterConfig`, no retry policy → record **vanishes, no trace anywhere**. |

**The gap this re-test closes:** the QA docs do not record the *literal* `item_code` value used for CS5.
We know a space character was present (the SQS error can only fire if one was), but not whether it was
**leading/trailing** or **interior**.

That distinction decides whether the proposed fix is adequate:

> Documented fix: *"trim `item_code` before building `message_group_id`, and/or give the populator a DLQ."*

**Trimming fixes leading/trailing whitespace but does nothing for an interior space.** If CS5 was an
interior space, the trim half of that fix is insufficient and the **populator DLQ is the load-bearing
half**. Dev needs to know which before they pick this up.

Also untested: **whitespace-only** (`"   "`), which sits between the two rows above.

---

## 2. Hard guardrails — read before doing anything

1. **This is bus-injection only. Do NOT write the watermark. Do NOT call the Cin7 API.**
   Cin7 churn was measured 2026-08-07 at ~24× the earlier baseline (1 hr look-back = 1,422 records;
   6 hrs = 4,949 — essentially the whole shared 5,000/day cap). This test costs **zero** Cin7 budget.
   If you find yourself reaching for `cin7-watermark.sh` or `preview-cin7-sync.sh`, stop — wrong test.
2. **Do NOT purge the buffer DLQ.** Six inert synthetic messages are parked there **deliberately as
   evidence** from the 08-05/06/07 runs. `send-dlq-depth` reads red because of them and is **not** a
   real signal. Baseline depth = **6**. Confirm the baseline before you start; leave them alone.
3. **One variant at a time.** Do not batch. Each needs its own clean log window.
4. **Nothing destructive.** No secret corruption, no Lambda config changes, no concurrency changes.
   Those were all tried for TC5/TC1/TC2 and were defeated by warm-container reuse and the tooling
   permission classifier — not in scope here and not needed.

---

## 3. Step 0 — GATE ALREADY ANSWERED (verify, don't repeat)

`emit-cin7-record.sh` was read on 2026-08-10. **`item_code` is NOT sanitised.** Confirm this yourself
in passing, but do not block on it:

- `--item-code "$2"` is assigned raw (line 83) — no trim, no strip, no default
- it flows straight into `MESSAGE_GROUP_ID="CTC#${ITEM_CODE}"` (line 128)
- it is passed to the Python heredoc as an argv element and lands in `detail["item_code"]` unmodified
- `num()` (line 139) is applied to weight/dims only — **never** to `item_code`

**All four variants can be put on the wire as-is. No `--item-code-raw` hatch is needed.**

The sanitisation that blocked ERR2 and half of ERR4 is real but confined to other fields — `desc`
auto-fills when empty (lines 119–125, including from an explicit `--desc ""`), and `num()` coerces an
unparseable weight to `0`. Those still need `--desc-raw` / `--weight-raw`; they do not affect this test.

**Better verification method than originally planned.** The script **defaults to a dry run** and prints
the exact `detail` JSON and PutEvents entry without calling AWS. So:

> Run every variant **dry first**, confirm the literal `item_code` and `message_group_id` in the printed
> JSON, and only then re-run with `--confirm`.

That gives you ground truth *before* sending, rather than reconstructing it from logs afterwards. Still
cross-check against the populator's received-event log, but the dry run is now the primary check.

---

## 4. The four variants

Run each **dry first**, confirm the printed `message_group_id`, then re-run with `--confirm`.
Predicted paths are hypotheses to confirm or refute — **record what actually happens.**

| # | `item_code` value | Tests | Predicted path |
|---|---|---|---|
| 1 | `QA-CS5A INTERIOR` (space in the middle) | Reproduces CS5; proves trim-alone is insufficient | Populator throw → vanishes |
| 2 | `QA-CS5B-TRAILING ` (trailing space) | The case a trim fix *would* solve | Populator throw → vanishes |
| 3 | `"   "` (whitespace only) | Untested middle ground | Populator throw → vanishes. After a trim fix it would convert to an ERR1 sender crash instead |
| 4 | `""` (true blank) | Confirms the two paths are genuinely distinct | Passes populator → **sender** crash → bisect → DLQ after ~10 retries / ~30 min |

Confirm `--profile` from `.env` / `README.md` before running.

```
# 1 — interior space
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "QA-CS5A INTERIOR"
# 2 — trailing space
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "QA-CS5B-TRAILING "
# 3 — whitespace only
./emit-cin7-record.sh --stage staging --profile <profile> --item-code "   "
# 4 — true blank (equivalent to the existing --missing-option-code flag)
./emit-cin7-record.sh --stage staging --profile <profile> --item-code ""
```

Add `--confirm` only after the dry run shows the value you intended.

Variant 4 is the control that proves ERR1 ≠ ERR5. If variant 4 also dies in the populator, the whole
two-path model in §1 is wrong and that is a significant finding — report it immediately.

**⚠ Do not trust the script's own note on variant 4.** Lines 45–47 and 199–203 claim a blank
`item_code` "tests the eligibility-skip path (INFO, no emit, not an error)". **That is wrong on both
counts** and is a documentation trap — see §7.

---

## 5. Where to look

Cadence is **3 minutes** (confirmed deployed — the ticket's 15-min and the LLD's 2-min are both wrong).
Allow at least one full cadence interval before concluding anything.

The script emits to the shared bus `staging-catalog-manhattan-events`, whose EventBridge rule targets
the buffer-populator **directly** — so injection does exercise the exact component under test. It
bypasses only the poller's own bus and forwarding rule, which are irrelevant here.

| Order | Log group / resource | Expect for variants 1–3 | Expect for variant 4 |
|---|---|---|---|
| 1 | `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-populator` | **The throw. This is the only place evidence exists.** | Clean pass-through |
| 2 | `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-handler` | Silent | Activity |
| 3 | `/aws/lambda/staging-catalog-manhattan-item-sender` | Silent | Uncaught throw + bisection |
| 4 | Buffer DLQ (`...-item-buffer-dlq.fifo`) | **Depth stays at 6 — forever. That "nothing, ever" IS the failure.** | Depth 6 → 7 after ~10 retries / ~30 min |
| 5 | SCALE staging (`https://unvsstg.manhscale.com`) | Absent | Absent |

**Confirmed tooling gap:** `tail-logs.sh` accepts `enrich|sender|buffer|cin7-poller` only, and `buffer`
maps to the buffer-**handler** (`...-item-buffer-buffer-handler`). **The populator is not reachable
through it at all** — the one log group that matters most here. Add a `--lambda populator` case
mirroring the existing block (`FUNCTION_NAME="${STAGE}-catalog-manhattan-item-buffer-buffer-populator"`,
with a DROP_HINT covering the `InvalidParameterValue … MessageGroupId` throw). This is a permanent gap,
not a workaround — the populator is undocumented in the LLD and absent from every QA doc's Services
table. Use `aws logs tail` directly in the meantime.

**Also capture, for each variant:** the populator's CloudWatch **`Errors` metric** delta. Even when the
record vanishes, `Errors` should increment. If confirmed, an alarm on populator `Errors` is a cheap
partial mitigation for **BUSY-1117** — it can't recover the record, but it converts a silent loss into
a visible one.

---

## 6. What to report back

For each of the four variants:

1. The literal `message_group_id` from the **dry-run output**, and from the populator's received-event log.
2. Which component threw, with the verbatim error.
3. Whether the record reached the DLQ — and if not, confirmation it reached nothing at all.
4. Populator `Errors` metric delta.

Then answer the three questions this re-test exists to settle:

- **Q1.** Is CS5 reproducible with an **interior** space? (⇒ trim-alone is insufficient; populator DLQ is mandatory, not optional)
- **Q2.** Does whitespace-only behave as ERR5 or ERR1?
- **Q3.** Does a true blank confirm the two-path model — populator vs sender?

Write results to a local `CS5-ERR5-RETEST-RESULTS.md` in `testing-tools/`. **Do not edit the Confluence
QA docs** — JJ pushes those. Flag clearly if any variant is **BLOCKED (tooling)** rather than pass/fail.

---

## 7. Two side-findings from the script read — confirm or refute these too

**(a) `--missing-option-code` is mislabelled, and invites a false pass on BUSY-1115 TC7.**

The flag sets `ITEM_CODE=""` and the script tells the operator this "tests the eligibility-skip path
(INFO, no emit, not an error)". Both halves are wrong for bus-injection:

- The eligibility skip is a **poller-side** behaviour — the poller declines to build a record for an
  option with no `productOptionCode`. Bus-injection **bypasses the poller entirely** (the script's own
  header says so). This flag therefore *cannot* exercise TC7 / PW6, which remain correctly NOT RUN.
- "Not an error" contradicts **ERR1**, which empirically records that a blank `item_code` reaching the
  sender **crashes** it (uncaught throw → bisection → DLQ). The script's note and the recorded defect
  cannot both be right, and ERR1 has the evidence.

Fix the script's usage text and runtime note. Anyone running this flag and reading its output at face
value would record TC7 as covered when it categorically is not.

**(b) The "no `DefaultedField weight` metric" observation may be a harness artefact — verify before
asking dev.**

`missing_fields` is built (lines 148–153) over `dimension_uom`, `qty_uom`, `height`, `length`, `width`,
`conversion_rate` — **`weight` is not in that list.** So a synthetic record injected with `--weight 0`
never declares weight as missing.

If the sender's default-and-report is driven by `missing_fields` (as the LLD states), then for the
**synthetic** half of BUSY-1115 TC5's evidence (`QA-TEST-NOWEIGHT-1`) the absent metric is explained by
the *injector*, not by sender design. The **real** half (product 31679, `weight=0`) came through the
poller, which builds its own `missing_fields`, so that observation stands on its own.

TC5 is currently PARTIAL partly on this question, flagged "confirm with dev". **Check which observation
that conclusion actually rested on before raising it** — if it leaned on the synthetic record, the
question for dev is a different and narrower one, and the harness needs `weight` added to the
`missing_fields` loop.

---

## 8. What NOT to conclude

- A quiet cycle is **not** a failure — empty cycles are the norm on this poller.
- Manhattan always returns **HTTP 200** regardless of outcome. Judge success from the `item-sender`
  log line / `rejectedTransactions`, never the HTTP status.
- Absence from the DLQ is **not** proof the test didn't run — for variants 1–3 it's the expected result
  and the whole point. Distinguish "vanished as predicted" from "never injected" using the dry-run
  output plus the populator log.
- Do not extrapolate to the poller-side eligibility skip (BUSY-1115 TC7 / BUSY-1116 PW6). See §7(a) —
  the tooling actively invites this error.
