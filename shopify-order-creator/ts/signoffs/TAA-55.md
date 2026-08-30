# TAA-55 sign-off (2026-08-30) — `clients/shopifyAdmin.ts`, all six mutation families live on both stores

Branch `taa-55-admin-client`, cut from `main` @ `2df9b6a` in its own git
worktree (`../qa-taa-55`) rather than the shared primary worktree, which was
checked out on another lane's branch (`taa-50-order-address-reads`, 0 commits
ahead of main, no uncommitted changes) when this session started — creating a
separate worktree avoided disturbing that concurrent session. Not merged, not
pushed, per the ground rules.

Read `ts/signoffs/TAA-53-probe.md` and `ts/scripts/probe-admin-mutations.js`
(both read-only, TAA-53's committed evidence) in full before writing anything.
Every mutation shape below is copied from those two files. No further
introspection was needed for the mutations themselves — one extra live
introspection check was done for the reader extension (see below).

## What was built

**`src/clients/shopifyAdmin.ts` (new).** `ShopifyAdminClient` composes an
existing `ShopifyClient` (constructor takes an instance, no module-global
state) and exposes:

- Edit chain: `beginEdit`, `editAddVariant`, `editSetQuantity`,
  `editAddDiscount`, `commitEdit`
- `createRefund(orderId, lineItems?, untargetedAmount?)` — omitting
  `lineItems` is the untargeted form
- `holdFulfillmentOrder`, `releaseHold`, `moveFulfillmentOrder`
- `createReturn`, `closeReturn`, `markAsPaid`

Every op checks `userErrors` and throws with no fallback id when a required
node is missing — no silent success on a malformed response.

**`src/readers/shopifyReader.ts` (extended, not a new reader — same file).**
Three additive changes, all backward compatible (no existing consumer reads
a fewer-fields shape, TS structural typing confirmed by full green build):

1. `fulfillmentOrders` added to `ORDER_QUERY`/`ShopifyOrderSnapshot`, per the
   ticket. **Checked whether it's a connection or a plain list like
   `fulfillments` before writing the selection set, via live introspection
   against `Order`/`FulfillmentOrder` on 2025-10** (not assumed from the
   probe's dump query, which already used `edges`/`node` but was never itself
   introspection-checked for this specific field): confirmed
   `fulfillmentOrders: FulfillmentOrderConnection!` — a real connection,
   unlike `fulfillments: [Fulfillment!]!`. Selection set uses `edges { node
   { id status fulfillmentHolds { id reason reasonNotes } } }` accordingly.
2. **`ShopifyLineItem.id` added** — the real `LineItem` GID
   `createRefund`'s targeted form needs for `RefundLineItem.lineItemId`.
   Without it, nothing could ever call `createRefund`'s primary form against
   real order data; the ticket's extension text only named
   `fulfillmentOrders`, but this is the same "additive widening" precedent
   (TAA-48's `TransactionRow`) applied to make this ticket's own deliverable
   actually usable. **Saying this loudly per the ground rules**, since it's
   beyond the literally-specified extension.
3. **`ShopifyFulfilmentLineItem.id` added**, same reasoning, for
   `createReturn`'s `ReturnLineItemInput.fulfillmentLineItemId`.

**`tests/shopifyAdmin.test.js` (new), 21 tests.** Follows
`tests/fulfilment.test.js`/`tests/reject.test.js`'s precedent: mocks
`global.fetch`, pins every mutation's exact variables shape 1:1, and the
typed-result mapping. Covers all twelve methods, `userErrors`-throws for two
representative shapes (plain and `code`-carrying), missing-critical-node
throws (no fallback id), `createRefund`'s two-request untargeted path (SALE
transaction lookup, then the mutation, in that order, zero requests if
`untargetedAmount` is missing), and two `getOrder()` tests proving the
`fulfillmentOrders` extension parses real and empty holds without crashing.

No edits to `src/clients/shopify.ts` were needed — `ShopifyAdminClient.exec()`
calls the existing public `ShopifyClient.execute<T>()` the same way
`readers/shopifyReader.ts` already does; no export needed widening.

## Decisions made deliberately, per the ticket's explicit asks

**Host protection: none added, and none is missing.** `FulfilmentClient`/
`RejectClient` guard their constructors against a non-staging host because
they take an arbitrary `baseUrl` from env. `ShopifyClient` takes only a
`Store` ("US"|"PS") and hardcodes both endpoints to their staging hosts
inside `getEndpoint()` (`clients/shopify.ts:355-359`) — read directly to
confirm. There is no non-staging host reachable through this construction
path at all, so a guard in `ShopifyAdminClient` would check a condition that
cannot occur. Correcting the ticket's claim: `ShopifyClient.execute()` does
**not** carry an inherited host guard either — verified by reading
`getEndpoint()`, which is a hardcoded per-store switch, nothing more.

**`refundCreate` retry/double-refund risk: not defended against beyond what
`ShopifyClient` already does, deliberately.** `RefundInput` has no
idempotency field (TAA-53), and the probe confirmed a repeated
`Idempotency-Key` header doesn't dedupe either — nothing at the API layer
protects a genuine duplicate call. But `ShopifyClient.execute()`'s retry
fires only on two signals, HTTP 429 and GraphQL `THROTTLED`, and both are
Shopify's documented cost-based throttle rejecting a request **before** it
executes (the calculated query cost exceeds the available bucket, so the
mutation never runs). A retry under this mechanism therefore only ever
re-attempts a call that never ran — it cannot double-execute. This reasoning
rests on Shopify's documented throttle model, not something this session
re-proved for retries specifically (the probe tested the idempotency-key
header, a related but different question). No client-side lock or dedup
cache was added on top of that reasoning — that would be module-global state
guarding against a failure mode the throttle model's own documentation says
can't happen at this layer. The real double-refund risk is a **caller**
re-invoking `createRefund` after an ordinary network timeout uncorrelated
with `THROTTLED` — that belongs to whoever calls this client repeatedly
(TAA-57's flows), not to this client. Full reasoning is in the file's class
doc comment, not just here.

**`EditDiscountInput` only exposes the `fixedValue` form.** The probe only
live-confirmed `fixedValue`; `percentValue` (a real alternative in Shopify's
schema shape for discount inputs elsewhere) was never exercised. Not exposed
until it has been — avoids inventing an unverified shape.

**`RefundLineItem.restockType` typed as a plain `string`, not a union.** Only
`"NO_RESTOCK"` was live-confirmed (default when omitted, matching the
probe); the full `RestockType` enum has other legal values never tested
here, so the type doesn't pretend to enumerate them.

## Live findings

**All six mutation families fired successfully on both stores**, exercised
through the new client (not the probe) via a throwaway, uncommitted script
(same precedent as TAA-46/53's own throwaway introspection scripts) — not
committed, not part of the deliverable. Every op returned a real Shopify
identifier with no `userErrors`.

**`createRefund`'s targeted form (`refundLineItems` only, matching the
probe's exact confirmed input shape) does not move money** — confirmed live
on both stores. US order **#10000** (SKU `34011560`, $30 unit price):
`refundCreate` succeeded, refund id returned, refund line item recorded
against the order (`getOrder()` shows it in `refunds[0].items`), but
`totalRefundedSet` came back **$0**. PS order **#3325** reproduced the
identical $0 result. This is not a bug in this client — it sends exactly the
shape the probe proved works (`refundLineItems: [{lineItemId, quantity,
restockType}]`, no `transactions` entry) — but it means a targeted refund
built this way tracks/restocks the line item without actually refunding
money. The untargeted form (which explicitly builds a `transactions` entry
referencing the SALE transaction) did move real money both times ($1.00
each, US order #10001 and PS order #3326). **Not chased further here** — per
the ticket's own instruction that this session's job is "the mutations fire
and return identifiers," not case design — but flagged prominently for
whoever builds the refund test cases (TAA-56): a targeted refund that needs
to actually move money likely needs an accompanying `transactions` entry
alongside `refundLineItems`, the same way the untargeted form already does.
Not tested here since it would deviate from the probe's exact confirmed
input and this ticket doesn't own case design.

**`fulfillmentOrderMove` — the first candidate location predictably fails,
same texture as TAA-53's own finding.** Both live runs tried "All Stores -
DO NOT USE" first (the first result from `fetchPickupLocations()`) and got a
real Shopify `userError` ("None of the items are stocked at the new
location"), then succeeded against "Default Holding Location - DO NOT USE".
Confirms `moveFulfillmentOrder` throws correctly on a real userError rather
than swallowing it, and that picking a stock-movable target is a genuine
per-attempt concern for any caller (TAA-57), not something this client can
paper over.

## Orders burned (pool slots 69-73 only, both stores)

| Store | Order | Slot(s) | SKU(s) | Purpose |
| --- | --- | --- | --- | --- |
| US | #9999 | 69, 70 | `33973654` x2, `33990880` x1 (added) | Edit chain |
| US | #10000 | 71 | `34011560` x2 | Targeted refund ($0 finding above) |
| US | #10001 | 72 | `33715162` x1 | Untargeted refund ($1.00, real money moved) |
| US | #10002 | 73 | `33477190` x1 | Hold → release → move |
| US | #10003 | 69 | `33973654` x1 | Return create + close (Shopify-side fulfil via probe's `fulfil-for-return` first) |
| US | #10004 | 70 | `33990880` x1 | `orderCreate(PENDING)` via probe's `create-pending` (per the ticket's explicit instruction — not adopted as a second creation path) → `markAsPaid` |
| PS | #3324 | 69, 70 | `33933474` x2, `33925707` x1 (added) | Edit chain |
| PS | #3325 | 71 | `33925714` x2 | Targeted refund ($0 finding above) |
| PS | #3326 | 72 | `32769609` x1 | Untargeted refund ($1.00, real money moved) |
| PS | #3327 | 73 | `33949598` x1 | Hold → release → move |
| PS | #3328 | 69 | `33933474` x1 | Return create + close |
| PS | #3329 | 70 | `33925707` x1 | `orderCreate(PENDING)` → `markAsPaid` |

12 orders total, 6 per store, all within slots 69-73 as instructed. No slot
outside 69-73 was touched.

## Checklist

- [x] `beginEdit`, `editAddVariant`, `editSetQuantity`, `editAddDiscount`,
      `commitEdit` — built, tested, live-confirmed both stores
- [x] `createRefund(orderId, lineItems?)` — targeted and untargeted both
      built, tested, live-confirmed both stores; retry/double-refund risk
      decided and stated above
- [x] `holdFulfillmentOrder`, `releaseHold`, `moveFulfillmentOrder` — built,
      tested, live-confirmed both stores, real `FulfillmentHoldReason` enum
      used
- [x] `createReturn`, `closeReturn`, `markAsPaid` — built, tested,
      live-confirmed both stores
- [x] Fulfillment-order id resolution from an order via the extended
      `ORDER_QUERY` — `getOrder()`'s `fulfillmentOrders[].id`, confirmed a
      real connection via introspection, not assumed
- [x] Every op strict-by-default: `userErrors` checked, throws, no fallback
      ids anywhere
- [x] Payload-shape tests pinning every mutation (21 tests,
      `tests/shopifyAdmin.test.js`)
- [x] Host protection decided and stated explicitly (none needed; ticket's
      inherited-guard claim corrected)
- [x] `npm run build` + `npm test` green — **355/355** (334 baseline + 21 new)
- [x] LIVE: each op exercised once against a scratch order on both stores
      (12 orders total, table above)
- [x] No settle waits, no assertions, no flows added — `src/verify/**` and
      `src/flows/**` untouched

## Deliberately not done / handback

No priming mutation invented (none exists per the probe), no adoption of
`orderCreate` as a second creation path (used only via the probe's
`create-pending` action for the one unpaid scratch order `markAsPaid`
needed, exactly as instructed). No case design, no polling/settle waits, no
`src/verify/**` or `src/flows/**` changes — TAA-56/57/58's territory. The
$0 targeted-refund finding above is the one open question worth a future
session's attention before TAA-56 builds refund test cases on top of this
client.
