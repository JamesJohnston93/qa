# Plan C — SCALE staging manual verification list

**For JJ to run by hand in the SCALE staging UI.** No agent session needed — this is the list you asked for.
**Unblocks:** 1115 ID1, UP1, UP2 (all currently BLOCKED) · 1116 TC6 field-level idempotency · feeds Plan A Tier A1.
**Drafted:** 2026-08-18 · **Status: ✅ COMPLETE — all 7 checks done 2026-08-18** (4b ruled out of scope)

**Context:** every "one item, correctly updated, not duplicated" claim across 1114/1115/1116 currently rests on **sender-side XML plus the absence of a rejection signal** — never on observed SCALE state. These seven checks are what convert that to real evidence. Check 3 is the important one.

**Facility:** `CTC-QDC` for everything except check 1, which needs both `CTC-QDC` and `UNI-QDC`.

> ### ⚠ Nothing here needs creating — read before starting
>
> **`QA-*` items are bus-injected synthetic records, not Cin7 products.** They were produced by `emit-cin7-record.sh` on 2026-08-10, posting straight onto the shared bus and **bypassing Cin7 entirely**. All were accepted by Manhattan (`accepted=1 rejected=0`), so they already exist in SCALE staging. **No Cin7 create is required or possible, and none is needed.**
>
> Because they aren't real Cin7 option codes, **no poller cycle can ever re-emit them** — so their SCALE state is frozen exactly as the last SAVE left it on 08-10. That's cleaner than a live product, where later churn could muddy the result.
>
> If any `QA-*` item is missing, `emit-cin7-record.sh` recreates it at **zero Cin7 cost** (~10 min including the buffer flush). Real-product codes (checks 4, 5, 6) are genuine Cin7 items reached via the poller and need no setup either.

---

## Progress

| Check | Status |
|---|---|
| 1 — `3141592` | ✅ **PASS, 2026-08-18.** Both CTC and UNI records exist as distinct items. **1115 ID1 → full PASS**: coalesce key confirmed `(company, item_code)` at the SCALE end, not just in sender XML. No cross-company collision |
| 2 — `QA-UP1-TEST` | ✅ **PASS, 2026-08-18.** Reads `Large` / `Blue`. **1115 UP1 → full PASS** — create → update upserts cleanly, one item, no duplicate |
| 3 — `QA-UP2-TEST` | ⚠ **FINDING, 2026-08-18. `Color` still reads `Green`.** See below — this is the most consequential result on the list |
| 4 — `PA26-102I-XS`/`-XXL` | ✅ **PASS, 2026-08-18.** Real-data field mapping confirmed at the SCALE end. **1115 TC1 closed at both ends** |
| 4b — cubing / cartonisation | **OUT OF SCOPE (JJ, 2026-08-18).** No way to tell at present, and not ours to test — a separate **SCALE testing team** owns what SCALE does with the data. Our scope is that the data arrives correctly. **Carry as a handover note to that team** (100% of CTC items are `0.1 × 0.1 × 0.1 MM`), not as a QA open item |
| 5 — `WPDTC26-302F-*` | ✅ **PASS, 2026-08-18.** **8 unique sizes (4,6,8,10,12,14,16,18), no duplicates** — after a 500+ item batch that hit a `TimeoutError` and was retried. **The strongest idempotency evidence in the epic**: the case most likely to duplicate, and it didn't. Closes 1116 TC6 / ID3 / UP3 at field level |
| 6 — `WTW23-922G*` | ✅ **DECISIVE, 2026-08-18. All six options exist WITH the double space intact.** See below — **CS5/ERR5 is a harness artefact; do not raise the ticket** |
| 7 — injected-evidence confirmations | ✅ **PASS, 2026-08-18.** `QA-TEST-NOBARCODE-1` exists **with no barcode** — the empty `<XRefs/>` was accepted, not skipped (**1115 TC8 / AC6 closed at the SCALE end**). `QA-TEST-BLANKCAT-1` shows `ItemClass = CTC-000` (**1115 TC2 closed at the SCALE end**) |

### ✅ Check 6 result — the whitespace question is answered: harness artefact

**Measured.** Item codes copied verbatim from the SCALE dashboard by JJ:

```
WTW23-922G  -XS
WTW23-922G  -S
WTW23-922G  -M
WTW23-922G  -L
WTW23-922G  -XL
WTW23-922G  -XXL
```

**All six exist, with the interior double space preserved.** So the records travelled the real poller
path end to end and landed in SCALE.

**The mechanism — ⚠ corrected 2026-08-18 by the Plan A residual scan.** My first reading here was that
the group id is built from separate clean fields (`{company}#{productOptionCode}_{size}`). **That was
wrong** — 29942's `size` field is `'S'`, not `'-S'`, so that construction would give `CTC#WTW23-922G_S`,
which isn't what the logs show.

**The correct mechanism: the poller collapses each whitespace run in `item_code` to a single
underscore** — `{company}#re.sub(r"\s+","_",code)`. This reproduces the observed `CTC#WTW23-922G_-S`
exactly, and explains why two spaces became one underscore.

**The correction strengthens the conclusion.** Sanitising `item_code` wherever whitespace appears covers
more shapes than the clean-fields theory did — including the bare `productOptionCode`, which was the one
residual this plan flagged. **There is no reachable path, not merely an unexercised one.** Bus
injection's raw `{company}#{item_code}` concat is simply not what the poller does.

**Verdict: CS5 / ERR5 = harness artefact. Do not raise the ticket.**

**Two things to carry rather than drop:**

1. ~~**One cheap residual on Plan A**~~ — **CLOSED 2026-08-18.** The full-account scan found 47
   poller-eligible options with whitespace in the bare `productOptionCode` across 13 products — and the
   corrected mechanism sanitises them all. The populator's lack of containment remains a **latent**
   low-severity note for any future raw-concat producer, not a defect.
2. **For the SCALE team's handover** — SCALE accepted an item code containing a double space. Fine
   functionally, but **if that code is ever trimmed, it creates a second item rather than updating the
   first.** Same shape as the `item_code` rename hazard (W23).

### ⚠ Check 3 result — SCALE does not clear a field on an empty tag

**Measured:** `QA-UP2-TEST` was sent `colour=Green`, then re-sent with `colour=""`. The outgoing XML
carried an explicit **present-but-empty** `<Color></Color>`. **SCALE still reads `Green`.**

**So `SAVE` is additive: a field cleared in Cin7 never clears in SCALE, and no re-sync will fix it.**
Only an explicit corrective write to a non-blank value would.

This confirms the caveat in Kian's published runbook, which had **never been measured** — it was
dev's claim, and it is now QA-verified.

**What it changes:**

1. **1115 UP2 → recorded as a confirmed limitation**, not PASS and not PARTIAL-pending. The sender
   behaves correctly (it transmits the blank); the boundary is on the Manhattan/SCALE side.
2. **It scopes 1116's re-sync idempotency argument.** Convergence holds for values that are
   **present**. It does **not** hold for deletions. AC2/AC3 wording should say so — as written they
   read as though a reset restores full fidelity, and it doesn't.
3. **It is an operational finding for the DC team, not just a QA note.** Stale values persist
   indefinitely in the WMS with no signal and no recovery path via re-sync. **Belongs in the re-sync
   runbook and the E2E handover section**, alongside the note that our draft runbook already flags
   this behaviour.
4. **It raises a question worth asking:** is any CTC field routinely cleared rather than overwritten
   in Cin7 — barcodes on discontinued lines, seasonal colour attributes? If so, SCALE is already
   carrying stale values today. Worth one question to whoever manages CTC merchandising, and it pairs
   naturally with the lifecycle/de-provisioning gap (W22 in the write-access plan), which is the same
   class of problem: **things that stop being true in Cin7 don't stop being true in SCALE.**

---

## The checks

### 1. `3141592` — coalesce key is `(company, item_code)` ✅ DONE
**Closed:** 1115 ID1 — **PASS at SCALE, 2026-08-18.** Both records present and distinct. Retained below for the record.

Two records were injected 8 seconds apart inside one buffer window, deliberately, to stress the coalesce key: `<Company>CTC</Company><Item>3141592</Item>` and `<Company>UNI</Company><Item>3141592</Item>`, both `accepted=1 rejected=0`.

- **Expect:** the item exists **twice** — once under CTC, once under UNI, as two genuinely distinct items.
- **If only one exists:** one company overwrote the other. That is a **real defect** — the coalesce key or the SCALE-side identity is `item_code` alone, not `(company, item_code)`, and CTC and UNI can collide on any shared numeric code. Escalate immediately; it affects both integrations.

### 2. `QA-UP1-TEST` — create → update upserts cleanly
**Closes:** 1115 UP1 · **Nothing to create — already in SCALE from 08-10** (see the callout above)

Sent as `Red`/`Small` (05:48:29Z), then re-sent as `Blue`/`Large` in a deliberately separate buffer window (05:51:37Z, sent 05:51:51Z) to force two distinct SAVE calls rather than intra-window coalescing.

- **Expect:** **one** item showing `Color = Blue`, `Size = Large`.
- **If it shows Red/Small:** the second SAVE didn't apply. **If two items exist:** SAVE isn't upserting. Either is a defect.

### 3. `QA-UP2-TEST` — does an empty tag clear the field? ⚠ **the load-bearing one**
**Closes:** 1115 UP2 · **and settles the deletion half of 1116's re-sync idempotency argument** · **Nothing to create — already in SCALE from 08-10**

Sent with `colour=Green` (accepted 05:51:45Z), then re-sent with `colour=""` in the next window (05:51:55Z, landed inside the 8-item batch accepted at 05:54:44Z). The outgoing XML carried an explicit **present-but-empty** `<Color></Color>` — the sender transmits the blank rather than omitting the field.

- **Check:** is `Color` on this item **blank**, or still **`Green`**?
- **Blank** ⇒ SCALE honours an empty tag as a clear. Deletions propagate; the re-sync idempotency argument holds for cleared fields.
- **`Green` retained** ⇒ **SAVE is additive and cannot clear a field.** This is what Kian's published runbook claims, but it has never been measured. It means **a field cleared in Cin7 never clears in SCALE** — stale data persists indefinitely and no re-sync fixes it. That is a genuine operational finding for the DC team and belongs in the runbook and the E2E handover, not just a QA doc.

Either answer is publishable. **This is the single most valuable check on the list.**

### 4. `PA26-102I-XS` and `PA26-102I-XXL` — real-data field mapping
**Closes:** 1115 TC1 at the SCALE end (currently verified from sender XML only)

Real, trigger-sourced records from the 08-13 final pass. Product "Cherub Tee - Blackberry".

| Field | Expect |
|---|---|
| `Company` / `Active` | `CTC` / `Y` |
| `Desc` | `Cherub Tee - Blackberry` |
| `ItemClass` | `CTC-220` (**not** `CTC-000`) |
| `Size` | `XS` (and `XXL` on the sibling) |
| `Color` | `Purple` |
| `UserDef1` | `WORSHIP` |
| `Weight` / `WeightUm` | `0.27` / `KG` |
| Barcode / XRef | `9346792174392` |
| `Height` / `Length` / `Width` | `0.1` each — **defaulted, and expected to be** |
| `DimensionUm` / `ConvQty` / `QtyUm` | `MM` / `1` / `EA` |

- **Any mismatch** is a mapping defect the sender logs couldn't reveal.
- The `0.1` dimensions are **correct behaviour, not a bug** — no CTC product in Cin7 production carries dimension data at all (0 of ~3,257 records), so every CTC item is `0.1 × 0.1 × 0.1 MM`. Which raises check 4b.

**4b — while you're in there:** does SCALE **cube or cartonise** off item dimensions for CTC items? If it does, 100% of the CTC catalogue is dimensioned at `0.1 MM` and that has real operational consequences for the DC team. This is a business/warehouse question, not a code defect, and nobody currently owns it.

### 5. Rewind idempotency — no duplicates after the 6h07m re-sync
**Closes:** 1116 TC6 / ID3 / UP3 at field level (currently PARTIAL, convergence-only)

The 08-14 bounded rewind re-sent 2,270 records across 331 products. Pick **3–5 items** and confirm each is a single, correctly-valued item with no duplicate. Suggested, both known to have been in that run:

- `WPDTC26-302F-*` — 8 sizes, was in a 500+ item coalesced batch that hit a transient `TimeoutError` and was retried. **The most interesting of the set: if a retried batch duplicated anything, it would show here.**
- `SMU23-135A-M` — the original 08-07 mapping reference record.

- **Expect:** one item per option code, values current, no duplicates.
- **Any duplicate** means the coalesce-plus-upsert idempotency argument fails under retry — which would be a significant finding, since that argument underpins the whole re-sync runbook.

### 6. `WTW23-922G` — the whitespace question ⚠ **feeds Plan A**
**Closes:** Plan A Tier A1, item 1

Cin7 product **29942**'s six options genuinely carry an **interior double-space** in their option code (`WTW23-922G  -XS/S/M/L/XL/XXL`). Poller logs from 08-06 show they traversed the whole pipeline successfully.

- **Search for any item beginning `WTW23-922G`** and record **exactly** what the item code looks like — with the double space, with an underscore, trimmed, or something else. Copy the literal value.
- **If items exist:** the record landed via the real poller path ⇒ strong evidence the whitespace failure is a **bus-injection harness artefact**, not a live defect. **This may close the CS5/ERR5 ticket question without any further testing.**
- **If nothing exists:** the records never landed despite the logs, which would be a much more serious finding — chase it.
- **If both a padded and an underscored variant exist:** the poller has produced two identities for the same option at different times. Worth knowing.

Note the distinction from the log evidence: the **`message_group_id`** showed an underscore (`CTC#WTW23-922G_-S`) while **`item_code`** kept the raw padding — so the SCALE item code may well show the double space. Either way, its **existence** is the answer.

### 7. Two quick injected-evidence confirmations
**Closes:** 1115 TC8 / AC6 and TC2 at the SCALE end

- **`QA-TEST-NOBARCODE-1`** — expect the item to exist with **no barcode / empty XRefs**, accepted rather than skipped.
- **`QA-TEST-BLANKCAT-1`** — expect `ItemClass = CTC-000`, the fallback.

Both currently rest on injected sender-side evidence only. Low value individually, but they're two lookups while you're already in the UI.

---

## Outcome — all checks complete

**Six passes, one finding, one out of scope.**

| Result | Closes |
|---|---|
| Checks 1, 2, 4, 5, 7 **PASS** | 1115 ID1, UP1, TC1, TC2, TC8/AC6 — all now confirmed at the **SCALE end**, not just from sender XML · 1116 TC6 / ID3 / UP3 at field level |
| Check 6 **DECISIVE** | Plan A closed — CS5/ERR5 is a **harness artefact, no ticket** |
| Check 3 **FINDING** | SCALE does not clear a field on an empty tag — `SAVE` is additive |
| Check 4b **OUT OF SCOPE** | Cubing/cartonisation belongs to the SCALE testing team |

**Net: this pass closed five test cases at both ends, killed one defect ticket before it was written,
and produced one operational finding that changes what the re-sync runbook can claim.**

**Still worth capturing:** the **navigation path** to the item lookup screen. Two earlier sessions
failed to find it and it's recorded as a blocker across three QA docs. One line — menu path plus
facility context — retires it permanently. Worth adding to `CLAUDE.md` and the E2E handover.

---

## Reporting back

For each check: the item code searched, whether it was found, the actual field values, and pass/fail. **Copy literal values rather than paraphrasing**, especially for check 6.

Drop the results back into a session and I'll fold them into the QA docs and close the four BLOCKED cases.

**Also worth capturing while you're in there:** the **navigation path** to the item lookup screen. Two separate sessions failed to find it, `DIF Incoming Message Insight` returned 0 rows with all filters cleared, and that dead end is recorded across three QA docs as a blocker. One line — menu path plus facility context — retires it permanently and stops the next person losing an hour to it. Worth adding to `CLAUDE.md` and the E2E handover.
