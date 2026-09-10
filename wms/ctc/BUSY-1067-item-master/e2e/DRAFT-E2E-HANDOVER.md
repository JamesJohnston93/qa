# E2E handover — CTC/Cin7 → Manhattan SCALE item sync

**Status: DRAFT — JJ applies/pastes by hand.** For whoever owns end-to-end / downstream (SCALE
warehouse-ops, DC) testing once BUSY-1113–1117 close. **Drafted:** 2026-08-18.

**Purpose:** this QA pass covered the pipeline from Cin7 through to a record landing correctly in
Manhattan SCALE staging. It did **not** cover what SCALE itself does operationally with that data
(cubing, cartonisation, warehouse pick/pack behaviour) — that's a separate SCALE testing team's scope.
This section hands over the boundary: what's confirmed, what still rests on dev's word rather than
QA's own observation, and the specific operational traps the next team needs to know about.

---

## 1. What we covered (confirmed at the SCALE end, not just sender-side)

- **Coalesce key is `(company, item_code)`.** CTC and UNI records sharing a numeric `item_code`
  (`3141592`) landed as two distinct items, not a collision.
- **Create → update upserts cleanly.** One item, no duplicate, across two separate buffer windows.
- **Field mapping is correct for real, trigger-sourced records** (`PA26-102I-XS`/`-XXL`) — every mapped
  field matches the sender XML at the SCALE end.
- **Rewind idempotency holds at field level**, including the case most likely to duplicate: a 500+ item
  coalesced batch that hit a `TimeoutError` and was retried (`WPDTC26-302F-*`, 8 unique sizes, no
  duplicates).
- **Empty `<XRefs/>` (no barcode) is accepted, not skipped.**
- **`CTC-000` `ItemClass` fallback works** when `categoryIdArray` is empty.

## 2. What stays dev-attested, not independently QA-observed

- **AC1's forced-failure path** (poller-side `PutEvents`/API failure handling) — the only two available
  external levers (`MAX_PAGES_PER_RUN`, a Cin7 base-URL var to redirect) don't exist in the deployed
  environment, so QA could not force this from outside. What we have instead: dev attestation (Kian's
  BUSY-1116 comments + PR 1522 — narrative on a personal dev stage, not a cited test file or CI run) and
  one **organically occurring** `TimeoutError` where the watermark held and the retry advanced cleanly.
  Treat AC1 as evidenced-but-not-independently-forced.
- **Whether `PutEvents`' response `FailedEntryCount` is checked in code** — unknown from outside;
  the field is never logged either way. The **observable consequence** (silent record loss with the
  watermark advancing past it) has never occurred across the pipeline's full recorded lifetime
  (31,731 records, hour-by-hour reconciliation, zero shortfall) — but that's an absence-of-symptom
  argument, not a code read.

## 3. Operational limits the next team needs to know about

### `send-dlq-depth` is saturated, not silent
The buffer DLQ alarm (`depth > 0`, any single message fires it) has been in ALARM continuously since
2026-08-10 because 19 QA-evidence messages sit in the DLQ (all attributable to named test sessions,
none deleted — see `CLAUDE.md`). **A fresh transition into ALARM cannot currently be demonstrated
because the alarm is already tripped.** Whoever inherits this should either purge the DLQ (checking the
message inventory first) or treat the current ALARM state as expected-and-explained rather than a live
incident.

### The alerts topic has zero subscribers
`staging-catalog-manhattan-observability-alerts` — the SNS topic every pipeline alarm targets,
including `send-dlq-depth` and the sender-validation alarm — has **no subscriptions in staging**.
Every alarm on this pipeline can fire correctly and nobody will be told. This is notification
plumbing, not detection — the alarms themselves are correctly configured (see the BUSY-1117 doc).

### SCALE does not clear a field on an empty tag — SAVE is additive
**Measured 2026-08-18:** an item was sent with `colour=Green`, then re-sent with `colour=""`. The
outgoing XML carried an explicit present-but-empty `<Color></Color>` — the sender does transmit the
blank. **SCALE still read `Green`.** So:

- A field cleared in Cin7 **never clears in SCALE**, and no re-sync — full rewind or otherwise — will
  fix it. Only an explicit corrective write to a **non-blank** value would.
- This confirms the caveat already present in the published re-sync runbook, which had never actually
  been measured before this pass.
- **This scopes any re-sync/idempotency claim the E2E team relies on**: convergence holds for values
  that are **present** in Cin7. It does **not** hold for **deletions**. If a re-sync runbook or E2E test
  plan implies a full rewind restores exact parity with current Cin7 state, that's true only for
  non-blank fields.
- Worth raising with whoever owns CTC merchandising: is any CTC field routinely cleared rather than
  overwritten (barcodes on discontinued lines, seasonal colour attributes)? If so, SCALE may already be
  carrying stale values today with no recovery path via re-sync.

### 100% of CTC items are dimensioned `0.1 × 0.1 × 0.1 MM`
**Measured:** no CTC product in Cin7 production carries dimension data at all — 0 of ~3,257 real
records emitted across 15 cycles, and 1,652 of 1,658 preview candidates were missing
`dimension_uom, qty_uom, height, length, width, conversion_rate` entirely. The sender's default
sentinel (`0.1`, `MM`) is therefore what every single CTC item in SCALE carries. This is **correct,
expected behaviour on our side** — the data arrives as Cin7 actually holds it. **What we could not
test, and is explicitly out of scope for this QA pass:** whether SCALE cubes or cartonises off item
dimensions. If it does, the entire CTC catalogue is currently dimensioned identically in a system that
may use that data for pick/pack or slotting decisions. **This needs an owner on the SCALE testing side**
— nobody currently owns this question.

### A double-space item code was accepted by SCALE
Cin7 product 29942's six options carry a genuine interior double-space in their option code
(`WTW23-922G  -XS` through `-XXL`). All six exist in SCALE staging **with the double space intact** —
confirmed by direct dashboard lookup, copied verbatim. This is not a defect (the record travelled the
real, unmodified poller path and SCALE accepted it), but it creates a **latent rename hazard**: if that
item code is ever trimmed or normalised — by SCALE, by a future Cin7 edit, or by any downstream
process — **it will create a second item rather than updating the existing one**, because SCALE has no
way to know the trimmed and untrimmed codes refer to the same thing. Anyone doing data cleanup on CTC
item codes in SCALE should know this before touching whitespace.

---

## 4. Not substantiated from the results files — flagged, not filled in

- **SCALE cubing/cartonisation behaviour** — explicitly out of scope and untested; flagged above as
  needing an owner, not answered here.
- **Dashboard panel review** — no results file describes an E2E-relevant review of
  `staging-catalog-manhattan-observability-dashboard`'s panel content.
- **Whether other CTC fields besides colour are routinely blanked in Cin7** — raised as an open question
  above, not measured.
