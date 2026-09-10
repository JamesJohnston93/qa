# CTC fix re-test — Results (2026-08-13)

**Brief:** `CTC-FIX-RETEST-BRIEF.md` (Rev 5/6) · **Stage:** staging · **Region:** ap-southeast-2 · **Profile:** staging
**Method:** bus-injection only, per §1/§2. Exactly one Cin7 GET spent (Group F). No watermark writes, no DLQ purge, nothing destructive.
**Run window:** 2026-08-13 00:14:35Z (Gate A deploy check) – 00:48:37Z (final E1 record processed by the sender). Group A–E injections ran 00:15:45Z – 00:46:41Z. DLQ measured mid-session at 00:55Z and finally at 01:06:59Z, after the bisection/DLQ landing wait.

---

## TOP OF FILE — read this first

**Group F did NOT confirm a live-destroyed record — but the reason is not either of the brief's two anticipated outcomes.** Product 29942's six options (`WTW23-922G  -XS/S/M/L/XL/XXL`) really did carry the interior double-space in `item_code` at the real poller's emit time (confirmed both in the poller's own 2026-08-06 log and via the one permitted live Cin7 GET). They passed through the populator and sender cleanly with **zero** `InvalidParameterValue` throws anywhere in a 90-day log window. The reason is that **the real poller's own computed `message_group_id` was `CTC#WTW23-922G_-S` — an underscore where bus-injection's raw-concatenation harness would put the literal space.** So `item_code` (and the `Item`/`Desc` fields derived from it) did carry the real padding, but `message_group_id` did not — it wasn't built as a raw `"{company}#{item_code}"` concatenation the way `emit-cin7-record.sh` builds it. This is a fact, not an inference from reading code (found entirely from CloudWatch Insights logs + one Cin7 GET); record it and let dev explain the mechanism. See §Group F below for the full evidence.

**Gate A: the populator was NOT redeployed.** Sender and poller both show `LastModified` in the 08-12 22:45–46Z window (consistent with "pushed 08-11/12"). **The populator's `LastModified` is 2026-08-03T13:02:56Z — predates the claimed fix window entirely, no redeploy since.** Per the brief, this is recorded and the pass continues — but every Group A whitespace result below is labelled **deploy unconfirmed for the populator; behaviour observed is identical to the documented pre-fix behaviour** in every case except the true-blank control (A5, which was never populator-side to begin with).

---

## Header — required facts

### Gate A — deploy timestamps (checked 2026-08-13T00:14:35Z)

| Lambda | `LastModified` | vs. claimed fix window (08-11/12) |
|---|---|---|
| `staging-catalog-manhattan-item-sender` | `2026-08-12T22:46:32Z` | Confirms — inside window |
| `staging-catalog-manhattan-item-buffer-buffer-populator` | `2026-08-03T13:02:56Z` | **Does NOT confirm — predates window by 9 days, no redeploy since** |
| `staging-catalog-cin7-cin7-item-poller` | `2026-08-12T22:45:44Z` | Confirms — inside window |

### Gate B — character limits, QA-measured by probe (not dev-supplied)

| Field | Method | Result | Confidence |
|---|---|---|---|
| **Desc** | C0 control: sent 200 chars, read stored value | **Exactly 100** | Exact — validates the probe method (matches the previously-known `stringLength_100` evidence) |
| **Colour** | Sent 200 chars, read stored value | **Exactly 25** | Exact |
| **Size** | Coarse walk 200→100→50→25 (4 probes, cap reached) | Errors at 200, 100, 50. Passes unchanged at 25. | **Bracketed only: limit is strictly between 26 and 50 chars.** Exact boundary not established within the 4-probe cap — walk exhausted before narrowing further. |
| **Item** (`item_code`) | Probes at 200, 100, 50, 75 (4 probes, cap reached) | Errors at 200 (see note), 100, 75. Passes unchanged at 50. | **Bracketed only: limit is strictly between 51 and 74 chars.** Exact boundary not established within the 4-probe cap. |

**Note on the 200-char Item probe:** at 200 chars the throw happened in the **populator** (`InvalidParameterValue … MessageGroupId … 1 to 128 in length`), because `message_group_id = "CTC#" + 200 chars` = 204 chars, over SQS FIFO's 128-char cap — a different constraint from any application-level Item limit. At 75/100 chars the throw moved to the **sender** (`item_code_too_long`, named reason, `validateItemDownload`) — the SQS group-id cap wasn't reached at those lengths (79/104 chars), so the sender's own length check is what actually bound. **For any item_code length QA actually observed the sender-side limit to bind at (51–74 chars), the SQS 128-char cap never comes into play** — the application-level Item limit is materially tighter than the SQS ceiling.

### Buffer DLQ baseline

Measured via `check-status.sh` before any injection: **4 messages waiting, 0 in-flight** — matches the last recorded depth (`fc37d02c…`, `0e7bbc03…`, `fed32265…`, `ef413fc6…`). Not purged. See §DLQ final state below for the end-of-session number.

---

## Group F — is the whitespace defect live, or theoretical? (run first, before any injection)

### F1 — the logs (zero Cin7 cost)

CloudWatch Insights query across poller/populator/sender log groups, 90-day window, `filter @message like /WTW23-922G/`. **63 matching log lines, all from a single cycle: 2026-08-06 01:25:52.921Z – 01:27:35.447Z.** No other occurrence in the 90-day window.

Verbatim evidence, in order:

1. **Poller's own emit** (`Cin7RecordEmitted` metric + the `Pushed {...}` batch line onto the poller's own bus): `item_code":"WTW23-922G  -S"` (literal interior double-space) but **`message_group_id":"CTC#WTW23-922G_-S"`** (underscore, not space) — for all six size options (XS, S, M, L, XL, XXL).
2. **Populator's received-event log**: `Received event: ...{"message_group_id":"CTC#WTW23-922G_-S","item_code":"WTW23-922G  -S",...}` — confirms the populator received exactly what the poller sent (underscore in group-id, raw space in item_code), matching #1.
3. **Populator → SQS**: `params { MessageGroupId: 'CTC#WTW23-922G_-S', ... }` followed by `[CTC#WTW23-922G_-S]: Successfully pushed <id> event to staging-catalog-manhattan-item-buffer-buffer.fifo` — for **all six options**, no exception, no `InvalidParameterValue` anywhere in the 63 lines.
4. **Sender-side metrics**, ~102 seconds of lag later: `{"metric":"ManhattanDefaultedField","field":"height","item_code":"WTW23-922G  -S"}` (and length/width/weight/conversion_rate) plus `{"metric":"ManhattanSyncLagMs","item_code":"WTW23-922G  -S","lagMs":102439}` — fired for all six options, no `missing_item_code` crash, no `ManhattanSenderValidationFailure`.

**Zero occurrences of `InvalidParameterValue` anywhere in the 90-day, 3-log-group query.**

### F2 — Cin7 (the one permitted request)

```
./find-cin7-product-by-id.sh --id 29942
```

```
Product 29942 — 'Artisan Suiting Set - Steel Grey'
  status: Public   modifiedDate: 2026-08-06T01:25:12Z
  total options: 6   Primary-status (active) options: 6
    code='WTW23-922G  -XS' status='Primary' modifiedDate='2026-06-09T07:34:57Z'
    code='WTW23-922G  -S'  status='Primary' modifiedDate='2026-06-09T07:34:57Z'
    code='WTW23-922G  -M'  status='Primary' modifiedDate='2026-06-09T07:34:57Z'
    code='WTW23-922G  -L'  status='Primary' modifiedDate='2026-06-09T07:34:57Z'
    code='WTW23-922G  -XL' status='Primary' modifiedDate='2026-06-09T07:34:57Z'
    code='WTW23-922G  -XXL' status='Primary' modifiedDate='2026-06-09T07:34:57Z'
```

All six `productOptions[].code` values carry the literal **interior double-space** (`[WTW23-922G  -XS]` etc. — confirmed with delimiters), matching exactly what the poller emitted as `item_code` in #1 above. The padding is interior only (no leading/trailing whitespace observed on any of the six).

### F3 — not run

F1 did not confirm a destroyed record (no throw, no silent-sender-drop pattern occurred for this product), so per the brief F3 ("only if F1 confirms a live trigger") does not apply. No historical-throw count was taken.

### Verdict

**CS5, for this specific real record, did not destroy anything — the record travelled the full real pipeline successfully despite carrying genuine interior whitespace in `item_code`.** This does **not** match either of the brief's two anticipated explanations:
- Not "poller emitted it, populator threw, sender silent" (no throw occurred at all).
- Not "code was clean at emit time, padding lives in some other field" (the padding demonstrably *was* in `item_code` at emit time, confirmed independently via the live Cin7 GET of `productOptions[].code`).

The actual, observed reason: **the real poller's own `message_group_id` is not a raw `"{company}#{item_code}"` concatenation.** It substituted an underscore where bus-injection's harness (and, per the brief, the LLD §3.5 description) would put the literal interior space — while `item_code` itself (and the `Item`/`Desc` fields Manhattan received) kept the raw whitespace untouched. This means bus-injection's A1/A2/A3/A6 results below (all reproducing the populator-level `InvalidParameterValue` throw) may not be representative of what the real poller path produces for the *same* whitespace shape — the real poller appears to construct `message_group_id` by some means other than raw concatenation, at least for this one confirmed instance. Whether that holds generally is a question for dev, not something this pass can settle from bus-injection alone.

---

## Group A — `item_code` whitespace

**Every variant below reproduced the identical pre-fix failure signature recorded in `CS5-ERR5-RETEST-RESULTS.md` (08-11) and `BUSY-1115-CLOSEOUT-RESULTS.md` (08-10) — no behavioural change observed.** Consistent with Gate A's finding that the populator itself was never redeployed.

| # | `item_code` sent | Dry-run `message_group_id` | Populator received `message_group_id` (match?) | Result |
|---|---|---|---|---|
| A1 | `QA-FIX-A1 INTERIOR` | `CTC#QA-FIX-A1 INTERIOR` | same, matches | **Populator threw** `InvalidParameterValue: ... MessageGroupId can only include alphanumeric and punctuation characters. 1 to 128 in length.` Vanished — no buffer, no DLQ, no sender. Populator `Invocations` incremented, `Errors` stayed 0 (per-window CloudWatch check). |
| A2 | `QA-FIX-A2-TRAILING ` | `CTC#QA-FIX-A2-TRAILING ` | same, matches | **Threw, identical shape.** Trailing-space trim was NOT observed. |
| A3 | ` QA-FIX-A3-LEADING` | `CTC# QA-FIX-A3-LEADING` | same, matches | **Threw, identical shape.** Leading-space trim was NOT observed. |
| A4 | `"   "` (spaces only) | `CTC#   ` | same, matches | **Threw, identical shape** to the documented pre-fix ERR5 behaviour. No distinct "explicit new error" was observed — the error text, throw site, and outcome (vanished, no trace) are identical to A1/A2/A3, not a different validation path. |
| A5 | `""` (true blank) | `CTC#` | same, matches | **Populator passed cleanly** (unchanged). **Sender crashed exactly as before:** `ManhattanSenderValidationFailure reason:"missing_item_code"` logged, then `Error: ItemDownload failed validation for record CTC#: missing_item_code` at `validateItemDownload`, uncaught. Matches prior recorded behaviour exactly — see Q3 below. |
| A6 | `QA-FIX-A6-TAB\t` (trailing tab) | `CTC#QA-FIX-A6-TAB\t` | same, matches | **Threw, identical shape.** Tab is not handled differently from a space. |
| A7a | `QA-FIX-A7-DUP ` (trailing space) | `CTC#QA-FIX-A7-DUP ` | same, matches | **Threw, identical shape — vanished before ever reaching the buffer.** |
| A7b | `QA-FIX-A7-DUP` (clean) | `CTC#QA-FIX-A7-DUP` | same, matches | Passed populator → buffer → sender, sent **alone** (`accepted=1 rejected=0`). |

**A7 outcome — record as observed, not as designed:** because A7a (the trailing-space variant) vanished at the populator exactly like A1/A2/A3/A6, **only one of the two intended "duplicate" records ever reached the buffer or SCALE.** The intended test (fire two candidate-duplicate records into one flush window, check whether SCALE ends up with one item or two) could not be observed as designed — there was never a genuine pair in the buffer to coalesce. The sole survivor (`QA-FIX-A7-DUP`) landed as a normal single-item send.

**Populator `Invocations`/`Errors` for the whole session (00:15–00:39Z, all groups combined):** `Invocations = 26`, `Errors = 0` (CloudWatch `AWS/Lambda` metrics, 31-minute sum). Confirms the documented swallow-and-log behaviour is still exactly in effect — seven separate populator-level throws this session (A1, A2, A3, A4, A6, A7a, plus the Item=200 Gate-B probe) and `Errors` never moved off zero.

---

## Group B — `Desc` truncation

**Traceability: re-test of CS6/GE4** (the ~617-char rejection case, 08-07) — CS6/GE4 established `Desc` rejects at 100+ under the *old* (pre-fix) behaviour. This group establishes what the *new* behaviour actually is.

| # | `desc` sent (length) | Stored value (length) | Notes |
|---|---|---|---|
| B1 | 100 `B`s | **100**, unchanged | Exact — passes through untouched |
| B2 | 101 `B`s | **100** (truncated by exactly 1) | Confirms the boundary is exact, not off-by-one in either direction |
| B3 | 500 `B`s | **100** (truncated) | No batch-level effect — sent alongside B2/B4/C1 in one 4-item batch, `accepted=4 rejected=0` |
| B4 | 94 `B`s + `café™—🎉` + 4 `B`s (105 chars total) | **100**, ending `...café™—` | The trailing emoji (🎉) **and** the 4 trailing `B`s were both dropped. The multi-byte characters that fell *within* the 100-char boundary (`é`, `™`, `—`) were preserved intact — no mangled/split character, no broken surrogate half. Truncation cut cleanly at the 100th unit and discarded everything after, whole-character. |

**Truncation is completely silent — no operator-visible signal of any kind.** Grepped both the sender and populator log windows for any string containing "truncat" (case-insensitive): **zero matches.** No log line, no metric name, nothing recorded anywhere that a value was shortened.

---

## Group C — `Colour` truncation

**New coverage — no prior test case existed for this field's length at all.**

| # | `colour` sent (length) | Stored value (length) | Notes |
|---|---|---|---|
| C1 | 25 `C`s | **25**, unchanged | Exact — passes through untouched |
| C2 | 26 `C`s | **25** (truncated by exactly 1) | Confirms the boundary is exact |
| C3 | 20 `C`s + `café™—` (26 chars total) | **25**, ending `...café™` | The trailing em-dash (`—`, the 26th character) was dropped; `é` and `™` (within the boundary) were preserved intact. Same clean, whole-character truncation behaviour as B4. |

Same result as Group B: **zero mentions of "truncat" anywhere in the logs for any of C1–C3.**

---

## Group D — `Size` / `Item` over-length (errors)

Gate B's bracket-probes (Size 25/50/100/200, Item 50/75/100/200) **are** the D1–D4 substance — reusing them here rather than re-injecting identical shapes:

| # | Field | Value tested | Result |
|---|---|---|---|
| D1 (size, at-boundary proxy) | `size` | 25 chars (known-good bracket edge) | **Accepted unchanged** — full 25-char value in the outgoing `<Size>` element, `accepted=1`. |
| D2 (size, over-limit proxy) | `size` | 50 chars (known-bad bracket edge; also reproduced at 100, 200) | **Errors.** `ManhattanSenderValidationFailure reason:"size_too_long"` logged, then `Error: ItemDownload failed validation for record CTC#<code>: size_too_long` at `validateItemDownload`, uncaught — same crash-and-bisect shape as ERR1/ERR2/ERR4. Confirmed the crash recurs identically at 50, 100, and 200 chars. |
| D3 (item, at-boundary proxy) | `item_code` | 50 chars (known-good bracket edge) | **Accepted unchanged** — full 50-char value in `<Item>`, `message_group_id` = 54 chars (well under the 128 SQS cap), `accepted=1`. |
| D4 (item, over-limit proxy) | `item_code` | 75 chars (known-bad bracket edge; also reproduced at 100) | **Errors.** `ManhattanSenderValidationFailure reason:"item_code_too_long"`, then the same `validateItemDownload` uncaught throw, crash-and-bisect. At 200 chars the *operative* constraint shifts to the populator's SQS `MessageGroupId` 128-cap instead (see Gate B note) — but at 75/100 chars (the range actually bracketing the real application limit), the sender-side `item_code_too_long` check is what fires, not the SQS cap. |

**D1–D4 could not be run at the exact boundary** — Gate B's 4-probe cap was reached before pinning Size/Item to a single character. D1/D2/D3/D4 above are answered from the nearest available bracket values, not from `<LIMIT>`/`<LIMIT>+1` pairs. Flagged as a gap for dev to confirm the exact numbers.

Both `size_too_long` and `item_code_too_long` are **named, distinct reasons** in the same `validateItemDownload` function that already carries `missing_item_code` (ERR1), `missing_desc` (ERR2), and the unguarded `.toFixed()` weight crash (ERR4) — same systemic shape: the sender has no per-record containment for any of these, and an uncaught throw aborts the whole batch invocation before bisection isolates the one bad record.

`SenderValidationFailures` metric (CloudWatch, `staging-catalog-manhattan` namespace): **81** over the session window (00:15–00:48Z), **`Dimensions: []`** — confirms the standing BUSY-1113 finding again: no `Company=CTC` breakdown exists at the metric level, only in the log text.

---

## E1 — regression

**Run first (00:15:45Z) and again last (00:46:41Z), per the brief.**

- **E1 (first):** `QA-FIX-E1-1` — populated weight/dims/UOM, non-blank colour/size. Populator passed cleanly, sender processed with zero defaulted-field metrics (`missing_fields: []`), full XML matched every injected value (`<Color>Navy</Color><Item>QA-FIX-E1-1</Item><Size>M</Size><Height>10</Height><Length>20</Length><Width>15</Width><Weight>1.2</Weight>`, `DimensionUm>MM`), **`accepted=2 rejected=0`** (batched with the Desc=200 control). **PASS.**
- **E1 (final):** `QA-FIX-E1-FINAL` — sent 00:46:41Z. Populator passed cleanly, sender processed with `missing_fields: []`, full XML matched every injected value (`<Color>Charcoal</Color><Item>QA-FIX-E1-FINAL</Item><Size>L</Size><Height>12</Height><Length>22</Length><Width>18</Width><Weight>2.1</Weight>`, `DimensionUm>MM`), **`accepted=1 rejected=0`** at 00:48:37Z. **PASS.** The pipeline was healthy at both the start and the end of the pass.

---

## DLQ final state

Two measurements taken: mid-session at JJ's request (00:55Z), and a final check after the full ~20-minute wait (01:07Z).

**Final measured depth (01:06:59Z): 9 messages waiting, 1 still in-flight** — up from the baseline of 4 (+5 confirmed landed, one more still retrying).

**5 new arrivals landed**, confirmed via non-destructive peek (5s visibility timeout, bodies inspected, nothing deleted):

| MessageId | `item_code` | `ApproximateReceiveCount` | Source |
|---|---|---|---|
| `76f643f9-7c13-48b9-bf84-3623ffba39e0` | `QA-D0-SIZE200` | 16 | Gate B/D0 probe — `size_too_long` |
| `b63d9b31-3636-4764-9e21-7e558ecdfbb1` | `QA-D0-SIZE100` | 16 | Gate B/D0 probe — `size_too_long` |
| `c7b4e9bf-3445-4e24-b1f0-9065a9167484` | `QA-D0-SIZE50` | 12 | Gate B/D0 probe — `size_too_long` |
| `2a9a5e0f-7460-4635-897e-d7893afa2422` | `QA-D0-ITEM100-XXX...` | 16 | Gate B/D0 probe — `item_code_too_long` |
| `f70808e2-2756-43b2-b76a-43a67c9497f8` | `""` (true blank) | 12 | **A5** — `missing_item_code`, matching the ERR1 shape exactly, as predicted |

The 4 pre-existing baseline messages (`fc37d02c…` blank `item_code`, `0e7bbc03…` ERR2, `fed32265…` ERR4, `ef413fc6…` blank `item_code`) are all still present, `ApproximateReceiveCount` climbing (17-19) simply from sitting at the retry ceiling, not being reprocessed — the queue is not looping them back through the sender.

**Still in-flight, not yet landed at final check:** `QA-D0-ITEM75` (`item_code_too_long`, crashed in sender ~00:37:36Z) — right at the edge of the ~28-30 min landing window at the time of the final check. Not chased further; DLQ was not purged.

**A5 confirms Q3 definitively**: it landed in the DLQ with the identical `missing_item_code` shape recorded in every prior session (08-10, 08-11) — no change in this pass.

Every poison record landed **with its body intact** (confirmed by the `item_code` fields readable in each peeked message) — consistent with the established bisection/DLQ pattern: no data loss for anything that reaches the sender, only for the populator-level whitespace/length throws (Group A, Gate B's 200-char Item probe), which vanish before ever reaching a queue.

---

## Answers to the brief's summary questions

- **Q1 (Group A outcomes — SCALE, DLQ, or nothing?)** A1/A2/A3/A4/A6/A7a: **nothing** — vanished at the populator, no buffer, no DLQ, no sender, no trace. A5: **DLQ**, confirmed landed (`f70808e2…`, `missing_item_code`, `ApproximateReceiveCount 12`). A7b: **SCALE** — sent alone, accepted.
- **Q2 (A4, D2, D4 — where did the error surface, what did it say, what was left behind?)** A4: populator, `InvalidParameterValue … MessageGroupId …`, nothing left behind (no DLQ trace, matches A1/A2/A3/A6 exactly). D2 (size over-limit): sender, `size_too_long` named reason in `validateItemDownload`, `ManhattanSenderValidationFailure` metric logged first — **confirmed landed in the DLQ for all three variants tested** (25-known-good aside): `QA-D0-SIZE50` (`c7b4e9bf…`), `QA-D0-SIZE100` (`b63d9b31…`), `QA-D0-SIZE200` (`76f643f9…`). D4 (item over-limit): sender, `item_code_too_long`, same shape — **confirmed landed** for the 100-char variant (`2a9a5e0f…`); the 75-char variant was still in-flight at the final 01:07Z check (right at the edge of the ~28-30 min landing window). At 200 chars the populator's SQS `MessageGroupId` cap fires first instead and the record vanishes with no DLQ trace at all (same as Group A's populator-level throws) — that variant never reaches the sender, so it's absent from the DLQ by a different mechanism entirely.
- **Q3 (A5 — same as previously recorded, or different?)** **Identical.** Populator passes `CTC#` cleanly, sender throws `missing_item_code` in `validateItemDownload`, uncaught. No change from the 08-10/08-11 measured behaviour.
- **Q4 (A7 — one SCALE item or two?)** **Neither, in the sense intended** — only one of the two candidate records (the clean one) ever reached SCALE at all; the trailing-space companion vanished at the populator before it could contribute to any coalescing. One item landed, but there was never a genuine pair in the buffer to test coalescing against.
- **Q5 (B/C — exact boundaries? non-ASCII safe? truncation reported?)** Both `Desc` (100) and `Colour` (25) truncate at **exact** boundaries (off-by-one confirmed both ways: at-limit unchanged, limit+1 truncated by exactly one character). Non-ASCII was handled **safely** in both cases — multi-byte characters within the boundary survived intact; the payload was never broken or mangled; a full trailing multi-byte character (or, for B4, the emoji) was dropped whole rather than split. Truncation is **not reported anywhere** — zero log lines or metrics mention truncation in either group.
- **Q6 (E1 — pass at start and end?)** Start: **PASS**, confirmed via full XML match and `accepted=2 rejected=0`. End: **PASS** — `QA-FIX-E1-FINAL` injected 00:46:41Z, processed 00:48:37Z with `missing_fields: []`, full XML match and `accepted=1 rejected=0` (see §E1). The pipeline was healthy at both ends of the pass.
- **Q7 (Group F — live or theoretical?)** **Neither cleanly** — see the TOP OF FILE finding. The one real record found in 90 days carrying this exact whitespace shape (`WTW23-922G  -XS/S/M/L/XL/XXL`, product 29942) passed through the entire live pipeline successfully with zero throws. Not "already eaten" — but also not simply "an input Cin7 would never send," since Cin7 demonstrably does carry this shape in `productOptions[].code`. The reason it didn't break is that the real poller's own `message_group_id` construction differs from bus-injection's raw-concatenation assumption for at least this record.

---

## Questions for dev (Kian, back next week) — not blocking, queued

1. **The four QA-measured character limits need confirming against the implementation:** Desc=100 and Colour=25 are exact; Size is only bracketed to (26, 50) and Item to (51, 74). Can you confirm the exact numbers?
2. **Was the populator supposed to be part of this deploy?** Its `LastModified` (2026-08-03) predates the claimed 08-11/12 fix push, while sender and poller both redeployed 08-12. If the `item_code` trim/whitespace-error logic was meant to live in the populator, it isn't there yet — every Group A whitespace variant reproduced the identical pre-fix throw.
3. **How does the real poller build `message_group_id`?** Group F shows it is NOT a raw `"{company}#{item_code}"` concatenation for at least one confirmed case (`CTC#WTW23-922G_-S` vs. the raw-space `item_code` "WTW23-922G  -S") — an underscore appears where bus-injection's harness (and the LLD's stated approach) would put the literal space. Is this deliberate sanitisation on the poller side, and if so, does it happen for all whitespace shapes (leading/trailing/tab), or only this one?
4. **A4 (whitespace-only `item_code`) still throws with the exact pre-fix `InvalidParameterValue` shape** — is a *new*, distinct "explicit error" for this case actually deployed anywhere, or is Kian's stated intent for this case not yet live (consistent with finding #2 above)?
5. **Size and Item's exact over-length boundaries** — per finding #1, needed to build precise D1-style at-boundary test cases.
6. **Is the `size_too_long`/`item_code_too_long` crash-and-bisect behaviour intentional** for the initial rollout (documented rationale: "important values that should exist, so failing is preferable to silently shortening"), or should these eventually get the same per-record containment fix presumably planned for ERR1/ERR2/ERR4 (skip-and-continue rather than abort-the-batch)?
7. **Does the underscore-substitution behaviour found in Group F generalise**, or is `WTW23-922G` a one-off? If it generalises, does that change how live the CS5 whitespace defect actually is for real Cin7 data (as opposed to bus-injected data)?
