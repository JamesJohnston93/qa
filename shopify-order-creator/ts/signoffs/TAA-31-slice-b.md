# TAA-31 slice B sign-off (2026-08-23) — reject client, live-confirmed

Scope: build the real reject client slice A's headline finding called for
(`/staging/reject` is a sibling path to fulfil, not a second body shape on
it — needs its own client, not a bolt-on to `FulfilmentClient`). `npm run
build` + `npm test`: **278/278 green** (267 baseline/slice-A + 11 new).

## Decision carried over from JJ, this session

**Reject is never valid on an already-fulfilled shipment, and will never be
tested against one or included in the regression suite that way.** This
settles slice A's open question in the negative — a future case set does
*not* need to let fulfil and reject cases share an order; keep them separate.
No pre-flight "is this shipment already FULFILLED" check was built into
`RejectClient` itself, for the same reason `FulfilmentClient` doesn't carry
one either: that's the caller's job (`flows/fulfilFlow.ts` does it for
fulfil), not the client's. Documented in the client's file header so this
isn't rediscovered by accident later.

## Build

**New:** `src/clients/reject.ts` — `DEFAULT_REJECTION_REASON` ("FAULTY"),
`buildRejectPayload(shipmentId, itemIds, reason?)` (pure, mirrors
`buildFulfilPayload`'s bare-uuid/`ITEM#`-prefix asymmetry, snake_case,
supports multiple items in one call — needed for slice E's "reject the whole
shipment to force undeliverable" design), and `RejectClient` (same
staging-host guard pattern as `FulfilmentClient`, reuses the same
`FULFIL_BASE_URL`/`FULFIL_API_KEY` env vars since it's the same gateway, just
a different path — `POST /staging/reject`). Throws on non-200 with the
response body in the message, same as `FulfilmentClient.fulfil`.

**Tests:** `tests/reject.test.js`, 11 cases mirroring `fulfilment.test.js`'s
structure — payload shape, prefix asymmetry, multi-item support, empty-list
guard, staging-host guard, and (the one slice A's finding demanded be pinned)
**an explicit assertion that the client posts to `/staging/reject`, not
`/staging/fulfil`** — a regression here would silently reintroduce the 502
crash slice A discovered.

**Duplication kept deliberate, not extracted:** the staging-host validation
block is now duplicated across `fulfilment.ts` and `reject.ts`. Left alone —
two instances of a 15-line guard isn't a shared-abstraction case yet, and
this codebase already favours small duplication over premature extraction.
Revisit only if a third client needs the same guard.

## Live confirm — done

`probe-reject.ts` (slice A's research tool) was rewritten to call the real
`RejectClient`/`buildRejectPayload` instead of its own raw `fetch` —
dogfooding it live doubles as this slice's required hand-fed confirmation.

Order **#9951** (US, `33775371` x2, one shipment `93d24a2c…` @ store 100):
rejected item `ITEM#87203aaf…` via `RejectClient.reject()` → **200 in 0.50s**,
body `{"code":200,"message":"success","data":{"message":"Shipment Item(s)
rejected successfully."}}` — byte-identical shape to every call captured in
slice A. Resolved (both items landed on new shipments) at **+30.9s**:
rejected item → new shipment `35218c4e…` @ store **404**,
`rejectedStores:["100"]`; unlisted item → new shipment `ae3275ac…` @ store
**407** (`CHERMSIDE_US` — the first time in this investigation a
reallocation landed on one of the 4 ATP locations this harness actually
manages, rather than an arbitrary real store number). Original shipment →
`status: REMOVED`, matching every slice A trial. Transaction log confirms
the same `SHIPMENT_ITEM_REJECTED` → `SHIPMENT_REJECTED` → `REALLOCATION` →
`SHIPMENT_CREATE` → `SHIPMENT_ITEM_ALLOCATED` sequence slice A found.

No new contract surprises — this run exists to prove the *client*, not to
re-litigate the contract slice A already settled.

## Next up

Slice C (reallocation-resolved poll predicate) is effectively half-built
already — `probe-reject.ts`'s `reallocationResolved()` is the exact shape a
real `flows/rejectFlow.ts` predicate needs, it just needs to move into
production code with offline tests of its own. After that: slices D
(reject → reallocate case) and E (reject → undeliverable case) from the
slice A breakdown.
