# QA Order & Fulfilment Verification Harness — Scope of Work

*(Reworked Jul 2026 — regression baseline promoted to Phase 0; design detail lives in the [Regression Package Design — Omni-Channel Alignment Baseline] page.)*

## Purpose

Evolve the QA order tool into a verification suite covering the full order lifecycle on staging — order creation, allocation, fulfilment, rejection/reallocation, and cancellation/refund — on a foundation built to keep growing.

The immediate priority is **omni-channel alignment**: proving that orders place, allocate into shipments, and inventory changes land correctly across Shopify, AWS, and NewStore, locked in by a deterministic regression baseline that always behaves exactly the same way. The TypeScript rebuild then reproduces that baseline as its parity target.

## Where it stands today

*(Status update, 2026-08-21 — supersedes the ticket mapping in the 2026-08-06 note below. **TAA-22 is Done**; its outstanding `--store PS --parallel --repeat 3` run is now owned by [TAA-40](https://universalstore.atlassian.net/browse/TAA-40). **TAA-21 no longer covers Workstreams 3 and 4 together** — on 2026-08-07 it became an umbrella Workstream for fulfilment (Workstream 3) only, sliced into six session-sized tickets [TAA-34](https://universalstore.atlassian.net/browse/TAA-34)–[TAA-39](https://universalstore.atlassian.net/browse/TAA-39); rejection & reallocation (Workstream 4) split out to [TAA-31](https://universalstore.atlassian.net/browse/TAA-31), click & collect to [TAA-32](https://universalstore.atlassian.net/browse/TAA-32), and the order-finalised transaction to [TAA-33](https://universalstore.atlassian.net/browse/TAA-33). Slice A (TAA-34) is **built and committed** on `taa-34-fulfil-client` — a fulfil client, a hand-drivable `fulfil` subcommand and offline tests — but has never been run against staging. Branch `taa-22-ps` is still unmerged to `main` and is now also 5 commits ahead of its own remote.)*

*(Status update, 2026-08-06 — supplements the 2026-08-04 note below: Workstream 0 and Workstream 1 are both done; TAA-22 (PS OAuth + PS SKU pool) has since landed, leaving one open item — a clean `--store PS --parallel --repeat 3` — before it closes. TAA-21 (Workstreams 3 and 4) is next up. Branch `taa-22-ps` is not yet merged to `main`.)*

*(Status update, 2026-08-04: the TypeScript rebuild — described as Workstream 1 below — is complete, and the Python CLI referenced in the rest of this section has since been retired in favour of the `order` subcommand under `ts/`, see `CLAUDE.md` and `qa-order-cli-tool-documentation.md`. The "where it stands today" paragraph immediately below is left as written for historical context on the state this scope was written against; treat `CLAUDE.md` as authoritative for current status.)*

The Python CLI places Shopify orders (US and PS) and injects NewStore SFS/OTC orders, managing DynamoDB inventory before each order. Verification of the downstream flow is the gap: created-order IDs aren't captured, there is no read-back of `staging-orders-v2` / `staging-shipments` state, no inventory decrement checks, and failure paths are silent. Coverage stops at creation; the regression baseline (Phase 0) closes this.

## Objectives

1. Establish the deterministic regression baseline in the existing Python tool (Phase 0) — the "always must behave exactly the same" set.
2. Rebuild the harness in TypeScript against that baseline as the parity spec, on a layered structure designed to scale.
3. Extend verification across allocation reflection in Shopify, fulfilment, rejection/reallocation, and cancellation/refund.
4. Add operational monitoring of the underlying AWS pipeline (stretch).
5. Refresh the operator experience (CLI first).

## Guiding decisions

- **Language:** TypeScript for the rebuild — aligns with the production stack. Phase 0 stays Python: it reuses the existing creation modules and delivers verification value now.
- **Rebuild approach:** the Python harness + Phase 0 baseline are retained as the working reference until the TS suite reproduces the baseline with identical results, then retired. *(Status update, 2026-08-06: this played out as planned and is now history. Parity signed off 2026-07-22; the Python `regression/` package was `git rm`'d 2026-07-31 and the interactive Python CLI 2026-08-04. Zero Python remains.)*
- **Structure (TS):** layered package — `clients/`, ~~`verification/`~~ `verify/`, `flows/`, `tests/`, ~~`reporting/`~~ `report.ts`, `config` — plus, as built, `cases/`, `readers/`, and `scheduler.ts`/`progress.ts` (TAA-14). *(The early scaffold's placeholder `verification/` module was replaced by `verify/`; reporting is a single `report.ts`, not a directory.)*
- **Test determinism:** allocation outcomes are driven by the harness via inventory levers, never left to ambient staging stock. Each case owns isolated SKUs/inventory so concurrent async pipelines can't interfere.
- **Consistency as a signal:** repeat runs of the identical baseline are diffed; any variance between identical runs is a flagged inconsistency — the primary race-condition detector.

## Deterministic control of allocation outcomes

The allocator reads `ATP#<store>` inventory rows per SKU (e.g. Chermside = `ATP#407`). A store holding all SKUs is a single-shipment candidate; SKUs spread across stores form combination candidates; the allocator picks the cheapest solution (cost logic out of scope). A shipment item's rejected-stores array excludes stores from allocation.

Levers: **single shipment** — stock all SKUs at one store; **split** — each SKU at a different store only; **undeliverable** — zero stock everywhere or all in-stock stores rejected; **rejection** — call the reject endpoint.

## Workstreams

### 0. Regression baseline — omni-channel alignment (~~Python, current focus~~ — TAA-3)

*(Status update, 2026-08-06: **done**, and no longer in Python — the baseline lives and runs in TypeScript under `ts/`. All 8 cases are built and are the default set; acceptance met on both stores at `--repeat 3` for the 6 baseline cases 2026-07-22, with cases 7–8 added under TAA-17. TAA-3 remains open as the parent design ticket for the whole harness. The invocation is `node dist/index.js`, not a `/regression` Python package.)*

**Goal:** a headless `/regression` package proving order → allocation → inventory alignment across Shopify, AWS, and NewStore, deterministically, per store (US + PS).

**Includes:** created-order ID capture; strict (hard-fail) inventory operations; readers for Shopify order state, `staging-orders-v2`, `staging-shipments`, `staging-inventory-v2`, and NewStore orders; polling tuned from recorded latencies; per-case SKU isolation; markdown + JSON evidence reports; repeat-run variance detection.

**Case set v1:** single / multi / unique / split-shipment / undeliverable / partial-undeliverable / NS SFS / NS OTC.

**Acceptance:** full set passes repeatably (repeat ×3, zero variance) on healthy staging for both stores; failure reports carry enough evidence to raise a defect without re-running. Full detail: see the Regression Package Design page.

### 1. Foundation — TypeScript rebuild to parity

*(Status update, 2026-08-06: **done — TAA-13, 2026-07-22**, extended by TAA-14 (run-time optimisation) and TAA-17 (NewStore + Python retirement). Parity signed off against the Python `regression/` v0.1 spec: full 6-case set × `--repeat 3` PASS with zero variance on both stores — US #9740–#9757 (`regression_US_20260722T050946Z.md`), PS #3252–#3269 (`regression_PS_20260722T052237Z.md`). Poll windows tuned from 71 case runs across 10 reports. Python retired 2026-07-31/2026-08-04.)*

**Goal:** stand up the TS harness and reproduce the Phase 0 baseline with identical results.

**Includes:** toolchain confirmation, layered scaffold, client layer (Shopify Admin GraphQL, DynamoDB, credentials/config, reporting), port of creation + verification capability, rerun-failed/retry support, mock mode. *(Of these, "rerun-failed/retry support" and "mock mode" are **not confirmed as delivered** — what exists is infra-level retry inside the clients (Shopify 429/`THROTTLED` backoff, NewStore network/5xx retry), not a rerun-failed run mode, and there is no evidence of a mock mode. Treat both as still open unless you can point at them in `ts/src/`.)*

**Acceptance:** the TS suite reproduces the Phase 0 baseline runs with equivalent pass/fail results; deterministic allocation levers demonstrable; Python harness retired after sign-off. *(All three met — see the status note above.)*

### 2. Allocation reflection: Shopify ↔ DynamoDB

*(Status update, 2026-08-21: still not started. The folding target has since been sliced — within the TAA-34–39 set, the Shopify ↔ DynamoDB reflection work this workstream describes lands in **[TAA-38](https://universalstore.atlassian.net/browse/TAA-38)** (slice E, "allocation reflection"), which is where the store → Shopify-location mapping gets built. Note also that click & collect and the order-finalised transaction were carved out of the same surrounding scope into [TAA-32](https://universalstore.atlassian.net/browse/TAA-32) and [TAA-33](https://universalstore.atlassian.net/browse/TAA-33).)*

*(Status update, 2026-08-06: **not started, and folded into [TAA-21](https://universalstore.atlassian.net/browse/TAA-21)** alongside Workstreams 3 and 4. Nothing here has been built — the baseline asserts Shopify order state and the DynamoDB allocation independently, and neither the fulfilment-order querying nor the store → Shopify-location mapping this workstream calls for exists in `ts/src/` (confirmed by grep). It was folded rather than left standing because it verifies the same surface as Workstream 3's fulfilment verification and needs the same two missing pieces — keeping them separate would mean building both twice. Per JJ, 2026-08-06.)*

**Goal:** verify the Shopify order/fulfilment view matches the DynamoDB allocation — right SKUs and unit counts per fulfilment, fulfilment location maps to the allocated store, one fulfilment per shipment, no fulfilment for undeliverables.

**Includes:** fulfilment-order querying, store → Shopify-location mapping, refreshed CLI.

**Acceptance:** for single, combination, and undeliverable scenarios, Shopify composition and location align to DynamoDB; mismatches reported clearly.

### 3. Fulfilment verification (Auspost)

*(Status update, 2026-08-21: **in progress**, and no longer bundled with Workstream 4. TAA-21 is an umbrella sliced into [TAA-34](https://universalstore.atlassian.net/browse/TAA-34) (A, fulfil one shipment from hand-supplied ids) → [TAA-35](https://universalstore.atlassian.net/browse/TAA-35) (B, payload from real shipment rows) → [TAA-36](https://universalstore.atlassian.net/browse/TAA-36) (C, fulfil a whole order end to end) → [TAA-37](https://universalstore.atlassian.net/browse/TAA-37) (D, assert the fulfilled state) → [TAA-38](https://universalstore.atlassian.net/browse/TAA-38) (E, allocation reflection) → [TAA-39](https://universalstore.atlassian.net/browse/TAA-39) (F, regression cases + runner wiring). Slice A is built and committed, awaiting its live confirm. The **order-finalised** transaction named in the goal below is now its own ticket, [TAA-33](https://universalstore.atlassian.net/browse/TAA-33), rather than part of this workstream.)*

*(Status update, 2026-08-06: **to do — TAA-21**, next up once TAA-22 closes. TAA-21 covers this workstream and Workstream 4 together.)*

**Goal:** verify the fulfilment path end-to-end (the fulfilment call already exists — this is verification only): shipment UUID + fulfilled state written to DynamoDB and Shopify; fulfilled state flows to the orders table; **order-finalised** transaction written exactly when the last open item closes.

**Boundary:** Futura DN verification out of scope.

### 4. Rejection & reallocation

*(Status update, 2026-08-21: **to do — [TAA-31](https://universalstore.atlassian.net/browse/TAA-31)**, split out of TAA-21 on 2026-08-07 so fulfilment could land on its own. Blocked behind TAA-21: rejection reuses the widened `ShipmentItem`, `groupItemsByShipment()`, the shipment-complete gate, the `TRANSACTION#` reader and the store → Shopify-location mapping, so building it first would mean building all of that twice. Four contract questions are still open on that ticket — the reject endpoint, payload and auth have not been provided, and whether rejection is per-shipment or per-item is undecided.)*

*(Status update, 2026-08-06: **to do — TAA-21**, alongside Workstream 3.)*

**Goal:** verify a store rejection re-runs allocation correctly — items returned to the allocator, rejecting store appended to rejected-stores, next-best reallocation or undeliverable, honouring exclusions.

### 5. Cancellation / refund transactions

*(Status update, 2026-08-06: **partly covered by the baseline, not started as a workstream.** The undeliverable → refund path is asserted by cases 5–6 (`verify/refunds.ts`, and `verify/shipments.ts` asserting `status → REMOVED` rather than row deletion). The harness surfaced a real intermittent gap here — orders #9735 and #9771 reached `PAID` with `refunds: []` and no refund transaction, 2 misses in ~14 runs (~15%). Per JJ 2026-07-22 no ticket is raised yet; cross-reference TAA-4.)*

**Goal:** verify the undeliverable → refund → cancel path — **order-item-refunded** transaction present, item cancelled in both tables, matching Shopify refund.

### 6. AWS pipeline monitoring (stretch)

*(Status update, 2026-08-06: **not started** — still a stretch item, TAA-2.)*

CloudWatch error scan across pipeline Lambdas per run window, SQS queue depth + DLQ checks, post-run health summary. Attempted after phases 0–5.

## Future increments (named, not yet scoped)

*(Status update, 2026-08-06: still unscoped, except **data pool** — partly delivered ahead of schedule as TAA-14 Phase B / TAA-22 step 2: raw SKU lists `sku-lists/{us,ps}-skus.txt` resolved to `.json` by `ts/scripts/fetch-sku-gids.js` (191/200 US, 180/200 PS), and `variants.ts` now holds 14 SKUs per store with 10 disjoint case slots. The customer pool has not grown — see the note at the end of `staging-sku-setup.md`. **Volume & consistency** is served for now by `--repeat N` variance diffing; scaled volume runs remain unscoped.)*

- **Modifier isolation cases:** order-level vs item-level discounts (e.g. half-price shipping vs $5 off an item), customer address change + set-default propagating omni-channel, new product types/mappings interacting correctly in orders. Example coverage sourced from Futura.
- **Volume & consistency:** scaled repeat runs of complex repeatable orders to prove consistency and surface edge cases and race conditions.
- **Data pool & sanitation:** larger, cleaner customer/SKU pools; validation sweeps.
- **Reconciliation sweeps:** cross-system data recs beyond per-order checks (pattern established in TAA-9).

## Out of scope (this body of work)

Futura/DN verification; browser UI-driving/Playwright; ~~NewStore SFS/OTC order *verification* coverage (creation exists; verification later)~~ *(moved in scope and delivered under TAA-17: injection + read-back via `GET /v0/d/external_orders/{external_id}`, asserted by `verify/newstore.ts` as cases `ns_sfs`/`ns_otc`. The webhook/real-checkout path stays out of scope.)*; broader Inventory Regression scenarios; returns/BORIS/exchanges; full CI/CD; GUI (stretch only).

## Risks & dependencies

- **Capacity** is the primary constraint — work chunked so each phase lands independently; suite runnable at every boundary.
- **Rebuild window:** Phase 0 baseline keeps verification value flowing while the TS suite reaches parity; Python retained until sign-off. *(Status update, 2026-08-06: closed — the window is over. Python was retained through parity sign-off (2026-07-22) and then removed in two batches: `regression/` 2026-07-31, the interactive CLI 2026-08-04. Kept as the record of the strategy actually followed.)*
- **Per-phase stack inputs:** stack types, Lambda contracts, and endpoint payloads shared at the start of each phase that needs them.
- **Staging behaviour:** async latencies vary between stages; polling windows tuned from recorded timings, and timing drift itself is reported.

## Definition of done (overall)

*(Status update, 2026-08-06: the Python → TS transition half is met; the coverage half is not yet. Per-criterion below.)*

- Deterministic regression baseline running headlessly in Python (Phase 0), then reproduced by the TypeScript harness covering creation, inventory, allocation reflection, fulfilment, rejection/reallocation, and cancellation/refund on staging, run from a refreshed CLI with shareable reports. **Partly met:** the baseline is headless in TS and covers creation, inventory, allocation and the undeliverable→refund path, with markdown + JSON reports per run (`regression_<STORE>_<ISO8601Z>.md`/`.json`). **Still open:** allocation reflection (Workstream 2, now [TAA-38](https://universalstore.atlassian.net/browse/TAA-38)), fulfilment ([TAA-21](https://universalstore.atlassian.net/browse/TAA-21), sliced TAA-34–39, slice A built), rejection/reallocation ([TAA-31](https://universalstore.atlassian.net/browse/TAA-31), blocked behind it), and the refreshed operator CLI ([TAA-29](https://universalstore.atlassian.net/browse/TAA-29) — the `order` subcommand covers the daily-use path only). *(Ticket mapping corrected 2026-08-21; TAA-15 closed 2026-08-06 with its remaining UX scope moved to TAA-29.)*
- Allocation outcomes deterministically controllable; repeat-run variance tracked as a first-class signal. **Met** — inventory levers per case, 10 disjoint SKU slots per store, `--repeat N` stable-signature diffing with a non-zero exit on variance.
- AWS pipeline monitoring delivered or documented as the next increment. **Documented, not delivered** — Workstream 6 / TAA-2.
