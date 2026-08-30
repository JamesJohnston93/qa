# TAA-46 slice D sign-off (2026-08-30) — live spot-check + docs, ticket complete

Scope: `CLAUDE.md`, `staging-sku-setup.md`, two live orders (one per store).
No code changes. No ticket transition — proposed as met below, left to JJ.

## Live orders — both PASS

Both placed with the existing `order` subcommand, no special-casing, on a
representative new-slot SKU (slot 20, arbitrary — not 14/15, which are
already claimed by `ns_sfs`/`ns_otc`, and not a slot any other ticket in
the slot map has claimed yet):

- **US**: `node dist/index.js order --store US --items 33809786x1` →
  order **#9985** (`gid://shopify/Order/7899191279889`). Standard inventory
  seed ran automatically first.
- **PS**: `node dist/index.js order --store PS --items 34010884x1` →
  order **#3321** (`gid://shopify/Order/10875125727524`). Same seed
  behaviour.

This is the ticket's real acceptance criterion — slices A-C prove
configuration (a GID resolves, stock exists, the pool structure is sound);
this proves a new-slot SKU is genuinely purchasable end to end, on both
stores, through the harness's actual operator path, not a probe script.

## Docs updated

- **`CLAUDE.md`**: new dated section `## TAA-46 sign-off (2026-08-30)`
  inserted above the existing `## TAA-46 IN FLIGHT` section (append-only —
  that section is kept in full, now marked historical/superseded rather
  than deleted or rewritten). Carries: the settled availability rule in the
  form TAA-47 needs, the `MarketCatalog.markets` scope gap, why the
  NewStore pinning was needed, this slice's two live order numbers, and the
  final 0-79 slot map. The top-of-file **Tracking** line also gained a
  clause marking TAA-46 done with a pointer to the new section — that line
  is a live-updated index, not a dated historical record, so it was edited
  in place rather than appended around.
- **`staging-sku-setup.md`**: two new dated annotations, `*(Status update,
  2026-08-30, TAA-46: ...)*`, in JJ's established pattern (matching the
  existing 2026-08-06 annotations' style exactly) — one after the "ordinary
  staging-catalogue products" note confirming the same accepted call was
  made again for the 66 new entries, plus stating the availability rule
  finding since it changes how a future reader should weigh "requirements
  per test SKU" (publication/status were never a requirement for this
  harness's order-creation path); one after the "≥12 per store" target
  noting it's now 80 and pointing at CLAUDE.md's slot map. Original text
  preserved in both places, nothing deleted or rewritten.

## Verification

`npm run build` + `npm test`: **327/327 green**, unchanged from slice C —
this slice touches no `src/`/`tests/` file.

## Checklist

- [x] One live order placed on US on a new-slot SKU, order number recorded (#9985)
- [x] One live order placed on PS on a new-slot SKU, order number recorded (#3321)
- [x] Slot map 0 to 79 appended to CLAUDE.md
- [x] Availability rule appended to CLAUDE.md, in the form TAA-47 can build from
- [x] Scope gaps recorded per app, or explicitly noted as none (`MarketCatalog.markets`, identical on both apps)
- [x] `staging-sku-setup.md` annotated, dated, original text preserved
- [x] `npm run build` + `npm test` green
- [x] Evidence written to `ts/signoffs/TAA-46-slice-d.md`
- [x] Ticket acceptance criteria proposed as met, transition left to JJ

Deliberately not done, per the plan: no `prepare-skus` script (TAA-47), no
new cases on the new slots, no regeneration of the ground-truth doc (that's
`taa-wrap-up`).

## Ticket status proposal

Every slice's checklist is complete and live-confirmed (slice A: read-only
probe, both stores; slice B: live gating order, settled; slice C: pool
expansion to 80 + NewStore pinning, offline-verified; slice D: live
spot-check, both stores). **Proposing TAA-46 → Done** — JJ's call, not
applied here.

## Handback

Branch `taa-46-docs-and-confirm`, cut from `taa-46-pool-80` (`f3056f3`,
slice C's tip). One commit to make: `CLAUDE.md`, `staging-sku-setup.md`
(both modified) + `ts/signoffs/TAA-46-slice-d.md` (new). Not pushed, not
merged. All four `taa-46-*` branches (`taa-46-availability-probe` →
`taa-46-gating-probe` → `taa-46-pool-80` → `taa-46-docs-and-confirm`) form
one linear chain — merging to `main` needs only this tip merged, or the
chain can be replayed/rebased as JJ prefers. TAA-47 (`prepare-skus`
automation) is the natural next ticket, and can build directly on the
settled rule above without rediscovering it.
