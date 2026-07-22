# TypeScript Rewrite — Dev Doc

**Status:** PARITY SIGNED OFF (2026-07-22). 6/6 baseline cases implemented, live on staging, full 6-case × `--repeat 3` green on both US and PS, PollWindows tuned from real stage timings. Python `regression/` v0.1 is retired — TS (`ts/`) is now the live regression suite. NS cases 7-8 are the one deferred item, on hold pending JJ's review.
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

**Recorded stage latencies (for PollWindows tuning):** orders_table ~5–26s,
allocation ~5–36s, refund ~5.7–17s, cleanup ~10–51s, inventory ~0–56s. Current windows are generous; fine
for now, tighten after more runs.

**Full set × `--repeat 3` (2026-07-22, US, orders #9740–#9757):** PASS, zero variance across
all 3 repeats of all 6 cases. Confirms the cleanup fix holds under repeat load (cleanup times
trended down: 25.3s → 20.2s → 15.2s) and that the isolated #9735 refund-miss (see CLAUDE.md)
didn't recur — all 3 `partial_undeliverable` refunds landed in 5.7s. Report:
`ts/reports/regression_US_20260722T050946Z.md`.

**Full set × `--repeat 3` (2026-07-22, PS, orders #3252–#3269):** PASS, zero variance across
all 3 repeats of all 6 cases — same clean result as US. Timings generally tighter than US
(`seed_inventory` 1.2–6.7s, `undeliverable` cleanup 10.1–20.2s, `partial_undeliverable` refund
5.7s all 3 runs). Report: `ts/reports/regression_PS_20260722T052237Z.md`.

**NewStore read endpoint confirmed (2026-07-22):** `GET /v0/d/external_orders/{external_id}`
(the `/v0/d/orders/{uuid}` candidate 404s — "no static resource"). Response shape:
`order_uuid`, `order_id` (`ST...` display id), `ordered_products[]` with `product_sku`/
`quantity`/`item_id`. Propagation delay ≈2s post-injection — needs its own short poll window,
not the longer Shopify/Dynamo ones. Probed live against US staging with a guaranteed-unique
external_id (bypassing `order_counter.json`); confirms the read contract for
`readers/newstoreReader.ts`.

**Bug confirmed in `order_counter.json` (2026-07-22):** reusing its counter value collided
with an existing external_id and NewStore's injection API silently returned that old,
unrelated order instead of erroring — stronger evidence for fix #4 below (collision-free
IDs). See CLAUDE.md for the full repro.

Renamed the NS customer identity away from Jared Davis: `newstore_orders.py`'s
`NS_MOCK_CUSTOMER` → per-brand `NS_MOCK_CUSTOMERS` (`_active_customer()`), matching the
Shopify `JJQA Auto*` convention. `ns_id` still points at Jared's real NewStore profile
(flagged TODO — needs a real profile before live use); `NS_ASSOCIATES` (real staff accounts)
left untouched, that's not a customer identity.

**PollWindows tuned (2026-07-22)** from 71 case runs across 10 reports (both stores,
2026-07-17 through 2026-07-22): `ordersTable` 120→60s, `shipmentsTable+allocation` 420→90s
(40/50 split), `refund` 300→90s, `cleanup` 300→120s, `inventory` 240→60s. See `config.ts`'s
`DEFAULT_POLL_WINDOWS` comment for the p90/max data behind each.

**Recurring intermittent finding, explicitly deferred (2026-07-22):** the tuned-PollWindows
validation re-run turned up a second `partial_undeliverable` refund-automation miss (order
#9771 — `PAID`, zero refunds, confirmed live; identical signature to the earlier #9735). 2
misses out of ~14 runs. Per JJ: not a ticket right now — this is a real backend gap the
harness correctly detects, not a TS-vs-Python parity gap, and doesn't block sign-off. He'll
triage backend defects himself once the rewrite is finished.

**TAA-13 checklist — closed 2026-07-22:**

- [x] Re-run full set post-cleanup-fix; then `--repeat 3` (zero variance required) — done, US, 2026-07-22
- [x] Run the set against PS — done, PS, 2026-07-22, zero variance
- [x] Confirm NewStore read-back endpoint — done, 2026-07-22 (see above; not yet wired)
- [x] Tune `PollWindows` from recorded stage timings — done, 2026-07-22, re-validated live
- [x] NS cases 7–8 — **explicitly out of scope for this sign-off**, deferred pending JJ's review
- [x] Parity sign-off → retire Python package — **done, 2026-07-22**. See "Sign-off" below.

## Sign-off (2026-07-22)

TS harness (`ts/`) reproduces the Python `regression/` v0.1 baseline's case set (single,
multi, unique, split, undeliverable, partial_undeliverable) and its full verification chain
(Shopify read-back → orders-table alignment → shipment allocation → refund/cleanup →
inventory decrement) live on staging, green at `--repeat 3` on both US and PS. The one known
gap (intermittent refund-automation miss, ~15% of `partial_undeliverable` runs) is a backend
defect the harness correctly surfaces each time — not a behavioral difference between the
Python and TS implementations — so it doesn't block sign-off per JJ's call above.

Python `regression/` v0.1 is retired as of this sign-off: historical reference only, not to
be run or extended further. `main.py` and the rest of the interactive Python CLI are
unaffected — separate scope, still active. NS cases 7-8 remain the one deferred item, to be
picked up per JJ's review after this rewrite phase closes out.

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
- Baseline passes live with `--repeat 3`, zero variance, both stores → Python retired. **Met 2026-07-22** — with the caveat that a known intermittent backend defect (refund automation, ~15% of `partial_undeliverable` runs, not a TS/Python difference) doesn't block sign-off per JJ's call. See "Sign-off" section above.

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
7. ~~Live baseline green ×3 repeats both stores → sign off parity → retire Python.~~ — done 2026-07-22.
