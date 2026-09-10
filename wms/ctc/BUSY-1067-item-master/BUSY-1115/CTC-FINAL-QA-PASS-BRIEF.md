# Final QA pass brief — taking BUSY-1115 as far as QA can

**Raised by:** JJ (QA) · **Date:** 2026-08-13 · **Rev 3**
**Stage:** staging · **Region:** ap-southeast-2 · **Profile:** staging
**Supersedes:** Rev 1 and Rev 2 of this file (both 2026-08-13). See §1.

**This is intended to be the last QA pass on BUSY-1115.** Everything still open after it is a decision or dev-side work, not testing — listed explicitly in §8 so the ticket's remaining gaps are owned rather than implied.

---

## 1. What changed across revisions

**Rev 1** targeted Cin7 product **29942** (`WTW23-922G  -XS/S/M/L/XL/XXL`, genuine interior double-space) to settle whether the `item_code` whitespace defect is live on the real poller path.

**That is unreachable.** The watermark is a floor (`where=modifiedDate>='<since>'`, inclusive, no upper bound), so reaching 29942 means a floor of `2026-08-06T01:25:00Z` — a 7-day catch-up. With the rewind capped at **1 hour** (agreed with dev, 2026-08-13) and 29942's `modifiedDate` being `2026-08-06T01:25:12Z`, it cannot appear in the window. Arithmetic, not judgement.

**Rev 2** retargeted at AC1 and AC2, which a 1-hour window can close.

**Rev 3** (this) adds **Part B** — the bus-injection probes that convert the bracketed `Size` and `Item` limits into exact numbers. Those need no Cin7 quota and remove one of the outstanding questions to dev entirely.

**Whitespace coverage is opportunistic.** If a record in the window happens to carry padding, capture it. Do not spend quota hunting. The standing question goes to Kian (§9 Q1).

---

## 2. What this pass is for

### Part A — the poller path (§4–§6)

| BUSY-1115 AC | Current state | What Part A adds |
|---|---|---|
| **AC1** — fully-populated Cin7 item lands in SCALE with every LLD field verified | **PARTIAL.** FM1–FM13 verified the full mapping on a real record (`SMU23-135A-M`, 08-07), but that option had `uomOptions=[]` and no product-level weight/dims — the dimensions verified were *defaults*, not populated values. The only populated-dims evidence (E1, 08-13) is bus-injected and carries no barcodes. | One **real, Cin7-sourced, genuinely populated** item verified end to end — populated weight/dims **and** barcodes on the same record. |
| **AC2** — option-level change produces a record built from the **full product read**, never the options response | **PARTIAL.** OQ-2 (08-05/06) proved the `/ProductOptions` trigger fan-in is load-bearing and is how essentially every record arrives. No test asserts the record was *built from the product GET*. PW4 unrun. | The direct assertion: a `[trigger]`-sourced record carrying product-level-only fields, confirmed against the poller's own fetch logs. |
| **AC6** — no barcode → empty XRefs, accepted | **PASS**, but bus-injected only (`QA-TEST-NOBARCODE-1`, 08-05/06). | If the window contains a real no-barcode option, upgrade the evidence to real data. Opportunistic — do not chase. |

### Part B — exact character limits (§7)

Not an AC in itself, but it removes a QA-measured-not-dev-supplied caveat that currently sits across the results docs and the LLD §5 mapping table, and closes one of the questions to Kian.

| Field | Now | After Part B |
|---|---|---|
| `Desc` | 100, exact | unchanged — already exact |
| `Colour` | 25, exact | unchanged — already exact |
| `Size` | **bracketed: 26–49** | exact |
| `Item` | **bracketed: 51–74** | exact |

---

## 3. Rules of engagement

- **Observe and record. Do not diagnose, do not infer where code lives, do not recommend fixes.** Anything you want to write as a verdict goes in the questions list.
- **Cin7 is GET-only, always.** No sandbox — this is real CTC production data. Never POST/PUT/PATCH/DELETE.
- **Writes only with `--confirm`.** Dry run first, every time.
- **Do not purge the DLQ.** Part B will add to it; that is expected — measure, don't clean.
- **`UNSET` the watermark the moment Part A ends** (`--unset --confirm`). That is the idle norm, not just cleanup.
- **Rewind cap: 1 hour. Not negotiable.** If the window is unproductive, re-run next session with a fresh 1-hour window rather than widening this one.
- Cin7's cap is **5,000 calls/day shared across every environment** including personal dev stages, and consumption is invisible to whoever else is testing. The preview in §4c makes real requests too — budget both.
- **Do not edit Confluence or Jira.** JJ pushes those.

---

## 4. Part A, Step 1 — gates, then look before you leap

### 4a. Deploy timestamps

```bash
for fn in staging-catalog-cin7-cin7-item-poller \
          staging-catalog-manhattan-item-buffer-buffer-populator \
          staging-catalog-manhattan-item-sender; do
  echo -n "$fn: "
  aws lambda get-function-configuration --function-name "$fn" \
    --profile staging --region ap-southeast-2 --query 'LastModified' --output text
done
```

Baseline from 08-13: poller `2026-08-12T22:45:44Z`, populator `2026-08-03T13:02:56Z`, sender `2026-08-12T22:46:32Z`. Record any movement — if the populator has moved since, say so prominently, it changes the whitespace picture.

### 4b. Baselines

```bash
./check-status.sh --stage staging --profile staging     # DLQ depth — last known 9 waiting, 1 in-flight
./cin7-watermark.sh --stage staging --profile staging   # view only
```

### 4c. Preview the window — the decision gate

```bash
SINCE=$(date -u -v-1H +%Y-%m-%dT%H:%M:00.000Z)   # macOS; GNU: date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:00.000Z
echo "$SINCE"
./preview-cin7-sync.sh --since "$SINCE"
```

The preview makes the poller's exact requests, changes nothing, and prints every would-emit record with its full field mapping and `missing_fields`.

**Look for a record satisfying AC1** — one Public product / Primary option with **all** of:

- populated `weight` (not the zero-sentinel)
- populated `height` / `length` / `width` (not the `0.1` defaults)
- a populated `barcode` → `ean`
- a real `size` and `colour`
- a `categoryIdArray[0]` mapping to a real item class (not the `CTC-000` fallback)
- ideally `uomOptions` present, so the UOM block is real rather than defaulted

and **at least one record tagged `[trigger]`** for AC2.

**Decision:**

| Preview shows | Do |
|---|---|
| A record meeting the AC1 shape **and** a `[trigger]` record | Proceed to §5 |
| `[trigger]` records but nothing fully populated | Proceed anyway — AC2 closes, AC1 stays PARTIAL. Record exactly which fields were unavailable. |
| Nothing emitting, or only inactive skips | **Stop Part A.** Costs nothing more. Go to Part B, and re-run Part A next session with a fresh window. |
| A record carrying whitespace padding in `item_code` | Bonus — flag it and capture it in §5 |
| A real no-barcode option | Bonus — capture the `<XRefs/>` element for AC6 |

Write down the candidate's `item_code` and product id before proceeding — that's what you'll grep for.

---

## 5. Part A, Step 2 — run

```bash
./cin7-watermark.sh --stage staging --profile staging --set "$SINCE"            # dry run
./cin7-watermark.sh --stage staging --profile staging --set "$SINCE" --confirm  # commit
```

**Budget ~2 poller cycles.** The cycle straight after a `--confirm` typically still logs the *old* watermark; the next (~3–6 min) picks it up. **Do not re-set because the first cycle looked idle — that doubles the cost.** Allow ~10 min total including the ~3-min buffer flush.

```bash
./tail-logs.sh --stage staging --profile staging --lambda cin7-poller --since 15m
./tail-logs.sh --stage staging --profile staging --lambda sender      --since 15m
```

(Populator and buffer only if something goes wrong — add them then.)

### Capture — AC1

The sender's full `Manhattan ItemDownload payload:` XML for the candidate, checked element by element:

| Element | Expect |
|---|---|
| `<Item>` / `<Desc>` | match the Cin7 option code / product name |
| `<ItemClass>` | real class from `categoryIdArray[0]`, **not** `CTC-000` |
| `<Size>` / `<Color>` | real values, non-blank |
| `<XRefs>` | populated barcode reference, **not** the empty element |
| `<Weight>` | the real weight, **not** `0` |
| `<Height>` / `<Length>` / `<Width>` / `<DimensionUm>` | real values, **not** the `0.1` defaults |
| UOM block | real `conversion_rate` / `qty_uom` |

Then `accepted=N rejected=0`, and the `missing_fields: []` line. **An empty `missing_fields` is the proof the record was genuinely populated rather than defaulted** — if any `ManhattanDefaultedField` metric fires for this record, AC1 is not closed by it. Say so plainly.

### Capture — AC2

From the poller's own logs: `Cin7ProductsFetched`, `Cin7ProductOptionsFetched`, **`Cin7TriggeredProductsFetched`**, `Cin7RecordEmitted`, `Cin7PollerCycleComplete`.

The assertion to evidence: for a record whose parent product appeared **only** via the options-endpoint trigger path, the emitted record carries **product-level fields the `/ProductOptions` response does not contain** — `brand`, `categoryIdArray[0]` → item class, and `customFields.products_1011` → colour. Their presence proves it was built from a full product GET.

Quote the `Cin7TriggeredProductsFetched` count and the emitted record's `brand` / item class / colour verbatim, side by side.

---

## 6. Part A, Step 3 — cleanup (mandatory, before Part B)

```bash
./cin7-watermark.sh --stage staging --profile staging --unset            # dry run
./cin7-watermark.sh --stage staging --profile staging --unset --confirm
./check-status.sh --stage staging --profile staging                      # DLQ depth vs §4b
```

`cin7-watermark-stale` will go to ALARM from ordinary idle once UNSET — expected, not a finding.

---

## 7. Part B — exact `Size` and `Item` limits (bus injection, zero Cin7 cost)

Gate B on 08-13 bracketed both fields but hit a 4-probe cap. This closes them by binary search.

**Known-good / known-bad edges, already measured — do not re-test these:**

- `Size`: **25 passes unchanged**, 50 errors → the limit is in **26–49**
- `Item`: **50 passes unchanged**, 75 errors → the limit is in **51–74**

### Procedure

**Send probes one at a time.** An over-length value throws uncaught in `validateItemDownload` and **aborts the whole batch invocation** — batching probes means one bad probe destroys good ones and the result is uninterpretable. Leave a full buffer-flush interval (~3 min) between sends.

```bash
mk() { printf 'S%.0s' $(seq 1 "$1"); }   # N-char filler

# Size probe at length N — binary search 26..49
./emit-cin7-record.sh --stage staging --profile staging \
  --item-code "QA-B2-SIZE$N" --size "$(mk "$N")" --confirm

# Item probe at length N — binary search 51..74.
# The item_code IS the field under test; message_group_id = "CTC#" + N chars,
# so at N=74 the group id is 78 — well under the SQS 128 cap, which never binds here.
./emit-cin7-record.sh --stage staging --profile staging \
  --item-code "$(mk "$N")" --confirm
```

Suggested sequence (~5 probes each, adjust as results land):

- **Size:** 37 → then 31 or 43 → converge
- **Item:** 62 → then 56 or 68 → converge

**Read each result in the sender log:**

- **Pass** = value appears unchanged in the outgoing XML (`<Size>` / `<Item>`), `accepted=1 rejected=0`
- **Fail** = `ManhattanSenderValidationFailure reason:"size_too_long"` / `"item_code_too_long"`, then the uncaught `validateItemDownload` throw

```bash
./tail-logs.sh --stage staging --profile staging --lambda sender --since 10m
```

**Stop when the limit is pinned** — i.e. you have an N that passes and N+1 that fails, for each field.

### Expected side effects — record, don't clean

Every failing probe becomes a poison record and lands in `staging-catalog-manhattan-item-buffer-dlq.fifo` after ~10 retries (~28–30 min). Expect roughly **4–6 new DLQ messages per field**. Note the final depth against the §4b baseline and leave them. Use the `QA-B2-SIZE<N>` naming so they're attributable on a later peek; Item probes are self-identifying by length.

---

## 8. What this pass deliberately does not close

State these in the results file so the remaining gaps are explicit and owned:

| Item | State | Owner |
|---|---|---|
| **AC3** — defaulted metric with `Company=CTC` | Substitution and metric emission **PASS** (WT1 retest, 08-10). But the **`Company=CTC` dimension does not exist at the metric level** — `ManhattanDefaultedField`, `ItemsSent`, `SenderValidationFailures`, `BatchCoalesced` all measured `Dimensions: []` on 08-05, re-confirmed 08-13. `company` appears only as a field inside the JSON log text. **As worded, AC3 is not met.** | Kian / BUSY-1113 — wording fix or code change |
| **AC4** — option without product option code: INFO skip, no emit | **NOT RUN.** Structurally unreachable: bus injection bypasses the poller, Cin7 is read-only so the shape can't be authored. TC7 / PW6. | Kian — unit-test verified; needs a close decision or a fixture route |
| **AC5** — 429 Retry-After, cycle exits early, watermark untouched | **NOT RUN.** Needs mocking at the `libs/cin7` boundary. TC10 / TC11. | Kian — dev-side |
| **CS5 whitespace on the real poller path** | Unreachable at a 1-hour cap. Group F's evidence (underscore `message_group_id`) is dated 2026-08-06, **pre-deploy** — pre-existing poller behaviour, not the fix. | Kian — §9 Q1 |

---

## 9. Reporting

Write results to **`CTC-FINAL-QA-PASS-RESULTS.md`** in `testing-tools/`. **Do not edit Confluence or Jira** — JJ pushes those.

**Header:** the three `LastModified` values; the `SINCE` floor used; the preview's would-emit count and the candidate record chosen; the DLQ baseline and final depth; the run window.

**Body:**

- Part A — the AC1 element-by-element table, the AC2 side-by-side quote, plus any opportunistic AC6/whitespace evidence
- Part B — the probe ladder for each field and the pinned limit, stated as `N passes / N+1 fails`
- A clear **PASS / PARTIAL / BLOCKED (reason) / NOT RUN** per AC. Use BLOCKED rather than forcing a verdict when the harness couldn't reach the behaviour.

**Questions for dev (Kian, back next week):**

1. Does the poller deliberately sanitise `message_group_id`? Group F shows `CTC#WTW23-922G_-S` — underscore where raw `"{company}#{item_code}"` concatenation would put the literal space — dated 08-06, *before* the deploy. If that's intentional pre-existing behaviour, is the populator's raw-concatenation path reachable in production at all, or only by bus injection?
2. Was the populator meant to be in the 08-11/12 deploy? `LastModified` is still 2026-08-03.
3. AC3 says the defaulted metric carries `Company=CTC`. At the metric level there are no dimensions at all — only the log text has `company`. Is the AC wording wrong, or is this outstanding work?
4. AC4 and AC5 can't be reached from QA tooling. Can they close on your unit-test evidence, or do you want a fixture route built?
5. Truncation of `Desc`/`Colour` is completely silent — no log line, no metric. Truncate-vs-fail is signed off, but was the *silence* part of that? The DC team can't tell a description was shortened.

*(The old Q5 — confirm the four character limits — is dropped if Part B pins `Size` and `Item`. Report the exact numbers instead, still flagged as QA-measured.)*

---

## 10. Sources

`CTC-FIX-RETEST-RESULTS.md` (08-13, Gate A/B, Groups A–F); `BUSY-1115-CLOSEOUT-RESULTS.md` (08-10, WT1/TC7); `SESSION-FINDINGS-2026-08-05.md` (OQ-2, Company-dimension check, TC10/TC11); `SESSION-FINDINGS-2026-08-07.md` (FM1–13 payload); `EXTENDED-COVERAGE-TEST-CASES.md` (XR2, PW4/PW6); `README.md` + `CLAUDE.md` (watermark semantics, shared quota, UNSET norm, ~2-cycle propagation); BUSY-1115 acceptance criteria as at 2026-08-13.
