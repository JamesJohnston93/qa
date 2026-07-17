# QA

QA automation space for Universal Store / Perfect Stranger — tooling that places real test data and verifies it flowing through the full stack (Shopify → AWS → NewStore), replacing repetitive manual checks with repeatable, reportable runs.

**Owner:** JJ (james.johnston@universalstore.com.au)
**Tracking:** Jira project [TAA](https://universalstore.atlassian.net/jira/core/projects/TAA/board) · Docs: Confluence QD space → [QA Automation Tool](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1786970142/QA+Automation+Tool)

## Layout

| Folder | Contents |
| --- | --- |
| `shopify-order-creator/` | Python baseline and the TypeScript rewrite scaffold for the TAA-3 regression harness. See its `CLAUDE.md`, `regression-package-design.md`, and `ts-rewrite-dev-doc.md`. |
| `shopify-order-creator/ts/` | TypeScript rewrite of the regression harness with a CLI entry point, case runner, verification modules, and report generation. |

Standalone QA scripts can be added as sibling folders later.

## Current status

The TypeScript rewrite is now in a runnable scaffold state. The harness includes:

- a local CLI entry point under `shopify-order-creator/ts/src/cli.ts`
- a repo-root wrapper script at `shopify-order-creator/run-regression.sh`
- baseline case definitions for single, multi, unique, split, undeliverable, and partial-undeliverable flows
- explicit stages for inventory preparation, order creation, Shopify verification, allocation verification, and inventory-decrement checks
- report output written to `shopify-order-creator/ts/reports/`

The Python package under `shopify-order-creator/regression/` remains the executable reference spec while the TypeScript path is being brought up to parity.

## Run it locally

From the repository root:

```bash
./shopify-order-creator/run-regression.sh --help
./shopify-order-creator/run-regression.sh --store US --cases single --repeat 1 --report-dir ./reports
```

Or directly from the TypeScript project:

```bash
cd shopify-order-creator/ts
npm run build
node dist/index.js --store US --cases single --repeat 1 --report-dir ./reports
```

## Verification

The TypeScript project currently verifies the new inventory-decrement assertion logic with a lightweight offline test harness:

```bash
cd shopify-order-creator/ts
npm run build
node --test tests/verification.test.js
```

All tooling targets **staging only**.
