# BUSY-1115 closeout — QA session results (2026-08-10)

Stage: `staging` · Profile: `staging` · Region: `ap-southeast-2`. Zero Cin7 API calls made this
session (bus-injection + scripts + existing logs only, per hard constraint). Watermark untouched.

Written incrementally as the session progresses — see bottom for what's still open.

## Phase 0 — baseline

`check-status.sh` at session start: all queues 0/0. Buffer DLQ showed **0**, not the expected 6
inert synthetic evidence messages documented in the brief. Flagged to JJ — **confirmed JJ purged/
reset the DLQ between sessions**, so this session's baseline for new-arrival tracking is **0**
across every queue/DLQ, not 6. (The queue's own retention period, 4 days, would not on its own
explain the loss — landing times from SESSION-FINDINGS-2026-08-07.md were still within retention
as of today, so this wasn't a silent expiry; it was a deliberate reset.)

## Phase A — tooling fixes

**A1 — `emit-cin7-record.sh`: `--desc-raw` / `--weight-raw`.** Added both flags. `--desc-raw <s>`
sets `desc` verbatim, skipping the auto-fill-when-empty block (so `--desc-raw ""` now puts a
genuinely blank `desc` on the wire — `--desc ""` still auto-fills, unchanged). `--weight-raw <s>`
sets `weight` verbatim, skipping `num()`'s coercion of unparseable values to `0` (so
`--weight-raw "abc"` puts the literal string `"abc"` in the JSON `weight` field). Verified both
with dry runs: `--desc-raw ""` → `"desc": ""`; `--weight-raw "abc"` → `"weight": "abc"`; old
`--desc ""` still auto-fills. Diff: new flags in the arg-parse case block, `DESC_RAW`/`WEIGHT_RAW`
flags threaded into the auto-fill guard and the Python heredoc's `weight` field construction.

**A2 — `emit-cin7-record.sh`: `--missing-option-code` note.** Reworded both the header usage
comment and the runtime NOTE. Old text claimed this flag "tests the eligibility-skip path (INFO,
no emit, not an error)" — wrong on both counts per brief §7(a): bus-injection bypasses the poller
entirely so it cannot reach the poller-side skip, and ERR1 empirically shows a blank `item_code`
crashes the sender (contradicts "not an error"). New text explicitly states this is the ERR1 shape
(passes populator, crashes sender, DLQ after ~10 retries) and explicitly disclaims TC7/PW6
coverage. Confirmed via dry run — new NOTE text prints correctly.

**A3 — `tail-logs.sh`: `--lambda populator`.** Added a case mirroring the existing
enrich/sender/buffer blocks: `FUNCTION_NAME="${STAGE}-catalog-manhattan-item-buffer-buffer-populator"`,
with a `DROP_HINT` covering the confirmed `InvalidParameterValue ... MessageGroupId` throw (exact
error text lifted from SESSION-FINDINGS-2026-08-07.md) and a note that this failure is invisible
to `--lambda buffer` because it happens upstream of the SQS queue. Added `populator` to the
shared-across-both-stores note branch and to all usage/error strings. Verified: syntax check
passed, and a live (killed-after-4s) run against staging resolved the function name and printed
the correct hints before tailing real log lines.

## Phase B — CS5/ERR5 retest

Populator `Errors` metric baseline (2h lookback, before any variant): **0**.

| # | item_code | dry-run message_group_id | populator received-event message_group_id | Component that threw | Reached DLQ? | Populator Errors delta |
|---|---|---|---|---|---|---|
| 1 | `QA-CS5A INTERIOR` | `CTC#QA-CS5A INTERIOR` | `CTC#QA-CS5A INTERIOR` (matches) | **populator** — `InvalidParameterValue: Value CTC#QA-CS5A INTERIOR for parameter MessageGroupId is invalid. Reason: MessageGroupId can only include alphanumeric and punctuation characters. 1 to 128 in length.` | No — confirmed nothing anywhere (buffer/DLQ/sender all silent, `check-status.sh` still 0/0) | **0** (Invocations=1, Errors=0 in the same 1-min CloudWatch window) |
| 2 | `QA-CS5B-TRAILING ` | `CTC#QA-CS5B-TRAILING ` | `CTC#QA-CS5B-TRAILING ` (matches) | **populator** — identical `InvalidParameterValue` throw | No — vanished, same as #1 | **0** (confirmed via 05:34 CloudWatch window: Invocations=2 covering both #2 and #3, Errors=0) |
| 3 | `"   "` (whitespace only) | `CTC#   ` | `CTC#   ` (matches) | **populator** — identical `InvalidParameterValue` throw (the 3-space value is still invalid punctuation) | No — vanished, same as #1 | **0** (same 05:34 window as #2) |
| 4 | `""` (true blank) | `CTC#` | `CTC#` (matches) | Populator passed cleanly. **Sender** crashed as predicted: `Error: ItemDownload failed validation for record CTC#: missing_item_code` at `validateItemDownload` | **Yes — confirmed landed.** `MessageId fc37d02c...`, `ApproximateReceiveCount: 11`, body byte-for-byte match, peeked non-destructively | N/A (populator not expected to error on this one; confirmed no error there) |

**Critical finding — refutes a brief prediction.** §5 of the brief hypothesizes: *"Even when the
record vanishes, `Errors` should increment. If confirmed, an alarm on populator `Errors` is a
cheap partial mitigation for BUSY-1117."* **This is refuted.** The populator's log line is emitted
at **INFO** level, not as an uncaught exception — the Lambda invocation completes normally
(`END`/`REPORT` with no error marker), so **`Errors` stayed at 0 while `Invocations` incremented
to 1** in the same CloudWatch window for variant 1. The exception object is caught and logged, not
allowed to propagate. **An alarm on populator `Errors` would not fire for CS5/ERR5 and is not a
viable mitigation as currently coded** — the populator's error handling would need to explicitly
re-throw (or emit a custom EMF metric) for that mitigation path to work at all. This is a materially
different, and worse, finding than the brief anticipated: not just "no DLQ," but "no metric
signal of any kind" from the standard Lambda error metrics.

### Q1/Q2/Q3 (brief §6)

- **Q1. Is CS5 reproducible with an interior space?** **Yes, confirmed** (variant 1). Trim-alone
  is insufficient — an interior space survives any leading/trailing trim and still produces
  invalid `MessageGroupId` punctuation. **The populator DLQ (or equivalent re-throw + retry
  policy) is mandatory, not optional**, to make this failure mode recoverable/visible.
- **Q2. Does whitespace-only behave as ERR5 or ERR1?** **ERR5.** Confirmed by variant 3 — `"CTC#   "`
  still contains invalid characters for SQS FIFO's `MessageGroupId`, so it throws in the populator
  exactly like variants 1/2, not in the sender like ERR1/variant 4. Matches the brief's prediction
  exactly ("After a trim fix it would convert to an ERR1 sender crash instead" — confirmed this
  has NOT happened yet, pre-fix).
- **Q3. Does a true blank confirm the two-path model?** **Yes, confirmed.** Populator passes it
  cleanly (`message_group_id "CTC#"` is valid), sender crashes it, and it correctly lands in the
  DLQ after 10 retries (~30 min) — see the full landing confirmation below. The two-path model in
  brief §1 is not wrong.

## Phase C — TC5/WT1 harness artefact verdict

**Verdict: ARTEFACT, confirmed — not a sender defect.** Directly queried the sender's own log
group (`/aws/lambda/staging-catalog-manhattan-item-sender`, retention "None" — logs from
2026-08-05/06 still on disk) for the real product 31679 option `WWORR23-509F-One Size` around its
2026-08-06 send window. **Found `{"metric":"ManhattanDefaultedField","field":"weight",...}` firing
3 separate times** (01:30:35Z, 05:18:31Z, 05:18:57Z) for that exact item_code. This directly
contradicts treating the "no weight metric" observation as a sender-side gap — **the sender does
correctly emit the defaulted-field metric for a genuinely-missing weight on real records.**

Re-reading SESSION-FINDINGS-2026-08-05.md line 157-165 confirms the "no metric" note was made
**only about the synthetic `QA-TEST-NOWEIGHT-1` record**, not about product 31679 — the two were
conflated in TC5's PARTIAL status but are not the same evidence. The synthetic record's
`missing_fields` list (built client-side in `emit-cin7-record.sh`) never included `weight` — it
was excluded from the six-field list the script checks — so of course the metric it drives
downstream never fired for the synthetic case; height/length/width/conversion_rate all fired
correctly for the same synthetic record because those *are* in that list. This is exactly the
harness gap the brief predicted.

**Fixed the harness:** added `weight` to `emit-cin7-record.sh`'s `missing_fields` construction
(same `val in ("", "0", 0)` check as the other fields — does not affect `--weight-raw`, which
still bypasses this by design for ERR4). Verified via dry run: `--weight 0` now correctly adds
`"weight"` to the printed `missing_fields` array. **Re-ran WT1 with the fixed harness**
(`QA-WT1-RETEST-2`, `weight=0`, sent 05:39:32 UTC) — result below.

**No dev escalation needed on this question** — it's resolved directly from existing evidence.
TC5/WT1 can close as PASS without a "confirm with dev" caveat on this specific point.

**WT1 retest confirmed the fix.** `QA-WT1-RETEST-2` (sent 05:39:32 UTC) landed in the sender at
05:39:40: `{"metric":"ManhattanDefaultedField","field":"weight","company":"CTC","item_code":"QA-WT1-RETEST-2"}`
fired correctly this time (alongside height/length/width/conversion_rate/dimension_uom/qty_uom),
`<Weight>0</Weight>` in the outgoing XML, `accepted=1 rejected=0`. Harness and real-world
behaviour now agree — **WT1: PASS, no caveat.**

## Phase B — variant 4 (true blank), sender-side resolution — CONFIRMED LANDED

Populator passed variant 4 cleanly as expected. In the sender it crashed repeatedly on schedule
(`Error: ItemDownload failed validation for record CTC#: missing_item_code` at
`validateItemDownload`, ~3 min apart matching the buffer-flush/bisection cadence) and **landed in
`staging-catalog-manhattan-item-buffer-dlq.fifo` as predicted.** Confirmed via a non-destructive
peek (5s visibility timeout, not deleted): `MessageId fc37d02c...`, body byte-for-byte matching the
original injected record (`item_code:""`, `read_at:1786340137554`, same `desc`), `SenderId`
confirms it arrived via the buffer-populator, `ApproximateReceiveCount: 11` (10 retries + the
initial receive, exactly matching `maxReceiveCount=10`). **Q3 (brief §6) confirmed: a true blank
`item_code` validates the two-path model — populator passes it cleanly (`message_group_id "CTC#"`
is valid punctuation), sender then crashes and correctly preserves it in the DLQ**, in contrast to
variants 1–3 which vanish with no trace at the populator layer. This message is new evidence from
this session — track it as a new DLQ arrival, not part of any pre-existing baseline.

## Phase E — TC9 (request spacing), answered from existing logs, zero Cin7 cost

Confirmed retention is set to **"None" (never expire)** on the poller/sender/buffer log groups —
the 2026-08-06 heavily-paginated cycle's logs are still fully on disk. Pulled the exact cycle
referenced in SESSION-FINDINGS-2026-08-05.md (`recordsEmitted:4304`,
`Cin7TriggeredProductsFetched count:600`, watermark advanced to `2026-08-06T05:16:00.000Z`) —
request ID `bf4733f7...`, cycle ran 05:16:50.708–05:18:06.301 UTC.

The paginated `Cin7ProductOptionsFetched` calls within that single cycle (18 consecutive pages,
05:16:50.708–05:16:59.155) give real inter-request timestamps:

- 16 of 17 gaps: **362–480ms** (avg ~438ms) — comfortably under the `<3/s` cap (≥333ms spacing).
- One momentary jitter: a 1182ms gap immediately followed by a 197ms gap (page 16→17→18) — the
  pair averages 689.5ms/request, i.e. still well under the cap over any real 1-second window.
  Not a sustained burst above 3/s, just scheduling jitter around one slow response.

**TC9: PASS.** Confirmed `<3/s` spacing (~350–480ms typical) during genuine pagination, using
already-retained CloudWatch data. Zero new Cin7 API calls made to answer this.

## Phase C1/C2 — ERR2/ERR4, both predictions refuted (significant findings)

**C1 — ERR2 (genuinely blank `desc` via `--desc-raw ""`, item_code `QA-ERR2-BLANKDESC`, sent
05:45:15 UTC). CONFIRMED LANDED IN DLQ.** Populator passed cleanly. In the sender:
`{"metric":"ManhattanSenderValidationFailure","reason":"missing_desc"}` logs correctly — but then,
unlike a clean skip, it **throws an uncaught error**: `Error: ItemDownload failed validation for
record CTC#QA-ERR2-BLANKDESC: missing_desc` at `validateItemDownload`. Bisected and retried on the
same ~3-min cadence as ERR1, then **landed in `staging-catalog-manhattan-item-buffer-dlq.fifo`**:
`MessageId 0e7bbc03...`, body byte-for-byte match (`"desc":""`), `ApproximateReceiveCount: 11` (10
retries). **Refutes the brief's prediction** ("validation failure logged, record skipped cleanly,
no crash, never silent") — ERR2 behaves **exactly like ERR1's missing-item_code crash**, not a
clean skip. **Proposed status: FAIL**, not PASS/BLOCKED — this is a genuine defect, same family as
ERR1/CS5: the sender logs the correct validation-failure reason but still throws instead of
dropping/skipping the one bad record while letting the rest of the batch through.

**C2 — ERR4 second half (non-numeric weight via `--weight-raw "abc"`, item_code
`QA-ERR4-BADWEIGHT`, sent 05:45:32 UTC). CONFIRMED LANDED IN DLQ.** Populator passed cleanly (no
`ManhattanSenderValidationFailure` logged this time — the bad weight isn't caught by that
validation layer at all). Instead: **uncaught `TypeError: value.toFixed is not a function` at
`roundToSchemaPrecision` (called from `mapToItemDownload`)** — the string `"abc"` reaches a
numeric-rounding call with no type guard. Bisected/retried, then **landed in the DLQ**: `MessageId
fed32265...`, body byte-for-byte match (`"weight":"abc"`), `ApproximateReceiveCount: 11`.
**Refutes the brief's prediction** ("mapper defaults-and-reports or sender skips gracefully; never
an uncaught crash") — this is precisely an uncaught crash, one level deeper in the mapping code
than ERR1/ERR2 (a `TypeError` in the XML-mapping step, not a `validateItemDownload` check).
**Proposed status: FAIL.** This is arguably the more severe of the two: `validateItemDownload` at
least has a named check it could special-case, but `roundToSchemaPrecision` has no upstream type
validation at all for `weight`/dimension fields before calling `.toFixed()`.

**Combined significance:** three of four known crash-and-bisect defects (ERR1, ERR2, ERR4) now
share the same failure shape — an uncaught throw somewhere in the sender's per-item mapping/
validation path, bisected, retried ~10×/~30min, landing in the DLQ. Only CS5/ERR5 (populator-level,
pre-queue) is structurally different. This suggests the sender's error handling has a systemic
gap: no single record's data-quality problem is contained without throwing and forcing the whole
batch through the bisection/retry machinery.

## Phase D — bus-injection extended coverage (ID1, UP1, UP2, STR2)

**D1 — ID1 (CTC vs UNI sharing a numeric item_code).** Added a minimal `--company <CTC|UNI>` flag
to `emit-cin7-record.sh` to unblock this test — the script previously hardcoded `company: "CTC"`
and the `CTC#` message_group_id prefix with no way to inject a UNI record at all. Change: `COMPANY`
var (default `CTC`, validated to `CTC|UNI`), threaded into `MESSAGE_GROUP_ID="${COMPANY}#..."` and
`detail.company`. (Left `product_group_id` untouched — no evidence either way on UNI's convention
for that field, out of scope for this test.) Injected item_code `3141592` as `--company CTC`
(05:48:11 UTC) and `--company UNI` (05:48:19 UTC), 8 seconds apart — well within one buffer window,
deliberately, to stress the coalesce key. **Result: PASS.** Both sent as fully distinct
`ItemDownload` SAVE calls, not coalesced together: `<Company>CTC</Company><Item>3141592</Item>`
accepted=1 rejected=0 at 05:48:43, and separately `<Company>UNI</Company><Item>3141592</Item>`
accepted=1 rejected=0 at 05:48:44. `message_group_id` confirmed `CTC#3141592` vs `UNI#3141592` at
every stage (dry run, populator received-event, sender). **Confirms the coalesce key is
`(company, item_code)`, not `item_code` alone** — sharing a numeric code across tenants never
collided. SCALE-state (are both actually distinct items in SCALE, not one overwriting the other) —
**PENDING JJ**, sender/XML evidence only.

**D2 — UP1 (create, then update, same item). Result: PASS.** First injection `QA-UP1-TEST`
(`colour=Red, size=Small`, sent 05:48:29 UTC) sent alone, `accepted=1 rejected=0`
(`<Color>Red</Color>...<Size>Small</Size>`). Second injection (`colour=Blue, size=Large`, sent
05:51:37 UTC, deliberately held for the *next* buffer window to force two genuinely separate SAVE
calls rather than intra-window coalescing) also sent alone, `accepted=1 rejected=0` at 05:51:51
(`<Color>Blue</Color>...<Item>QA-UP1-TEST</Item>...<Size>Large</Size>`). Two distinct, correctly-
sequenced SAVE calls for the same item, fields updated between them, no duplicate-item behaviour
observed in the sender. SCALE-side final state (one item, Blue/Large, not two) — **PENDING JJ.**

**D3 — UP2 (field cleared after being populated). Result: sender-side evidence PASS; the
idempotency question itself is PENDING JJ, as expected.** First injection `QA-UP2-TEST`
(`colour=Green`, sent 05:49:01 UTC) sent alone, `accepted=1 rejected=0` at 05:51:45
(`<Color>Green</Color>`). Second injection (`colour=""`, sent 05:51:55 UTC, same held-for-next-
window approach) landed inside the D4 8-item group, `accepted=8 rejected=0` at 05:54:44 —
**confirmed the outgoing XML contains an explicit, present-but-empty `<Color></Color>` tag, not an
omitted field.** This proves the sender transmits the blank rather than dropping the field from
the payload. Whether Manhattan SCALE actually clears `Color` on receipt of an empty tag under a
`SAVE` action, or retains the prior `Green` value (SAVE being additive/field-level per the runbook)
is exactly the open question the brief flagged as load-bearing for the re-sync runbook's
idempotency argument — **this cannot be settled from logs alone and is PENDING JJ in the SCALE UI**
(check `Color` on item `QA-UP2-TEST` — Green retained vs. blank).

**D4 — STR2/ST2 (packing/volume smoke test). Result: PASS.** Per the design docs this is
explicitly "a smoke check, not a boundary test — forcing the real 1MB payload cap this way isn't
practical, and that boundary is already covered by unit tests" (README.md). Injected 12 distinct
records (`QA-STR2-BATCH-1` through `-12`, default fields) within a 15-second span
(05:52:31–05:52:46 UTC), all inside one buffer window. Confirmed via request-ID correlation in the
sender log: the batch packed into **two grouped payloads — one with 4 items
(`QA-STR2-BATCH-8..11`, `accepted=4 rejected=0` at 05:54:41) and one with 8 items
(`QA-STR2-BATCH-1..7` plus, coincidentally, D3's second `QA-UP2-TEST` send, `accepted=8
rejected=0` at 05:54:44)** — 4+8=12, every item landed, zero rejections, no oversize failure.
Confirms the sender's grouping/packing mechanism functions correctly under a modest multi-item
flush, consistent with the documented "smoke check" scope (not a true 1MB-edge test, which is
unit-tested elsewhere per the README).

## Phase F — STOP gate: TC7 and STR1

Per the hard instruction, **did not run `cin7-watermark.sh` or `preview-cin7-sync.sh`, and did
not touch the watermark.** Both remaining items genuinely need a live poll cycle:

- **TC7 (poller-side eligibility skip — missing `productOptionCode`).** Bus-injection structurally
  cannot exercise this: it bypasses the poller entirely and posts straight onto the shared bus that
  the buffer-populator listens on, so there is no path from this tooling to the poller's own
  pre-emit skip check (confirmed again this session via A2's corrected script note and the
  `--missing-option-code` rewrite). To actually run TC7, one of:
  - **Costs Cin7 budget:** a narrow watermark rewind onto a real Cin7 product/option that
    genuinely has no `productOptionCode` set, then a live poll cycle, confirming the poller logs
    an INFO-level skip (no record built, no emit) rather than passing a blank-derived item through
    to the sender. CLAUDE.md already records the **sender-side half** of this defect family as
    confirmed (①/② in the Jira write-up, and reconfirmed this session via ERR1/variant 4/ERR2/ERR4
    all crashing rather than skipping) — what's specifically missing is proof of the poller's own
    upstream skip, not the sender's downstream crash.
  - **Costs dev attestation, not Cin7 budget:** ask dev to confirm the poller's own unit test suite
    covers the missing-`productOptionCode` skip path explicitly (mirrors how a parallel TC7 in the
    sibling manhattan-qa-tools repo was deferred to dev rather than live-tested). Cheaper, and
    arguably more conclusive than one live cycle, but requires dev's time rather than JJ's Cin7
    budget.
- **STR1/ST1 (fan-out on a high-option product).** Needs `find-cin7-product-by-id.sh` to locate a
  real Cin7 product with many options, then a narrow watermark rewind onto it, then a live poll
  cycle — confirming one record per option, all mapped/delivered, `recordsEmitted` = active option
  count. No bus-injection equivalent exists (the whole point is exercising the poller's real
  per-option fan-out against genuine Cin7 data shape) — this is a straightforward Cin7-budget cost,
  no cheaper alternative path.

Both are ready to run as soon as JJ approves spending Cin7 budget against the shared 5,000/day cap —
`find-cin7-product-by-id.sh` (for STR1's target) and a preview-only sizing check (for both, to
confirm cost before committing) can be run at that point.

## Still open at end of session

**Needs Cin7 budget (JJ's call, not spent this session):**
- TC7 (poller-side eligibility skip) — live poll cycle over a genuinely no-`productOptionCode`
  option, OR dev attestation (see above) as a zero-cost alternative.
- STR1/ST1 (high-option fan-out) — live poll cycle over a real high-option product.

**Needs dev attestation (no Cin7 cost, but not something QA can confirm alone):**
- TC7 alternative path above.
- The populator's error-handling gap this session surfaced: **an alarm on the populator `Errors`
  metric will not fire for CS5/ERR5** because the exception is caught and logged at INFO rather
  than allowed to propagate — dev needs to either let it re-throw (so `Errors`/DLQ/retry policy all
  become meaningful) or add an explicit custom metric if INFO-logging is intentional. This changes
  the recommended fix for CS5/ERR5/BUSY-1117: **populator DLQ is necessary but insufficient on its
  own** — without a code change to how the exception is handled, giving the Lambda a
  `DeadLetterConfig` does nothing, because Lambda only redrives to a DLQ on an actual unhandled
  invocation failure, and this one never fails from Lambda's point of view.
- ERR2/ERR4 (this session's new FAILs) — same family as ERR1: the sender needs per-record
  containment (catch the mapping/validation error for one poison item, skip it, keep processing
  the rest of the batch) instead of throwing and forcing the whole batch through bisection/retry.
  QA has now reproduced three variants of this same underlying gap (ERR1: missing item_code, ERR2:
  missing desc, ERR4: non-numeric weight) — worth raising as one defect with three repros rather
  than three separate tickets, since the fix is almost certainly the same code change.

**Needs JJ in the SCALE UI (sender/log evidence collected, final state not verifiable from here):**
- D1/ID1 — confirm `3141592` under `CTC` and `3141592` under `UNI` exist as two genuinely distinct
  SCALE items, not one overwriting the other.
- D2/UP1 — confirm `QA-UP1-TEST` shows `Blue`/`Large` (the second, updated values), not `Red`/`Small`
  or a duplicate second item.
- D3/UP2 — **the load-bearing one for the re-sync runbook.** Confirm whether `QA-UP2-TEST`'s
  `Color` is now blank/cleared or still shows `Green` — settles whether a re-sync's SAVE-additive
  behaviour can actually repair a field that was deliberately blanked upstream, or only ever adds/
  overwrites with non-blank values.
- Variant 4 / ERR2 / ERR4 DLQ landings — **all three confirmed landed** (see Phase B and C1/C2
  sections above for `MessageId`s and byte-for-byte body verification). SCALE itself was never
  touched by these three — they all die before reaching Manhattan, so there is nothing for JJ to
  check in the SCALE UI for this group; it's listed here only for the DLQ-body confirmation, which
  is now done.

## DLQ state at end of session

Buffer DLQ (`staging-catalog-manhattan-item-buffer-dlq.fifo`) holds **3 messages**, all new
evidence from this session (baseline at session start was 0, per the Phase 0 note above):

| MessageId | item_code | Test | ApproximateReceiveCount |
|---|---|---|---|
| `fc37d02c...` | `""` (blank) | Phase B variant 4 (CS5/ERR5 retest control) | 11 |
| `0e7bbc03...` | `QA-ERR2-BLANKDESC` | Phase C1 (ERR2) | 11 |
| `fed32265...` | `QA-ERR4-BADWEIGHT` | Phase C2 (ERR4) | 11 |

All three peeked non-destructively (5s visibility timeout), nothing deleted. Left in place as
evidence per the established convention (JJ's call on when to purge) — do not purge without
checking with JJ first, same as the pre-existing 6 messages this session's baseline check found
already cleared.

**Session complete.** Every phase that could run without Cin7 API budget has run. TC7 and STR1/ST1
are the only two items genuinely blocked on JJ's go-ahead to spend Cin7 budget (Phase F above).
