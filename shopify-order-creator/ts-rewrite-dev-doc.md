# TypeScript Rewrite — Dev Doc

**Status:** Live on staging — 6/6 cases implemented, first full run 4/6 green, cleanup fix landed
**Owner:** JJ
**Relates to:** TAA-13 (this work), TAA-3 (regression baseline), Scope of Work phase 1

## Current state (Jul 17, post-live-runs — through commit d7869a7)

TAA-13 steps 1–7 are all committed: polling ported, real Dynamo client (SDK v3, SSO,
strict-only), real Shopify + Dynamo readers with **confirmed schemas** (correlation via
`origin_index` GSI; allocated stores are plain store numbers), full stage chain wired,
`--repeat` variance diff (stable signature excluding volatile fields), 38 offline tests.

**Live staging results (US):**

- Solo `single` run: **PASS** (order #9701).
- Full 6-case run (orders #9702–#9707): 4/6 pass. `undeliverable` + `partial_undeliverable` failed at `shipments.cleanup`.
- **Root cause found and fixed:** the cleanup assertion expected ITEM# rows to be *deleted*; staging actually flips row status to `REMOVED` and never deletes. Assertion now checks status (commit 07fa507). Design doc + Python reference corrected to match.
- Second fix from live runs: orders now use dedicated QA-automation customer identities (real company email domains), not Jared's staff account.

**Recorded stage latencies (for PollWindows tuning):** orders_table ~10–21s,
allocation ~5–35s, refund ~17s, inventory ~0–56s. Current windows are generous; fine
for now, tighten after more runs.

**Remaining to close TAA-13:**

- [ ] Re-run full set post-cleanup-fix; then `--repeat 3` (zero variance required)
- [ ] Run the set against PS
- [ ] NewStore client still stubbed — confirm read-back endpoint, wire cases 7–8 (or explicitly move NS coverage to a follow-up ticket)
- [ ] Parity sign-off → retire Python package

Full task state: [TAA-13](https://universalstore.atlassian.net/browse/TAA-13).

## Order of operations (agreed Jul 17)

TS rewrite → TAA-3 regression baseline runs in TS → choose next phase from the Scope of Work. The Python code (CLI + `regression/` v0.1) is the **executable reference spec** — it is ported, not run first. Retain it until the TS suite passes the baseline live, then retire it.

## Pre-flight (language-independent — do during scaffold, not after)

These block the first live run in *any* language:

1. **Confirm DynamoDB schemas.** Run `python -m regression.schema_probe --order <recent-order-number>` once (or port it first) to confirm key formats of `staging-orders-v2` / `staging-shipments`, including the allocated-store value format (`"100"` vs `"BRANCH_100"`). Bake the confirmed schema into the TS reader as constants — don't carry the multi-format guessing.
2. **Confirm the NewStore order read-back endpoint** (candidate: `GET /v0/d/orders/{uuid}`) for cases 7–8.

## Toolchain (confirm against the production stack before scaffolding)

- Node LTS, TypeScript 5.x, `strict: true`.
- Test runner, package manager, eslint/prettier config: **copy from the production stack repos** — alignment is the whole point of the rewrite. Ask dev (Brendo/Lacho) for the reference repo.
- AWS SDK v3 (`@aws-sdk/client-dynamodb` + `lib-dynamodb`), SSO profile via `@aws-sdk/credential-providers` `fromSSO({ profile: "staging" })`.
- GraphQL: plain `fetch` POST is sufficient (the Python side uses a thin client); no heavy GraphQL framework needed.
- Same env vars: `US_ACCESS_TOKEN`, `PS_ACCESS_TOKEN`, `NS_STAGING_CLIENT_ID`, `NS_STAGING_CLIENT_SECRET`, optional `AWS_REGION` / `AWS_PROFILE`.

## Repo layout (qa repo)

```
qa/
├── harness/                  # the TS suite (name TBC)
│   ├── src/
│   │   ├── config.ts         # explicit config object — the ONLY state carrier
│   │   ├── clients/          # shopify.ts, dynamo.ts, newstore.ts
│   │   ├── flows/            # seeding, order creation (returns identifiers)
│   │   ├── readers/          # order/shipment/inventory read-back
│   │   ├── verification/     # assertion modules (expected-vs-actual errors)
│   │   ├── cases/            # declarative case specs
│   │   ├── reporting/        # markdown + JSON, repeat-variance diff
│   │   └── cli/              # entry point (yargs/commander)
│   └── tests/                # offline unit tests for the assertion logic
└── shopify-order-creator/    # Python reference — retire after parity
```

## Module mapping (Python → TS)

| Python | TS | Porting notes |
| --- | --- | --- |
| `orders_processor.py` | `clients/shopify.ts` | Class with injected config — **no import-time clients, no module globals**. Keep the GraphQL strings (incl. the `order { id name }` selection in draftOrderComplete). Store is a constructor arg, not a toggle. |
| `graphql_scripts.py` | inline in `clients/shopify.ts` or `clients/shopify.queries.ts` | Strings port as-is. |
| `newstore_client.py` | `clients/newstore.ts` | OAuth2 client-credentials, token cache with pre-expiry refresh, retry on network/5xx (2s/4s backoff, 3 tries), raise on 4xx. Cleanest Python module — port faithfully. |
| `newstore_orders.py` | `flows/newstoreOrders.ts` | Payload builders (GST = price/11, SFS 9.99 shipping, OTC preconfirmed). **Fix external IDs**: replace the `order_counter.json` file counter with a collision-free scheme (e.g. `JD` + timestamp + random suffix) — the file counter is not concurrency-safe. |
| `aws_inventory.py` | `clients/dynamo.ts` | v3 DocumentClient. `getStock`/`setStock`/`seedInventory`/`zeroEverywhere` (query all ATP rows by SKU PK). **Strict by default** — throwing is the only failure mode; a soft mode exists only if the CLI needs it. |
| `regression/` v0.1 | `src/` (whole layout) | Port 1:1: config + PollWindows, polling.ts, readers, verification, cases 1–6, runner, reporting with `--repeat` variance diff. **This is the core deliverable — it IS TAA-3.** |
| `receipt_service.py` | — | Not needed for regression. Port later only if the NS receipt workflow is still wanted. |
| `main.py` | `cli/` | Don't port the menus. Minimal command surface first (`run`, `list`, `probe`); the refreshed operator CLI is Scope phase 2. |

## Parity contract (what "done" means)

- The TS suite implements the baseline case set (single, multi, unique, split, undeliverable, partial-undeliverable × US/PS) with the same seed plans and the same assertions (see `regression/cases.py` — the declarative specs port almost directly).
- Same verification chain per case: Shopify read-back (paid + line items, duplicate-merge safe) → orders-table alignment → shipment unit counts + allocation → refund/no-refund → cleanup → exact inventory decrement.
- JSON report shape compatible with the Python `report.py` schema so runs are diffable across languages during the transition.
- Exit non-zero on any failure or repeat variance.
- Baseline passes live with `--repeat 3`, zero variance, both stores → Python retired.

## Fixes to bake in (do NOT port these bugs)

1. No module globals / import-time side effects — config object + constructor injection everywhere.
2. Silent failures are hard failures: no `{}`-on-error, no $1.00 price fallback, no silent SKU skips in regression paths.
3. One source of truth for store/brand (Python has separate Shopify `STORE` and NewStore `BRAND` toggles that drift).
4. Concurrency-safe external IDs (no shared counter file).
5. Presets/cases keyed explicitly by SKU, never positionally from dict order.
6. Receipt inconsistencies (10.0 vs 9.99 shipping, hardcoded "Universal Store") — fix if/when receipts port.

## Known constraints to carry over

- Shopify merges duplicate line items; DynamoDB/NewStore are one-row-per-unit — compare SKU→quantity maps, never line counts.
- Variant pools are small (5 US / 4 PS SKUs) — full per-case SKU isolation impossible until pools grow; run cases sequentially to terminal state.
- Poll windows are guesses until tuned from recorded stage timings; timing drift is itself a signal.

## Build order (maps to the Jira checklist)

1. Scaffold + toolchain confirmed against stack conventions.
2. `clients/`: shopify, dynamo, newstore (offline-testable, no env needed to import).
3. `flows/`: seeding + order creation returning full identifiers.
4. `readers/` + `verification/` + polling (unit-test assertion logic offline — the Python logic checks in this repo's history show what to cover).
5. Cases 1–6 + runner + reporting + `--repeat`.
6. Schema confirmation baked in; first live run; tune PollWindows.
7. Live baseline green ×3 repeats both stores → sign off parity → retire Python.
