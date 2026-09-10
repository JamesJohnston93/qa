# BUSY-1159, SCALE UI runsheet

> **CLOSED 2026-09-02. All four reads have run. Do not work through this file again.**
> Results are in `results/12-scale-ui-manual-reads.md`. TC1a FAIL on `Carrier`, TC6, TC10 and TC18
> PASS on both halves. The navigation correction below is the part still worth reading: the reads are
> in Order Planning > Planned Shipment Insights, not Shipping Insights.

Written 2026-09-02. The do-this-then-that version of `SCALE-UI-READS.md`. That file holds the
reasoning and what each answer means. This one is just the order of operations.

**Navigation, MEASURED.** Order Planning > **Planned Shipment Insights**. Not Shipping Insights:
that screen lists post-wave shipments only and none of ours are waved yet.

**Search on Shipment ID.** It is the Cin7 reference, unchanged, no prefix. Clear the Warehouse filter
if a search comes back empty, in case the order mapped to `CTC-WH`.

**Already confirmed on `261111`, do not redo:** `ShipmentId` = `ErpOrder` = reference, Company `CTC`,
Warehouse `CTC-QDC`, OrderType `ECOM`, AllocateComplete true, ConsolidationAllowed false, Priority 5,
`SKU.Item` = Cin7 option code, UM `EA`, Customer panel empty by design, Ship To panel carries the
customer, records created by the `ilssrvseau` interface account, planned shipments rest at `In Pool`
until waved, Rejection Note empty.

**Not readable in this UI, established on `261111`:** `OrderDate` (no field on the screen; the
`Created By` date is SCALE's own audit stamp, the Status dates are derived), `ErpOrderLineNum` (the
Lines grid exposes only Internal Shipment Line Number), `CustomerPO` (searchable but not displayed),
element ordering, and the mandatory field set.

---

## Step 1. Cin7 lookup on SO `261115`. DONE 2026-09-02

MEASURED from the Cin7 UI (local Brisbane times):

* `Created Date` 28-08-2026 09:41
* `Delivery Date (ETD)` 28-08-2026 09:41, the **same value**
* `Customer PO No` **empty**
* `Carrier` **Australia Post**
* `Project Name` `ShopifyV2_thrills`, no space, as previously measured

Three consequences.

**The ScheduledShipDate question cannot be settled on this order.** Created date and ETD are
identical, so a SCALE value matching one matches the other. It needs an order whose ETD differs from
its created date. Question stays open, do not close it either way from `261115`.

**Do not misread the date in SCALE.** Cin7's UI shows Brisbane local, SCALE stores the value it was
sent, which was `2026-08-27T23:41:52Z`. Expect SCALE to read **27/08/2026** against Cin7's 28-08.
That is a timezone display difference, not a mapping defect.

**Step 3 is dropped.** `Customer PO No` is empty in Cin7, so the build correctly omits the element
and there is nothing to search for. `CustomerPO` is untestable on this order, and probably on any
Shopify ecom order. Carry it to a wholesale order under BUSY-1160.

## Step 2. SCALE, `261115`. TC1a, the mapping read

Search Shipment ID `261115`, open it.

**Carrier, new and now the priority.** Cin7 holds `Australia Post` on this order, but our own Dynamo
readback stored `carrier: UNASSIGNED`, and `261111` showed a blank Carrier in SCALE. Record what
SCALE shows here.

* `Australia Post` or similar, mapping is fine
* blank or `UNASSIGNED`, **finding**: the carrier does not reach the DC. Warehouse visible, and it
  would explain why our shipments show no carrier while the DC's own test shipments show AUSPOST and
  STARTRACK

**User Defined 1-8.** Record `User Defined Field 3`. `Project Name` is confirmed as
`ShopifyV2_thrills` with no space, so this read is the whole discriminator.

* `THRILLS`, the brand map handles the no-space spelling, question closed
* blank, **finding**: packing artwork lost on every Thrills ecom order, and `packingBrandMisses`
  reading zero is not trustworthy

**Reference Info.** Confirm `ShipmentId` and `ErpOrder` both read `261115`, Warehouse `CTC-QDC`,
OrderType `ECOM`.

**Dates panel.** Record Scheduled Ship Date. Expect 27/08/2026 per the timezone note above. Record it
for the file, do not draw a mapping conclusion from it.

**Ship To panel.** Note which fields are populated. Real customer PII, do not paste the values into
any doc, ticket or page.

**Lines.** Record the count and item codes. Expect 2 lines, `TDP-321EDD-28` and `TA26-200C-S`, UM
`EA`. Click one item link and note whether the line detail shows an ERP order line number.

**Comments.** Note any `CommentType` value. Cin7's `Internal Comments` on this order were rewritten
by Starshipit on 31-08, four days after our send, so the text will not match what SCALE holds. That
is expected, not a defect.

## Step 4. SCALE, `WOR19261`. TC6 and TC10

Search Shipment ID `WOR19261`, open it.

**Lines, the whole of TC6.** Record the line count and Total Qty on each.

* one line, qty 2, sender aggregates per-unit rows back into a line, matches the LLD, nothing to raise
* two lines, qty 1 each, per-unit grain carries into SCALE. Not a defect on this ticket, but a
  constraint on the unbuilt confirmation designs BUSY-1016 and BUSY-1017, which match a pick on the
  pair `ErpOrderLineNum` and `SKU.Item`. Two lines from one style and one option share both values,
  so the pair is not unique and a short pick cannot be attributed

**User Defined Field 3.** Expect `WORSHIP`. This is the control for step 2: `WORSHIP` here and blank
on `261115` confirms the whitespace theory.

**Reference Info.** Record Warehouse, `CTC-QDC` or `CTC-WH`.

## Step 5. SCALE, `261106`. TC18

Search Shipment ID `261106`, open it, go to the Ship To panel. Record both:

* `Ship To`, expect exactly 25 characters, truncated
* `Name`, expect the full 29 characters

Both halves matter. If Name is truncated too, the full name reaches nobody and the DC ships to a
cut-off name.

## Step 6. Report back

1. `261115` Scheduled Ship Date, and which Cin7 date it matches
2. `261115` `User Defined Field 3`
3. Customer PO search, hit or no hit
4. `WOR19261` line count and quantity per line
5. `WOR19261` `User Defined Field 3` and Warehouse
6. `261106` Ship To and Name, with character counts
7. Any field on `261115` that was absent, and whether Cin7 held a value for it
8. Anything that surprised you, including a `CommentType` value

That closes TC1a, TC6, TC10 and TC18, and BUSY-1159 is done bar the deferred and no-population cases.
