# TAA-68 sign-off (2026-08-30) — `--delivery pickup:` restored on 2025-10

Ticket: https://universalstore.atlassian.net/browse/TAA-68. Branch
`taa-68-pickup-delivery-fix`, cut from `main` @ `1ed9ac6` (369/369 offline
green). Owned files only: `src/cli-order.ts`, `src/clients/shopify.ts`,
`tests/cli-order.test.js` (unchanged — its existing `--delivery pickup:<name>`
parse test already covers the CLI contract, which did not change),
`tests/shopify.test.js`, this file. `src/verify/**`, `src/flows/**`,
`src/config.ts` untouched.

## Confirming introspection (both stores) — agrees with TAA-50 in full, adds detail

TAA-50's claim was not redone from scratch, only confirmed, plus the one
follow-up question it left open (what does a pickup option carry besides a
handle?):

- **`DraftOrderInput.deliveryMethod` is absent** on both US (static token)
  and PS (OAuth) — confirmed by live introspection of `DraftOrderInput`'s
  `inputFields` on both shops, same field list both places.
- **`draftOrderAvailableDeliveryOptions` is a top-level `query` field** (not
  a mutation), taking `DraftOrderAvailableDeliveryOptionsInput!` (`lineItems`,
  `shippingAddress`, plus discount/market/purchasing-entity fields QA does
  not use) and `search`/`localPickupFrom`/`localPickupCount`/`sessionToken`
  args. Returns `DraftOrderAvailableDeliveryOptions` with
  `availableLocalPickupOptions: [PickupInStoreLocation!]!` and
  `availableShippingRates`/`availableLocalDeliveryRates: [DraftOrderShippingRate!]!`.
- **New finding beyond TAA-50: `PickupInStoreLocation` carries `title` and
  `locationId` directly** (`code`, `distanceFromBuyer`, `handle`,
  `instructions`, `locationId`, `source`, `title`), and live-confirmed that
  `title` is the exact same string as the plain `locations` query's
  `node.name` (e.g. `"Universal Store Belconnen"`, `"Universal Store
  Chermside"`) — same naming convention, not a second name to normalise.
  This settles design question 1 below.
- **`localPickupCount` does not change which locations are eligible**, only
  (at most) how many of an eligible set are returned — tested at `50`/`250`/
  `500` on both a 1-option case and an 8-option case with no change either
  time. `search` does not do location-name filtering (`search: "Belconnen"`
  against an address that does return Belconnen unfiltered still returned
  `[]`) — not used.
- Confirmed on **both** stores independently (US static token, PS
  client-credentials OAuth) — identical schema, identical behaviour.

## Design question 1 — where the handle comes from

**Resolved directly from `draftOrderAvailableDeliveryOptions`, matching on
the option's own `title` — the old `fetchPickupLocations()` name→id lookup
is no longer part of the pickup path at all.** `cli-order.ts` no longer
calls `fetchPickupLocations()`; it passes the CLI's `locationName` straight
through to `ShopifyClient.createDraftOrder`, which resolves and matches it
itself (new private `fetchNamedPickupHandle`/`fetchLocalPickupOptions`,
mirroring the existing `fetchNamedShippingRateHandle`/`fetchShippingRates`
pair for rates).

Why not keep the old two-query correlate-by-id shape: `fetchPickupLocations()`
lists **every** location that exists on the shop (including
`"... - DO NOT USE"` housekeeping locations, live-confirmed present in that
query's real output), with no idea which ones can actually fulfil the SKUs
being ordered. `draftOrderAvailableDeliveryOptions` already answers the
narrower, correct question — "which pickup locations can fulfil *this order*"
— live-confirmed to genuinely filter on fulfillment eligibility, not distance
or an arbitrary cap (US SKU `33943398`/slot 57 → exactly one eligible
location for the mock address, `33923871` → eight, unaffected by
`localPickupCount`). Matching against that same query's own `title` field is
strictly more accurate than a second round-trip could be, and is one query
instead of two. `fetchPickupLocations()` itself is left completely alone —
it is still used by `scripts/probe-admin-mutations.js` (read-only per the
wave ground rules) and stays available for anything that genuinely needs
"every location", just no longer wired into the pickup CLI path.

**Consequence for the error message (checklist item):** the "available"
list in the not-found error is now the true fulfillment-eligible set for
the exact SKUs/quantities being ordered, not a static full location list.
This is a behaviour change from before the defect existed (pre-2025-10, the
old `deliveryMethod` shape presumably didn't filter this way either) but is
the more correct answer and was reachable with no extra cost.

## Design question 2 — which shipping address

**Reused the existing `mockAddress(firstName, lastName)` helper unchanged**
— the same Eagle Farm, QLD address every other flow in this file already
sends (billing address always, shipping address on the rate flow). Not a
new decision so much as "don't invent a second one": it is already
deterministic, already store-agnostic (used identically for both US and
PS), and introducing a different address for pickup only would be the kind
of store-specific magic the ticket explicitly warns against. The address
does affect which locations are eligible (eligibility appears to be a
combination of stock and some geographic/fulfillment-network filter, not
pure distance — see the introspection notes above), so a real operator
asking for a location genuinely out of reach for this address+SKU
combination will get an accurate "not found, available: [...]" rather than
a wrong success. That is a feature of using the real query, not a defect
introduced by this address choice.

## Code changes

`clients/shopify.ts`:
- `DeliverySelection`'s pickup variant is now `{ type: "pickup"; locationName:
  string }` (was `locationId`) — the whole handle resolution moved inside
  `createDraftOrder`, which no longer has a separate pickup branch at all.
  The old `if (pickup) { deliveryMethod = ... } else { rate/default logic }`
  collapsed into one `shippingRateHandle` three-way branch (pickup / named
  rate / first-available rate) followed by the **same**
  `input.shippingAddress = mockAddress(...); input.shippingLine = {
  shippingRateHandle }` for all three — because that is genuinely now the
  same shape for all three, not three different shapes coincidentally
  written similarly.
- New `DRAFT_ORDER_AVAILABLE_DELIVERY_OPTIONS` query constant, new private
  `fetchLocalPickupOptions`/`fetchNamedPickupHandle`, same structure as the
  existing `fetchShippingRates`/`fetchNamedShippingRateHandle` pair.
  `fetchNamedPickupHandle` does not take `customerEmail` — confirmed live
  that `DraftOrderAvailableDeliveryOptionsInput` has no `email` field, unlike
  `DraftOrderCalculateInput`.
- `fetchPickupLocations()` untouched, still exported, still used by
  `scripts/probe-admin-mutations.js`.

`cli-order.ts`:
- `runShopifyOrder`'s pickup branch shrank to passing `config.delivery.
  locationName` straight through as `{ type: "pickup", locationName }` — no
  more `fetchPickupLocations()` call, no more local match/error-message
  logic (both now live in `ShopifyClient`, see above). `DeliverySpec`'s own
  shape (`{ type: "pickup"; locationName: string }`) did not need to change,
  it already carried a name, not an id — only the plumbing to
  `DeliverySelection` changed.
- `--help` text and `parseDelivery`'s `pickup:<location name>` contract
  unchanged — verified by re-running `node dist/index.js order --help`.

## Offline tests — both steps' payload shapes pinned, `tests/reject.test.js` precedent followed

New tests in `tests/shopify.test.js` (7 new, all against `createDraftOrder`
directly, via a small router over `global.fetch` matching on which
query/mutation was sent):

1. No-delivery-override flow: `draftOrderCalculate` → `draftOrderCreate`
   with `shippingAddress` + first rate's `shippingLine.shippingRateHandle`,
   asserts `deliveryMethod` is absent from the input.
2. Named-rate flow (`--delivery rate:<title>`): same shape, asserts the
   `draftOrderCalculate` call itself carries `lineItems`+`shippingAddress`,
   and the matched (not first) handle lands on `shippingLine`. This is the
   "must keep working unchanged" checklist item — there was no prior test
   pinning this payload at all (checked: no existing test anywhere
   referenced `draftOrderCreate`/`draftOrderCalculate`/`createDraftOrder`),
   so this is new coverage, not a modified existing test.
3. Pickup flow: asserts `draftOrderAvailableDeliveryOptions` is called with
   `lineItems`+`shippingAddress` and no `email`, then `draftOrderCreate`
   gets `shippingAddress` + the matched option's `handle` on
   `shippingLine.shippingRateHandle`, and — the ticket's explicit
   requirement — `deliveryMethod` is absent (`'deliveryMethod' in input ===
   false`, not just `undefined`).
4. Pickup, no name match: throws, message includes both the requested name
   and the actually-available titles.
5. Pickup, top-level GraphQL error from `draftOrderAvailableDeliveryOptions`:
   surfaced as a thrown error, not silently treated as "no options".
6. Pickup, `draftOrderCreate` `userErrors` (e.g. a stale/expired handle):
   surfaced, order not completed.

`npm run build` clean, `node --test tests/shopify.test.js tests/cli-order.test.js`:
**58/58 green** (51 pre-existing + 7 new). `cli-order.test.js` itself needed
no edits — its `--delivery pickup:<name>` parse test already pins the
unchanged CLI contract.

**Full-suite `npm test` note:** this session's working directory is shared
with three other concurrent wave-3 sessions (TAA-47/52/57) on the same
physical checkout — see the environment note at the end of this file. Whole
`npm test` counts fluctuated between runs (369 → 413 → 385) purely from
other lanes' uncommitted files appearing/disappearing mid-session, unrelated
to this ticket. The number that matters for this sign-off is the isolated
58/58 above.

## Live confirmation — both stores, via the actual CLI, pool slots 57/60

- **US, slot 57, SKU `33943398`x1**, `node dist/index.js order --store US
  --items 33943398x1 --delivery "pickup:Universal Store Chermside" --seed
  none` → order **#10006**
  (`gid://shopify/Order/7899546386705`). `staging-orders-v2` ITEM# row:
  `deliveryMethod: "CLICKCOLLECT"`, **`clickCollectStore: "407"`**.
- **PS, slot 60, SKU `33824864`x1**, `node dist/index.js order --store PS
  --items 33824864x1 --delivery "pickup:Perfect Stranger Chermside" --seed
  none` → order **#3330**
  (`gid://shopify/Order/10875499217188`). `staging-orders-v2` ITEM# row:
  `deliveryMethod: "CLICKCOLLECT"`, **`clickCollectStore: "640"`**.

Both read via the real `DynamoReader.getOrderItemRows(store, orderIdTail)`
(TAA-50's method, not a raw dump), polled to a positive terminal condition
(`rows.length > 0`), landing well inside a minute for both. No new fixture
committed — TAA-50's `US-clickcollect-9997.json` already pins this exact row
shape from a hand-run probe script; this ticket's job was the CLI path, not
a second fixture of the same shape.

## Checklist

- [x] One confirming introspection run recorded, agrees with TAA-50
  (see above — adds `PickupInStoreLocation`'s field list, which TAA-50
  didn't need)
- [x] `cli-order.ts` and `clients/shopify.ts` updated, `--delivery
  pickup:<name>` works live on both stores
- [x] `--delivery rate:<title>` unchanged, now pinned by a new test (none
  existed before)
- [x] Handle-resolution and shipping-address decisions stated explicitly
  above
- [x] Offline tests pinning both steps' payload shapes, including the
  negative assertion (`deliveryMethod` absent)
- [x] LIVE: pickup order placed on both stores, `clickCollectStore`
  recorded for each (US `"407"`, PS `"640"`)
- [x] `--help` text re-verified unchanged/accurate
- [x] `npm run build` + targeted test run green (58/58); see the full-suite
  note above for why the whole-repo number is noisy this session

## Orders burned (pool slots 57 and 60 only, per the wave-3 ground rules)

| Order | Store | Slot | SKU | Purpose |
| --- | --- | --- | --- | --- |
| #10006 | US | 57 | 33943398 | Pickup live confirmation, "Universal Store Chermside" |
| #3330 | PS | 60 | 33824864 | Pickup live confirmation, "Perfect Stranger Chermside" |

No other slots touched. No NewStore injection.

## Out of scope, deliberately

No click & collect case design, no `src/cases/**` change — that's TAA-32,
which this ticket unblocks but does not do. No touch to `src/verify/**`,
`src/flows/**`, `src/config.ts`, `ts/scripts/probe-admin-mutations.js`, or
any `ts/fixtures/orders-v2/*.json`.

## Environment note (not a TAA-68 finding, flagging loudly per the ground rules)

This session's working directory (`/Users/james.johnston/Documents/GitHub/qa`)
turned out to be **shared, unisolated state across all four wave-3
sessions** — one physical checkout, one `HEAD`, one index — not a
worktree-per-session setup. Mid-session, `git reflog` showed `HEAD` being
flipped across `taa-68-pickup-delivery-fix`/`taa-57-admin-flows`/
`taa-47-prepare-skus`/`taa-52-verify-orders-service` in rapid succession
(all four branches sitting on the same commit, no work committed to any of
them yet), and at one point `git status` showed this session's uncommitted
`cli-order.ts`/`shopify.ts` edits sitting on top of `taa-52`'s substantial
uncommitted `config.ts`/`verify/*.ts`/`flows/*.ts` work, with HEAD checked
out on `taa-52-verify-orders-service` rather than this ticket's branch.
Nothing was lost — git does not discard uncommitted changes on a plain
`checkout` between two identical commits — but any session in this wave
that runs a destructive git command (`checkout --`, `reset --hard`, `clean
-f`) risks destroying another lane's uncommitted work with no warning, and
whole-suite `npm test` counts are unreliable session-to-session for the
same reason (see the full-suite note above). Flagged to JJ for this wave;
this ticket's own commit (below) was staged by exact file path for
exactly this reason, never `git add -A`/`git add .`.

## Committing this ticket's work

Per JJ's direction mid-session (shared-working-directory hazard above):
`HEAD` was moved to `taa-68-pickup-delivery-fix` and only this ticket's
exact owned files were staged — `src/cli-order.ts`, `src/clients/shopify.ts`,
their `dist/` counterparts, `tests/shopify.test.js`, and this sign-off.
Nothing from `taa-47`/`taa-52`/`taa-57`'s uncommitted work (`config.ts`,
`verify/*.ts`, `flows/*.ts`, their new test files) was added or touched.
