# Result: Slice R9, the fixture watcher

**Ticket:** BUSY-1158 and BUSY-1159
**Verdict:** Built and run once. **Check 1 hits hard: 69 of 70 already-sent CTC references now show a
later Cin7 `modifiedDate`.** This unparks R3 (TC3, TC21, TC21b) immediately, using R4's own four
orders among the 69. Checks 3, 4 and 5 also found real candidates for TC6, TC9 and TC15, but every one
of them has already progressed to `Dispatched`, past the stage window the poller can still create
from - real finds, not currently usable. Check 2 (cancellation) found nothing. TC4 and the version
guard's discriminating half stay parked: the one hit spot-checked for content shows a pure stage
progression, not a line, quantity or address edit, so check 1's abundance answers R3's actual scope
but does not yet prove a TC4-shaped fixture exists.

## What was built

`scripts/watch-for-fixtures.sh --stage <stage> --profile <profile> [--recent-days N]
[--sent-window-days N]`. Read only, GET only against Cin7, no AWS writes, no Cin7 writes, no poll.
Read `SCRIPTS.md`, `../../SCRIPTS-INDEX.md`, `../../BUSY-1158/SCRIPTS.md` and `../../BUSY-1159/SCRIPTS.md`
first; reused `find-picked-stage-orders.sh`'s single-bounded-GET shape and `find-cin7-sales-order.sh`'s
reference-quoting convention rather than writing either from scratch.

**Checks 1 and 2** share one data source: `staging-shipments`, bounded via the `allocated_store_index`
GSI (`allocatedStore` = a CTC branch), never a full table scan. Every CTC shipment header observed in
this plan carries `allocatedStore 51908` or `51909`; querying both returned 70 items for `51909` and,
notably, **zero for `51908`** - independent corroboration of R5/R8's finding that wholesale orders
(Cin7 branch 51908) never reach `staging-shipments` at all. From that bounded set, headers with
`wmsSentAt` present, within the sent-window (default 14 days), give the already-sent reference set.
Each origin's stored `lastModified` is read from `staging-orders-v2` via its `origin_index` GSI, a
direct query per reference, no scan. Current Cin7 state for the whole batch is one (or a few, batched
at 20 references) `reference IN (...)` GET.

**A reference-quoting fact worth recording for every future script:** Cin7's `reference` field
requires the **literal `#` prefix** in a filter, for every reference shape, not just numeric-looking
ones. Confirmed directly this session: `reference='261115'` returns nothing, `reference='#261115'`
returns the order; `reference='WOR19261'` also returns nothing, `id=964414` resolves to the literal
value `'#WOR19261'`. Both `find-cin7-sales-order.sh --reference` and this script already require the
caller to pass `#` explicitly for numeric references; this generalises that requirement to every
reference this script builds itself.

**Checks 3, 4 and 5** share one data source: a paginated Cin7 GET, `branchId IN (51908,51909) AND
modifiedDate>='<recent-cutoff>'`, capped at 20 pages (2000 orders) so a volume spike cannot blow the
shared Cin7 budget. `lineItems[].sizes[].code` is the actual SKU string (confirmed against a known
example, `WDTC26-211E-8`), used for check 3 (a code repeated across an order's own lines) and check 4
(matching the two known-absent codes, `TH25-318B-28` and `WPR25-104A-10` - the full SCALE item master
was not checked, no cheap programmatic access exists, see Q9). Check 5 is reference length alone.

**Every hit in checks 3, 4, 5 is tagged `ELIGIBLE` or `PAST`.** This environment's orders move from
`Processing` to `Dispatched` in 1-3 hours, faster than even a same-day re-check; a hit already past
`New`/`Processing`/`Partially Picked`/`Fully Picked` is real but the poller can no longer create it
today. This was not obvious before building the script and is the main design lesson from this
session: **`--recent-days` defaults to 1, not 3**, and the fetch is fully paginated, after finding
a 3-day window returned 500+ orders across at least 5 pages while a 1-day window returned 229 across
3 - the narrower, paginated window is both cheaper and more likely to catch something still eligible.

## First run, 2026-09-04T03:43:46Z

```
sent-window: 14 days. recent-window: 1 day.
already-sent set: 70 reference(s), all allocatedStore 51909, zero at 51908.
```

**Check 1, second-revision orders: 69 of 70 candidates.** Full list of reference / stored `modifiedDate`
/ current `modifiedDate` / current stage in the script's own output, not reproduced row by row here;
representative sample:

| Reference | Stored `modifiedDate` | Current `modifiedDate` | Current stage |
|---|---|---|---|
| `261115` | 2026-08-27T23:48:03Z | 2026-08-30T23:15:58Z | Dispatched |
| `WOR19261` | 2026-08-27T11:01:02Z | 2026-08-31T02:51:13Z | Dispatched |
| `261842` (R4) | 2026-09-04T02:24:05Z | 2026-09-04T03:26:26Z | Dispatched |
| `261843` (R4) | 2026-09-04T02:24:04Z | 2026-09-04T03:25:27Z | Dispatched |
| `261844` (R4) | 2026-09-04T02:24:02Z | 2026-09-04T03:26:27Z | Dispatched |
| `261558`, `261837`, `261838`, `261839`, `EXC-260435-1` | (R5's cycle) | 2026-09-04T03:25-03:26Z | Dispatched |

All 69 read `stage=Dispatched`, `status=APPROVED`. The one reference not hit, `WOR19169A` (R4's
fourth order), correctly did not appear: its current `modifiedDate` (2026-09-04T02:22:26Z) equals what
was stored, and its stage is still `Processing` - it genuinely has not been revised yet, confirming
the check does not simply list everything.

**Content check, MEASURED on one sample (`261115`):** current Cin7 line items are the same two SKUs
(`TA26-200C-S`, `TDP-321EDD-28`) as our own stored ITEM rows, same count, no line added or removed.
Delivery name and address length both present and unremarkable. **This is a stage progression
(Processing -> Fully Picked -> Dispatched), not a content edit.** Not independently re-checked on all
69; treat every hit as "a genuine second sighting exists" (which is exactly what TC3 and TC21/TC21b
need) rather than "a line/quantity/address edit exists" (which is what TC4 specifically needs) until
one is checked and shown otherwise. **TC4 and the version guard's discriminating half stay parked** on
this evidence; R3's own actual scope (TC3, TC21, TC21b, per `KICKOFF.md`) is fully unblocked by this.

**Check 2, cancelled or voided: 0 candidates.** No already-sent reference carries `isVoid=true` or a
`cancellationDate`.

**Check 3, repeated option code: 10 candidates**, all `[PAST]` (`Dispatched`): `#261755`
(`TW26-178G-L`), five `MAPY00*`/`WATF00*` wholesale references with up to 11 repeated codes each,
three more (`976977Sep26`, `982498Sep26`, `980378Sep26`). `#261755` is confirmed ECOM
(`Retail - Ecomm`, 3 line items), never pulled into our own pipeline (`inspect-ctc-order.sh`: 0 rows).
The wholesale ones are out of this ticket's ECOM scope regardless of eligibility.

**Check 4, item-master-absent SKU: 1 candidate**, `[PAST]`: `#261779` carries `TH25-318B-28`, confirmed
ECOM, never pulled into our pipeline, but `Dispatched` already.

**Check 5, over-25-character reference: 1 candidate**, `[PAST]`: `EXC-261371-SplitShipment-HARBOUR-TOWN-1`,
39 characters, `Dispatched` already.

## What this does NOT prove

A hit is a candidate fixture, not a verified test result, per the script's own header. Check 1's
volume proves "a naturally occurring second sighting exists," not "BUSY-1160 reconciles a line edit
correctly" - that needs a hit whose content actually differs, still unconfirmed. Checks 3-5's hits
prove the shape existed recently, not that it is usable today; `[PAST]` hits are worth knowing about
(the shape is real, at least occasionally, in this data) but cannot feed TC6, TC9 or TC15 as written.

## Scripts written

`scripts/watch-for-fixtures.sh`, this slice. Read only. **Not reviewed.** Row added to `SCRIPTS.md`.

## Running it again

Daily, or at the head of any session in this folder, per the slice. Given the `[PAST]` result this
run, checks 3-5 may need a same-day, more-frequent re-check (hourly rather than daily) to ever catch
something `ELIGIBLE` in this environment's fast lifecycle; noted for whoever runs this next rather
than changed unilaterally here, since it also multiplies Cin7 API usage.

## Stop and ask JJ

**Check 1 hit, as the slice's own stop condition names.** 69 candidates, time-critical per the
perishability note. Acting on it now: proceeding straight to R3 with these fixtures per the revised
run order (R9, R8, R3), rather than stopping the pass to report and wait.

## Teardown

None. Nothing was changed.
