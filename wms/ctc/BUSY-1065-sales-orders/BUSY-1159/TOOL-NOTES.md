# BUSY-1159 tool notes

Bugs found in the testing scripts themselves, and what was changed. The scripts are under test alongside the system.

This file is for defects and changes. The inventory of what exists lives in `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md`.

## Known before the run

* `cin7-watermark.sh` defaults to `--poller item`. Every sales order call must pass `--poller so`. Documented in the script header, easy to miss, and getting it wrong rewinds a different feed.
* `--set` without `--confirm` is a dry run. A run that looks like it worked may have written nothing. Always read the value back with a plain get.
* `tail-logs.sh` covers only the item master lambdas (`enrich`, `sender`, `buffer`). There is no sales order option. Use `aws logs tail` or `aws logs filter-log-events` directly.
* `check-ctc-consumer-guards.sh` needs about 10 minutes before a negative result can be trusted, because some consumers log late.
* `clean-ctc-order.sh` is hard locked to `kian-dev` and checks the AWS account independently of `--stage`. Do not work around it.
* Cin7 credentials come from a `.env` beside the scripts holding `CIN7_USERNAME` and `CIN7_API_KEY`, not from AWS.

## Found during this run

* `cin7-watermark.sh`, slice 03: the post-`--set --confirm` confirmation message hardcoded item-poller cadence and buffer-flush language ("every 3 minutes... poll cycle + buffer flush") regardless of `--poller`. The script's own header already documents the SO poller runs every 2 minutes with no buffer flush, so this was purely the runtime message being wrong, not the header or the actual watermark-setting logic. Did not affect any result, since the correct cadence was already known from the header, but would mislead anyone waiting on the wrong timing. Fixed to branch on `$POLLER` and print the correct cadence per poller. No earlier case depended on the old message text, nothing to re-run.

* `check-ctc-consumer-guards.sh`, slice 03, real defect, not cosmetic. The RAN-kind check used `aws logs filter-log-events ... --limit 5 --no-paginate --query 'length(events)' --output text | head -1`. On TC12's first run this reported a false FAIL for both `staging-orders-v2-create-order` and `staging-shipping-v2-order-created`, "expected to run, reference not found", for a reference that had in fact run (confirmed present twice in each log group by a manual full-history pull). Root cause: these two log groups are shared across every UNI order (84 and 78 events respectively in the 2 hour window), `--no-paginate` caps the search to a single underlying API page, and `head -1` then keeps only that first page's count even on the rare occasion pagination is allowed, so a match sitting in a later page reads as 0. Fixed by dropping `--limit`/`--no-paginate` and switching to `--output json` piped through a small Python counter that reads the merged event array, which is immune to the per-page count printing that `--query 'length(events)' --output text` does under multi-page pagination. Re-ran TC12 after the fix: both rows now correctly read PASS. Any earlier consumer-guard result taken at face value before this fix should be treated as unverified rather than trusted, since a false FAIL was possible on any RAN-kind row.

* `invoke-so-poller.sh`, slice 08, not a defect in what it asserts but a real trap in how it is read. On a wide watermark window (24 hours, 3 days) the underlying `aws lambda invoke` call can outlast the CLI's own client-side patience and return `TooManyRequestsException (reached max retries: 2)` to the terminal, reading as a failed invocation. The real invocation was in fact still running on Lambda's side (reserved concurrency 1) and completed normally 60 to 90 seconds later, visible only by querying CloudWatch logs directly for a `REPORT` line after the fact. Retrying immediately on seeing this error risks a second concurrent invoke request queuing behind the first, which briefly happened here (a harmless near-empty second cycle, since the watermark had already advanced). **Do not retry on this error for a wide window.** Wait, then check CloudWatch logs for the `REPORT` line before deciding the invoke actually failed. Script not changed, since the underlying invoke and metric logic are correct; only the operator's reading of a CLI error needed correcting.

## `inspect-ctc-order.sh`, row counting is misleading

Found in slice 02 (TC8), recorded in `results/02-create-end-to-end.md` but never logged here until
the 2026-08-30 cleanup.

The script buckets everything that is not `ITEM#...` together as "headers", which mixes the shipment
header row with `TRANSACTION#...` audit rows. A row count from it cannot answer "one order row, one
transaction row, one header". TC8 was answered by querying the raw SKs directly instead, and slice 09
wrote `scripts/list-transaction-rows.sh` for the same reason without either session naming the cause.

Not fixed. The script is still correct for "does this reference exist and roughly how much is
written", which is what most callers use it for. Anyone counting record kinds should use
`scripts/list-transaction-rows.sh`.

## Manhattan SCALE staging UI, navigation (2026-09-02, MEASURED)

**Shipments we send land in Order Planning > Planned Shipment Insights.** Search on `Shipment ID`,
which is the Cin7 reference unchanged, no prefix, no transform. Clear the Warehouse filter if a
search returns nothing, in case the order mapped to `CTC-WH` rather than `CTC-QDC`.

**Not Shipping Insights.** That screen lists post-wave shipments only. On 2026-09-02 it held 49
CTC-QDC records, every one in the DC team's own `CTC-<YYYYMMDD>-<code>-<suffix>` test-data format with
synthetic ship-to codes, and none of ours. A downloaded shipment rests at `In Pool` until the DC waves
it, so an empty result there for our references is expected. This cost an hour and produced a wrong
theory before it was caught.

**Telling our records from hand-made ones:** `Created By` = `ilssrvseau` (the interface service
account) and `Manually Entered` = `No`. The `Created By` date is SCALE's own audit stamp and matches
`wmsSentAt` to the second, which makes it a usable correlator.

**Panels:** Reference Info (the header statics), Status, Dates, Customer (empty by design but for
Company), Ship To (carries the customer), User Defined 1-8 (`UserDef3` is field 3), Lines, Comments.

**Not rendered anywhere in this UI:** `OrderDate`, `ErpOrderLineNum` (the Lines grid's full column set
is Icon, Color, Item, Description, Company, Total Qty, Remaining Qty, UM, Internal Shipment Line
Number), and `CustomerPO` (a search filter only). Element ordering and the mandatory field set are not
observable either, since the UI renders parsed data rather than the document.

**Timezone:** SCALE holds the instant it was sent, Cin7's UI renders Brisbane local. A one-day
difference in the date part is display, not drift.

## The SO poller's fetch window has no upper bound, and dispatch batches are frequent, not daily (2026-09-04, MEASURED)

Found in RETEST-1158-1159 slice R10, `results/R10-reachability.md` has the full detail. Recorded here
because it constrains every future watermark-touching case on this poller, not just that retest.

**No payload can bound the window above.** The handler's fetch window is always
`[watermark minus 5 minutes, invoke time]`. Four payload shapes were tried against a live invoke
(`modifiedBefore`, `modifiedTo`, `until`, and a combined `modifiedSince`/`modifiedBefore` pair) and
every one was silently ignored; the logged `modifiedBefore` was invoke time regardless of what was
sent. `invoke-so-poller.sh` itself already only sends `'{}'` and this confirms there is no richer
payload worth adding to it. **Staleness and blast radius are the same problem for this handler**: the
only way to keep a manual cycle's window narrow is to keep the watermark recent, and a target whose
own `modifiedDate` has aged past a busy stretch cannot be reached in isolation by any invoke-time
mechanism found so far.

**CTC/UNI order-modification activity follows a clean daily cycle, not a single recurring batch.**
Aggregated across ~4.5 days (1,617 orders, both CTC branches): activity concentrates almost entirely
in UTC 21:00-05:59 (~9 hours, roughly Australian business hours 07:00-16:00 AEST) and is essentially
zero for the other ~15 hours a day. *Within* the active window, elevated-volume events (10+ orders in
one minute) occur repeatedly, not just once: 22 distinct events measured, sized 10 to 455 orders each,
spaced anywhere from 12 to 136 minutes apart (median 40, mean 56). **There is no reliable safe gap
within the active window** - the only genuinely clear interval is the daily quiet period itself. A
window of any real size set during the active window carries real, non-negligible risk of spanning one
of these events; always count the live window directly before invoking (every slice this pass has
done this) rather than trusting a schedule.

## Cin7's `modifiedDate` is current state, not history (2026-09-07, MEASURED)

Found in RETEST-1158-1159 slice R11, Gate B. Recorded here because it forecloses a whole class of
method, not just that gate's.

A Cin7 GET filtered on a past `modifiedDate` window returns nothing, because `modifiedDate` is a
live, mutable, current-state field rather than an append-only history. An order whose stage has moved
since no longer matches the window it was fetched in. Verified three ways: ten historical windows
taken from the poller's own cycle-start log lines all returned zero orders despite the poller having
logged 1 to 5 fetched in each; the identical query mechanism against a current window returned real
orders immediately; and a window only three days old, whose eight references were on file from two
prior slices, also returned zero. **No historical cycle's order-set membership can be reconstructed
after the fact.** Any reconciliation, containment or after-the-event attribution has to be captured
during the cycle, not rebuilt from Cin7 later.

**The 5 minute lookback, confirmed on scheduled cycles.** The poller's own cycle-start line prints
`modifiedSince` exactly 5 minutes before the watermark, measured twice on independent scheduled
cycles. So a test window is always 5 minutes wider than the watermark set, and orders just outside
the intended window will be swept in. This is correct behaviour, not a defect, but it has to be
allowed for when a window is chosen to hold one specific order.

## Confluence markdown round trip drops bold markers. Do not read it as drift

Found 2026-09-10 during the wrap-up push of `QA-DOC.md` to page 1929805827.

The push was verified byte identical before sending: 36,412 bytes local, 36,412 bytes decoded in the
container, then sent as the body. **On read back through `getConfluencePage` with
`contentFormat: "markdown"`, several `**bold**` spans had lost their markers**, for example
"No case is `BLOCKED` any more" and the §9.2 quote about `company` being what every consumer guard
keys on. One bold span was reflowed.

Confluence stores the body as ADF and re-renders markdown on fetch, so the markers are lost in its
storage round trip, not by the push. The page itself renders correctly.

**Consequence for the wrap-up routine.** A future local-versus-Confluence comparison done by fetching
markdown through this API **will show differences that are not drift**, and they cluster on bold
markers. Compare the case table rows, the status tokens and the case count instead, which survive the
round trip. Do not "fix" the local file to match a fetched copy: the local file is the source and the
fetched markdown is a lossy render of it.
