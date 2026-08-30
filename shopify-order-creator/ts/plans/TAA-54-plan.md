# TAA-54 plan: hold lifecycle cases (TC7-12), opt-in orders subcommand

Written 2026-08-30. Baseline: branch `taa-54-hold-cases` @ `010f1fa` (identical to
`main`), working tree clean apart from untracked `.claude/`/`_to_delete/`, build
clean, **456/456** offline tests green.

Ticket: https://universalstore.atlassian.net/browse/TAA-54 (parent workstream TAA-49)
Depends on (both merged and closed): TAA-52 (`verify/holds.ts`, `verify/transactions.ts`),
TAA-57 (`flows/holdFlow.ts`, `flows/editFlow.ts`), TAA-47 (`scripts/prepare-skus.js`)
Parallel session on this repo: TAA-59 (`taa-59-shipping-alignment` branch) owns
`runner.ts`, `progress.ts`, `cli.ts` for this wave — **do not edit them**, which is
exactly why this ticket is its own subcommand rather than a third case kind inside
the existing runner.

## Goal in one sentence

Six hold-lifecycle cases (TC7-12) driven entirely by drivers/assertions that already
exist on `main`, wired as a new opt-in `orders` subcommand (own CLI, own runner, own
case file) that runs sequentially and leaves the default 12-case set untouched.

## Verified against the repo, 2026-08-30

- **Every driver exists, nothing to build in `flows/`:** `flows/holdFlow.ts` has
  `applyFraudHold` / `releaseFraudHold` (fulfillmentOrderHold/ReleaseHold, reason
  `POTENTIAL_FRAUD`) and `applyOutstandingPaymentHold` / `releaseOutstandingPaymentHold`
  (composes `editFlow.ts`'s `addItemToOrder` then `markAsPaid`, reason
  `OUTSTANDING_PAYMENT`). Both settle predicates (`holdApplied`/`holdReleased`) already
  require the two-part condition (ORDER row `onHold` + a matching HOLD_ORDER/UNHOLD_ORDER
  TRANSACTION# row) and are pure/offline-tested (`tests/holdFlow.test.js`, 263 lines).
- **`verify/holds.ts` has the record-level assertions** (`assertOnHold`,
  `assertNotOnHold`, `assertHoldReasonAbsent`) but **no transaction-count assertion** —
  confirmed by reading the file. TC9 and TC12 need one (see "New assertions needed"
  below); this is not new driver work, it's the verify-layer half of a check the
  ticket's own 2026-08-30 correction describes precisely.
- **`verify/transactions.ts` is general-purpose** (`assertTransactionPresent/Absent`
  take an optional matcher) but has no exact-count form — `assertTransactionPresent`
  is "at least one", not "exactly one". TC9's "exactly one HOLD_ORDER row per distinct
  reason" needs an exact count, same shape as `verify/rejects.ts`'s
  `assertRejectTransactions`, which already sets the exact-count precedent for a
  sibling table.
- **`flows/orderFlow.ts`'s `placeOrder`/`prepareInventory`** are the reusable
  order-creation primitives every baseline case already uses — reused as-is, no
  changes. Each hold case seeds/places its own order from its own pool slot; no
  inventory-seeding trickery needed (holds don't touch `staging-inventory-v2` at all,
  confirmed: neither `holdFlow.ts` nor `editFlow.ts` reference `DynamoClient`/inventory).
- **`readers/shopifyReader.ts`'s `orderIdTail(gid)`** gives the id tail directly from
  the gid `placeOrder` returns — no order-name lookup round trip needed (unlike
  `cli-fulfil.ts`, which resolves a user-supplied `--order` value; these cases create
  their own order and already have the gid).
- **Pool slots confirmed free and populated** (both stores at 80 slots since TAA-46):
  `sku(18)`-`sku(23)` and `sku(74)` resolve to real GIDs on both stores (checked via
  compiled `variants.js`, see table below). Nothing in `baselineCases.ts`,
  `newstoreCases.ts` or any merged branch claims these slots.
- **Fixtures already committed** from TAA-50/52/57 cover both reasons on both stores:
  `US-hold-fraud-9994.json`, `US-hold-outstanding-edit-9998.json`,
  `PS-taa57-hold-fraud-3331.json`, `PS-taa57-hold-outstanding-3332.json`,
  `PS-taa52-hold-outstanding-dup-3326.json` (the multi-HOLD_ORDER-row case),
  `US-taa57-hold-fraud-10007.json`, `US-taa57-hold-outstanding-10008.json`. No new
  fixtures needed for single-reason offline coverage; TC9/TC12 (both-reasons,
  partial-release) need their own captured fixtures per the ticket's checklist,
  since no committed fixture currently shows two simultaneous reasons plus a partial
  release.
- **`index.ts` dispatch is a flat if/else** on `argv[0]` (`order`, `fulfil`, else
  regression suite) — adding an `orders` branch is a 2-line, additive change with zero
  risk to the other two subcommands.
- **`scripts/prepare-skus.js`** takes `<US|PS> <input-file> [--emit-block]`, reads a
  plain-text one-SKU-per-line file or JSON, read-only. Used for the checklist's
  prepare-skus step.

### Pool slots this ticket claims

| Slot | US SKU | PS SKU | Role |
| --- | --- | --- | --- |
| 18 | 33820354 | 34011096 | TC7 `os_hold_fraud` base |
| 19 | 33939476 | 33973654 | TC8 `os_hold_outstanding` base |
| 20 | 33809786 | 34010884 | TC9 `os_hold_multi` base |
| 21 | 33816326 | 34026458 | TC10 `os_hold_release_fraud` base |
| 22 | 33996622 | 33734101 | TC11 `os_hold_release_payment` base |
| 23 | 33999944 | 33917467 | TC12 `os_hold_partial_release` base |
| 74 | 33966472 | 33926148 | add-item SKU, shared across TC8/9/11/12 (the four edit-driven cases) |
| 75, 76 | — | — | spare, unused by this ticket |

### New assertions needed — small, in `verify/holds.ts`, not a new module

TC9 ("exactly one HOLD_ORDER row per distinct reason") and TC12 ("an UNHOLD_ORDER row
naming the released reason plus the absence of one naming the still-held reason") both
need a transaction-count check keyed on `onHoldChanges.added`/`.removed`, which nothing
on `main` exposes yet. Two small pure functions, same file `verify/holds.ts` (the
natural home — it already owns hold-shaped assertions), same style as
`verify/rejects.ts`'s `assertRejectTransactions`:

```ts
assertHoldTransactionCount(transactions, reason, expectedCount, orderName)   // HOLD_ORDER rows naming reason in onHoldChanges.added
assertUnholdTransactionCount(transactions, reason, expectedCount, orderName) // UNHOLD_ORDER rows naming reason in onHoldChanges.removed
```

One function each, `expectedCount` covers both presence (`1`) and absence (`0`) —
TC7/TC8 call `assertHoldTransactionCount(reason, 1, ...)`, TC9 calls it twice (once per
reason), TC10/TC11 call `assertUnholdTransactionCount(reason, 1, ...)`, TC12 calls it
twice — once with `1` for the released reason, once with `0` for the still-held one.
`onHoldChangesFrom` is re-implemented locally in `verify/holds.ts` (reading
`TransactionRow.raw`), deliberately duplicating `holdFlow.ts`'s private helper of the
same shape — this project's established convention (see `holdFlow.ts`'s own doc
comment: "flows assert nothing, verify/** asserts... duplication is deliberate and
correct... sharing the check would couple two modules that need to stay independently
owned"). Read `holdFlow.ts:55-64` before writing it, don't diverge on the array shape.

This is the only code added outside the new subcommand's own files. It is NOT a new
driver (no new Shopify/Dynamo call), and it directly implements what the ticket's
2026-08-30 correction already specified in words — treat that correction as
superseding the "no new assertions" line in the ticket's original "out of scope"
section, which predates it.

## Design: the `orders` subcommand

Three new files, following `cli-fulfil.ts`'s shape (own `parseArgs`/`printHelp`/
`run*Cli`) and `runner.ts`'s `runNewStoreCase` shape (sequential loop, per-stage
console timing) without touching either file:

- `src/cases/ordersCases.ts` — six `OrdersCaseDefinition`s (name, description, base
  SKU, `variant: "fraud" | "outstanding" | "multi" | "release_fraud" |
  "release_payment" | "partial_release"`), built from `skuPoolFor(store)` at fixed
  slots 18-23 + 74, same fixed-slot pattern `newstoreCases.ts` already uses for
  14/15 (never positional, so a future pool change can't move these either).
- `src/ordersRunner.ts` — `runOrdersCase(config, caseDef)`, one case at a time:
  place order (`orderFlow.ts:placeOrder`) → drive the hold(s) via `holdFlow.ts` →
  one fresh `reader.getOrderRows` fetch → assert via `verify/holds.ts` +
  `verify/transactions.ts` (matcher-based, for the ADD_ITEM check). Own tiny
  `pollVerify`-equivalent (a few lines, `pollUntil` + catch `VerificationError`) since
  `runner.ts`'s is private and unexported — do not attempt to import it.
  `runOrdersCli(argv)` runs the six sequentially (or a `--cases` subset), prints a
  per-case settle-time summary, non-zero exit on any failure — no report file, no
  progress tracker (this project's progress/ETA machinery is `runner.ts`/`progress.ts`
  territory this wave, and a 6-case sequential run doesn't need it — same reasoning
  `runNewStoreCase` already applies to NS cases, which also skip the tracker).
- `src/cli-orders.ts` — `--store`, `--cases <name,...>`, `--help`, following
  `cli-fulfil.ts`'s parse/print shape exactly.
- `index.ts` gains one `else if (argv[0] === "orders")` branch, alongside the existing
  `order`/`fulfil` branches. This is the only edit to a file this ticket doesn't own
  outright, and it's additive/non-conflicting with TAA-59's `runner.ts`/`progress.ts`/
  `cli.ts` work.

### Per-case logic (all six reuse the same handful of primitives)

| Case | Drives | Asserts |
| --- | --- | --- |
| `os_hold_fraud` (TC7) | `applyFraudHold` | `assertOnHold([POTENTIAL_FRAUD])`, `assertHoldTransactionCount(POTENTIAL_FRAUD, 1)` |
| `os_hold_outstanding` (TC8) | `applyOutstandingPaymentHold` (add item at slot 74) | `assertOnHold([OUTSTANDING_PAYMENT])`, `assertHoldTransactionCount(OUTSTANDING_PAYMENT, 1)`, `assertTransactionPresent(..., "ADD_ITEM", ..., matcher on added sku)` |
| `os_hold_multi` (TC9) | both `applyFraudHold` and `applyOutstandingPaymentHold` (add item at slot 74) | `assertOnHold([POTENTIAL_FRAUD, OUTSTANDING_PAYMENT])`, `assertHoldTransactionCount` once per reason, each `=== 1` |
| `os_hold_release_fraud` (TC10) | `applyFraudHold` then `releaseFraudHold` | `assertHoldReasonAbsent(POTENTIAL_FRAUD)`, `assertUnholdTransactionCount(POTENTIAL_FRAUD, 1)` |
| `os_hold_release_payment` (TC11) | `applyOutstandingPaymentHold` then `releaseOutstandingPaymentHold` (markAsPaid) | `assertHoldReasonAbsent(OUTSTANDING_PAYMENT)`, `assertUnholdTransactionCount(OUTSTANDING_PAYMENT, 1)` |
| `os_hold_partial_release` (TC12) | both holds (as TC9), then `releaseFraudHold` only | `assertOnHold([OUTSTANDING_PAYMENT])` (fraud gone, outstanding remains), `assertUnholdTransactionCount(POTENTIAL_FRAUD, 1)`, `assertUnholdTransactionCount(OUTSTANDING_PAYMENT, 0)` |

Releasing fraud (not payment) in TC12 is an arbitrary but fixed choice — either
direction proves the same "partial release" contract; fraud-then-payment keeps the
release call identical to TC10's, reusing the same driver call shape.

### Settle-time expectations (from TAA-57's live numbers, informs nothing structural —
just what "reasonable" looks like when live-confirming)

Fraud apply/release ~9-13s (US) / ~6-9s (PS); outstanding apply ~2-4s, release ~6-8s;
the preceding edit ~7-13s. TC9/TC12 (two holds on one order) should sit in the same
range per operation, run sequentially, not added together into one bigger window —
each `holdFlow.ts` call has its own `ORDERS_SERVICE_SETTLE_WINDOW_SECONDS` (120s)
independently.

## Slices

| Slice | Done when | Owns |
| --- | --- | --- |
| A | `verify/holds.ts` gains the two count assertions, offline-tested against existing + two new fixtures (both-reasons, partial-release), build+test green | `verify/holds.ts`, `tests/holds.test.js`, two new fixtures |
| B | All six cases defined and runnable end to end through the new subcommand against a fake/mocked reader+admin (offline), `--help`/`--list-cases`-equivalent output present | `cases/ordersCases.ts`, `ordersRunner.ts`, `cli-orders.ts`, `index.ts`, matching `tests/*.test.js` |
| C | `prepare-skus` run over slots 18-23 + 74 on both stores, all PASS | none (verification only) |
| D | All six cases green live on both stores from one CLI invocation each, every settle time recorded | `ts/signoffs/TAA-54.md` |
| E | CLAUDE.md dated entry, ticket checklist proposed complete (transition left to JJ) | `CLAUDE.md` |

Not sliced further than this — six cases sharing four primitives is not enough
distinct risk surface to justify per-case branches the way TAA-46's four genuinely
independent slices needed.

---

## Slice A: verify-layer transaction-count assertions

Branch: work directly on `taa-54-hold-cases` (no need for a sub-branch — this whole
ticket is already isolated on its own branch)

Add `assertHoldTransactionCount`/`assertUnholdTransactionCount` to `verify/holds.ts` as
specified above. Capture two new fixtures before writing the both-reasons/
partial-release tests:

- A live order carrying **both** `POTENTIAL_FRAUD` and `OUTSTANDING_PAYMENT` in
  `onHold` simultaneously, each from exactly one HOLD_ORDER row (TC9's shape). Can be
  synthesized by hand from the existing single-reason fixtures if a live capture isn't
  taken this slice — but a real one is stronger evidence and cheap (one order, two
  admin mutations, no cleanup needed since holds don't consume stock).
- A live order with one reason released and one remaining (TC12's shape) — same
  order as above, plus one release call.

### Checklist

- [ ] `assertHoldTransactionCount`/`assertUnholdTransactionCount` added to `verify/holds.ts`
- [ ] Local `onHoldChangesFrom` duplicated (not imported) from `holdFlow.ts`'s shape
- [ ] Two new fixtures captured (both-reasons; partial-release) or synthesized with the reason stated
- [ ] `tests/holds.test.js` covers both new functions: exact match, count too low, count too high (dup-row fixture `PS-taa52-hold-outstanding-dup-3326.json` is the natural "count too high" case — 3 rows, not 1)
- [ ] `npm run build` + `npm test` green

---

## Slice B: the `orders` subcommand, offline

Build `cases/ordersCases.ts`, `ordersRunner.ts`, `cli-orders.ts`, wire `index.ts`.
Every network-touching dependency (`ShopifyAdminClient`, `DynamoReader`,
`FulfillmentOrderResolver`) is already interface-shaped for fakes in the existing
`holdFlow.test.js`/`editFlow.test.js` — reuse those fake shapes rather than inventing
new ones.

### Checklist

- [ ] `cases/ordersCases.ts`: six case definitions at fixed slots 18-23 + 74, same
      fixed-slot-not-positional pattern as `newstoreCases.ts`
- [ ] `ordersRunner.ts`: `runOrdersCase` (one case, per-stage console timing same
      style as `runNewStoreCase`), local `pollVerify`-equivalent, `runOrdersCli`
      (sequential loop, `--cases` filter, non-zero exit on failure)
- [ ] `cli-orders.ts`: `--store`, `--cases`, `--help`, matching `cli-fulfil.ts`'s
      parse/print shape
- [ ] `index.ts`: additive `orders` dispatch branch
- [ ] Offline tests for all new pure logic (arg parsing, case-list building) using
      fakes, no real network
- [ ] `npm run build` + `npm test` green, count noted (baseline 456 + N)
- [ ] `--help`-equivalent output for the new subcommand lists all six cases by name

---

## Slice C: prepare-skus check

Read-only. Build a small input file (or reuse `sku-lists/<store>-skus.json` filtered)
naming the 7 SKUs at slots 18-23 + 74 per store, run
`node scripts/prepare-skus.js <US|PS> <file>`, confirm PASS for all 7 on both stores
before placing any order. If anything FAILs, that's a finding to record, not a reason
to silently swap slots — these are already-committed pool slots from TAA-46, a FAIL
here would itself be surprising and worth flagging to JJ.

### Checklist

- [ ] All 7 SKUs (18-23, 74) PASS on US
- [ ] All 7 SKUs (18-23, 74) PASS on PS

---

## Slice D: live confirm, both stores

One CLI invocation per store running all six cases. Record every settle time (each
`applyX`/`releaseX` call's `settledElapsedSeconds`, already returned by every
`holdFlow.ts` function — just print and transcribe them, no new instrumentation
needed).

### Checklist

- [ ] `node dist/index.js orders --store US` — all six PASS, settle times recorded
- [ ] `node dist/index.js orders --store PS` — all six PASS, settle times recorded
- [ ] Default 12-case regression set still green (spot-check `--cases single` or the
      full set, confirming this ticket introduced no regression to `runner.ts`'s
      existing path — it shouldn't, since `runner.ts` isn't touched, but confirm
      rather than assume)
- [ ] Evidence written to `ts/signoffs/TAA-54.md`: order numbers, settle times per
      case per store, any anomaly (e.g. a recurrence of TAA-50's intermittent
      unpaid-creation gap — shouldn't apply here since these cases use the edit
      route exclusively, but note if anything unexpected shows up)

---

## Slice E: docs and wrap-up

### Checklist

- [ ] CLAUDE.md dated entry: subcommand added, six cases, both stores green, settle
      times, default set unaffected
- [ ] Ticket checklist items ticked in the description as proposed-met; status
      transition left to JJ, not applied
- [ ] `npm run build` + `npm test` green at final commit

Deliberately not doing: promoting the orders suite into the default set (explicitly a
later decision per the ticket), any new drivers/flows, any edit to
`runner.ts`/`progress.ts`/`cli.ts` (TAA-59's territory this wave).
