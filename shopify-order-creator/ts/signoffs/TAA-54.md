# TAA-54 sign-off (2026-08-31) — hold lifecycle cases (TC7-12), orders subcommand

Plan: `ts/plans/TAA-54-plan.md`. Ticket: https://universalstore.atlassian.net/browse/TAA-54
(parent workstream TAA-49). Depends on TAA-52 (`verify/holds.ts`,
`verify/transactions.ts`), TAA-57 (`flows/holdFlow.ts`, `flows/editFlow.ts`) and
TAA-47 (`scripts/prepare-skus.js`) — all merged and closed before this ticket
started. Built and live-confirmed in an isolated git worktree after an
in-session collision with the parallel TAA-59 session over the shared main
worktree (see "Housekeeping" below) — no work was lost on either side.

## Build (slices A/B)

- **`verify/holds.ts`** gained `assertHoldTransactionCount`/
  `assertUnholdTransactionCount` — exact-count assertions over HOLD_ORDER/
  UNHOLD_ORDER rows matched on `onHoldChanges.added`/`.removed`, closing the
  gap TAA-52's dup-row finding (PS #3326, three HOLD_ORDER rows for one
  reason) exposed: `assertOnHold` only ever compares reason **sets**, so it
  cannot distinguish "one HOLD_ORDER row" from "three." TC9 needs exactly one
  per reason; TC12 needs presence for the released reason and absence
  (count 0) for the reason still held. Two new fixtures
  (`US-taa54-hold-multi-synth.json`, `US-taa54-hold-partial-release-synth.json`)
  synthesize the both-reasons/partial-release shapes from the real TAA-57
  round-trip fixtures' field shapes for offline coverage — superseded as
  *live* evidence by this ticket's own os_hold_multi/os_hold_partial_release
  live runs below, which produce the real thing.
- **New `orders` subcommand** (`cases/ordersCases.ts`, `ordersRunner.ts`,
  `cli-orders.ts`, one additive dispatch branch in `index.ts`) — six cases at
  fixed pool slots 18-23, one shared add-item SKU at slot 74 across the four
  edit-driven variants, same fixed-slot-not-positional pattern
  `newstoreCases.ts` already established for `ns_sfs`/`ns_otc`. Runs
  sequentially, no progress tracker (same reasoning `runner.ts`'s own
  `runNewStoreCase` already applies to NS cases) — deliberately does not
  touch `runner.ts`/`progress.ts`/`cli.ts`, which are TAA-59's territory this
  wave. Each case: place one order (`orderFlow.ts`'s `placeOrder`, reused
  as-is) → drive the hold(s) via `flows/holdFlow.ts` (each call already polls
  to its own settle predicate) → one fresh `getOrderRows` fetch → assert via
  `verify/holds.ts`/`verify/transactions.ts`.
- Offline: **477/477** green (456 baseline + 8 hold-assertion tests + 13
  orders-subcommand tests). `runner.ts`'s own orchestration isn't offline
  tested either (no `runner.test.js` exists) — `ordersRunner.ts` follows the
  same precedent, proven live below instead.

## Slice C — prepare-skus, both stores, all PASS

Ran `scripts/prepare-skus.js` over the 7 SKUs this ticket claims (slots
18-23 + 74) on both stores before placing any order:

| Slot | US SKU | US stock | PS SKU | PS stock |
| --- | --- | --- | --- | --- |
| 18 | 33820354 | 52 | 34011096 | 66 |
| 19 | 33939476 | 144 | 33973654 | 10 |
| 20 | 33809786 | 102 | 34010884 | 168 |
| 21 | 33816326 | 85 | 34026458 | 15 |
| 22 | 33996622 | 30 | 33734101 | 99 |
| 23 | 33999944 | 64 | 33917467 | 28 |
| 74 (add-item) | 33966472 | 82 | 33926148 | **3** |

7/7 PASS on both stores. **Note for whoever picks slot 74 up next on PS:**
real stock there is thin (3 units) and four of this ticket's six cases each
add one unit of it via the edit chain — a live run consumes it by attrition,
same class of note as the reject-cycle stock-attrition warning elsewhere in
CLAUDE.md. Not a blocker for this ticket: none of these cases assert
anything about the added item's allocation/inventory outcome (hold state is
payment-related, not fulfilment-related), so an added item resolving
UNDELIVERABLE once stock is thin would not fail a hold case — confirmed by
this session's own live run completing cleanly against exactly this stock
level.

## Slice D — live, both stores, all six PASS

**US** (`node dist/index.js orders --store US`) — 6/6 PASS:

| Case | Order | Settle times |
| --- | --- | --- |
| os_hold_fraud (TC7) | #10011 | apply_fraud_hold 69.3s |
| os_hold_outstanding (TC8) | #10019 | edit_settle 12.6s, apply_outstanding_hold 4.1s |
| os_hold_multi (TC9) | #10022 | apply_fraud_hold 67.2s, edit_settle 8.1s, apply_outstanding_hold 4.1s |
| os_hold_release_fraud (TC10) | #10024 | apply_fraud_hold 69.3s, release_fraud_hold 12.2s |
| os_hold_release_payment (TC11) | #10025 | edit_settle 10.6s, apply_outstanding_hold 2.0s, release_outstanding_hold 8.1s |
| os_hold_partial_release (TC12) | #10026 | apply_fraud_hold 65.2s, edit_settle 12.2s, apply_outstanding_hold 0.0s, release_fraud_hold 10.2s |

**PS** (`node dist/index.js orders --store PS`) — 6/6 PASS:

| Case | Order | Settle times |
| --- | --- | --- |
| os_hold_fraud (TC7) | #3343 | apply_fraud_hold 67.4s |
| os_hold_outstanding (TC8) | #3344 | edit_settle 8.6s, apply_outstanding_hold 0.0s |
| os_hold_multi (TC9) | #3345 | apply_fraud_hold 65.3s, edit_settle 6.1s, apply_outstanding_hold 2.0s |
| os_hold_release_fraud (TC10) | #3347 | apply_fraud_hold 65.5s, release_fraud_hold 8.1s |
| os_hold_release_payment (TC11) | #3348 | edit_settle 6.7s, apply_outstanding_hold 2.0s, release_outstanding_hold 8.1s |
| os_hold_partial_release (TC12) | #3349 | apply_fraud_hold 67.3s, edit_settle 8.1s, apply_outstanding_hold 0.0s, release_fraud_hold 10.2s |

(PS order numbering skips #3346 — a concurrent order from another session
sharing staging this session, not this ticket's; nothing to do with these
cases.)

**Default regression suite spot-checked unaffected:** `node dist/index.js
--store US --cases single` — PASS, unchanged from historical behaviour.
Confirms this ticket, despite adding a new subcommand, introduced no
regression to the untouched `runner.ts`/`cli.ts` path.

### Finding — fraud-hold apply settled consistently slower this session, still well inside the window

Every one of the 8 fraud-hold-apply calls across both stores this session
(4 per store: TC7, TC9, TC10, TC12) settled in **65.2-69.3s** — TAA-57's own
measurement was 12.7s (US) / 8.7s (PS), roughly 5-8x faster. This is
consistent across every sample this session (not one outlier), so it reads
as a real session-wide slowdown on the fraud-hold path specifically —
outstanding-payment timings (edit_settle, apply/release) all landed in the
same range TAA-57 measured (2-13s), so the slowdown is isolated to
`fulfillmentOrderHold`'s settle path, not a general staging slowdown. Still
comfortably inside the 120s `ordersService` window (a ~1.7x margin at the
observed max, versus the ~3x margin the window was originally sized against
TAA-53's 42s edit-chain figure) — no case failed or came close to timing
out. Per this project's standing practice (defer backend timing
observations, prioritize coverage — same posture as TAA-42/the PS `split`
inventory-decrement miss), **logged here for JJ's triage, not chased
further and not filed as a ticket**. If a future session sees fraud-hold
settle regularly exceed ~90-100s, that would be worth tightening the margin
or investigating; two clean 6/6 runs at 65-69s is not that yet.

## Not done, deliberately

No promotion of the orders suite into the default 12-case regression set
(explicitly a later decision per the ticket). No changes to
`runner.ts`/`progress.ts`/`cli.ts` (TAA-59's territory this wave) — confirmed
by diffing this branch against its `main` merge-base before every commit.

## Housekeeping — cross-session worktree collision, resolved mid-session

This session and the parallel TAA-59 session were both told to follow a plan
file that didn't exist yet, and both ended up driving the same shared main
`git` working directory (`/Users/james.johnston/Documents/GitHub/qa`) instead
of separate worktrees — the two per-session worktrees the environment meant
to provision (`qa-taa54`/`qa-taa59` sibling directories) were stale/broken
(dead `.git` pointers into a sandbox path that doesn't exist on this
machine). Slice A's first commit attempt there staged TAA-59's uncommitted
`config.ts`/`progress.ts`/`runner.ts`/`verify/orders.ts`/
`verify/transactions.ts` + test edits alongside this ticket's own — caught
before pushing anything, via `git status` review after a broad `git add -A`,
per this project's own "review what's included before committing" practice.

Resolved without losing anything on either side: reverted this ticket's two
touched files back to their committed state in the shared tree, removed this
ticket's untracked fixtures from there, switched the shared tree's `HEAD`
back to `taa-59-shipping-alignment` (restoring what TAA-59 had), and moved
this ticket's own work into a proper `git worktree` under this session's own
scratchpad — confirmed via a cross-session message exchange with the TAA-59
session, which confirmed no data was lost. All of this ticket's work from
slice A onward was built/tested/committed in that isolated worktree. No
findings above are affected by this — it's an environment/tooling note, not
a code or contract finding.
