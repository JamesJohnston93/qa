# Result: Slice 02, tool fidelity gate

**Ticket:** BUSY-1161
**Verdict:** Two real fidelity gaps found and fixed in `../../tools/cin7-sales-orders/invoke-so-revision.sh`
(JJ's explicit call on both). One documentation bug found, not fixed (flagged for Kian). One known,
narrow limitation (`orderId`) noted and left as is (JJ's call). Order-type substitution otherwise
clean. One real create-then-update emit landed through the whole chain to SCALE. Proceed to slice 03.

Read only for steps 1-3; step 4 emitted, reaching Manhattan SCALE staging. Poller schedule stayed
DISABLED, SO watermark stayed UNSET throughout, confirmed unchanged at the end. AWS SSO session
remained valid throughout, no fresh login needed.

## Step 1, the deployed builders, measured in full

Read `staging-orders-cin7-so-poller` directly via `../../tools/inspect-lambda-code.sh`
(`--search function buildCreateOutboundOrderCommand,function buildUpdateOutboundOrderCommand,function
buildCancelOutboundOrderCommand,function buildOutboundOrderCommand,async function emitRevision,async
function refuseOrEmit,function deriveShipTo(order)`). All three named builders exist, confirming
BUSY-1160 slice 08's naming rather than assuming it.

**`buildCreateOutboundOrderCommand`/`buildUpdateOutboundOrderCommand`** are both thin wrappers over
one shared `buildOutboundOrderCommand(options, event)`; only the literal `event` string differs
between them. MEASURED, verbatim field set:

```
pushToEventBus(EVENT_BUS_NAME, "CREATE_TRANSACTION", command, "orders-cin7.cin7-so-poller.lambda")
```
* `EventBusName`: `staging-orders-v2-event-bus` (MEASURED, the poller's own `EVENT_BUS_NAME` env var)
* `Source`: `"orders-cin7.cin7-so-poller.lambda"`, constant regardless of verb
* `DetailType`: `"CREATE_TRANSACTION"`, constant regardless of verb — **the verb travels in
  `Detail.event`, not `DetailType`**, same two-stage pattern BUSY-1160 already measured on the
  native side
* `Detail` (the `command` object):
  ```
  {
    orderId,              // uuid5('order:CTC:' + reference) -- deterministic, derived not minted
    origin,                // `${CTC_STORE}#${CIN7_SO_ORIGIN}#${reference}`
    idempotencyId,          // `${event}#${origin}#${order.modifiedDate}#${hashPayload(order)}`
    message_group_id: orderId,
    ...customerEmail && { customerEmail },   // conditional on order.email
    outboundOrderInfo: {
      store, originSystem, originId, cin7Id, orderType, warehouse, carrier,
      allocateComplete,     // "Y" if orderType === "WHOLESALE" else "N"
      shipTo,                // deriveShipTo(order): order.deliveryCompany, else
                             // "firstName lastName", else throws (refuses an empty ShipTo)
      shipToAddress,         // deriveShipToAddress(order): name?, street1, street2?, city,
                             // state? (mapped), postalCode?, country? + countryCode?, email?
      orderedAt: order.createdDate,
      sourceStatus: order.status,
      sourceStage: order.stage,
      lastModified: order.modifiedDate,
      ...scheduledShipDate,  // conditional on order.estimatedDeliveryDate
      ...customerOrderNo,    // conditional on order.customerOrderNo
      lastEmittedPayloadHash // sha256(JSON of {orderType, warehouse, carrier, allocateComplete,
                             //   shipTo, shipToAddress, scheduledShipDate, customerOrderNo,
                             //   customerEmail, lines: sorted "lineId::sku::quantity"}).slice(0,8)
    },
    outboundItemInfo: [ { SK: `ITEM#${lineId}#${sizeCode}`, lineId, sku, quantity }, ... ],
                             // one row per size, expandLineItems2, skips sizeless lines and
                             // zero/negative qty (warns on negative)
    category: "OUTBOUND",
    event                    // "CREATE_OUTBOUND_ORDER" | "UPDATE_OUTBOUND_ORDER"
  }
  ```

**`buildCancelOutboundOrderCommand`** is a separate, materially smaller function, not a wrapper over
the shared one. MEASURED, verbatim:

```
{
  orderId,
  origin,
  idempotencyId: `CANCEL_OUTBOUND_ORDER#${origin}#${order.modifiedDate}#${hashPayload(order)}`,
  message_group_id: orderId,
  category: "OUTBOUND",
  event: "CANCEL_OUTBOUND_ORDER",
  outboundOrderInfo: {
    store, originSystem, originId, cin7Id, orderType, warehouse, carrier,
    allocateComplete, orderedAt, sourceStatus, sourceStage, lastModified
    // no shipTo, shipToAddress, scheduledShipDate, customerOrderNo, lastEmittedPayloadHash
  },
  outboundItemInfo: []          // ALWAYS empty, regardless of the order's own line items
  // no customerEmail key at all, not even conditionally
}
```

`deriveShipTo`: `order.deliveryCompany` if present, else `"${deliveryFirstName} ${deliveryLastName}"`
trimmed, else throws (`"...refusing to map an empty ShipTo to SCALE"`). Matches BUSY-1160 slice 08's
finding exactly.

## Step 2, dry-run diff against the measured shapes

**CREATE and UPDATE, as the tool stood before this session's fix:** field-for-field identical to the
measured shape above with exactly **one** difference: the tool wrote the order-date field as
`orderDate`, the deployed builder writes `orderedAt`. Confirmed this is not cosmetic: the persisted
`ORDER` row for the order this slice created (`982409Aug26`) carries **neither** key — the handler's
`saveUnknown:false` schema drops an unrecognised field silently on save (raw
`dynamodb query` against `staging-orders-v2`, `ORDER` row, checked directly). Every other field,
including the conditional ones (`scheduledShipDate`, `customerOrderNo`), the `shipToAddress` nested
shape, and the envelope (`Source`/`DetailType`/bus/`category`/`event`), matched.

**CANCEL, as the tool stood before this session's fix: did not match at all.** The tool built it
from the identical `buildOutboundOrderCommand`-shaped template as CREATE/UPDATE, just swapping the
`event` string. Dry-running `08-ineligible-declined` with `--event auto` against the real order this
slice had already created (order present, scenario ineligible -> resolves to
`CANCEL_OUTBOUND_ORDER`) sent `outboundItemInfo` with all 13 of that scenario's line items and a full
`outboundOrderInfo` carrying `shipTo`, `shipToAddress`, `scheduledShipDate`, `customerOrderNo`,
`lastEmittedPayloadHash` and a top-level `customerEmail` — none of which the deployed cancel builder
ever sends. This is not a narrow gap: it means every case exercising an outbound cancel through this
tool (TC7a, TC7b, TC13) would have been proving behaviour against a transaction shape the real system
never produces.

**Both fixed in this session, JJ's explicit call for each** (asked before changing anything, see the
questions this slice raised). Patched `invoke-so-revision.sh`:
* `'orderDate'` -> `'orderedAt'` in the shared create/update branch.
* Added a dedicated branch for `event == CANCEL_EVENT`, mirroring the deployed builder's minimal
  shape exactly: no `shipTo`/`shipToAddress`/`scheduledShipDate`/`customerOrderNo`/
  `lastEmittedPayloadHash`, `outboundItemInfo` forced to `[]`, no `customerEmail` key.

**Re-run after the fix**, same inputs:
* CREATE (`02-size-qty-increased`, dry-run): `outboundOrderInfo` now carries `orderedAt`, not
  `orderDate`. Every other field unchanged and still matching.
* CANCEL (`08-ineligible-declined`, auto, against the real order): now produces exactly the measured
  shape above, verbatim — `outboundItemInfo: []`, `outboundOrderInfo` limited to `store`,
  `originSystem`, `originId`, `cin7Id`, `orderType`, `warehouse`, `carrier`, `allocateComplete`,
  `orderedAt`, `sourceStatus`, `sourceStage`, `lastModified`, no `customerEmail` key.

Full detail, including the exact before/after JSON, is in `TOOL-NOTES.md`.

**Not fixed, JJ's call: `orderId` is a random UUID4 on every `CREATE`**
(`order_id = order_id or str(uuid.uuid4())`), not the deployed poller's deterministic
`uuid5('order:CTC:' + reference)`. Confirmed by running the same `CREATE` dry-run twice against the
identical reference and getting two different `orderId` values both times, before touching anything
else. `UPDATE`/`CANCEL` correctly read back and reuse whichever `orderId` a prior `CREATE` actually
persisted (confirmed: the auto-resolved `UPDATE`/`CANCEL` dry-runs above both carried the real
persisted `orderId`, `23adfe1c-b10a-4122-b5e7-bc7cbb4a52fb`, not a fresh random one), so one
synthetic order stays internally self-consistent across its own revisions. The value simply never
matches what a real Cin7-sourced poller cycle would have derived for that reference. No case in this
plan asserts `orderId`'s value or derivation, so this is recorded as a known, narrow tool limitation
and not fixed.

The `idempotencyId`'s trailing hash segment (`hashPayload(order)` deployed side, a
`sha256(JSON.dumps(order)).hex()[:8]` in the tool) and `lastEmittedPayloadHash`/`mappedPayloadHash`
cannot be verified equal without a code read of the deployed `hashPayload`/`hashMappedPayload2`
implementations, which this gate did not do. Per BUSY-1160's established caveat: a case needing a
hash merely to be new or different is fine; a case depending on its exact value is out of reach.

## Step 3, the order-type substitution

**The tool's own header comment (line ~44) shows a broken example.** `--scenario
02-size-qty-increased --order-type RTV` (no `--family`), run exactly as documented, fails:
`--order-type RTV contradicts '02-size-qty-increased', which lives in the WHOLESALE directory.` The
validation is deliberate (`"the directory is the order type... an explicit --order-type that
disagrees with it is a contradiction, not a preference"`), so this is not a flag ordering mistake on
this session's part — the documented invocation genuinely cannot produce a substituted RTV entry
from a wholesale-directory scenario name.

**A working path exists, undocumented: pass the scenario as an explicit file path.**
`--scenario fixtures/wholesale/02-size-qty-increased.json --family outbound --order-type RTV
--event CREATE_OUTBOUND_ORDER --dry-run` succeeds, because the path branch never calls the
directory-resolution function the contradiction check depends on. Diffed against the same scenario
run as WHOLESALE:

* `orderType`: `"WHOLESALE"` -> `"RTV"` (expected)
* `allocateComplete`: `"Y"` -> `"N"` (expected)
* `lastEmittedPayloadHash`: differs (expected — it is computed over `orderInfo` including
  `orderType`/`allocateComplete`, so any content difference changes it; this hash is internal
  echo-guard state, not a field forwarded to SCALE)
* `orderId` / `message_group_id`: differ (expected noise — each dry-run invocation mints a fresh
  random `orderId` per the limitation above, unrelated to order type)
* Nothing else differs. `shipTo`, `shipToAddress`, every item row, `scheduledShipDate`,
  `customerOrderNo` all identical between the two runs.

**Reads as: the underlying mapping genuinely is generic to both order types**, matching what
CLAUDE.md and PLAN.md claim for TC5d — only the documented invocation to reach it is wrong. **Not
fixed** — the path form is a legitimate, working mechanism, not a bug to patch out, so the fix here
is a documentation correction (the header's own example), not a code change. Flagged for Kian in
`TOOL-NOTES.md` rather than edited here, since it is his comment wording. **TC5d must be driven by
passing the RTV substitution scenario as a path, not by the bare scenario name the tool's header
currently shows** — carrying this forward to slice 04, which owns TC5d.

## Step 4, one real emit

Registered `../BUSY-1160/SYNTHETIC-REGISTER.md` seq 17 (reference `982409Aug26`, the fixed reference
`fixtures/wholesale/01-baseline.json` and every other wholesale fixture carries) before emitting.
This reference also serves TC1a/TC1b/TC12's "older save" per `PLAN.md`'s own fixture-to-case
table, so slice 03 reads this order rather than re-creating it.

**Create:** `./invoke-so-revision.sh --scenario 01-baseline --family outbound --order-type WHOLESALE
--event CREATE_OUTBOUND_ORDER` (real, not dry-run). Landed: `orderId
23adfe1c-b10a-4122-b5e7-bc7cbb4a52fb`, 1 ORDER + 17 ITEM rows in `staging-orders-v2`, `status OPEN`.
Reconciled all the way through: bridge (`OUTBOUND_SHIPMENT_SAVE`), materialiser
(`OUTBOUND_SHIPMENT_READY`, header + 17 `OUTBOUND_ITEM` rows, `status PENDING_OUTBOUND`), then sender
(`OUTBOUND_SHIPMENT_SENT`, `status SENT_OUTBOUND`, `sentAt 2026-09-10T04:54:41.754Z`). Reached
Manhattan SCALE staging.

**Update:** same command, re-emitting the identical `01-baseline` file (unchanged content, same
`modifiedDate`) as `UPDATE_OUTBOUND_ORDER`, a deliberately content-neutral revision so the version
guard's "equal timestamp passes" rule is exercised without disturbing any fixture reserved for
slices 03-06. Landed: handler log named attribution `{"metric":"OutboundOrderUpdated","orderId":
"23adfe1c-...","lines":17,"removed":0}` (`staging-orders-cin7-update-outbound-order` log group).
ORDER-side `TRANSACTION` count 1 -> 2, `lastModified` unchanged at `2026-08-27T04:08:59Z` (equal
timestamp, matches the documented "passes on equal, not only newer" rule). No rejection, no
exception. Shipment side unchanged (still exactly 3 `TRANSACTION` rows: `SAVE`, `READY`, `SENT`),
consistent with a content-neutral revision producing nothing new to send.

**Both land, the update applies, no rejection — matches the slice's expectation exactly.**

This order's `ORDER` row was created before the `orderedAt` fix landed, so it carries neither
`orderDate` nor `orderedAt`. Not re-emitted to backfill it: no case in this plan checks that field,
and a third revision against this reference was judged not worth it for a field nothing reads.

## Teardown

Order left in place per the slice's own instruction (registered, and staging has no self-service
reset). Poller schedule and SO watermark confirmed unchanged (still DISABLED / `UNSET`) at the end
of this slice, re-read directly (`events:describe-rule`, `ssm:get-parameter`), matching slice 01's
Gate D values exactly.

## Reads as

**Two real fidelity gaps found and fixed (cancel shape, `orderedAt` field name). One documentation
bug found, flagged not fixed (RTV substitution's header example). One known limitation noted, not
fixed (`orderId`). Order-type substitution otherwise clean once driven by path. One real
create-then-update emit reached SCALE cleanly. Proceed to slice 03.**

* Every later CREATE/UPDATE-driven verdict can rely on the tool matching the deployed shape, field
  for field, as of this fix.
* Every later CANCEL-driven verdict (TC7a, TC7b, TC13) can now rely on the same, as of this fix —
  before it, none would have.
* TC5d (slice 04) must invoke the RTV substitution by file path, not by the bare scenario name the
  tool's own header shows; the substitution itself is clean (only `orderType`/`allocateComplete`
  differ, nothing that reaches SCALE).
* `orderId` on a freshly created synthetic order will never match what a real poller cycle would
  derive for that reference. No case depends on this; carried as a standing caveat.
* The `hashPayload`/`hashMappedPayload2` algorithms remain unverified against the tool's own hash
  functions; carry the existing "new/different is fine, exact value is not" caveat forward.

## New open questions

None added to `../BUSY-1065-OPEN-QUESTIONS.md`. All four findings here are tool-side (this session's
own harness), not open questions about the deployed system's behaviour.

## Scripts written

None. This slice used `../../tools/inspect-lambda-code.sh` and
`../../tools/cin7-sales-orders/invoke-so-revision.sh` only, and edited the latter in place (see
`TOOL-NOTES.md`); no new ticket-specific script was needed.
