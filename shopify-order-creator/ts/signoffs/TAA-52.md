# TAA-52 sign-off (2026-08-30) — assertion layer over orders-service reads

Ticket: https://universalstore.atlassian.net/browse/TAA-52. Branch
`taa-52-verify-orders-service`, cut from `main` @ `1ed9ac6` (369/369 offline
green). Owned files only: NEW `src/verify/holds.ts`, `finalisation.ts`,
`transactions.ts`; additive `src/verify/orders.ts` and `src/verify/index.ts`;
NEW `tests/holds.test.js`, `finalisation.test.js`, `transactions.test.js`;
additive `tests/orders.test.js`; two NEW fixtures under
`ts/fixtures/orders-v2/`; one throwaway probe script
(`ts/scripts/probe-taa52-verify.js`, hand-run, not wired into
cli.ts/index.ts/--help, same posture as `probe-admin-mutations.js`). No
edits to `src/flows/**`, `src/config.ts`, `src/cli-order.ts`,
`src/clients/shopify.ts`, `src/readers/**`, `src/clients/shopifyAdmin.ts`,
`src/cases/**`.

## Shared-working-directory hazard hit and worked around

This session's shell operates on `/Users/james.johnston/Documents/GitHub/qa`
directly rather than a per-lane worktree, and all four wave-3 branches
(`taa-47-prepare-skus`, `taa-52-verify-orders-service`,
`taa-57-admin-flows`, `taa-68-pickup-delivery-fix`) exist in that single
checkout. Partway through this session another lane's uncommitted,
mid-edit `src/cli-order.ts` had a live TypeScript error, which broke
`npm run build` for the whole project — not caused by anything in this
ticket's owned files, but blocking regardless since `tsc` compiles the
whole `src/` tree. Running the build once, before noticing, also
recompiled that lane's in-progress source into the shared, git-tracked
`dist/` output.

Recovery, in order: reverted the accidental `dist/` recompilation
(`git checkout HEAD -- dist/`) and this ticket's own edits in the shared
directory back to clean HEAD; added a git worktree
(`git worktree add ../qa-taa52 taa-52-verify-orders-service`, after
`git checkout main` in the shared directory since a branch can't be
checked out in two worktrees at once — safe here, a no-op on working-tree
content, since none of the four branches carry any commits beyond `main`
yet); copied this ticket's files into the new worktree; symlinked
`node_modules` in rather than reinstalling. All work from that point on —
every build, every test run, every live call, this sign-off — happened
in `/Users/james.johnston/Documents/GitHub/qa-taa52`, isolated from the
other three lanes' concurrent edits. The shared directory was left exactly
as the other three sessions had it, minus this ticket's own footprint.
Flagging this loudly for JJ: a per-lane worktree from the start would have
avoided the hazard entirely; nothing else in this ticket touches shared
state, but a future parallel-wave session should not assume the shared
checkout is safe to build/test in directly.

## Structure decision — NOT re-exported through verify/index.ts

`holds.ts`/`finalisation.ts`/`transactions.ts` are imported directly by
callers (`from "./verify/holds"` etc.), the same convention as
`orders.ts`/`shipments.ts`, not re-exported via `index.ts` the way
`fulfilment`/`allocation`/`rejects` are. Reasoning, recorded in `index.ts`
itself: every existing consumer (`runner.ts`, every `*.test.js`) already
imports every verify module directly regardless of what `index.ts`
re-exports, so the re-exports there are unused by any current caller.
Keeping the three new orders-v2-read modules consistent with `orders.ts`/
`shipments.ts` (also read-based, not result-of-an-action) was the more
honest grouping.

## Field-reality findings beyond the ticket's four corrections

The ticket named four known drifts (no `finalPrice`; `clickCollectStore`
vs `ccStore`; `paymentMethod` singular; `onHold` string values). Building
and live-testing this ticket's assertions surfaced three more, all now
captured as fixtures or fixed in code:

**1. `onHold` is an accumulating log, not a deduplicated set.** PS **#3326**
(`PS-taa52-hold-outstanding-dup-3326.json`, captured this ticket) shows
`onHold: ["OUTSTANDING_PAYMENT", "OUTSTANDING_PAYMENT", "OUTSTANDING_PAYMENT"]`
— three separate `HOLD_ORDER` transaction rows, each appending the same
reason string with no dedup on the backend's side (raw fixture: a
`REFUND_ORDER_UNTARGETED` at `+62s` after creation, then three `HOLD_ORDER`
rows at `+64s`/`+67s`/`+68s`, all carrying `onHoldChanges.added:
["OUTSTANDING_PAYMENT"]`). `assertOnHold` was written first against an
exact-array-equality comparison (both existing US fixtures happen to carry
single-entry arrays) and would have failed a semantically-correct
assertion against this real order. Fixed before commit:
`assertOnHold` now compares **unique** reason sets on both sides. Live
re-confirmed: `assertOnHold(record, ["OUTSTANDING_PAYMENT"], "#3326")`
passes against the live 3-entry array.

**2. `assertPaymentsSumToGrandTotal` legitimately throws on an
`OUTSTANDING_PAYMENT`-held order — this is correct, not a bug.** Live run
against US **#9998** (already held for `OUTSTANDING_PAYMENT`, existing
TAA-50 fixture): `grandTotal` 119 vs `paymentMethod` summing to 70. The
mismatch is not a defect in the assertion; it's the identical underlying
fact the hold itself reports (the edit added an unpaid item). Documented
in the function's doc comment and pinned as a real (not synthetic) throw
test in `orders.test.js`. A caller wanting a "fully paid" invariant should
pair this with `assertNotOnHold`/`assertHoldReasonAbsent(OUTSTANDING_PAYMENT)`
first.

**3. `ORDER.status` genuinely transitions away from `OPEN`, to
`FULFILLED`** — see the finalisation finding below; this is the headline
finding of the ticket.

## THE ONE REAL RISK, resolved — finalisation is a status transition, not a transaction event

The ticket flagged `assertFinalisedExactlyOnce` as having no observed event
name, and offered two acceptable outcomes: capture the event by placing and
fully fulfilling a fresh order (burning a shipment), or leave it unpinned
and parameterized, deferred to TAA-33. **Neither was needed.** Re-reading
already-committed evidence more carefully found the real signal without
placing any new order:

- **US #9929, #9932, #9935** — TAA-37's own already-committed fulfilment
  fixtures. Every one of them shows `ORDER.status: "FULFILLED"` on the
  ORDER row (not `OPEN`), confirmed via a one-line check
  (`rows.find(r => r.SK === "ORDER").status`) against files that had been
  sitting in the repo since TAA-37, unexamined for this field.
- **PS #3329** (new capture, `PS-taa52-finalised-3329.json`) — a
  single-item digital gift-card order that auto-fulfils on creation.
  `ORDER.status: "FULFILLED"`, confirmed both via the fixture and via a
  fresh live `DynamoReader.getOrderRecord`/`getOrderTransactions` call
  before writing `finalisation.ts`.

**In all four, the TRANSACTION# log holds ONLY the original `CREATE_ORDER`
row** — no second transaction of any event name, spelling, or category ever
appears. This directly falsifies the premise that finalisation is
event-shaped at all on `staging-orders-v2`, at least for every order shape
observed to date (three via the real fulfil path, one via automatic digital
fulfilment). `finalisation.ts` is built entirely around
`ORDER.status === "FULFILLED"` — `assertOrderStatus` (generic),
`assertNotFinalised`, `assertFinalisedExactlyOnce` all take `OrderRecord |
null`, not `TransactionRow[]`. This is also the more correct shape
independent of the finding: a status equality check is a POSITIVE terminal
condition, the same rule this project's settle predicates already follow
(the CLAUDE.md note about order #9949 falsely settling on "nothing changed
for N ticks").

**Not fully closed — flagging for TAA-33, not chased further.** All four
observed orders finalise via a single item reaching a terminal state
(fulfilled or auto-fulfilled) with no edits, no partial fulfilment, no
refund-driven undeliverable path. TAA-33's brief also names
"undeliverable and refunded" as a second finalisation route — unobserved
here, and this ticket did not place or refund an order to check whether
that route also lands on `ORDER.status === "FULFILLED"` or something else
(e.g. `"REFUNDED"`, `"CLOSED"`, unobserved). If TAA-33 ever finds a
transaction-shaped signal on that second route, `assertOrderStatus` (the
generic one) already covers whatever status value it turns out to be —
only `assertNotFinalised`/`assertFinalisedExactlyOnce`'s hardcoded
`FULFILLED` comparison would need widening.

## Live confirmation — both stores, six already-burned orders, no fresh order placed

Per the ticket's stated preference, read already-burned orders rather than
placing new ones — every state needed was already present in the US
65-68/PS 3323-3329 range. **No new orders placed; pool untouched.**

Throwaway probe: `ts/scripts/probe-taa52-verify.js` (`resolve` / `dump` /
`verify-good` / `verify-broken` actions), reusing `ShopifyClient`,
`DynamoClient`, `DynamoReader` exactly as `probe-admin-mutations.js` does.

**Known-good, all PASS, both stores:**

| Order | Store | State | Checks run |
| --- | --- | --- | --- |
| #9994 | US | `POTENTIAL_FRAUD` hold | hold, payments, addresses, item delivery, status, not-finalised, transaction present/order |
| #9998 | US | `OUTSTANDING_PAYMENT` hold, 2 items | hold, addresses, item delivery, status, not-finalised, transaction present/order (payments-sum deliberately skipped — see finding 2) |
| #9997 | US | click & collect | not-on-hold, payments, addresses, item delivery, status, not-finalised, transaction present/order |
| #3323 | PS | plain, unheld | not-on-hold, payments, addresses, item delivery, status, not-finalised, transaction present/order |
| #3326 | PS | `OUTSTANDING_PAYMENT` hold, 3x duplicate reason | hold (dedup-tolerant), addresses, item delivery, status, not-finalised, transaction present/order |
| #3329 | PS | FULFILLED (digital gift card) | not-on-hold, payments, addresses, item delivery, status, **finalised-exactly-once**, transaction present/order |

**Deliberately broken, all fail with a clear expected-vs-actual, both
stores, across every new module:**

| Store | Order | Check broken | expected | actual |
| --- | --- | --- | --- | --- |
| US | #9994 | `assertOnHold` wrong reason | `["OUTSTANDING_PAYMENT"]` | `["POTENTIAL_FRAUD"]` |
| US | #9994 | `assertOrderStatus` wrong status | `"FULFILLED"` | `"OPEN"` |
| US | #9994 | `assertPaymentsSumToGrandTotal` off-by-one | `61` | `60` |
| US | #9997 | `assertFinalisedExactlyOnce` on an OPEN order | `"FULFILLED"` | `"OPEN"` |
| US | #9994 | `assertTransactionPresent` for an absent event | "at least one CLOSE_ORDER transaction" | "0 found (0 CLOSE_ORDER row(s) total...)" |
| PS | #3326 | `assertOnHold` wrong reason (against the dup-reason record) | `["POTENTIAL_FRAUD"]` | `["OUTSTANDING_PAYMENT"]` |
| PS | #3323 | `assertOrderStatus` wrong status | `"FULFILLED"` | `"OPEN"` |
| PS | #3329 | `assertOrderStatus` wrong status (already FULFILLED) | `"OPEN"` | `"FULFILLED"` |
| PS | #3323 | `assertPaymentsSumToGrandTotal` off-by-one | `41` | `40` |
| PS | #3323 | `assertFinalisedExactlyOnce` on an OPEN order | `"FULFILLED"` | `"OPEN"` |
| PS | #3326 | `assertTransactionOrder` wrong sequence | `["HOLD_ORDER","CREATE_ORDER"]` | `["CREATE_ORDER","REFUND_ORDER_UNTARGETED","HOLD_ORDER","HOLD_ORDER","HOLD_ORDER"]` |

## Checklist against the ticket

- [x] `verify/holds.ts`: `assertOnHold` (dedup-tolerant reasons),
  `assertNotOnHold`, `assertHoldReasonAbsent`.
- [x] `verify/finalisation.ts`: `assertOrderStatus`, `assertNotFinalised`,
  `assertFinalisedExactlyOnce` — pinned to a captured signal
  (`ORDER.status === "FULFILLED"`), not an unpinned event name; supersedes
  both outcomes the ticket offered.
- [x] `verify/transactions.ts`: `assertTransactionPresent`/
  `assertTransactionAbsent` with an optional matcher, `assertTransactionOrder`
  for sequences, all pinned to committed fixtures.
- [x] `verify/orders.ts` extensions: `assertPaymentsSumToGrandTotal`,
  `assertBothAddressesPresent`, `assertItemDelivery` (deliveryMethod +
  clickCollectStore).
- [x] New check names chosen deliberately, all `orders_table.*`-namespaced,
  no collision with `orders_table.items` (existing) or with each other:
  `on_hold`, `not_on_hold`, `hold_reason_absent`, `status`, `not_finalised`,
  `finalised_exactly_once`, `transaction_present`, `transaction_absent`,
  `transaction_order`, `payments_sum`, `addresses_present`,
  `item_delivery_method`, `item_click_collect_store`, plus the shared
  `exists` (null-record) check reused by `holds.ts`/`finalisation.ts`.
- [x] Offline tests fixture-driven throughout (existing TAA-48/50 fixtures
  plus the two new ones this ticket captured); `npm run build` + `npm test`
  green: **407/407** (369 baseline + 38 new).
- [x] LIVE: a deliberately broken expectation fails with expected-vs-actual
  on both stores (eleven separate breaks shown above, across every new
  module) — every assertion also passes on known-good orders on both
  stores (six orders, both stores, every state the ticket named).

## Not done, deliberately

No `flows/**`, `config.ts`, or `cases/**` changes — out of scope, owned by
TAA-57/a later wave. No new SKU-pool orders placed (every state needed
already existed among already-burned orders). No chase of TAA-33's
undeliverable-and-refunded finalisation route — flagged above, not this
ticket's job to resolve. `cli.ts`'s `--help`/`--list-cases` untouched — this
ticket adds no flags or cases.
