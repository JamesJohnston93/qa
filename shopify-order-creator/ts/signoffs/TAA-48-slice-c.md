# TAA-48 slice C sign-off (2026-08-30) — live re-verify, both stores

Scope: live confirmation only. No `src/`/`tests/` changes — slice B's
reader is exercised as-built, unmodified.

## Live evidence

Ran `DynamoReader.getOrderTransactions(store, orderIdTail)` (the real
method, not the fixture data) against two already-burned orders, one per
store, via an ad-hoc script (not committed — a direct call through the
compiled `dist/`, same posture as a REPL check, nothing new to maintain):

- **US #9952** (id tail `7881631498513`) → **4** transaction rows, in
  order: `CREATE_ORDER`/`CHARGE`, `REFUND_ITEM`/`REFUND`,
  `REFUND_SHIPPING`/`REFUND`, `REFUND_ITEM`/`REFUND`. Every `sk`/`event`/
  `category`/`origin`/`idempotencyId` matches slice A's committed fixture
  (`fixtures/orders-v2/US-reject-9952.json`) byte-for-byte.
  `transactionRowsByEvent(transactions, "REFUND_ITEM")` correctly isolated
  the 2 matching rows.
- **PS #3321** (id tail `10875125727524`) → **1** transaction row,
  `CREATE_ORDER`/`CHARGE`, `origin=PS#SHOPIFY_ECOM#10875125727524` —
  matches `fixtures/orders-v2/PS-taa46-3321.json` exactly.
  `transactionRowsByEvent(..., "REFUND_ITEM")` correctly returned empty.

This proves the whole composition end to end against real data on both
stores: `origin_index` GSI resolution → `getOrderRows` → `transactionRowsFromRows`
→ typed `TransactionRow[]`, plus the filter helper, with zero drift from
what slice A's fixtures already captured (the fixtures were themselves
pulled from a real query, so this is confirming reproducibility, not
discovering anything new).

## Verification

`npm run build` + `npm test`: **334/334 green**, unchanged from slice B —
no code touched in this slice.

## Checklist

- [x] Reader returns typed rows for a known burned order against real data,
      US
- [x] Same, PS (cross-store)
- [x] `transactionRowsByEvent` confirmed live, not just offline
- [x] Output matches slice A's committed fixtures exactly (no drift between
      capture and re-verify)
- [x] `npm run build` + `npm test` green

## Not done, deliberately

No new fixtures committed this slice (nothing new observed — a rerun that
matched, not a fresh capture). No assertions/verify module — see this
ticket's final sign-off for the explicit scope-boundary statement.

## Handback

Branch `taa-48-live-verify`, cut from `taa-48-reader` (`3e69169`, slice B's
tip). No file changes this slice beyond this sign-off — nothing else to
commit. Not pushed, not merged. This is the last slice of TAA-48's own
scope; see `TAA-48-signoff.md` for the ticket-level wrap-up and the full
`taa-48-capture` → `taa-48-reader` → `taa-48-live-verify` chain.
