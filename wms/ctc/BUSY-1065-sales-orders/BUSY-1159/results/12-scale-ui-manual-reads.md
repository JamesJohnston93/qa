# Result: SCALE UI manual reads (TC1a, and the SCALE halves of TC6, TC10, TC18)

**Ticket:** BUSY-1159
**Date:** 2026-09-02
**Driven by:** `SCALE-UI-READS.md` and `SCALE-UI-RUNSHEET.md`, not a numbered slice. Manual, by JJ,
in the Manhattan SCALE staging UI. No AWS, no scripts.
**Verdict:** TC1a **FAIL** on one element (`Carrier`), PASS on every other element read. TC6 PASS.
TC10 PASS. TC18 PASS. TC1's SCALE-side half is now MEASURED rather than inferred.

**PII.** Every order read carries a real CTC customer's name, address, phone and email in the Ship To
panel. None of those values is recorded here. Where a value mattered only by length, the length is
recorded and the value is not.

## Navigation, and the hour it cost

**Order Planning > Planned Shipment Insights**, searching on Shipment ID. Not Shipping Insights,
which is where the read started. Shipping Insights lists **post-wave** shipments only: it returned 49
CTC-QDC records, every one in a `CTC-<YYYYMMDD>-<code>-<suffix>` format with synthetic ship-to codes
(`CTC-ECOM-008`, `WHOLESALE001`, `SP001`), and none of ours.

That format is the DC team's own test data, not integration output, and mistaking it for ours led to
a working theory that SCALE was accepting our documents without creating shipments. **It was not
true.** A downloaded shipment rests as a planned shipment at `In Pool` until the DC waves it, so an
empty Shipping Insights result for our references is the expected state.

Recorded because the same wrong turn is available to anyone reading the QA doc.

## What a read can and cannot answer here

**Not readable in this UI, established on `261111` and confirmed on `261115`:**

* `OrderDate`. No field renders it. `Created By`'s date is SCALE's own audit stamp; the Status panel
  dates are derived from the payload.
* `ErpOrderLineNum`. The Lines grid's full column set is Icon, Color, Item, Description, Company,
  Total Qty, Remaining Qty, UM, Internal Shipment Line Number. No ERP line number, and the line
  drill-in does not add one.
* `CustomerPO`. Searchable as a filter, rendered nowhere.
* Element ordering and the mandatory field set. The UI renders parsed data, not the document.

**Two origin markers worth keeping.** `Created By` = `ilssrvseau`, the interface service account, and
`Manually Entered` = `No`. Either distinguishes an interface-created shipment from a hand-made one.

## Read 0, `261111`. Not a planned case, and it corrects slice 02

MEASURED. `ShipmentId` `261111`, `ErpOrder` `261111`, no longer variant exists under any search.
Created by `ilssrvseau` at 28/08/2026 09:31:38 local, which is `2026-08-27T23:31:38Z`.

That timestamp falls inside the sender log's success window recorded in `results/02-create-end-to-end.md`.
**The order that sent successfully was plain `261111`, not `261111-SplitShipment-HARBOUR-TOWN`.** Slice
02 listed the 33-character split child among the successful sends; slice 01 and slice 07 record the
same string hard-erroring on the 25-character ShipmentId limit and never reaching SQS. Slice 01 and 07
are right. Slice 02 conflated the parent with the split child. Correction appended to
`results/02-create-end-to-end.md`.

Header statics confirmed on this record and again on `261115` and `WOR19261`: Company `CTC`, Warehouse
`CTC-QDC`, OrderType `ECOM`, AllocateComplete true, ConsolidationAllowed false, Priority 5, Consolidated
false, Manually Entered false. The Customer panel is empty but for Company `CTC`; the customer lands in
the Ship To panel. Both HLDs' `Warehouse = UNI-CTC` is wrong, as already recorded; `51909` to `CTC-QDC`
is now measured on real records rather than read from the LLD.

## Read 1, `261115`. TC1a, the mapping

MEASURED. **The shipment exists in SCALE**, `Created By` `ilssrvseau` at 28/08/2026 09:49:16 local,
which is `2026-08-27T23:49:16Z`, matching `wmsSentAt` `2026-08-27T23:49:16.535Z` to the second. TC1's
SCALE-side half was previously PASS on the sender log alone; it is now directly observed.

| Element | Expected | Read | Verdict |
|---|---|---|---|
| `ShipmentId` | `261115` | `261115` | PASS |
| `ErpOrder` | `261115` | `261115` | PASS |
| `Company` | `CTC` | `CTC` | PASS |
| `Warehouse` | `CTC-QDC` | `CTC-QDC` | PASS |
| `OrderType` | `ECOM` | `ECOM` | PASS |
| `AllocateComplete` | `Y` | Yes | PASS |
| `ConsolidationAllowed` | `N` | No | PASS |
| `Priority` | `5` | 5 | PASS |
| `UserDef3` | `THRILLS` | `THRILLS` | PASS |
| `ShipTo` / `ShipToAddress` | populated | both populated, address, city, state, postcode, country, email all present | PASS |
| Lines | 2, the Cin7 option codes, UM `EA` | 2 rows, `TA26-200C-S` and `TDP-321EDD-28`, qty 1 each, UM `EA`, Company `CTC` | PASS |
| `Carrier` | Cin7 `logisticsCarrier` | **empty** | **FAIL** |
| `CommentType` | any value, first sighting | no Comments content to read | not answered |

`ScheduledShipDate` and `Planned Ship Date` both read 27/08/2026, which is the UTC date of the
`2026-08-27T23:41:52Z` we sent. Cin7's UI shows 28-08 local for the same instant. Timezone display,
not a mapping defect. Status `In Pool`, Wave 0, Rejection Note empty.

### The `UserDef3` question is closed, no defect

The brand map keys on `Shopify V2_thrills` with a space; this order's `projectName` is
`ShopifyV2_thrills` with none, and the map still resolved. `WOR19261` reads `WORSHIP` on the other
spelling. The whitespace theory is dead and `packingBrandMisses` reading zero is trustworthy.

### `Carrier` is a defect. Three measurements, three different kinds

| Where | Value |
|---|---|
| Cin7 API, SO `261115` | `logisticsCarrier: "Australia Post"` |
| Cin7 web UI, same order | Carrier `Australia Post` |
| `staging-orders-v2` order row | `carrier: UNASSIGNED` |
| Manhattan SCALE, shipment `261115` | absent |
| Manhattan SCALE, shipment `261111` | absent |

The LLD's per-type matrix sends `Carrier` from `logisticsCarrier` on ECOM, WHOLESALE and RTV. The
source field is populated, so this is not a source-data gap. The order row is written from the
poller's payload, so **the value is lost at the poller's mapping step, before the sender.** The
sender is not implicated.

Warehouse visible: the DC's own test shipments all carry AUSPOST or STARTRACK, so a blank carrier is
not what that warehouse expects to receive.

**Not yet raised with dev.** Scope is unestablished: this is two orders, not the population. The
next attempt is a scan of every CTC order row for the `carrier` attribute, which turns the finding
from "one order" into "the integration" or kills it. Registered as **Q33**.

### Two cases that turn out to be untestable on ECOM

**`ScheduledShipDate` mapping.** The read sheet expects `estimatedDeliveryDate`. Cin7's API returns
`createdDate` and `estimatedDeliveryDate` as the **identical** value `2026-08-27T23:41:52Z` on this
order, so no ECOM order can discriminate which one the mapping reads. Needs a wholesale order.
Deferred as **D14**.

**`CustomerPO`.** `customerOrderNo` is empty on this order, so the build correctly omits the element
and there is nothing to search for. Probably true of Shopify ecom orders generally. Deferred as **D15**.

## Read 2 and 3, `WOR19261`. TC6 grain, TC10 packing brand

MEASURED. `ShipmentId` and `ErpOrder` both `WOR19261`, Internal Shipment Number 7706, Order Type
`ECOM`, Warehouse `CTC-QDC`, Allocate Complete Yes, Consolidation Allowed No, Manually Entered No,
Wave Number 0.

**TC6 PASS, and it is the clean branch.** One line: `PDTC25-1003B-ONE SIZE`, Total Qty 2, Remaining
Qty 2, UM `EA`, Company `CTC`. Our side holds two per-unit shipment item rows, both
`sku=PDTC25-1003B-One Size`, both `lineItemId=3478079`, neither carrying a `quantity` attribute
(slice 05). **The sender aggregates per-unit rows back into one line carrying the quantity**, which
is what LLD section 5 specifies.

That also settles the line-identity worry the case was written to expose: two units of one option
arrive as one line, so the pair `ErpOrderLineNum` and `SKU.Item` stays unique and a short pick can be
attributed to a line. Evidence added to **D8**; D8 is not closed, because the wholesale per-size
grain has not been read.

**TC10 PASS on both halves.** `User Defined Field 3` = `WORSHIP`, against `THRILLS` on `261115`. The
brand map resolves on both spellings. Warehouse `CTC-QDC`.

## Read 4, `261106`. TC18, ship to truncation

MEASURED. PASS on both halves.

* `ShipTo`: exactly **25** characters, truncated.
* `ShipToAddress` `Name`: the full **29** characters, untruncated.

Values not recorded, real customer name. The design intent holds: `ShipTo` is an identifier capped at
25, `ShipToAddress.Name` carries the full value for display. A truncation-only test would have missed
the second half, which is the half the warehouse reads.

## What this leaves

* TC1a FAIL on `Carrier`, PASS on everything else read. Q33 open, scan not yet run.
* TC6, TC10, TC18 fully PASS, both halves.
* `OrderDate`, `ErpOrderLineNum`, `CustomerPO`, element ordering and the mandatory field set are not
  observable in this UI. Not blockers, but nothing further will come from a UI read.
* D14 and D15 added. D8 gained evidence.
* `results/02-create-end-to-end.md` corrected on `261111`.

## Scripts written

None. Manual reads only.

---

## Correction, same day: `Carrier` is deliberate, not a defect

Confirmed 2026-09-02, after this file was first written. The missing `Carrier` is an **intended
omission for now**, pending a final decision, and is being handled by a later task. The working
assumption is that carrier is decided when warehouse staff pick the order and mark it ready to ship,
which makes it a value that flows **back** to us rather than one we send outbound.

Consequences, all applied:

* **TC1a is PASS**, not FAIL. Every element read matches LLD section 5 except this one, and this one
  is intended.
* **Q33 is closed** as `NOT TESTABLE, decision`. The population scan it called for is not needed: the
  question it would have answered, whether the omission is systemic, no longer decides anything.
* **The LLD is the document out of step.** Its per-type matrix still sends `Carrier` from
  `logisticsCarrier` on ECOM, WHOLESALE and RTV. That is a correction for Lachlan, not a defect for
  Kian.
* **Deferred as D16**, with no receiving ticket named yet.

The measurements above stand and are worth keeping: the value is present in Cin7 and absent from the
order row, so nothing is mapped at the poller. When the later task lands, that is the baseline it
changes from.

## Audit corrections, 2026-09-02

An evidence audit compared this file against the rows built from it. Three claims above are weaker
than they read.

* **"Not readable in this UI"** should be **not found on the screens opened**. Those were the Planned
  Shipment Insights search, the shipment detail panels, and one line drill-in, across four orders. No
  other SCALE screen, report or export was tried, so `OrderDate`, `ErpOrderLineNum` and `CustomerPO`
  are unlocated, not proven absent. "No further UI read will help" forecloses testing nobody attempted.
* **The character counts in read 4** are single-observer screen reads. No copy-into-counter or length
  check was used. 25 is a known cap being confirmed, so that half is low risk; the full 29 has no
  independent corroboration.
* **The carrier decision** is relayed verbally by james.johnston, with no ticket, message or meeting
  named. It is what flips TC1a and closes Q33, so the attribution gap is open work, not a footnote.
