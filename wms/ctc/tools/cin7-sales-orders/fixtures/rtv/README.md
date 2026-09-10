# RTV scenarios

`01-baseline.json` and `02-supplier-email.json` are generated — run `../../make-rtv-baseline.py`
to rebuild both. Do not edit them by hand.

## Why this is generated rather than captured

Every other fixture directory here is derived from a captured, redacted Cin7 order. This one
cannot be: **no in-scope RTV exists in Cin7 to capture.** Confirmed with the team —
RTVs are rare, every existing one sits on `branchId` 3, and new ones will be raised on 51908/51909.
So the scope is real and forward-looking, but there is nothing yet in it.

`make-rtv-baseline.py` composes the two halves we do have evidence for, rather than inventing an
order:

- **Header shape** from the one real RTV, `TOPG51689-1`, kept at
  `_shared/BUSY-1065/fixtures/variants/rtv-observed-topgrowth.json` — `deliveryCompany` empty with
  the supplier name in `deliveryFirstName`, no customer email, empty `projectName`. That shape is
  what `deriveShipTo`'s fallback exists for, so composing it here exercises the RTV path rather
  than the wholesale `deliveryCompany` one.
- **Line structure** from `../wholesale/01-baseline.json` — 4 style lines over 17 sizes, real
  option codes that exist in the SCALE staging item master. The observed RTV carries a single line
  at a single size, which would exercise neither per-size detail lines nor `ErpOrderLineNum`
  repeating across a style's sizes.

Three things are synthesised, and the generator names all three at the point it applies them: an
Australian delivery address, `branchId` 51909, and `stage: New`.

## The Australian address is deliberate, and it is a limit

An earlier version of this file said the directory was "deliberately empty" and that a hand-built
fixture "would assert the mapping works while hiding the reason it does not". That objection was
right, and it is answered by testing the two halves separately rather than by not testing at all:

- **This fixture** proves the RTV mapping and the whole pipeline, with an Australian supplier.
- **`outbound-sales-order-mapper.test.ts` → "an overseas RTV supplier"** proves the refusal: an
  unmapped `deliveryCountry` hard-errors and names the country, rather than sending a display name
  in a coded field.

Together they hide nothing. Neither one on its own would do.

**What this fixture cannot tell you:** most real RTVs go to overseas suppliers (all four
`Supplier`-group contacts in Cin7 are — two Chinese manufacturers, one Indonesian, Topgrowth), and
the address map is Australia-only. So **RTV cannot be enabled in production until the international
address work lands.** That is a go-live sequencing constraint, not a test gap — see
the design notes.

## Running it

`invoke-so-revision.sh` infers the family and order type from the directory, but `01-baseline` is a
basename shared with `fixtures/ecom/` and `fixtures/wholesale/`, and `--family auto` searches ecom
first. **`--order-type RTV` alone is not enough — it silently resolves to the ECOM baseline.** Pass
both:

    ./invoke-so-revision.sh --stage staging --profile staging \
        --scenario 01-baseline --family outbound --order-type RTV \
        --event CREATE_OUTBOUND_ORDER

Add `--dry-run` to see the transaction without publishing.

## Staging result — baseline

First RTV send to SCALE staging. Reference `RTV1161Sep26`, **accepted**. Chain ran clean end to
end with no DLQ traffic at any stage:

    CREATE_OUTBOUND_ORDER -> OUTBOUND_ORDER_CREATED -> bridge
      -> OUTBOUND_SHIPMENT_SAVE -> materialiser -> OUTBOUND_SHIPMENT_READY
      -> outbound sender -> SCALE (accepted) -> OUTBOUND_SHIPMENT_SENT

Header landed as `orderType: RTV`, `allocateComplete: N`, `warehouse: CTC-QDC`,
`shipTo: Test Supplier Ltd`, 17 `OUTBOUND_ITEM` lines, `status: SENT_OUTBOUND`.

**What it settled:** SCALE accepted the shipment with **no `EmailAddress` element and no `Carrier`
element**. The SO HLD §5.3 marks `ShipToAddress.EmailAddress` mandatory; the LLD §5 per-type matrix
says RTV omits it and never fabricates one. The LLD is right. That completes the "mandatory field
set — established on first staging send" row for RTV, which the LLD makes a per-type requirement.

## `02-supplier-email.json` — an RTV that has an email

The baseline carries no email because the one observed RTV had none, and the mapper used to drop
one even where Cin7 supplied it. **Cin7 does hold RTVs with an email address** ,
so the mapper now passes one through and this fixture is the case that proves it: the same order
one revision later (`modifiedDate` 2026-09-08), carrying `rtv.supplier@example-test.invalid`.

Run it after the baseline, so it lands as an `UPDATE_OUTBOUND_ORDER` on a live order:

    ./invoke-so-revision.sh --stage staging --profile staging \
        --scenario 02-supplier-email --family outbound --order-type RTV

Expect `EmailAddress` on the Shipment `ShipToAddress` where the baseline's send had none. The two
fixtures together cover both halves — absent and present — which is why the baseline keeps its
empty email rather than gaining one.

### Staging result — email revision

Both revisions sent and **accepted**, and the email **confirmed present in the Ship To section** of
the shipment SCALE holds. Baseline first (`lastModified` 2026-09-07, no `EmailAddress`), then the
email revision as an `UPDATE_OUTBOUND_ORDER` (`lastModified` 2026-09-08) upserting over it. No DLQ
traffic at any stage.

So SCALE accepts an RTV either way, and **the baseline conclusion needs narrowing**: that run
established only that `EmailAddress` is *not mandatory*, not that RTV should omit it. LLD §5's
matrix cell — "none — the field is omitted, never faked" — generalised from the one observed RTV,
and the mapper implemented it by discarding an email Cin7 supplied. See
the design notes; the cell is what needs correcting, not the code.

Note that the sent document itself is not recoverable from CloudWatch — the outbound sender logs no
payload and has no `LOG_REDACTED_PAYLOAD` hook (the design notes),
which is why this was checked in the SCALE UI.

## Scenario set

The baseline and the email revision. The wholesale directory's 19 revision scenarios (quantity changes, size
added/removed, cancellation, the ordinal cap) are generic to both outbound types — run them with
`--order-type RTV` to exercise the RTV header against the same revision shapes. A separate RTV
scenario set would only duplicate them; what RTV does not share with wholesale is the header, and
that is what this baseline carries.
