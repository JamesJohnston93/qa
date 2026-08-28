# Regression Package Design — Omni-Channel Alignment Baseline

**Status:** Implemented and signed off (parity sign-off 2026-07-22, TAA-13). This page is the design/parity spec it was built against — kept as the historical record; treat `CLAUDE.md` as authoritative for current status and `ts/src/` as the live implementation.
**Owner:** JJ
**Relates to:** TAA-3, QA Order & Fulfilment Verification Harness Scope of Work

## Purpose

Build a deterministic regression package on top of the existing QA order tool that proves omni-channel alignment end-to-end: orders place, allocate into shipments, and inventory changes land correctly across **Shopify, AWS (DynamoDB), and NewStore**. This is the baseline set — "these always need to work and behave exactly the same way." Every run either reproduces the exact expected state in all three systems or fails loudly with evidence.

This package is built in Python first, reusing the existing creation modules. It then becomes the executable parity spec for the TypeScript rebuild: the TS suite is done when it reproduces these runs with identical results.

## Current state (from code review, Jul 2026)

*(Status update, 2026-08-06: all five gaps below are now closed — see the per-bullet annotations. Kept as written because it explains why the design is shaped the way it is. The Python tool this describes no longer exists: the `regression/` package was `git rm`'d 2026-07-31 (TAA-17) and the interactive CLI + its five supporting modules 2026-08-04 (TAA-15 step 3). Zero Python remains.)*

The existing tool is creation-only. It places Shopify draft orders and injects NewStore SFS/OTC orders, and manages `staging-inventory-v2` stock (`ensure_stock` top-up, `split_stock` across ATP#100/99/407/640). What it does not do:

- **Created-order IDs are discarded.** `complete_draft_order` returns nothing and the GraphQL doesn't select the final order ID — there is nothing to verify against. *(Closed: `ShopifyClient.createDraftOrder` always returns `{orderId, orderName, createdAt}`.)*
- **No verification exists.** Success is the absence of an API error. No order read-back, no `staging-orders-v2` / `staging-shipments` reads, no inventory before/after diff, no polling for the async pipeline. *(Closed: `readers/{shopifyReader,dynamoReader,newstoreReader}.ts`, `verify/*.ts`, `polling.ts`.)*
- **Silent failure paths.** AWS errors are swallowed (order proceeds anyway), unknown SKUs are skipped, prices fall back to $1.00. *(Closed: strict is the only mode — every client throws. `flows/receipts.ts` is the one documented, narrow exception.)*
- **Non-determinism.** Random SKUs and names, first-available shipping rate, file-based order counter that isn't concurrency-safe. *(Closed: pinned per-case SKU slots in `cases/baselineCases.ts`, fixed `BASELINE_CUSTOMERS`, real `draftOrderCalculate` rate fetch, and collision-free `QA{SFS|OTC}_{timestamp}_{random}` external IDs — `order_counter.json`'s scheme was deliberately not ported, its reuse bug returns an existing unrelated order.)*
- **State via mutable globals** and import-time side effects, blocking headless/parallel runs. *(Closed: config is an explicit object built by the caller and passed down; `--parallel` wave scheduling landed in TAA-14 Phase B.)*

## Design principles

1. **Deterministic in, deterministic out.** Every case pins its inputs: fixed SKUs, fixed customer, pinned shipping rate, controlled inventory state. Allocation outcomes are forced via inventory levers, never left to ambient staging stock.
2. **Isolation per case.** Each case owns its SKUs/inventory rows so concurrent async pipelines can't interfere (the baseline-contention fix from the Scope of Work).
3. **Hard fail on silent paths.** An empty dict from an inventory call, a skipped SKU, or a fallback price is a test failure, not a warning.
4. **Capture everything created.** Every creation call returns identifiers (Shopify order id/name, NewStore order UUID/external id, inventory snapshots) that flow into verification.
5. **Evidence-based results.** A failure report includes the actual vs expected state from each system, not just "mismatch."

## Package architecture

*(Status update, 2026-08-06: the Python tree below is the original design and no longer exists on disk — see the mapping to the real `ts/src/` layout underneath it. The design's `verification/` concept became `verify/`.)*

```
shopify-order-creator/
├── regression/
│   ├── runner.py          # entry point: python -m regression [--cases ...] [--store US|PS]
│   ├── cases/             # one module per case, declarative: inputs + expected state
│   ├── flows/             # order lifecycle orchestration (create → wait → verify)
│   ├── readers/
│   │   ├── shopify_reader.py    # order read-back: line items, financial status, fulfilments, refunds
│   │   ├── dynamo_reader.py     # staging-orders-v2, staging-shipments, staging-inventory-v2 reads
│   │   └── newstore_reader.py   # order retrieval via existing NewStoreClient
│   ├── verify/
│   │   ├── inventory.py   # before/after decrement diff per ATP location
│   │   ├── orders.py      # Shopify order ↔ orders-v2 alignment
│   │   ├── shipments.py   # allocation state: ITEM# rows, allocated store vs undeliverable
│   │   └── refunds.py     # undeliverable → Shopify refund → removal from both tables
│   ├── polling.py         # wait-for-state with per-stage timeouts from recorded latencies
│   ├── report.py          # markdown + JSON report per run, per-case evidence
│   └── config.py          # explicit config object — no module globals, no input()
```

Existing modules are reused as the creation layer (`orders_processor`, `newstore_orders`, `aws_inventory`, `newstore_client`). `main.py` and its menus are bypassed entirely.

### As built — the real layout (`shopify-order-creator/ts/src/`)

| Design (Python) | As built (TS) |
| --- | --- |
| `regression/runner.py` — `python -m regression ...` | `cli.ts` + `runner.ts`, entry `index.ts` — `node dist/index.js ...` (plus `cli-order.ts` for the ad-hoc `order` subcommand, TAA-15) |
| `cases/` | `cases/baselineCases.ts` (pipeline cases 1–6) + `cases/newstoreCases.ts` (cases 7–8) |
| `flows/` | `flows/{orderFlow,inventoryFlow,newstoreOrders,receipts}.ts` |
| `readers/shopify_reader.py`, `dynamo_reader.py`, `newstore_reader.py` | `readers/{shopifyReader,dynamoReader,newstoreReader}.ts` |
| `verify/inventory.py`, `orders.py`, `shipments.py`, `refunds.py` | `verify/{index,orders,refunds,shipments,inventory,newstore}.ts` |
| `polling.py` | `polling.ts` |
| `report.py` | `report.ts` |
| `config.py` | `config.ts` |
| — (not in the design) | `clients/{shopify,dynamo,newstore}.ts`, `variants.ts` (SKU→GID pools), `scheduler.ts` (`--parallel` waves) and `progress.ts` (live progress line), both TAA-14 |

There is no `verification/` directory — the early TS scaffold's placeholder `verification/` module was replaced by `verify/`, and any doc still referencing `verification/assertions.ts` is stale. `shopify-order-creator/run-regression.sh` is the wrapper (it lives in `shopify-order-creator/`, not the repo root). Offline tests: 20 files under `ts/tests/`, 169 cases, `npm test`. *(Count corrected 2026-08-21; `tests/cli-fulfil.test.js` and `tests/fulfilment.test.js` arrive with TAA-34, on the unmerged `taa-34-fulfil-client` branch.)*

## Required changes to existing modules

*(Status update, 2026-08-06: historical — this work was done during the Python phase, and every file named in the table has since been deleted. Kept for the record of what had to change and why.)*

Small and non-breaking to the CLI:

| Change | File | Why |
| --- | --- | --- |
| `draftOrderComplete` selects `draftOrder { order { id name } }` and `complete_draft_order` returns it | `graphql_scripts.py`, `orders_processor.py` | Capture the order ID — the single biggest blocker |
| `place_an_order`-equivalent flow returns a result object (order id, skus, inventory snapshot) | new `regression/flows/` | Verification needs the full creation record |
| `ensure_stock` / `split_stock` gain a `strict=True` mode that raises instead of returning `{}` | `aws_inventory.py` | Silent AWS failure must fail the test |
| Read primitives for `staging-orders-v2` and `staging-shipments` | new `dynamo_reader.py` | Core allocation verification |
| Headless imports: defer client creation until first use | `orders_processor.py`, `newstore_client.py` | Import without env vars for unit tests / dry runs |

## Baseline case set v1 — "always must behave exactly the same"

Run per store (US and PS) unless noted. Each case seeds its own inventory state first.

*(Status update, 2026-08-06: all 8 cases are built and are the default set — they all run when `--cases` is omitted. Case names as implemented added below, since those are what you type. `CaseDefinition`/`NewStoreCaseDefinition` carry a `kind: "pipeline" | "newstore"` discriminator and `runner.ts`'s `run()` partitions on it: the six pipeline cases get the progress tracker + `--parallel` wave scheduler, the two NewStore cases always run sequentially — they're a 2-stage inject → read-back round trip with no Shopify/Dynamo state.)*

*(Status update, 2026-08-23: two more cases added (TAA-39) — the default set is now 10, see the table below. Both new cases are `pipeline`-kind, same treatment as cases 1-6. `fulfil_single`/`fulfil_split` additionally drive a fulfil + verify-fulfilment + allocation-reflection sequence after the usual pipeline (TAA-36/37/38), gated by a `CaseDefinition.fulfilment: boolean` flag rather than a new `kind`.)*

| # | Case | Name / kind | Inventory setup | Expected outcome |
| --- | --- | --- | --- | --- |
| 1 | Single item, single store | `single` · pipeline | All stock at one ATP location | 1 shipment, allocated to that store |
| 2 | Multi (3× same SKU) | `multi` · pipeline | All stock at one location | 1 shipment, 3 ITEM# rows, correct units (Shopify merges dupes; Dynamo/NS don't — assert accordingly) |
| 3 | Unique (3 different SKUs) | `unique` · pipeline | All SKUs at one store | 1 combined shipment |
| 4 | Split shipment | `split` · pipeline | Each SKU stocked at a different store only | One shipment per store, locations correct |
| 5 | Undeliverable | `undeliverable` · pipeline | Zero stock everywhere | Item marked UNDELIVERABLE, Shopify refund issued, item rows cleaned up in both AWS tables (shipments: status → `REMOVED`, not deleted — live finding Jul 17) |
| 6 | Partial undeliverable | `partial_undeliverable` · pipeline | One SKU stocked, one zero | Mixed: allocated shipment + refunded undie |
| 7 | Fulfil, single shipment | `fulfil_single` · pipeline | All stock at one ATP location | 1 shipment, fulfilled end to end — tracking number in both AWS tables, Shopify fulfilment matches the allocation (TAA-39) |
| 8 | Fulfil, split shipment | `fulfil_split` · pipeline | Each SKU stocked at a different store only | Two shipments across two stores, both fulfilled independently, each with its own tracking number and correctly-located Shopify fulfilment (TAA-39) |
| 9 | NS SFS injection | `ns_sfs` · newstore | ~~Standard top-up~~ — as built these cases never touch `staging-inventory-v2` | Order lands in NewStore, inventory correct |
| 10 | NS OTC injection | `ns_otc` · newstore | ~~Standard top-up~~ — as above | Preconfirmed/fulfilled order, no shipping |

Note: `cli.ts`'s `--help`/`--list-cases` text has historically drifted behind the real case set (fixed 2026-08-06 for `unique`/`partial_undeliverable`, again 2026-08-23 for the two fulfilment cases) — `tests/cli.test.js` now pins the full case list so a future addition fails loudly offline instead of only being caught by a reviewer running `--help`.

### Assertions per case (the alignment checks)

Every case verifies, in order, with polling between stages:

1. **Shopify:** order exists, financial status paid, line items exactly match the request (SKU + qty).
2. **AWS orders:** order appears in `staging-orders-v2`, items match the Shopify order, `origin_index` resolves.
3. **AWS shipments:** one `ITEM#` row per unit in `staging-shipments`; each allocated to the expected store or marked `UNDELIVERABLE`.
4. **Inventory:** `staging-inventory-v2` decremented by exactly the ordered quantity at exactly the allocated store(s) — no other rows touched.
5. **Refund path (undie cases):** Shopify refund matches item value; item rows cleaned up in both AWS tables. *Live finding (Jul 17, orders #9706/#9707): shipments rows are not deleted — status flips to `REMOVED`. Assert status, not absence.*

## Reporting

Each run produces a markdown summary and a JSON artifact: per-case pass/fail, timings per pipeline stage (feeds the polling windows), and on failure the expected-vs-actual snapshot from each system. Reports are shareable as-is (Confluence/Slack) and the JSON is diffable between runs to detect behavioural drift — the "consistency" signal.

## Determinism & race-condition posture

- Repeat mode: `--repeat N` runs the full set N times and diffs the JSON results. Any variance between identical runs is a flagged inconsistency — this is the primary race-condition detector, and the mechanism that makes volume runs meaningful.
- Recorded stage latencies build a timing profile; a stage drifting outside its window fails even if the end state is eventually right (catches slow/late event delivery like the immediate-undie gap in TAA-4).
- Per-case SKU isolation removes cross-case contamination as a false-positive source.

## Out of scope for v1 (next increments)

- **Modifier isolation cases:** order-level vs item-level discounts (half-price shipping vs $5 off item), address change + set-default propagation across systems, new product types/mappings. Example coverage to be sourced from Futura. These slot in as new `cases/` modules — the architecture doesn't change.
- Fulfilment (Auspost), rejection/reallocation, cancellation beyond the undie path — Scope of Work phases 3–5. *(Status update, 2026-08-06: fulfilment verification and rejection/reallocation — Scope of Work phases 3 and 4 — are now in scope as **TAA-21**, next up once TAA-22 closes. They slot in as new `cases/` modules; since the `kind: "pipeline"` discriminator landed, pipeline-shaped cases get tracker + `--parallel` support for free.)* *(Status update, 2026-08-21: the two were separated — TAA-21 is fulfilment only, an umbrella sliced into [TAA-34](https://universalstore.atlassian.net/browse/TAA-34)–[TAA-39](https://universalstore.atlassian.net/browse/TAA-39); rejection/reallocation is [TAA-31](https://universalstore.atlassian.net/browse/TAA-31), blocked behind it. And it is more than new `cases/` modules: slice A (TAA-34, built and committed on `taa-34-fulfil-client`) adds a new `clients/fulfilment.ts` and a hand-drivable `fulfil` subcommand (`cli-fulfil.ts`) wired into `index.ts`. Regression cases proper are the last slice, TAA-39.)* *(Status update, 2026-08-24: TAA-21 is done (all six slices, both stores). TAA-31 (rejection/reallocation) slices A-D are done on `taa-31-reject-probe` (not merged) — `clients/reject.ts`, `flows/rejectFlow.ts`'s `rejectShipment()`, all live-confirmed; the reject call turned out to be a sibling endpoint, `POST /staging/reject`, not the same one as fulfil. Slice E (reject → undeliverable) and regression-suite wiring are what's left — see `ts/signoffs/TAA-31-slice-a.md` through `-slice-d.md`.)* *(Status update, 2026-08-28: slice E done too — reject → undeliverable, live-confirmed on US via a new audited targeted-zero seed (`DynamoClient.zeroExceptStore`), order #9968, both items resolved `UNDELIVERABLE` in 28.4s. Both reject case designs (D's reallocate, E's undeliverable) are now proven; neither is wired into `cases/`/`runner.ts`/`cli.ts` yet and neither has run on PS — that's slice F/G. See `ts/signoffs/TAA-31-slice-e.md`.)*
- Volume/stress beyond `--repeat`, AWS pipeline monitoring (alarms — TAA-2), CI/CD.

## Definition of done — v1

*(Status update, 2026-08-06: all four met — 2026-07-22, TAA-13. The invocation is `node dist/index.js`, not `python -m regression`; the flag contract is otherwise as designed.)*

- ~~`python -m regression`~~ **`node dist/index.js`** runs the full baseline set headlessly against staging for both stores and exits non-zero on any failure. **Met** — exit 0 = all cases passed and repeats consistent, 1 = any failure or repeat variance.
- All 8 cases pass repeatably (`--repeat 3` with zero variance) on a healthy staging environment. **Met for the 6 baseline cases on both stores, 2026-07-22:** US orders #9740–#9757 (`regression_US_20260722T050946Z.md`) and PS orders #3252–#3269 (`regression_PS_20260722T052237Z.md`), both PASS with zero stable-signature variance. Cases 7–8 landed later (TAA-17) and are green in the full 8-case default set on US; PS's 8-case set passes single-pass sequential and `--parallel`, but **`--store PS --parallel --repeat 3` is still to be re-run cleanly**. *(Status update, 2026-08-21: TAA-22 was closed with this item outstanding; the run is now owned by [TAA-40](https://universalstore.atlassian.net/browse/TAA-40), which also covers the only live confirmation of the parallel-by-default flip.)*
- Reports produced per run; a failure report contains enough evidence to raise a defect without re-running. **Met** — `ts/reports/regression_<STORE>_<ISO8601Z>.md` + `.json` per run.
- The case set + assertions are signed off as the parity spec for the TypeScript rebuild. **Met** — parity signed off 2026-07-22 against the Python `regression/` v0.1 package, which was then retired (`git rm`'d 2026-07-31).
