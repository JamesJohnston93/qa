# TAA-37 sign-off — fulfilment slice D, verify the fulfilled state landed

**Branch:** `taa-37-verify-fulfilment`, cut from `main` @ `1146374` (clean, 192/192).
**Owned files this session:** `src/verify/fulfilment.ts` (new), `src/config.ts`,
one additive `export * from "./fulfilment";` line at the end of
`src/verify/index.ts`. `readers/dynamoReader.ts` was read-only — used
`ShipmentItem`/`ShipmentSummary` and `getShipmentItemsByPk`/`getShipmentsByPk`/
`getOrderRows` exactly as TAA-35 left them, no changes.

## Build

`verify/fulfilment.ts` — three stateless free functions, same shape as
`verify/shipments.ts`/`verify/newstore.ts` (no base class, no registration),
each throwing `VerificationError(check, expected, actual, detail)`:

- `assertShipmentItemsFulfilled(items, shipmentId, orderName)` — every
  ITEM# row belonging to the shipment (filtered from the full per-order
  `ShipmentItem[]`) has `status === FULFILLED`. No items found for the
  shipment throws `shipments.items_fulfilled` (retryable — not a special
  case, matches the `verify/newstore.ts:25-27` null-snapshot convention) so
  `pollVerify` keeps polling rather than passing vacuously on an empty set.
- `assertShipmentTrackingNumber(summary, shipmentId, orderName)` — the
  `SHIPMENT#` row itself: `status === FULFILLED` **and** `trackingNumber`
  present, checked together in one gate. This is deliberate, not
  incidental: TAA-41 measured live that `trackingNumber` lands first
  (~2.4-3.0s) while `status` still reads `OPEN` — reading either field
  alone would report a false "settled" or a false "not written" mid-
  transition. A null summary throws the same retryable way.
- `assertOrderItemsFulfilled(orderRows, shipmentItems, orderName)` —
  staging-orders-v2 propagation: every `ITEM#` row there whose `sku`
  matches one on the fulfilled shipment also reads `FULFILLED`.
  staging-orders-v2 item rows carry no shipment/shipment-item id of their
  own, so correlation is by SKU (same convention `assertOrdersTableAlignment`
  already uses for the orders_table/Shopify SKU-quantity comparison) — no
  matching rows throws retryable, same as the other two.

`config.ts`: added `fulfilment: number` to `PollWindows` and `150` to
`DEFAULT_POLL_WINDOWS`, per the ticket's own comment block. Kept at 150s
deliberately even though TAA-41 measured the real settle at 6.5-9.0s (n=2)
— margin costs nothing, two samples isn't enough to resize on, and >5min
stays a triage signal rather than a wait-it-out budget (300s was rejected
for the same reason).

## Collision handled

`tests/fulfilment.test.js` already exists and covers `clients/fulfilment.ts`
(TAA-34). New offline tests are `tests/fulfilmentVerify.test.js` (mirrors the
`newstore.test.js` vs `newstoreVerify.test.js` precedent) — the ticket's own
"mirror the module name" line predates that filename being taken.

## Offline tests

12 new fixture-driven tests in `tests/fulfilmentVerify.test.js`: pass cases
for all three assertions, retryable-throw-on-not-found-yet for all three,
expected-vs-actual shape on a real mismatch for all three, plus two
cross-contamination guards (an item/row belonging to a different
shipment/unrelated SKU must not affect the result). `npm run build` then
`npm test`: **204/204 green** (192 baseline + 12 new).

## Live confirm — both stores, PASS

Placed one spare order per store (SKU pool index 8, well clear of the
10-13 range reserved for TAA-39), fulfilled via the existing TAA-34 CLI
(`node dist/index.js fulfil --shipment <uuid> --item ITEM#<uuid>`), then
drove all three new assertions through a `pollVerify`-equivalent loop
(hand-copied from `runner.ts:77-106`, which does not export it — `runner.ts`
is out of scope for this slice) against real staging:

- **US** — order `#9929` (`gid://shopify/Order/7881449210129`), shipment
  `5bc9c86a-bb7f-4760-9dcc-4e79f435dcc6`, item
  `ITEM#b44ed0e5-13df-4b58-94f2-5c69637f19bc`, SKU `34023587`.
  `assertShipmentItemsFulfilled` settled 11.1s, `assertShipmentTrackingNumber`
  settled ≤0.1s after that (tracking `111JD885844401000931501`),
  `assertOrderItemsFulfilled` settled 6.1s. All well inside the 150s window.
- **PS** — order `#3301` (`gid://shopify/Order/10859880218916`), shipment
  `708a065e-7fa7-4494-83e6-0d50f2c4f9d8`, item
  `ITEM#0dfaa37a-e39f-43ad-ad20-b9e3c3c91855`, SKU `33997759`.
  `assertShipmentItemsFulfilled` settled 6.1s, `assertShipmentTrackingNumber`
  settled ≤0.1s after that (tracking `111JD885844501000931508`),
  `assertOrderItemsFulfilled` settled 3.1s.

Both orders/shipments are now consumed — do not re-fulfil them (TAA-41: the
backend does not guard against re-fulfilling an already-`FULFILLED`
shipment; a re-fire silently overwrites `trackingNumber`).

**Deliberately broken expectation — demonstrated on both stores.** Ran
`assertShipmentItemsFulfilled` against a nonexistent shipment id
(`deadbeef-0000-...`) through the same `pollVerify` wrapper with an 8s
timeout. Both runs failed loudly with full expected-vs-actual, not a bare
timeout:

```
VerificationError {"check":"shipments.items_fulfilled","expected":"item(s) present","actual":"not found yet","detail":"order #9929; shipment deadbeef-0000-0000-0000-000000000000"}
VerificationError {"check":"shipments.items_fulfilled","expected":"item(s) present","actual":"not found yet","detail":"order #3301; shipment deadbeef-0000-0000-0000-000000000000"}
```

This is the acceptance criterion `pollVerify` exists to satisfy: `pollUntil`
alone would have surfaced a `StageTimeout`; `pollVerify` re-runs the
assertion on timeout and raises the real `VerificationError` instead.

## Not built here (by design)

- No wiring into `runner.ts`'s case chain — that composite-poll wiring
  (mirroring the existing `orders_table`+`allocation` pattern) is later
  scope (TAA-39: `fulfil_single`/`fulfil_split` under `--repeat`), not this
  slice.
- No `waitForShipmentFulfilled` helper committed — it doesn't exist in the
  codebase yet (confirmed via grep before starting; TAA-36, running in
  parallel this session, owns it). The live-confirm script above
  reimplements the equivalent polling inline as a throwaway, not as
  delivered source.
- Order-finalised / `TRANSACTION#` row reading is explicitly out of scope —
  TAA-33.

## Checklist

- [x] `verify/fulfilment.ts` with the three assertions
- [x] `fulfilment` poll window added to config (150s)
- [x] failures report expected-vs-actual from each system involved
- [x] fixture-driven offline tests in `tests/fulfilmentVerify.test.js`
- [x] `npm run build` + `npm test` green (204/204)
- [x] LIVE confirm on both stores (US `#9929`, PS `#3301`)
- [x] deliberately broken expectation fails with expected-vs-actual, not a
      bare timeout — demonstrated on both stores
