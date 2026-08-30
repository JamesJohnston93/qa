# TAA-47 sign-off — `scripts/prepare-skus.js`, stock-based SKU readiness reporter

Branch: `taa-47-prepare-skus` (cut from `main` @ `1ed9ac6`). Ticket re-scoped by JJ
2026-08-30 to stock-only (no publication/catalog/market check) — the current
description, not the superseded original, is what this implements.

## What it does

One command: given an arbitrary SKU list (text or JSON) and a store, reports
PASS/FAIL per SKU with a reason, and can emit the paste-ready pool-addition
block for `src/variants.ts`.

```
node prepare-skus.js <US|PS> <input-file> [--emit-block]
```

- `<input-file>` ending `.json`: an already-resolved list,
  `[{sku, gid, title, price}, ...]` — the same shape `fetch-sku-gids.js`
  writes to `sku-lists/<store>-skus.json`. Skips GID resolution entirely.
- Any other extension: plain text, one SKU per line (the form JJ actually
  supplies), deduplicated. Unresolved SKUs are looked up via
  `ShopifyClient`, batches of 50, same `productVariants(query: "sku:X OR
  sku:Y ...")` shape `fetch-sku-gids.js` uses.
- Every SKU with a resolved GID gets a `getAllLocationsForSku` stock check,
  `AGGREGATE_LOCATIONS` (`config.ts`) excluded from the sum — `realStockFor`
  is `select-pool-candidates.js`'s function verbatim, not re-derived.
- `PASS` = real stock > 0. `FAIL` has two distinct reasons: "no matching
  variant GID found in Shopify" (unresolved) vs. "zero real stock across
  non-aggregate locations" (resolved but out of stock) — kept as separate
  strings deliberately, per the ticket, so a reader doesn't conflate "isn't a
  real SKU" with "is real but empty."
- `--emit-block` prints both required halves — the `US_VARIANTS`/
  `PS_VARIANTS` sku→gid lines and the matching `US_SKU_ORDER`/`PS_SKU_ORDER`
  array lines, same order, in the exact per-entry format `variants.ts`
  already uses (`"sku": "gid",` / `"sku",`) — paste-ready, not JSON. PASS
  entries only.

## Structural decisions

**GID resolution logic is duplicated from `fetch-sku-gids.js`, not
required from it.** That script has no `module.exports` — its whole body is
a bare `main()` invoked unconditionally at the bottom of the file, a side
effect of `require()`. Making it reusable would mean editing a file this
lane doesn't own (not listed as mine, and TAA-14/22's completed script,
not part of this wave's live lanes, but still out of scope per the ground
rules). Reused the *path* (`ShopifyClient`, batch size 50, identical query)
by copying the ~25-line batch-query function into `prepare-skus.js` instead
— small duplication over editing someone else's file or a premature shared
module, per this session's own instructions.

**Pure logic exported for offline testing, not moved to `src/`.**
`ts/scripts/*` are plain CommonJS requiring compiled `../dist/`, outside the
tsconfig build; the offline suite tests `dist/`, so nothing living purely in
a script is reachable by it. Exported `classifySku`, `formatPoolBlock`, and
`loadInput` via `module.exports` at the bottom of `prepare-skus.js`;
`tests/prepareSkus.test.js` requires them directly — no `src/` change.
`main()`'s auto-invocation is now guarded with `if (require.main ===
module)`, which `fetch-sku-gids.js`/`select-pool-candidates.js` don't need
(nothing requires them) but this script does, since requiring it for its
exports would otherwise run `main()` against the test runner's own argv.

**`STOCK_CHECK_CONCURRENCY` kept at 15**, unchanged from
`select-pool-candidates.js`, same Dynamo table, no reason found to change
it.

## Offline tests

New file `tests/prepareSkus.test.js`, 10 tests: `classifySku`'s three
branches (unresolved GID, resolved+zero-stock, resolved+positive-stock,
each with a distinct, non-overlapping reason string), `formatPoolBlock`'s
both-halves-same-order shape, its store-name switch (US_VARIANTS vs.
PS_VARIANTS), and its throw on an empty PASS list; `loadInput`'s text-file
dedup path, its already-resolved-JSON path, and its throw on a JSON entry
missing `sku`.

`npm run build` + `npm test`: **379/379 green** (369 baseline + 10 new),
confirmed clean before the environment collision described below (see that
section — a later same-session rebuild attempt failed on unrelated code from
another lane, not this one).

## Live confirmation, both stores

Ran twice per store: once against a small plain-text list (mix of
not-yet-pooled candidates plus one deliberately invalid SKU string, to
exercise all three classification paths), once against a JSON slice of an
existing `sku-lists/*.json` to confirm the already-resolved input path skips
GID resolution correctly. No pool slots touched, no orders placed, no
writes — `getAllLocationsForSku` and one GraphQL query only.

**US** (`node prepare-skus.js US <list> --emit-block`):
```
FAIL  33790497  zero real stock across non-aggregate locations
FAIL  34061343  zero real stock across non-aggregate locations
FAIL  33876344  zero real stock across non-aggregate locations
FAIL  33948256  zero real stock across non-aggregate locations
FAIL  33872704  zero real stock across non-aggregate locations
FAIL  33829081  zero real stock across non-aggregate locations
PASS  33772110  real stock 65 across non-aggregate locations
PASS  33766584  real stock 9 across non-aggregate locations
FAIL  00000000-NOTAREALSKU  no matching variant GID found in Shopify

2/9 PASS for US
```
Emitted block verified paste-shaped (`"33772110": "gid://shopify/ProductVariant/51754273505553",` /
`"33772110",` etc., both halves present, same order).

**PS** (`node prepare-skus.js PS <list> --emit-block`):
```
FAIL  33872704  zero real stock across non-aggregate locations
FAIL  33880952  zero real stock across non-aggregate locations
FAIL  33855141  zero real stock across non-aggregate locations
FAIL  33808703  zero real stock across non-aggregate locations
PASS  33636986  real stock 300 across non-aggregate locations
PASS  34042649  real stock 80 across non-aggregate locations
PASS  32220537  real stock 1321 across non-aggregate locations
PASS  33800493  real stock 4 across non-aggregate locations
FAIL  00000000-NOTAREALSKU  no matching variant GID found in Shopify

4/9 PASS for PS
```

**Already-resolved JSON input** (`node prepare-skus.js US sku-lists-slice.json`,
no `--emit-block`, no `resolveGids` call — verified in the output that no
"Resolving N SKU(s) via Shopify" line appears, straight to stock-checked):
```
PASS  33898889  real stock 95 across non-aggregate locations
FAIL  33992457  zero real stock across non-aggregate locations
FAIL  33788579  zero real stock across non-aggregate locations
```
(These three SKUs are already-pooled slots; their stock having moved since
they were last confirmed live is expected — three other sessions are placing
orders on shared staging concurrently right now, see the environment note
below. Not a script defect: it read and reported the live number correctly.)

## ⚠ Environment collision found mid-session — needs JJ's attention

**This is a shared git working directory across all four parallel sessions,
not isolated worktrees.** Partway through this session, `git status` showed
HEAD had moved from `taa-47-prepare-skus` to `taa-52-verify-orders-service`
with that lane's own uncommitted, in-progress changes in the tree
(`src/cli-order.ts`, `src/clients/shopify.ts`, `src/config.ts`,
`src/verify/index.ts`, `src/verify/orders.ts`, plus new untracked
`src/flows/editFlow.ts`/`holdFlow.ts`, `src/verify/finalisation.ts`/
`holds.ts`/`transactions.ts`) — none of which this session touched or
caused. A rebuild attempted after noticing this failed with two TS errors
neither this session nor its files are responsible for
(`cli-order.ts(268,34)`: `locationId` not in the pickup type; `shopify.ts(172,22)`:
`fetchNamedPickupHandle` missing) — almost certainly TAA-52's own
in-progress edit mid-flight, not a real regression, but this session could
not safely re-verify a final green `npm run build`/`npm test` afterward
without risking interference with that other live session's work in
progress, so it didn't try.

**No git action was taken in response** — no checkout, no stash, no reset —
specifically to avoid disturbing that other session's uncommitted work while
it appeared to still be actively writing files. This session's own new files
(`scripts/prepare-skus.js`, `tests/prepareSkus.test.js`, this sign-off) are
untracked and were unaffected by the branch move. **Nothing has been
committed** — committing right now would risk sweeping in `taa-52`'s
unrelated, currently-broken changes onto this branch. Recommend JJ (or
whoever runs these sessions) either move each lane to a real `git worktree`
per session, or serialise branch checkouts, before more of wave 3 runs in
parallel — the collision is real and got worse (more files appeared) over
the few minutes this was being investigated.

**This session's own last known-clean verification, captured above, predates
the collision**: `npm run build` clean, `npm test` 379/379, both live runs
completed successfully immediately after. The script itself is done and
correct; the build/test snapshot above is trustworthy, just not
re-confirmable in this shared tree at sign-off time without another
session's cooperation.

## Checklist

- [x] Takes a SKU list (text or JSON) plus a store, resolves GIDs through the
      `fetch-sku-gids.js` path (query shape/batch size reused, logic
      duplicated per the structural-decision note above)
- [x] Per-SKU PASS/FAIL with a reason; aggregate locations excluded;
      unresolved GIDs distinguished from zero stock
- [x] Whole list processed; progress output per GID batch and per
      stock-check batch
- [x] Optional pool-ready block: both `*_VARIANTS` and `*_SKU_ORDER` halves,
      same order, paste-ready
- [x] Pure filtering/formatting logic (`classifySku`, `formatPoolBlock`,
      `loadInput`) exported and covered by offline tests
- [x] Run once over a supplied list on both stores, results recorded above
- [x] Hand-run only, requires compiled `../dist/`, not wired into
      `npm run build`/`npm test`
- [x] `npm run build` + `npm test` green (379/379) — verified before the
      environment collision above; not re-run after it, by design
- [x] Nothing under `src/` modified by this session; no writes to staging;
      no pool slots consumed (read-only: one GraphQL query, `getAllLocationsForSku`)

## Out of scope, confirmed unaffected

No publication/catalog/market mutation or read. No change to
`src/variants.ts` itself — this emits a block for JJ to paste, never pastes
it. No inventory seeding (TAA-16's territory, untouched).
