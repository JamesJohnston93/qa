# Regression Package Design — Omni-Channel Alignment Baseline

**Status:** Draft for review
**Owner:** JJ
**Relates to:** TAA-3, QA Order & Fulfilment Verification Harness Scope of Work

## Purpose

Build a deterministic regression package on top of the existing QA order tool that proves omni-channel alignment end-to-end: orders place, allocate into shipments, and inventory changes land correctly across **Shopify, AWS (DynamoDB), and NewStore**. This is the baseline set — "these always need to work and behave exactly the same way." Every run either reproduces the exact expected state in all three systems or fails loudly with evidence.

This package is built in Python first, reusing the existing creation modules. It then becomes the executable parity spec for the TypeScript rebuild: the TS suite is done when it reproduces these runs with identical results.

## Current state (from code review, Jul 2026)

The existing tool is creation-only. It places Shopify draft orders and injects NewStore SFS/OTC orders, and manages `staging-inventory-v2` stock (`ensure_stock` top-up, `split_stock` across ATP#100/99/407/640). What it does not do:

- **Created-order IDs are discarded.** `complete_draft_order` returns nothing and the GraphQL doesn't select the final order ID — there is nothing to verify against.
- **No verification exists.** Success is the absence of an API error. No order read-back, no `staging-orders-v2` / `staging-shipments` reads, no inventory before/after diff, no polling for the async pipeline.
- **Silent failure paths.** AWS errors are swallowed (order proceeds anyway), unknown SKUs are skipped, prices fall back to $1.00.
- **Non-determinism.** Random SKUs and names, first-available shipping rate, file-based order counter that isn't concurrency-safe.
- **State via mutable globals** and import-time side effects, blocking headless/parallel runs.

## Design principles

1. **Deterministic in, deterministic out.** Every case pins its inputs: fixed SKUs, fixed customer, pinned shipping rate, controlled inventory state. Allocation outcomes are forced via inventory levers, never left to ambient staging stock.
2. **Isolation per case.** Each case owns its SKUs/inventory rows so concurrent async pipelines can't interfere (the baseline-contention fix from the Scope of Work).
3. **Hard fail on silent paths.** An empty dict from an inventory call, a skipped SKU, or a fallback price is a test failure, not a warning.
4. **Capture everything created.** Every creation call returns identifiers (Shopify order id/name, NewStore order UUID/external id, inventory snapshots) that flow into verification.
5. **Evidence-based results.** A failure report includes the actual vs expected state from each system, not just "mismatch."

## Package architecture

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

## Required changes to existing modules

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

| # | Case | Inventory setup | Expected outcome |
| --- | --- | --- | --- |
| 1 | Single item, single store | All stock at one ATP location | 1 shipment, allocated to that store |
| 2 | Multi (3× same SKU) | All stock at one location | 1 shipment, 3 ITEM# rows, correct units (Shopify merges dupes; Dynamo/NS don't — assert accordingly) |
| 3 | Unique (3 different SKUs) | All SKUs at one store | 1 combined shipment |
| 4 | Split shipment | Each SKU stocked at a different store only | One shipment per store, locations correct |
| 5 | Undeliverable | Zero stock everywhere | Item marked UNDELIVERABLE, Shopify refund issued, item rows cleaned up in both AWS tables (shipments: status → `REMOVED`, not deleted — live finding Jul 17) |
| 6 | Partial undeliverable | One SKU stocked, one zero | Mixed: allocated shipment + refunded undie |
| 7 | NS SFS injection | Standard top-up | Order lands in NewStore, inventory correct |
| 8 | NS OTC injection | Standard top-up | Preconfirmed/fulfilled order, no shipping |

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
- Fulfilment (Auspost), rejection/reallocation, cancellation beyond the undie path — Scope of Work phases 3–5.
- Volume/stress beyond `--repeat`, AWS pipeline monitoring (alarms — TAA-2), CI/CD.

## Definition of done — v1

- `python -m regression` runs the full baseline set headlessly against staging for both stores and exits non-zero on any failure.
- All 8 cases pass repeatably (`--repeat 3` with zero variance) on a healthy staging environment.
- Reports produced per run; a failure report contains enough evidence to raise a defect without re-running.
- The case set + assertions are signed off as the parity spec for the TypeScript rebuild.
