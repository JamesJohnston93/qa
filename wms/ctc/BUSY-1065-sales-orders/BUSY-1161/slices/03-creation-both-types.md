# Slice 03, creation, both types

**Ticket:** BUSY-1161
**Cases:** TC1a, TC1b, TC1c, TC1d, TC8, TC15
**Depends on:** slice 02 (the fidelity gate and its difference list)
**Estimated:** one session, plus a SCALE UI pass with JJ

**Read `results/02-tool-fidelity-gate.md`'s difference list first, then `../retests/RETEST-POST-1161/results/R1-targeted-retest.md`.** The second one traced a synthetic WHOLESALE and a synthetic RTV through this exact chain to Manhattan acceptance on the current build, with the stored rows and the sender log captured. TC1a's and TC1b's plumbing is MEASURED there. This slice's job is what it did not cover: the SCALE-side content, the supplier email arms, the sent markers on the lines, and the multi-size identity.

## Preconditions

- Slice 02's result file exists and its step 4 emit landed.
- Slice 01 Gate C confirmed a SCALE staging login. Without it TC1a to TC1d are BLOCKED, not FAIL.
- Fresh references. Register each in `../BUSY-1160/SYNTHETIC-REGISTER.md` **before** its emit.
- `--family outbound` on every command. Four of the scenarios this slice uses have an ECOM namesake that auto-resolution picks first.

The engineer's RTV fixtures carry his own staging results from 7 and 8 September. Those are his dev verification, not a QA verdict, and they say where to expect no surprises rather than what to skip.

## Setup

Poller schedule stays DISABLED, watermark stays UNSET. Nothing here needs the poller to run.

## Cases

### TC1a, wholesale order reaches SCALE

Trigger: `invoke-so-revision.sh --family outbound --order-type WHOLESALE --scenario 01-baseline`. The baseline sits on branch `51908`; the deployed poller now stamps `CTC-QDC` regardless of branch, which is drift row 3 and TC16's subject.

Expect: a Shipment in SCALE under the emitted reference, `OrderType` `WHOLESALE`, `Warehouse` `CTC-QDC`, one detail line per size.

Capture: the sender's `OUTBOUND_SHIPMENT_SENT` line with its `sentLineIds`, and from SCALE the order type, warehouse, ship-to, the detail line count and each `SKU.Item`. **Record the observed `AllocateComplete` value without judging it.** The LLD says `Y` for wholesale, the handover says `N`, and drift row 2 in `QA-DOC.md` is what this feeds.

Fails if: no Shipment, or a detail line count that does not match the emitted size count.

Note the line count. TC2 to TC5 compare against it.

### TC1b, RTV order reaches SCALE

Trigger: `invoke-so-revision.sh --family outbound --order-type RTV --scenario rtv/01-baseline`. Composed, not captured: the supplier name arrives in the first-name field with company empty, the address is Australian, there is no email.

Expect: a Shipment, ship-to the supplier, one detail line per size.

Capture: the ship-to as SCALE shows it, and whether `AllocateComplete` reads `N`.

Fails if: the ship-to is empty, or carries a person name where the supplier company was expected. Drift row 4 is the reason to record the shape rather than assert it.

### TC1c, RTV supplier holding no email

Trigger: TC1b's shipment, no new emit.

Expect: SCALE accepted it, and the Ship To block shows no email element rather than a blank one.

Capture: whether the element is absent or present and empty.

Fails if: SCALE rejected the document, or the email is present as an empty string or a fabricated value.

### TC1d, RTV revision carrying a supplier email

Trigger: the same order, `--scenario rtv/02-supplier-email`, which resolves to an update because the order now exists.

Expect: the email appears in Ship To.

Capture: the value SCALE holds after the update.

Fails if: the email does not appear, or the update replaces something it should not have touched.

### TC8, stored header after a send

Trigger: read `staging-shipments` for TC1b's order.

Expect: header at `SHIPMENT#<reference>` reads `SENT_OUTBOUND`, and every `OUTBOUND_ITEM#` row carries its sent marker.

Capture: the header status and the per-line marker for every line. Before the send completes the header reads `PENDING_OUTBOUND`; if it still does, the send has not finished, wait rather than recording a FAIL.

Fails if: the header is `SENT_OUTBOUND` but a line carries no sent marker. That is the exact gap the handover's section 5 warns makes a later line removal get dropped instead of sent.

### TC15, style expanded across several sizes

Trigger: a fresh reference, `--scenario 16-sizes-share-one-line`, three sizes under one line id.

Expect: three rows at `OUTBOUND_ITEM#<line id>#<size code>` under one line id, and three detail lines in SCALE.

Capture: every stored row key, and every `(ErpOrderLineNum, SKU.Item)` pair from SCALE.

Fails if: the sizes collapse, or SCALE holds fewer lines than were sent. Detail-line identity is the pair, never the line number alone.

Leave this order alive. Slice 04's TC5c continues from it with `17-middle-size-removed` then `18-removed-size-readded`.

This is BUSY-1159's TC6b fixture, handed here because a size run is a bulk-order shape and no ECOM order in a hundred had one.

## Teardown

Leave every order in place; slices 04 and 05 revise TC1a's and TC1b's. Confirm the schedule is still DISABLED and the watermark still UNSET.

## Write results to

`results/03-creation-both-types.md`. Record TC1a's line count and both order references under "Values other slices need"; slices 04 and 05 read them from there.

## Stop and ask JJ if

- SCALE rejected a document for a reason not already in the epic register
- the observed `AllocateComplete` for wholesale is `Y`, which contradicts the handover and reopens drift row 2 as a live question
- a case is inconclusive twice in a row
