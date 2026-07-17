# QA Order Tool — shopify-order-creator

Interactive CLI + (in progress) regression package for placing test orders on Universal Store / Perfect Stranger **staging** and verifying omni-channel alignment across Shopify, AWS (DynamoDB), and NewStore.

**Owner:** JJ (james.johnston@universalstore.com.au). CLI originally by Jared Davis.
**Tracking:** Jira project TAA (current build ticket: TAA-3). Docs: Confluence QD space → "QA Automation Tool" page tree — see `regression-package-design.md` and `scope-of-work-reworked.md` in this folder.

## Current mission (TAA-3, Phase 0)

Build a headless `/regression` package: deterministic baseline proving order → allocation → shipments → inventory correctness across all three systems. "These always need to work and behave exactly the same way." Later: TypeScript rewrite uses this baseline as its parity spec. Read `regression-package-design.md` before writing regression code — it is the source of truth for architecture, case set, and assertions.

**Status (Jul 17):** `regression/` v0.1 built — runner, config, polling, readers, verify, reports, cases 1–6 (Shopify) implemented and logic-tested offline. **Not yet run against staging.** Before first run:

1. `python -m regression.schema_probe --order <recent-order-number>` — confirm key schemas of `staging-orders-v2` / `staging-shipments`, then update `TABLE_SCHEMAS` in `regression/readers/dynamo_reader.py` and remove the `UNCONFIRMED` flags (readers refuse to run until then). Also check the allocated-store value format ('100' vs 'BRANCH_100') — normalize in dynamo_reader, not in cases.
2. `python -m regression --cases single` — first live case; tune `PollWindows` in `regression/config.py` from the reported stage timings.
3. NS cases 7–8 not wired: confirm the NewStore order read-back endpoint (see `regression/readers/newstore_reader.py` TODO).

Also done: `draftOrderComplete` now returns `{order_id, order_name, created_at}` (graphql_scripts + orders_processor), and `ensure_stock`/`split_stock` accept `strict=True`.

## Stack & environment

- **Staging only.** Shopify Admin GraphQL 2025-10: `universal-store-staging.myshopify.com` (US), `perfect-stranger-staging.myshopify.com` (PS).
- **NewStore:** `universalstore-staging.p.newstore.net`, OAuth2 client-credentials via `id.p.newstore.net` (Keycloak). Order injection: `POST /v0/d/fulfill_order`.
- **AWS:** region `ap-southeast-2`, boto3 named profile `staging` (`aws sso login --profile staging` when expired).
- **Env vars (required at import):** `US_ACCESS_TOKEN`, `PS_ACCESS_TOKEN`, `NS_STAGING_CLIENT_ID`, `NS_STAGING_CLIENT_SECRET`. Optional: `AWS_REGION`, `AWS_PROFILE`, `NS_INVENTORY_STORE_KEY`.
- Run CLI: `python main.py`. Python 3, deps in `requirements.txt` (pip).

## DynamoDB tables (staging)

- `staging-inventory-v2` — PK `sku` (str), SK `store` (str, format `ATP#<storeNo>`), attrs `quantity`, `updatedAt`, `updatedReason`. Known locations: `ATP#100` (web DC), `ATP#99`, `ATP#407` (Chermside / BRANCH_407 / US), `ATP#640` (BRANCH_640 / PS).
- `staging-orders-v2` — order records + transactions (order-finalised, order-item-refunded).
- `staging-shipments` — one `ITEM#` row per unit; allocated to a store or `UNDELIVERABLE`; items carry a rejected-stores array that excludes stores from allocation.

## Allocation levers (determinism)

Allocator reads `ATP#<store>` rows per SKU; store with all SKUs = single shipment; SKUs spread across stores = split; zero stock everywhere (or all in-stock stores in rejected-stores) = undeliverable → Shopify refund → rows removed from both AWS tables + inventory decrement at allocated stores. Never rely on ambient staging stock — seed inventory explicitly per test case, with SKUs isolated per case (concurrent async pipelines interfere otherwise).

## File map

| File | Role |
| --- | --- |
| `main.py` | CLI menus, customer pools, presets, Shopify order flow (`place_an_order`) — interactive, bypass for regression work |
| `orders_processor.py` | Shopify GraphQL layer: draft→complete flow, customers, prices, `US_VARIANTS`/`PS_VARIANTS` SKU→GID maps |
| `graphql_scripts.py` | GraphQL query/mutation strings |
| `newstore_orders.py` | NS SFS/OTC payload builders + injection; `JD#########` external IDs via `order_counter.json` |
| `newstore_client.py` | Retrying OAuth2 HTTP client (`staging_client` singleton) |
| `aws_inventory.py` | `get_stock` / `set_stock` / `ensure_stock` (top-up to 99) / `split_stock` (qty 1 across 4 ATP locations) |
| `receipt_service.py` | PDF receipt via NS Template Service, attached as order note (all failures non-fatal by design) |

## Known gotchas (from full code review, Jul 2026)

1. **Order IDs are discarded** — `complete_draft_order` returns None; `draftOrderComplete` GraphQL doesn't select `draftOrder { order { id name } }`. First fix for regression work.
2. **Silent failures:** `ensure_stock`/`split_stock` swallow AWS errors and return `{}` (order proceeds anyway); `get_shopify_prices` silently skips unknown SKUs; NS price lookup falls back to $1.00. Regression code must treat all of these as hard failures (add `strict` mode; don't break CLI behaviour).
3. **Import-time side effects:** `orders_processor` and `newstore_client` build clients at import (KeyError without env vars). Mutable module globals hold store/brand state — Shopify `STORE` and NewStore `BRAND` are separate toggles that can drift.
4. **Shopify merges duplicate line items; DynamoDB/NewStore do not** — cross-system item-count assertions must account for this.
5. `order_counter.json` isn't concurrency-safe. Receipt hardcodes shipping 10.0 vs 9.99 charged, and "Universal Store" name even for PS.
6. Presets are built positionally from variant dicts — reordering the dicts silently changes preset contents.

## Conventions for new work

- Regression package lives in `regression/` per the design doc layout (runner / cases / flows / readers / verify / polling / report / config). Headless: no `input()`, no module-global state; explicit config object.
- Entry point target: `python -m regression [--cases ...] [--store US|PS] [--repeat N]`, non-zero exit on any failure.
- Every creation call returns identifiers; every assertion failure reports expected-vs-actual from each system.
- `--repeat N` diffs JSON results between identical runs — variance is a flagged inconsistency (race-condition signal).
- Don't modify CLI behaviour; extend modules additively (e.g. `strict=` kwargs, extra GraphQL selections).
- Update the changelog in Confluence "QA Order CLI — Tool Documentation" when CLI-facing behaviour changes; track build progress on TAA-3.

## TypeScript rewrite handoff (Jul 17, 2026)

A TypeScript rewrite scaffold for the QA regression harness is now present under `ts/` and is aligned to the Python baseline in `regression-package-design.md` and `scope-of-work-reworked.md`.

### What exists now

- `ts/package.json` and `ts/tsconfig.json` to build/run a minimal TS harness.
- `ts/src/config.ts` with baseline config + test case names.
- `ts/src/runner.ts` with a runnable case runner that produces a run summary.
- `ts/src/flows/orderFlow.ts` with a first-order flow stub that uses placeholder Shopify/Dynamo/NewStore client abstractions.
- `ts/src/clients/shopify.ts`, `ts/src/clients/dynamo.ts`, and `ts/src/clients/newstore.ts` as module boundaries for the rewrite.
- `ts/src/verification/assertions.ts` and `ts/src/report.ts` for evidence output and reporting.

### Verified status

The scaffold was verified locally with:

- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm install`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm run build`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm start`

Observed result: the TypeScript build succeeded and the harness executed successfully, generating:

- `ts/reports/regression-report.md`
- `ts/reports/regression-report.json`

### Next implementation focus

The next implementation slice should port the real regression baseline logic from the Python package into the TS structure:

1. Full baseline case definitions (single, multi, unique, split, undeliverable, partial-undeliverable).
2. Inventory seeding plus polling logic.
3. Readers and verification modules for Shopify, AWS/DynamoDB, and NewStore.
4. Repeat-run variance reporting and CLI flags matching the Python parity contract.

This scaffold is a runnable starting point for the TAA rewrite work and should be treated as the initial handoff artifact for follow-on co-working/admin work.
