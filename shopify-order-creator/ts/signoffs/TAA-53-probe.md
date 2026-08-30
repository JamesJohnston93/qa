# TAA-53 sign-off (2026-08-30) — admin-mutation probe, six contracts settled

One hand-driven session, scratch orders, pool slots 53+ (spare per the
TAA-46 slot map). Asserts nothing — no client code, no verify modules, no
cases, nothing wired into `cli.ts`/`index.ts`/`--help`. Probe script:
`ts/scripts/probe-admin-mutations.js` (new, this ticket), reusing
`ShopifyClient` for auth/API-version/throttle-retry and `DynamoReader`'s
existing `getOrderRows`/`orderPkFromRows` for order-PK resolution only.

**Deliberate omission, stated per the ticket:** this is a probe, not a
client. `clients/shopifyAdmin.ts` (TAA-55), the real flows (TAA-57), and the
orders-service cases (TAA-49/54/56/58) are separate, later tickets. A future
session should not find a half-built admin client here — there isn't one;
every mutation call in the probe script is an inline query string, thrown
away after this session's evidence is captured.

**Exact mutation/input/payload shapes were confirmed live via Admin GraphQL
introspection against API 2025-10 before firing anything** (transcript not
committed — throwaway `/tmp` scripts — but every field name below is
taken from a real introspection response, not the docs, which the ticket
flags as unreliable for this exact class of question). This caught two
real API surface changes worth recording: `draftOrderComplete` has **no**
`paymentPending` argument in this API version (only `id`,
`paymentGatewayId`, `sourceName`), and `FulfillmentHoldReason`'s real enum
is `AWAITING_PAYMENT, HIGH_RISK_OF_FRAUD, INCORRECT_ADDRESS,
INVENTORY_OUT_OF_STOCK, UNKNOWN_DELIVERY_DATE,
ONLINE_STORE_POST_PURCHASE_CROSS_SELL, AWAITING_RETURN_ITEMS, OTHER` — not
the wider set (`POTENTIAL_FRAUD`, `PENDING_INTERNAL_REVIEW`, etc.) that
appears in some Shopify docs/blog posts; those are the internal *reason
codes* the backend writes to DynamoDB, not the GraphQL enum a caller sends.

**Read raw, deliberately, per the ticket's instruction — not a new
reader.** `DynamoReader.getTransactionsByPk` reads `staging-shipments`
only; TAA-48 (landed mid-session, see below) is the real
`staging-orders-v2` transaction reader. This probe queries
`staging-orders-v2` directly via `DynamoClient.doc` + a raw `QueryCommand`,
filtering `SK` for the `TRANSACTION#` prefix — the exact pattern
`probe-reject.ts`'s `dumpTransactionRows` used for `staging-shipments`
(TAA-31). Temporary and deliberate; nobody should mistake it for the
permanent shape.

**Mid-session note: TAA-48 merged to `main` while this probe was running**
(`0e7b2b5`, `DynamoReader.getOrderTransactions`/`transactionRowsByEvent`,
widening the existing `TransactionRow` shape rather than a separate
reader). Not used for the main probe run (already in flight on raw reads
by the time it landed), but cross-checked once as a bonus sanity check:
`getOrderTransactions("US", "7899261468945")` (order #9986, the edit-chain
order) returned the identical four events in the identical order
(`CREATE_ORDER, REFUND_ITEM, HOLD_ORDER, ADD_ITEM`) as this probe's raw
dump. Byte-for-byte parity, one order, not exhaustively re-verified against
every order below — good enough to trust the raw reads' event spellings
below are not a probe-script artifact.

## Scope check — both apps, done first

`node probe-admin-mutations.js scopes --store <US|PS>`. Both apps
(`AWS OMS App` on US, `QA PS App` on PS) carry all **29** of the same
scopes. **Neither of the ticket's two named scopes is missing on either
app** — `write_order_edits`: present (US, PS); `write_returns`: present
(US, PS). Unlike TAA-22 (`read_products`) and TAA-46 slice A
(`MarketCatalog.markets`), this is a clean "none found" for the named risk.

**One unrelated gap found incidentally, not one of the two named scopes:**
reading `Order.paymentTerms` throws `Access denied for paymentTerms field.
Required access: read_payment_terms access scope` on US (field dropped
from the probe's dump query rather than worked around; not tested on PS,
but the scope lists are identical so almost certainly the same). The write
side of the same gap surfaced separately below (payment-priming section) —
`payment_terms` (read or write) is not in either app's 29-scope list at
all. Not chased — outside the two scopes the ticket named, and nothing in
this harness currently needs `Order.paymentTerms`.

## The six contracts

| # | Mutation(s) | Succeeded | TRANS# row landed | Event spelling | Latency (mutation → row) |
|---|---|---|---|---|---|
| 1 | `orderEditBegin`→`AddVariant`→`SetQuantity`→`AddLineItemDiscount`→`Commit` | Yes, all 5 steps, no userErrors | Yes — **as three separate rows**, not one | `REFUND_ITEM` (implicit refund from the quantity reduction), then `HOLD_ORDER` (`onHoldChanges.added:["OUTSTANDING_PAYMENT"]`, a side effect of adding an unpaid item to a paid order), then `ADD_ITEM` (the new line item, discount folded into its `grandTotal`, no separate discount event) | Staggered, not atomic: ~15-20s, ~37s, ~42s after commit (three independent webhook deliveries, not one) |
| 2a | `refundCreate` **with** `refundLineItems` | Yes | Yes | `REFUND_ITEM` | ~10-16s |
| 2b | `refundCreate` **without** `refundLineItems` (manual `transactions` entry referencing the SALE tx as `parentId`) | Yes | Yes, **plus** a follow-on hold | `REFUND_ORDER_UNTARGETED`, then `HOLD_ORDER` (`OUTSTANDING_PAYMENT`) ~3.5s later | ~6-10s for the refund event |
| 3 | `fulfillmentOrderHold` + `fulfillmentOrderReleaseHold` | Yes, both | Yes, both | `HOLD_ORDER` (`onHoldChanges.added`) / `UNHOLD_ORDER` (`onHoldChanges.removed`) — reason spelling **translates**: GraphQL enum `HIGH_RISK_OF_FRAUD` in, DynamoDB reason string `POTENTIAL_FRAUD` out | ~5-10s each |
| 4 | `fulfillmentOrderMove` | Yes (to a genuinely stock-movable location; the first attempt at a non-stocked location correctly failed with a real Shopify userError, not a probe bug) | **No** — 0 new rows in 60s | n/a | n/a (timed out the poll window) |
| 5 | `returnCreate` + `returnClose` | Yes, both (`return.status` OPEN→CLOSED, `order.returnStatus`→`RETURNED`) | **No** — 0 new rows after 60s **and** a later re-check past 5 minutes | n/a | n/a |
| 6 | `orderMarkAsPaid` | Yes | Yes | `UNHOLD_ORDER` (`onHoldChanges.removed:["OUTSTANDING_PAYMENT"]`, `paymentChanges.payments` now populated) — preceded by an automatic `HOLD_ORDER` (`OUTSTANDING_PAYMENT`) the moment the unpaid order landed, ~6.7s after `CREATE_ORDER` | ~27s from the automatic hold to the post-markAsPaid unhold |

**Reading #1 and #6 together:** the same `HOLD_ORDER`/`UNHOLD_ORDER`
`OUTSTANDING_PAYMENT` mechanism fires in three different places this
session — an edit that adds an unpaid item (#1), an appeasement refund
that creates a payment/refund mismatch (#2b), and a genuinely-unpaid order
at creation (#6) — always the same event pair, same reason string. This is
one mechanism, not three, and it settles the LLD's "hold polarity" note
(outstanding payment ⇒ on hold, Shopify clearing it flows through to AWS)
empirically rather than by inference.

**#4 and #5 both succeeded on Shopify's side and produced zero DynamoDB
signal.** For #4, this matches the LLD's own flag on TC24 almost exactly —
"`fulfillment_orders/moved` fires on every allocation" being a real
filter test — except this result is the *inverse* of TC24's framing: TC24
expects a **non-CC** move to be filtered (asserted absent deliberately);
what's recorded here is that the **only** move attempted in this session
(to "Default Holding Location — DO NOT USE", not a CC-tagged store) was
filtered, consistent with the theory that only click-and-collect-relevant
moves are ingested. Not proven — no CC-tagged move was attempted (that's
TAA-32/D4 territory) — but consistent. For #5, `returnClose` alone (no
attached refund) may simply not be the trigger the ingest lambda watches
for; a real return normally closes *with* money movement
(`returnRefundCreate` or a refund tied to the return), which this probe
did not attempt. Recorded as "not observed within this test," not as "the
contract is broken" — a case-design question for TAA-58 (D3), not a defect.

## The payment-priming sequence, settled empirically (item a)

**The `draftOrderComplete` path used everywhere else in this harness
cannot produce an unpaid order at all** in this API version:
`draftOrderComplete` has no `paymentPending` argument (confirmed by
introspection), and every order it creates through
`ShopifyClient.createDraftOrder` lands **immediately `PAID`** — confirmed
live, order #9986, `displayFinancialStatus: PAID` in the very first dump
after creation, with no explicit payment-terms input given at all.

**The obvious next lever — `DraftOrderInput.paymentTerms` (a NET-30
template) — is scope-blocked**, not merely unset: `draftOrderCreate`
returned `userErrors: [{message: "The user must have access to set
payment terms."}]` with no draft order created at all. `payment_terms` is
not in either app's scope list (see the scope section above) — this is a
second, more concrete manifestation of the same gap the incidental
`read_payment_terms` finding surfaced.

**Worked around for this probe only, via a different Admin API path:**
`orderCreate` (not `draftOrderCreate`/`Complete`) accepts
`financialStatus: PENDING` directly and needs no payment-terms scope —
confirmed live, order #9992, `displayFinancialStatus: PENDING`
immediately after creation. This is a genuinely different order-creation
mutation from the one this harness's `order` subcommand and regression
suite use everywhere else — **not proposed as a replacement**, used here
only because it was the one path available to produce an unpaid order at
all under this app's current scopes.

**The sequence tested: `orderCreate(financialStatus: PENDING)` →
`orderMarkAsPaid`, no intermediate mutation.** Result: **clean success, no
lambda errors observed.**
`CREATE_ORDER` (unpaid, `paymentChanges.payments: []`) → automatic
`HOLD_ORDER` (`OUTSTANDING_PAYMENT`) ~6.7s later → `orderMarkAsPaid` call →
`UNHOLD_ORDER` (`OUTSTANDING_PAYMENT` removed, `paymentChanges.payments`
now populated) ~27s after the hold.

**This does not reproduce JJ's "out-of-order causes lambda errors" claim,
and the specific custom codes he referenced could not be identified from
this repo** — grepped for "custom code", "priming", "ingest lambda" across
the whole `qa` tree, no hits outside this session's own notes. Three
possible explanations, none confirmed: (1) the priming requirement is
specific to the `draftOrderCreate`/`Complete` webhook path (which this
probe could not reach at all, being scope-blocked), not the `orderCreate`
path actually tested; (2) it depends on an order shape not exercised here
(this order was a single simple line item — the accidentally-picked SKU
`34074855`, slot 63, turned out to be a **gift card product**, `deliveryMethod:
DIGITAL` — noted as a pool-selection surprise, not a defect, but flagged in
case it explains something); (3) the requirement no longer applies. **Left
open for JJ** — the empirical answer this ticket can give is "the plain,
unprimed path worked cleanly once, on this order shape, on this API path,"
not "priming is unnecessary in general."

## refundCreate idempotency on 2025-10 (item b)

**`RefundInput` has no idempotency-key field in its schema at all**
(confirmed by introspection — the full field list is `currency, orderId,
note, notify, shipping, refundLineItems, refundDuties, transactions,
refundMethods, discrepancyReason, allowOverRefunding`). Whatever "the
2026-04 idempotency key" in the ticket refers to, it is not a GraphQL
input field on this mutation in 2025-10.

**Tested the HTTP-header mechanism instead** (raw `fetch`, US only,
static token — same host/auth `ShopifyClient` uses, just with an added
`Idempotency-Key` header, since `ShopifyClient.execute()` doesn't expose
custom headers and wasn't modified to add one): fired the identical
targeted-`refundCreate` payload twice, same `Idempotency-Key` header value,
back-to-back (order #9993).

- Call #1: HTTP 200, refund created (`gid://shopify/Refund/1057487716625`).
- Call #2 (same key): HTTP 200, but **not deduplicated** — processed as a
  genuinely independent request and rejected on ordinary business logic
  (`"Quantity cannot refund more items than were purchased"`, since call
  #1 had already consumed the refundable quantity).

**Answer: no, `refundCreate` does not honor an `Idempotency-Key` header for
deduplication on API 2025-10**, at least not via this mechanism as tested.
A genuine retry with the same key still executes independently rather than
returning the first call's cached result. If Shopify's idempotent-request
system requires a different signal (a request-scoped token elsewhere, a
different header name, or opt-in per app) that wasn't attempted — only the
one plausible mechanism (a repeated `Idempotency-Key` header) was tested.

## Orders burned

Full order-by-order detail (SKU, pool slot, purpose, notable state) is in
`CLAUDE.md`'s "TAA-53" section, updated as each order was placed. Summary:

| Order | Store | Slot(s) | SKU(s) | Purpose |
|---|---|---|---|---|
| #9986 | US | 53, 54 | `33951607` x2, `33982632` x1 (added) | Edit chain |
| #9987 | US | 55 | `31589901` x2 | Targeted refund |
| #9988 | US | 56 | `34021491` x1 | Untargeted refund |
| #9989 | US | 58 | `33873053` x1 | Hold + release |
| #9990 | US | 59 | `34019825` x1 | Move |
| #9991 | US | 61 | `34080184` x1 | Return create + close |
| #9992 | US | 63 | `34074855` x1 (gift card, unexpectedly) | `orderCreate(PENDING)` + markAsPaid |
| #9993 | US | 64 | `33652283` x1 | refundCreate idempotency-key double-fire |
| #3322 | PS | 53 | `33413587` x2 | Hold + release + targeted refund (cross-store confirm) |

**PS confirmation deliberately partial, per the TAA-46 slice B precedent**
(a definitive result on one store needs no second-store confirmation to
generalise, since the mechanism under test is Admin API behaviour, not a
store-specific config difference) — PS was spot-checked on hold/release/
refund only (#3322), all three byte-for-byte matching US's event
spellings and latency profile. Edit/move/return/markAsPaid were not
re-run on PS; nothing in what was tested suggests a store-specific
divergence would appear there that didn't already appear in the scope
check (which *was* run on both apps in full).

## Checklist

- [x] Six-contract table: mutation, TRANS row observed or not, event
      spelling, latency (or blocked-on-scope) — none of the six were
      blocked on scope; two (#4 move, #5 return) succeeded on Shopify but
      produced no observed DynamoDB signal, recorded as such
- [x] Payment-priming sequence: exact mechanism tested and documented,
      including where it could not be reached (scope-blocked) and what
      remains unresolved (JJ's specific custom codes)
- [x] refundCreate idempotency-key question answered for 2025-10 (no
      schema field exists; the HTTP-header mechanism was tested and found
      not to deduplicate)
- [x] Scope gaps checked on both apps for the two named scopes — none
      found; one unrelated gap (`payment_terms`) recorded incidentally
- [x] Orders burned recorded in `CLAUDE.md` as they were placed, not
      after the fact
- [x] No client code, no assertions, no tests, no wiring added

## Deliberately not done

No `clients/shopifyAdmin.ts` (TAA-55), no flows (TAA-57), no orders-service
cases (TAA-49 and children), no verify modules (part of TAA-44/TAA-52), no
click-and-collect move (TAA-32/D4 territory — needed to confirm the move
filter theory, not attempted here), no `returnRefundCreate` (would be
needed to test whether a return *with* money movement lands differently
than the bare `returnClose` tested here). All named in the LLD as later
work, not this ticket's scope.

## Handback

Hand-run session, no dedicated branch cut — probe script
(`ts/scripts/probe-admin-mutations.js`) and this sign-off are the only
`src`-adjacent additions, plus the `CLAUDE.md` "TAA-53" section recording
orders as they were burned. `npm run build && npm test`: **334/334
green** (327 + TAA-48's 7 new tests, which landed on `main` mid-session
from a concurrent session — this ticket added zero new tests, per the
ticket's "should not change the 327 count" instruction, now read as "this
ticket's own work changed nothing," since the baseline itself moved for
an unrelated, already-merged reason). TAA-55 (the real admin client) can
proceed directly from the six-contract table above — every mutation's
exact field shape is already confirmed, no further introspection needed.
