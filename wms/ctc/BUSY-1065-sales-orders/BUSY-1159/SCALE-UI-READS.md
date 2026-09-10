# BUSY-1159, SCALE UI read sheet

> **CLOSED 2026-09-02. All four reads have run. Do not work through this file again.**
> Results are in `results/12-scale-ui-manual-reads.md`. TC1a FAIL on `Carrier`, TC6, TC10 and TC18
> PASS on both halves. The navigation correction below is the part still worth reading: the reads are
> in Order Planning > Planned Shipment Insights, not Shipping Insights.

The last outstanding work on BUSY-1159. Four reads in the Manhattan SCALE staging UI. Rewritten
2026-09-01 to be worked through screen beside screen, with an answer block at the end.

**Why the UI is the only route.** The sender never logs its outbound XML, only the SCALE response, and
nothing reads a shipment back by id. Everything below is otherwise unobservable.

**Where to search, MEASURED 2026-09-02.** Order Planning > **Planned Shipment Insights**. NOT
Shipping Insights / shipping headers: that screen lists post-wave shipments only, 49 CTC-QDC records
all in the DC team's own `CTC-<date>-<code>` test-data format, and none of ours appear there. A
downloaded shipment sits as a planned shipment until it is waved, so Shipping Insights returning
nothing for our references is expected and is not a finding.

**Search on Company plus ShipmentId.** Company is the static value `CTC` for every record in this
epic. ShipmentId is the Cin7 reference, unchanged, no prefix.

**Do not use `WOR19270`.** It is the known-rejected Worship order, missing SKU `WPR25-104A-10`.

All three orders below sent successfully on 2026-08-27, so all three should exist in SCALE. If one is
missing entirely, that is a finding in itself and worth stopping on.

| Order | wmsSentAt | Covers |
|---|---|---|
| `261115` | 2026-08-27T23:49:16.535Z | TC1a, the full mapping read |
| `WOR19261` | 2026-08-27T11:03:15.283Z | TC6 and TC10 |
| `261106` | 2026-08-27T22:19:28.005Z | TC18 |

---

## Read 1, order `261115`. TC1a, the mapping

The main one, and the only field by field check of the mapping against LLD section 5 that anyone will
do on this integration.

Known from our side: `branchId` 51909, `projectName` `ShopifyV2_thrills`, ECOM.

### Header

| Field | Expect |
|---|---|
| `Company` | `CTC` |
| `ShipmentId` | `261115` |
| `ErpOrder` | `261115`, the same value |
| `Warehouse` | `CTC-QDC` |
| `OrderType` | `ECOM` |
| `AllocateComplete` | `Y` |
| `ConsolidationAllowed` | `N` |
| `Priority` | `5` |
| `OrderDate` | Cin7 `createdDate` |
| `ScheduledShipDate` | Cin7 `estimatedDeliveryDate` |
| `Carrier` | Cin7 `logisticsCarrier`, or the field absent entirely |
| `ShipTo` | delivery first + last name, 25 characters or fewer |
| `ShipToAddress` Name | first + last, full length |
| `ShipToAddress` rest | address1, city, state, postcode, country, email |
| `CustomerPO` | Cin7 `customerOrderNo` |
| `Comments` | Cin7 `internalComments`, or absent |
| `UserDef3` | `THRILLS` |

An absent field is not automatically a defect. The build rule is to omit an element when Cin7 carries
no value, never to send it empty and never to default it. So an absent `Carrier` or `Comments` on an
order that had neither is correct behaviour.

### The one that is not a tick: `UserDef3`

**Expect `THRILLS`.**

The LLD's brand map keys on `Shopify V2_thrills`, with a space. The value we captured on this order is
`ShopifyV2_thrills`, with none.

* **`THRILLS`** means the map handles both spellings and there is nothing here.
* **Absent or blank** means a whitespace mismatch in the brand map, and **packing artwork is being
  silently lost on every Thrills ecom order**. `UserDef3` is the brand artwork selector for ecom
  packing, so this is warehouse-visible, not cosmetic. The counter that should have caught it,
  `packingBrandMisses`, reads zero on the Worship order and has never been checked on a Thrills one.

### Detail lines

| Field | Expect |
|---|---|
| `ErpOrderLineNum` | Cin7 `lineItems[].id`, numeric |
| `SKU.Item` | the Cin7 product **option** code, not `productOptionId` |
| `SKU.Quantity` | per line |
| `SKU.QuantityUm` | `EA` |

Note the `CommentType` value if the UI shows one. The LLD says valid values are SCALE side
configuration confirmed during build, and nothing has confirmed them. This is the only chance to see
one.

### What this read cannot answer, so do not go looking

Element ordering. The XSD declares a sequence, the Connections page says alphabetical, and the build
follows the XSD after SCALE rejected alphabetical. The UI renders parsed data, not the document. The
only available evidence is that the shipment was accepted, which is enough for the AC9 drift row.

The mandatory field set likewise is established by what SCALE accepts and rejects, not by what the
screen shows. What this read supports is a statement of which fields arrived populated on an accepted
ECOM shipment, which is the useful half.

---

## Read 2, order `WOR19261`. TC6, item grain

**Count the detail lines. That is the whole test.**

This order carries the same product option twice. On our side it produced two shipment item rows, one
per unit, neither carrying a `quantity` attribute.

| What you see | What it means |
|---|---|
| **One line, `SKU.Quantity` 2** | The sender aggregates per-unit rows back into a line. Matches LLD section 5. Nothing to raise |
| **Two lines, `SKU.Quantity` 1 each** | The per-unit grain carries all the way into SCALE. A finding, and not for this ticket |

If it is two lines, the line count is not the problem. The LLD states detail line identity is the
**pair** `ErpOrderLineNum` and `SKU.Item`, and that the confirmation designs, BUSY-1016 and BUSY-1017,
must match a pick on both fields. Two lines expanded from one style and one option code share both
values, so the pair is not unique and a short pick could not be attributed to a line. That is a
constraint on a design that has not been built yet, which is the cheapest possible moment to find it.

Record: number of detail lines, `SKU.Quantity` on each, `ErpOrderLineNum` on each.

---

## Read 3, order `WOR19261`. TC10, packing brand

Same order, same screen as read 2.

| Field | Expect |
|---|---|
| `UserDef3` | `WORSHIP` |
| `Warehouse` | `CTC-QDC` or `CTC-WH`, record which |
| `OrderType` | `ECOM` |

Our side measured `packingBrand` WORSHIP and `packingBrandMisses` zero, so this one should be clean.
It is the control for read 1's `UserDef3` question: if this says `WORSHIP` and `261115` says nothing,
the difference between the two `projectName` values is the cause and the whitespace theory is
confirmed.

---

## Read 4, order `261106`. TC18, ship to truncation

| Field | Expect |
|---|---|
| `ShipTo` | exactly 25 characters, truncated |
| `ShipToAddress` Name | the full 29 character name, untruncated |

Our side logged the truncation, 29 to 25, and preserved the full value on the ADDRESS row across
`firstName` and `lastName`. The design intent is that `ShipTo` is an identifier capped at 25 while
`ShipToAddress.Name` carries the full name for display.

**Both halves matter.** Truncation alone is only half the design. If `ShipToAddress.Name` is also
truncated, the full name reaches nobody and the warehouse ships to a cut-off name.

---

## Reply with these and I will close the ticket out

Short answers are fine. This is everything needed to move all four cases off NOT RUN.

1. **`261115` `UserDef3`:** `THRILLS`, or absent?
2. **`WOR19261` detail lines:** one line with quantity 2, or two lines with quantity 1?
3. **`WOR19261` `UserDef3`:** `WORSHIP`, or absent?
4. **`261106`:** is `ShipTo` 25 characters, and is `ShipToAddress` Name the full 29?
5. **`261115` header:** anything in the table above that is missing or different from expected, and
   was that field populated in Cin7?
6. Anything that surprised you, including a `CommentType` value if the UI shows one.

I will write the verdicts into `QA-DOC.md` and `results/05-order-shape-cases.md`, push Confluence, and
BUSY-1159 is done bar the deferred and no-population cases.
