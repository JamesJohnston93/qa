# Slice 05, order shape cases

**Ticket:** BUSY-1159
**Cases:** TC6, TC10, TC18
**Depends on:** slice 01
**Estimated:** one session, plus a manual SCALE read afterwards

Each case needs a specific kind of order found in real data. Find all three first, then poll, so the session spends its API budget once.

## Preconditions

* Slice 01 passed.
* Poller schedule rule enabled.
* Option codes on each chosen order exist in the SCALE staging item master.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
./survey-cin7-orders.sh --max-pages 2
./find-cin7-sales-order.sh --group 'Retail - Ecomm' --max-pages 2 --raw --with-contact
```
Find, and record in `fixtures.md`:
* an order with two or more units of the same product option (TC6)
* an order with `projectName: Shopify V2_Worship` (TC10)
* an order whose delivery name or company exceeds 25 characters (TC18)

One order may satisfy more than one. Poll each in its own narrow window.

## Cases

### TC6, grain and aggregation
Trigger: poll the repeated option order.
Expect: N shipment item rows for that option, none carrying a `quantity` field, and one SCALE line for the option with `Quantity: N` and UOM `EA`.
Capture: the row count from `inspect-ctc-order.sh`, and the SCALE line quantity from the manual read.
Fails if: the row count or the SCALE quantity is wrong. Per unit rows are **not** a failure against AC4. The LLD is the source of truth and it specifies per unit with no quantity field for ECOM. AC4's wording is stale, so record it as a documentation correction for Lachlan.Paulsen, not a code defect.

### TC10, Worship packing brand
Trigger: poll the Worship order.
Expect: `packingBrand` on the order row reads `WORSHIP`, `UserDef3` on the SCALE Shipment reads `WORSHIP`, and the cycle summary shows `packingBrandMisses` at zero.
Capture: all three values.
Fails if: `packingBrandMisses` is non zero, which means the project name matched no known spelling and the brand was silently omitted. That counter is the only signal, so read it even when the brand looks right.
Blocked if: no Worship order exists in the window. Only Thrills has been exercised so far, so this path stays untested until one is found.

### TC18, ship to truncation
Trigger: poll the long name order.
Expect: the ship to element truncated to 25 characters with a warning in the sender log, the full value present on the address name element, and the shipment accepted rather than rejected.
Capture: the truncated value, the warning line, and the full value from the address element. Redact the customer name before it leaves the result file.
Fails if: SCALE rejects the shipment, or the full value is lost from both places.

## Teardown

Leave the watermark advanced. Disable the schedule rule if no further slice runs today.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/05-order-shape-cases.md`

## Also hand to the manual list

The SCALE UI reads for TC6, TC10 and TC18.
