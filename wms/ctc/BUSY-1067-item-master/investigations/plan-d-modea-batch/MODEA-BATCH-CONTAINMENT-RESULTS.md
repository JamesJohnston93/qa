# Mode A batch-containment results (Plan D)

**Plan:** `PLAN-D-MODEA-BATCH-CONTAINMENT.md` (Rev 2) · **Run sheet:** `PLAN-D-RUNSHEET.md` Run 1 / T1
**Executed:** 2026-08-18 · **Scope this session: TIER 1 ONLY** (JJ's instruction — Runs 2–5 not run)
**Stage/profile:** staging

---

## Headline result

**T1 — 1 over-length-`Size` poison + 20 valid controls, one buffer flush.**

**DLQ gained only the poison. All 20 valid controls were delivered.** MEASURED.

The batch-abort concern in `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` is closed: an uncaught
`validateItemDownload` throw does **not** destroy co-batched valid records. A layer neither planning
doc knew about — the buffer-handler's own recursive bisection — isolates the poison the same way Mode
B isolation was already known to work, and it is **content-agnostic**: it doesn't matter whether the
failure is a Manhattan rejection (Mode B) or an uncaught throw (Mode A), the wrapper around the sender
call bisects on *any* failure.

This also corrects an architectural assumption in both planning docs: the per-record isolation was
attributed to the sender. It is not. **The sender's own `.map()` over a received batch has no per-item
try/catch — a single throw aborts that whole call, validating nothing after the failing item.**
Isolation happens **one layer up**, in `staging-catalog-manhattan-item-buffer-buffer-handler`, which
wraps every call to the sender in `processWithBisect` and retries recursively on any failure.

---

## Pre-flight (read-only)

Ran `check-status.sh --stage staging --profile staging`, then confirmed the two load-bearing values
directly rather than trusting script output:

| Check | Result | Method |
|---|---|---|
| Buffer queue (`...-item-buffer-buffer.fifo`) | **0 waiting, 0 in-flight** | check-status.sh + direct `get-queue-attributes` |
| Buffer DLQ (`...-item-buffer-dlq.fifo`) | **0 waiting, 0 in-flight** — MEASURED, not assumed. This is a change from the `19` recorded in CLAUDE.md as of 2026-08-14; something drained it between then and now (out of scope to investigate here, noted for the record). | direct `get-queue-attributes` |
| Watermark | `UNSET`, version **188** — unchanged from CLAUDE.md's last-recorded value | `aws ssm get-parameter --name /catalog/cin7-manhattan/item-watermark/staging` |
| Sender LastModified | `2026-08-12T22:46:32.000+0000` — unchanged from CLAUDE.md, confirms no redeploy since prior Mode A/B testing | `aws lambda get-function --function-name staging-catalog-manhattan-item-sender` |

All MEASURED.

---

## Injection

Used `emit-cin7-record.sh`, dry-run first (verified shape), then `--confirm` real sends. Single shared
timestamp tag `20260818T062710Z` for all 21 records so they're grep-able as one run.

- **Poison:** `QA-D-T1-POISON-20260818T062710Z`, `--size` = 30 chars (`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`; limit is 25)
- **Controls:** `QA-D-T1-CTRL01-20260818T062710Z` … `QA-D-T1-CTRL20-20260818T062710Z`, all default-valid

**Send window: 06:27:27–06:27:53 UTC (26 seconds)**, poison sent first, controls 01→20 in order
immediately after. All 21 `PutEvents` calls returned `FailedEntryCount: 0` (MEASURED — grepped every
send log line for `Event sent successfully` / `PutEvents reported a failure`; got 21/21 successes,
0 failures).

---

## Coalescing check

Buffer-handler polls `staging-catalog-manhattan-item-buffer-buffer.fifo` on its own strict **3-minute
schedule** (confirmed: invocations at 06:15:29, 06:18:29, 06:21:29, 06:24:29, 06:27:29 — exactly 180s
apart). The 06:27:29 cycle polled 22 times internally (`[Poll #22] No messages returned, stopping
polling`) accumulating messages before triggering the processor:

```
2026-08-18T06:27:58.586Z  INFO  [Poll #22] No messages returned, stopping polling.
2026-08-18T06:27:58.586Z  INFO  Triggering processor with 21 messages, total payload size: 11908 bytes
```

**All 21 records (1 poison + 20 controls) coalesced into ONE processing call. MEASURED.** No split —
the run is valid per the plan's own validity check.

---

## The discriminator — confirmed Mode A, not Mode B

First processing attempt, full batch of 21, RequestId `b2263fd4-c0f6-4710-a751-61c687a74eac`:

```
{"metric":"ManhattanBatch","received":21,"coalesced":21}
{"metric":"ManhattanSenderValidationFailure","company":"CTC","item_code":"QA-D-T1-POISON-20260818T062710Z","reason":"size_too_long"}
ERROR Invoke Error {"errorType":"Error","errorMessage":"ItemDownload failed validation for record CTC#QA-D-T1-POISON-20260818T062710Z: size_too_long","stack":["Error: ItemDownload failed validation for record CTC#QA-D-T1-POISON-20260818T062710Z: size_too_long","    at validateItemDownload (/var/task/index.js:14863:11)","    at /var/task/index.js:14902:5","    at Array.map (<anonymous>)","    at Runtime.handler (/var/task/index.js:14887:27)", ...]}
```

- `ManhattanBatch received=21 coalesced=21` — present. MEASURED.
- Validation reason `size_too_long` — present. MEASURED.
- **No `ManhattanRequestOutcome`, no `accepted=`/`rejected=` line for this invocation** — confirmed. MEASURED.
- The throw is inside `Array.map` at `index.js:14902` — synchronous, uncaught, propagates straight out
  of `Runtime.handler`. Duration was **113ms** — consistent with dying on the very first array element
  (the poison, which was enqueued first) before validating anything else. MEASURED.

**This is Mode A, not Mode B, confirmed correctly** — no accidental Mode B reproduction.

---

## What actually isolates the poison: buffer-handler's recursive bisection

This is new information neither `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` nor
`PLAN-D-MODEA-BATCH-CONTAINMENT.md` had: the sender itself has **no** bisection or per-item recovery —
its `.map()` just throws once and stops. The recovery is implemented **one layer up**, in
`staging-catalog-manhattan-item-buffer-buffer-handler`, which invokes the sender and, on any failure
(Mode A throw or Mode B rejection alike — the code path doesn't appear to care which), **recursively
halves the batch and retries each half**. MEASURED from `--lambda buffer` logs:

```
2026-08-18T06:27:58.586Z INFO  Triggering processor with 21 messages, total payload size: 11908 bytes
2026-08-18T06:27:59.370Z INFO  Batch of 21 failed, bisecting...
2026-08-18T06:27:59.480Z INFO  Batch of 10 failed, bisecting...
2026-08-18T06:28:00.111Z INFO  Batch of 5 failed, bisecting...
2026-08-18T06:28:00.190Z INFO  Batch of 2 failed, bisecting...
2026-08-18T06:28:00.854Z ERROR Poison pill identified: { message_group_id: 'CTC#QA-D-T1-POISON-20260818T062710Z', ... }
2026-08-18T06:28:05.747Z INFO  Sent 21 messages to processor.
2026-08-18T06:28:05.808Z INFO  Deleted 20 messages from the queue.
```

**Bisection tree (MEASURED, reconstructed from RequestIds and `received=` counts in the sender log):**

```
21 (POISON + CTRL01-20)                                    → FAIL (poison at position 0)
├─ 10 (POISON + CTRL01-09)                                  → FAIL
│  ├─ 5 (POISON + CTRL01-04)                                → FAIL
│  │  ├─ 2 (POISON + CTRL01)                                → FAIL
│  │  │  ├─ 1 (POISON)                                      → FAIL — "Poison pill identified"
│  │  │  └─ 1 (CTRL01)                                      → accepted=1  ✅
│  │  └─ 3 (CTRL02, CTRL03, CTRL04)                         → accepted=3  ✅
│  └─ 5 (CTRL05-09)                                          → accepted=5  ✅
└─ 11 (CTRL10-20)                                            → accepted=11 ✅
```

3 + 5 + 1 + 11 = **20/20 controls delivered**, each confirmed by an explicit Manhattan response:

```
06:28:04.687Z  Manhattan ItemDownload response: accepted=3 rejected=0 message="ITEM XML Download  ended."
06:28:04.922Z  Manhattan ItemDownload response: accepted=5 rejected=0 message="ITEM XML Download  ended."
06:28:05.299Z  Manhattan ItemDownload response: accepted=1 rejected=0 message="ITEM XML Download  ended."
06:28:05.704Z  Manhattan ItemDownload response: accepted=11 rejected=0 message="ITEM XML Download  ended."
```

`rejected=0` in every successful sub-batch — none of the 20 controls were ever rejected by Manhattan.
MEASURED.

Buffer-handler's own summary line for the cycle confirms the outcome independently of the sender log:
`"Sent 21 messages to processor."` / `"Deleted 20 messages from the queue."` — 20 deleted (delivered),
1 retained (poison). MEASURED.

---

## Wall-clock delivery latency

All times UTC, 2026-08-18. "Sent" = the individual `emit-cin7-record.sh --confirm` call for that
record. "Delivered" = the `ManhattanItemsDelivered` / `accepted=` confirmation for the sub-batch
containing it.

| Record | Sent | Delivered (sub-batch) | Latency |
|---|---|---|---|
| POISON | 06:27:28 | never (DLQ, see below) | — |
| CTRL01 | 06:27:29 | 06:28:05.299 (accepted=1) | ~36s |
| CTRL02 | 06:27:30 | 06:28:04.687 (accepted=3) | ~35s |
| CTRL03 | 06:27:31 | 06:28:04.687 (accepted=3) | ~34s |
| CTRL04 | 06:27:33 | 06:28:04.687 (accepted=3) | ~32s |
| CTRL05 | 06:27:34 | 06:28:04.922 (accepted=5) | ~31s |
| CTRL06 | 06:27:35 | 06:28:04.922 (accepted=5) | ~30s |
| CTRL07 | 06:27:36 | 06:28:04.922 (accepted=5) | ~29s |
| CTRL08 | 06:27:37 | 06:28:04.922 (accepted=5) | ~28s |
| CTRL09 | 06:27:39 | 06:28:04.922 (accepted=5) | ~26s |
| CTRL10 | 06:27:40 | 06:28:05.704 (accepted=11) | ~26s |
| CTRL11 | 06:27:41 | 06:28:05.704 (accepted=11) | ~25s |
| CTRL12 | 06:27:42 | 06:28:05.704 (accepted=11) | ~24s |
| CTRL13 | 06:27:43 | 06:28:05.704 (accepted=11) | ~23s |
| CTRL14 | 06:27:45 | 06:28:05.704 (accepted=11) | ~21s |
| CTRL15 | 06:27:46 | 06:28:05.704 (accepted=11) | ~20s |
| CTRL16 | 06:27:47 | 06:28:05.704 (accepted=11) | ~19s |
| CTRL17 | 06:27:48 | 06:28:05.704 (accepted=11) | ~18s |
| CTRL18 | 06:27:49 | 06:28:05.704 (accepted=11) | ~17s |
| CTRL19 | 06:27:51 | 06:28:05.704 (accepted=11) | ~15s |
| CTRL20 | 06:27:52 | 06:28:05.704 (accepted=11) | ~14s |

**Every control delivered within 36 seconds of being sent, and all 20 within ~38 seconds of the buffer-
handler cycle starting.** MEASURED. This is comparable to (if not faster than) the previously-measured
Mode B isolation latencies (13–22s for a single poison + controls) — bisection recursion adds
negligible overhead at this batch size.

---

## Poison outcome — full retry-to-DLQ lifecycle

The poison was never deleted from the source queue by buffer-handler (it's the identified poison
pill each cycle), so it retried on the buffer-handler's normal 3-minute schedule until SQS's own
redrive policy (`maxReceiveCount: 10`, confirmed via `get-queue-attributes` on
`...-item-buffer-buffer.fifo`) moved it to the DLQ.

**Full retry history (MEASURED, one line per cycle, all show `Deleted 0 messages from the queue.`):**

| Attempt | Time (buffer-handler cycle start) |
|---|---|
| 1 (in the original 21-batch) | 06:27:29 |
| 2 | 06:30:29 |
| 3 | 06:33:29 |
| 4 | 06:36:29 |
| 5 | 06:39:29 |
| 6 | 06:42:29 |
| 7 | 06:45:29 |
| 8 | 06:48:29 |
| 9 | 06:51:30 |
| 10 | 06:54:29 |

Exactly 10 attempts, exactly 3 minutes apart (matches CLAUDE.md's documented ~30min/10-retry cadence).
At the next cycle (06:57:29) the source queue was empty —

```
2026-08-18T06:57:29.500Z  INFO  Polling messages from queue: .../staging-catalog-manhattan-item-buffer-buffer.fifo
2026-08-18T06:57:34.610Z  INFO  [Poll #1] No messages returned, stopping polling.
```

— because SQS had already redirected the message to the DLQ on its 11th delivery attempt, before
buffer-handler ever saw it. **DLQ depth went non-zero at 06:57:42 UTC** (measured by a 15s-interval
poll: `0` at 06:57:26, `1` at 06:57:42).

**Non-destructive peek of the DLQ (5s visibility timeout, nothing deleted):**

```json
{
  "MessageId": "a6f1e6b2-5e5b-4fc8-b241-2fe9e8708f41",
  "Body": "{\"message_group_id\":\"CTC#QA-D-T1-POISON-20260818T062710Z\",...\"size\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\",...}",
  "Attributes": {
    "ApproximateReceiveCount": "11",
    "SentTimestamp": "1787034450724",
    "MessageGroupId": "CTC#QA-D-T1-POISON-20260818T062710Z"
  }
}
```

- **`MessageId` matches the original populator push** (`a6f1e6b2-5e5b-4fc8-b241-2fe9e8708f41`, logged
  at 06:27:30 when the populator first pushed it to the source queue) — same message, not a copy.
- **Body byte-for-byte intact** — identical to the original injected detail. MEASURED.
- **`ApproximateReceiveCount: 11`** — 10 receives at the source queue + 1 from this non-destructive
  peek at the DLQ (SQS's receive counter is cumulative across queues after redrive). MEASURED.

---

## Final queue state vs baseline

| Queue | Baseline (pre-test) | Final | Delta |
|---|---|---|---|
| `...-item-buffer-buffer.fifo` | 0 waiting / 0 in-flight | 0 waiting / 0 in-flight | **0** |
| `...-item-buffer-dlq.fifo` | 0 waiting / 0 in-flight | **1 waiting** / 0 in-flight | **+1 (poison only)** |

**Attributed by `MessageGroupId`: the single DLQ addition is `CTC#QA-D-T1-POISON-20260818T062710Z`.**
No control message group ever reached the DLQ. MEASURED.

---

## Answering the plan's questions

1. **Do valid records in the same batch as a rejected one still get through?** **Yes — MEASURED.** All
   20/20 delivered, `rejected=0` throughout, within 36 seconds of being sent.
2. **What isolates them?** **Not the sender** (its `.map()` has no per-item recovery and dies on first
   throw) — **the buffer-handler's recursive bisection**, which is content-agnostic and applies to any
   batch failure, Mode A or Mode B alike. This is new information not in either planning doc.
3. **What happens to the bad record?** Retries exactly 10× over ~30 minutes (06:27:29 → 06:54:29, 3-min
   cadence), body byte-for-byte intact throughout, lands in the DLQ via SQS's own redrive policy
   (`maxReceiveCount: 10`) — matches CLAUDE.md's existing documented behaviour exactly.

**Net effect on the finding in `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`:** the open question the
whole document was framed around — "we can't currently say whether [valid records get held up or
dropped]" — is now answered: **they don't.** The batch-abort risk is closed. What remains genuinely
open from that document (unrelated to this test): the `weight` type-guard gap (Q2) and the DLQ
recovery-process question (Q3).

---

## Scope note — Runs 2–5 not executed

Per JJ's instruction this session, **only Tier 1 was run.** `PLAN-D-RUNSHEET.md` Run 1's own
sequencing rule says: *"If Run 1 comes back back DLQ +1 with controls delivered in seconds, Mode A
recovers like Mode B, the finding downgrades to 'delay only', and Runs 4/5 add little."* That is
exactly what happened here. Per the run sheet's guidance, **Run 2 (cross-tenant) is still worth doing
independently** — it asks a different question (does a CTC poison block UNI records specifically,
given the batch is not company-scoped) that this run doesn't touch, since no UNI records were injected
here. Runs 3 and 5 add comparatively little given this result.

**No SCALE UI lookup is needed from JJ for this run** — none of the 20 controls needed manual
verification beyond the sender's own `accepted=`/`rejected=` confirmation, since the question was
about batch survival, not field mapping.

---

## Tags summary

Every load-bearing claim above is tagged MEASURED, sourced from either direct AWS CLI queries
(SSM, Lambda config, SQS attributes) or verbatim CloudWatch log lines quoted in place. No claim in
this document is INFERRED or UNKNOWN — this run answered its question directly.

---
---

# Run 2 — cross-tenant: does a CTC poison block UNI records?

**Plan:** `PLAN-D-MODEA-BATCH-CONTAINMENT.md` T4 · **Run sheet:** `PLAN-D-RUNSHEET.md` Run 2
**Executed:** 2026-08-18, immediately following Run 1 · **Stage/profile:** staging

## Headline verdict

**UNI records delivered normally. Blast radius is bounded — MEASURED.**

**5/5 UNI controls delivered, `rejected=0` throughout, within ~77 seconds of injection — inside the
SAME buffer-handler invocation that isolated the CTC poison.** No delay across an extra 3-minute
cycle, no DLQ landing for any UNI record. **The batch is confirmed NOT company-scoped** (all 6
records — 1 CTC poison + 5 UNI controls — coalesced into one `ManhattanBatch received=6` call), but
the buffer-handler's recursive bisection (already characterised in Run 1) is also
**tenant-agnostic**: it isolates the poison the same way regardless of which company's records
happen to be sitting next to it in the batch. **A CTC data-entry error cannot, on this evidence,
block or meaningfully delay UNI item sync** — it costs the UNI records nothing beyond the
bisection's own sub-second recursion.

This answers Q1 of `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md` for the cross-tenant case
specifically, and closes the second half of the batch-abort concern that Run 1 left open (Run 1
showed same-tenant controls survive; Run 2 shows a different tenant's controls survive too, even
though the coalesce key `(company, item_code)` does not scope the batch itself).

---

## Pre-flight (read-only)

| Check | Result | Method |
|---|---|---|
| Buffer queue | **0 waiting, 0 in-flight** | `check-status.sh` + direct `get-queue-attributes` |
| Buffer DLQ | **1 waiting, 0 in-flight** — MEASURED. This is the Run 1 poison (`QA-D-T1-POISON-20260818T062710Z`), landed at 06:57:42Z per the Run 1 section above; not aged out yet (4-day retention). Confirmed via `check-status.sh` alarm list showing `send-dlq-depth: ALARM` (its `depth > 0` threshold, consistent with 1 message) | `check-status.sh` + direct `get-queue-attributes` |
| Watermark | `UNSET`, version **188** — unchanged | `aws ssm get-parameter --name /catalog/cin7-manhattan/item-watermark/staging` |

All MEASURED. Baseline for this run's own DLQ delta is **1** (the pre-existing Run 1 poison), not 0.

---

## ⚠ Critical setup — UNI item codes verified numeric before sending

Per BUSY-1113, sender validation is per-company: UNI requires numeric `item_code`, CTC requires a
non-empty product option code. Dry-run output was checked for all 5 UNI controls before any real
send:

```
UNI CTRL 9100001: "message_group_id": "UNI#9100001", "item_code": "9100001", "company": "UNI"
UNI CTRL 9100002: "message_group_id": "UNI#9100002", "item_code": "9100002", "company": "UNI"
UNI CTRL 9100003: "message_group_id": "UNI#9100003", "item_code": "9100003", "company": "UNI"
UNI CTRL 9100004: "message_group_id": "UNI#9100004", "item_code": "9100004", "company": "UNI"
UNI CTRL 9100005: "message_group_id": "UNI#9100005", "item_code": "9100005", "company": "UNI"
```

All five confirmed numeric before `--confirm`. MEASURED — no second poison introduced by accident.

---

## Injection

Used `emit-cin7-record.sh`, dry-run first, then `--confirm`. Poison timestamp tag
`20260818T070751Z`.

- **Poison:** `QA-D-R2-POISON-20260818T070751Z`, `--company CTC`, `--size` = 30 chars
  (`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`; limit 25)
- **UNI controls:** `--company UNI`, `--item-code 9100001`…`9100005`, otherwise fully default-valid

**Send window: 07:08:14–07:08:27 UTC (13 seconds)**, poison sent first, then UNI controls
9100001→9100005 in order. All 6 `PutEvents` calls returned `FailedEntryCount: 0` (MEASURED, from
each call's "Event sent successfully" confirmation).

| Record | Sent (UTC) |
|---|---|
| POISON (CTC) | 07:08:14 |
| 9100001 (UNI) | 07:08:22 |
| 9100002 (UNI) | 07:08:23 |
| 9100003 (UNI) | 07:08:24 |
| 9100004 (UNI) | 07:08:26 |
| 9100005 (UNI) | 07:08:27 |

---

## Coalescing check — confirmed cross-tenant, NOT company-scoped

Buffer-handler's next scheduled cycle (07:09:29, 3 minutes after the prior no-message cycle at
07:06:29) picked up all 6 messages together:

```
2026-08-18T07:09:29.670Z  INFO  Polling messages from queue: .../staging-catalog-manhattan-item-buffer-buffer.fifo
2026-08-18T07:09:34.872Z  INFO  [Poll #2] No messages returned, stopping polling.
2026-08-18T07:09:34.872Z  INFO  Triggering processor with 6 messages, total payload size: 3058 bytes
```

Sender's first attempt confirms it:

```
{"metric":"ManhattanBatch","received":6,"coalesced":6}
```

**1 CTC poison + 5 UNI controls coalesced into ONE processing call. MEASURED.** This directly
confirms the plan's premise: the batch is not company-scoped — a CTC record and UNI records sat in
the same invocation.

---

## The discriminator — confirmed Mode A on the full 6-batch

First attempt, `received=6`, RequestId `4cd56efd-0e69-44ba-ae11-02f2c0b5969d`, duration **108.92ms**:

```
{"metric":"ManhattanSenderValidationFailure","company":"CTC","item_code":"QA-D-R2-POISON-20260818T070751Z","reason":"size_too_long"}
ERROR Invoke Error {"errorType":"Error","errorMessage":"ItemDownload failed validation for record CTC#QA-D-R2-POISON-20260818T070751Z: size_too_long", ... "at Array.map (<anonymous>)","at Runtime.handler (/var/task/index.js:14887:27)" ...}
```

- `ManhattanBatch received=6 coalesced=6` — present. MEASURED.
- Validation reason `size_too_long` — present. MEASURED.
- **No `ManhattanRequestOutcome`, no `accepted=`/`rejected=` for this invocation** — confirmed.
  MEASURED. Mode A, not Mode B — no accidental reproduction of the wrong mode.
- Died at 108.92ms, consistent with dying on the first array element (poison enqueued first,
  same pattern as Run 1).

---

## Bisection tree — reconstructed from RequestIds and `received=` counts

All within the **same single buffer-handler invocation** (07:09:29–07:09:39, Duration
10083.90ms — one Lambda call, no additional 3-minute cycle needed):

```
6 (POISON, 9100001, 9100002, 9100003, 9100004, 9100005)   → FAIL  RequestId 4cd56efd (108.92ms)
├─ 3 (POISON, 9100001, 9100002)                            → FAIL  RequestId e22229f1 (2.39ms)
│  ├─ 1 (POISON)                                            → FAIL  RequestId a88cde64 (2.53ms) — "Poison pill identified" logged 07:09:35.793
│  └─ 2 (9100001, 9100002)                                  → accepted=2 rejected=0  RequestId 83cd0b0f ✅
└─ 3 (9100003, 9100004, 9100005)                            → accepted=3 rejected=0  RequestId 3b76d395 ✅
```

2 + 3 = **5/5 UNI controls delivered**, each confirmed by an explicit Manhattan response:

```
07:09:38.975Z  Manhattan ItemDownload raw response: { acceptedTransactions: 2, ..., rejectedTransactions: 0 }
07:09:39.054Z  Manhattan ItemDownload response: accepted=2 rejected=0 message="ITEM XML Download  ended."
07:09:39.054Z  {"metric":"ManhattanItemsDelivered","company":"UNI","count":2}

07:09:39.512Z  Manhattan ItemDownload raw response: { acceptedTransactions: 3, ..., rejectedTransactions: 0 }
07:09:39.592Z  Manhattan ItemDownload response: accepted=3 rejected=0 message="ITEM XML Download  ended."
07:09:39.670Z  {"metric":"ManhattanItemsDelivered","company":"UNI","count":3}
```

`rejected=0` in both successful sub-batches. `ManhattanItemsSent`/`ManhattanItemsDelivered` both
tagged `"company":"UNI"` — the metric-level company tagging works correctly per-record even inside
a mixed-company batch. MEASURED.

Buffer-handler's own summary confirms the outcome independently:
`"Sent 6 messages to processor."` / `"Deleted 5 messages from the queue."` — 5 deleted (all 5 UNI
controls delivered), 1 retained (the CTC poison, retrying). MEASURED.

**Outgoing XML confirms correct per-record `Company` tagging** — e.g. from the accepted=3
sub-batch: `<Item><Action>SAVE</Action>...<Company>UNI</Company>...<Item>9100003</Item>...</Item>`
— each UNI item's XML carries `Company=UNI` and its own numeric `Item` code, unaffected by having
shared a batch with a CTC record. MEASURED.

---

## Wall-clock delivery latency

All times UTC, 2026-08-18.

| Record | Sent | Delivered | Latency |
|---|---|---|---|
| POISON (CTC) | 07:08:14 | never (DLQ pending, ~30min retry cycle, not tracked further — mechanism already established in Run 1) | — |
| 9100001 (UNI) | 07:08:22 | 07:09:39.054 (accepted=2) | ~77s |
| 9100002 (UNI) | 07:08:23 | 07:09:39.054 (accepted=2) | ~76s |
| 9100003 (UNI) | 07:08:24 | 07:09:39.670 (accepted=3) | ~76s |
| 9100004 (UNI) | 07:08:26 | 07:09:39.670 (accepted=3) | ~74s |
| 9100005 (UNI) | 07:08:27 | 07:09:39.670 (accepted=3) | ~73s |

**Every UNI record delivered within ~77 seconds of being sent — the time it took for the very next
scheduled buffer-handler cycle (07:09:29) to pick the batch up, bisect it, and complete.** No UNI
record required a second buffer-handler cycle (i.e. no extra 3-minute wait) to be delivered — the
bisection recursion happened entirely within one ~10-second Lambda invocation. This is
**faster than Run 1** (which needed ~35–38s from cycle start with a 21-record batch) simply because
the batch here was smaller (6 records vs 21) and bisected in fewer levels (2 levels vs 4).
`ManhattanSyncLagMs` (read_at → sender-processing lag, logged per record) ranged 68,436–73,828ms
for the UNI controls, consistent with the ~68–74s gap between their individual `read_at` stamps and
the 07:09:35–36 processing moment.

---

## Final queue state vs baseline

| Queue | Baseline (this run, pre-send) | Immediately after invocation | Delta |
|---|---|---|---|
| `...-item-buffer-buffer.fifo` | 0 waiting / 0 in-flight | 0 waiting / **1 in-flight** | poison retained, retrying — not a UNI record |
| `...-item-buffer-dlq.fifo` | 1 waiting (Run 1's poison) / 0 in-flight | **1 waiting** (unchanged) / 0 in-flight | **0** — the Run 2 poison had not yet exhausted its 10 retries at time of writing; no UNI message reached the DLQ |

**No UNI `MessageGroupId` (`UNI#9100001`…`UNI#9100005`) ever appeared in the DLQ or remained in the
buffer queue.** Only `CTC#QA-D-R2-POISON-20260818T070751Z` is in-flight, following the same
~30-minute/10-retry pattern already fully characterised in Run 1. Per JJ's instruction, this run
does not wait for that landing — the retry-to-DLQ mechanism adds nothing new here.

---

## Answering the plan's questions

1. **Did the CTC poison and UNI controls actually coalesce into one call?** **Yes — MEASURED.**
   `ManhattanBatch received=6 coalesced=6`. The batch is confirmed not company-scoped.
2. **Are UNI records delivered, delayed, or DLQ'd?** **Delivered, MEASURED**, and not meaningfully
   delayed — all 5 arrived within the same buffer-handler invocation that first saw the batch, no
   extra 3-minute cycle needed. The only "delay" is the ordinary ~13-77s round trip from injection
   through the next scheduled 3-min poll to Manhattan's response — not a delay *caused* by the
   poison.
3. **Cross-tenant verdict:** **UNI delivered normally — blast radius is bounded.** A CTC-side
   validation failure does not block or meaningfully delay UNI item sync in this measurement. The
   buffer-handler's bisection mechanism (Run 1) is confirmed **content-agnostic AND
   tenant-agnostic** — it isolates on message position/failure, not on company.

**Net effect on `POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`:** the cross-tenant risk raised
alongside the Mode A batch-abort question — "a CTC data-entry error could block UNI warehouse
updates" — is **answered negatively** on this evidence. Worth stating plainly to the project team:
the shared, non-company-scoped buffer was a structurally plausible risk, and it is closed by the
same mechanism (bisection) that closed the same-tenant case in Run 1.

---

## Scope note

One caveat worth recording rather than treating as a limitation: this run used **1 CTC poison +
5 UNI controls in a 6-record batch**, matching the plan's specified test size. Run 1 already showed
the mechanism holds at 21 records; nothing about cross-tenant coalescing suggests bisection would
behave differently at larger scale (the mechanism doesn't inspect company at all — it just halves
index ranges), but this run did not itself measure a large mixed-company batch. Not flagged as an
open question, just noted for completeness.

**No SCALE UI lookup is required from JJ for this run** — the question was batch/cross-tenant
survival, and the sender's own `accepted=`/`rejected=` responses plus `ManhattanItemsDelivered`
metrics (both explicitly tagged `company:"UNI"`) are sufficient confirmation. If JJ wants an
independent double-check anyway, the five codes are **`9100001`, `9100002`, `9100003`, `9100004`,
`9100005`**, company **UNI** — expect `Desc` values like `"QA E2E Test 9100003 20260818T070824Z"`,
`Color=Black`, `Size=One Size`, `Brand`(`UserDef1`)=`Thrills Co.`, barcode `9300000000001`.

---

## Tags summary

Every load-bearing claim in this Run 2 section is tagged MEASURED, sourced from direct AWS CLI
queries (SSM, SQS attributes) or verbatim CloudWatch log lines quoted in place. The single
INFERRED-adjacent note is the "no reason to expect different behaviour at larger scale" scope
comment above, explicitly marked as not measured in this run.
