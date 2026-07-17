# QA

QA automation space for Universal Store / Perfect Stranger — tooling that places real test data and verifies it flowing through the full stack (Shopify → AWS → NewStore), replacing repetitive manual checks with repeatable, reportable runs.

**Owner:** JJ (james.johnston@universalstore.com.au)
**Tracking:** Jira project [TAA](https://universalstore.atlassian.net/jira/core/projects/TAA/board) · Docs: Confluence QD space → [QA Automation Tool](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1786970142/QA+Automation+Tool)

## Layout

| Folder | Contents |
| --- | --- |
| `shopify-order-creator/` | Order-creation CLI + (in progress, TAA-3) deterministic regression package for omni-channel alignment. See its `CLAUDE.md` and `regression-package-design.md`. |

Standalone QA scripts will be added as sibling folders.

## Status

Phase 0 (TAA-3): building the headless `/regression` baseline — order → allocation → shipments → inventory correctness across Shopify, AWS, and NewStore. The TypeScript rewrite (see `shopify-order-creator/scope-of-work-reworked.md`) uses this baseline as its parity spec.

All tooling targets **staging only**.
