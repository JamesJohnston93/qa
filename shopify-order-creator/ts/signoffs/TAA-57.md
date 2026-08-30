# TAA-57 sign-off (2026-08-30) — editFlow, holdFlow, returnFlow

Ticket: https://universalstore.atlassian.net/browse/TAA-57. Branch
`taa-57-admin-flows`, cut from `main` @ `1ed9ac6`. Built on TAA-55's
`clients/shopifyAdmin.ts` (ShopifyAdminClient, read-only) and TAA-50's
`readers/dynamoReader.ts`/`readers/shopifyReader.ts` (read-only). No changes
to either. **No import from `src/verify/**` anywhere in this ticket's code —
`holdFlow.ts`/`editFlow.ts`/`returnFlow.ts` all assert nothing, matching
`rejectFlow.ts`/`fulfilFlow.ts`'s shape exactly.**

**Shared-working-directory note (environment, not a code finding):** this
session discovered partway through that all four parallel lanes operate on
the *same* physical git checkout, not isolated worktrees — branch checkouts
from other sessions interleaved with mine (`git reflog` shows `taa-47-prepare-
skus`, `taa-52-verify-orders-service`, `taa-68-pickup-delivery-fix` all
switching HEAD in the same directory while this session was mid-flight,
and TAA-68 committed on its own branch during that window). No data was lost
— uncommitted changes survive a `git checkout` regardless of which branch is
current — but every commit below was staged file-by-file, by exact path,
specifically to avoid pulling in the other lanes' untracked files
(`scripts/prepare-skus.js`, `signoffs/TAA-47.md`, `tests/prepareSkus.test.js`
— TAA-47's, left untouched) that were sitting in the same tree. Worth flagging
to JJ: a `git add -A`/`git add .` by any lane in this setup would silently
commit another lane's work-in-progress onto the wrong branch.

## Checklist

- [x] returnFlow probed FIRST — before/after row dumps, **honest null result**
      recorded for TAA-58 (no positive terminal condition exists)
- [x] holdFlow: hold applied and released, both reasons supported, settling on
      onHold content plus HOLD_ORDER/UNHOLD_ORDER rows — **live-confirmed both
      reasons, both stores**
- [x] editFlow: edit committed, settling on the new ITEM# row plus the
      ADD_ITEM row — **live-confirmed both stores** (as the OUTSTANDING_PAYMENT
      hold route's composed dependency)
- [x] returnFlow: not built as a settle predicate — there is nothing to wait
      on (see below); kept as a reusable snapshot/diff probe instead
- [x] `ordersService` poll window added to `config.ts`'s
      `DEFAULT_POLL_WINDOWS`, 120s, headroom reasoning + this session's own
      measured settle times recorded below
- [x] Offline tests for every predicate, real captured fixtures used
      throughout (own + TAA-50's pre-existing evidence) — `tests/editFlow.test.js`,
      `tests/holdFlow.test.js`, `tests/returnFlow.test.js`
- [x] No assertions, no imports from `src/verify/**`
- [x] `npm run build` + `npm test`: **418/418** (369 baseline + 49 new)
- [x] LIVE: hold on-to-off round trip settles on **both stores** (fraud
      reason); outstanding-payment reason live-confirmed on both stores too
      (not required by the ticket's one-sentence goal, done anyway since
      editFlow needed a live proof regardless and the marginal cost was one
      more order per store)

## returnFlow — the probe, and why it stayed a probe

`ts/scripts/probe-admin-mutations.js`'s `return-flow` action (TAA-53, read-only
evidence) already found `returnCreate`+`returnClose` succeeding on Shopify
while producing zero `TRANSACTION#` rows on `staging-orders-v2` after 5+
minutes. That probe only polled `TRANSACTION#` rows on one table for 60s. This
ticket repeated the experiment properly: a full ORDER + ITEM# + TRANSACTION#
row dump, before and after, diffed field-by-field (`captureReturnSnapshot`/
`diffReturnSnapshots` in `src/flows/returnFlow.ts`, both pure and
offline-tested).

**Live run — US order #10005, slot 63, sku `33855417`.** Fulfilled
Shopify-side via `probe-admin-mutations.js`'s `fulfil-for-return` action (its
own `fulfillmentCreate` mutation — Shopify-side merchant fulfil, NOT this
project's staging `/staging/fulfil` backend call, and confirmed not to touch
`staging-shipments`) to get a real `fulfillmentLineItemId`. `returnCreate`
→ return `#10005-R1`, status `OPEN`. `returnClose` → status `CLOSED`,
`closedAt: 2026-08-30T05:57:31Z`. Both succeeded cleanly on Shopify's side.

**Diff after a 120s wait: `nothingChanged: true`.** Zero new `TRANSACTION#`
rows, ITEM# row set unchanged (still 1 row, same content), ORDER row
unchanged (status/onHold/paymentMethod/subtotal/grandTotal/currency all
identical). Full before/after row set captured as
`ts/fixtures/orders-v2/US-taa57-return-noop-10005.json` (the two snapshots are
byte-identical, so one file covers both).

**Conclusion, for TAA-58: there is no positive terminal condition anywhere in
`staging-orders-v2` to poll on for a return, at least for a plain
`returnCreate`+`returnClose` with no attached refund.** This reconfirms
TAA-53's finding on a fresh order, with the fuller row set the ticket asked
for. `runReturnProbe` is kept as a reusable diagnostic (fixed wait, not a
poll predicate, asserts nothing) for TAA-58 to reach for if it needs to probe
a *different* return shape — e.g. a return with money movement attached,
still unconfirmed either way (also flagged, unresolved, in TAA-56's refund
question in the main CLAUDE.md). Did not chase that variant further this
session — out of scope for TAA-57, which owns building the flow shape, not
designing TAA-58's cases.

## holdFlow — both reasons, both mechanisms, both stores

Two independent reasons, two independent mechanisms (file header in
`holdFlow.ts` has the full detail):

- **POTENTIAL_FRAUD**, via `fulfillmentOrderHold`/`ReleaseHold`. GraphQL enum
  sent: `HIGH_RISK_OF_FRAUD`; DynamoDB reason string that lands:
  `POTENTIAL_FRAUD` — different strings for the same hold (TAA-53), only the
  second belongs in a predicate over DynamoDB rows.
- **OUTSTANDING_PAYMENT**, via the EDIT route (composing `editFlow.ts`'s
  `addItemToOrder`, not re-ported) — adding an unpaid item to an
  already-paid order. Deliberately not driven through unpaid-order creation
  per the ticket's correction (TAA-50 found that route intermittent, US #9996
  the burned spare with no orders-v2 row after 6 minutes).

Both settle on the same two-part positive condition: `OrderRecord.onHold`
contains/no-longer-contains the reason, **and** a matching
`HOLD_ORDER`/`UNHOLD_ORDER` `TRANSACTION#` row names it in
`onHoldChanges.added`/`.removed`. Neither alone is trusted (same reasoning as
`fulfilFlow.ts`'s `isFulfilmentSettled`).

**Live runs, both stores, fraud reason:**

| Store | Order | Applied | Released |
| --- | --- | --- | --- |
| US | #10007 (slot 77, sku `33653310`) | 12.7s | 12.2s |
| PS | #3331 (slot 63, sku `33995595`) | 8.7s | 6.1s |

**Live runs, both stores, outstanding-payment reason (composing editFlow):**

| Store | Order | Edit settle | Hold applied (after edit) | Released (markAsPaid) |
| --- | --- | --- | --- | --- |
| US | #10008 (slot 78, sku `32131659`; added sku `33773476`, slot 79) | 12.7s | 2.0s | 8.1s |
| PS | #3332 (slot 77, sku `33815749`; added sku `33689753`, slot 78's sku) | 6.7s | 4.1s | 8.1s |

All eight numbers land inside 13s, against the 120s `ordersService` window —
see below for why 120s was still the right call despite these numbers coming
in far under it.

Fixtures captured: `US-taa57-hold-fraud-10007.json`,
`PS-taa57-hold-fraud-3331.json`, `US-taa57-hold-outstanding-10008.json`,
`PS-taa57-hold-outstanding-3332.json` — each the FINAL row set (post-release).
Offline tests for the "applied" (mid-hold) predicate reuse TAA-50's
pre-existing, committed fixtures (`US-hold-fraud-9994.json`,
`US-hold-outstanding-edit-9998.json`), which happen to be genuine mid-hold
snapshots already. One test (`holdFlow.test.js`'s
`applyOutstandingPaymentHold` composition test) needed the mid-hold
intermediate state reconstructed from the final fixture (strip the real
`UNHOLD_ORDER` row, restore `onHold` on the `ORDER` row) — the first version
of that test used the raw final fixture directly and burned the full real
120s `pollUntil` timeout before failing, since `holdApplied` never became true
against an already-released snapshot. Caught and fixed before this sign-off;
noted here because it's the one dead-end this session hit, and the fix
pattern (reconstruct the intermediate state explicitly, don't assume a
"before" fixture exists just because an "after" one does) is worth remembering
for TAA-58's own fixture work.

## editFlow — live-confirmed via the outstanding-payment composition

No standalone editFlow live run beyond what the outstanding-payment hold
already exercises — `applyOutstandingPaymentHold` calls `addItemToOrder`
directly, so the two US/PS runs above (edit settle: 12.7s / 6.7s) are
editFlow's own live confirmation too. Settles on the new ITEM# row (matching
sku) **and** a matching `ADD_ITEM` `TRANSACTION#` row — matching on event
name, not sku alone, because both `CREATE_ORDER` and `ADD_ITEM` events carry
an `itemChanges.added[]` array (confirmed on the real #10008 fixture: sku
`32131659` only ever appears under `CREATE_ORDER`, sku `33773476` only under
`ADD_ITEM` — see the test asserting the predicate stays false for the
original sku).

## `ordersService` poll window (`config.ts`)

Added `ordersService: 120` to `PollWindows`/`DEFAULT_POLL_WINDOWS` — a
harness-wide stage (shared by `holdFlow.ts` and `editFlow.ts`, both landing
through the same `staging-orders-v2` webhook pipeline), per the ticket's
instruction to size it as a config.ts field, not a local per-file constant.
120s against TAA-53's single ~42s edit-chain measurement is a ~3x margin —
smaller than fulfilment's ~17-23x or reallocation's ~8-15x precedent, because
42s is already a slower stage than either of those, not because this one is
trusted more.

**This session's own measurements, recorded for future tuning (n=8 across
both reasons, both mechanisms, both stores): 2.0s to 12.7s, all well under
20s.** Notably faster than TAA-53's single ~42s edit-chain sample — that
sample's three "independent webhook deliveries... out to ~42s" framing may
have reflected a slower moment for the pipeline, or a different edit-chain
shape (TAA-53's probe added a discount step this session's outstanding-payment
route didn't need). Kept the window at 120s rather than tightening it: eight
fast samples from one session's live runs, all on freshly-seeded orders back
to back, isn't grounds to shrink a number sized against a different, slower
sample — same "don't resize on a thin n" reasoning TAA-41 and TAA-31 both
applied to their own settle windows.

## SKU pool usage (slots 63, 77, 78, 79 only, both stores)

| Store | Slot | SKU | Order | Purpose |
| --- | --- | --- | --- | --- |
| US | 63 | `33855417` | #10005 | returnFlow probe |
| US | 77 | `33653310` | #10007 | fraud-hold round trip |
| US | 78 | `32131659` | #10008 | outstanding-payment hold round trip (base order) |
| US | 79 | `33773476` | (added to #10008 via edit, no separate order placed) | outstanding-payment hold round trip (added item) |
| PS | 63 | `33995595` | #3331 | fraud-hold round trip |
| PS | 77 | `33815749` | #3332 | outstanding-payment hold round trip (base order) |
| PS | 78 | `33689753` | (added to #3332 via edit, no separate order placed) | outstanding-payment hold round trip (added item) |
| PS | 79 | `33723280` | unused | spare, not burned |

No slot outside 63/77/78/79 touched on either store. Nine orders total burned
across both stores (US #10005/#10007/#10008, PS #3331/#3332 as placements;
slots 79 US and 78 PS consumed only as edit-added items on an existing order,
no separate placement).

## Not done, deliberately

- No wiring into `runner.ts`/`cases/**`/`cli.ts` — that's a later wave, and
  `cases/**` was explicitly off-limits this ticket. `--help`/`--list-cases`
  unchanged; nothing here adds a flag or a case.
- No `verify/holds.ts` assertion logic — TAA-52 owns that, off-limits and not
  present on this branch (confirmed: no `src/verify/` directory exists here).
- No refund-attached return variant probed (see returnFlow section above) —
  left for TAA-58 if it needs that specific shape.
