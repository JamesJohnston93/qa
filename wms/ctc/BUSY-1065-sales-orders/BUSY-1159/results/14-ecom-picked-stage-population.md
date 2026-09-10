# Result: Slice 14, does ECOM ever carry a picked stage in Cin7

**Ticket:** BUSY-1159

**Verdict:** No. In this sample of 1000 orders (the 250 most recently modified per page, 4 pages),
zero orders carrying an ecom-shaped `projectName` reached `Fully Picked` or `Partially Picked`. Every
order at either picked stage carried a wholesale-shaped `projectName` or, in one case, none at all.

This is a population-level negative from one sample, not a proof of structural impossibility. See
"Reading it" below for how far this actually reaches, and note on the proxy at the end.

## Method

Extended `survey-cin7-orders.sh` additively, the same way the taxStatus counter was added: two new
cross-tabs, `stageByProjectName` and `stageByBranch`, alongside the existing tables. No existing
output key or behaviour changed. Both cross-tabs cost zero extra API calls: `projectName` and
`branchId` are already in the list payload the script fetches for everything else.

Run: `./survey-cin7-orders.sh --max-pages 4` (default branch filter, both CTC warehouses, 4 GETs,
1000 orders MEASURED). No rate limiting hit, no retries.

## Full distributions, verbatim

**stage** (1000 orders)

| stage | count |
|---|---|
| Dispatched | 643 |
| New | 313 |
| Fully Picked | 22 |
| Processing | 12 |
| Partially Picked | 8 |
| Fraud Warning | 2 |

All 6 observed values fall inside the LLD's named set (`New`, `Processing`, `Partially Picked`,
`Fully Picked`, `Dispatched`, `Fraud Warning`). **No stage value outside that set appeared in this
sample.** Caveat: this is 1000 most-recently-modified orders, not the full history, so it does not
rule out a rarer stage value never having occurred; it does mean the eligibility gate's named
vocabulary is not visibly incomplete against the last 1000 orders modified.

**status** (1000 orders)

| status | count |
|---|---|
| APPROVED | 1000 |

Only one status value appears, because `survey-cin7-orders.sh` filters on `isApproved=true` the same
way the poller does (this is existing behaviour, unchanged by this slice). This sample says nothing
about DRAFT or other non-approved statuses; they are excluded by the filter, not absent from Cin7.

## The two new cross-tabs

**stage x projectName** (orders with no `projectName` bucketed as `(none)`, full literal list, not
summarised):

```
stage = 'Dispatched'  (total 643)
  ShopifyV2_thrills                              293
  Shopify V2_Worship                             115
  333 - Thrills Spring 26 - AUS - Mens            47
  333 - Thrills Spring 26 - AUS - Womens          37
  FFF - Worship Spring 26 - AUS - Mens            33
  WORSHIP - MENS RECUT                            15
  Thrills - Core Range 25 - AUS - Womens           8
  THRILLS - WOMENS SMU                             7
  FFF - Worship Spring 26 - UNI - Mens             7
  THRILLS - MENS RECUT                             6
  TheIconic                                        6
  FFF - Worship Spring 26 - AUS - Womens           5
  EEE - Worship Winter 26 - NZ - Mens              5
  222 - Thrills Winter 26 - AUS - Mens             4
  THRILLS - AXS RECUT                              4
  THRILLS - MENS SMU                               4
  222 - Thrills Winter 26 - AUS - Womens           4
  222 - Thrills Winter 26 - NZ - Mens              4
  222 - Thrills Winter 26 - NZ - Womens            4
  333 - Thrills Spring 26 - Universal - Mens       3
  WORSHIP - AXS RECUT                              3
  FFF - Worship Spring 26 - UNI - Womens           3
  (none)                                           3
  Worship - Core Range 25 - AUS - Quickfill        2
  WORSHIP - MENS SMU                               2
  THRILLS - MENS EARLY SUMMER 26                   2
  EEE - Worship Winter 26 - AUS - Mens             2
  111 - Thrills Autumn 26 - AUS - Womens           2
  Worship - Womens Core Range 26 - AUS - Quickfill 1
  Thrills - Core Range 25 - AUS - Mens             1
  PROMO / GLASS AVE                                1
  Promo - Universal roadshow                       1
  WORSHIP - WOMENS RECUT                           1
  333 - Thrills Spring 26 - Universal - Womens     1
  REFIILL Thrills Womens                           1
  WORSHIP - WOMENS EARLY SUMMER 26                 1
  BS - QuickFill                                   1
  111 - Thrills Autumn 26 - AUS - Mens             1
  222 - Thrills Winter 26 - QUICKFILL - Mens       1
  Worship Autumn 26 - Quickfill Mens               1
  Thrills Autumn 26 - Quickfill - Womens           1

stage = 'New'  (total 313)
  666 - Thrills - Autumn 2027 - Mens             150
  666 - Thrills - Autumn 2027 - Womens           124
  THRILLS - MENS RECUT                            15
  WORSHIP - MENS RECUT                             9
  THRILLS - MENS SMU                               8
  'WORSHIP – MENS RECUT' (a distinct literal from the hyphen-spelled row above, quoted verbatim
  from the payload; this is Cin7 data, not this report's own prose)               3
  THRILLS - AXS SMU                                1
  THRILLS - WOMENS RECUT                           1
  WORSHIP - WOMENS RECUT                           1
  WORSHIP - WOMENS SMU                             1

stage = 'Fully Picked'  (total 22)
  333 - Thrills Spring 26 - AUS - Mens            10
  FFF - Worship Spring 26 - AUS - Mens             5
  333 - Thrills Spring 26 - AUS - Womens           5
  (none)                                           1
  Thrills - Core Range 25 - AUS - Womens           1

stage = 'Processing'  (total 12)
  ShopifyV2_thrills                               10
  Shopify V2_Worship                               2

stage = 'Partially Picked'  (total 8)
  333 - Thrills Spring 26 - AUS - Womens            3
  333 - Thrills Spring 26 - AUS - Mens             2
  Thrills - Core Range 25 - AUS - Womens            2
  FFF - Worship Spring 26 - AUS - Mens             1

stage = 'Fraud Warning'  (total 2)
  Shopify V2_Worship                               1
  ShopifyV2_thrills                                1
```

**stage x branchId:**

```
stage = 'Dispatched'  (total 643)      branchId 51909  410, branchId 51908  233
stage = 'New'  (total 313)             branchId 51908  313
stage = 'Fully Picked'  (total 22)     branchId 51908   21, branchId 51909    1
stage = 'Processing'  (total 12)       branchId 51909   12
stage = 'Partially Picked'  (total 8)  branchId 51908    8
stage = 'Fraud Warning'  (total 2)     branchId 51909    2
```

(`51909` = Main Warehouse / `CTC-QDC`, `51908` = Wholesale Warehouse / `CTC-WH`, per
`find-cin7-sales-order.sh`'s header and `fixtures.md`'s known ECOM fixture, branch `51909`.)

## Step 4: picked stage AND ecom-shaped projectName

`ShopifyV2_*` / `Shopify V2_*` literals are the ecom-shaped proxy (see `ShopifyV2_thrills`,
`Shopify V2_Worship` above, both attested at `Dispatched`, `Processing` and `Fraud Warning`).

Reading the `Fully Picked` and `Partially Picked` rows of the cross-tab directly: **none of the 30
orders across those two stages carry a `ShopifyV2_*` or `Shopify V2_*` projectName.** Every one is a
wholesale-shaped literal (`333 - Thrills Spring 26...`, `FFF - Worship Spring 26...`, `Thrills - Core
Range 25...`), except one `Fully Picked` order with no `projectName` at all.

**No fixture found.** Per the slice's instructions, the contact-group lookup step (`--with-contact`,
capped at 10) only triggers when a picked-stage order with an ecom-shaped `projectName` exists. None
does in this sample, so zero contact lookups were made. No company names are printed in this report.

**One anomaly worth flagging, not chased further:** the single `Fully Picked` order with no
`projectName` sits on branch `51909`, the branch otherwise dominated by `Dispatched`/`Processing` and
associated with ECOM in prior slices. It is not ecom-shaped by the literal-proxy rule (it has no
projectName to be shaped one way or the other), so it does not meet step 4's trigger and was not
looked up. Identifying its reference would need a further Cin7 GET beyond the aggregate survey this
slice ran; not spent here, flagged as a lead if a future slice wants a genuinely-uncertain candidate to
resolve.

## Reading it

At the population level (branch x stage), the same shape shows up twice, independently: `New` is 100%
branch `51908` (wholesale warehouse), and `Fully Picked`/`Partially Picked` are 21/22 and 8/8 branch
`51908` respectively. Branch and projectName agree with each other on where picked stages live, which
is two independent signals pointing the same way, not one.

**What this settles and what it does not.** It answers the sample-scoped question the slice asked:
no, not in this 1000-order sample. It does not settle whether ECOM is *structurally* barred from a
picked stage in Cin7, only that it was not observed there across the last 1000 modified orders. TC14's
ECOM half should be read against this: the fixture search has now been run as a cross-tab across a
real population rather than five separate eyeball checks on individual orders, and it still comes back
empty. Whether that licenses closing TC14's ECOM half as NOT APPLICABLE (structurally never occurs) or
leaves it BLOCKED (fixture rare but not impossible, just not caught in 1000 orders) is a call for JJ,
not this slice: this slice's job was to cross-tab the population once, honestly, not to adjudicate the
case status.

**projectName is a proxy for ECOM, not the definition.** The definition is the ordering contact's
Cin7 group (`Retail - Ecomm` -> ECOM, per `find-cin7-sales-order.sh`'s header). `projectName` is cheap
because it rides along in the same payload with zero extra calls, and the `ShopifyV2_*` /
`Shopify V2_*` literals correlate strongly with ECOM in every fixture seen so far in this plan, but
that is a correlation this slice leaned on for cost reasons, not a verified equivalence. Do not let
this proxy harden into "projectName defines order type" in a later slice or in the QA doc; it does
not, the contact group does.

## Scripts written

`survey-cin7-orders.sh` (tools root, not ticket-scoped) extended additively: `stageByProjectName` and
`stageByBranch` counters and their table output, alongside `--json` output for both. No existing key,
flag or output changed. Row updated in `SCRIPTS-INDEX.md`. Not yet reviewed (it was already carrying
that flag before this slice, from the taxStatus addition; unchanged by this addition).

## Teardown

Read-only throughout. No watermark, schedule, or Cin7 write of any kind. 4 GETs against the shared
daily budget (`SalesOrders`, 250 rows each), well under the 5000/day budget and the 3/s, 60/min burst
limits; no 429s encountered.
