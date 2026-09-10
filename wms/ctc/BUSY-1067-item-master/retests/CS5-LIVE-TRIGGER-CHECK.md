> **✅ ACTIVE — folded into `CTC-FIX-RETEST-BRIEF.md` as Group F on 2026-08-13 (JJ's call).**
> This check was written 08-10 and never run. It now runs as part of that pass, and **runs first** —
> before any injection, so §6's historical count isn't contaminated by this session's own
> deliberate populator throws.
>
> **Two changes to what's written below:**
> - **Results go in `CTC-FIX-RETEST-RESULTS.md`** under a clearly-headed Group F section, not in a
>   separate `CS5-LIVE-TRIGGER-RESULTS.md` (§7's instruction is superseded — one file for the pass).
> - The rest of that pass is **bus-injection only**, so the **one Cin7 request in §5 is the only
>   Cin7 call permitted all session.** Don't spend a second one.
>
> Everything else here stands — this file remains the full method and reasoning; the brief's §8b is
> the short form.

# Check brief — is the CS5 whitespace defect live, or only ever ours?

**For:** the IDE agent working in `~/Desktop/testing-tools/`
**Raised by:** JJ (QA) · **Date:** 2026-08-10
**Tickets:** BUSY-1115 (CS5) · BUSY-1116 (ERR5) · BUSY-1117 (alarm scope)
**Stage:** `staging` · **Region:** `ap-southeast-2`
**Size:** two checks. One free, one costs a single Cin7 request. Should take minutes, not a session.

---

## 1. The question

CS5 — whitespace in `item_code` destroys the record with no trace anywhere — has **only ever been
reproduced by our own bus-injection** (`QA-CS5-WS` on 08-07; variants 1–3 on 08-10). No live trigger
has been confirmed. Before this goes in Jira we need to know which ticket it is:

> *"QA synthesised an input Cin7 would never send"* — or — *"this has already silently eaten a real
> record and nobody noticed."*

Those are very different priorities and the current evidence does not distinguish them.

## 2. Why the existing "no live trigger" conclusion is suspect

The 08-07 session **did** look for one. It recalled product **29942** ("Artisan Suiting Set") whose
display `code` field showed padding — `'WTW23-922G  -XS'` — re-fetched it, found
`productOptionCode` clean (`'WTW23-922G'`), and recorded:

> *"`item_code` as actually used by the poller wasn't affected in this instance."*

**That conclusion assumes `item_code` = `productOptionCode`. It does not.** The BUSY-1114 TC3
correction — which landed *after* that check — established that `item_code` is the **size-suffixed**
code (`productOptions.code` / `productOptionSizeCode`, e.g. `SMU23-135A-M`).

`'WTW23-922G  -XS'` is exactly that shape: base code, padding, size suffix. So the reassurance was
measured against the bare field, not the one that actually becomes `item_code`. If
`productOptions.code` on 29942 really carries that value, it is a **live record with an interior
double space** — precisely the variant a trim does not fix.

## 3. Guardrails

1. **Check 1 is free. Check 2 costs exactly one Cin7 request.** Nothing else here may spend Cin7 budget.
2. **Do NOT write the watermark.** Do not run `cin7-watermark.sh` or `preview-cin7-sync.sh`.
3. **Do NOT purge the buffer DLQ.** It holds three inert evidence messages from the 08-10 session
   (`fc37d02c…` blank item_code, `0e7bbc03…` ERR2, `fed32265…` ERR4). JJ's call when they go.
4. **GET-only against Cin7, always.**

## 4. Check 1 — the logs (zero cost, do this first)

Poller/populator/sender log retention is **"None" (never expire)**, so the full history is on disk.

```bash
QID=$(aws logs start-query \
  --profile staging --region ap-southeast-2 \
  --log-group-names \
    /aws/lambda/staging-catalog-cin7-cin7-item-poller \
    /aws/lambda/staging-catalog-manhattan-item-buffer-buffer-populator \
    /aws/lambda/staging-catalog-manhattan-item-sender \
  --start-time $(date -v-90d +%s) --end-time $(date +%s) \
  --query-string 'fields @timestamp, @logStream, @message
                  | filter @message like /WTW23-922G/
                  | sort @timestamp asc
                  | limit 200' \
  --query queryId --output text)

sleep 8
aws logs get-query-results --query-id "$QID" --profile staging --region ap-southeast-2
```

90 days is arbitrary — **widen it if nothing comes back.**

| What you find | Verdict |
|---|---|
| Poller emitted it · populator logged the `InvalidParameterValue … MessageGroupId` throw · sender **silent** | **LIVE TRIGGER CONFIRMED.** The defect has already destroyed a real record. |
| Poller emitted it · sender **accepted** it | Code was clean at emit time. Padding lives in some other Cin7 field and never reached `item_code`. Defect stays theoretical. |
| Nothing at all | Inconclusive — 29942 never came through a poll window in range. Fall through to Check 2. |

## 5. Check 2 — Cin7 (one request)

```bash
./find-cin7-product-by-id.sh --id 29942
```

Read **`productOptions[].code`** — **not** `productOptionCode`. That is the whole point of this check.

Report the literal value wrapped in delimiters so whitespace is visible, e.g. `[WTW23-922G  -XS]`.
Also note: how many of its options carry padding, and whether the padding is **interior**,
leading/trailing, or both. Interior is the finding that matters — it defeats a trim-only fix.

## 6. If a live trigger IS confirmed

Don't stop at 29942 — the question becomes *how widespread*. Cheapest next step is still **zero Cin7
cost**: re-run the Check 1 query against the populator log group alone, over the widest window, with

```
| filter @message like /MessageGroupId/
```

That yields a count of genuinely lost records and their distinct `item_code`s. **Report the count and
the codes; do not attempt to recover or re-send any of them** — that is a separate decision for JJ.

## 7. What to report

Write results to **`CS5-LIVE-TRIGGER-RESULTS.md`** in this folder. **Do not edit the Confluence QA
docs — JJ pushes those.**

State plainly:

1. Which of the three Check 1 outcomes landed, with the verbatim log lines.
2. The literal `productOptions[].code` value(s) from Check 2, delimiters included.
3. **The verdict in one line: is CS5 raised as theoretical, or as live?**
4. If live: the record count and distinct codes from §6.

Flag clearly if either check is **BLOCKED** rather than guessing.
