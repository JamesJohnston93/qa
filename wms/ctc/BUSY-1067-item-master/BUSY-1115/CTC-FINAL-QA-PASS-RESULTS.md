# Final QA pass results — BUSY-1115

**Executed:** JJ (QA) via Claude Code · **Date:** 2026-08-13 · Stage: staging · Region: ap-southeast-2 · Profile: staging
**Brief:** `CTC-FINAL-QA-PASS-BRIEF.md` Rev 3 · Part A (§4–§6) then Part B (§7)

---

## 0. Header

| Item | Value |
|---|---|
| Poller `LastModified` (§4a) | `2026-08-12T22:45:44Z` — unchanged from baseline |
| Populator `LastModified` (§4a) | `2026-08-03T13:02:56Z` — unchanged from baseline |
| Sender `LastModified` (§4a) | `2026-08-12T22:46:32Z` — unchanged from baseline |
| `SINCE` floor used | `2026-08-13T02:38:00.000Z` (1-hour rewind, cap respected) |
| Preview (§4c) would-emit count | **1,658 records** — **0 `[primary]`, 1,658 `[trigger]`**, 233 distinct trigger-only products |
| Candidate record chosen | `PA26-102I-XS` / sibling `PA26-102I-XXL` (product only reachable via the `/ProductOptions` trigger path in its emitting cycle — see AC2 below) |
| DLQ baseline (§4b, before Part A) | 10 waiting, 0 in-flight |
| DLQ depth at report time | 12 waiting, 0 in-flight, still rising (see §4 below — 8 Part B poison probes sent, each takes ~10 retries/~28–30 min to land; not all have completed as of writing) |
| Run window | Watermark set 2026-08-13T03:46Z; **intended** to be unset by ~03:56Z but did not actually go inactive until 04:31:50Z — see the incident in §1 below. Part B probes sent 03:59:47Z–04:24:08Z. |

---

## 1. ⚠ Incident — the mandatory §6 watermark UNSET did not take effect for ~33 minutes

Recording this prominently because it happened mid-pass and materially changes what "the watermark was idle" means for the rest of this report.

**Sequence, all directly observed (SSM `get-parameter` + poller CloudWatch logs), no inference:**

1. `cin7-watermark.sh --unset --confirm` was run once Part A's evidence capture was complete (~03:56Z). The command reported success (`Watermark updated: UNSET`).
2. The poller kept running active cycles anyway — `Cin7PollerCycleComplete` with a real `newWatermark` fired at 03:58:52, 04:03:20, 04:04:51, 04:07:54, 04:10:53, 04:13:52, 04:16:52, 04:19:54, 04:22:51, 04:25:54, and 04:28:52 — **11 more active cycles** after the unset was confirmed.
3. A direct SSM read at ~04:25Z (prompted by a mid-session DLQ check) showed the watermark parameter's live value as `2026-08-13T04:25:08.000Z`, last modified `04:25:54Z` — i.e. the poller itself was still advancing it in real time, not serving a stale cached value.
4. A second `cin7-watermark.sh --unset --confirm` was issued immediately (04:28:45Z). The poller ran one more active cycle at 04:28:52, then logged `Cin7ItemPollerInactive` starting at 04:31:50Z and again at 04:34:50Z — confirmed via direct SSM read (`UNSET`) and the log lines together.

**Net effect:** across the 15 active cycles from the original 03:46:51Z set through 04:28:52Z, the poller emitted **~3,257 real records** to Manhattan SCALE staging and made on the order of 40+ real Cin7 API calls — roughly **1,108 records / ~30+ calls of that were after the first UNSET was confirmed and believed to have taken effect**, i.e. unplanned relative to the brief's mandatory idle window.

This is well beyond the ~1–2 cycle (~3–10 min) propagation lag CLAUDE.md's existing SSM-caching-lag gotcha describes. Recorded here as an observation only — not diagnosing why. See Q6 in §9.

**Everything reported below still holds** — the extra cycles were the poller's normal real-data code path (same as the intended window), so no evidence is invalidated, but the actual "poller active" window for this session was 03:46:51Z–04:28:52Z, not the planned ~10 minutes.

---

## 2. Part A — capture

### AC1 — fully-populated Cin7 item, every LLD field verified

Candidate: `PA26-102I-XS` (also captured sibling `PA26-102I-XXL`), product "Cherub Tee - Blackberry", emitted in the poller cycle starting 03:46:51Z (`productsFetchedPrimary:0` for that cycle — i.e. this record could only have come from the trigger path). Real sender XML, `accepted=N rejected=0` on every batch this session (8 batches checked, all `rejected=0`):

```xml
<Item><Action>SAVE</Action><UserDef1>WORSHIP</UserDef1><Active>Y</Active><Color>Purple</Color>
<Company>CTC</Company><Desc>Cherub Tee - Blackberry</Desc><Item>PA26-102I-XS</Item>
<ItemClass><ItemClass>CTC-220</ItemClass></ItemClass><InventoryTracking>Y</InventoryTracking>
<LotControlled>N</LotControlled><SerialNumTrackOutbound>N</SerialNumTrackOutbound><Size>XS</Size>
<UOMS><UOM><Action>SAVE</Action><ConvQty>1</ConvQty><DimensionUm>MM</DimensionUm><Height>0.1</Height>
<Length>0.1</Length><QtyUm>EA</QtyUm><TreatAsLoose>Y</TreatAsLoose><TreatFullPct>100</TreatFullPct>
<Weight>0.27</Weight><WeightUm>KG</WeightUm><Width>0.1</Width></UOM></UOMS>
<XRefs><XRef><Action>SAVE</Action><XRefGtinEnabled>N</XRefGtinEnabled>
<XRefItem>9346792174392</XRefItem><XRefUM>EA</XRefUM></XRef></XRefs></Item>
```

| Element | Expect | Observed | Populated or defaulted? |
|---|---|---|---|
| `<Item>` | option code | `PA26-102I-XS` | real |
| `<Desc>` | product name | `Cherub Tee - Blackberry` | real |
| `<ItemClass>` | real class, not `CTC-000` | `CTC-220` | real (from `categoryIdArray[0]`) |
| `<Size>` / `<Color>` | real, non-blank | `XS` / `Purple` | real |
| `<XRefs>` | populated barcode | `<XRefItem>9346792174392</XRefItem>` | real |
| `<UserDef1>` | brand | `WORSHIP` | real |
| `<Weight>` | real weight, not 0 | `0.27` | real |
| `<Height>`/`<Length>`/`<Width>`/`<DimensionUm>` | real, not `0.1` defaults | `0.1` / `0.1` / `0.1` / `MM` | **defaulted** |
| UOM `conversion_rate`/`qty_uom` | real | `ConvQty=1`, `QtyUm=EA` | **defaulted** |

`missing_fields` for this record: `["height","length","width","conversion_rate"]` — not empty, confirming the dims/conversion block is defaulted, not genuinely populated.

**This is not an isolated gap.** Across the full session — the 1,658-record `preview-cin7-sync.sh` dry run *and* every one of the ~3,257 records actually emitted live across all 15 poller cycles — **zero** records carried a non-default `height`/`length`/`width`. 1,652 of the preview's 1,658 candidates were missing exactly `dimension_uom, qty_uom, height, length, width, conversion_rate`; the other 6 were additionally missing `weight`. Barcode (`ean`) was populated on 1,649/1,658 (99.5%), colour on 100%, and real (non-`CTC-000`) category on effectively all of them.

**AC1 verdict: PARTIAL, unchanged in substance from the pre-pass state.** This pass upgrades the evidence quality (barcode + category + colour + brand now verified together on one *real*, trigger-sourced, non-bus-injected record) but **cannot close the dimensions clause** — a genuinely populated `height`/`length`/`width` real Cin7 item did not appear anywhere in this 1-hour window (preview or live), so per §4c's decision table this was expected and the pass proceeded on the "AC2 closes, AC1 stays PARTIAL" branch.

### AC2 — trigger-fan-in record built from a full product read

Cycle 03:46:51Z: `Cin7ProductsFetched page:1 count:0` (nothing via the primary `/Products` poll this cycle) → `Cin7ProductOptionsFetched` across 8 pages (1,908 rows) → `Cin7TriggeredProductsFetched count:247`.

The `PA26-102I-XS`/`PA26-102I-XXL` record emitted in that same cycle carries `UserDef1=WORSHIP` (brand), `ItemClass=CTC-220` (from `categoryIdArray[0]`), and `Color=Purple` (from `customFields.products_1011`) — none of which the sparse `/ProductOptions` response contains. Since `productsFetchedPrimary=0` for this cycle, these fields could only have been supplied by the triggered full product GET.

| | Cycle evidence | Emitted record |
|---|---|---|
| Fan-in count | `Cin7TriggeredProductsFetched count:247` | — |
| Primary fetch | `productsFetchedPrimary:0` | — |
| Brand | (not in `/ProductOptions`) | `UserDef1=WORSHIP` |
| Item class | (not in `/ProductOptions`) | `ItemClass=CTC-220` |
| Colour | (not in `/ProductOptions`) | `Color=Purple` |

**AC2 verdict: PASS.** Direct assertion evidenced on a live, real-data, non-bus-injected record.

### AC6 — no barcode → empty XRefs, accepted

No opportunistic evidence this pass — the 9 blank-`ean` candidates identified in the `preview-cin7-sync.sh` output did not appear in the sender's actual XML output that was captured (searched, 0 hits for `<XRefs/>` in the sender logs pulled). **Unchanged from before this pass** — still PASS on bus-injected evidence only (`QA-TEST-NOBARCODE-1`, 08-05/06).

### Whitespace `item_code` (CS5, opportunistic)

Checked the full preview output and the full live-emitted set (all ~3,257 records) for leading/trailing/interior whitespace padding in `item_code`. **None found.** No upgrade to the CS5 real-path evidence — still unreachable per §8 of the brief.

---

## 3. Part B — exact character limits

Both fields pinned by binary search, one probe at a time, ~3 min apart, real sender log evidence for every probe (`ManhattanSenderValidationFailure reason:"size_too_long"`/`"item_code_too_long"`, followed by the uncaught `validateItemDownload` throw, exactly as the brief predicted).

### Size

| N | Result |
|---|---|
| 25 (prior known-good) | passes |
| 37 | **fails** (`size_too_long`) |
| 31 | **fails** |
| 28 | **fails** |
| 26 | **fails** |

**Pinned: 25 passes / 26 fails → Size limit = 25 characters exactly.**

### Item (`item_code`)

| N | Result |
|---|---|
| 50 (prior known-good) | passes |
| 62 | **fails** (`item_code_too_long`) |
| 56 | **fails** |
| 53 | **fails** |
| 51 | **fails** |

**Pinned: 50 passes / 51 fails → Item limit = 50 characters exactly.**

(`message_group_id` for the longest Item probe was `"CTC#" + 62 chars` = 66 chars — well under the SQS 128-char cap throughout, as the brief predicted; it never bound.)

### Side effects

8 poison probes sent (4 Size, 4 Item). Each becomes a poison record needing ~10 retries (~28–30 min) to land in the DLQ. At report time, DLQ depth is 12 (baseline 10, +2 landed so far) and still rising — buffer queue shows 6 in-flight. **Left as-is per instructions** — not purged, not all have finished draining. Naming (`QA-B2-SIZE<N>`, and the Item probes are self-identifying by length) makes them attributable on a later check.

---

## 4. Verdicts

| AC / item | Verdict | Note |
|---|---|---|
| **AC1** | **PARTIAL** | Barcode, category, colour, brand all now verified together on one real trigger-sourced record. Dimensions clause still can't close — zero genuinely-populated-dims candidates in this window (preview or live), consistent across all ~3,257 live-emitted records this session. |
| **AC2** | **PASS** | Direct assertion evidenced: `productsFetchedPrimary:0` cycle, `Cin7TriggeredProductsFetched:247`, emitted record carries product-only fields (`brand`, `ItemClass`, `Color`) the options response cannot supply. |
| **AC6** | **PASS (unchanged, bus-injected only)** | No real no-barcode record observed live this pass; not upgraded. |
| **AC3** | **PARTIAL (unchanged, see §8 of brief)** | Out of scope for this pass — carried forward as-is. |
| **AC4** | **NOT RUN (unchanged, see §8 of brief)** | Structurally unreachable from QA tooling. |
| **AC5** | **NOT RUN (unchanged, see §8 of brief)** | Needs mocking at the `libs/cin7` boundary. |
| **CS5 whitespace, real path** | **BLOCKED (unreachable at 1-hour cap, unchanged)** | No opportunistic hit this pass either. |
| **Part B — Size limit** | **PASS** | Exact limit pinned: 25 characters. |
| **Part B — Item limit** | **PASS** | Exact limit pinned: 50 characters. |
| **§6 mandatory UNSET** | **Eventually achieved, but see the §1 incident** | First attempt did not take effect for ~33 min / 11 cycles; second attempt confirmed inactive from 04:31:50Z. |

---

## 5. Questions for dev (Kian, back next week)

1. Does the poller deliberately sanitise `message_group_id`? Group F shows `CTC#WTW23-922G_-S` — underscore where raw `"{company}#{item_code}"` concatenation would put the literal space — dated 08-06, *before* the deploy. If that's intentional pre-existing behaviour, is the populator's raw-concatenation path reachable in production at all, or only by bus injection?
2. Was the populator meant to be in the 08-11/12 deploy? `LastModified` is still 2026-08-03 (reconfirmed unchanged again this pass).
3. AC3 says the defaulted metric carries `Company=CTC`. At the metric level there are no dimensions at all — only the log text has `company`. Is the AC wording wrong, or is this outstanding work?
4. AC4 and AC5 can't be reached from QA tooling. Can they close on your unit-test evidence, or do you want a fixture route built?
5. Truncation of `Desc`/`Colour` is completely silent — no log line, no metric. Truncate-vs-fail is signed off, but was the *silence* part of that? The DC team can't tell a description was shortened.
6. **New this pass.** A `cin7-watermark.sh --unset --confirm` was issued and reported success, but the poller kept running active real cycles for ~33 minutes / 11 more cycles afterward (confirmed via direct SSM reads, not just CLI display) before a second `--unset --confirm` finally took effect after one more cycle. This is well beyond the ~1–2 cycle SSM-caching-lag already documented. Is there a longer or unbounded caching path for this parameter under some conditions, or something else going on? (Observation only — not diagnosed, no code looked at.)

Exact `Size`/`Item` limits are now measured (§3) — the old catch-all Q5 asking to confirm all four limits is closed; only the truncation-silence question (now #5 above) remains open from that group.

---

## 6. Sources

Real poller/sender CloudWatch logs pulled via `tail-logs.sh` across 03:46Z–04:35Z; `preview-cin7-sync.sh` dry run at `SINCE=2026-08-13T02:38:00.000Z`; direct `aws ssm get-parameter` reads (not just CLI display) for the watermark incident in §1; `check-status.sh` for queue/DLQ state before and after. `CTC-FINAL-QA-PASS-BRIEF.md` Rev 3 for procedure and prior-state context.
