# CTC whitespace on the real poller path — Plan A residual scan results

**Plan:** Plan A — whitespace `item_code` on the real poller path · **Ran:** 2026-08-18 · **Scope:** the residual scan only (whitespace in the **bare `productOptionCode`**). Tiers A2 and A3 were not run and are not needed.

**Method:** `scan-bare-code-whitespace.sh` — GET-only against `/api/v1/Products`, 99 pages, no writes to Cin7, AWS or the watermark. Raw JSON retained in `bare-code-scan-20260818T045423Z/`.

> ## Bottom line
>
> **1. The residual is real but tiny: 13 products / 47 poller-eligible options carry whitespace in the bare `productOptionCode`** — not the 2,942 the script's own verdict claimed (that verdict was wrong; see §2).
>
> **2. It does not matter, because Plan A's stated mechanism was wrong and the true one is safer.** The poller does **not** assemble the group id from separate clean fields. It **collapses each whitespace run in `item_code` to a single underscore**. That sanitises whitespace *anywhere*, including in the bare `productOptionCode`.
>
> **3. Conclusion unchanged and strengthened: CS5/ERR5 is a harness artefact. Do not raise the ticket.** The residual the plan was worried about is closed, not merely unexercised.

---

## 1. What the scan covered

| | |
|---|---|
| Products scanned | **24,641** (full pagination, 99 pages) |
| Options scanned | **137,114** |
| Poller-eligible options (`Product.status=Public` AND `ProductOption.status=Primary`) | **95,506** |
| Cost | ~99 GET requests, well inside the 5,000/day shared cap |

**Code-ish fields Cin7 actually returns** (MEASURED — this had been guesswork until now):

- **Product level:** `styleCode`
- **Option level:** `code`, `productOptionCode`, `productOptionSizeCode`, `supplierCode`, `barcode`, `productOptionBarcode`, `productOptionSizeBarcode`

⚠ **Scope caveat, stated plainly.** The scan covers the whole Cin7 account, which is **much larger than the CTC subset earlier docs sized at ~3,257 records**. The 13 products in §3 have **not** been confirmed as CTC. Confirm that before treating any of them as in-scope for this integration.

---

## 2. ⚠ The script's own verdict was wrong — do not cite it

The first run printed **"2942 POLLER-ELIGIBLE bare-code whitespace hit(s) → escalate"**. **That verdict is an artefact of the script's field matching and must not be used.**

The script flagged any field whose name ends in `code`, and treated everything except option-level `code` as "bare". Breakdown of the 5,584 raw hits:

| Field | Hits | Relevant? |
|---|---|---|
| `productOptionSizeCode` | 4,359 | **No** — this is the size-suffixed code under a different name. Almost all are `One Size`, which simply contains a space |
| `supplierCode` | 1,091 | **No** — human-entered supplier text, never reaches the group id |
| **`productOptionCode`** | **71** | **YES — this is the field the plan was asking about** |
| `styleCode` | 57 | **No** — product-level, not used in the group id |
| `productOptionSizeBarcode` / `barcode` | 3 / 3 | **No** |

**The number that matters is 71 option rows, of which 47 are poller-eligible, across 13 products and 13 distinct codes.**

This was independently suspicious before the breakdown existed: 2,942 of ~3,257 would be a ~90% failure rate, which **cannot** coexist with Plan B's measured zero-shortfall reconciliation (31,731 emitted = 31,731 on the bus = 31,731 received by the populator, hour by hour, full pipeline history). A contradiction with measured evidence was the tell.

---

## 3. The actual residual — 13 products, all interior whitespace

**MEASURED.** All poller-eligible (`Public` + `Primary`). Whitespace shown as `·`. **Every one is interior — there are no leading-only or trailing-only cases among the eligible set.**

| `productOptionCode` | Product | Options |
|---|---|---|
| `Knife·FightEAR` | 19888 — Knife Fight Earring - Lox & Chain | 1 |
| `NUSMU23-101A·-·MTEST` | 30707 — New Age Oversize Heavyweight Tee - White - Mens | 5 |
| `NUSMU23-101A·-·WTEST` | 30706 — New Age Oversize Heavyweight Tee - White - Womens | 5 |
| `ONE·WAYTCGML` | 24173 — One Way Ticket Chain - Gold - Margaux Lee | 1 |
| `ONE·WAYTCSML` | 24172 — One Way Ticket Chain - Silver - Margaux Lee | 1 |
| `WOR121·-·701I` | 21758 — Coexist Deck - Purple | 3 |
| `WOR121·-·702B` | 21759 — Collage Deck - Black | 3 |
| `WOR121·-·703H` | 21760 — Chrome Zone Deck - Red | 3 |
| `WORSMU22-·107B` | 22951 — Bonfire Tee - Black | 5 |
| `WORSMU22-·201F` | 22950 — Headshot Crew - Hunter Green | 5 |
| `WSMU22-·167BM` | 25170 — Wind Beneath Merch Super Crop Tee - Merch Black | 5 |
| `WSMU22-·171A` | 25141 — Paradox of Paradise Retro Mid Crop Tank - White | 5 |
| `WSMU22-·174F` | 25580 — Narcissus Merch Fit Tee - Lilac Ash | 5 |

Status split across all 71 hits (eligible and not): `Public/Primary` 47 · `Inactive/Primary` 18 · `Internal/Primary` 2 · `Internal/Active` 2 · `Public/Active` 2.

⚠ **Worth a separate look, unrelated to this question:** `NUSMU23-101A - MTEST` and `- WTEST` (products 30706/30707) read as **test products sitting in Cin7 production, Public and Primary — i.e. poller-eligible and shipping to SCALE.** Not a QA finding for this ticket, but somebody should know.

---

## 4. ⚠ The mechanism in Plan A was wrong — and the correct one is safer

**Plan A recorded:** *"the group id is assembled as `{company}#{productOptionCode}_{size}` from separate clean fields, so whitespace in the size-suffixed code can never reach it by construction."*

**That is falsified by this scan.** Product 29942's option data, read directly from Cin7:

```
productOptionCode = 'WTW23-922G'          (clean)
code              = 'WTW23-922G··-S'      (two spaces)
size              = 'S'                    <-- NOT '-S'
```

Now test both theories against the group id actually observed in the 2026-08-06 poller logs, `CTC#WTW23-922G_-S`:

| Theory | Predicted group id | Match? |
|---|---|---|
| Separate clean fields — `{company}#{productOptionCode}_{size}` | `CTC#WTW23-922G_S` | **✗ NO** — requires `size` to be `'-S'`, and it is `'S'` |
| **Collapse whitespace runs in `item_code` — `{company}#re.sub(r"\s+","_",code)`** | **`CTC#WTW23-922G_-S`** | **✓ EXACT** |

**MEASURED (the field values) + INFERRED (the transform).** The collapse theory reproduces the observed string character-for-character with no additional assumption, and it also explains the detail that first caught attention — **two spaces becoming ONE underscore** is a whitespace-*run* collapse, not a per-character replace. The competing theory is positively falsified by `size='S'`.

**Why this matters: it inverts the residual.** Under the old theory, whitespace in the bare `productOptionCode` was the one shape that could still reach the populator's raw-concat path — hence this scan. Under the correct theory, **the poller sanitises whitespace wherever it appears in `item_code`**, so the 13 products in §3 are sanitised exactly as 29942 was. **There is no reachable path, not merely an unexercised one.**

---

## 5. Verdict

**CS5 / ERR5 closes as a harness artefact. Do not raise the ticket.** Unchanged from Plan C check 6 — but now resting on a correct mechanism and with the residual actually checked rather than assumed away.

**Carry forward:**

1. **Correct the mechanism wherever it was written down.** `PLAN-A-WHITESPACE-REAL-PATH.md`, `PLAN-C-SCALE-MANUAL-CHECKS.md`, `CLAUDE.md`, the state index and QA DOC 1116's ERR5 row all state the "separate clean fields" version. It gives the right answer for the wrong reason, which is exactly the kind of thing that breaks later when someone reasons from it.
2. **The buffer-populator's missing containment is still a real, low-severity latent note** — it has no containment for a raw-whitespace group id and swallows the exception at INFO (`Invocations: 407, Errors: 0`). Nothing currently reaches it. Any *future* producer that raw-concats without the poller's sanitiser would lose records silently.
3. **The one confirmation still worth having (free).** Search the retained poller logs for any of the 13 codes in §3 and read the literal `message_group_id` emitted. Retention is never-expire, so this costs nothing. A single hit showing a collapsed-underscore group id would upgrade §4 from **INFERRED** to **MEASURED**. These are older, low-churn products so they may not appear in the retained window — absence would not be evidence either way.
4. **Optional, one question to Kian:** is the group id built by collapsing whitespace runs in `item_code`? That closes §4 outright and is cheaper than log archaeology.

---

## 6. Claim tags

- Field inventory (`styleCode`; `code`, `productOptionCode`, `productOptionSizeCode`, `supplierCode`, `barcode`, `productOptionBarcode`, `productOptionSizeBarcode`) — **MEASURED**.
- 24,641 products / 137,114 options / 95,506 poller-eligible — **MEASURED**.
- 71 `productOptionCode` whitespace hits, 47 poller-eligible, 13 distinct codes, 13 products, all interior — **MEASURED**.
- The script's printed verdict of 2,942 eligible hits — **MEASURED as an output, WRONG as a conclusion**; it counts `productOptionSizeCode`, `supplierCode` and `styleCode`, none of which reach the group id.
- Product 29942: `productOptionCode='WTW23-922G'`, `code='WTW23-922G  -S'`, `size='S'` — **MEASURED**.
- Group id `CTC#WTW23-922G_-S` in the 2026-08-06 logs — **MEASURED** (prior sessions, re-cited not re-derived).
- Group id is built by collapsing whitespace runs in `item_code` — **INFERRED**, from an exact reproduction of the observed string plus falsification of the alternative. Not confirmed by a code read.
- Whether the 13 products in §3 are CTC-company products — **UNKNOWN**. The scan was not company-scoped.
- Whether any of the 13 has ever been emitted by the poller — **UNKNOWN**, and checkable for free (see §5.3).
