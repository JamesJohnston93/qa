# QA Order & Fulfilment Verification Harness — Scope of Work

*(Reworked Jul 2026 — regression baseline promoted to Phase 0; design detail lives in the [Regression Package Design — Omni-Channel Alignment Baseline] page.)*

## Purpose

Evolve the QA order tool into a verification suite covering the full order lifecycle on staging — order creation, allocation, fulfilment, rejection/reallocation, and cancellation/refund — on a foundation built to keep growing.

The immediate priority is **omni-channel alignment**: proving that orders place, allocate into shipments, and inventory changes land correctly across Shopify, AWS, and NewStore, locked in by a deterministic regression baseline that always behaves exactly the same way. The TypeScript rebuild then reproduces that baseline as its parity target.

## Where it stands today

The Python CLI places Shopify orders (US and PS) and injects NewStore SFS/OTC orders, managing DynamoDB inventory before each order. Verification of the downstream flow is the gap: created-order IDs aren't captured, there is no read-back of `staging-orders-v2` / `staging-shipments` state, no inventory decrement checks, and failure paths are silent. Coverage stops at creation; the regression baseline (Phase 0) closes this.

## Objectives

1. Establish the deterministic regression baseline in the existing Python tool (Phase 0) — the "always must behave exactly the same" set.
2. Rebuild the harness in TypeScript against that baseline as the parity spec, on a layered structure designed to scale.
3. Extend verification across allocation reflection in Shopify, fulfilment, rejection/reallocation, and cancellation/refund.
4. Add operational monitoring of the underlying AWS pipeline (stretch).
5. Refresh the operator experience (CLI first).

## Guiding decisions

- **Language:** TypeScript for the rebuild — aligns with the production stack. Phase 0 stays Python: it reuses the existing creation modules and delivers verification value now.
- **Rebuild approach:** the Python harness + Phase 0 baseline are retained as the working reference until the TS suite reproduces the baseline with identical results, then retired.
- **Structure (TS):** layered package — `clients/`, `verification/`, `flows/`, `tests/`, `reporting/`, `config`.
- **Test determinism:** allocation outcomes are driven by the harness via inventory levers, never left to ambient staging stock. Each case owns isolated SKUs/inventory so concurrent async pipelines can't interfere.
- **Consistency as a signal:** repeat runs of the identical baseline are diffed; any variance between identical runs is a flagged inconsistency — the primary race-condition detector.

## Deterministic control of allocation outcomes

The allocator reads `ATP#<store>` inventory rows per SKU (e.g. Chermside = `ATP#407`). A store holding all SKUs is a single-shipment candidate; SKUs spread across stores form combination candidates; the allocator picks the cheapest solution (cost logic out of scope). A shipment item's rejected-stores array excludes stores from allocation.

Levers: **single shipment** — stock all SKUs at one store; **split** — each SKU at a different store only; **undeliverable** — zero stock everywhere or all in-stock stores rejected; **rejection** — call the reject endpoint.

## Workstreams

### 0. Regression baseline — omni-channel alignment (Python, current focus — TAA-3)

**Goal:** a headless `/regression` package proving order → allocation → inventory alignment across Shopify, AWS, and NewStore, deterministically, per store (US + PS).

**Includes:** created-order ID capture; strict (hard-fail) inventory operations; readers for Shopify order state, `staging-orders-v2`, `staging-shipments`, `staging-inventory-v2`, and NewStore orders; polling tuned from recorded latencies; per-case SKU isolation; markdown + JSON evidence reports; repeat-run variance detection.

**Case set v1:** single / multi / unique / split-shipment / undeliverable / partial-undeliverable / NS SFS / NS OTC.

**Acceptance:** full set passes repeatably (repeat ×3, zero variance) on healthy staging for both stores; failure reports carry enough evidence to raise a defect without re-running. Full detail: see the Regression Package Design page.

### 1. Foundation — TypeScript rebuild to parity

**Goal:** stand up the TS harness and reproduce the Phase 0 baseline with identical results.

**Includes:** toolchain confirmation, layered scaffold, client layer (Shopify Admin GraphQL, DynamoDB, credentials/config, reporting), port of creation + verification capability, rerun-failed/retry support, mock mode.

**Acceptance:** the TS suite reproduces the Phase 0 baseline runs with equivalent pass/fail results; deterministic allocation levers demonstrable; Python harness retired after sign-off.

### 2. Allocation reflection: Shopify ↔ DynamoDB

**Goal:** verify the Shopify order/fulfilment view matches the DynamoDB allocation — right SKUs and unit counts per fulfilment, fulfilment location maps to the allocated store, one fulfilment per shipment, no fulfilment for undeliverables.

**Includes:** fulfilment-order querying, store → Shopify-location mapping, refreshed CLI.

**Acceptance:** for single, combination, and undeliverable scenarios, Shopify composition and location align to DynamoDB; mismatches reported clearly.

### 3. Fulfilment verification (Auspost)

**Goal:** verify the fulfilment path end-to-end (the fulfilment call already exists — this is verification only): shipment UUID + fulfilled state written to DynamoDB and Shopify; fulfilled state flows to the orders table; **order-finalised** transaction written exactly when the last open item closes.

**Boundary:** Futura DN verification out of scope.

### 4. Rejection & reallocation

**Goal:** verify a store rejection re-runs allocation correctly — items returned to the allocator, rejecting store appended to rejected-stores, next-best reallocation or undeliverable, honouring exclusions.

### 5. Cancellation / refund transactions

**Goal:** verify the undeliverable → refund → cancel path — **order-item-refunded** transaction present, item cancelled in both tables, matching Shopify refund.

### 6. AWS pipeline monitoring (stretch)

CloudWatch error scan across pipeline Lambdas per run window, SQS queue depth + DLQ checks, post-run health summary. Attempted after phases 0–5.

## Future increments (named, not yet scoped)

- **Modifier isolation cases:** order-level vs item-level discounts (e.g. half-price shipping vs $5 off an item), customer address change + set-default propagating omni-channel, new product types/mappings interacting correctly in orders. Example coverage sourced from Futura.
- **Volume & consistency:** scaled repeat runs of complex repeatable orders to prove consistency and surface edge cases and race conditions.
- **Data pool & sanitation:** larger, cleaner customer/SKU pools; validation sweeps.
- **Reconciliation sweeps:** cross-system data recs beyond per-order checks (pattern established in TAA-9).

## Out of scope (this body of work)

Futura/DN verification; browser UI-driving/Playwright; NewStore SFS/OTC order *verification* coverage (creation exists; verification later); broader Inventory Regression scenarios; returns/BORIS/exchanges; full CI/CD; GUI (stretch only).

## Risks & dependencies

- **Capacity** is the primary constraint — work chunked so each phase lands independently; suite runnable at every boundary.
- **Rebuild window:** Phase 0 baseline keeps verification value flowing while the TS suite reaches parity; Python retained until sign-off.
- **Per-phase stack inputs:** stack types, Lambda contracts, and endpoint payloads shared at the start of each phase that needs them.
- **Staging behaviour:** async latencies vary between stages; polling windows tuned from recorded timings, and timing drift itself is reported.

## Definition of done (overall)

- Deterministic regression baseline running headlessly in Python (Phase 0), then reproduced by the TypeScript harness covering creation, inventory, allocation reflection, fulfilment, rejection/reallocation, and cancellation/refund on staging, run from a refreshed CLI with shareable reports.
- Allocation outcomes deterministically controllable; repeat-run variance tracked as a first-class signal.
- AWS pipeline monitoring delivered or documented as the next increment.
