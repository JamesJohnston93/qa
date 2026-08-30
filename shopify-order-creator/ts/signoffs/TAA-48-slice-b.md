# TAA-48 slice B sign-off (2026-08-30) — the reader, built against slice A's fixtures

Scope: `src/readers/dynamoReader.ts` (widened `TransactionRow`, new
`transactionRowsByEvent`, new `DynamoReader.getOrderTransactions`),
`tests/dynamoReader.test.js` (one existing test updated for the widened
shape, 7 new tests — 5 fixture-driven against slice A's real captures). No
live AWS calls in this slice — that's slice C.

## The design call — owned, reasoned, and it changed twice as the evidence came in

The ticket's own text says to create `src/readers/transactionReader.ts`. I
was told explicitly not to follow that by reflex, and to decide based on
evidence in `dynamoReader.ts` plus whatever slice A's capture showed. Here's
the actual reasoning, in the order it happened:

**Starting hypothesis (from the ticket brief + `dynamoReader.ts`'s existing
shape):** `transactionRowsFromRows` is already pure and table-agnostic — it
only reads `SK`/`event`/`shipmentItemInfo` off a generic row, nothing
`staging-shipments`-specific. A same-file sibling method
(`getTransactionsByPk`-shaped) reusing it for `staging-orders-v2` looked
like the obvious no-duplication move, avoiding a second reader file that
would just re-implement the same row-parsing half.

**Evidence that changed the shape of the answer (slice A capture,
`TAA-48-slice-a.md` findings 3-4):** real `staging-orders-v2` rows carry
`PK`/`category`/`origin`/`idempotencyId` that the *old* `TransactionRow`
interface didn't model at all (it only had `sortKey`/`event`/
`shipmentItemInfo`/`raw`) — and a direct comparison read against
`staging-shipments`' own rows (order #9952) showed the **exact same**
envelope fields there too. So the "table-agnostic" claim in the ticket
brief was actually *truer* than the brief implied — not just the parsing
logic, but the full row envelope is shared. That settled reusing/widening
`TransactionRow` itself (not creating a parallel orders-only type), done
above.

**Second correction, past what the ticket brief anticipated:** a "sibling
`getOrderTransactionsByPk` method calling a generalized private
query-by-PK-and-table helper" (the shape I started implementing, mirroring
`getTransactionsByPk`) turned out to be solving a problem that doesn't
exist for `staging-orders-v2`. `getTransactionsByPk` needs a **separate**
query because `staging-shipments` has no `origin_index` — its PK has to be
resolved via `staging-orders-v2` *first*, then a second table gets queried.
But for `staging-orders-v2` itself, `getOrderRows` (already in this file,
already used by `getOrderSkuQuantities`/`getOrderPk`) already fetches
**every row for the order**, `TRANSACTION#` included, via `origin_index` in
one query. A caller can only ever have an orders-v2 PK by having already
called `getOrderRows` — there is no code path that resolves this PK any
other way. So a `ByPk` variant here would take a PK a caller could only have
gotten from a row set that already contains everything
`getOrderTransactions` would fetch again. The right shape is a plain
composition, `getOrderRows` + `transactionRowsFromRows`, exactly matching
the existing `getOrderSkuQuantities`/`getOrderPk` pattern in the same file —
**no new AWS query at all**, not even a new call shape.

**Net result:** `transactionReader.ts` was never created. Everything landed
in `dynamoReader.ts`: `TransactionRow` widened (not duplicated),
`transactionRowsFromRows` unchanged in signature and reused verbatim for
both tables, one new method (`getOrderTransactions`) that is pure
composition of two things this file already had.

## What changed

**`TransactionRow`** (interface) gained `pk`, `category`, `origin`,
`idempotencyId`; `sortKey` renamed to `sk` (grepped first — nothing outside
`dynamoReader.ts`/its own tests referenced `.sortKey`; `verify/rejects.ts`
only reads `.event`/`.shipmentItemInfo`, unaffected). Doc comment now
explains the `origin` field carries a **different meaning per table**
(Shopify origin string on `staging-orders-v2`; internal system name —
`SHIPPING_SERVICE`/`DC_PACKING`/`ORDERS_SERVICE` — on `staging-shipments`) —
found live in slice A, worth flagging so a future reader isn't confused by
one field meaning two things.

**`transactionRowsFromRows`** — same signature, now also extracts the four
new fields (`String(row.X ?? "")`, same defensive-default convention as the
rest of this file). Still filters on `SK.startsWith("TRANSACTION#")`, still
preserves input row order (a Query already returns ascending-SK/chronological
order; this was true before and is now stated explicitly in the doc
comment, not re-implemented as a sort).

**`transactionRowsByEvent(transactions, event)`** (new, pure) — the
"filter-by-event form" deliverable. A plain filter, same shape as the
inline filters `verify/rejects.ts`'s `assertRejectTransactions` already does
by hand (`transactions.filter((t) => t.event === "SHIPMENT_REJECTED")`) —
this promotes that one-off pattern to a reusable helper without touching
`rejects.ts` itself (out of scope, TAA-52's job, and it isn't broken).

**`DynamoReader.getOrderTransactions(store, orderIdTail)`** (new) —
`TRANSACTION#` rows for an order from `staging-orders-v2`, chronological.
Composition only, documented above.

## Fixture-driven tests (7 new, all against slice A's real captures)

Deliberately not synthetic — every assertion pins a real staging response:

- `US-fulfil-9929.json` → exactly one transaction, `CREATE_ORDER`/`CHARGE`
  — regression guard for slice A finding 1 (fulfilment leaves no trace on
  this table).
- `US-reject-9947.json` → `CREATE_ORDER` only — regression guard for
  finding 2 (a clean reject/reallocate leaves no trace here either).
- `US-reject-9952.json` → `CREATE_ORDER`, `REFUND_ITEM` x2,
  `REFUND_SHIPPING`, in that order; `transactionRowsByEvent` isolates the 2
  `REFUND_ITEM` rows; explicit chronological-order check (SK-sorted array
  equals the as-returned array — proves no hidden reordering).
- `US-undeliverable-9865.json` vs `US-undeliverable-9866.json` — full vs.
  partial undeliverable, pins that `REFUND_SHIPPING` only appears on the
  full case.
- `PS-taa46-3321.json` — confirms zero field-name drift between stores.

Plus 2 unit-level tests for the widened envelope shape and
`transactionRowsByEvent` itself on synthetic rows (matching this file's
existing convention of a couple of synthetic edge-case tests alongside the
fixture-driven ones).

## Verification

`npm run build` + `npm test`: **334/334 green** (327 baseline + 7 new; one
existing test — the bare-`REALLOCATION`-row default-shape check — updated
in place for the widened fields, not counted as new).

## Checklist

- [x] Typed row (`TransactionRow`) carries `pk`, `sk`, `category`, `event`,
      `origin`, `idempotencyId`, and the full raw item
- [x] Chronological by default (Query order, stated + tested, not
      re-implemented as a sort)
- [x] Filter-by-event form (`transactionRowsByEvent`)
- [x] Built against slice A's fixtures, not invented shapes
- [x] Design call made on the evidence and written up here, including where
      the evidence corrected the starting hypothesis
- [x] `npm run build` + `npm test` green (334/334, up from 327/327)
- [x] No `verify/`, `cases/`, `cli.ts`, `index.ts` changes (TAA-52's scope,
      not touched)

## Not done, deliberately

No live AWS call in this slice (slice C). No assertions/verify module — see
TAA-48's final sign-off for the explicit scope-boundary statement (TAA-52's
job, not started here, not half-started either).

## Handback

Branch `taa-48-reader`, cut from `taa-48-capture` (`c643c5a`, slice A's
tip). One commit to make: `src/readers/dynamoReader.ts` (modified),
compiled `dist/readers/dynamoReader.js` (modified),
`tests/dynamoReader.test.js` (modified), this sign-off (new). Not pushed,
not merged. Slice C (`taa-48-live-verify`) cuts from this branch's tip.
