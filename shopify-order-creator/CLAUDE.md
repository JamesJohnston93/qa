# QA Order Tool — shopify-order-creator

Interactive CLI + (in progress) regression package for placing test orders on Universal Store / Perfect Stranger **staging** and verifying omni-channel alignment across Shopify, AWS (DynamoDB), and NewStore.

**Owner:** JJ (james.johnston@universalstore.com.au). CLI originally by Jared Davis.
**Tracking:** Jira project TAA (current build ticket: TAA-3). Docs: Confluence QD space → "QA Automation Tool" page tree — see `regression-package-design.md` and `scope-of-work-reworked.md` in this folder.

## Current mission (TAA-3, Phase 0)

Build a headless `/regression` package: deterministic baseline proving order → allocation → shipments → inventory correctness across all three systems. "These always need to work and behave exactly the same way." Later: TypeScript rewrite uses this baseline as its parity spec. Read `regression-package-design.md` before writing regression code — it is the source of truth for architecture, case set, and assertions.

**Direction change (Jul 17):** TypeScript rewrite happens FIRST (TAA-13), then the baseline runs in TS (TAA-3), then next phase. The Python `regression/` v0.1 package is the **executable reference spec** — port it, don't run it first. See `ts-rewrite-dev-doc.md` for the full porting guide.

**TS state (`ts/`, commits 9279f00 / 435fe42 / in progress):** runnable scaffold, now gaining real logic per TAA-13. Done: CLI (`src/cli.ts` + `run-regression.sh`), cases 1–6 declared per-store from real variant pools (`src/cases/baselineCases.ts`, `src/variants.ts`), real Shopify client (`src/clients/shopify.ts` — real `draftOrderCalculate` shipping-rate fetch, no fallback/synthetic IDs, throws on any `userErrors`), reports, `src/polling.ts` (`pollUntil`/`StageTimeout`), real `clients/dynamo.ts` (inventory ops), **real readers** (`readers/shopifyReader.ts`, `readers/dynamoReader.ts`) and **`verify/{orders,refunds,shipments,inventory}.ts`** (ports of `regression/verify/*.py`, replacing the old placeholder `verification/` module).

**Schema confirmed (2026-07-17)** by placing a live US order (#9699) and probing `staging-orders-v2`/`staging-shipments` directly — the real shape differs from the original guess in three ways, now documented at the top of `readers/dynamoReader.ts`: (1) the table PK is an opaque internal order UUID, not the Shopify order id/name; (2) `staging-orders-v2` has an `origin_index` GSI keyed on `origin = "{STORE}#SHOPIFY_ECOM#{shopifyOrderIdTail}"` — the real correlation key (`staging-shipments` has no such GSI; its PK is the *same* UUID as the matching `staging-orders-v2` row, so the PK is resolved via the orders table first); (3) both tables are one-row-per-unit, and allocation lives on a sibling `SHIPMENT#<id>` row's `allocatedStore` attribute (plain store number, e.g. `"100"`), not on the `ITEM#` row itself.

`src/runner.ts` now wires the full stage chain matching `regression/runner.py`: seed_inventory → create_order → shopify_readback → orders_table → allocation → (refund → cleanup) or no_refund → inventory, every stage polled via `pollVerify` (pollUntil + a verify function that retries until it stops throwing `VerificationError`, then surfaces the detailed error on timeout instead of a bare timeout). `src/report.ts` now ports `report.py`'s `stable_signature`/`diff_repeats` (`--repeat N` actually loops N times in `cli.ts` now and diffs the identical runs; variance in pass/fail or failing-check across repeats = flagged, order ids/timings excluded as volatile) and CLI exit codes match the Python contract (0 = pass, 1 = failure/variance). Offline test suite (`npm test` / `node --test tests/*.test.js`) now covers 34 cases: polling (resolve/timeout/error-propagation), allocation summarization + unit-count/allocation/cleanup assertions, refund assertions (incl. summing across multiple refunds), Shopify order assertions incl. duplicate-line-item merging, orders-table alignment, repeat-variance diffing, and aggregate-location exclusion in decrement checks. **Stubs — not real yet:** `clients/newstore.ts` (hardcoded IDs — NS cases 7–8 still unwired). The `ts/reports/` sample came from a dry run, NOT staging.

**First live run (2026-07-17, `--store US --cases single`) — FAIL, 2 real findings, both fixed:**

1. **`zeroEverywhere` blast radius.** Querying "every location that exists for a SKU" (by design — see dynamo.ts/dynamo_reader.py docstrings, needed so stale stock elsewhere can't silently block an UNDELIVERABLE case) hit **194 real rows** per SKU in staging (the whole `ATP#`/`ABS#` branch network, not just the 4 documented web/DC locations) and zeroed 193 of them. Confirmed acceptable with JJ: zeroing one SKU's stock entirely is *the* mechanism for forcing undeliverable outcomes and is scoped to one SKU from a small pool per case — not changed. Kept in mind for the future: this is genuinely destructive and not easily reversible (no prior-value capture before overwrite), so treat any change that broadens `zeroEverywhere`'s scope (e.g. more SKUs per case) as a real risk, not just a test concern.
2. **False decrement failures from aggregate/pool locations.** `ATP#INTERNATIONAL` picked up the seeded `ATP#100` quantity ~30–60s after seeding — a downstream mirror/aggregate, not real independent stock, and not something any seed/order action touched. Fixed: `AGGREGATE_LOCATIONS` (`config.ts`: `ATP#INTERNATIONAL`, `ATP#STUDIO`, `ATP#ALL`) is now excluded from `assertDecrements` (`verify/inventory.ts`).

**Also fixed while investigating:** `cases/baselineCases.ts` built its SKU pool via `Object.keys(variantsFor(store))` — since every SKU is a canonical-integer string (e.g. `"32625134"`), JS enumerates those keys in ascending numeric order regardless of declaration order (unlike Python dicts, which preserve insertion order), so `sku(0)` silently resolved to the numerically-smallest SKU instead of the first-declared one. Fixed with explicit `US_SKU_ORDER`/`PS_SKU_ORDER` arrays in `variants.ts` (`skuPoolFor()`), matching the Python reference's case-to-SKU assignment.

**Next priorities (in order — everything else is blocked on 1–2):**

1. ~~Port `regression/polling.py` → TS~~ — done (`src/polling.ts`).
2. ~~Real `clients/dynamo.ts` (inventory ops)~~ — done.
3. ~~Real readers + schema confirmation~~ — done (`readers/shopifyReader.ts`, `readers/dynamoReader.ts`, `verify/*.ts`).
4. ~~Wire the full stage chain in `runner.ts`~~ — done.
5. ~~`--repeat` variance diff~~ — done (`report.ts`, `cli.ts`).
6. ~~Extend offline tests~~ — done (34 tests, `npm test`).
7. Re-run `--cases single` live to confirm the two fixes above land it green, then the full 6-case set, then `--repeat 3`. Tune `PollWindows` from recorded stage timings.
8. NS cases 7–8: confirm NewStore read-back endpoint first (see `regression/readers/newstore_reader.py` TODO).

Track progress on [TAA-13](https://universalstore.atlassian.net/browse/TAA-13) — its checklist mirrors this list; tick items as they land.

Python-side changes already made: `draftOrderComplete` returns `{order_id, order_name, created_at}` (graphql_scripts + orders_processor); `ensure_stock`/`split_stock` accept `strict=True`.

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
- `ts/src/config.ts` with baseline config + case selection and report-dir support.
- `ts/src/cli.ts` with CLI parsing for `--store`, `--cases`, `--repeat`, `--report-dir`, `--quiet`, `--list-cases`, and `--help`.
- `ts/src/runner.ts` with a runnable case runner that emits a structured stage list including inventory preparation, order creation, Shopify verification, allocation verification, and inventory decrement checks.
- `ts/src/flows/orderFlow.ts` and `ts/src/flows/inventoryFlow.ts` implementing the first-order flow for inventory prep before order placement.
- `ts/src/clients/shopify.ts`, `ts/src/clients/dynamo.ts`, and `ts/src/clients/newstore.ts` as module boundaries for the rewrite.
- `ts/src/verification/verification.ts` and `ts/src/report.ts` for evidence output and reporting.
- `ts/tests/verification.test.js` with offline tests for the new inventory decrement assertion.
- `run-regression.sh` at the repo root as a wrapper that builds/runs the TS harness from the repository root.

### Verified status

The scaffold was verified locally with:

- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm install`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm run build`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && node --test tests/verification.test.js`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator && ./run-regression.sh --store US --cases single,multi --repeat 1 --report-dir ./reports`

Observed result: the TypeScript build succeeded, the offline verification tests passed, and the harness executed successfully, generating:

- `ts/reports/regression-report.md`
- `ts/reports/regression-report.json`

### Next implementation focus

The next implementation slice should continue porting the real regression baseline logic from the Python package into the TS structure:

1. Full baseline case definitions (single, multi, unique, split, undeliverable, partial-undeliverable) now available in `ts/src/cases/baselineCases.ts`.
2. Inventory seeding plus deeper polling logic and live read-back readers.
3. Readers and verification modules for Shopify, AWS/DynamoDB, and NewStore should be tightened further against the live staging schemas.
4. Repeat-run variance reporting and CLI flags matching the Python parity contract should be iterated after schema confirmation.

This scaffold is a runnable starting point for the TAA rewrite work and should be treated as the initial handoff artifact for follow-on co-working/admin work.
