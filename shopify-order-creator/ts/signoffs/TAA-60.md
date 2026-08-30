# TAA-60 sign-off (2026-08-30) — order-shape discovery, catalogue for TAA-61

Discovery only, per the ticket. **No source file touched, no case wired, no
CLI change, no order placed, no slot consumed.** The only side effect of
this session is two read-only `dump-availability.js` runs (US and PS,
output not committed) used to settle the gift-card question below and
confirm free-slot stock; `npm run build` + `npm test` were run to confirm
the untouched baseline is still green (**334/334**, matches `main` @
`2df9b6a`).

Branch: `taa-60-shape-discovery`, cut from `main` @ `2df9b6a` (one commit
ahead of the `797f13d` baseline named in the lane brief — that commit is
itself the "current-state" docs update after TAA-48/TAA-53 closed, nothing
that changes anything read below).

## How to read this doc

Each shape below is written to the same fields `CaseDefinition`
(`src/cases/baselineCases.ts:40-70`) already has: SKU mix, a full seed plan
(location → quantity, everything else implicitly zeroed), expected
allocation, expected decrements, expected refunds. TAA-61 turns these
directly into `CaseDefinition` literals — nothing here needs re-deriving
from a written spec.

Store roles use the same names `buildCases()` already uses: **primary**
(`WEB_DC`, `ATP#100`), **secondary** (`STORE_99`, `ATP#99`), **designated**
(`CHERMSIDE_US` `ATP#407` for US / `PS_STORE` `ATP#640` for PS). A shape
written once against these three roles works unmodified for both stores,
same as every existing case.

## The four-location constraint, made explicit

`config.ts:15-20` names four real locations, but **only three are usable by
any one store's shapes**: `CHERMSIDE_US` and `PS_STORE` each belong to one
brand. A US case can use primary + secondary + `CHERMSIDE_US` — three
stores, not four. A shape that wants a fourth genuinely independent
allocation target does not exist within this harness's real-location
budget; every shape below tops out at three shipments for exactly this
reason. (`ALL_LOCATIONS` in `config.ts:20` lists all four together, but no
single store's regression run can address more than its own three.)

## Backup-stock control — already solved, not something new shapes invent

The ticket's sharpest constraint — the real allocator draws on far more
stores than the harness seeds — is already fully handled by the existing
pipeline, not something each shape has to work around itself:
`prepareInventoryForCase` (`flows/inventoryFlow.ts:8-18`) calls
`dynamo.zeroEverywhere(sku)` for **every SKU in the case**, and
`zeroEverywhere` (`clients/dynamo.ts:141-146`) zeroes **every existing
location row for that SKU** (`getAllLocationsForSku` — a full DynamoDB
query, not a fixed four-location list), before `seedInventory` writes the
case's explicit plan. Confirmed live just now: pool SKUs typically carry
60-190+ location rows each (see the slot dumps below), and every one of
them gets zeroed first. So "every shape must control its own backup stock"
is satisfied simply by **writing down a complete seed plan** (this doc's
job) — the zero-first mechanism that makes ambient stock elsewhere
irrelevant is already built and already used by all 12 existing cases.
Nothing new is needed in `inventoryFlow.ts` for any shape below.

**One real discovery, not yet exercised by any existing case:** every
existing multi-store case (`split`, `fulfil_split`) puts a **different**
SKU at each store, so each SKU's own seed plan is a single `{store: TOP_UP}`
entry and the 99-unit headroom convention (`TOP_UP = 99`,
`baselineCases.ts:92`) never has to be precise — it only has to be
"enough." Two shapes below (`same_sku_split`, `complex_multi_shipment`,
and to a lesser extent `partial_undeliverable_same_sku`) split **one SKU's
order quantity** across stores. For those, **the seed at each store must
equal the exact quantity intended to land there** — seeding `TOP_UP=99` at
two stores for one SKU would very likely let the allocator satisfy the
whole order from a single store (whichever it tries first) instead of
splitting it, defeating the shape entirely. This is stated as a hypothesis
grounded in JJ's worked example, not yet live-proven in this codebase —
**no existing case exercises a same-SKU cross-store split**, so TAA-61
should live-confirm the split actually happens before trusting the exact-
quantity seed plan below, same posture as any other new mechanism in this
project.

## Shape catalogue

| Shape | Status | SKU mix (role → qty) | Seed plan (zero elsewhere implicit) | Expected shipments | Expected per-unit outcome |
| --- | --- | --- | --- | --- | --- |
| **single** | ✅ exists (`single`, slot 0) | 1 SKU × qty 1 | primary: 99 | 1 @ primary | 1 delivered |
| **same_sku_split** | 🆕 new | 1 SKU × qty 4 | primary: 2, secondary: 2 (exact, not TOP_UP) | 2 (primary ×2, secondary ×2) | 4 delivered, split by store, none undeliverable |
| **partial_undeliverable_same_sku** | 🆕 new | 1 SKU × qty 2 | primary: 1 (exact) | 1 @ primary | 1 delivered, 1 undeliverable/refunded — same SKU, same order line |
| **three_shipment_unique** | 🆕 new | 3 SKUs × qty 1 each | SKU-D → primary: 99; SKU-E → secondary: 99; SKU-F → designated: 99 | 3 (one per store) | 3 delivered, no repeats, no undeliverable |
| **complex_multi_shipment** | 🆕 new — the ticket's must-run complex shape | SKU-A × qty 5, SKU-B × qty 1, SKU-C × qty 1 | SKU-A → primary: 3, secondary: 1 (exact); SKU-B → primary: 99; SKU-C → designated: 99 | 3: primary (SKU-A×3 + SKU-B×1), secondary (SKU-A×1), designated (SKU-C×1) | 4 units of SKU-A delivered across 2 shipments, 1 unit of SKU-A undeliverable/refunded, SKU-B and SKU-C both delivered whole as companions |

Existing cases already covering part of the ground (no new shape needed for
these — see next section for exactly which slice of "shape" each one
represents): `multi` (repeat qty, one SKU, one store), `unique` (3 distinct
SKUs, one store, one shipment), `split` (2 distinct SKUs, 2 stores, 2
shipments), `undeliverable` (whole SKU, zero stock), `partial_undeliverable`
(2 distinct SKUs, one stocked one not).

### Why each new shape earns its slot rather than being a variant of an existing one

- **same_sku_split** isolates "one SKU's quantity divides across stores"
  from everything else. `split` already proves 2 different SKUs can each
  resolve to their own store; this proves the **same** SKU can, which is a
  different allocator code path (one line item, one SKU, multiple
  shipments) and the one JJ's worked example depends on. Also the
  necessary stepping stone to prove the exact-quantity seeding hypothesis
  above in isolation, before combining it with an undeliverable unit.
- **partial_undeliverable_same_sku** isolates "one SKU's quantity partly
  fails" from the multi-store-split question. `partial_undeliverable`
  already proves one whole SKU can go undeliverable while a *different*
  SKU in the same order succeeds; this proves a **single line item** can
  split into a delivered portion and an undeliverable portion — relevant to
  the edit-chain mutation risk called out below (does `SetQuantity` target
  the ordered qty or the allocated qty on a line that's already partially
  short?).
- **three_shipment_unique** is the "clean" (no undeliverable, no repeats)
  version of the widest split this harness can build — 3 shipments, the
  maximum given the three-real-location ceiling. Worth having on its own so
  a mutation's behaviour against "many shipments" can be tested without the
  complex shape's refund/undeliverable side effects also being in play (see
  the `fulfillmentOrderMove` reasoning below).
- **complex_multi_shipment** is JJ's worked example plus the "companion SKUs
  shipping alongside" requirement, composed from the three building blocks
  above: it needs same_sku_split's exact-quantity mechanism (SKU-A across
  primary/secondary), partial_undeliverable_same_sku's shortfall (the 5th
  unit of SKU-A), and a `unique`-style companion merging into an existing
  shipment (SKU-B joins SKU-A's primary shipment) plus one going to its own
  shipment (SKU-C at designated) — deliberately reusing the `unique` case's
  proven "different SKUs, same store, one shipment" mechanism for SKU-B
  rather than inventing a fourth one.

## Which of the 12 existing cases cover which shape

| Case (slot) | Shape it represents | Covered — nothing new needed |
| --- | --- | --- |
| `single` (0) | 1 SKU, 1 store, 1 shipment, fully delivered | ✅ this is the ticket's must-run simplest shape, already built |
| `multi` (1) | 1 SKU, repeat qty, 1 store, 1 shipment (Shopify merges the line, Dynamo doesn't) | ✅ |
| `unique` (2-4) | 3 distinct SKUs, 1 store, 1 combined shipment | ✅ |
| `split` (5-6) | 2 distinct SKUs, 2 stores, 2 shipments | ✅ |
| `undeliverable` (7) | 1 SKU, zero stock everywhere, fully refunded | ✅ |
| `partial_undeliverable` (8-9) | 2 distinct SKUs, one stocked one not, mixed outcome across *different* SKUs | ✅ |
| `fulfil_single` (10) | `single` + fulfilment stage | ✅ (fulfilment orthogonal to shape, not re-catalogued) |
| `fulfil_split` (11-12) | `split` + fulfilment stage, both shipments fulfilled independently | ✅ |
| `reject_reallocate` (13) | post-allocation reject → reallocation to a seeded backup | ✅ (reject orthogonal to shape) |
| `reject_undeliverable` (13) | post-allocation reject → all items undeliverable | ✅ (reject orthogonal to shape) |

**Not covered by any of the 12**, i.e. what this catalogue adds:
same-SKU cross-store split (with and without a shortfall), a 3-shipment
single order, and the combined complex shape. Fulfilment and reject are
orthogonal dimensions already proven separable from shape (the existing
`fulfil_*`/`reject_*` cases each pair one *existing* shape with an extra
stage) — TAA-61 can pair any new shape with `fulfilment: true` or a
`rejectMode` the same way if a specific mutation combination calls for it
(see below), without inventing new fulfilment/reject mechanics.

## Slot sizing — 38-49 (12 reserved), free spare confirmed clean

| Slot | Shape | SKU role |
| --- | --- | --- |
| 38 | `same_sku_split` | the one SKU |
| 39 | `partial_undeliverable_same_sku` | the one SKU |
| 40 | `three_shipment_unique` | SKU-D (primary) |
| 41 | `three_shipment_unique` | SKU-E (secondary) |
| 42 | `three_shipment_unique` | SKU-F (designated) |
| 43 | `complex_multi_shipment` | SKU-A (split + shortfall) |
| 44 | `complex_multi_shipment` | SKU-B (companion, merges into primary shipment) |
| 45 | `complex_multi_shipment` | SKU-C (companion, own shipment at designated) |
| 46-49 | unclaimed | left for TAA-61 — e.g. a fulfilled variant of `same_sku_split` for the return-mutation risk below, if it takes that path |

**8 of the 12 reserved slots used; no need to reach into the 53-79 spare
block.** If TAA-61 does want a 13th shape (e.g. the fulfilled multi-shipment
variant flagged in the mutation section below), the genuinely free spare
slots confirmed clean this session are **US 57, 60, 63, 74-79** and **PS**
same numbers (both stores' equivalents dumped and checked, see next
section) — matching exactly what the lane brief named as unclaimed.

## Gift-card check — settled, with a discrepancy flagged for whoever owns TAA-53's ledger

Ran `node dist/scripts/dump-availability.js <US|PS>` (read-only, no writes)
against the full pool, live, just now (2026-08-30). Cross-checked every
slot named as free in the brief (US: 38-49, 53-64, 74-79) plus the PS
equivalents.

**Slots 62 and 63 (US) are both ordinary apparel, live-confirmed, matching
the static title record — neither is a gift card:**

| Slot | SKU | Live product title | Status | Real stock |
| --- | --- | --- | --- | --- |
| 62 | `34074855` | Thrills Slacker Jean Dusk | DRAFT | 29, spread across 11 locations incl. `ATP#100`:9, `ATP#407`:2 |
| 63 | `33855417` | Wrangler Low Farrah Jean Black Wonder | DRAFT | 11, spread across 9 locations incl. `ATP#407`:1 |

This matches `sku-lists/us-skus.json`'s title record for both SKUs
exactly — no staleness found there. **TAA-53's sign-off records order
#9992 as SKU `34074855` at "slot 63," and describes that SKU as a gift card
(`deliveryMethod: DIGITAL`).** Neither slot 62 nor 63 is a gift card by
live product data checked today, same-day as that probe. Given the
same-day timing, a genuine product swap on that exact variant GID between
the two sessions is unlikely; the more probable explanation is a
bookkeeping slip in TAA-53's order table (a mislabeled slot number for
whichever order actually hit the gift-card variant), not a live-catalogue
change or a stale JSON title. **Not chased further — outside this ticket's
scope to correct someone else's sign-off** — flagged here because the
ticket specifically asked this be settled before shape work relies on the
pool, and the answer is: **the pool as it stands today has no gift card at
62 or 63.** Whoever next touches TAA-53's ledger should reconcile which
order actually used the gift-card SKU.

**All other checked slots (38-49, 53-61, 64, 74-79, both stores)**: every
one resolved to an ordinary apparel/accessory/footwear product, `ACTIVE` or
`DRAFT`, with nonzero real stock at 3 to 162 distinct locations. No gift
cards, no deliveryMethod anomalies observed in any of the fields
`dump-availability.js` reads (it doesn't read `deliveryMethod` directly,
but a gift-card product would show as a single-digital-location or
zero-inventory-row product, which none of these did — every slot checked
carries ordinary multi-location physical stock).

## Risky mutation × shape combinations

**Caveat up front: the LLD's TC7-29 numbering lives in Confluence, not in
this repo** — I have the slot-map's summary of which TC range each ticket
owns (`CLAUDE.md`'s slot table: TC7-12 hold lifecycle/TAA-54, TC13-19
edit & refund/TAA-56, TC20-22 + TC27-29 return & finalisation/TAA-58) and
TAA-53's one specific note that TC24 is `fulfillmentOrderMove`. I don't have
the individual TC bodies, so what follows is reasoned at the
mutation-family level from TAA-53's six confirmed contracts
(`CLAUDE.md`'s TAA-53 section), not a TC-by-TC audit.

| Mutation family | Default (per LLD §9) | Recommend a 3rd shape? | Reason |
| --- | --- | --- | --- |
| Order-edit chain (`orderEditBegin`→`AddVariant`→`SetQuantity`→`AddLineItemDiscount`→`Commit`), TC13-19 | `single` + complex | **Yes — `partial_undeliverable_same_sku`** | TAA-53 found this chain produces 3 separately-staggered `TRANSACTION#` rows (`REFUND_ITEM`, `HOLD_ORDER`, `ADD_ITEM`) on a single, fully-delivered line. Nothing has tested `SetQuantity`/`AddVariant` against a line item that already has part of its ordered quantity gone undeliverable — whether the edit targets the ordered qty or the settled/allocated qty is exactly the kind of contract surprise this probe already found once (the missing `paymentPending` arg, the reason-code translation). Cheapest shape to isolate it with, since it doesn't also carry the complex shape's multi-store noise. |
| `fulfillmentOrderMove`, TC24 | `single` + complex | **Yes — `three_shipment_unique`** | Move only means something with 2+ live shipments to move between; `single` gives it nothing to move, and if `complex` is the only multi-shipment shape exercised, TAA-53's already-open "0 rows in 60s, consistent with CC-filtering" finding is confounded by the complex shape's own refund/undeliverable side effects happening in the same order. `three_shipment_unique` isolates the move mutation against a "clean" 3-shipment order with nothing else going on, so a null result can be attributed to the mutation, not to noise from an unrelated refund. |
| `returnCreate` + `returnClose` with money movement, TC20-22 & TC27-29 | `single` + complex | **Yes — a fulfilled multi-shipment shape (e.g. `same_sku_split` or `three_shipment_unique` with `fulfilment: true`)** | Returns require fulfilled items. `complex_multi_shipment` as specified here is *not* fully fulfillable — its 5th unit is deliberately undeliverable and can never reach a return-eligible state. Testing return TCs on `single` + `complex` alone leaves "return against a multi-shipment, fully-delivered order" completely unexercised, which is precisely the "return with money movement" gap TAA-53 already flagged as untested. A same-SKU-split or three-shipment shape with `fulfilment: true` (no existing case combines split-shipment + fulfilment except `fulfil_split`, which uses *different* SKUs) gives returns something with more than one shipment to return against. |
| `orderMarkAsPaid` / payment-priming sequence | n/a (not a per-shape TC in the slot map) | No | This is a payment-state variation (unpaid → paid), orthogonal to shipment shape — TAA-53 already tested it against the simplest possible order deliberately, to isolate the payment mechanics from shape noise. No shape-specific risk identified. |
| `refundCreate` idempotency-key header | n/a | No | Pure Admin-API/HTTP-header behaviour, doesn't touch allocation or shipment shape at all. |
| `fulfillmentOrderHold` / `ReleaseHold` | TC7-12 | No | TAA-53 found this clean and symmetric (`HOLD_ORDER`/`UNHOLD_ORDER`, ~5-10s both directions) on the simplest order shape; nothing in the six contracts suggests hold/release behaves differently by shipment count — no shape-specific risk identified from available evidence. |

## Checklist

- [x] Shape catalogue table: shape name, SKU mix, full stock layout per
      location, expected shipment composition, expected per-unit outcomes
- [x] Which shapes the 12 existing cases already cover, called out
      explicitly
- [x] Every layout states its own zero/seed plan and its backup-stock
      control (and why the existing zero-first mechanism already covers it)
- [x] SKU/slot sizing per shape, mapped onto 38-49 and named free spare
      slots
- [x] Risky mutation × shape combinations listed with reasons
- [x] Every shape feasible against the four real locations (max 3 usable
      per store), no impossible layouts
- [x] Nothing under `src/` modified — confirmed by `git status` before
      writing this doc and again below

```
$ git status --short shopify-order-creator/ts/src
(no output)
```

`npm run build` + `npm test`: **334/334 green**, unchanged from the `main`
baseline this branch was cut from — this ticket changed no source, so
there was nothing to regress.
