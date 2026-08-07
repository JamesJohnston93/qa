# QA

QA automation space for Universal Store / Perfect Stranger — tooling that places real test data and verifies it flowing through the full stack (Shopify → AWS → NewStore), replacing repetitive manual checks with repeatable, reportable runs.

**Owner:** JJ (james.johnston@universalstore.com.au)
**Tracking:** Jira project [TAA](https://universalstore.atlassian.net/jira/core/projects/TAA/board) — TS rewrite done ([TAA-13](https://universalstore.atlassian.net/browse/TAA-13)/[14](https://universalstore.atlassian.net/browse/TAA-14)/[17](https://universalstore.atlassian.net/browse/TAA-17)); in progress [TAA-22](https://universalstore.atlassian.net/browse/TAA-22) (PS, one item left) and [TAA-15](https://universalstore.atlassian.net/browse/TAA-15) (operator UX); next up [TAA-21](https://universalstore.atlassian.net/browse/TAA-21) (fulfilment & rejection). Docs: Confluence QD space → [QA Automation Tool](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1786970142/QA+Automation+Tool)

All tooling targets **staging only**.

> **Reading this cold?** `shopify-order-creator/CLAUDE.md` is the living source of truth — per-step sign-offs, live-run results, findings, and the current priority list. This README is the orientation layer. Current branch state: work is on **`taa-22-ps`**, which is **not yet merged to `main`**; `taa-14-speedup`, `taa-15-cli-port` and `taa-17-newstore` are merged leftovers that can be pruned.

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

The default set is **8 cases**. Each case declares a `kind`, and the runner partitions on it:

| Kind | Cases | Path |
| --- | --- | --- |
| `pipeline` | `single`, `multi`, `unique`, `split`, `undeliverable`, `partial_undeliverable` | Full Shopify → AWS stage chain above. Gets the live progress tracker and `--parallel`. |
| `newstore` | `ns_sfs`, `ns_otc` | Inject via `POST /v0/d/fulfill_order`, read back via `GET /v0/d/external_orders/{external_id}`, assert the SKU/qty map. Never touches Shopify or `staging-inventory-v2`, so always runs sequentially. |

`--list-cases` prints the live set with descriptions — trust it over any list in the docs.

`--repeat N` reruns the identical set and diffs results — any variance between identical runs is flagged as a race-condition signal.

**Cases run in parallel by default** (since 2026-08-06): a shared-nothing wave scheduler runs SKU-disjoint cases concurrently, capped at `--concurrency` (default 4). Each store's SKU pool holds 14 variants and the 6 pipeline cases claim 10 fully disjoint slots, which is what makes that safe — and parallel runs are proven byte-identical to sequential ones on both stores. Pass `--sequential` for a readable one-case-at-a-time log, or to rule out concurrency when triaging a failure. Repeats always run serially either way.

## Status

**TS rewrite complete — zero Python.** The tool is a single maintainable TypeScript suite covering Shopify + AWS + NewStore end to end.

- **Regression baseline** (TAA-13, done): green on US and PS at `--repeat 3`, zero variance.
- **Run-time** (TAA-14, done): parallel execution + tuned polling took the full `--repeat 3` gate from ~20 min to ~4 min on US — ~4.9x, with byte-identical stable signatures vs sequential.
- **NewStore** (TAA-17, done): injection, read-back, cases 7–8, and receipts all in TS; live-confirmed on both stores.
- **Perfect Stranger** (TAA-22, in progress): PS lost its static Shopify token when Shopify retired that auth model Jan 1 2026, and now authenticates by OAuth client-credentials. Done and live-confirmed, PS SKU pool grown 4→14 and made disjoint like US, full 8-case set PASS both sequential (4:13) and `--parallel` (1:36, identical signature). **One item open:** `--store PS --parallel --repeat 3` hasn't yet completed clean — an earlier attempt was killed during a one-off staging slowdown, since confirmed a one-off. That's all that's holding the ticket.
- **Operator UX** (TAA-15, in progress): the `order` subcommand covers the retired Python CLI's daily-use path. Settings menu, presets, stress test, associate switching, fire-and-verify and the CLI-vs-GUI decision are still open — see "Not yet ported" in `qa-order-cli-tool-documentation.md`.

During its own validation the harness has caught real backend defects — an intermittent undeliverable→refund gap (~15% of `partial_undeliverable` runs, orders #9735 and #9771, deliberately not ticketed yet) and a NewStore external-ID collision that silently returned an unrelated existing order — proving value beyond regression coverage. `CLAUDE.md` has the full evidence for each.

Next: fulfilment verification + rejection/reallocation cases ([TAA-21](https://universalstore.atlassian.net/browse/TAA-21)) — Scope-of-Work phases 3 and 4.

## Run it

Prereqs: `US_ACCESS_TOKEN` (static) / `PS_CLIENT_ID` + `PS_CLIENT_SECRET` (OAuth client-credentials, TAA-22 — PS lost its static token Jan 1 2026) / `NS_STAGING_CLIENT_ID` / `NS_STAGING_CLIENT_SECRET` env vars, `aws sso login --profile staging`. Build once: `cd shopify-order-creator/ts && npm install && npm run build`.

```bash
cd shopify-order-creator/ts

# Regression suite (bare invocation = regression run, all 8 cases, parallel)
node dist/index.js --store US
node dist/index.js --store US --cases single             # one case
node dist/index.js --store US --repeat 3                 # full gate (~4 min)
node dist/index.js --store US --sequential --cases split # one at a time, for triage
node dist/index.js --list-cases

# Place an ad-hoc test order (order subcommand)
node dist/index.js order --store US --items 32625134x2,33006246x1
node dist/index.js order --ns sfs --items 33006246x1     # NewStore injection
node dist/index.js order --help
```

`shopify-order-creator/run-regression.sh` is a wrapper that installs/builds if needed and forwards to the regression run.

Reports (markdown + diffable JSON, per-stage timings) land in `shopify-order-creator/ts/reports/`. They're **disposable** — each run prunes the directory back to the 10 most recent runs. Anything worth keeping gets written up in `CLAUDE.md` or on the ticket, so don't treat the folder as an archive.

One caveat when reading per-stage timings: since TAA-14, `orders_table` and `allocation` share a single composite poll loop, so both measure from the same start. **Don't sum the per-stage numbers to get wall-clock** — use the measured wall-clock.

Offline tests (no staging access needed) — pure logic only: arg parsing, payload shape, assertions, scheduling, report diffing. Live staging runs are the separate, explicit confirm step for anything network-facing.

```bash
cd shopify-order-creator/ts
npm run build && npm test          # == node --test tests/*.test.js
```

## Notes for operators

- Orders are placed as dedicated QA customers (`QAauto@universalstore.com.au` / `QAauto@perfectstranger.com.au`) — never staff accounts. One known loose end: the NewStore mock customer's `ns_id` still points at the original author's real NewStore profile and needs its own profile before live use.
- Undeliverable cases zero a SKU's stock at **every** location (~194 rows in staging, not just the four documented web/DC ones) to force the outcome. This is deliberate — it's *the* mechanism for forcing an undeliverable — but it is destructive and not reversible, since no prior values are captured. Cases draw from the pool in `sku-lists/`, and those are ordinary staging-catalogue products rather than dedicated "do not sell" QA items, so treat any change that broadens the zeroing scope as a real risk.
- `ATP#INTERNATIONAL` / `ATP#STUDIO` / `ATP#ALL` are async aggregate mirrors, excluded from inventory assertions.
- Undeliverable cleanup asserts `status === REMOVED`, not row absence — staging never deletes the `ITEM#` rows, it flips their status ~40–60s after the refund.
- Strict by default: every client throws on failure, no silent fallbacks or synthetic data. `flows/receipts.ts` is the one documented exception (non-fatal by design — a receipt decorates an already-successful order rather than checking correctness). Don't generalise it.
