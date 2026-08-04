# Staging SKU Setup — for TAA-14 Phase B (parallel cases)

Prerequisite for the parallel scheduler: each store needs enough **dedicated QA test SKUs** that every case can be assigned a fully disjoint set, so cases can run concurrently without touching each other's stock. This is a Shopify-staging-admin task (JJ) — the IDE can't create products.

## Why dedicated test products (read first)

The harness's `zeroEverywhere` lever sets a SKU's stock to 0 at **every** location it exists (~194 rows in staging — the whole branch network) to force undeliverable outcomes. It is destructive and not reversible (no prior-value capture). **Only ever point cases at throwaway QA SKUs.** Never add a real merchandisable product's SKU to the pool — a run would zero its stock network-wide.

So: create **new, clearly-labelled QA test products** (e.g. title `QA TEST — do not sell — US 01`), not variants of real catalogue items.

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

Target **≥12 per store** — the 10 above plus ~2 headroom for the fulfilment/rejection cases coming in TAA-21. You currently have 5 US / 4 PS, so add roughly **7 US and 8 PS**. Do both stores (US = Universal Store staging, PS = Perfect Stranger staging).

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
   - Or query the Admin GraphQL API (the harness already has a client/token). A `productVariants(first: 50, query: "sku:QA*")` query returns `{ id, sku, price }` for all of them at once — fastest for a batch.
3. **Record SKU → GID** for every new variant, per store.
4. **Hand the list to the IDE / add to `variants.ts`:** extend `US_VARIANTS` / `PS_VARIANTS` with the new SKU→GID pairs, and append the new SKUs to `US_SKU_ORDER` / `PS_SKU_ORDER` in the same order (the ordering arrays are load-bearing — see the comment in `variants.ts`; JS reorders integer-string keys, so the explicit arrays are what cases index into).
5. **Sanity check before parallel work:** `node dist/index.js --store US --list` (and PS) should show the cases; a single sequential `--cases single` on a new SKU confirms the variant resolves, prices, seeds, and allocates.

## Then

With ≥12 disjoint SKUs per store, the IDE can build the Phase B parallel scheduler: derive waves from each case's declared SKUs, run disjoint cases concurrently, keep repeats serial, allow US+PS concurrently. Target: full `--repeat 3` in ≤7 min (from ~20), identical stable signatures vs sequential.

## Note (from TAA-14 guardrail)

For future customer-data verification (address-change propagation), the same disjoint-resource thinking applies to **customers** — a pool of distinct, reusable QA customers so concurrent cases don't collide on a shared customer identity. Out of scope for TAA-14 itself, but grow the customer pool alongside the SKU pool with that in mind.
