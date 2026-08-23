# TAA-36 sign-off (2026-08-23) — fulfilment slice C, one command fulfils a whole order

Branch `taa-36-fulfil-order`, worktree `/Users/james.johnston/Documents/GitHub/qa-taa-36`,
cut from `main` @ `1146374` (TAA-35 + TAA-41 docs). Owned files per the ticket:
`src/cli-fulfil.ts`, `src/index.ts` (unchanged — already dispatched `fulfil` correctly),
new `src/flows/fulfilFlow.ts`. `readers/dynamoReader.ts` and `config.ts` untouched, as
instructed (read-only / TAA-37's file this session).

**One additive change outside the strictly-listed owned files, flagged per the ground
rules:** `src/clients/shopify.ts` gained one new method, `findOrderIdTailByName()`, plus
one new query constant (`ORDERS_BY_NAME`). Nothing else in `shopify.ts` was touched. This
was necessary because the CLI surface takes an order **name** (e.g. `9928`) as well as a
raw numeric id, and only Shopify can resolve a name to the GID `origin_index` needs — no
other lane this session claimed `shopify.ts`, and this follows the project's own stated
convention ("prefer extending existing clients over re-porting logic," per CLAUDE.md's
TAA-15 precedent of adding `fetchPickupLocations` to the same client rather than
duplicating it elsewhere).

## Build/tests

`npm run build` clean. `npm test`: **217/217 green** (192 baseline + 25 new: 3
`shopify.test.js` for `findOrderIdTailByName`, ~22 `fulfilFlow.test.js` for the pure
resolution/predicate logic and the end-to-end `fulfilOrder` orchestration against fake
readers/clients — no network in the offline suite). `cli-fulfil.test.js` was rewritten,
not extended — see "CLI surface change" below.

## CLI surface change — TAA-34's `--shipment`/`--item` mode is gone, not kept alongside

`node dist/index.js fulfil --order <name|id> --store <US|PS>` is now the **only** fulfil
surface; the old hand-driven `--shipment <uuid> --item ITEM#<uuid>` mode from TAA-34 was
removed rather than kept as a second mode. Reasoning, not just following the ticket's CLI
line literally:

- The ticket's dead-code fix ("replace the tracking-number scrape with fulfil -> poll the
  row -> print from the row") is only implementable with an order's PK, and the manual
  mode had no order context by design (TAA-34 deliberately made no DynamoDB reads, to
  prove the endpoint contract in isolation). There is no GSI on `staging-shipments` — you
  cannot poll a shipment row without first knowing the order's PK. Keeping the manual mode
  meant either leaving the dead code in place or CLI surface complexity with no live path
  to fix it.
- The ticket's own framing — "one command takes an order and fulfils every shipment on
  it, with no hand-supplied ids" — reads as the replacement goal, not an addition.

The underlying client logic the manual mode exercised (`FulfilmentClient`,
`buildFulfilPayload`, `formatFulfilledAt`) is untouched and still fully covered by
`tests/fulfilment.test.js` — only the CLI entry point changed. If hand-driven single-shipment
debugging is ever needed again, `clients/fulfilment.ts` is still directly usable from a
one-off script.

## Order identifier resolution (`fulfilFlow.ts`)

`--order` accepts a Shopify order display name (`9928` or `#9928`) or the numeric tail of
its GID (`7772060320017`) or a full `gid://...` — `parseOrderIdentifier` classifies by
length: real order names observed in this shop are ~4 digits, real GID tails are ~13
digits, so a threshold of 8 gives wide margin without a network call for the common case
of an already-known numeric id. A name is resolved via the new
`ShopifyClient.findOrderIdTailByName` (an `orders(first: 1, query: "name:<name>")` lookup),
throwing if nothing matches. All pure/offline-tested except the actual network call.

## The settle waits — kept separate, as instructed

Two windows, both local constants in `fulfilFlow.ts` (not `config.ts`/`PollWindows` — that
file is TAA-37's this session; move these in once it's unlocked and the numbers below are
agreed):

```
ITEM_SETTLE_WINDOW_SECONDS = 60,  ITEM_SETTLE_INTERVAL_SECONDS = 2
FULFILMENT_SETTLE_WINDOW_SECONDS = 90,  FULFILMENT_SETTLE_INTERVAL_SECONDS = 2
```

`FULFILMENT_SETTLE_*` reuses TAA-41's measured 90s window (still a wide margin — see live
numbers below). `ITEM_SETTLE_*` had never been measured by anyone before this slice; 60s
was a first guess, then instrumented live (see next section) — kept as-is, not tightened,
per the project's own convention of not shrinking a window on thin samples.

### Live finding — row count settling and shipment-id assignment are NOT the same event

This is the important part of the slice, caught only by testing against real timing, not
on paper, exactly as the ticket asked for.

My first implementation of `itemCountsSettled` checked only that the number of landed
`ITEM#` rows in `staging-shipments` reached the order's total unit count (from
`staging-orders-v2`). That is **wrong**, confirmed live:

Order **#9937** (`33898889` x3, single location, US) was fulfilled with the fulfil call
fired as fast as possible after order creation (no artificial wait). At **t=4.1s**, all
3 `ITEM#` rows had landed (row count matched the order's 3 units) — **but all three still
had `shipmentId: null`**. `groupItemsByShipment` correctly produced **zero groups**, and
the naive predicate would have called it "settled," built zero payloads, called
`/staging/fulfil` zero times, and reported success on an order with nothing fulfilled —
silently worse than the short-payload risk the wait exists to prevent, because a short
payload at least fulfils *something* wrong, a zero-payload run fulfils *nothing* and looks
clean.

Fixed before this was ever run against a shared order: `itemCountsSettled` now requires,
per item, `shipmentId !== null OR status === UNDELIVERABLE` (UNDELIVERABLE items never get
a `shipmentId`, so that's the correct terminal condition, not a bug). Re-ran the fix
against the still-in-flight #9937 a couple of minutes later — by then it had settled for
real, grouped into 1 shipment (3 items), fulfilled cleanly. Added the reproducing case
directly to `tests/fulfilFlow.test.js` (`itemCountsSettled is false while row count matches
but a row has not been assigned a shipmentId yet`) so this can't regress silently.

**Decision on formal-stage vs inline (the ticket's explicit ask):** kept inline in
`fulfilFlow.ts`, not promoted to a `PollWindows`/`progress.ts` stage. This wait is CLI-only
(not part of the regression runner's stage-sequencing engine), and the one real
measurement (4.1s to fully resolve row-count-and-shipment-id together) is far inside the
60s window — no evidence yet that it needs its own progress-tracker treatment. Revisit if
TAA-39 wires this into the regression suite proper.

## Mandatory pre-fulfil FULFILLED check (TAA-41) — confirmed working live, not just offline

Re-ran `fulfil --order 9930` (and again via its raw numeric id, `7881452618001`) against a
shipment already fulfilled earlier in this same session. Both times: `SKIPPED_ALREADY_FULFILLED`,
**no `fulfilment_settle` poll line appeared at all** (the tell that `/staging/fulfil` was
never called), and the reported `trackingNumber` was byte-identical to the original
(`111JD885844801000931509`) — proof the guard fired before any network call, not just that
the tracking number happened not to change. This is the one check where "confirmed offline"
was not going to be enough given TAA-41's finding that the backend provides zero protection.

## Live runs (US, all real staging orders — every fulfil call burns a real Auspost label)

Spare orders placed and consumed this session, none shared with other lanes:

| Order | SKU(s) | Shipments | Outcome |
| --- | --- | --- | --- |
| **#9930** (`7881452618001`) | `33660301` x1 | 1: `03d5faa4-78e7-4afc-8f3b-27ffdf8ed98c` | FULFILLED, tracking `111JD885844801000931509`, settled 2.1s. Re-fired twice more later — both `SKIPPED_ALREADY_FULFILLED`, tracking unchanged (see above). |
| **#9932** (`7881453175057`) | `32625134` x1, `33006246` x1 | 1: `eea1ef14-0307-44be-91a6-7a34ec1caa20` (merged into one shipment at store 100 — see caution below, this was NOT the split case) | FULFILLED, tracking `111JD885844902000931503`, settled 6.1s |
| **#9935** (`7881457795345`) | `33413679` x1 @ ATP#100, `33946269` x1 @ ATP#99 | 2: `7848245d-c468-45dc-8dcd-b609d2a572df` (store 99), `6f3e40b4-812b-44b2-ae7e-f769601a5a1f` (store 100) | **This is the real split-fulfil proof.** Both FULFILLED independently in one CLI call — `111JD885845401000961507` and `111JD885845501000961504`, each settled 2.1s |
| #9936 (`7881460318481`) | `32357875` x1 | 1: `557ea8e8-db26-433e-9ed4-29020b8f55be` | FULFILLED, tracking `111JD885845801000931508`, settled 2.1s |
| **#9937** (`7881461465361`) | `33898889` x3 | 1: `4fe370d5-5028-401b-bb2d-eb57503c9059` (was `557ea8e8`-shaped mid-flight, see finding above) | FULFILLED, tracking `111JD885845903000931509`, item-settle 4.1s (real, in-flight measurement), fulfilment-settle 4.1s |

**Measured windows, all n small, kept generous per project convention:**
- Item-count settle: 0.0s (4 orders already allocated before the call) and one genuine
  in-flight measurement of **4.1s** (#9937). 60s window is a very wide margin on this one
  data point — worth re-measuring with more samples before ever tightening it.
- Fulfilment settle: **2.1s–6.1s** across 5 successful calls — consistent with, slightly
  above, TAA-41's own 6.5–9.0s (n=2). 90s window unchanged, margin if anything wider than
  TAA-41 assumed.

**Caution for future sessions sharing this staging SKU pool — real race hit live, not
theoretical.** First split attempt (`32625134` + `33006246`, the two most commonly-reused
"ad hoc spare" SKUs throughout this project's history) failed to split: seeded
`33006246` to 0 everywhere then 50 at `ATP#99` via a standalone script, then placed the
order in a **separate** process immediately after — by the time the order was created,
`ATP#100`'s stock for that SKU read **97**, not 0, and both items allocated to the same
shipment at store 100. Three parallel live sessions are sharing this exact 14-SKU pool
right now (per this session's own briefing); something (almost certainly another lane's
concurrent regression/ad-hoc run) rewrote that SKU's `ATP#100` stock in the ~1–2s window
between my zero and my order creation. Root-caused, not filed as a defect — this is
staging contention, not a harness bug. Fix: redid the split with two less-commonly-reused
SKUs (`33413679`/`33946269`) and did the seed-then-create-order sequence in a **single Node
process** (no separate CLI spawn in between) to shrink the race window as much as possible
— worked cleanly the second time. Worth remembering for TAA-37/38/39: the smaller the gap
between seeding inventory and creating the order, the safer, and the "everyone's default"
SKUs (`32625134`, `33006246`) are the most contested ones to reach for.

## Checklist

- [x] order -> order PK -> shipments -> grouped items (all real DynamoReader calls, no
      new Dynamo access built — reused `getOrderRows`/`getShipmentItemsByPk`/
      `getShipmentsByPk`/`groupItemsByShipment` from TAA-34/35 as instructed)
- [x] settle wait before building any payload, with measured timings recorded (see above
      — including the live-caught predicate bug, fixed before it ran against a real shared
      order)
- [x] pre-fulfil FULFILLED check, mandatory — confirmed live, not just offline
- [x] one fulfil call per shipment on the order
- [x] per-shipment outcome reported including tracking number read from the row
- [x] offline tests for the settle predicate and any new pure resolution logic (25 new
      tests, `fulfilFlow.test.js` + `shopify.test.js`)
- [x] npm run build + npm test green (217/217)
- [x] LIVE: one command fulfils a whole order (#9930, #9936, #9937) — and separately, a
      SPLIT order with two shipments across two stores (#9935, both shipments fulfilled
      independently with distinct tracking numbers in one CLI invocation)

Not in scope here, per the ticket: no assertion of fulfilled state (TAA-37, running in
parallel this session).

## For whoever picks up TAA-37/39 next

- `flows/fulfilFlow.ts` exports `FULFILLED_STATUS`, `itemCountsSettled`,
  `isAlreadyFulfilled`, `isFulfilmentSettled`, and the settle window constants — reuse
  these rather than re-deriving the same logic; `isFulfilmentSettled` in particular is the
  correct place to hang TAA-37's "did it actually land" assertion off of, though TAA-37
  should assert independently rather than trust this file's own poll succeeding as proof.
- `buildFulfilPayloadForShipment`'s reusability for TAA-31 (rejection) is unaffected — this
  slice only added an orchestration layer on top, didn't touch the payload builder.
- The `ITEM_SETTLE_*`/`FULFILMENT_SETTLE_*` constants should move into
  `config.ts`'s `PollWindows` once TAA-37 is merged and that file is unlocked — flagged in
  the file header too.
