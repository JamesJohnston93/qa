# QA

QA automation space for Universal Store / Perfect Stranger — tooling that places real test data and verifies it flowing through the full stack (Shopify → AWS → NewStore), replacing repetitive manual checks with repeatable, reportable runs.

**Owner:** JJ (james.johnston@universalstore.com.au)
**Tracking:** Jira project [TAA](https://universalstore.atlassian.net/jira/core/projects/TAA/board) — TS rewrite (TAA-13/14/17) done; next up [TAA-21](https://universalstore.atlassian.net/browse/TAA-21) (fulfilment & rejection). Docs: Confluence QD space → [QA Automation Tool](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1786970142/QA+Automation+Tool)

All tooling targets **staging only**.

## Layout

The tool is a single TypeScript codebase — no Python remains (the original Python CLI was fully ported and retired, Aug 2026).

| Folder | Contents |
| --- | --- |
| `shopify-order-creator/ts/` | **The whole tool (TypeScript).** The automated regression harness (deterministic cases, cross-system verification, reports) plus the `order` subcommand for placing ad-hoc test orders. |
| `shopify-order-creator/` | The TS project's home, plus the project docs below. |

Key docs, all in `shopify-order-creator/`: `CLAUDE.md` (living project context — read first), `qa-order-cli-tool-documentation.md` (the `order` command), `regression-package-design.md` (case set + assertions), `ts-rewrite-dev-doc.md` (rewrite history), `scope-of-work-reworked.md` (phased roadmap), `staging-sku-setup.md` (test-SKU pool setup).

## What the harness does

Each baseline case seeds DynamoDB inventory to force a specific allocation outcome, places a real Shopify order, then polls and verifies every downstream stage:

1. Shopify read-back — order exists, paid, line items match
2. `staging-orders-v2` — order row lands, items align (correlated via the `origin_index` GSI)
3. `staging-shipments` — one ITEM# row per unit, allocated to the expected store or `UNDELIVERABLE`
4. Refund path (undeliverable cases) — Shopify refund issued, item status flips to `REMOVED`
5. `staging-inventory-v2` — stock decrements exactly where allocated, nowhere else

Pipeline cases: single, multi, unique, split, undeliverable, partial-undeliverable. NewStore cases (`ns_sfs`, `ns_otc`) inject an order and verify read-back. `--repeat N` reruns the identical set and diffs results — any variance between identical runs is flagged as a race-condition signal. `--parallel` runs SKU-disjoint cases concurrently (with a shared-nothing wave scheduler) to cut wall-clock time.

## Status

**TS rewrite complete — zero Python.** The tool is a single maintainable TypeScript suite covering Shopify + AWS + NewStore end to end.

- **Regression baseline** (TAA-13): green on US and PS at `--repeat 3`, zero variance.
- **Run-time** (TAA-14): parallel execution + tuned polling took the full `--repeat 3` gate from ~20 min to ~4 min on US. PS SKU-pool wiring is pending a staging token scope ([TAA-22](https://universalstore.atlassian.net/browse/TAA-22)).
- **NewStore** (TAA-17): injection, read-back, cases 7–8, and receipts all in TS; live-confirmed on US.

During its own validation the harness has caught real backend defects — an intermittent undeliverable→refund gap and an order-ID collision — proving value beyond regression coverage.

Next: fulfilment verification + rejection/reallocation cases ([TAA-21](https://universalstore.atlassian.net/browse/TAA-21)).

## Run it

Prereqs: `US_ACCESS_TOKEN` / `PS_ACCESS_TOKEN` / `NS_STAGING_CLIENT_ID` / `NS_STAGING_CLIENT_SECRET` env vars, `aws sso login --profile staging`. Build once: `cd shopify-order-creator/ts && npm install && npm run build`.

```bash
cd shopify-order-creator/ts

# Regression suite (bare invocation = regression run)
node dist/index.js --store US --cases single
node dist/index.js --store US --parallel --repeat 3      # full parallel gate

# Place an ad-hoc test order (order subcommand)
node dist/index.js order --store US --items 32625134x2,33006246x1
node dist/index.js order --ns sfs --items 33006246x1     # NewStore injection
node dist/index.js order --help
```

A repo-root wrapper `shopify-order-creator/run-regression.sh` forwards to the regression run. Reports (markdown + diffable JSON, per-stage timings) land in `shopify-order-creator/ts/reports/`.

Offline tests (no staging access needed):

```bash
cd shopify-order-creator/ts
npm run build && node --test tests/*.test.js
```

## Notes for operators

- Orders are placed as dedicated QA customers (`QAauto@universalstore.com.au` / `QAauto@perfectstranger.com.au`) — never staff accounts.
- Undeliverable cases zero a SKU's stock at **every** location (~194 rows) to force the outcome — deliberate and destructive, but safe here: staging is test-only and cases draw from a dedicated QA SKU pool (`sku-lists/`).
- `ATP#INTERNATIONAL` / `ATP#STUDIO` / `ATP#ALL` are async aggregate mirrors, excluded from inventory assertions.
