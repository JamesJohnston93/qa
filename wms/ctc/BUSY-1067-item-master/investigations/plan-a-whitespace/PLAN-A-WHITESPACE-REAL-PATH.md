# Plan A — whitespace `item_code` on the real poller path

> ## ✅ COMPLETE 2026-08-18 — HARNESS ARTEFACT. NO TICKET. Residual scanned and closed.
>
> **Results: `CTC-WHITESPACE-REAL-PATH-RESULTS.md`.** Tiers A2 and A3 were never needed and must not be run.
>
> **Two passes settled it.** (a) Plan C check 6: all six of product 29942's options exist in SCALE **with
> the interior double space intact**, so the records travelled the real poller path end to end. (b) The
> residual scan: a GET-only full-account sweep (24,641 products / 137,114 options / 95,506 poller-eligible,
> ~99 requests) found only **71 option rows with whitespace in the bare `productOptionCode`** — 47
> poller-eligible, 13 products, all interior.
>
> ### ⚠ The mechanism stated in the body below is WRONG. Do not reason from it.
>
> This plan claimed the group id is *"assembled from separate clean fields, `{company}#{productOptionCode}_{size}`"*.
> **Falsified by direct Cin7 data:** 29942 reads `productOptionCode='WTW23-922G'`, `code='WTW23-922G  -S'`,
> **`size='S'`** — not `'-S'`. That construction predicts `CTC#WTW23-922G_S`, which is **not** what the logs show.
>
> **Correct mechanism: the poller collapses each whitespace run in `item_code` to a single underscore** —
> `{company}#re.sub(r"\s+","_",code)`. Reproduces the observed `CTC#WTW23-922G_-S` exactly, and explains
> two spaces → one underscore. **MEASURED** for the field values, **INFERRED** for the transform.
>
> **The correction inverts the residual in our favour.** The old theory made bare-`productOptionCode`
> whitespace the one dangerous shape. The correct theory means **whitespace is sanitised wherever it
> appears in `item_code`**, so all 13 products are handled exactly as 29942 was. **No reachable path.**
>
> **Still on record (low severity):** the populator has no containment for a raw-whitespace group id and
> swallows the exception at INFO. Nothing reaches it today. A future producer that raw-concats would lose
> records silently.
>
> **Optional free upgrade:** grep retained poller logs for any of the 13 codes and read the literal
> `message_group_id` — one hit turns the transform INFERRED → MEASURED. Or just ask Kian.
>
> **Also surfaced, unrelated:** products **30706 / 30707** (`NUSMU23-101A - MTEST` / `- WTEST`) appear to be
> **test products in Cin7 PRODUCTION, Public + Primary — poller-eligible and shipping to SCALE.** Flag it.
>
> Everything below is the original plan, retained as the record of how the question was framed.

---

**Question:** does the deployed poller sanitise `message_group_id`, or does raw whitespace reach the buffer-populator in production?
**Why it matters:** this is the only thing deciding whether the whitespace record-loss (CS5 / ERR5) is a **live production defect** or a **harness artefact of bus injection**. Don't write the ticket until this is answered.
**Owner:** JJ (QA) · **Drafted:** 2026-08-18 · **Status:** NOT RUN

**Read first:** `claude/CTC QA — current state & results index`

---

## What we already know (measured, don't re-derive)

- **Bus injection kills it every time.** All five shapes (interior space, leading, trailing, tab, whitespace-only) throw `InvalidParameterValue … MessageGroupId can only include alphanumeric and punctuation characters` in the buffer-populator, **upstream of the SQS queue**, and vanish — no buffer, no sender, no DLQ, no SCALE.
- **The populator swallows it.** Exception caught and logged at **INFO**; invocation completes normally. Measured `Invocations: 407`, `Errors: 0`. So a `DeadLetterConfig` alone would never fire and an alarm on populator `Errors` sees nothing.
- **But the real poller looks different.** Cin7 product **29942**'s six options (`WTW23-922G  -XS/S/M/L/XL/XXL`) genuinely carry an interior double-space in `productOptions[].code`. The poller's own 2026-08-06 logs show `message_group_id = CTC#WTW23-922G_-S` — an **underscore** where raw `{company}#{item_code}` concatenation would put the space — while `item_code` itself kept the raw padding. Those six records **traversed the whole pipeline successfully**: 63 log lines, one cycle, zero `InvalidParameterValue` in a 90-day, 3-log-group query.
- **The catch:** that evidence is dated **2026-08-06, six days before the 08-12 poller redeploy.** So the underscore is *pre-existing* behaviour, not Kian's fix, and we don't know whether it generalises across leading / trailing / tab / whitespace-only shapes.

**The gap this plan closes: post-deploy evidence, on a real live-shaped product.**

---

## Run in tiers, cheapest first. Stop as soon as the answer is unambiguous.

### Tier A1 — free, no writes, no rewind

1. **SCALE staging item check** (folded into Plan C, item 6). If an item exists in SCALE with an **underscore** in the code (`WTW23-922G_-S` or similar), that is direct confirmation the poller substituted and the record landed. If instead an item exists with a literal space or double-space in the code, the poller passed the raw value through and something downstream accepted it — a different and more interesting answer.
2. **Re-confirm the 08-06 log evidence** and extract the `message_group_id` for **all six** of 29942's options, not just `-S`. If the substitution pattern differs between sizes (e.g. `-XS` vs `-S`), that tells us whether it's a deliberate sanitiser or an artefact of how the size suffix is built.
3. **Search the full retained poller history for any `message_group_id` containing a literal space.** Zero hits across ~41 days would mean the raw-concat path has never been exercised in production by the real poller.

**A1 may be enough.** If SCALE has the underscore item and no logged `message_group_id` ever contains a space, the honest verdict is: **the poller sanitises, the populator's raw-concat fragility is real but unreachable from the poller, and CS5 closes as a harness artefact with a note that the populator remains fragile for any future producer.**

### Tier A2 — deep rewind, still no writes. The decisive test if A1 is inconclusive.

**This was previously ruled out and the reason was wrong.** The old blocker was "29942 (modified 2026-08-06T01:25:12Z) is outside the 6-hour rewind cap" — but that cap existed because a 6-hour window was believed to cost ~4,949 requests. **Measured reality: a 6h07m rewind cost 15 requests.** Kian's 7-day reset was 90 requests for 17,886 records. So a rewind reaching 08-06 is roughly **12 days ≈ 150–200 requests**, comfortably inside the 5,000/day shared cap.

**Method**

1. `preview-cin7-sync.sh --since 2026-08-06T01:00:00.000Z` **first** — GET-only, mandatory. Record the would-emit count and page/chunk counts, and sanity-check the request estimate against the C5 model (cost tracks pages and id-chunks, not records) before committing.
2. Confirm 29942's six options appear in the preview output with their raw padded codes.
3. Snapshot the watermark, then `--set 2026-08-06T01:00:00.000Z --confirm`. Confirm with a direct `get-parameter`; **do not re-write impatiently** — SSM lag is variable in both directions (once 11 cycles / ~33 min, once 1 cycle / ~1m39s).
4. Tail poller, **populator** and sender. For each of 29942's six options capture: the raw `item_code` on the emitted record, the literal `message_group_id` on the wire, whether the populator threw, and whether the sender accepted.
5. Let it converge, then `--unset --confirm`, `check-status.sh` back to 0/0, and record DLQ depth against the 19 baseline.

**Cost and blast radius, stated honestly:** ~12 days of churn re-emitted, so expect **tens of thousands of records** and a long buffer drain across many cycles — far larger than Phase 2's 2,270. Same class of operation as the proven reset, non-destructive, idempotent at SCALE, and fully reversible by `--unset`. **Coordinate before starting** — the pipeline is shared with UNI/PO/SO. Consider running it outside business hours.

**Decision rule**

| Observed on the real poller path, post-deploy | Verdict |
|---|---|
| `message_group_id` sanitised (underscore/trim), record reaches the sender | **CS5/ERR5 = harness artefact.** Close it. Raise a **low-severity note** that the populator has no containment for a raw-whitespace group id, so any future producer bypassing the poller's sanitiser would hit it silently |
| `message_group_id` carries raw whitespace and the record vanishes | **CS5/ERR5 = confirmed live production defect.** Raise it, severity high — silent data loss with no DLQ and no `Errors` signal |
| Sanitised for some shapes but not others | **Partial defect.** Document exactly which shapes survive; the ticket scopes to the unsanitised ones |

### Tier A3 — author the shapes on a production test product. Last resort only.

**Only if A1 and A2 are both inconclusive, and only with explicit sign-off, because this changes real production Cin7 data.**

⚠ **Read this before touching it.** The four editable products are in Cin7 **production**. Changing an option **code** there is not a QA-sandbox action — it can break links to existing stock, orders and history inside Cin7 itself, independently of anything our pipeline does. **Confirm with whoever owns CTC merchandising that the chosen burner product is genuinely disposable before editing a code on it.** The write-access plan's containment rules apply in full (`claude/Cin7 write access — expanded coverage plan`, §1–§3): hard-coded allowlist of four ids, read-modify-write, snapshot first via W1, `--confirm` on every write, and every minted code recorded in `cin7-codes-register.md`.

**Method:** on the **P3 burner only**, author one shape at a time — interior space, leading, trailing, tab, whitespace-only — each followed by a tight watermark floor and one cycle. Capture the same four observables as A2. **Restore the original option code from the W1 snapshot immediately after each shape**, and prove the restore with a GET. Expect each new code to mint a **new, permanently orphaned SCALE staging item** — that is accepted and is why this is P3-only.

---

## Deliverable

`CTC-WHITESPACE-REAL-PATH-RESULTS.md` in `testing-tools/`. One section per tier actually run. Every claim tagged **MEASURED / INFERRED / UNKNOWN**, with the literal `message_group_id` log lines quoted rather than paraphrased. Close with the decision-rule verdict and, if it's a live defect, a drafted ticket body.

Then update `claude/CTC QA — current state & results index` open item 4.

---

## Kick-off prompt (fresh session)

```
Read the project doc "Plan A — whitespace item_code on the real poller path" and CLAUDE.md in
~/Desktop/testing-tools. Run TIER A1 ONLY and stop there — read-only, zero Cin7 API calls, no
watermark writes, no config changes. Do not start A2 or A3.

The question: does the deployed poller sanitise message_group_id, or does raw whitespace from a Cin7
option code reach the buffer-populator? This decides whether the whitespace record-loss is a live
production defect or an artefact of my bus-injection harness, so it decides whether a ticket gets
written at all.

A1 tasks, all from retained CloudWatch logs (retention is never-expire, so this is free):
1. Extract the message_group_id the real poller produced for ALL SIX options of Cin7 product 29942
   (WTW23-922G  -XS/S/M/L/XL/XXL) from the 2026-08-06 cycle. Quote the literal log lines. Note
   whether the substitution pattern is identical across all six sizes or varies.
2. Search the FULL retained poller history for any message_group_id containing a literal space
   character. Report the count and quote any hits.
3. Also capture, for those six records, the raw item_code on the emitted record alongside the
   message_group_id - the 08-06 evidence suggests item_code keeps the padding while the group id
   does not, and I want that confirmed rather than assumed.

Write CTC-WHITESPACE-REAL-PATH-RESULTS.md with an A1 section only. Tag every claim MEASURED /
INFERRED / UNKNOWN. Then state plainly whether A1 settles the question or whether Tier A2 (a deep
rewind to before 2026-08-06) is needed, and say why. Do not run A2.
```
