# TAA-46 plan: SKU pool expansion to 80 slots per store + sales-channel availability verification

Written 2026-08-28 by `taa-ticket-start`. Baseline: `main` @ `831e204`, ahead 1 of
`origin/main`, working tree clean apart from untracked `.claude/` and `_to_delete/`,
build clean, **320/320** offline tests green.

Ticket: https://universalstore.atlassian.net/browse/TAA-46 (parent workstream TAA-43)
Blocks: TAA-49 (orders-service cases), TAA-61 (shape cases)
Dev doc: see the QD "QA Automation Tool" folder, page linked on the ticket

## Goal in one sentence

Grow both stores' SKU pools from 14 to 80 slots with entries proven purchasable, and
write down the rule that makes a SKU purchasable so TAA-47 can automate it without
rediscovering it.

## Scope changed on 2026-08-28, after the repo check

Three calls by JJ that supersede the ticket text. The ticket description still says 64
slots and 50 new; treat this file as current.

1. **80 slots per store, 66 new, not 64/50.** The conventions doc's own worst-case
   estimate for the finished package is 70 to 80 active slots. Building 64 would leave
   the ticket needing a revisit, which is the one thing it set out to avoid. Both JSON
   files have the headroom: 191 resolved pairs for US, 180 for PS.
2. **`ns_sfs` and `ns_otc` get pinned to slots 14 and 15.** See the trap below. TAA-31
   closed without needing slots 14 and 15, so they are free.
3. **Pool SKUs stay ordinary staging-catalogue products.** `staging-sku-setup.md` says
   anything new should be a dedicated `QA TEST` product; that recommendation is
   deliberately not followed, and slice D annotates the doc so the next reader is not
   misled.

## Verified against the repo, 2026-08-28

- Slots 0 to 13 are fully assigned: `ts/src/cases/baselineCases.ts` calls `sku(0)`
  through `sku(13)`, and slot 13 carries both reject cases (`:219` reallocate, `:235`
  undeliverable).
- `scheduler.ts:24-49` `buildWaves` greedily places a case in the first wave whose SKU
  set does not overlap, so a shared slot serialises those cases and never corrupts
  state. Confirms the ticket: this expansion buys wall-clock, not capability.
- `sku-lists/us-skus.json` holds 191 entries and `ps-skus.json` 180, every one with a
  `gid://` value. **They are JSON arrays of `{sku, gid, title, price}` objects, not
  SKU-to-GID maps.** The ticket calls them "pairs"; read them as arrays.
- `ts/scripts/fetch-sku-gids.js` exists, is read-only, and reuses the compiled
  `ShopifyClient` from `../dist/clients/shopify.js`. It is deliberately outside the
  tsconfig build. New probe scripts follow the same shape.
- `ts/src/clients/shopify.ts:94` exposes a public generic
  `execute<T>(query, variables)`, and `:357` pins the Admin API at **2025-10** for both
  stores. Auth and throttle retry come free.
- No publication, catalog or product-status surface exists anywhere in `ts/src`: zero
  hits for `resourcePublicationsV2`, `publishedOnPublication`, `unpublishedPublications`,
  `publishablePublish` or `product.status`. Part 2 is greenfield.
- `ts/plans/` did not exist before this file.

### The trap: NewStore cases are bound by position, not by slot

`ts/src/cases/newstoreCases.ts:38-40`:

```ts
const sfsSku = pool[pool.length >= 2 ? pool.length - 2 : 0];
const otcSku = pool[pool.length - 1];
```

`ns_sfs` and `ns_otc` take the **last two pool entries**, so growing the pool to 80
silently migrates them from slots 12 and 13 to slots 78 and 79: brand-new SKUs whose
availability this ticket has not yet proven. The ticket's claim that slots 0 to 13 are
used "across baselineCases.ts and newstoreCases.ts" is wrong in mechanism, and the
mechanism is exactly what breaks on expansion. `newstoreCases.ts`'s own doc comment is
also stale, still describing pools of "5 US / 4 PS".

Slice C pins both to `sku(14)` and `sku(15)`.

## Open questions

None blocking. One question is deliberately left for slice B to answer empirically
rather than assumed, and slice C depends on its answer:

- **Does channel publication actually gate Admin-API order creation, or only storefront
  visibility?** The harness creates orders through the Admin API, so publication may
  gate nothing here, with market and catalog membership mattering instead for price and
  currency resolution. Do not assume either way. Slice B settles it by comparing the
  known-good 14 against a deliberately non-compliant SKU.
- Expect a possible **scope gap** on one or both apps for publication reads or the
  `publishablePublish` mutation, the same risk class TAA-22 hit with `read_products`. If
  a scope is missing, that is a finding to record and hand to JJ, not something to work
  around.

## Slot map, 0 to 79

| Slots | Owner |
| --- | --- |
| 0 to 13 | existing default case set, unchanged |
| 14 to 15 | `ns_sfs` / `ns_otc`, pinned by slice C (freed by TAA-31 closing on slot 13) |
| 16 | TAA-32 click & collect |
| 17 | TAA-33 finalisation |
| 18 to 23 | hold lifecycle TC7-12 (TAA-54) |
| 24 to 30 | edit & refund TC13-19 (TAA-56) |
| 31 to 37 | return & finalisation TC20-22, TC27-29 (TAA-58) |
| 38 to 49 | order shapes (TAA-60 discovery, TAA-61 cases); resize within this block rather than extending the pool |
| 50 to 52 | discount & BOGO (TAA-62) |
| 53 to 79 | spare (27 slots), including the complex-order shapes JJ is adding to scope later |

## Slices

| Slice | Done when | Owns | Shared resources |
| --- | --- | --- | --- |
| A | Run one command per store and get, for slots 0 to 13 plus three candidate SKUs, each product's status, its publications with `isPublished`, and its catalog/market membership, on both stores | `ts/scripts/dump-availability.js` (new) | none: read-only, no orders, no mutations |
| B | One live order attempted on a deliberately non-compliant SKU, with the outcome and the derived rule written down | `ts/signoffs/TAA-46-slice-b.md` | one live order on one store, on a JSON SKU outside the pool |
| C | `sku(0)` through `sku(79)` resolve on both stores, `ns_sfs` and `ns_otc` resolve to slots 14 and 15, `--list-cases` output unchanged, build and test green | `ts/src/variants.ts`, `ts/src/cases/newstoreCases.ts`, `ts/tests/variants.test.js` (new) | claims slots 14 to 79 on both stores; slots 0 to 13 untouched |
| D | One live order per store places successfully on a new-slot SKU, and CLAUDE.md carries the 0 to 79 slot map plus the availability rule | `CLAUDE.md`, `staging-sku-setup.md` | two live orders, one per store, on a new-slot SKU |

---

## Slice A: availability profile probe, read-only

Branch: `taa-46-availability-probe`
Goal in one sentence: dump the publication, catalog and status configuration of the 14
known-good slots on both stores and record it as the reference profile.
You own: `ts/scripts/dump-availability.js` (new file only)

Why this is first: it is the riskiest external contract in the ticket and it asserts
nothing. Resolving a SKU to a GID proves the variant exists; it does not prove the SKU
is purchasable. Shopify requires the product ACTIVE, published to the relevant
catalog's publication, and the variant published there, with each selling context
(Online Store, POS, each international market) carrying its own catalog and publication.
Derive the rule from the pool that demonstrably works rather than from the docs, which
is this project's standing rule: assert observed staging spellings, never doc spellings.

### Contract detail, copied in

Follow `ts/scripts/fetch-sku-gids.js` exactly in shape: a standalone Node script under
`ts/scripts/`, `require`ing `../dist/clients/shopify.js`, outside the tsconfig build
(`tsconfig` includes only `src/**/*.ts`), usage `node dump-availability.js <US|PS>`.
That gets US's static token and PS's OAuth client-credentials grant, plus throttle
retry, for free.

`ShopifyClient` surface you need:

- `client.execute<T>(query, variables)` is public and generic (`shopify.ts:94`).
- Admin API version is **2025-10** (`shopify.ts:357`), so the 2025-10 schema applies.
- US host `universal-store-staging.myshopify.com`, PS via `PS_SHOP_DOMAIN`.

Admin GraphQL fields to pull, per product (resolve variant GID to its parent product
first):

- `status` on `Product`, which must be `ACTIVE`
- `resourcePublicationsV2` for publication id, name, `isPublished` and `publishDate`
- `unpublishedPublications` to list what a product is missing
- `publishedOnPublication(publicationId:)` for a targeted per-channel check
- `Catalog` / `MarketCatalog` for the market side

Input SKUs: the 14 pool entries per store, read from `ts/src/variants.ts`'s
`US_SKU_ORDER` / `PS_SKU_ORDER` (or the compiled `dist` equivalent), plus three
candidate entries taken from `sku-lists/<store>-skus.json` that are **not** already in
the pool, so slice B has a non-compliant candidate to test.

Output: print a per-SKU profile to stdout as JSON. Do not write it into `ts/reports/`,
which `report.ts` prunes to the 10 most recent runs, so anything there is not durable
evidence. Transcribe the reference profile into the sign-off instead.

### Sharp edges, all real

- Strict by default is the only mode on this project. If a GraphQL field is refused for
  want of a scope, throw with the response body in the message. Do not fall back to a
  partial profile and do not synthesise a value: a missing scope is the finding.
- Expect a scope gap on one or both apps, same risk class as TAA-22 with `read_products`.
  US uses a static token, PS an OAuth grant, so the two can differ. Report each store
  separately.
- Read-only this slice. No `publishablePublish`, no `publishableUnpublish`, no orders.
- Per JJ's comment on the ticket (2026-08-28): reject cycles exhaust a SKU's real
  per-store stock by attrition, because rejection does not restore what allocation
  decremented. So the profile a new slot must match should also confirm the SKU holds
  stock **somewhere**, not merely that it exists. Include a stock read in the dump if
  `getAllLocationsForSku()` can be reused read-only; if not, note it for slice C.

### Checklist

- [ ] `ts/scripts/dump-availability.js` created, read-only, following fetch-sku-gids.js's shape
- [ ] Profile dumped for slots 0 to 13 on US
- [ ] Profile dumped for slots 0 to 13 on PS
- [ ] Three non-pool candidate SKUs dumped per store
- [ ] The common profile of the known-good 14 stated explicitly as the reference, per store
- [ ] Any scope gap recorded per store, with the exact error
- [ ] npm run build + npm test green
- [ ] Evidence and the reference profile written to `ts/signoffs/TAA-46-slice-a.md`

Deliberately not doing: no mutations, no pool changes, no assertions in the suite, no
fix for anything the dump reveals.

---

## Slice B: settle whether publication gates Admin-API order creation

Branch: `taa-46-gating-probe`
Goal in one sentence: place one live order on a SKU that fails the reference profile and
record whether Shopify let it through.
You own: `ts/signoffs/TAA-46-slice-b.md`

Why this is second: slice C has to decide what "compliant" means before it picks 66
SKUs per store. Getting that wrong means picking 132 SKUs against the wrong rule. This
is a one-order experiment that removes the guess.

### Contract detail, copied in

Read slice A's sign-off for the reference profile and pick, from the three candidates
it dumped, one SKU that does **not** match it, ideally one that is not published to the
Online Store publication.

Place one order on it with the existing `order` subcommand on **one** store, US for
preference since it uses the simpler static token. Two outcomes, both are answers:

- **Order creation fails.** Publication gates Admin-API order creation. Every new slot
  must match the reference profile in full, and slice C swaps or fixes any that do not.
- **Order creation succeeds.** Publication gates only storefront visibility. The real
  requirement is narrower, most likely market and catalog membership for price and
  currency resolution. Say precisely which part of the profile is load-bearing and which
  is advisory.

Write the rule down either way, in words a script can be built from. TAA-47 turns this
rule into `prepare-skus`, the repeatable run-as-needed script for arbitrary SKU lists,
and TAA-46's job is to leave it a written rule and not a rediscovery task.

### Sharp edges, all real

- A contract fact stated in prose, including in this file, is a starting hypothesis.
  This slice exists because the answer is genuinely unknown.
- Staging is shared. Place your own order, record its number, do not reuse anyone else's.
- Do not fulfil or reject the order. Fulfilment and rejection are both irreversible in
  staging, and rejection also permanently consumes real per-store stock.
- Also confirm the chosen SKU's stock position, so a "purchasable" verdict is not
  confounded by it simply being out of stock everywhere.

### Checklist

- [ ] Non-compliant candidate chosen, and exactly how it differs from the reference profile stated
- [ ] One live order attempted on US, outcome recorded with the order number or the exact error
- [ ] The availability rule written out in full, marked settled, with the evidence
- [ ] Which parts of the profile are load-bearing versus advisory, stated
- [ ] Evidence written to `ts/signoffs/TAA-46-slice-b.md`

Deliberately not doing: no code changes at all, no pool expansion, no publication
mutations, no second store unless US is inconclusive.

---

## Slice C: expand both pools to 80 and pin the NewStore cases

Branch: `taa-46-pool-80`
Goal in one sentence: take both pools from 14 to 80 slots with compliant SKUs, and stop
the NewStore cases moving whenever the pool grows.
You own: `ts/src/variants.ts`, `ts/src/cases/newstoreCases.ts`, `ts/tests/variants.test.js` (new)

### Contract detail, copied in

Pick **66 entries per store** from `sku-lists/us-skus.json` and `sku-lists/ps-skus.json`
that are not already in the pool and that satisfy slice B's rule, checking them with
slice A's script. Fix a mismatch with `publishablePublish` only if slice B proved the
mismatch actually matters, and prefer swapping in a compliant entry from the JSON, which
is cheaper and touches nothing live. 191 US and 180 PS resolved entries exist, so there
is ample choice.

Add them to `US_VARIANTS` / `PS_VARIANTS`, then append the same SKUs **in matching
order** to `US_SKU_ORDER` / `PS_SKU_ORDER`.

Pin the NewStore cases in `newstoreCases.ts`, replacing the positional selection:

```ts
const sfsSku = pool[pool.length >= 2 ? pool.length - 2 : 0];   // remove
const otcSku = pool[pool.length - 1];                          // remove
```

with slots 14 and 15, and rewrite the stale doc comment above them (it still claims
pools of "5 US / 4 PS" and describes the modulo-wraparound collision that no longer
applies). Keep the substantive part of that comment: NS injection never touches Shopify
or `staging-inventory-v2`, so it has no shared mutable state to race with a baseline
case. That reasoning is still true and still worth having.

New test file `ts/tests/variants.test.js`, matching the existing CommonJS
`require("../dist/...")` style of the other tests:

- `sku(i)` resolves to a non-empty GID for every `i` in 0 to 79, on both stores
- `US_SKU_ORDER.length === Object.keys(US_VARIANTS).length`, same for PS
- every entry in `*_SKU_ORDER` exists as a key in the matching variants map
- `ns_sfs` and `ns_otc` resolve to `sku(14)` and `sku(15)`

### Sharp edges, all real

- **Declaration order is load-bearing.** `US_SKU_ORDER` / `PS_SKU_ORDER` exist precisely
  because `Object.keys()` silently reorders integer-like keys ascending numerically. See
  the doc comment at `variants.ts:50-58`: confirmed live, `sku(0)` resolved to the
  numerically smallest SKU instead of the first-declared one. Never derive the pool from
  `Object.keys()`, and append to both structures in the same order.
- **Do not touch slots 0 to 13.** Every existing case binds to them, and slot 13 carries
  both reject cases.
- The stale comments at `variants.ts:11-13` and `:30-33` describe pools of 14 as the
  target. Update them to 80 in the same commit, since they will otherwise mislead.
- `cli.ts`'s `--help` and `--list-cases` are user-facing documentation and must be
  updated in the same commit as any case or flag change. This slice changes no cases and
  no flags, so the requirement here is to **confirm `--list-cases` output is unchanged**,
  not to edit it. `printHelp()` has silently drifted before.
- Build precedes test: the offline suite is CommonJS requiring `../dist/`.

### Checklist

- [ ] 66 candidate entries per store selected from the JSON, checked against slice B's rule with slice A's script
- [ ] Any mismatch swapped for a compliant entry, or fixed via `publishablePublish` and the reason recorded
- [ ] Entries added to `US_VARIANTS` / `PS_VARIANTS`
- [ ] Same SKUs appended to `US_SKU_ORDER` / `PS_SKU_ORDER` in matching order
- [ ] `newstoreCases.ts` pinned to `sku(14)` / `sku(15)`, stale doc comment rewritten, race reasoning kept
- [ ] Stale pool-size comments in `variants.ts` updated to 80
- [ ] `ts/tests/variants.test.js` added, covering slots 0 to 79, order/map parity, and the NS pinning
- [ ] `sku(0)` through `sku(79)` confirmed resolving on both stores
- [ ] `--list-cases` output confirmed unchanged
- [ ] npm run build + npm test green
- [ ] Evidence written to `ts/signoffs/TAA-46-slice-c.md`

Deliberately not doing: no live orders, no automation of availability for arbitrary
lists (that is TAA-47), no new cases claiming the new slots, no change to any case that
uses slots 0 to 13.

---

## Slice D: live spot-check and write the rule down

Branch: `taa-46-docs-and-confirm`
Goal in one sentence: prove a new-slot SKU can carry a real order on both stores, and
record the slot map and availability rule where the next session will find them.
You own: `CLAUDE.md`, `staging-sku-setup.md`

### Contract detail, copied in

Place one live order per store on a new-slot SKU, using the existing `order` subcommand.
This is the acceptance criterion the whole ticket rests on: everything before it proves
configuration, and this proves purchasability.

Then write into `CLAUDE.md`, as a dated appended entry, never rewriting an earlier one:

- the full slot map, 0 to 79, owner per slot, as in this file
- the availability rule slice B settled, in the form TAA-47 needs
- any scope gap found, per app
- the NewStore pinning and why it was needed

Add a dated status annotation to `staging-sku-setup.md` in JJ's established pattern,
`*(Status update, 2026-08-28: ...)*`, recording that the pool is now 80 ordinary
staging-catalogue products per store, that the `QA TEST` recommendation for new
additions is deliberately not followed, and that this is JJ's accepted call. Fix in
place, preserve his voice, never delete historical context.

### Sharp edges, all real

- CLAUDE.md is the living source of truth and is append-only. There is currently **no
  `NEXT SESSION` block** in it, despite the ground-truth doc claiming one. Add the entry
  in the same style as the existing sign-off sections rather than inventing a new
  structure.
- Staging is shared: place your own orders and record their numbers.
- Do not transition the ticket. Propose it. Status transitions get applied only when
  every acceptance criterion has a live-run result, and only on JJ's explicit call.

### Checklist

- [ ] One live order placed on US on a new-slot SKU, order number recorded
- [ ] One live order placed on PS on a new-slot SKU, order number recorded
- [ ] Slot map 0 to 79 appended to CLAUDE.md
- [ ] Availability rule appended to CLAUDE.md, in the form TAA-47 can build from
- [ ] Scope gaps recorded per app, or explicitly noted as none
- [ ] `staging-sku-setup.md` annotated, dated, original text preserved
- [ ] npm run build + npm test green
- [ ] Evidence written to `ts/signoffs/TAA-46-slice-d.md`
- [ ] Ticket acceptance criteria proposed as met, transition left to JJ

Deliberately not doing: no `prepare-skus` script (TAA-47), no new cases on the new
slots, no regeneration of the ground-truth doc (that is `taa-wrap-up`).
