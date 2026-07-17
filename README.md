# QA

QA automation space for Universal Store / Perfect Stranger — tooling that places real test data and verifies it flowing through the full stack (Shopify → AWS → NewStore), replacing repetitive manual checks with repeatable, reportable runs.

**Owner:** JJ (james.johnston@universalstore.com.au)
**Tracking:** Jira project [TAA](https://universalstore.atlassian.net/jira/core/projects/TAA/board) — active ticket [TAA-13](https://universalstore.atlassian.net/browse/TAA-13) · Docs: Confluence QD space → [QA Automation Tool](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1786970142/QA+Automation+Tool)

All tooling targets **staging only**.

## Layout

| Folder | Contents |
| --- | --- |
| `shopify-order-creator/ts/` | **The regression harness (TypeScript — the active codebase).** CLI, deterministic baseline cases, cross-system verification, reports. |
| `shopify-order-creator/` | Python reference: the original order-creation CLI (`main.py`) and the `regression/` package the TS harness was ported from. Retired once TS parity is signed off. |

Key docs, all in `shopify-order-creator/`: `CLAUDE.md` (living project context — read first), `regression-package-design.md` (case set + assertions), `ts-rewrite-dev-doc.md` (porting guide + status), `scope-of-work-reworked.md` (phased roadmap).

## What the harness does

Each baseline case seeds DynamoDB inventory to force a specific allocation outcome, places a real Shopify order, then polls and verifies every downstream stage:

1. Shopify read-back — order exists, paid, line items match
2. `staging-orders-v2` — order row lands, items align (correlated via the `origin_index` GSI)
3. `staging-shipments` — one ITEM# row per unit, allocated to the expected store or `UNDELIVERABLE`
4. Refund path (undie cases) — Shopify refund issued, item status flips to `REMOVED`
5. `staging-inventory-v2` — stock decrements exactly where allocated, nowhere else

Cases: single, multi, unique, split, undeliverable, partial-undeliverable (NewStore SFS/OTC cases pending endpoint confirmation). `--repeat N` reruns the identical set and diffs results — any variance between identical runs is flagged as a race-condition signal.

## Status

Live on staging (US): full six-case set runs end-to-end; first full run 4/6 with both failures root-caused and fixed (shipments cleanup flips status to `REMOVED` rather than deleting rows). Remaining for parity sign-off: post-fix re-run, `--repeat 3` with zero variance, PS store run, poll-window tuning, NewStore cases. See TAA-13 for the live checklist.

Queued next ([TAA-14](https://universalstore.atlassian.net/browse/TAA-14)): run-time optimisation — batch seed writes, adaptive polling, live progress line, then SKU pool growth (≥12 per store) enabling parallel case execution. Target: full `--repeat 3` gate in ≤7 min (currently ~20). Pool growth also unblocks richer undeliverable/split permutations and future modifier cases.

## Run it

Prereqs: `US_ACCESS_TOKEN` / `PS_ACCESS_TOKEN` env vars, `aws sso login --profile staging`.

```bash
# from repo root
./shopify-order-creator/run-regression.sh --help
./shopify-order-creator/run-regression.sh --store US --cases single --repeat 1 --report-dir ./reports

# or directly
cd shopify-order-creator/ts
npm run build
node dist/index.js --store US --cases single
```

Reports (markdown + diffable JSON, with per-stage timings) land in `shopify-order-creator/ts/reports/`.

Offline tests (no staging access needed):

```bash
cd shopify-order-creator/ts
npm run build && node --test tests/*.test.js
```

## Notes for operators

- Orders are placed as dedicated QA customers (`QAauto@universalstore.com.au` / `QAauto@perfectstranger.com.au`) — never staff accounts.
- Undeliverable cases zero a SKU's stock at **every** location (~194 rows) — deliberate and destructive; SKUs come from a small dedicated test pool, don't widen it casually.
- `ATP#INTERNATIONAL` / `ATP#STUDIO` / `ATP#ALL` are async aggregate mirrors, excluded from inventory assertions.
