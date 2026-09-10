# Extended coverage & DimensionUm deep-dive — CTC/Cin7 (1114/1115/1116)

Companion to `STRESS-AND-ERROR-TEST-CASES.md`. These target **field-by-field mapping correctness,
value/case sensitivity, encoding, identity/collision, extraction edges, and update semantics** —
the gaps not covered by the functional TCs in the Confluence docs. Goal: over-cover for a confident
sign-off. All **NOT RUN** until executed.

> **⚠ Currency note (2026-08-12).** Kian pushed fixes to staging on 08-11/12 for `item_code`
> whitespace and for `Desc`/`colour` length. **CS5 and CS6 below are both affected and both
> re-opened** — read their updated rows, and read `CTC-FIX-RETEST-BRIEF.md` (the active pass) plus
> `CTC-QA-STATE-INDEX.md` (reconciled current state) before treating any status here as final.

Read `CLAUDE.md` + `SESSION-FINDINGS-2026-08-05.md` first; standing guardrails apply (prod read-only
Cin7, preview before every rewind, serialized watermark, dry-run default, flag blast radius). Primary
levers: `emit-cin7-record.sh` (exact synthetic content), `cin7-watermark.sh` (real-data replay),
`find-cin7-item.sh` / `find-cin7-product-by-id.sh` (real shapes), `tail-logs.sh`, SCALE UI. Judge
outcome from the sender log / `rejectedTransactions`, never HTTP status.

> When bus-injecting, prefer verifying a field against a **real Cin7-sourced** record too — the
> synthetic path can mask a real extraction/mapping bug. `emit-cin7-record.sh` proves the *mapper*;
> a watermark replay proves the *poller extraction + mapper* together.

---

## 0. Spec discrepancies to resolve (drive several TCs below)

The written specs disagree with each other and/or the code. QA can't declare "correct" until these
are settled with dev/BA — for each, record what the **deployed code actually emits** and flag the mismatch.

**✅ ALL ROWS RESOLVED as at 2026-08-07** — verified against a real emitted Manhattan payload (item
`SMU23-135A-M`, product 29881 "Paradox Of Paradise Oversized Fit Tee - Heritage White") cross-checked
against its raw Cin7 source. **The code follows HLD §5.3 in every disputed case; the CTC LLD §5 is
the stale document.** These are now **doc corrections for dev/BA, not code bugs or test failures.**

| Field | HLD §5.3 | CTC LLD §5 | Resolved — what the code actually does | TC |
|---|---|---|---|---|
| ~~`DimensionUm`~~ | ~~table `M` / example `MM`~~ | ~~`M`~~ | **`MM` (case-insensitive) — code correct** | DU1–DU3 |
| dim magnitude | example `10/100/100` | `0.1` default | `0.1` — accepted by SCALE | DU4 |
| ~~`Desc`~~ | ~~Cin7 `name`~~ | ~~Cin7 `description`~~ | **Cin7 `name` → follows HLD.** `description` is HTML-wrapped (`<p>…</p>`) and is not used | FM3 |
| ~~`Size`~~ | ~~`productOptions.size`~~ | ~~`productOptionSizeCode`~~ | **bare `productOptions.size` (`M`) → follows HLD.** The compound code goes to `Item`, not `Size` | FM5 |
| ~~`Color`~~ | ~~`customFields.products_1011`~~ | ~~`optionLabel1`~~ | **`customFields.products_1011` → follows HLD.** `optionLabel1` was blank on the sample | FM6 |
| ~~`Weight` default~~ | ~~`0.1`~~ | ~~`0` sentinel~~ | **`0` sentinel**, no defaulted-field metric fires | WT1 |
| ~~`UserDef1` = brand~~ | ~~mandatory~~ | ~~absent from LLD~~ | **Present and correct** (`UserDef1=Thrills Co.` ← Cin7 `brand`) → **the LLD's omission is the gap** | FM12 |
| ~~`ItemClass` category~~ | ~~first of `categoryIdArray`~~ | ~~`categoryId`~~ | **`CTC-` + first of `categoryIdArray`** (`CTC-220`). Cin7 exposes no singular `categoryId`, so the LLD's naming is the imprecise one | FM4 |

**Two new items found while resolving these — both cosmetic, neither a functional bug:**
1. **`item_code` is the size-suffixed code** (`SMU23-135A-M` = `productOptions.code` /
   `productOptionSizeCode`), **not** the bare `productOptionCode` (`SMU23-135A`) that CLAUDE.md and
   the QA docs state. Correct behaviour (one Manhattan item per size); the *wording* is wrong, and it
   appears in **1114 TC3** — fix before sign-off.
2. **Element ordering (FM13) has one real exception.** `UserDef1` directly after `Action` holds, and
   everything else is alphabetical — except `InventoryTracking`, which emits *after* `Item` and
   `ItemClass` despite sorting before them. Reproducible; doc note or a one-line fix.

> ✅ **`DimensionUm` is RESOLVED — closed with dev + the design council, 2026-08-07.** Converting to
> `MM` so Manhattan accepts it is the **intended, correct** behaviour; the HLD/LLD were simply never
> updated. SCALE rejects `M` and `CM` and accepts only `MM`. **Every DU test case below PASSES when
> the value converts to `MM` and Manhattan accepts it** — do not record a fail, a partial, or a
> defect against any of them. The only action left is a doc correction for dev/BA. DU1–DU3 are now
> *confirmation/regression* checks, not open questions.

---

## A. DimensionUm / UOM deep-dive (DU)

| ID | Status | Result / evidence (2026-08-07 unless noted) |
|---|---|---|
| DU1 | **PASS** | Confirmed on both synthetic (`QA-DU2-MM`) and **real** data — item `SMU23-135A-M` had blank product-level dims and emitted `DimensionUm=MM`, `Height/Length/Width=0.1`, `ConvQty=1`, accepted. |
| DU2 | **PASS (matrix complete)** | Full acceptance matrix run live: `MM` **accepted** · `mm` **accepted — case-insensitive, new finding** · `M` rejected (`Invalid dimension um "M"`) · `CM` rejected (historical claim now confirmed live, not just from the doc) · `EA` rejected. **The rejections are expected and correct**, not pipeline failures — `MM` is the settled value. Fold the case-insensitivity into the HLD/LLD doc correction: the accepted value is `MM` *case-insensitively*, not one exact string. |
| DU3 | **PASS** | Sender emits a supplied non-blank value verbatim; only blank triggers the default. Confirmed across the DU2 matrix values. |
| DU4 | **PASS on acceptance** | SCALE accepts `0.1`. No test fails here. Still **informational, open for warehouse/dev**: does SCALE cube/cartonise off CTC item dims? If yes, revisit the `0.1` magnitude as a design decision — never as a QA defect. |
| DU5 | **PASS** | `QtyUm=EA`, `WeightUm=KG`, correct case, confirmed on a **real** record. |
| DU6 | **PASS** | Real Cin7 option with `uomOptions=[]` still produced exactly one `<UOM>` entry defaulting `ConvQty=1` / `QtyUm=EA`, per HLD §5.3. Confirmed on real, not synthetic, data. |

## B. Field-by-field mapping verification (FM) — check every LLD §5 / HLD §5.3 row

**COMPLETE as at 2026-08-07 — this closes BUSY-1115 TC1.** Verified against the real emitted
Manhattan `ItemDownload` payload for item **`SMU23-135A-M`** (product 29881, "Paradox Of Paradise
Oversized Fit Tee - Heritage White"; option size M, `optionWeight=0.28`, `uomOptions=[]`, no
product-level weight/dims, `categoryIdArray=[220]`, `customFields.products_1011="White"`,
`optionLabel1=""`, `brand="Thrills Co."`), cross-checked field-by-field against its raw Cin7 source.

| ID | Status | Result |
|---|---|---|
| FM1 | **PASS** | `Action=SAVE`, `Active=Y`, `Company=CTC` — exact case. |
| FM2 | **PASS — with a doc correction** | `Item=SMU23-135A-M`. This is `productOptions.code` / `productOptionSizeCode` (the **size-suffixed** code), **not** the bare `productOptionCode` (`SMU23-135A`) the docs describe. Functionally right (one Manhattan item per size); the wording is wrong and also appears in **1114 TC3**. |
| FM3 | **PASS — follows HLD** | `Desc` = Cin7 `name`, not `description` (which is HTML-wrapped `<p>…</p>`). LLD is wrong. |
| FM4 | **PASS — follows HLD framing** | `ItemClass=CTC-220` = `CTC-` + first entry of `categoryIdArray` ([220]). No zero-padding observed (naturally 3 digits). Cin7 exposes no singular `categoryId`, so the LLD's field name is the imprecise one. Blank → `CTC-000` separately confirmed 08-05/06. |
| FM5 | **PASS — follows HLD** | `Size=M` = bare `productOptions.size`. LLD's `productOptionSizeCode` would have been the whole compound code, which went to `Item` instead. |
| FM6 | **PASS — follows HLD** | `Color=White` = `customFields.products_1011`. `optionLabel1` (LLD's claimed source) was blank on this product. |
| FM7 | **PASS** | `InventoryTracking=Y`, `LotControlled=N`. |
| FM8 | **PASS** | `SerialNumTrackOutbound=N`, static for CTC. |
| FM9 | **PASS** | UOM statics `Action=SAVE`, `TreatAsLoose=Y`, `TreatFullPct=100`. |
| FM10 | **PASS** | `ConvQty=1` — this option's `uomOptions=[]`, confirming the "else 1" branch on **real** data. |
| FM11 | **PASS** | One `<XRef>` for the one real barcode (`9351055593315`). Note: `barcode` and `productOptionSizeBarcode` are identical on every real record seen, and `productOptionBarcode` is blank in every sample — so which is the literal source is indeterminate from available data. Functionally irrelevant. |
| FM12 | **PASS — present, follows HLD** | `UserDef1=Thrills Co.` = Cin7 `brand`, exactly as HLD says. **The LLD omitting this field from its table is the gap, not the code.** |
| FM13 | **PASS with one concrete deviation** | `UserDef1` directly after `Action` — confirmed. Everything else alphabetical **except `InventoryTracking`**, which emits *after* `Item`/`ItemClass` despite `In…` < `It…`. Reproducible; cosmetic. Doc note or a one-line fix, not a functional bug. |

## C. Case-sensitivity, encoding & string handling (CS)

| ID | Status | Result (2026-08-07 synthetic sweep via `emit-cin7-record.sh`) |
|---|---|---|
| CS1 | **PASS** | Exact case on every static — `CTC`, `SAVE`, `Y`, `EA`, `KG`, `MM`. No drift. |
| CS2 | **PASS** | `TH26-318B-26` (mixed case + hyphens) and `007-LeadingZero-Test` both accepted, passed through untouched — leading zeros preserved as string, not coerced numeric. |
| CS3 | **PASS** | `QA-CS3-XMLESC` (`Rock & Roll <Tag> "Quote" 'Apos'`) escaped correctly, accepted, no broken payload. |
| CS4 | **PASS** | `QA-CS4-UNICODE` (`Café™ Item ° 🎉 Naïve`) encoded and escaped correctly, accepted. |
| CS5 | **🔴 DEFECT — record silently destroyed, no trace anywhere** | `QA-CS5-WS` (`item_code = "  QA-CS5-WS  "`) **never reached the buffer queue, the sender, or the DLQ.** `message_group_id="CTC#<item_code>"` inherits the raw whitespace and SQS FIFO rejects it (`InvalidParameterValue: … MessageGroupId can only include alphanumeric and punctuation characters`). The throw happens in **`staging-catalog-manhattan-item-buffer-buffer-populator`, upstream of the SQS queue** — which has no `EventInvokeConfig`, no `DeadLetterConfig`, and no EventBridge target retry/DLQ policy, so after default async retries **the record vanishes with no DLQ entry**. **Strictly worse than the missing-`item_code` crash**, which at least preserves the record. **Fix: trim `item_code` before building `message_group_id`, and/or give that Lambda a DLQ.**<br><br>**⚠ UPDATED 2026-08-10/11/12 — three things have changed since this row was written.**<br>**(a) The original repro used leading/trailing whitespace** (`"  QA-CS5-WS  "`). An **interior** space (`"QA-CS5A INTERIOR"`) reproduces the identical failure, so **a trim alone cannot fix this**.<br>**(b) A DLQ alone would not fix it either.** The deployed populator wraps its queue push in `try { … } catch (e) { console.log(e) }` — the throw is swallowed and never rethrown, so the invocation completes normally: `Invocations` increments, **`Errors` stays 0**. Lambda only redrives to a `DeadLetterConfig` on an actual unhandled invocation failure, which this never is from Lambda's point of view. The fix needs the **exception handling changed** (rethrow, or an explicit custom metric), not just infra bolted around the current swallow-and-log.<br>**(c) The "no confirmed live trigger" claim is RETRACTED.** It rested on product 29942's `productOptionCode` being clean — but `item_code` is the **size-suffixed** code (`productOptions.code`), not `productOptionCode`, so that check read the wrong field. `'WTW23-922G  -XS'` is exactly the size-suffixed shape with an **interior double space**. **Whether this has already destroyed a real record is OPEN** — `CS5-LIVE-TRIGGER-CHECK.md` settles it (one free Insights query + one Cin7 request) and **has never been run**.<br><br>**2026-08-12: Kian has pushed a fix to staging** — leading/trailing whitespace stripped, whitespace-only codes erroring. **Interior spaces are not mentioned.** Untested; re-tested as Group A of `CTC-FIX-RETEST-BRIEF.md`. |
| CS6 | **RE-OPENED 2026-08-12 — behaviour is changing** | *(08-07)* `QA-CS6-LONGDESC` (~617 chars) → `ManhattanSchemaValidationError`: `Desc` fails datatype `stringLength_100`. **Manhattan's `Desc` has a hard 100-character limit enforced by rejection**, and the record entered the normal poison-pill bisection path, draining to the DLQ at ~02:12.<br><br>**⚠ 2026-08-12: Kian has pushed a truncation function to staging** so long values are shortened on our side before they reach Manhattan — the same for **colour**. **Manhattan's limit is unchanged; what changed is whether we send it something that breaches it.** Untested. Re-tested as Group B of `CTC-FIX-RETEST-BRIEF.md`, which also probes the **exact 100/101 boundary for the first time** (this row only ever tested 617 chars, so the boundary itself is unverified) and the multi-byte case at the boundary. Note **CS4 passed unicode content but nowhere near the limit** — the combination is new. |
| — | **GAP — no coverage** | **Nothing in this file or `STRESS-AND-ERROR-TEST-CASES.md` tests `colour` or `size` length limits**, and the limits themselves are documented nowhere — not in LLD §5, not on the Manhattan *Connections* page. Only `Desc = 100` is evidenced. Picked up as Groups C and D of `CTC-FIX-RETEST-BRIEF.md`; the numbers need to come from Kian. |
| CS7 | **PASS** | `QA-CS7-BLANKFIELDS` (blank colour/brand) accepted, handled consistently, no crash. |

## D. Barcodes / XRefs (XR)

| ID | Status | Result |
|---|---|---|
| XR1 | **PASS** | `QA-XR1-MULTI` — multiple barcodes accepted, one `<XRef>` block each. Also confirmed on real data (FM11: single real barcode → single `<XRef>`). |
| XR2 | **PASS** | Empty `<XRefs></XRefs>` accepted (08-05/06 via `--no-barcode`). |
| XR3 | **PASS (accepted, no de-dup)** | `QA-XR3-DUP` — duplicate barcodes accepted by Manhattan without complaint. No de-duplication occurs; record as observed behaviour. |
| XR4 | **PASS (accepted)** | `QA-XR4-MALFORMED` — a non-numeric barcode (`ABC-NOT-A-BARCODE!!`) was **accepted** by Manhattan without validation. Worth noting: SCALE applies no barcode format validation, so garbage in Cin7 propagates silently. Informational, not a pipeline defect. |

## E. Identity, collision & ordering (ID)

| ID | Test | Drive | Expected |
|---|---|---|---|
| ID1 | UNI vs CTC same numeric code | ensure a UNI item and a CTC item share a code | Both land distinct in SCALE; `message_group_id` `UNI#` vs `CTC#`; coalesce key `(company,item_code)` never collides |
| ID2 | Duplicate `productOptionCode` within one product | find/inject anomaly | Defined behaviour (dedupe or last-wins), no crash |
| ID3 | `read_at` last-write-wins | two records same `item_code`, different `read_at`, out of order (bus-inject) | Newer `read_at` wins regardless of arrival order (also unit-covered) |
| ID4 | Coalesce across a straddled flush | duplicate emits split across two ~3-min flushes | Net SCALE state = single upsert (judge net, not one flush) |

## F. Poller / watermark / extraction edges (PW)

| ID | Test | Drive | Expected |
|---|---|---|---|
| PW1 | Watermark boundary (`>=` vs `>`) | set watermark exactly to a record's `modifiedDate` | Record included (filter is `>= watermark − 5 min`); confirm no off-by-one drop |
| PW2 | 5-min overlap re-emit | narrow window straddling the overlap | Overlap duplicates emitted then coalesced — no dupes in SCALE |
| PW3 | Pagination boundary | window returning exactly 250 / 251 rows | Page 2 fetched; all records emitted; no truncation |
| PW4 | Trigger id-chunking / where-clause 404 | window pulling many trigger parents (> `CIN7_ID_FILTER_BATCH_SIZE`) | Parents fetched in chunks; no Cin7 where-clause-length 404; all built from full product read |
| PW5 | Option status filtering | product with Primary + Disabled/Active options | Confirm which option statuses emit (find-cin7-item shows Primary/Active/Disabled) vs the "no status filtering" claim |
| PW6 | Blank `productOptionCode` at the poller | real/observed option with blank code | Poller-side: INFO skip, no emit, no error metric (distinct from the sender-side crash bug) |
| PW7 | Product with zero eligible options | find such a product | No emit; cycle still completes |
| PW8 | Watermark advance = max across BOTH endpoints | multi-endpoint cycle | Watermark = max `modifiedDate` seen across `/Products` + `/ProductOptions`, only on full success |
| PW9 | UTC / DST correctness | set watermark around an AEST/UTC boundary | Correct window; no 10/11-hour skew (cin7-watermark.sh enforces UTC) |

## G. Update / idempotency semantics (UP)

| ID | Test | Drive | Expected |
|---|---|---|---|
| UP1 | Create → update same item | replay a real product edit, then another | SCALE upserts (SAVE), single item, fields updated — no duplicate |
| UP2 | Field cleared in source | barcode/colour removed then re-synced | Does SCALE clear it or retain (SAVE is additive)? Record — may be a data-hygiene gap |
| UP3 | Idempotent re-send | re-emit identical record | No duplicate, no side effect (confirmed at overlap; re-confirm explicitly) |
| UP4 | Reactivation | (N/A — Active always Y, no deactivation for CTC) | Confirm no path sets `Active=N` |

## H. Weight default (WT)

| ID | Status | Result |
|---|---|---|
| WT1 | **PASS — LLD's `0` sentinel is correct** | `QA-WT1-ZEROWEIGHT` accepted with `weight=0` sent through. Confirms the LLD sentinel, not HLD's `0.1`. **No `DefaultedField weight` metric fires** for `weight=0` (unlike height/length/width/UOM) — still to confirm as by-design with dev, but not a failure. |
| WT2 | **PASS** | Real product 31679 (`WWORR23-509F-One Size`, `weight=0`) delivered end-to-end through the real poller 2026-08-06 — same behaviour as synthetic. |

---

## Progress summary (2026-08-07)

**DONE:** §0 spec discrepancies (all resolved — code follows HLD) · §A DU1–DU6 · §B FM1–FM13
(closes 1115 TC1) · §C CS1–CS7 · §D XR1–XR4 · §H WT1–WT2.

**STILL NOT RUN:** §E ID1–ID4 (identity/collision — some need coordinated UNI+CTC or multi-cycle
timing) · §F PW1–PW9 (poller/watermark edges — need targeted narrow watermark windows, and
**windows are currently expensive**: ~24 records/min churn, a 7-min window = 214 records; preview
every one and consider waiting for a quieter period) · §G UP1–UP4 (update semantics).

**Findings raised from this sweep:** CS5 whitespace silent-drop (**defect — priority**), CS6
100-char `Desc` limit (doc item), FM2 `item_code` wording (doc), FM13 `InventoryTracking` ordering
(cosmetic), DU2 case-insensitivity (doc), XR3/XR4 no de-dup and no barcode validation
(informational). Anything revealing a source-field mismatch is a **spec-vs-code** finding for
dev/BA, not a code bug — record which of HLD/LLD the code follows.
