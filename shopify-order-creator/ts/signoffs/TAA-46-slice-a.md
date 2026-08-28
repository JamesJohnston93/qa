# TAA-46 slice A sign-off (2026-08-28) — availability profile probe, both stores

Scope: read-only Admin GraphQL + DynamoDB probe only. No mutations, no
`publishablePublish`/`publishableUnpublish`, no orders. New file
`ts/scripts/dump-availability.js`, following `fetch-sku-gids.js`'s shape
exactly (standalone Node under `ts/scripts/`, `require`s `../dist/clients/shopify.js`
plus `../dist/clients/dynamo.js`, `../dist/config.js`, `../dist/variants.js`
— all additive reads of already-compiled dist modules, `ts/src/variants.ts`
untouched). `npm run build` + `npm test`: **320/320 green**, unchanged from
baseline — this slice touches no `src/` file, so the offline suite is
unaffected. `git status` confirms the only new file this session is
`ts/scripts/dump-availability.js` (plus the pre-existing untracked
`_to_delete/`, not mine).

Run live against both stores: `node dump-availability.js US` and
`node dump-availability.js PS`, both exit 0. Full JSON stdout for both runs
is reproduced in condensed form below (fields relevant to the reference
profile); the complete raw dumps are not preserved anywhere durable per the
plan's own instruction (`ts/reports/` is pruned, so nothing was written
there) — this file is the durable evidence.

## What the script pulls, per the ticket's field list

Per SKU (14 pool + 3 non-pool candidates per store), resolved variant GID ->
parent product in one batched `nodes(ids:)` query:

- `product.status`
- `resourcePublicationsV2` (publication id/name, `isPublished`, `publishDate`)
- `unpublishedPublications` (id/name)
- `publishedOnPublication(publicationId:)` targeted against whichever
  top-level publication's name matched `/online store/i` (observed spelling
  on both stores: exactly `"Online Store"` — not assumed, matched
  case-insensitively and the actual matched string recorded)
- a DynamoDB stock read (`getAllLocationsForSku`, real locations only —
  `AGGREGATE_LOCATIONS` from `config.ts` excluded, same convention
  `verify/inventory.ts` already uses for decrement assertions)

Once per store (not per product): top-level `publications(first: 25)` and
`catalogs(first: 25)` for the market side.

## Design deviation from the plan, stated loudly: Catalog/MarketCatalog needed two queries, not one

The plan says pull "Catalog / MarketCatalog for the market side." First
attempt was `Publication.catalog` inline-fragmented to `MarketCatalog` —
observed live to resolve **null for every one of US's 9 publications**, so
that's not where market membership lives. Switched to the top-level
`catalogs(first: 25)` query, which **does** work with no extra scope on
either store and returns real `MarketCatalog` entries (`Australia`,
`International`, `New Zealand` on both US and PS) alongside `AppCatalog`
entries for each channel.

`MarketCatalog.markets(first:)` itself, tried on top of that, is the scope
gap below — the script attempts it as a **second, separate query**
(`CATALOGS_WITH_MARKETS_QUERY`) specifically so that its failure doesn't
take down the base `catalogs` data or anything product-side. This is the one
place this script deliberately catches a GraphQL error instead of letting it
throw and abort the whole run — reasoned out at length in the script's own
comment: the sharp edge explicitly says a scope gap is "the finding, not
something to work around," and catching *this one, named, expected* query's
error and carrying its exact body into the output **is** the recording, not
a workaround. Every other field in the script (status, resourcePublicationsV2,
unpublishedPublications, publishedOnPublication, the base `catalogs` query,
the stock read) still throws hard and uncaught on any failure — no partial
profile is possible for those.

## Scope gap found — same on both stores, unlike TAA-22's `read_products` gap

```
Access denied for markets field.
{"message":"Access denied for markets field.","extensions":{"code":"ACCESS_DENIED","documentation":"https://shopify.dev/api/usage/access-scopes"},"path":["catalogs","nodes",1,"markets"]}
```

Hit identically on **both** US (static token) and PS (OAuth client-credentials
grant) — the two auth models agree here, unlike TAA-22's `read_products` gap
which was PS-only. Whatever scope gates `MarketCatalog.markets` (almost
certainly `read_markets`, not confirmed since no mutation/scope-list check
was attempted — read-only this slice) is missing on both apps. Every other
field pulled by this script succeeded on both stores with no scope issues,
including `resourcePublicationsV2`, `unpublishedPublications`,
`publishedOnPublication`, and the base (markets-free) `catalogs` query. This
is a real finding to hand to JJ, not worked around — no `publishablePublish`
was attempted as a substitute and none is needed for a read-only slice.

## Reference profile — US

Publications (9 total): `Online Store`, `Point of Sale`, `AWS Catalog App`,
`Storefront API`, `Storefront API Test`, `Shopify GraphiQL App`,
`In-Store stock checker`, `Test Hydrogen`, `UAT order creator`. Catalogs (12
total, markets sub-field unavailable per the gap above): 3 `MarketCatalog`
(`Australia`, `International`, `New Zealand`) + 9 `AppCatalog`, one per
publication, all `status: ACTIVE`.

Per-slot dump (`sku`: status / published-on-storefront / unpublished-count /
real stock / which publications it's actually published to):

| slot | sku | status | on storefront | unpub count | real stock | published to |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 32625134 | ACTIVE | false | 8 | 48 | AWS Catalog App, UAT order creator |
| 1 | 32357875 | ACTIVE | true | 5 | 91 | AWS Catalog App, Online Store, Point of Sale, Storefront API, UAT order creator |
| 2 | 33006246 | ACTIVE | true | 5 | 94 | AWS Catalog App, Online Store, Point of Sale, Storefront API, UAT order creator |
| 3 | 33660301 | ACTIVE | false | 8 | 97 | AWS Catalog App, UAT order creator |
| 4 | 33413679 | ACTIVE | true | 7 | 152 | AWS Catalog App, Online Store, UAT order creator |
| 5 | 33898889 | **DRAFT** | false | 14 | 95 | (none) |
| 6 | 33992457 | **DRAFT** | false | 14 | **0** | (none) |
| 7 | 33788579 | ACTIVE | false | 10 | 0 | AWS Catalog App, UAT order creator |
| 8 | 34023587 | **DRAFT** | false | 14 | 97 | (none) |
| 9 | 33946269 | **DRAFT** | false | 14 | 49 | (none) |
| 10 | 33837352 | ACTIVE | true | 6 | 98 | AWS Catalog App, Online Store, Point of Sale, UAT order creator |
| 11 | 33773452 | ACTIVE | true | 6 | 97 | AWS Catalog App, Online Store, Point of Sale, UAT order creator |
| 12 | 33819099 | ACTIVE | false | 8 | 98 | AWS Catalog App, UAT order creator |
| 13 | 33775371 | **DRAFT** | false | 14 | **0** | (none) — the reject-cases slot |

**The "common profile" of the known-good 14 does not converge to a single
shape.** `status`, publication membership, and `publishedOnStorefrontPublication`
all diverge within the pool: 5 of 14 slots are `DRAFT` and published
nowhere at all (`33898889`, `33992457`, `34023587`, `33946269`, `33775371`).
Of the remaining 9 `ACTIVE` slots, 5 are published to the storefront
(`32357875`, `33006246`, `33413679`, `33837352`, `33773452`) and 4 are
`ACTIVE` but published only to `AWS Catalog App`/`UAT order creator`, not to
the storefront (`32625134`, `33660301`, `33788579`, `33819099`). What every
one of the 14 does share regardless of status/publication: they are the SKUs
`baselineCases.ts`/`newstoreCases.ts` bind to, and every one of them has a
long history of successful live order placement recorded in `CLAUDE.md`
(slot 0 alone has been `single`'s SKU through dozens of confirmed live
runs; slot 13 carries both TAA-31 reject cases, live-confirmed repeatedly).
Two slots (`33992457`, `33775371`) currently hold **zero** real stock —
`33775371` matches the known TAA-31 attrition gotcha exactly (reject cycles
consume real stock and never restore it); `33992457`'s zero stock is not
explained by any known case and is noted here without further chase, per
this slice's read-only, non-investigative scope.

Candidates (non-pool, from `sku-lists/us-skus.json`):

| sku | status | on storefront | unpub count | real stock | published to |
| --- | --- | --- | --- | --- | --- |
| 33790497 | ACTIVE | true | 6 | **-34** | AWS Catalog App, Online Store, Point of Sale, UAT order creator |
| 33174570 | ACTIVE | true | 6 | 1446 | AWS Catalog App, Online Store, Point of Sale, UAT order creator |
| 33860138 | **DRAFT** | false | 14 | 5 | (none) |

`33790497`'s real-stock total is **negative** (-34) — at least one real ATP
location holds a negative quantity. Not investigated further (out of scope,
read-only, no fix), but real and worth a name: a "purchasable" verdict
against this SKU would be confounded by its stock position regardless of
publication, so it's a poor pick for slice B. `33860138` is the clean
non-compliant pick for slice B: `DRAFT`, published nowhere, and — critically
— **real stock of 5**, so any "order creation fails" result on it can't be
blamed on being out of stock.

## Reference profile — PS

Publications (4 total): `Online Store`, `Point of Sale`, `Storefront API`,
`Shopify GraphiQL App`. Catalogs (7 total, same markets gap as US): 3
`MarketCatalog` (`Australia`, `International`, `New Zealand`) + 4
`AppCatalog`, all `ACTIVE`.

| slot | sku | status | on storefront | unpub count | real stock | published to |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 33203669 | ACTIVE | false | 4 | 98 | (none) |
| 1 | 33801421 | ACTIVE | true | 1 | 96 | Online Store, Point of Sale, Storefront API |
| 2 | 34012956 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 3 | 33487854 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 4 | 34013038 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 5 | 33975283 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 6 | 33948010 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 7 | 34061343 | ACTIVE | true | 1 | **0** | Online Store, Point of Sale, Storefront API |
| 8 | 33997759 | ACTIVE | false | 4 | 98 | (none) |
| 9 | 33948256 | ACTIVE | true | 1 | **0** | Online Store, Point of Sale, Storefront API |
| 10 | 34013458 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 11 | 33790626 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 12 | 33933542 | ACTIVE | true | 1 | 98 | Online Store, Point of Sale, Storefront API |
| 13 | 33950419 | ACTIVE | **false** | 4 | **0** | (none) — the reject-cases slot |

**Unlike US, `status` converges: all 14 PS pool slots are `ACTIVE`.**
Publication does not converge — 3 of 14 (`33203669`, `33997759`, `33950419`)
are published nowhere, same shape as US's unpublished slots, just without
the `DRAFT` status. `33950419` (slot 13, PS's reject-cases SKU) shows the
identical signature to US's `33775371`: unpublished everywhere, zero real
stock — the TAA-31 attrition gotcha reproducing on both stores exactly as
documented. `34061343` and `33948256` are published and storefront-flagged
but currently zero stock, not explained further here.

Candidates (non-pool, from `sku-lists/ps-skus.json`):

| sku | status | on storefront | unpub count | real stock | published to |
| --- | --- | --- | --- | --- | --- |
| 33872704 | ACTIVE | false | 4 | **-47** | (none) |
| 34016503 | ACTIVE | true | 1 | 27 | Online Store, Point of Sale, Storefront API |
| 33822105 | ACTIVE | true | 1 | 129 | Online Store, Point of Sale, Storefront API |

Same negative-real-stock pattern as US's `33790497` — `33872704` is -47.
Only one of PS's three candidates (`33872704`) is non-compliant, and its
stock position confounds it the same way US's `33790497` does. Not a
blocker: the plan already prefers US for slice B ("US for preference since
it uses the simpler static token"), and US's `33860138` is a clean pick.

## Read for slice B, do not conclude here

This slice asserts nothing and draws no conclusion about whether publication
gates Admin-API order creation — that is explicitly slice B's job. What this
dump does put on the record: **the "known-good" 14 are not uniform.** On US,
5 of 14 are `DRAFT` and published to nothing; on PS, 3 of 14 (including both
stores' shared reject-cases slot) are `ACTIVE` but published to nothing. All
17 of these slots have an extensive, specifically-cited history of
successful live order placement in `CLAUDE.md`. Whatever the real
purchasability rule is, it evidently isn't "status must be ACTIVE and the
product must be published to Online Store" as a blanket requirement, or
these slots would already be failing every regression run — but that
reasoning is exactly the hypothesis slice B is designed to test with a real
order, not something this slice is allowed to assert.

## Checklist

- [x] `ts/scripts/dump-availability.js` created, read-only, following `fetch-sku-gids.js`'s shape
- [x] Profile dumped for slots 0 to 13 on US
- [x] Profile dumped for slots 0 to 13 on PS
- [x] Three non-pool candidate SKUs dumped per store
- [x] The common profile of the known-good 14 stated explicitly as the reference, per store (stated as non-convergent, with the exact divergence, for both stores)
- [x] Any scope gap recorded per store, with the exact error (`MarketCatalog.markets`, `ACCESS_DENIED`, identical on both stores)
- [x] `npm run build` + `npm test` green (320/320, unchanged from baseline)
- [x] Evidence and the reference profile written to `ts/signoffs/TAA-46-slice-a.md`

Deliberately not done, per the plan: no mutations, no pool changes, no
assertions added to the suite, no fix for anything the dump revealed
(the two zero-stock non-reject slots, the two negative-stock candidates,
and the `read_markets`-shaped scope gap are all left exactly as found).

## Handback

Branch `taa-46-availability-probe`, cut from `taa-46-plan` (`4f31a3f`).
One commit to make: `ts/scripts/dump-availability.js` (new) +
`ts/signoffs/TAA-46-slice-a.md` (new). Ahead of `taa-46-plan` by however
many commits result from committing this work — currently working tree has
these two new files uncommitted. Not pushed, not merged, no other branch
touched. Push command once committed:

```
git push -u origin taa-46-availability-probe
```
