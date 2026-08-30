# TAA-48 slice A sign-off (2026-08-30) — read-only capture, drift table, no src/ changes

Scope: read-only capture of `staging-orders-v2` `TRANSACTION#` rows from
already-burned orders, committed as fixtures, plus the event-name/field
drift table this settles empirically. No `src/readers/`, `src/verify/`, or
`src/cases/` changes in this slice — that's slice B.

## What this ticket is actually about (context, not rediscovered — restated for the sign-off record)

Two separate tables carry `TRANSACTION#` rows. `staging-shipments`'
TRANSACTION# rows already have a reader (`DynamoReader.getTransactionsByPk`,
TAA-31 slice G) and events (`SHIPMENT_CREATE`, `REALLOCATION`,
`SHIPMENT_ITEM_REMOVED`, `SHIPMENT_REJECTED`, `SHIPMENT_ITEM_REJECTED`, and
more found live below). **`staging-orders-v2`'s TRANSACTION# rows have no
reader at all — that's this ticket's job.** Both tables share the same
opaque order PK, resolved via `origin_index`.

## Tool built

`src/probe-orders-transactions.ts` (compiled to `dist/`) — same one-shot
research-tool posture as `probe-reject.ts`: not wired into `index.ts`/
`cli.ts`, no `--help` entry, no `verify/`/`cases/` wiring. Resolves each
given order number to its id tail via `ShopifyClient.findOrderIdTailByName`,
queries `staging-orders-v2` via the existing `DynamoReader.getOrderRows`
(origin_index GSI), and writes the **full row set** (not just TRANSACTION#
rows — the `ORDER`/`ITEM#` rows give correlation context) to
`fixtures/orders-v2/<store>-<label>-<orderNumber>.json`, printing every
TRANSACTION# row's raw shape to stdout along the way.

```
node dist/probe-orders-transactions.js --store US --orders 9929,9932,9935 --label fulfil
```

## Burned orders captured — BURN NO NEW ORDERS honoured, all real

| Order | Store | Label | staging-orders-v2 TRANSACTION# events found |
| --- | --- | --- | --- |
| #9929 | US | fulfil | `CREATE_ORDER` only |
| #9932 | US | fulfil | `CREATE_ORDER` only |
| #9935 | US | fulfil | `CREATE_ORDER` only |
| #9947 | US | reject | `CREATE_ORDER` only |
| #9952 | US | reject | `CREATE_ORDER`, `REFUND_ITEM` x2, `REFUND_SHIPPING` |
| #9865 | US | undeliverable (full) | `CREATE_ORDER`, `REFUND_SHIPPING`, `REFUND_ITEM` |
| #9866 | US | undeliverable (partial) | `CREATE_ORDER`, `REFUND_ITEM` (no `REFUND_SHIPPING`) |
| #9984 | US | taa46 | `CREATE_ORDER` only |
| #9985 | US | taa46 | `CREATE_ORDER` only |
| #3321 | PS | taa46 | `CREATE_ORDER` only |

`#9948`-`#9951`/`#9953`-`#9955` were also queried live (per the ticket's
given range) and found byte-shape-identical to `#9947` (`CREATE_ORDER`
only, nothing new) — checked but **not committed** as fixtures, to avoid
eight redundant near-duplicate files. `#9929`/`#9932`/`#9935` cross-checked
against `staging-shipments` directly (`getShipmentsByPk`) and confirmed
genuinely `FULFILLED` with real tracking numbers — see Finding 1 below.

## Drift table — observed spellings, staging-orders-v2

| `event` | `category` | Seen on | `idempotencyId` shape | Payload key |
| --- | --- | --- | --- | --- |
| `CREATE_ORDER` | `CHARGE` | every order | bare uuid | `itemChanges.added[]` |
| `REFUND_ITEM` | `REFUND` | full/partial undeliverable, reject→undeliverable | `<uuid>-items` | `itemChanges.refunded[]`, each entry's `status` is `UNDELIVERABLE` |
| `REFUND_SHIPPING` | `REFUND` | full undeliverable only (every item refunded) | `<uuid>-shipping` | no `itemChanges`; carries `segmentAction: "SENT"`, `status: "OPEN"` |

Every row on both tables carries the same envelope —
`PK`, `SK`, `event`, `category`, `origin`, `idempotencyId`, `updatedAt`,
`createdAt` — confirmed by also comparing a `staging-shipments` dump for the
same order (#9952, read-only, no `src/` change — see Finding 2). This is
the evidence slice B's design call is built on.

Both `event` and `category` are real, present, distinctly-spelled fields —
settles the ticket's "category-vs-type" question: it's `category`, not
`type`, and both fields coexist (not either/or).

## Findings

**1. Fulfilment produces ZERO `TRANSACTION#` rows on `staging-orders-v2`.**
`#9929`/`#9932`/`#9935` are genuinely `FULFILLED` in `staging-shipments`
(confirmed live, real tracking numbers: `111JD885844401000931501`,
`111JD885844902000931503`, two items on #9935 both `111JD8858455/45401...`)
yet each order's `staging-orders-v2` row set carries only the original
`CREATE_ORDER` transaction. Fulfilment-related events live exclusively on
`staging-shipments` (confirmed separately, see Finding 2) — a reader/verify
module built against `staging-orders-v2` should not expect any
fulfilment-outcome event there. Relevant for TAA-52 (verify, later): don't
assert a fulfilment transaction on the orders-v2 side.

**2. A successful reject-and-reallocate (no undeliverable outcome) also
produces ZERO extra `staging-orders-v2` rows.** `#9947` (and the seven
byte-identical siblings above) show only `CREATE_ORDER` — the
`SHIPMENT_REJECTED`/`SHIPMENT_ITEM_REJECTED`/`REALLOCATION` events already
known to live on `staging-shipments` (TAA-31 slice G) do not echo onto
`staging-orders-v2` at all, unless the reject resolves to `UNDELIVERABLE`
and triggers a real Shopify refund (`#9952` — see below). So "the reject
path" has no direct `staging-orders-v2` signature; only its *refund
consequence*, when one occurs, does.

**3. `staging-shipments` TRANSACTION# rows share the exact same envelope
shape as `staging-orders-v2`'s** — `PK`/`SK`/`event`/`category`/`origin`/
`idempotencyId` all present on both, confirmed by a read-only comparison
dump against order #9952's `staging-shipments` rows (10 rows:
`SHIPMENT_ITEM_CREATE`/category `CREATION`, `REALLOCATION`/`UPDATE` x2,
`SHIPMENT_ITEM_ALLOCATED`/`ALLOCATION` x2, `SHIPMENT_CREATE`/`CREATION`,
`SHIPMENT_REJECTED`/`REMOVAL`, `SHIPMENT_ITEM_REJECTED`/`REMOVAL`,
`SHIPMENT_ITEM_UNDELIVERABLE`/`UPDATE` x2, `SHIPMENT_ITEM_REMOVED`/`REMOVAL`
x2). The existing `TransactionRow` interface in `dynamoReader.ts` (TAA-31
slice G) only captures `sortKey`/`event`/`shipmentItemInfo`/`raw` — it
under-models the real envelope, which also carries `PK`/`category`/
`origin`/`idempotencyId` on every row, on both tables. **This is the
evidence slice B's design call rests on** — see slice B's sign-off for the
decision this produces.

**4. `origin` on a `staging-orders-v2` row is always the Shopify origin
string** (`"US#SHOPIFY_ECOM#..."`/`"PS#SHOPIFY_ECOM#..."`); on
`staging-shipments` rows `origin` instead names the **internal system**
that emitted the event (`SHIPPING_SERVICE`, `DC_PACKING`, `ORDERS_SERVICE`)
— same field name, different meaning per table. Worth a type-level comment
in slice B so a future reader isn't confused by the field carrying two
different kinds of value depending on which table it came from.

**5. Two-table model — CONFIRMED, not contradicted.** Nothing captured
here shows an orders-service event appearing on the shipments table or vice
versa; PK resolution via `origin_index` worked identically for both new
US orders and the PS order. No hard-stop triggered.

## No gap to record for `refund`

The ticket's explicit worry — "refund especially" might not be coverable
from existing orders — turned out **fully covered**: `#9865` (full
undeliverable) and `#9866` (partial undeliverable) both carry real
`REFUND_ITEM` rows, and `#9865` additionally carries `REFUND_SHIPPING`
(present only when the whole order — not just one item — ends up refunded).
`#9952` (reject → undeliverable) independently confirms the same shape.
**No order was burned to fill this — all three already existed.**

## Verification

`npm run build` + `npm test`: **327/327 green**, unchanged from the TAA-46
baseline — this slice touches no `src/readers/`, `src/verify/`, or
`tests/` file, only adds one new probe script and fixture data.

## Checklist

- [x] Read-only capture run against burned orders from every required path
      (fulfil, reject, undeliverable/refund) plus cross-store (PS) and the
      newest TAA-46 orders
- [x] Fixtures committed (`fixtures/orders-v2/*.json`, 10 files, pruned of
      redundant near-duplicates)
- [x] Drift table written (above, and duplicated in the ticket-facing
      section below)
- [x] `npm run build` + `npm test` green, no `src/` changes
- [x] No new orders burned
- [x] No hard stop triggered — two-table model confirmed, not contradicted

## Not done, deliberately

No reader, no types, no tests against these fixtures yet — that's slice B.
No assertions/verify module — that's TAA-52, out of scope for this whole
ticket (see the final TAA-48 sign-off for the explicit scope-boundary
statement).

## Handback

Branch `taa-48-capture`, cut from `main` @ `2b2f719`. One commit to make:
`src/probe-orders-transactions.ts` + compiled `dist/probe-orders-transactions.js`
(new), `fixtures/orders-v2/*.json` (new, 10 files), this sign-off (new).
Not pushed, not merged. Slice B (`taa-48-reader`) cuts from this branch's
tip.

## Ticket-facing drift summary (for pasting into TAA-48 if JJ wants it there)

`staging-orders-v2` TRANSACTION# rows carry `event` **and** `category` as
separate fields (not type-vs-category — both exist). Three event spellings
observed to date: `CREATE_ORDER` (category `CHARGE`), `REFUND_ITEM`
(category `REFUND`, only when at least one item goes `UNDELIVERABLE` and is
refunded), `REFUND_SHIPPING` (category `REFUND`, only when the *whole*
order's shipping is refunded, not a partial). A successful reject/
reallocate with no undeliverable outcome produces no additional row on this
table at all — its signature is entirely on `staging-shipments`.
