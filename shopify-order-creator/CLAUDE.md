# QA Order Tool — shopify-order-creator

Interactive CLI (Python) + TypeScript regression baseline for placing test orders on Universal Store / Perfect Stranger **staging** and verifying omni-channel alignment across Shopify, AWS (DynamoDB), and NewStore.

**Owner:** JJ (james.johnston@universalstore.com.au). CLI originally by Jared Davis.
**Tracking:** Jira project TAA (current build ticket: TAA-3). Docs: Confluence QD space → "QA Automation Tool" page tree — see `regression-package-design.md` and `scope-of-work-reworked.md` in this folder.

## ⚠ CURRENT MISSION: FINISH THE TS REWRITE (Python not yet fully retired)

The regression **baseline** (Shopify order → allocation → shipments → inventory, cases 1–6) is done in TS and signed off (TAA-13, green US+PS at `--repeat 3`). **But the rewrite is NOT complete** — several pieces still exist only in Python and are genuinely in use. The goal now is to port the rest so **all Python under `shopify-order-creator/` can be deleted**. Do not delete any Python until its TS replacement exists and is verified.

### What is still Python-only (must be ported before Python can go)

1. ~~**NewStore client — `newstore_client.py`** → `ts/src/clients/newstore.ts`~~ — **done 2026-07-22 (TAA-17 step 1).** Real OAuth2 client-credentials flow (Keycloak, `id.p.newstore.net`), token cache with pre-expiry refresh (30s buffer), retry on network/5xx (2s/4s backoff, 3 tries), raises immediately on 4xx with the response body. 5 offline tests (`tests/newstore.test.js`: token caching, token refresh near expiry, 5xx-then-success, 4xx no-retry, retries-exhausted). Confirmed live: a real token fetch against staging Keycloak returned a valid JWT. `newstore_client.py` can now be `git rm`'d once injection (`newstore_orders.py`) ports too — kept for now since the port isn't finished.
2. **NewStore order injection — `newstore_orders.py`** → new `ts/src/flows/newstoreOrders.ts`. SFS + OTC payload builders (GST = price/11, SFS 9.99 shipping, OTC preconfirmed), `POST /v0/d/fulfill_order`. **Do NOT port `order_counter.json`** — use a collision-free external-ID scheme (timestamp + random suffix). The counter file has a confirmed bug: a reused id silently returns an existing unrelated order instead of erroring.
3. **NewStore read-back + cases 7–8** → `ts/src/readers/newstoreReader.ts` + verify + wire the two NS cases. Endpoint is confirmed: `GET /v0/d/external_orders/{external_id}` (~2s propagation; response has `order_uuid`, `order_id`, `ordered_products[]` with `product_sku`/`quantity`). Poll with a short window, NS propagates far faster than the Shopify/Dynamo stages.
4. **Receipt generation — `receipt_service.py`** → decide first: port to TS, or drop it. It only matters for NS-injected orders (workaround for no native receipt). If NS injection ports, decide whether receipts come with it. Log the decision here.
5. **Interactive CLI — `main.py`** (+ its Python-only deps `orders_processor.py`, `aws_inventory.py`, `graphql_scripts.py`, which the TS harness already replaced with its own clients) → this is the operator order-placement experience. Overlaps with **TAA-15** (operator UX rework, CLI-vs-GUI). Either fold main.py's replacement into TAA-15 or port a minimal TS command surface first. Decide and note here.

### Retire order (suggested)

NS client → NS injection (collision-free IDs) → NS read-back + cases 7–8 → receipt decision → CLI/operator surface (TAA-15). Each step: build + verify in TS, then `git rm` the corresponding Python. The `regression/` package (14 files) is already dead and can be `git rm`'d at any time — it's pure historical reference, preserved in git history.

### Definition of "rewrite complete"

No `.py` files remain under `shopify-order-creator/` (or only an intentionally-kept archive), the TS harness covers Shopify + AWS + NewStore end to end, and NS cases 7–8 pass live. Only then does the "remove all Python" cleanup happen.

---

## Regression baseline (done — TAA-13)

Headless regression baseline proving order → allocation → shipments → inventory correctness across all three systems (Shopify, AWS/DynamoDB, NewStore). "These always need to work and behave exactly the same way." The baseline now **lives and runs in TypeScript** (`ts/`) — green on both US and PS at `--repeat 3` (2026-07-22). Read `regression-package-design.md` for the architecture/case-set/assertions this was built against, and `ts-rewrite-dev-doc.md` for the porting history.

**Python `regression/` v0.1 package is retired** — historical reference only, do not run or extend it further. It served as the executable spec the TS harness was ported from and verified against; that porting is done and signed off. `main.py` and the rest of the interactive Python CLI are unaffected (separate scope — the operator-CLI refresh is a later phase, not part of this baseline).

**TS state (`ts/`, commits 9279f00 / 435fe42 / in progress):** runnable scaffold, now gaining real logic per TAA-13. Done: CLI (`src/cli.ts` + `run-regression.sh`), cases 1–6 declared per-store from real variant pools (`src/cases/baselineCases.ts`, `src/variants.ts`), real Shopify client (`src/clients/shopify.ts` — real `draftOrderCalculate` shipping-rate fetch, no fallback/synthetic IDs, throws on any `userErrors`), reports, `src/polling.ts` (`pollUntil`/`StageTimeout`), real `clients/dynamo.ts` (inventory ops), **real readers** (`readers/shopifyReader.ts`, `readers/dynamoReader.ts`) and **`verify/{orders,refunds,shipments,inventory}.ts`** (ports of `regression/verify/*.py`, replacing the old placeholder `verification/` module).

**Schema confirmed (2026-07-17)** by placing a live US order (#9699) and probing `staging-orders-v2`/`staging-shipments` directly — the real shape differs from the original guess in three ways, now documented at the top of `readers/dynamoReader.ts`: (1) the table PK is an opaque internal order UUID, not the Shopify order id/name; (2) `staging-orders-v2` has an `origin_index` GSI keyed on `origin = "{STORE}#SHOPIFY_ECOM#{shopifyOrderIdTail}"` — the real correlation key (`staging-shipments` has no such GSI; its PK is the *same* UUID as the matching `staging-orders-v2` row, so the PK is resolved via the orders table first); (3) both tables are one-row-per-unit, and allocation lives on a sibling `SHIPMENT#<id>` row's `allocatedStore` attribute (plain store number, e.g. `"100"`), not on the `ITEM#` row itself.

`src/runner.ts` now wires the full stage chain matching `regression/runner.py`: seed_inventory → create_order → shopify_readback → orders_table → allocation → (refund → cleanup) or no_refund → inventory, every stage polled via `pollVerify` (pollUntil + a verify function that retries until it stops throwing `VerificationError`, then surfaces the detailed error on timeout instead of a bare timeout). `src/report.ts` now ports `report.py`'s `stable_signature`/`diff_repeats` (`--repeat N` actually loops N times in `cli.ts` now and diffs the identical runs; variance in pass/fail or failing-check across repeats = flagged, order ids/timings excluded as volatile) and CLI exit codes match the Python contract (0 = pass, 1 = failure/variance). Offline test suite (`npm test` / `node --test tests/*.test.js`) now covers 34 cases: polling (resolve/timeout/error-propagation), allocation summarization + unit-count/allocation/cleanup assertions, refund assertions (incl. summing across multiple refunds), Shopify order assertions incl. duplicate-line-item merging, orders-table alignment, repeat-variance diffing, and aggregate-location exclusion in decrement checks. **Stubs — not real yet:** `clients/newstore.ts` (hardcoded IDs — NS cases 7–8 still unwired). `ts/reports/` now contains REAL staging runs (`regression_US_20260717T*.md`) alongside the older dry-run sample (`regression-report.md`) — check timestamps.

**First live run (2026-07-17, `--store US --cases single`) — FAIL, 2 real findings, both fixed:**

1. **`zeroEverywhere` blast radius.** Querying "every location that exists for a SKU" (by design — see dynamo.ts/dynamo_reader.py docstrings, needed so stale stock elsewhere can't silently block an UNDELIVERABLE case) hit **194 real rows** per SKU in staging (the whole `ATP#`/`ABS#` branch network, not just the 4 documented web/DC locations) and zeroed 193 of them. Confirmed acceptable with JJ: zeroing one SKU's stock entirely is *the* mechanism for forcing undeliverable outcomes and is scoped to one SKU from a small pool per case — not changed. Kept in mind for the future: this is genuinely destructive and not easily reversible (no prior-value capture before overwrite), so treat any change that broadens `zeroEverywhere`'s scope (e.g. more SKUs per case) as a real risk, not just a test concern.
2. **False decrement failures from aggregate/pool locations.** `ATP#INTERNATIONAL` picked up the seeded `ATP#100` quantity ~30–60s after seeding — a downstream mirror/aggregate, not real independent stock, and not something any seed/order action touched. Fixed: `AGGREGATE_LOCATIONS` (`config.ts`: `ATP#INTERNATIONAL`, `ATP#STUDIO`, `ATP#ALL`) is now excluded from `assertDecrements` (`verify/inventory.ts`).

**Also fixed while investigating:** `cases/baselineCases.ts` built its SKU pool via `Object.keys(variantsFor(store))` — since every SKU is a canonical-integer string (e.g. `"32625134"`), JS enumerates those keys in ascending numeric order regardless of declaration order (unlike Python dicts, which preserve insertion order), so `sku(0)` silently resolved to the numerically-smallest SKU instead of the first-declared one. Fixed with explicit `US_SKU_ORDER`/`PS_SKU_ORDER` arrays in `variants.ts` (`skuPoolFor()`), matching the Python reference's case-to-SKU assignment.

**Re-run `--cases single`: PASS.** Full 6-case set: **4/6 passed** (single, multi, unique, split); `undeliverable`/`partial_undeliverable` both timed out on the `cleanup` stage (300s). Root cause: **staging-shipments never deletes the refunded SKU's `ITEM#` row** — confirmed live (orders #9706/#9707) that its `status` instead flips `UNDELIVERABLE` → `REMOVED` roughly 40–60s after the Shopify refund lands, plus a `SHIPMENT_ITEM_REMOVED` transaction row is appended. `assertItemsRemoved` (`verify/shipments.ts`) was checking for row *absence*, which never happens — fixed to check `status === REMOVED` (new constant in `readers/dynamoReader.ts`) instead.

**`REMOVED`-status fix confirmed (2026-07-17, TAA-13 step 1 re-run):** `--store US --cases undeliverable,partial_undeliverable`. `undeliverable` (#9734) **PASS** end to end — real timings: seed_inventory=4.7s, create_order=10.0s, shopify_readback=0.3s, orders_table=25.7s, allocation=30.3s, refund=16.6s, **cleanup=50.6s**, inventory=0.1s. Confirms the `status === REMOVED` check works live and gives a real cleanup timing to tune `PollWindows.cleanup` from (currently 300s default — see poll-window tuning task).

**Isolated finding — one `partial_undeliverable` run never got a refund (2026-07-17, order #9735):** timed out on `refund` at 300s. Direct read (Shopify GraphQL + `staging-orders-v2` + `staging-shipments`, minutes after the timeout, well past any polling window) confirms this is not a slow-but-eventual refund: order #9735 is `PAID` with zero Shopify refunds; the `staging-shipments`/`staging-orders-v2` `ITEM#` row for SKU `32357875` is `UNDELIVERABLE`; and — the key signal — `staging-orders-v2` has only a single `TRANSACTION#...` row for this order (`event: "CREATE_ORDER"`), no refund-related transaction was ever appended. The refund automation never started for this order, it isn't just running long. **Not a systemic gap**: the same case passed with a refund landing in 16–17s in 5 of the 6 other historical `partial_undeliverable` runs (#9709, #9715, #9721, #9727, #9733 all PASS; only the pre-REMOVED-fix #9707 and this #9735 failed, for two different reasons). Treated as an isolated staging-side automation miss on this one order — logged here per JJ's instruction to document surprises rather than work around them silently. If it recurs on a future run, escalate as a real backend defect rather than a harness flake.

**RECURRED (2026-07-22, order #9771).** A US full-set `--repeat 3` re-run (validating the newly-tuned PollWindows) failed the same way: `partial_undeliverable` timed out on `refund` at the new 90s window. Direct Shopify GraphQL check well after the timeout confirms it's genuinely missing, not just slow: order #9771 is `PAID`, `refunds: []`, only the original `SALE` transaction present — identical signature to #9735. **Not a PollWindows tuning artifact**: 90s is ~5.4x the historical observed max (16.7s) for this stage, and the direct check shows zero refunds even minutes later. That's 2 misses out of ~14 `partial_undeliverable` runs (~15%) — a real intermittent gap in the undeliverable→refund backend automation, not a harness issue. **Per JJ (2026-07-22): no ticket for now** — focus stays on finishing the TS rewrite; he'll triage/raise backend defects himself once that's done. Logged here for the record only.

**Full 6-case set × `--repeat 3` — US, PASS, zero variance (2026-07-22, orders #9740–#9757):** all 3 repeats of all 6 cases (single, multi, unique, split, undeliverable, partial_undeliverable) passed identically — `report.ts`'s stable-signature diff found no variance across repeats. `undeliverable` cleanup timings across the 3 repeats: 25.3s / 20.2s / 15.2s (well inside the 300s window, trending down as staging warmed up). All 3 `partial_undeliverable` refunds landed in 5.7s — the isolated #9735 refund-miss above did **not** recur across these 3 fresh runs, reinforcing that it was a one-off staging automation miss rather than a systemic gap. Report: `ts/reports/regression_US_20260722T050946Z.md`. This closes TAA-13 checklist item 7's "full set + repeat 3" step for US; PS is the same set still to run.

**Full 6-case set × `--repeat 3` — PS, PASS, zero variance (2026-07-22, orders #3252–#3269):** same clean result as US — all 3 repeats of all 6 cases passed identically, no stable-signature variance. Timings were tighter than US throughout (PS `seed_inventory` 1.2–6.7s vs US 4–8.8s, `undeliverable` cleanup 10.1–20.2s, `partial_undeliverable` refund 5.7s all 3 runs). Report: `ts/reports/regression_PS_20260722T052237Z.md`. Both stores are now green at `--repeat 3` — the "full set + repeat 3" step of checklist item 7 is done for both stores.

**Customer identity changed (JJ, 2026-07-17):** no pre-existing Shopify customer GID is used anymore — orders are placed with just an email + name, and Shopify creates/attaches the customer automatically on first use of that email. `BASELINE_CUSTOMERS` (`config.ts`) replaced the previous staff identity (Jared Davis) with a dedicated QA-automation identity per store: US = `JJQA AutoUS` / `QAauto@universalstore.com.au`, PS = `JJQA AutoPS` / `QAauto@perfectstranger.com.au` (confirmed against live order data 2026-07-17, matches `config.ts`). `ShopifyClient.createDraftOrder` (`clients/shopify.ts`) no longer takes/sends `customerId`.

**Next priorities (in order — everything else is blocked on 1–2):**

1. ~~Port `regression/polling.py` → TS~~ — done (`src/polling.ts`).
2. ~~Real `clients/dynamo.ts` (inventory ops)~~ — done.
3. ~~Real readers + schema confirmation~~ — done (`readers/shopifyReader.ts`, `readers/dynamoReader.ts`, `verify/*.ts`).
4. ~~Wire the full stage chain in `runner.ts`~~ — done.
5. ~~`--repeat` variance diff~~ — done (`report.ts`, `cli.ts`).
6. ~~Extend offline tests~~ — done (35 tests, `npm test`).
7. ~~Re-run `undeliverable`/`partial_undeliverable` to confirm the `REMOVED`-status fix~~ — done, `undeliverable` PASS with real `cleanup=50.6s`. ~~Full 6-case set, then `--repeat 3`, both stores~~ — done 2026-07-22, US and PS both PASS with zero variance (see findings above). ~~Tune `PollWindows`~~ — done 2026-07-22 from 71 case runs across 10 reports: `ordersTable` 120→60s, `shipmentsTable+allocation` 420→90s (40/50 split), `refund` 300→90s, `cleanup` 300→120s, `inventory` 240→60s (see `config.ts` comment for the p90/max data behind each); re-validated live post-tune (every stage passed well inside the new windows; the one failure that run was the known refund-automation gap above, unrelated to tuning).

**NewStore read-back endpoint confirmed (2026-07-22):** `GET /v0/d/external_orders/{external_id}` — not `/v0/d/orders/{uuid}` (404s; "no static resource"). Response includes `order_uuid`, `order_id` (`ST...` display id), and `ordered_products[]` with `product_sku`/`quantity`/`item_id`. Propagation delay after injection ≈2s (confirmed via a freshly-injected probe order, `product_id 33006246`), much faster than the Shopify/Dynamo pipeline stages — poll accordingly rather than reusing the longer windows. Unblocks `readers/newstore_reader.py`/TS `newstoreReader.ts` and wiring cases 7–8.

**Confirmed real bug in `order_counter.json` (2026-07-22):** injected a test SFS order reusing the file-based counter (`JD000000022`) and NewStore's `POST /v0/d/fulfill_order` silently returned an **existing, unrelated order** under that external_id (different SKUs than requested) instead of creating a new one or erroring. This is worse than the previously-documented "not concurrency-safe" framing — a stale/reset counter file can silently collide with a real historical order and serve its data instead of failing loudly. Confirms the TS rewrite's planned collision-free external-ID scheme (timestamp + random suffix, per `ts-rewrite-dev-doc.md`) is required, not just a nice-to-have. Do not port `order_counter.json`'s logic as-is.

**NewStore customer identity renamed away from Jared Davis (2026-07-22):** `newstore_orders.py`'s `NS_MOCK_CUSTOMER` (a single flat dict, name "Jared Davis" / `jared.davis@universalstore.com.au`) is now `NS_MOCK_CUSTOMERS` — a per-brand dict (`_active_customer()`) matching the Shopify convention: US = `JJQA AutoNS` / `QAauto@universalstore.com.au`, PS = `JJQA AutoNS` / `QAauto@perfectstranger.com.au`. The `ns_id` (NewStore customer profile UUID) still points at Jared's real profile — needs a real profile for this identity before live use. `NS_ASSOCIATES`/`ACTIVE_ASSOCIATE_ID` (the staff member placing the order) intentionally left untouched — those are real NewStore staff accounts, not a customer identity to rename, and OTC orders require a real one.
8. NS cases 7–8: **APPROVED and IN PROGRESS under [TAA-17](https://universalstore.atlassian.net/browse/TAA-17)** (superseded the earlier "on hold" note). Build the real `clients/newstore.ts` + injection + reader + verify + case wiring per the "FINISH THE TS REWRITE" section at the top of this file. Order creation stays via API injection (`POST /v0/d/fulfill_order`); only the webhook/real-checkout path is parked. Read-back endpoint confirmed: `GET /v0/d/external_orders/{external_id}`.
9. ~~Parity sign-off~~ — done 2026-07-22. Baseline reproduces the Python `regression/` v0.1 spec's case set and assertions in TS, green on both stores at `--repeat 3` (the one known gap, the intermittent refund-automation miss, is a backend defect the harness correctly detects, not a TS/Python parity gap — see above). NS cases 7-8 explicitly excluded from this sign-off per item 8. Python `regression/` package is now retired/historical-reference-only — the TS harness under `ts/` is the live regression suite going forward. `main.py` and the rest of the interactive Python CLI are untouched by this (separate scope, not part of the regression baseline).
10. **AFTER TAA-13 parity sign-off → [TAA-14](https://universalstore.atlassian.net/browse/TAA-14) run-time optimisation (queued — do NOT start mid-validation):** ~20 min `--repeat 3` is serialisation, not staging latency. Phase A quick wins: batch `zeroEverywhere` writes (~194 serial PutItems → BatchWrite), adaptive poll interval (1s→2s→3s→cap 5s; Shopify polls ≥2s), composite stage checks (advance multiple stages per poll tick), live progress line (repeat/case/stage/% + ETA from recorded stage averages). Phase B: **grow variant pools to ≥12 SKUs per store** (also unblocks richer undie/split permutations and future modifier cases — discounts, address changes, new product types), fully disjoint SKUs per case, parallel case scheduler behind `--parallel` (waves derived from declared case SKUs; never two concurrent cases on one SKU; repeats stay serial). Target ≤7 min with identical stable signatures vs sequential.

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

Allocator reads `ATP#<store>` rows per SKU; store with all SKUs = single shipment; SKUs spread across stores = split; zero stock everywhere (or all in-stock stores in rejected-stores) = undeliverable → Shopify refund → shipment ITEM# rows flip status to `REMOVED` (~40–60s after refund; rows are NEVER deleted — live finding Jul 17) + `SHIPMENT_ITEM_REMOVED` transaction appended; inventory decrements at allocated stores. Never rely on ambient staging stock — seed inventory explicitly per test case, with SKUs isolated per case (concurrent async pipelines interfere otherwise).

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

## TypeScript rewrite handoff (Jul 17, 2026) — HISTORICAL, superseded by "TS state" above

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
