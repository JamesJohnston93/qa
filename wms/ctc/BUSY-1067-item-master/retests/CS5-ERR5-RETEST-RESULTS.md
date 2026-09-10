# CS5 / ERR5 `item_code` whitespace re-test — Results

**Ran:** 2026-08-11 · **Stage:** staging · **Region:** ap-southeast-2 · **Profile:** staging
**Brief:** `CS5-ERR5-RETEST-BRIEF.md` (Rev 2) · **Tickets:** BUSY-1115 (CS5) · BUSY-1116 (ERR5) · related BUSY-1114 (ERR1)

---

## Step 1 — Fix check: **no fix has landed**

| Check | Result |
|---|---|
| `DeadLetterConfig` on `staging-catalog-manhattan-item-buffer-buffer-populator` | `null`. `LastModified` = 2026-08-03T13:02:56Z, predating the brief itself (2026-08-10) — no redeploy since. |
| `item_code` sanitised before `message_group_id` is built | No. Confirmed in `emit-cin7-record.sh` (`--item-code` assigned raw at line 98, flows unmodified into `MESSAGE_GROUP_ID="${COMPANY}#${ITEM_CODE}"` at line 151 and into `detail.item_code`) **and** in the deployed populator itself — pulled and decompiled the live Lambda bundle; the handler does `event.detail.message_group_id ?? ...` with zero trim/strip logic. |

**No fix is in for either half.** All four variants were safe to run as originally planned — no `--item-code-raw` hatch was needed, matching the brief's Rev 2 gate.

### New finding, bigger than the brief anticipated: the populator swallows the SQS throw

Reading the deployed populator's handler (`buffer-populator.ts`, bundled):

```js
try {
  await queueHelper.pushIntoQueue(process.env.QUEUE_NAME, messageGroupId, event.detail, detailType, messageDeduplicationId);
} catch (e) {
  console.log(e);   // <-- swallowed, never rethrown
}
```

`pushIntoQueue` calls `SendMessageCommand`, which throws `InvalidParameterValue` when `MessageGroupId` contains whitespace — but that throw is caught here and only `console.log`'d. It never propagates.

**Confirmed live, not just from the code read:** across all three whitespace variants (6 populator invocations total once you add variant 4), CloudWatch shows **`Invocations=4, Errors=0`** for the populator over the whole test window. The Lambda service sees every one of these as a *successful* invocation, even the three that threw internally.

**This means the documented fix ("trim item_code and/or give the populator a DLQ") is incomplete on the DLQ half, independent of the trim half.** Lambda only routes to a `DeadLetterConfig` when the invocation itself fails (unhandled throw, or return of a rejected promise). Because the catch block here swallows the error, the invocation always reports success — a `DeadLetterConfig` alone would sit there and never fire for this bug. The load-bearing fix has to change the catch block itself (rethrow, or explicit write to an error path) *and* add a DLQ. Flagging this for dev alongside the trim/DLQ recommendation already in the brief.

---

## Step 2/3 — The four variants

All four were dry-run first to confirm the literal value, then re-run with `--confirm`, one at a time with a clean log window each.

| # | `item_code` (literal) | `message_group_id` (dry run, confirmed identical in populator's received-event log) | Component that threw | Verbatim error | Reached DLQ? | Populator `Errors` delta |
|---|---|---|---|---|---|---|
| 1 | `QA-CS5A INTERIOR` | `CTC#QA-CS5A INTERIOR` | populator | `InvalidParameterValue: Value CTC#QA-CS5A INTERIOR for parameter MessageGroupId is invalid. Reason: MessageGroupId can only include alphanumeric and punctuation characters. 1 to 128 in length.` | **No — vanished.** DLQ stayed at baseline (3) the whole test. | 0 (Invocations=1, Errors=0) |
| 2 | `QA-CS5B-TRAILING ` | `CTC#QA-CS5B-TRAILING ` | populator | Same `InvalidParameterValue` shape, value `CTC#QA-CS5B-TRAILING `. | **No — vanished.** | 0 (Invocations=1, Errors=0) |
| 3 | `"   "` (whitespace only) | `CTC#   ` | populator | Same `InvalidParameterValue` shape, value `CTC#   `. | **No — vanished.** | 0 (Invocations=1, Errors=0) |
| 4 | `""` (true blank) | `CTC#` | **sender** (populator passed clean) | `Error: ItemDownload failed validation for record CTC#: missing_item_code` at `validateItemDownload (/var/task/index.js:14828:11)` | **Yes.** Landed in the buffer DLQ (`ef413fc6-0d05-4f23-8149-a8e835cd90f8`) at **minute 28** after injection — confirmed by receiving (not deleting) the message and matching its `read_at`/`message_group_id` to the send. | Populator: 0 (passed through, `Successfully pushed ... event to staging-catalog-manhattan-item-buffer-buffer.fifo`). **Sender Errors incremented by exactly 10** over the bisection window (1+2+1+1+1+2+2 across 5-min buckets, 00:48→01:18) — matches the documented `maxReceiveCount=10` retry policy. Buffer-handler's own `Errors` metric stayed at 0 throughout despite logging `ERROR Poison pill identified` — it catches the sender's invoke failure internally too; only the sender's own Lambda invocation actually fails. |

Confirmed baseline before starting: DLQ depth = **3**, not the brief's documented 6 (see note below) — none of it purged.

---

## Answers to the three questions (§6 of the brief)

- **Q1 — Is CS5 reproducible with an interior space?** **Yes.** Variant 1 reproduces the exact CS5 failure mode (populator throw, silent loss, no DLQ). This confirms trim-alone is insufficient — the interior space in `QA-CS5A INTERIOR` cannot be fixed by trimming leading/trailing whitespace. The populator-side fix is mandatory, not optional. (Though per the swallow-bug finding above, a bare DLQ add on its own won't be sufficient either — see that section.)

- **Q2 — Does whitespace-only behave as ERR5 or ERR1?** **ERR5.** Variant 3 (`"   "`) fails identically to variants 1 and 2 — throws in the populator with the same `InvalidParameterValue`, vanishes with no trace, no DLQ. It does not behave like ERR1's blank-`item_code` case, because `"   "` still produces a non-empty (whitespace-containing) `MessageGroupId`, which SQS rejects on validation before the populator's own logic ever distinguishes blank from whitespace.

- **Q3 — Does a true blank confirm the two-path model (populator vs. sender)?** **Yes, confirmed as the two-path model predicts.** Variant 4 passed the populator cleanly (`CTC#` is valid SQS punctuation), reached the buffer queue, then crashed the sender in `validateItemDownload` with `missing_item_code`, bisected over ~28 minutes, and landed in the DLQ — record preserved. This is the control and it behaved exactly as expected; the two-path model in the brief's §1 holds.

---

## Notes worth carrying forward

- **DLQ baseline correction, not tampering.** The brief documents 6 inert baseline messages from the 08-05/06/07 runs; actual baseline at test start was **3**. Nothing was purged by this session. Used 3 as today's baseline throughout.

  > **⚠ Correction added 2026-08-12 — the depth was right, the explanation was wrong.** This note originally attributed the baseline of 3 to the oldest 08-05 messages ageing out via the queue's 4-day `MessageRetentionPeriod`. They did not age out: **JJ purged the DLQ before the 2026-08-10 session** (baseline 0, recorded in `BUSY-1115-CLOSEOUT-RESULTS.md` Phase 0), and the 3 messages present at the start of *this* run were that session's own poison — `fc37d02c…` (blank `item_code`), `0e7bbc03…` (ERR2), `fed32265…` (ERR4). Adding this run's `ef413fc6…` brings the last recorded depth to **4**. Retention does still expire messages independently, so the number genuinely drifts — the standing rule is **measure it, never assume it**.
- **SNS topic name drift.** The alerts topic is actually `staging-catalog-manhattan-observability-alerts`, not `staging-catalog-manhattan-alerts` as recorded from the BUSY-1048 run. Confirmed **zero subscriptions**, consistent with the BUSY-1048 finding — still nobody notified in this environment.
- **`send-dlq-depth` alarm was already in `ALARM`** before this test started (since 2026-08-10 06:03, from the pre-existing baseline DLQ messages — `ApproximateNumberOfMessagesVisible > 0` threshold). Variant 4's landing (DLQ 3→4) did **not** cause a fresh alarm transition or a new SNS publish, because the alarm was already saturated by the baseline messages. This is an artifact of the pre-existing state — not evidence the alert chain is broken — but it does mean this run can't be used as an end-to-end alert-chain proof the way BUSY-1048's TC3a was (that one started from a clean `OK` baseline).
- Cadence/timing observed: variant 4's populator→buffer→sender crash was effectively immediate (event-driven, not on the 3-minute buffer cadence — that cadence governs the *coalesced send*, not the populator's per-event push), and the sender's bisect-and-DLQ cycle took ~28 minutes, in line with the brief's ~30-minute estimate for 10 retries.

## What was NOT run

Per the brief's guardrails: no watermark writes, no Cin7 API calls, DLQ was not purged, nothing destructive, one variant at a time with a clean log window each. `tail-logs.sh` could not reach the populator (confirmed gap, per brief §5) — `aws logs tail` was used directly throughout.

> **⚠ Correction added 2026-08-12.** `tail-logs.sh --lambda populator` **was added on 2026-08-10** (`BUSY-1115-CLOSEOUT-RESULTS.md` Phase A3, verified against staging) and is present in the script today. Why this run couldn't reach it is unexplained — most likely the brief's stale §5 text was followed without retrying the flag. **Try `--lambda populator` first**; if it genuinely fails, that is a regression and a finding in its own right.
