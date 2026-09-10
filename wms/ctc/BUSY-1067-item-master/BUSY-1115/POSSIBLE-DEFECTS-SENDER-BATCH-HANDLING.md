# Findings — sender behaviour when one record in a batch is invalid

**Status: FINDINGS ONLY. QA is not raising a Jira ticket.** For the project team to decide on.
**Prepared:** 2026-08-18 · **From:** JJ (QA) · **Rewritten clean** after Plan D Runs 1 and 2 answered the
two questions this document was originally built around.

**Evidence:** `MODEA-BATCH-CONTAINMENT-RESULTS.md` (Plan D, the decisive one) · `CTC-FIX-RETEST-RESULTS.md` ·
`CTC-FINAL-QA-PASS-RESULTS.md` · `BUSY-1115-CLOSEOUT-RESULTS.md`

---

## What we set out to check, and what we found

Two concerns were raised. **Both are now closed by measurement.**

| Concern | Verdict |
|---|---|
| One invalid record aborts the batch — **are valid updates lost or blocked?** | ✅ **No.** 20 of 20 valid records delivered, `rejected=0`, only the bad one isolated |
| The buffer is shared with UNI/PS — **can a CTC error block UNI item sync?** | ✅ **No.** 5 of 5 UNI records delivered from the same batch as a CTC poison |

**Worst-case cost to a valid record sharing a batch with a bad one: one buffer cycle (~3 minutes) plus a
few seconds.** Measured 36s and 77s in two runs — the difference is purely where in the 3-minute polling
cycle the records were sent, not batch size or failure type.

**Nothing is lost. Nothing is blocked. No cross-tenant impact.**

---

## 1. Plain-language summary — for the project team

### The behaviour

When one item in the CTC feed has a bad field value, the process that sends items to the warehouse system
does stop working on the whole group it was sending. **But it recovers automatically and quickly.**

A layer above the sender repeatedly splits the group in half to find the offending item — we measured it
going 21 items → 10 and 11 → 5 and 5 → 2 and 3 → 1 and 1, landing exactly on the single bad record. Every
good item was then delivered normally.

**Measured twice:**

- **20 valid items** sent alongside one bad one — **all 20 delivered**, within 36 seconds.
- **5 valid UNI items** (a different business unit sharing the same pipeline) sent alongside a bad CTC
  item — **all 5 delivered**, within 77 seconds. **A CTC data error cannot block UNI warehouse updates.**

The bad item itself keeps retrying for about 30 minutes and is then parked in a holding queue, with its
content fully intact.

### What this means

**This is working acceptably.** No data is lost, no valid update is blocked, and the delay is seconds to
a few minutes rather than the 30-minute retry cycle we initially feared. The cross-tenant risk — a CTC
problem affecting another business unit's stock data — does not exist.

### The two things still worth a decision

1. **Nothing notifies anyone when an item lands in the holding queue.** The alert channel has no
   subscribers in staging, so a bad item would sit there until someone happened to look. **This is the
   more pressing gap of the two**, and it's cheap to fix.
2. **One field has no data-type check in front of it** (weight). It fails in a messier way than the
   others — no clear reason is recorded when it happens. Worth confirming that's known and accepted.

### What we'd suggest

**Treat the batch behaviour as acceptable and move on.** If anyone wants it improved, the ask would be
"skip the one bad record instead of restarting the group" — a small efficiency gain, not a fix for a
problem. **The holding-queue notification gap is the item actually worth acting on.**

---

## 2. Questions for dev — only two remain

The batch-abort question is answered and no longer needs asking.

**1. `weight` has no data-type guard — assuming that's known/fine, just flagging it.**
A non-numeric weight isn't caught by `validateItemDownload` at all, so no validation reason is logged. It
fails deeper as `TypeError: value.toFixed is not a function` in `roundToSchemaPrecision`, called from
`mapToItemDownload`. Unlike the other four triggers there's no check in front of it, which reads as an
oversight rather than a decision. **Behaviourally it's contained the same way** (the bisection is
content-agnostic), so this is about diagnosability, not risk — a failure with no logged reason is harder
to explain when someone finds it in the holding queue.

**2. What's the intended handling for records that reach the DLQ?**
A failing record lands in `staging-catalog-manhattan-item-buffer-dlq.fifo` after 10 retries with its body
intact. Is there an intended recovery route — manual re-drive, fix-and-resend — or are these expected to
be investigated and dropped? Asking because **nothing currently notifies anyone when one arrives**, so in
practice a record sits there unnoticed. We'd like to tell the warehouse team what to do when it happens.

**Worth mentioning as information, not a question:** the sender has no per-record containment — its
`.map()` over the batch has no try/catch, so it dies on the first bad element (measured: 113ms, stack
trace `validateItemDownload` `index.js:14863` → `Array.map` `14902` → `Runtime.handler` `14887`). That's
real, but the buffer-handler's `processWithBisect` absorbs it entirely. **Both halves are true and we'd
rather state them together than sound like we're reporting a fault.**

---

## Technical detail

### The five triggers

| # | Input | Where it fails | Signature |
|---|---|---|---|
| 1 | Missing `item_code` | `validateItemDownload`, named check | `reason:"missing_item_code"` → uncaught throw |
| 2 | Blank `desc` | `validateItemDownload`, named check | `reason:"missing_desc"` → uncaught throw |
| 3 | Non-numeric `weight` | `roundToSchemaPrecision`, **no upstream guard** | `TypeError: value.toFixed is not a function` |
| 4 | `Size` > 25 chars | `validateItemDownload`, named check | `reason:"size_too_long"` → uncaught throw |
| 5 | `item_code` > 50 chars | `validateItemDownload`, named check | `reason:"item_code_too_long"` → uncaught throw |

Two of these (4 and 5) error **by design** — erroring rather than truncating was a deliberate dev choice
for values considered important enough that failing loudly is preferable.

### The recovery mechanism — previously mis-attributed everywhere

Isolation is **not** the sender's. `staging-catalog-manhattan-item-buffer-buffer-handler` wraps every
sender call in `processWithBisect` and **recursively halves the batch on any failure**, logging
`"Poison pill identified"` when it reaches a single bad record.

It is **content-agnostic** (an uncaught throw and a Manhattan rejection are handled identically) and
**tenant-agnostic** (a CTC poison does not affect UNI records in the same batch). Both properties measured.

```
Run 1 — 21 records, 1 poison + 20 CTC controls
21 → FAIL
├─ 10 → FAIL
│  ├─ 5 → FAIL
│  │  ├─ 2 → FAIL
│  │  │  ├─ 1 (POISON) → "Poison pill identified"
│  │  │  └─ 1 → accepted=1  ✅
│  │  └─ 3 → accepted=3  ✅
│  └─ 5 → accepted=5  ✅
└─ 11 → accepted=11  ✅          20/20 delivered, rejected=0 throughout

Run 2 — 6 records, 1 CTC poison + 5 UNI controls (numeric codes 9100001-9100005)
6 → FAIL   (ManhattanBatch received=6 coalesced=6 — batch is NOT company-scoped)
├─ 3 → FAIL
│  ├─ 1 (POISON) → "Poison pill identified"
│  └─ 2 → accepted=2  ✅
└─ 3 → accepted=3  ✅            5/5 UNI delivered, no UNI message ever reached the DLQ
```

### Latency

| Run | Batch | Valid records delivered | Latency |
|---|---|---|---|
| 1 | 21 (1 poison + 20 CTC) | **20 / 20** | ~14–36s |
| 2 | 6 (1 CTC poison + 5 UNI) | **5 / 5** | ~77s |

**The difference is where in the buffer-handler's 3-minute polling cycle the records were sent, not batch
size or failure type.** Run 1's sends landed ~5s before a cycle boundary; Run 2's ~65s before one. So:
**worst case is one buffer cycle (~3 min) plus a few seconds of bisection.**

### The bad record's fate

Retries exactly 10× at the 3-minute cadence (~30 min), then SQS's own redrive policy
(`maxReceiveCount: 10`) moves it to the DLQ. Body byte-for-byte intact; same `MessageId` as the original
populator push, so it's the same message rather than a copy.

### Field length limits, all QA-measured exactly

`Desc` 100 (truncates silently) · `Colour` 25 (truncates silently) · `Size` 25 (errors) · `item_code` 50
(errors). **Not uniform — two truncate, two error.** LLD §5 has no length column; these belong in it.

### Manhattan response constraint

Manhattan reports counts only (`accepted:N, rejected:N`) and never identifies *which* item failed — which
is why isolation requires the bisection rather than reading the response.

---

## Provenance

This document was rewritten on 2026-08-18 after Plan D. Earlier revisions framed the batch behaviour as an
open question because all five triggers had only ever been tested **one record at a time**, three minutes
apart — a precaution written into an earlier test brief and never revisited. Plan D closed it. The
cross-tenant question was added, then closed, the same day.
