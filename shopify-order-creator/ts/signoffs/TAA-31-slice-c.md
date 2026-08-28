# TAA-31 slice C sign-off (2026-08-23) — reallocation-resolved predicate promoted, live-confirmed on both branches

Scope: promote `probe-reject.ts`'s hand-rolled `reallocationResolved()`
(slices A/B) into production code with its own offline tests, per the slice
A/B breakdown. `npm run build` + `npm test`: **286/286 green** (278
slice-A/B + 8 new).

## Build

**New:** `src/flows/rejectFlow.ts` — `reallocationResolved(items,
originalItemIds, originalShipmentId)` (pure, unchanged logic from the probe)
and `waitForReallocation(reader, orderPk, originalItemIds, originalShipmentId,
verbose?)` (a thin `pollUntil` wrapper, mirroring `fulfilFlow.ts`'s
fulfilment-settle wait shape — `REALLOCATION_SETTLE_WINDOW_SECONDS = 240`,
sized with generous headroom over the 16.5-30.9s settle times measured
across slices A/B, same reasoning this project already applies to the
fulfilment-settle window).

**Tests:** `tests/rejectFlow.test.js`, 8 cases. The two load-bearing ones use
the **real observed rows from order #9949** (slice A) as fixtures — the
order whose naive "unchanged for N ticks" heuristic falsely declared
settlement: `reallocationResolved` returns `false` against that order's
actual intermediate snapshot (both items `OPEN`/`shipmentId: null`) and
`true` against its actual final snapshot. Also covers: partial resolution
(one item done, one not), an item still pointing at the rejected shipment
itself, a missing item row, the `UNDELIVERABLE` branch, and that unrelated
items on the same order don't interfere. `waitForReallocation` gets one thin
wiring test only — `pollUntil`'s own retry/timeout mechanics already have
fast, dedicated coverage in `tests/polling.test.js` with tiny injected
windows; re-proving that through this wrapper's real 240s module constant
would cost wall-clock time for no new coverage.

`probe-reject.ts` was updated to call the promoted `waitForReallocation`
instead of its own copy (removing the now-dead `reallocationResolved`,
`observeSettling`'s manual tick-loop, and the unused `snapshotKey` helper) —
dogfooding the real production code live is this slice's confirmation call.

## Live confirm — both predicate branches now proven live, not just by fixture

Order **#9952** (US, `33775371` x2, shipment `eb884d86…` @ store 100):
rejected item `ITEM#18deef83…`. **This run did not reallocate — both items
went `UNDELIVERABLE`.** `waitForReallocation` correctly recognized this as
resolved via its `UNDELIVERABLE` branch at **+22.5s**, the first live
exercise of that branch (previously only covered by synthetic test
fixtures, since every prior slice A/B trial reallocated successfully).
Transaction log confirms the backend's own path: `SHIPMENT_REJECTED` →
`SHIPMENT_ITEM_REJECTED` → `REALLOCATION` → **`SHIPMENT_ITEM_UNDELIVERABLE`**
per item (a new event type, not seen in any prior trial) — no
`SHIPMENT_CREATE` this time, confirming the allocator genuinely found
nowhere to put either item.

## Unplanned but significant finding: repeated reject cycles can exhaust a SKU's real stock by attrition

This was the **6th** live reject cycle run against the same pool-13 SKU
(`33775371`, US) today, across orders #9947-#9952. Every prior cycle
reallocated successfully to a real store; this one found **no valid store
at all** for either item — including the unlisted one, which every contract
reading says is free to land anywhere not explicitly barred. The most
plausible explanation: **allocation decrements real per-store inventory
wherever it lands, and rejection does not restore it.** Six consecutive
cycles, each landing two units at two different real stores, would plausibly
exhaust whatever naturally-small stock this QA-pool SKU carries at nearby
stores over time, without any explicit zeroing ever having been called.

**This was not a designed test of the undeliverable path** — slice A's
`zeroEverywhere`-avoidance proposal is unaffected and still the right
approach for a *deterministic* undeliverable case. But it's a real
operational risk worth flagging for slices D and F:

- **Slice D's "reject → reallocate" happy-path case** should not assume its
  assigned SKU has unlimited real stock elsewhere. If the same SKU slot is
  exercised repeatedly (manual runs today, or `--repeat 3` later), it can
  eventually and unpredictably tip into `UNDELIVERABLE` by attrition alone —
  which would read as flaky, not as a design bug. Worth checking real stock
  breadth for the slot-13 SKU (or re-seeding a top-up before each run) rather
  than assuming today's success generalizes indefinitely.
- **Not investigated further this slice** — attrition on a pool SKU is a
  live-environment behavior worth knowing about, not a defect worth chasing
  (same standing instruction as the TAA-42 backend-bug deferral: note it,
  don't chase it).

## Files touched this slice

New: `src/flows/rejectFlow.ts`, `tests/rejectFlow.test.js`,
`ts/signoffs/TAA-31-slice-c.md`. Modified: `src/probe-reject.ts` (dogfoods
the promoted predicate, dead code removed). Nothing fenced touched.

## Next up

Slice D (reject → reallocate case) and slice E (reject → undeliverable case,
per slice A's constrained-alternative proposal) — noting slice D should
account for the attrition risk above when picking/seeding its SKU.
