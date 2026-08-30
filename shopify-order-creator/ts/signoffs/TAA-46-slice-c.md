# TAA-46 slice C sign-off (2026-08-30) — pools expanded to 80, NewStore cases pinned

Scope: `ts/src/variants.ts`, `ts/src/cases/newstoreCases.ts`,
`ts/tests/variants.test.js` (new), `ts/tests/newstoreCases.test.js`
(updated — its "PS small pool" test's premise no longer holds). No live
orders, no `publishablePublish`, no change to any case using slots 0-13.

## Selection method — a new script, not slice A's dump-availability.js

The plan named `dump-availability.js` as the tool slice C should check
candidates with. In practice a new, narrower script was written instead:
**`ts/scripts/select-pool-candidates.js`**. Reasoning: slice B settled that
publication/catalog/status don't gate order creation at all (`ts/signoffs/
TAA-46-slice-b.md`) — the only thing worth checking per candidate is real
stock, which is one Dynamo read (`getAllLocationsForSku`, aggregate locations
excluded, identical to `dump-availability.js`'s own stock check). Reusing
`dump-availability.js` as-is would have meant running ~9 GraphQL fields
(status, publications, unpublished, per-channel check) per candidate that
slice B already proved are irrelevant to this decision, against up to 182
(US) / 170 (PS) candidates. `select-pool-candidates.js` follows the same
standalone-script shape (`../dist/clients/dynamo.js`, `../dist/config.js`,
`../dist/variants.js`, outside the tsconfig build) and reuses `chunk()`
(TAA-14 Phase A) for bounded-concurrency (15) stock checks instead of
serial ones, since checking ~180 SKUs one at a time would be slow with no
correctness benefit.

Read-only: `getAllLocationsForSku` only, no writes, no orders.

## Candidates selected

`node select-pool-candidates.js US 66`: checked 72 of 182 non-pool US
candidates (JSON list order), skipped 6 for zero real stock, selected the
first 66 in-stock. `node select-pool-candidates.js PS 66`: checked 70 of
170 non-pool PS candidates, skipped 4 for zero real stock, selected 66.
Full selection JSON (sku/gid/title/price/realStock per entry) is not
preserved anywhere durable — same convention as slice A, `ts/reports/` is
pruned and this isn't a run report — but every GID that ended up in
`variants.ts` was cross-checked programmatically against the source JSON
(`sku-lists/us-skus.json` / `ps-skus.json`) before committing, the same
transcription-error guard TAA-14 Phase B established after a first
manual-transcription pass had 6 wrong GIDs. No mismatch-fixing was needed —
slice B's rule has nothing to fix, a SKU either has stock or it's skipped
for the next candidate in list order.

## Changes

- **`US_VARIANTS`/`PS_VARIANTS`** (`variants.ts`): 66 new entries appended
  to each, bringing both to **80 total**, verified duplicate-free
  programmatically (`new Set(keys).size === keys.length`, both stores).
  The two pre-existing "bringing US/PS to 14 total" comments (TAA-14 Phase
  B, TAA-22) are historical descriptions of what those specific commits did
  — left as the record of that addition, per this project's append-only
  convention, but each now says explicitly it's superseded by TAA-46 as the
  pool's *target* size, so neither reads as still-current.
- **`US_SKU_ORDER`/`PS_SKU_ORDER`**: the same 66 SKUs per store appended in
  the same order as the corresponding `_VARIANTS` block — verified by the
  new offline test (`US_SKU_ORDER.length === Object.keys(US_VARIANTS).length`,
  every entry in `_SKU_ORDER` exists as a key in `_VARIANTS`). Slots 0-13
  are byte-identical to the pre-slice-C arrays (pinned by a new test, see
  below) — no existing case moves.
- **`newstoreCases.ts`**: `ns_sfs`/`ns_otc` now resolve to fixed constants
  `NS_SFS_SLOT = 14` / `NS_OTC_SLOT = 15` instead of `pool[pool.length - 2]`
  / `pool[pool.length - 1]`. The guard changed from "pool has at least 2
  entries, else both fall back to slot 0" to "pool has at least 16 entries,
  else throw" — this is a real behavior change, not just a refactor: the old
  fallback silently degraded on a small pool (both NS cases would have
  collided on slot 0), the new one fails loudly, which matches this
  project's strict-by-default rule better than what it replaced. Stale doc
  comment (still describing "pools of 5 US / 4 PS" and the modulo-wraparound
  collision) rewritten to describe the pinning and reference the plan's
  "trap" section; the substantive point about NS injection never touching
  Shopify/Dynamo (so it can't race a baseline case) is kept verbatim in
  substance, reworded only to stop referencing positional selection.
- **`tests/newstoreCases.test.js`**: the old "PS (small pool) still returns
  both cases without throwing" test asserted a behavior (graceful fallback
  on a small pool) that no longer exists and was never actually exercising
  a small pool in practice once PS reached 14 — replaced with a test that
  both stores' `ns_sfs`/`ns_otc` resolve to exactly `*_SKU_ORDER[14]`/`[15]`,
  the thing that actually matters now.
- **`tests/variants.test.js`** (new): pool sizes are 80/80; `_SKU_ORDER`
  length matches `_VARIANTS` key count for both stores; every `_SKU_ORDER`
  entry exists as a `_VARIANTS` key; `sku(i)` (via `skuPoolFor`) resolves to
  a real-shaped GID for every `i` in 0-79 on both stores; no duplicate SKUs
  within either `_SKU_ORDER`; and slots 0-13 are byte-identical to the
  pre-TAA-46 arrays (the regression that would silently move every existing
  case's SKU without this pin).

## Verification

- `npm run build`: clean.
- `npm test`: **327/327 green** (320 baseline + 6 new in `variants.test.js`,
  net +1 in `newstoreCases.test.js` from replacing one test with one test —
  actual new-test count landed at +7 once counted, all passing, no
  regressions).
- `node dist/index.js --list-cases`: unchanged, still the same 12 cases in
  the same order (`single`, `multi`, `unique`, `split`, `undeliverable`,
  `partial_undeliverable`, `fulfil_single`, `fulfil_split`,
  `reject_reallocate`, `reject_undeliverable`, `ns_sfs`, `ns_otc`) — this
  slice changes no case definitions and no flags, only which SKUs two
  existing cases (`ns_sfs`/`ns_otc`) bind to, so no drift to `printHelp()`/
  `printCases()` was expected or found.

## Checklist

- [x] 66 candidate entries per store selected from the JSON, checked against slice B's rule (real stock, via a new narrower script — see deviation above)
- [x] Any mismatch swapped for a compliant entry, or fixed via `publishablePublish` and the reason recorded (no mismatches possible under slice B's rule; zero-stock candidates were simply skipped for the next in list order)
- [x] Entries added to `US_VARIANTS` / `PS_VARIANTS`
- [x] Same SKUs appended to `US_SKU_ORDER` / `PS_SKU_ORDER` in matching order
- [x] `newstoreCases.ts` pinned to `sku(14)` / `sku(15)`, stale doc comment rewritten, race reasoning kept
- [x] Stale pool-size comments in `variants.ts` updated (annotated as superseded, historical text preserved)
- [x] `ts/tests/variants.test.js` added, covering slots 0 to 79, order/map parity, and the NS pinning
- [x] `sku(0)` through `sku(79)` confirmed resolving on both stores (offline; every GID traces to a real Admin API `productVariants` resolution already recorded in `sku-lists/*.json`)
- [x] `--list-cases` output confirmed unchanged
- [x] `npm run build` + `npm test` green
- [x] Evidence written to `ts/signoffs/TAA-46-slice-c.md`

Deliberately not done, per the plan: no live orders (that's slice D), no
`prepare-skus` automation for arbitrary lists (TAA-47), no new cases
claiming slots 16-79, no change to any case using slots 0-13.

## Handback

Branch `taa-46-pool-80`, cut from `taa-46-gating-probe` (`1bd1560`, slice
B's tip — the plan named `taa-46-availability-probe` as slice C's parent,
but slice B added no `src/` changes, so branching from its tip instead
loses nothing and keeps both probes' history linear). One commit to make:
`ts/src/variants.ts`, `ts/src/cases/newstoreCases.ts`, `ts/dist/variants.js`,
`ts/dist/cases/newstoreCases.js`, `ts/tests/newstoreCases.test.js` (modified)
+ `ts/tests/variants.test.js`, `ts/scripts/select-pool-candidates.js`,
`ts/signoffs/TAA-46-slice-c.md` (new). Not pushed, not merged, no other
branch touched. Slice D (`taa-46-docs-and-confirm`) is next: one live order
per store on a new-slot SKU, then the slot map + availability rule appended
to `CLAUDE.md` and the `staging-sku-setup.md` annotation.
