# CTC/Cin7 combined-pass session findings — 2026-08-07 (staging)

Continuation of `SESSION-FINDINGS-2026-08-05.md`, working through the "Suggested next actions"
list in CLAUDE.md's status block. AC-tagged where a specific ticket AC is implicated.

---

## Phase 1 — BUSY-1114 TC7: poller IAM least-privilege review

**Status: PASS.** Read-only IAM inspection, no watermark touched, no Cin7 calls made.

Poller Lambda: `staging-catalog-cin7-cin7-item-poller`
Execution role: `staging-catalog-cin7-stagingcatalogcin7cin7itempoll-2NaErtktKkSY`

**Attached managed policy:** `AWSLambdaBasicExecutionRole` (AWS-managed) — confirmed via
`get-policy-version` to grant only `logs:CreateLogGroup` / `logs:CreateLogStream` /
`logs:PutLogEvents` on `Resource: *`. Standard Lambda logging boilerplate, not app-specific,
`*` is unavoidable for this managed policy (no resource-level log-group ARN was pre-created at
policy-authoring time). Not a least-privilege concern.

**Inline policy** (`stagingcatalogcin7cin7itempollerServiceRoleDefaultPolicyEDA84C00`) — the
actual app-specific grant, verified statement-by-statement:

| Action(s) | Resource | Assessment |
|---|---|---|
| `xray:PutTraceSegments`, `xray:PutTelemetryRecords` | `*` | Expected — X-Ray doesn't support resource-level scoping, `*` is the only valid form. Standard CDK/tracing boilerplate. |
| `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret` | `staging/catalog/cin7` (exact ARN) | **Matches expectation exactly.** Scoped to the one Cin7 secret, no wildcard, no other secrets (confirmed: no `staging/manhattan/oauth2` access). |
| `ssm:DescribeParameters`, `ssm:GetParameters`, `ssm:GetParameter`, `ssm:GetParameterHistory` | `/catalog/cin7-manhattan/item-watermark/staging` (exact ARN) | **Matches expectation exactly.** Read-scoped to the one watermark param only. |
| `ssm:PutParameter` | same watermark param ARN | **Matches expectation exactly.** Write access is scoped identically to the read grant — needed for the poller to advance its own watermark. |
| `events:PutEvents` | `staging-catalog-cin7-events` (its own bus, exact ARN) | **Matches expectation exactly — and confirms the CLAUDE.md gotcha.** The poller can only PutEvents onto its *own* bus, **not** `staging-catalog-manhattan-events`. Least-privilege here inherently proves the two-bus/forwarding-rule architecture from the 2026-08-05/06 findings — the poller has no IAM path to write directly onto the shared Manhattan bus even if the code tried to. |

**No DynamoDB access, no Manhattan secret access, no other resource grants of any kind.** Exactly
the three-permission footprint predicted going in (own watermark param, own secret, own bus) plus
unavoidable Lambda/X-Ray boilerplate. Clean pass — nothing to flag, nothing extra to raise.

**1114 status update:** all 7 TCs now resolved (5 PASS, 1 PASS-needs-writeup already noted
2026-08-06, 1 BLOCKED-by-infrastructure TC5). TC7 was the last open item — **1114 is now fully
closed out from QA's side**, modulo the standing TC5 infrastructure block.

---

---

## Phase 2 — BUSY-1115 TC1: field-by-field mapping via narrow watermark replay

**Blast-radius finding first:** the cheapest achievable "narrow" watermark window this session
cost far more than the 08-05/06 baseline — a 7-minute window alone pulled in 32 triggered
products / 214 would-emit records (vs. ~1 record/minute back then). An initial 2.5-hour test
window would have cost 4131 records; stopped before confirming it. **Catalog/option churn
velocity is currently much higher than the 08-05/06 session's baseline** — worth flagging for
anyone budgeting a future rewind against the 5,000/day cap.

Set watermark to `2026-08-07T01:23:00.000Z` (previewed: 199 would-emit, 31 trigger-sourced
products, 0 primary) with JJ's explicit go-ahead on the cost. Confirmed via poller logs:
- Cycle 1: `productsFetched:51, recordsEmitted:332, watermarkAdvanced:true,
  newWatermark:"2026-08-07T01:31:50.000Z"`
- Cycle 2: `productsFetched:13, recordsEmitted:86, watermarkAdvanced:true,
  newWatermark:"2026-08-07T01:34:40.000Z"`
- No `Cin7PollerCycleFailed` — both cycles clean.
- Organic option-level churn kept advancing the watermark well past this (to
  `2026-08-07T01:55:48.000Z` by the time of writing) — this watermark is still **live/mid-test**,
  not yet unset. Real records from this replay are sitting in the pipeline for the FM/DU
  write-up (pending — see "Still to do" below).

## Phase 3 — Synthetic sweep via emit-cin7-record.sh

Full dry-run sweep first (DU2 matrix, CS1–CS7, XR1/XR3/XR4, WT1, GE2, GE4), reviewed with JJ,
then fired in two sequenced batches per JJ's request: non-poison batch first, wait for it to
process, then the DU2 poison batch, then one control record immediately behind the poison batch
to test whether anything gets stuck behind the retries.

### Batch 1 (14 non-poison-expected records) — mostly clean, one real bug found, one unintentional poison

All 14 sent successfully onto the bus. Outcome:

| Item | Result |
|---|---|
| `TH26-318B-26`, `007-LeadingZero-Test` (CS2) | Accepted — case/hyphen/leading-zero item codes pass through untouched |
| `QA-CS7-BLANKFIELDS` (blank colour/brand) | Accepted |
| `QA-XR1-MULTI`, `QA-XR3-DUP`, `QA-XR4-MALFORMED` (XR1/XR3/XR4) | Accepted — multiple barcodes, duplicate barcodes, and a malformed non-numeric barcode (`ABC-NOT-A-BARCODE!!`) were all accepted by Manhattan without complaint |
| `QA-WT1-ZEROWEIGHT` (WT1) | Accepted, `weight=0` sent through |
| `QA-GE4-BADWEIGHT` (GE4) | Accepted — but see tooling-gap note below, this didn't test what it was meant to |
| `QA-DU2-MM` | Accepted (confirms settled-correct default) |
| `QA-CS3-XMLESC` (`Rock & Roll <Tag> "Quote" 'Apos'`) | Accepted — XML-escaped correctly, no broken payload |
| `QA-CS4-UNICODE` (`Café™ Item ° 🎉 Naïve`) | Accepted — Unicode/emoji passed through and escaped correctly |
| `QA-CS5-WS` (leading/trailing whitespace in item_code) | **See defect below — never reached the queue at all** |
| `QA-CS6-LONGDESC` (~617-char desc) | **See defect below — unintentionally became a poison record** |
| `QA-GE2-BLANKDESC` (`desc=" "`) | Accepted — see tooling-gap note, didn't test the intended true-blank case |

#### DEFECT (new, more severe than the known missing-item_code bug): whitespace in item_code silently drops the record with zero trace

`QA-CS5-WS` (`item_code = "  QA-CS5-WS  "`) never reached the buffer queue, the sender, or any
DLQ. Traced via direct CloudWatch queries (not the standard tail scripts, since the item never
appeared in either the buffer-handler or sender logs) to a Lambda not previously documented in
CLAUDE.md's resource table: **`staging-catalog-manhattan-item-buffer-buffer-populator`** — sits
between the EventBridge rule and the SQS buffer queue (upstream of the "buffer handler" already
in CLAUDE.md). It throws synchronously on `SendMessage`:

```
InvalidParameterValue: Value CTC#  QA-CS5-WS   for parameter MessageGroupId is invalid.
Reason: MessageGroupId can only include alphanumeric and punctuation characters. 1 to 128 in length.
```

because `message_group_id = "CTC#<item_code>"` inherits the raw whitespace and SQS FIFO's
`MessageGroupId` validation rejects it outright (whitespace isn't "punctuation" by its regex).
**Confirmed no safety net exists:** `aws lambda get-function-event-invoke-config` shows no
`EventInvokeConfig` (default async retry only) and `get-function-configuration` shows
`DeadLetterConfig: null`; the EventBridge rule's target has no `RetryPolicy`/`DeadLetterConfig`
either. Because the failure happens *before* the record ever reaches the SQS queue, it can never
land in `staging-catalog-manhattan-item-buffer-dlq.fifo` — after Lambda's default async retries
are exhausted, **the record vanishes with no trace anywhere**, not even a DLQ entry. This is
strictly worse than the already-known missing-`item_code` crash (BUSY-1113/1115), which at least
preserves the record in the DLQ.

**Checked for a live production trigger, not confirmed live yet:** recalled a real product
(29942, "Artisan Suiting Set") whose display `code` field showed padding (`'WTW23-922G  -XS'`)
and re-fetched it directly — the underlying `productOptionCode` itself is clean (`'WTW23-922G'`,
no whitespace), so `item_code` as actually used by the poller wasn't affected in this instance.
No confirmed live trigger yet, but Cin7 free-text fields are evidently not always clean (as the
padded `code` field shows), so this isn't purely theoretical. **Recommend raising as a defect**
— either the mapper should trim `item_code` defensively before building `message_group_id`, or
this Lambda needs a DLQ/retry policy so a similar failure is at least visible instead of silent.

#### Finding: CS6 (very long Desc) is rejected outright by Manhattan, not truncated — exact limit found

`QA-CS6-LONGDESC` (~617 chars) triggered `ManhattanSchemaValidationError`:
```
XML Schema Validation failed : The '...:Desc' element is invalid - The value '...' is invalid
according to its datatype '...:stringLength_100' - The actual length is greater than the
MaxLength value.
```
**Manhattan's `Desc` field has a hard 100-character limit, enforced by rejection, not
truncation.** This correctly entered the standard poison-pill bisection/retry path (logged as
`ERROR Poison pill identified`), same mechanism as prior known poison cases — good corroborating
evidence for the isolation mechanism, this one triggered organically by test data shape rather
than deliberately. Directly answers CS6's open question in EXTENDED-COVERAGE-TEST-CASES.md.

#### Tooling gap found (not a pipeline bug): emit-cin7-record.sh can't produce two of the shapes GE2/GE4 need

- **GE2** wants a genuinely blank/missing `desc`. The script auto-fills a default description
  whenever the value is empty (`if [[ -z "$DESC" ]]`), even from an explicit `--desc ""` — there's
  no way to force a truly blank one through. Used `--desc " "` (whitespace-only) as the closest
  proxy; it was accepted as-is, which doesn't confirm or rule out the "falls back
  displayname→vendor+colour+size" behaviour GE2 is actually testing.
- **GE4** wants a genuinely non-numeric weight on the wire. The script's own `num()` helper
  coerces any unparseable value to `0` *before* building the payload (`--weight "not-a-number"`
  → `weight: 0` in the emitted record) — so this only ever tests the script's own sanitization,
  never the sender's handling of a malformed wire value.
- **Recommend:** add a raw-value escape hatch (e.g. `--desc-raw`/`--weight-raw` that skips the
  script's own validation) if these two cases need to be genuinely exercised later.

### Batch 2 (DU2 poison matrix: M, CM, mm, EA) + control record — poison isolation confirmed fast, nothing got stuck

Fired M, CM, mm, EA, then `QA-POSTPOISON-CONTROL` immediately behind them, specifically to check
JJ's question: does a known-good record get stuck behind poison retries, or does it process
through cleanly?

**Result: nothing got stuck.** The sender's bisection isolated the control record within the
*same* invocation, in about 13 seconds (`01:51:34` batch attempt → `01:51:47` confirmed
`accepted=1 rejected=0`, `outcome:"success"`) — not the ~30-minute poison-to-DLQ timescale.
Trace: `[M, CM, mm, EA, CONTROL]` batch → rejected 3 of 5 (M/CM/EA named) → bisected down →
`[mm, EA, CONTROL]` → rejected 1 of 3 (EA named only, **`accepted:2`** = mm + CONTROL both
succeeded here) → final isolated send of `[CONTROL]` alone → `accepted=1 rejected=0`. The 3
genuine poison items (M, CM, EA) are left correctly queued for their own independent retry cycle
toward the DLQ — confirmed not blocking anything else, consistent with the GE3/ST8 mechanism
already established 08-05/06, now reconfirmed under a live 5-way FIFO-group mix instead of a
single poison item.

**New finding: `DimensionUm` matching is case-insensitive, not exact-match.** Lowercase `mm` was
**accepted** by Manhattan SCALE, same as `MM` — `EA` was rejected
(`Invalid dimension um "EA"`), `M` and `CM` re-confirmed rejected live this session. Full DU2
matrix result:

| Value | Result |
|---|---|
| `MM` | **Accepted** (settled-correct default) |
| `mm` | **Accepted — case-insensitive, new finding** |
| `M` | Rejected (`Invalid dimension um "M"`) — reconfirms known-correct behaviour |
| `CM` | Rejected (`Invalid dimension um "CM"`) — reconfirms the historical claim live, not just from the original doc |
| `EA` | Rejected (`Invalid dimension um "EA"`) |

Worth folding into the doc-correction recommendation already flagged for HLD §5.3/CTC LLD §5:
the accepted value is `MM` case-insensitively, not a single exact string.

**As of writing, watermark is still live** (`2026-08-07T01:55:48.000Z` and climbing from organic
churn), buffer queue has ~56 waiting + 4 in-flight (M/CM/EA + CS6 poison items still mid-retry,
plus organic Phase 2 traffic still draining). DLQ still shows only the 2 pre-existing messages —
the new poison items haven't hit their ~30-min mark yet. Not yet unset — still mid-test.

## 1115 TC1 — field-by-field mapping, resolved against a real emitted record

Cross-referenced the actual emitted Manhattan XML for a real record from the Phase 2 replay
against its raw Cin7 source. Item: `SMU23-135A-M`, product 29881 "Paradox Of Paradise Oversized
Fit Tee - Heritage White" (option size M, `optionWeight=0.28`, `uomOptions=[]`, no product-level
weight/dims, `categoryIdArray=[220]`, `customFields.products_1011="White"`, `optionLabel1=""`,
`brand="Thrills Co."`).

Emitted XML (Item element, from the sender's own `Manhattan ItemDownload payload` log line):
```xml
<Item><Action>SAVE</Action><UserDef1>Thrills Co.</UserDef1><Active>Y</Active><Color>White</Color>
<Company>CTC</Company><Desc>Paradox Of Paradise Oversized Fit Tee - Heritage White</Desc>
<Item>SMU23-135A-M</Item><ItemClass><ItemClass>CTC-220</ItemClass></ItemClass>
<InventoryTracking>Y</InventoryTracking><LotControlled>N</LotControlled>
<SerialNumTrackOutbound>N</SerialNumTrackOutbound><Size>M</Size>
<UOMS><UOM><Action>SAVE</Action><ConvQty>1</ConvQty><DimensionUm>MM</DimensionUm>
<Height>0.1</Height><Length>0.1</Length><QtyUm>EA</QtyUm><TreatAsLoose>Y</TreatAsLoose>
<TreatFullPct>100</TreatFullPct><Weight>0.28</Weight><WeightUm>KG</WeightUm><Width>0.1</Width>
</UOM></UOMS><XRefs><XRef><Action>SAVE</Action><XRefGtinEnabled>N</XRefGtinEnabled>
<XRefItem>9351055593315</XRefItem><XRefUM>EA</XRefUM></XRef></XRefs></Item>
```

| ID | Result |
|---|---|
| FM1 | **PASS** — `Action=SAVE`, `Active=Y`, `Company=CTC`, exact case |
| FM2 | **PASS, with a precision note.** `Item=SMU23-135A-M` — this is `productOptions.code` / `productOptionSizeCode` (the *size-suffixed* code), **not** the bare `productOptionCode` (`SMU23-135A`) that CLAUDE.md's "Emitted record shape" section describes (`item_code:<productOptionCode>`). Makes sense functionally (each size needs its own Manhattan item), but the doc's shorthand is imprecise — worth a one-line correction. |
| FM3 | **RESOLVED — follows HLD.** Emitted `Desc` exactly matches Cin7 `name` ("Paradox Of Paradise Oversized Fit Tee - Heritage White"), not `description` (which is HTML-wrapped: `<p>...</p>`). Code follows HLD, not LLD. |
| FM4 | **RESOLVED — follows HLD framing.** `ItemClass=CTC-220` = `CTC-` + first (only) entry of `categoryIdArray` ([220]). No zero-padding seen (naturally 3 digits). Cin7 doesn't expose a singular `categoryId` field the LLD's wording implies — `categoryIdArray` is the only real source, so LLD's naming is the imprecise one here. |
| FM5 | **RESOLVED — follows HLD.** Emitted `Size=M` matches bare `productOptions.size` ("M"), not LLD's `productOptionSizeCode` (which would be "SMU23-135A-M", the whole compound code — that value went into `Item`/FM2 instead, not `Size`). |
| FM6 | **RESOLVED — follows HLD.** Emitted `Color=White` matches `customFields.products_1011` exactly; `optionLabel1` (LLD's claimed source) is blank on this product. Code follows HLD, not LLD. |
| FM7 | **PASS** — `InventoryTracking=Y`, `LotControlled=N` |
| FM8 | **PASS** — `SerialNumTrackOutbound=N`, static for CTC |
| FM9 | **PASS** — UOM statics `Action=SAVE`, `TreatAsLoose=Y`, `TreatFullPct=100` all correct |
| FM10 | **PASS** — `ConvQty=1`; this option's `uomOptions=[]`, confirming the "else 1" default branch on a real (not synthetic) record |
| FM11 | **PASS** — one `<XRef>` for the one real barcode (`9351055593315`), matches Cin7 `barcode`/`productOptionSizeBarcode` (identical values on every real record seen so far — `productOptionBarcode` is separately blank in every sample, so which of the two identical fields is the literal source remains indeterminate from available data, not that it matters functionally) |
| FM12 | **RESOLVED — present, follows HLD.** `UserDef1=Thrills Co.` = Cin7 `brand`, exactly as HLD claims mandatory. LLD's omission of this field from its table is the gap, not the code. |
| FM13 | **MOSTLY true, one concrete deviation found.** `UserDef1` directly after `Action` — confirmed. But the rest is **not** strictly alphabetical: `InventoryTracking` should sort before `Item`/`ItemClass` alphabetically (`In...` < `It...`) but is actually emitted *after* both. Everything else in this sample (`Active, Color, Company, Desc, ... LotControlled, SerialNumTrackOutbound, Size`) is in alphabetical order. Minor, cosmetic, but a real, reproducible deviation from the documented ordering rule — worth a doc note or a one-line code fix, not a functional bug. |
| DU1 | **PASS** — another real (not synthetic) confirmation: blank product-level dims → `DimensionUm=MM`, `Height/Length/Width=0.1` |
| DU5 | **PASS** — `QtyUm=EA`, `WeightUm=KG`, correct case, on a real record |
| DU6 | **PASS** — `uomOptions=[]` on the real Cin7 option still produced exactly one `<UOM>` entry defaulting `ConvQty=1`/`QtyUm=EA`, confirmed on real (not synthetic) data |

**Net effect: every row in EXTENDED-COVERAGE-TEST-CASES.md §0's spec-discrepancy table is now
resolved** (FM3/FM4/FM5/FM6/FM12 all follow HLD, not LLD; `DimensionUm` was already closed
2026-08-07 pre-session). Only remaining open items are the two cosmetic notes above (FM2's
doc wording, FM13's ordering exception) — both spec/doc corrections for dev/BA, not code bugs.
**1115 TC1 is effectively complete** — recommend marking it PASS with these notes rather than
NOT DONE in the status block.

Watermark unset at `2026-08-07T02:01Z` once Phase 2 organic traffic fully drained (buffer queue
back to 0 waiting; only the 4 known poison items remained in-flight, independent of the poller).

## Phase 4 — 1116 bounded look-back reset: SKIPPED this session, elevated-churn finding

Before firing anything, previewed candidate look-back windows to size the cost (no watermark
write, preview-only):

| Window | Would emit |
|---|---|
| 1 hour back | **1,422 records** (194 triggered products) |
| 6 hours back | **4,949 records** (678 triggered products) — essentially the entire 5,000/day cap in one window |

**Today's catalog/option churn rate is ~24x the 08-05/06 baseline** (~24 records/min vs ~1/min
observed back then). The original Phase 4 plan ("bounded look-back first, measure, then
extrapolate") assumed a scale where a short window stays cheap — at today's rate, even the
smallest useful look-back window is comparable in cost to the historical *full* bulk-reseed
baseline (~4,671 records) that Phase 4 was meant to bound safely *below*. Flagged this to JJ
before confirming anything; **JJ's call: skip Phase 4 for today entirely**, defer the bounded
look-back/runbook work to a quieter period rather than spend a third-to-all of the daily budget
on a single data point. No watermark write made for this phase — preview-only, zero real cost.

**Poison drain — confirmed clean, all 4 landed.** Peeked the DLQ non-destructively (5s
visibility timeout, nothing deleted) at two checkpoints:
- `QA-CS6-LONGDESC` landed first, ~02:12 (10 retries from its earlier first-failure at 01:42:43)
- `QA-DU2-M`, `QA-DU2-CM`, `QA-DU2-EA` landed by ~02:23 (10 retries each from first-failure at
  ~01:51:43–01:51:48)

DLQ now holds 6 messages total: the 2 pre-existing (missing-item_code, `QA-TEST-DIMUOM-1` from
08-05/06) plus these 4 new ones. All bodies verified intact and byte-for-byte matching what was
sent. **Zero data loss, zero stuck messages, exactly the established ~30-min/10-retry mechanism**
— reconfirms the bisection/DLQ path holds even with 4 concurrent unrelated poison items landing
independently rather than just one.

## Still to do

- 1116 Phase 4 bounded look-back reset + runbook draft — deferred to a quieter-churn session.
- Raise the 3 confirmed defects from 08-05/06 plus the 2 new ones from this session (CS5
  whitespace silent-drop, CS6 100-char Desc limit as a documentation item) in Jira.
- Housekeeping: DLQ now has 6 inert synthetic/test messages total (up from 2) — all safe to
  purge whenever, kept as evidence per the existing 08-05/06 convention.
