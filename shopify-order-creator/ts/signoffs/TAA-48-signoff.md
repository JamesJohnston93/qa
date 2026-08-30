# TAA-48 sign-off (2026-08-30) — orders-v2 transaction reader, all three slices done

Ticket: https://universalstore.atlassian.net/browse/TAA-48. Full detail per
slice lives in `TAA-48-slice-a.md` (capture + drift table), `-slice-b.md`
(the reader + design call), `-slice-c.md` (live re-verify) — this file is
the summary a future reader should read first.

## What this ticket delivers

`staging-orders-v2`'s `TRANSACTION#` rows had no reader before this ticket
— only `staging-shipments`' did (TAA-31 slice G). That gap is now closed:

1. **Typed reader**: `DynamoReader.getOrderTransactions(store, orderIdTail)`
   (`src/readers/dynamoReader.ts`) returns `TransactionRow[]`, chronological
   by construction (Query's natural ascending-SK order). Each row carries
   `pk`, `sk`, `category`, `event`, `origin`, `idempotencyId`, and the full
   `raw` item.
2. **Filter-by-event form**: `transactionRowsByEvent(transactions, event)`.
3. **Committed fixtures**: `fixtures/orders-v2/*.json`, 10 files, real
   captures spanning fulfil, reject, undeliverable (full + partial), refund,
   and both stores.
4. **Drift table**: in `TAA-48-slice-a.md`, reproduced below.
5. **Fixture-driven offline tests**: 7 new (5 against the real fixtures, 2
   unit-level), **334/334 green**, up from the 327/327 baseline.

## The design call, in one paragraph (full reasoning in slice B)

The ticket text says to create `src/readers/transactionReader.ts`. That
wasn't followed. Real captured rows showed `staging-shipments` and
`staging-orders-v2` TRANSACTION# rows share the exact same envelope, so the
existing `TransactionRow`/`transactionRowsFromRows` (TAA-31 slice G) was
widened and reused rather than duplicated into a parallel type. Further,
`getOrderRows` (already in `dynamoReader.ts`) already fetches every row for
an order via `origin_index`, TRANSACTION# rows included — so the new
`getOrderTransactions` needed no new AWS query at all, just composition.
No new reader file was created.

## Drift table (staging-orders-v2, reproduced from slice A)

| `event` | `category` | Seen on | Notes |
| --- | --- | --- | --- |
| `CREATE_ORDER` | `CHARGE` | every order | `itemChanges.added[]` |
| `REFUND_ITEM` | `REFUND` | any order with an item gone `UNDELIVERABLE` and refunded | `itemChanges.refunded[]`, `idempotencyId` suffixed `-items` |
| `REFUND_SHIPPING` | `REFUND` | only when the *whole* order's shipping is refunded (full undeliverable, not partial) | no `itemChanges`; `idempotencyId` suffixed `-shipping` |

Both `event` and `category` are real, distinct fields (not
type-vs-category) — settled empirically, not from docs. A clean
reject/reallocate (no undeliverable outcome) and a fulfilment both leave
**zero** trace on this table — their signatures live entirely on
`staging-shipments`.

## Live evidence

- US #9952 (reject → undeliverable): 4 transactions, matches fixture
  exactly (slice C).
- PS #3321: 1 transaction, matches fixture exactly, confirms zero
  cross-store field drift (slice C).
- US #9929/#9932/#9935 (genuinely `FULFILLED`, confirmed against
  `staging-shipments` directly): each shows `CREATE_ORDER` only on
  `staging-orders-v2` (slice A finding 1).

## Two-table model — confirmed, not contradicted

Nothing captured contradicts the ticket's premise. `origin_index`
resolution worked identically for every order across both stores. No hard
stop was hit.

## Scope boundary — explicit, per instruction

**No assertions were written in this ticket.** No `verify/` module, no
extension of any existing `verify/*.ts` file, nothing wired into `cli.ts`,
`index.ts`, or `--help`. `transactionRowsByEvent` is a filter, not an
assertion — it throws nothing and makes no pass/fail judgement. This is
deliberate: assertions against these rows are **TAA-52's job**. A future
session should not find a half-written assertion here and "helpfully"
finish it — there isn't one, by design.

## Refund path — no gap

The instructions flagged refund as the path most likely to be
uncoverable from existing orders. It wasn't — `#9865`, `#9866`, and `#9952`
all independently produced real `REFUND_ITEM`/`REFUND_SHIPPING` rows. **No
order was burned for this ticket.**

## Verification

`npm run build` + `npm test`: **334/334 green** across all three slices
(327 baseline → 334, +7). No regressions to any existing suite.

## Checklist (ticket-level)

- [x] Typed reader for orders-v2 TRANSACTION# rows, chronological + filter-by-event
- [x] Fixtures committed, covering fulfil/reject/undeliverable/refund + both stores
- [x] Drift table (event spellings, category field) written and empirically settled
- [x] Fixture-driven offline tests, suite green above the 327 baseline
- [x] Design call (transactionReader.ts vs. reuse) made and reasoned in slice B
- [x] No assertions/verify/cli wiring — explicitly out of scope, stated above
- [x] No new orders burned
- [x] Live re-verify, both stores (slice C)
- [x] No hard stop triggered

## Not done, deliberately

- No `verify/` module or assertions — TAA-52.
- No `src/readers/transactionReader.ts` — superseded by the design call
  above; if a future ticket still wants a physically separate file (e.g.
  for import-graph reasons), that's a fresh call to make then, not a
  leftover TODO from this one.
- No CLAUDE.md update from this ticket. **Found, not caused by this work:**
  this session's working directory (`/Users/james.johnston/Documents/GitHub/qa`)
  currently has an uncommitted, in-progress `CLAUDE.md` edit and a new
  untracked `ts/scripts/probe-admin-mutations.js`, both for a different,
  unrelated ticket (TAA-53) — apparently from a concurrent session sharing
  this same checkout. Neither was touched, edited, or committed by this
  work, to avoid clobbering or misattributing someone else's in-progress
  changes. Flagged to JJ directly rather than guessed at.

## Handback

Three branches, one linear chain, all local, none pushed or merged:

```
main (2b2f719)
  -> taa-48-capture      (c643c5a) — slice A: probe script, fixtures, drift table
    -> taa-48-reader     (3e69169) — slice B: the reader, widened TransactionRow, 7 new tests
      -> taa-48-live-verify (0ec44fe) — slice C: live re-verify both stores, this sign-off
```

Merging to `main` needs only `taa-48-live-verify`'s tip merged (or the
chain replayed/rebased, JJ's preference — same posture as TAA-46's
handback). No ticket transition attempted; TAA-52 (assertions) is the
natural next ticket and can build directly on `getOrderTransactions`/
`transactionRowsByEvent` without rediscovering any of the above.

**Separately, unrelated to this ticket's own scope:** JJ should know a
`CLAUDE.md` edit and a new script for TAA-53 are sitting uncommitted in
this same working directory from what looks like a concurrent session —
worth checking that work isn't lost before it's overwritten by an
unrelated `git` operation.
