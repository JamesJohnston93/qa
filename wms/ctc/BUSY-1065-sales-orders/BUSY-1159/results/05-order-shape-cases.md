# Result: Slice 05, order shape cases

**Ticket:** BUSY-1159
**Verdict:** TC6 PASS (automated half), TC10 PASS (automated half), TC18 PASS. All three manual SCALE UI reads handed to the manual list, since none was blocked by a rejection.

## Orders chosen

All three candidates were found via `find-cin7-sales-order.sh --group 'Retail - Ecomm' --max-pages 2 --limit 250 --raw --with-contact`, filtered client-side without printing any customer name, email or address to the terminal (only reference, dates, line codes, and field lengths where relevant). All three had already been created and sent by the ambient continuous schedule before this slice started, so nothing was polled fresh, matching the pattern already established in slices 02-04.

* TC6 and TC10 together: `WOR19261` (Worship, one line item, qty 2 of the same option)
* TC18: `261106` (Thrills, ship-to name over 25 characters)

## TC6, grain and aggregation

MEASURED, via `inspect-ctc-order.sh --reference WOR19261`:

* Shipment items: 2 rows, both `sku=PDTC25-1003B-One Size`, both `lineItemId=3478079`, neither carries a `quantity` field.

Automated half PASS: 2 shipment item rows for the repeated option, matching the order's own qty 2 line, no `quantity` field on either. The SCALE-side half (`Quantity: 2` on one aggregated line, UOM `EA`) needs the manual UI read, handed to the manual list. Order was accepted (`wmsSentAt` `2026-08-27T11:03:15.283Z`, sender `outcome:"success"`), so the manual read is not blocked by a rejection.

Per the slice's own note: this is per-unit rows with no quantity field, which is what the LLD specifies for ECOM. AC4's "one record per line carrying a quantity" wording is stale (already logged as correction C2 in the open questions register), not re-raised here.

## TC10, Worship packing brand

MEASURED:

* Order row `packingBrand`: `WORSHIP`.
* Cycle `2026-08-27T10:56:52.532Z` (the create cycle for this order): `packingBrandMisses: 0`. Checked every cycle in the surrounding 8 minute window, all read `packingBrandMisses: 0`.
* Sender outcome: `{"outcome":"success","flow":"SO","reference":"WOR19261","durationMs":779}`.

Automated half PASS: `packingBrand` correct on the order row, `packingBrandMisses` zero, order successfully sent (not rejected). `UserDef3` reading `WORSHIP` on the SCALE Shipment itself needs the manual UI read, handed to the manual list, not blocked.

Not "Blocked" as the slice worried it might be: a genuine Worship order was found and it did successfully reach SCALE.

## TC18, ship to truncation

MEASURED, full unfiltered sender log window around the send:

* `WARN Truncating Customer.ShipTo to 25 characters: "<redacted, 29 characters>"` at `2026-08-27T22:19:25.727Z`. Redacted here per the hard constraint; the raw line contains the customer's full name and was not carried into this file.
* `Manhattan ShipmentDownload response: accepted=1 rejected=0`, then `{"metric":"ManhattanRequestOutcome","outcome":"success","flow":"SO","reference":"261106","durationMs":2221}`.
* `wmsSentAt`: `2026-08-27T22:19:28.005Z`.
* Address row (`address-field-lengths.sh`, new script, see below): `firstName` length 5, `lastName` length 23. Concatenated with one space, 29 characters, matching the length of the string the warning line truncated. The full, un-truncated name is preserved across these two fields on the order's own `ADDRESS#SHIPPING` row, it is only the outbound `Customer.ShipTo` element sent to SCALE that is cut to 25 characters.

PASS on every checkable part: a warning was logged, the shipment was accepted rather than rejected, and the full value survives on the address side. Confirming the SCALE-side address name element actually carries the full value too is the manual half, handed to the manual list.

## Scripts written

| Script | Reviewed |
|---|---|
| `scripts/address-field-lengths.sh` | not yet |

Prints only ADDRESS row field lengths, never values, so a truncation or shape check can be done without a customer name, email or address ever leaving the script. Added to `SCRIPTS.md`.

## Fails if conditions

None triggered on any of the three cases.

## Teardown

Watermark unchanged, nothing was polled this slice (all three candidates were already live). Schedule left ENABLED, more slices running today.

## Also handed to the manual list

TC6, TC10 and TC18's SCALE UI reads, on `WOR19261` and `261106`, as planned. None is blocked by a prior rejection, both orders reached SCALE successfully.

---

## SCALE halves closed, 2026-09-02

TC6, TC10 and TC18's manual SCALE UI reads have run. All three PASS.

* TC6: SCALE holds **one** line for `WOR19261`, `PDTC25-1003B-ONE SIZE`, Total Qty 2, UM `EA`. The
  sender aggregates the two per-unit rows recorded above back into a single line carrying the
  quantity, matching LLD section 5.
* TC10: `User Defined Field 3` = `WORSHIP`, Warehouse `CTC-QDC`.
* TC18: `ShipTo` exactly 25 characters, `ShipToAddress` `Name` the full 29, untruncated.

Full detail, including TC1a's carrier failure, in `results/12-scale-ui-manual-reads.md`.
