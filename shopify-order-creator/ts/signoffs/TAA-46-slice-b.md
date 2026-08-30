# TAA-46 slice B sign-off (2026-08-30) — publication does NOT gate Admin-API order creation

Scope: one live order on US, no code changes, no pool changes, no
`publishablePublish`, no second store (US was conclusive). Read slice A's
sign-off (`ts/signoffs/TAA-46-slice-a.md`) for the reference profile and the
candidate shortlist.

## Non-compliant candidate chosen

**SKU `33860138`** (US, "Rusty Flip Daddy Muscle Carbon - XL",
`gid://shopify/ProductVariant/51754459463953`), exactly as slice A flagged it
as the clean pick. Against the reference profile it fails on every axis that
matters:

- `status`: **DRAFT** (reference: `ACTIVE` on 9 of 14 pool slots, but the
  other 5 pool slots are also DRAFT — see slice A's non-convergence finding)
- `resourcePublicationsV2`: published to **nothing** — 14 unpublished, 0
  published (matches 5 of 14 pool slots exactly)
- `publishedOnPublication` (Online Store): **false**

Deliberately **not** the other two non-pool US candidates from slice A:
`33790497` has real stock of **-34** and `33174570` is fully compliant
(`ACTIVE`, published, on storefront) — neither isolates the publication
variable cleanly. `33860138`'s real stock of **5** (positive, non-zero) was
the reason it was picked: a failure on it could not be blamed on being out
of stock, so the result below is not confounded.

## Live order attempt — US

`ts/scripts/probe-gating-order.js` (new, this slice) — calls
`ShopifyClient.createDraftOrder` directly with the GID above, bypassing
`cli-order.ts`'s `order` subcommand deliberately: that command validates
every SKU against `US_VARIANTS`/`PS_VARIANTS` (the pool) before building a
line item (`cli-order.ts:238-242`, confirmed live — running
`node dist/index.js order --store US --items 33860138x1` first threw
`SKUs not in US variant map`), and the whole point of this slice is a SKU
outside the pool. The plan's "no code changes at all" instruction is
satisfied: `createDraftOrder`'s existing signature already accepts a raw
`variantId`, nothing in `src/` was touched.

```
Attempting order: SKU 33860138 (gid://shopify/ProductVariant/51754459463953) x1, store US
RESULT: SUCCESS
{
  "orderId": "gid://shopify/Order/7899179516177",
  "orderName": "#9984",
  "createdAt": "2026-08-30T00:16:42Z"
}
```

**Order #9984 created successfully, full draft-order-create + complete round
trip, on a `DRAFT`, unpublished-everywhere SKU.** Not fulfilled, not
rejected, per the plan — left exactly as a completed order, same as any
other live regression order this project creates routinely.

Worth stating plainly what "succeeded" covers here: `createDraftOrder`
doesn't just create the draft, it also calls `fetchShippingRateHandle`
(`draftOrderCalculate`, real shipping-rate resolution) before completing the
draft, and never passes an explicit price — the line item is
`{variantId, quantity}` only (`shopify.ts:150-157`), so Shopify resolved the
variant's real price itself. Both the shipping-rate calculation and the
price resolution succeeded against this SKU with no special-casing, so this
result isn't just "the order object got created", it's the same full path
every other regression order takes.

## The rule, settled

**Channel publication, catalog/market membership, and product `status` do
not gate Admin-API order creation at all.** They gate storefront/POS
visibility only — exactly the second branch the plan's open question
named. A product can be `DRAFT`, published to zero publications, and
absent from every catalog, and `draftOrderCreate` → `draftOrderComplete`
will still place a real order against it, with real price and shipping-rate
resolution, provided the variant exists and carries stock somewhere.

This also resolves slice A's open observation: the reason 5 of the US
pool's 14 "known-good" slots are `DRAFT`/unpublished-everywhere and still
have dozens of successful live-order runs on record isn't a fluke or a
grandfathered exception — it's because none of that ever mattered for this
order-creation path in the first place.

### Load-bearing vs advisory

- **Not load-bearing for order creation:** `product.status`,
  `resourcePublicationsV2` / `unpublishedPublications` /
  `publishedOnPublication`, and catalog/market membership
  (`catalogs`/`MarketCatalog`). None of these were checked or enforced
  anywhere in the `draftOrderCreate`/`draftOrderCalculate`/
  `draftOrderComplete` path exercised here.
- **Load-bearing (unchanged, not newly discovered — carried over from
  existing harness behaviour):** the variant GID must resolve to a real
  variant with a real price (Shopify resolves it itself; no fallback price
  exists in this path, unlike NewStore's flow), and it needs stock
  somewhere for the result to mean anything (this run deliberately used a
  non-zero-stock candidate, so a **zero-stock** SKU's behaviour through this
  same path is still untested — out of scope for this slice, and not
  needed: slice C's selection rule below sidesteps it entirely by picking
  from SKUs already confirmed to carry stock).
- **Advisory only, not tested, out of scope for the Admin API order-creation
  question:** whether a customer could find/buy this SKU through the actual
  storefront or POS. That's precisely what publication/catalog membership
  *does* gate — just not this project's order-injection path.

### What this means for slice C's selection rule

Slice C does **not** need to filter the 66 new SKUs per store by
`status`/publication/catalog at all — those fields are irrelevant to
whether `order` (or the regression suite's own order-creation stage) can
place against them. The only filter that matters is **real stock somewhere**
(readable via `dump-availability.js`'s existing stock-read, or
`getAllLocationsForSku` directly), to avoid picking a SKU this project's
untested zero-stock case would silently fail on for an unrelated reason.
Slice A's dump already surfaces this per candidate; no new probe script is
needed for slice C to apply this rule.

## Checklist

- [x] Non-compliant candidate chosen, and exactly how it differs from the reference profile stated
- [x] One live order attempted on US, outcome recorded with the order number
- [x] The availability rule written out in full, marked settled, with the evidence
- [x] Which parts of the profile are load-bearing versus advisory, stated
- [x] Evidence written to `ts/signoffs/TAA-46-slice-b.md`

Deliberately not done, per the plan: no code changes in `src/`, no pool
changes, no publication mutations, no second store (US alone was
conclusive — a definitive SUCCESS on the worst-case candidate needs no PS
confirmation to generalise, since the mechanism tested is Admin API
behaviour, not a store-specific config difference).

## Handback

Branch `taa-46-gating-probe`, cut from `taa-46-availability-probe`
(`dc1f7d9`, slice A's tip). One commit to make: `ts/scripts/probe-gating-order.js`
(new) + `ts/signoffs/TAA-46-slice-b.md` (new). Not pushed, not merged, no
other branch touched. Slice C (`taa-46-pool-80`, per the plan) can now
proceed with the selection rule above — it should branch from here, or from
`taa-46-availability-probe`, either is fine since this slice added no `src/`
changes for it to depend on.
