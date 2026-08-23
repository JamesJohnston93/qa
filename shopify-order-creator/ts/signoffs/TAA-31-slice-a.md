# TAA-31 slice A sign-off (2026-08-23) — reject contract proved by hand, one contract deviation is major

Scope: prove the reject contract by observation only. No `verify/` module, no
`cases/`, no regression wiring, no formal poll window — a one-shot probe CLI
(`ts/src/probe-reject.ts`, not wired into `index.ts`/`cli.ts`/`--help`) plus
raw `curl` for discovery. `npm run build` + `npm test`: **267/267 green**
throughout, unaffected by the new file (offline suite doesn't touch it).

## Headline finding — reject is NOT the same endpoint as fulfil

JJ's brief said reject goes to "the same endpoint as fulfil." **It does
not.** Confirmed live, reproduced independently via both the probe and a bare
`curl`:

- `POST /staging/fulfil` with the exact `rejected_items` body from the brief
  (no `package_composition`) → **502 Bad Gateway**,
  `{"message": "Internal server error"}`. The handler behind `/staging/fulfil`
  doesn't branch on body shape — it unconditionally expects
  `package_composition` and crashes on its absence.
- Same body, with an empty `package_composition: []` added → **400**,
  `{"code":400,"message":"There's been an error fulfilling this shipment.
  Please contact Dev Support."}`. Confirms it was processing the request as a
  *fulfil* attempt with zero packages, never inspecting `rejected_items` at
  all.
- `POST /staging/reject` (same host, same `X-API-KEY` header) with the exact
  body from the brief → **200**,
  `{"code":200,"message":"success","data":{"message":"Shipment Item(s)
  rejected successfully."}}`.

**Reject is a genuine sibling path**, not a second body shape on the fulfil
resource. This settles Part 1's open design question: a future slice should
give reject its **own client method** (or its own small client), not fold it
into `FulfilmentClient.fulfil` — the two hit different URLs and have
different success-body shapes (fulfil: `data.label_url`/`data.label_dimensions`;
reject: `data.message`, a plain string, see Q5 below). `probe-reject.ts` does
its own raw `fetch` for exactly this reason — committing the client-shape
decision belongs to that later slice, not to a hand-probe.

## Part 1 answers (read before any live call)

- **URL / discrimination — see headline finding above.** Sibling path
  `/staging/reject`, not shared with fulfil.
- **`buildFulfilPayloadForShipment` shape to mirror:** reject's payload is
  simpler (no `fulfiller`/`fulfilled_at`, no per-package weight breakdown) —
  `{shipment_id, rejected_items: [{shipment_item_id, rejection_reason}]}`.
  Snake_case throughout, `shipment_id` bare UUID, `shipment_item_id` keeps
  the `ITEM#` prefix verbatim — same asymmetry as the fulfil builder, no
  mismatch found. Mirrored as `buildRejectPayload()` in the probe file.
- **`dynamoReader.ts` — nothing consumes `rejectedStores` today, confirmed
  by grep.** The only non-declaration hits are the field's own type/docstring
  (now at line 63/265, not line 201 — TAA-35 shifted lines when it added
  `ShipmentSummary`; the ticket's line reference is stale but the claim
  holds) and test fixtures that set it to `[]`. Nothing reads it for logic
  anywhere in `src/`.
- **Pool slots — collision confirmed, not resolved.** The ticket text still
  says "slots 10-13 are free"; that's stale. `variants.ts`/`baselineCases.ts`
  as they stand today show **only slot 13 free** — TAA-39 (merged, per
  CLAUDE.md's "ALL SIX SLICES DONE") already spent 10 (`fulfil_single`) and
  11-12 (`fulfil_split`). This session's live experiments used slot 13
  (US `33775371`, PS `33950419`) — the only slot TAA-31 actually has a claim
  on. Flagging for JJ, not resolving: if TAA-31 ever needs more than one SKU
  slot (e.g. slice E's undeliverable-after-rejection case wants its own SKU
  separate from slice D's reallocation case), there is no headroom left on
  either store's 14-SKU pool without extending it.

## Part 2 — the experiment

Four spare US orders, own SKU (pool slot 13, `33775371`), each `x2` at
`WEB_DC` (`ATP#100`, standard seed) — reproduces the "multi" shape (2 units,
same SKU, one shipment) so the shipment has ≥2 items and rejecting one shows
the asymmetry. PS not exercised this slice — flagged for a later
both-stores live-confirm slice, not attempted here.

| Order | Shipment (before) | Rejected item | Reject call | Settle | Landed (rejected / unlisted) |
|---|---|---|---|---|---|
| #9947 | `85cc78eb…` @100 | `ITEM#07f0c16d…` | 200 (curl, discovery — untimed) | untimed, confirmed resolved on a later dump | `7d8838a3…`@412 / `4cbcbc54…`@419 |
| #9948 | `97039017…` @100 | `ITEM#369ccba5…` | 200, 0.29s | resolved +16.5s (stable to +22.7s) | `1a4a2fc7…`@371 / `bf327d5f…`@406 |
| #9949 | `f65fa9d6…` @100 | `ITEM#1bfa3c31…` | 200, 0.29s | **>14.5s, true value not captured** — see timing note | `a725e9a3…`@218 / `45553295…`@223 |
| #9950 | `18c49e30…` @100 | `ITEM#ac9ac87b…` | 200, 0.34s | resolved +20.6s (positive terminal check) | `db8d6044…`@302 / `fe8aea7e…`@304 |

### 1. Did `rejectedStores` gain the original store on only the rejected item, or all?

**Only the rejected item, 4/4 trials.** Confirmed both on the `ITEM#` row
(`rejectedStores: ["100"]` vs `[]`) and independently on the
`SHIPMENT_ITEM_REJECTED` transaction row (order #9950): its
`shipmentItemInfo` array carries both items, but only the rejected one has
`rejectionReason`/`rejectedStore` populated — the unlisted item's entry has
neither key. **The ticket's "In scope" bullet ("rejecting store number is
appended to each item's rejectedStores array") is wrong; JJ's override is
confirmed correct.**

### 2. Where did each item land? Did the unlisted item return to the original store?

Every item, listed and unlisted, was pulled back to the allocator and
re-landed at a **brand-new store**, never observed returning to store `100`
in 4 trials (`412/419`, `371/406`, `218/223`, `302/304` — none are `100`, and
none are `99`/`407` either, the other two ATP locations this harness
manages). Per JJ's contract this is legal — the unlisted item *may* return to
the original store, it isn't guaranteed to — so 4/4 "didn't return" is not a
defect, just an unconfirmed corner case this sample size never hit.
**Notable side-effect for slice E's design (see undeliverable proposal
below): the real staging allocator draws from a much wider set of real
stores than the 4 ATP locations (`WEB_DC`/`STORE_99`/`CHERMSIDE_US`/
`PS_STORE`) this harness explicitly seeds.**

### 3. How many new shipments, and how were items distributed?

**Always exactly 2 new shipments, 4/4 trials** — one item per shipment, never
coalesced, because the two items always landed at *different* stores from
each other every time. (Had two items landed at the same new store, they'd
presumably combine into one shipment, per the same store-grouping logic the
initial allocation uses — just never observed in this sample.)

### 4. Timing — call to new rows settled

**Reject call latency: tight, 0.29-0.34s across 3 instrumented calls** (plus
2 successful discovery calls via curl on #9947, untimed).

**Settle timing is not as tight, and the first measurement method was
unsafe.** The initial instrumentation (`observeSettling`, "state unchanged
for 3 consecutive ticks") gave #9948 = 16.5s. Reused unchanged against #9949,
it falsely declared "settled" — at +14.5s both items sat at
`status=OPEN, shipmentId=null` (returned to the allocator, not yet
re-picked-up), which *looked* stable for 3 ticks but was an intermediate
state, not the terminal one. The true resolution didn't show up until a
manual re-dump minutes later. **Fixed the predicate** to a positive terminal
condition mirroring `fulfilFlow.ts`'s `itemCountsSettled` shape — every
original item must have EITHER a new `shipmentId` different from the
rejected one, OR gone `UNDELIVERABLE` — not "nothing changed recently."
Re-run on #9950 with the corrected predicate: **resolved at +20.6s**.

**Reported honestly: n=2 trustworthy measurements (16.5s, 20.6s), one
lower-bound-only sample (#9949, >14.5s, true value uncaptured).** Do not
read 16.5-20.6s as a tight range — it's a floor, not a distribution, exactly
the same caution this project applied to the fulfilment-settle 6.5-9.0s
figure (TAA-41). A future slice's poll window should be sized generously
(the existing `fulfilment` window is 150s against a measured 6.5-9.0s,
roughly a 20x margin — reject reallocation should get comparable headroom,
not a tight bound off two samples).

**Bonus ground truth, order #9950's transaction log** (see Q6 below) — exact
epoch timestamps confirm the backend-side pipeline: `SHIPMENT_REJECTED`
(t) → `SHIPMENT_ITEM_REJECTED` (t+1s) → `REALLOCATION` event (t+11s) →
first new `SHIPMENT_CREATE` (t+13s) → its item allocated (t+14s) → second new
`SHIPMENT_CREATE` (t+14s) → its item allocated (t+15s). **Reject-to-fully-
reallocated backend span: 15s**, consistent in order of magnitude with the
16.5-20.6s measured from the API call (the gap between call-return and the
first `SHIPMENT_REJECTED` transaction landing is the "not yet visible"
portion, same class of lag as fulfilment's row-settle delay).

### 5. Full success response body

`{"code":200,"message":"success","data":{"message":"Shipment Item(s)
rejected successfully."}}` — confirmed identical across all 5 successful
calls (2 via curl on #9947, one each on #9948/#9949/#9950). **Does not match
fulfil's shape at all** — fulfil's `data` carries `label_url`/
`label_dimensions`; reject's `data` carries a single human-readable
`message` string. A future reject client's success type should be its own
interface, not a reuse of `FulfilPayload`'s response shape.

### 6. What happens to the original shipment row?

**Flips to `status: REMOVED`, 4/4 trials.** Not "cancelled", not "closed" —
reuses the exact same terminal status `dynamoReader.ts` already documents for
undeliverable-cleanup's `ITEM#` rows (`REMOVED`), but this is the first
confirmation it also applies to a `SHIPMENT#` row, and via a completely
different code path (reject, not undeliverable refund cleanup).
`allocatedStore` and `trackingNumber` are left untouched on the removed row
(still `100` / `null` respectively) — it's not scrubbed, just marked
terminal.

**Extra, unprompted confirmation — rejection DOES append transactions the
same way fulfilment does** (ticket's stated TAA-21 dependency, verified via
a read-only raw query in the probe against `staging-shipments`' `TRANSACTION#`
rows, not through `dynamoReader.ts` which doesn't expose them yet):
`SHIPMENT_REJECTED` (category `REMOVAL`, origin `DC_PACKING`) at the shipment
level, `SHIPMENT_ITEM_REJECTED` (category `REMOVAL`, origin `DC_PACKING`) per
item, then a `REALLOCATION` event (category `UPDATE`, origin
`SHIPPING_SERVICE`) — structurally mirroring the initial allocation's own
`REALLOCATION` → `SHIPMENT_CREATE` → `SHIPMENT_ITEM_ALLOCATED` sequence.

## The undeliverable path — not attempted, per instruction. Proposal only.

`zeroEverywhere` (writes ~194 real per-SKU location rows, no prior-value
capture, not reversible) was read, not called. **Confirmed live in this
slice's own data that a naive "seed one location, leave everything else
alone" approach cannot reliably force undeliverable-after-rejection**: this
session's reallocations landed at real store numbers (`412`, `419`, `371`,
`406`, `218`, `223`, `302`, `304`) far outside the 4 ATP locations
(`WEB_DC`/`STORE_99`/`CHERMSIDE_US`/`PS_STORE`) this harness ever seeds —
proof the real staging allocator has many other genuinely-stocked real
candidate stores to fall back on for an arbitrary SKU.

**Proposed constrained alternative:**

1. Use the TAA-31-reserved pool SKU (US `33775371`, PS `33950419` — slot 13,
   the only slot with no other claim).
2. One-time **read-only** audit via the already-existing
   `DynamoClient.getAllLocationsForSku(sku)` (no writes) to see which of that
   SKU's ~194 location rows currently hold nonzero stock. Being a QA-pool
   SKU no real customer order touches, expect a small number — most likely
   only whatever this harness itself has written.
3. Zero only the **nonzero** locations the audit finds, except one
   deliberately-chosen store, which gets seeded with 2 units (mirrors this
   slice's proven 2-item shape). Bounds the write count to "however many
   locations actually hold stock", not a blanket ~194.
4. Named concrete stores: **US → `CHERMSIDE_US` (`ATP#407`, store number
   `"407"`)**, **PS → `PS_STORE` (`ATP#640`, store number `"640"`)** —
   deliberately not `WEB_DC`/`STORE_99`, since those are the two shared DCs
   every other case already seeds; using the brand-specific single-branch
   location keeps this case's inventory management from colliding with
   anything else running concurrently under `--parallel`.
5. **Reject every item in the shipment in one call**, not just one — the
   confirmed contract only bars *listed* items from their original store, so
   with only one designated stocked store, an unlisted item would remain
   eligible to return there and the shipment would stay allocated instead of
   going undeliverable. `rejected_items` already supports multiple entries in
   one payload; this needs no new endpoint capability, just a different case
   design than slice A's single-item reject.
6. If the audit ever shows nonzero stock at more than a small, bounded
   number of other locations for this SKU, escalate to a real
   `zeroEverywhere` and accept its known irreversible cost — the proposal
   avoids paying that cost by default, not avoids it when it's actually
   needed.

## Open question carried forward

**Is reject valid post-fulfilment?** Not tested this slice (would burn a real
Auspost label on top of an already-large probe budget, and the brief frames
this as a question to carry forward, not one to resolve by hand). This
decides whether a future case set can let fulfil and reject cases share one
order, or needs to keep them on separate orders/SKUs. TAA-41 already proved
the *fulfil* endpoint has no re-fire guard at all — worth checking whether
`/staging/reject` is equally unguarded against a shipment that's already
`FULFILLED`, but that's next slice's live call to make, not this one's.

## Proposed slice breakdown for the rest of TAA-31

Each acceptance line is one checkable sentence. No Jira tickets filed here —
JJ's call on how these map to TAA-31's sub-scope.

1. **Reject client.** A pure `buildRejectPayload(shipmentId, itemIds, reason
   = DEFAULT_REJECTION_REASON)` function and a small `RejectClient.reject()`
   method (own class or own method — not folded into `FulfilmentClient`,
   per this slice's headline finding) exist under `clients/`, covered by
   offline tests, and one hand-fed live call against a real shipment returns
   the exact 200 body shape this sign-off captured.
2. **Reallocation-resolved poll predicate.** A pure, offline-tested
   `rejectionResolved`-style predicate (mirroring `itemCountsSettled`)
   returns `false` against the observed order #9949 intermediate snapshot
   (all original items `OPEN`/`shipmentId: null`) and `true` against its
   final resolved snapshot, and a live run using it as a poll condition
   settles without guessing a fixed tick count.
3. **`reject → reallocate` case.** One case seeds a 2-unit single-SKU
   shipment (slot 13), rejects exactly one item, and the run passes only
   when every original item is confirmed landed on a new `shipmentId`
   (different from the rejected one) or gone `UNDELIVERABLE` — live on both
   US and PS.
4. **`reject → undeliverable` case.** Implements the constrained-alternative
   proposal above verbatim (audited targeted-zero, single designated store,
   every item in the shipment listed in one reject call) and the run passes
   only when every item in that shipment lands `UNDELIVERABLE` — live on
   both stores.
5. **Transaction-row assertions.** A `TRANSACTION#` reader (new, since
   `dynamoReader.ts`'s public surface doesn't expose these rows yet) confirms
   a `SHIPMENT_REJECTED` and one `SHIPMENT_ITEM_REJECTED` per rejected item
   are appended within the same poll window slice 2's predicate uses.
6. **`--repeat`-safe wiring.** Both new cases (slices 3-4) run cleanly under
   `--repeat 3` on both stores with zero variance in outcome, wired into
   `cases/`/`runner.ts`/`cli.ts` the same way TAA-39 wired the fulfilment
   cases in.

## Files touched this slice

New only: `ts/src/probe-reject.ts` (probe CLI, not wired anywhere),
`ts/signoffs/TAA-31-slice-a.md` (this file). Nothing else in `src/` or
`tests/` was edited — `clients/fulfilment.ts`, `readers/dynamoReader.ts`,
`config.ts`, `locations.ts`, `cli.ts`, `cli-fulfil.ts`, `index.ts`, `verify/*`,
`cases/*` are all untouched, per the fences and the read-only marking on
`dynamoReader.ts`.
