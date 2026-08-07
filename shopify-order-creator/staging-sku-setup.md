# Staging SKU Setup — the standing how-to for growing the SKU pool

*(Originally written as the prerequisite for TAA-14 Phase B, parallel cases — that's done on both stores. Kept as the how-to for adding SKUs to the pool, still relevant for TAA-21's fulfilment/rejection cases.)*

Each store needs enough **dedicated QA test SKUs** that every case can be assigned a fully disjoint set, so cases can run concurrently without touching each other's stock. This is a Shopify-staging-admin task (JJ) — the IDE can't create products.

## Why dedicated test products (read first)

The harness's `zeroEverywhere` lever sets a SKU's stock to 0 at **every** location it exists (~194 rows in staging — the whole branch network) to force undeliverable outcomes. It is destructive and not reversible (no prior-value capture). **Only ever point cases at throwaway QA SKUs.** Never add a real merchandisable product's SKU to the pool — a run would zero its stock network-wide.

So: create **new, clearly-labelled QA test products** (e.g. title `QA TEST — do not sell — US 01`), not variants of real catalogue items.

*(Status update, 2026-08-06 — read this alongside the above, don't assume it was followed: the pool actually in use is **ordinary staging-catalogue products** with real product titles, not dedicated `QA TEST — do not sell` items. JJ selected and pasted that list himself and it's an accepted decision, not an oversight. The `zeroEverywhere` warning above stands in full — it is still destructive, still hits ~194 rows per SKU, and still has no prior-value capture; the risk is simply accepted for these staging products. Anything **new** added to the pool should follow the recommendation above.)*

## How many

Full-parallel one wave of the 6 baseline cases needs disjoint SKUs totalling **10**:

| Case | SKUs needed |
| --- | --- |
| single | 1 |
| multi | 1 |
| unique | 3 |
| split | 2 |
| undeliverable | 1 |
| partial_undeliverable | 2 |

Target **≥12 per store** — the 10 above plus ~2 headroom for the fulfilment/rejection cases coming in TAA-21. ~~You currently have 5 US / 4 PS, so add roughly **7 US and 8 PS**.~~ *(Status update, 2026-08-06: done — `variants.ts` now holds **14 SKUs per store** (US grew 5→14 in TAA-14 Phase B, PS 4→14 in TAA-22 step 2), wired to the 10 disjoint slots with 4 spare. Behind that, the resolved lists `sku-lists/{us,ps}-skus.json` hold **191 US / 180 PS** SKUs — plenty of headroom to draw from for TAA-21, so growing the pool now usually means promoting SKUs from those lists into `variants.ts`, not creating products.)* Do both stores (US = Universal Store staging, PS = Perfect Stranger staging).

## Requirements per test SKU

1. **Real product + variant** in the staging store, published/active enough that the Admin API returns it.
2. **A price set** (any value) — the harness reads the live Shopify price; a missing price breaks the create/verify path.
3. **A unique SKU code** — keep them recognisable, e.g. a `QA` prefix or a reserved numeric block, so they're easy to spot and never confused with real stock.
4. **Inventory tracked** so the allocation pipeline produces `ATP#` rows for the SKU (the harness seeds these, but the SKU must be one the pipeline recognises).
5. Dedicated to QA — nothing real should depend on their stock.

(NewStore catalog presence is **not** required for the baseline Shopify+AWS cases. Only add these to the NS catalog if you later want the same SKUs usable for NS injection cases 7–8 under TAA-17.)

## Steps

1. **Create the products** in each staging Shopify admin (US and PS). One variant each is fine. Label them unmistakably as QA test items. Set a price and enable inventory tracking.
2. **Pull each variant's GID.** Two options:
   - Admin UI: open the variant; the numeric id is in the URL — the GID is `gid://shopify/ProductVariant/<that number>`.
   - Or query the Admin GraphQL API (the harness already has a client/token). A `productVariants(first: 50, query: "sku:QA*")` query returns `{ id, sku, price }` for all of them at once — fastest for a batch. *(Status update, 2026-08-06: this is now scripted — paste the SKUs one-per-line into `sku-lists/{store}-skus.txt` and run `node scripts/fetch-sku-gids.js <US|PS>` from `ts/`, which resolves them to `sku-lists/{store}-skus.json` (`sku`, `gid`, `title`, `price`), batched 50/request. Read-only, safe to re-run.)*
3. **Record SKU → GID** for every new variant, per store.
4. **Hand the list to the IDE / add to `variants.ts`:** extend `US_VARIANTS` / `PS_VARIANTS` with the new SKU→GID pairs, and append the new SKUs to `US_SKU_ORDER` / `PS_SKU_ORDER` in the same order (the ordering arrays are load-bearing — see the comment in `variants.ts`; JS reorders integer-string keys, so the explicit arrays are what cases index into).
5. **Sanity check before parallel work:** `node dist/index.js --store US --list-cases` (and PS) should show the cases; a single sequential `--cases single` on a new SKU confirms the variant resolves, prices, seeds, and allocates.

## Then

With ≥12 disjoint SKUs per store, the IDE can build the Phase B parallel scheduler: derive waves from each case's declared SKUs, run disjoint cases concurrently, keep repeats serial, allow US+PS concurrently. Target: full `--repeat 3` in ≤7 min (from ~20), identical stable signatures vs sequential.

*(Status update, 2026-08-06: built and the target beaten — `scheduler.ts`'s `buildWaves()`/`runBounded()` behind `--parallel` (default `--concurrency 4`). `--store US --parallel --repeat 3` came in at **4:04.10 (244.10s)** against the ~20 min (1200s) pre-TAA-14 baseline — ~4.9x, well inside the ≤7 min target — with sequential vs `--parallel` stable signatures byte-identical and no Shopify 429s at concurrency 4. PS passes single-pass both sequentially (4:13.41) and `--parallel` (1:35.94) with byte-identical signatures; a clean PS `--repeat 3` is the one item still outstanding. Running US and PS concurrently is still to do.)*

## Note (from TAA-14 guardrail)

For future customer-data verification (address-change propagation), the same disjoint-resource thinking applies to **customers** — a pool of distinct, reusable QA customers so concurrent cases don't collide on a shared customer identity. Out of scope for TAA-14 itself, but grow the customer pool alongside the SKU pool with that in mind.

*(Still open as at 2026-08-06 — the customer pool has not grown: it's one shared identity per store (`BASELINE_CUSTOMERS`, US `JJQA AutoUS` / PS `JJQA AutoPS`), and no interference was observed across concurrent orders at concurrency 4, which is not proof of safety at higher concurrency. Related open item worth folding into the same piece of work: the NewStore mock customer's `ns_id` (customer profile UUID) still points at Jared Davis's real NewStore profile and needs a real profile for the `JJQA AutoNS` identity before live use.)*
