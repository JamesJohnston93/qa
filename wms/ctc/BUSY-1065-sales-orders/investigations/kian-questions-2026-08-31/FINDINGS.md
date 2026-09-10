# Findings, narrowing the open questions for Kian

Epic BUSY-1065. Read this, not the slice results, if you have four minutes. Method and evidence
detail live in `results/01-cheap-reads.md` and `results/02-behavioural.md`.

## Q2. Does the sales order handler batch 10 against a 60 second timeout, the way the purchase order
handler did on BUSY-1260?

**Narrowed.**

Measured: `staging-orders-v2-eda-queue-handler` (the dispatcher behind sales order create) is
`BatchSize` 10, `MaximumBatchingWindowInSeconds` 0, `Timeout` 60 seconds. Its worker
(`staging-orders-v2-create-order`) is also `Timeout` 60. Same shape as the purchase order flow, not
materially different.

Measured: this exact dispatcher has actually hit that timeout before, `Status: timeout` on the
`REPORT` line, 70 of 292 invocations in a 3 hour window on 2025-08-15 (about 24 percent), plus 2 more
on 2025-08-20. Both incidents are over a year before the Cin7 sales order poller existed
(created 2026-08-27), so neither can be a CTC record. Nothing has timed out on this dispatcher since
2026-05-28, which covers BUSY-1159 slice 08's 718 order live run and everything since.

Still open: whether CTC volume specifically would reproduce this. The shape can fail here, it has,
just not yet under conditions involving a CTC record. That is a narrower and better posed question
than the one currently filed.

## Q25. Does the sales order poller check `FailedEntryCount` on its `PutEvents` call?

**Narrowed, and one item needs your read before this is treated as settled.**

Measured: the metric the project doc's method relies on, `PutEventsFailedEntriesCount`, has no
dimensions at all. It cannot be scoped to `staging-orders-v2-event-bus` or any other bus. The
retrospective method as written is not usable for a bus specific answer.

Measured: the account wide sum is zero for the entire retained period except 2025-06-02 through
2025-06-17 (roughly 46,000 failed entries). The Cin7 SO poller and its EventBridge rule were both
created 2026-08-27, fourteen months after that window, so it predates this integration entirely.
Other rule names active in the account at that time look like an unrelated bulk catalog sync.

Measured, for context: `FailedInvocations` on the poller's own schedule rule (a different, per rule
metric, about EventBridge triggering the poller, not about the poller's own `PutEvents` call) shows
one failure, on the rule's creation day, and the rule is currently `DISABLED`.

Still open: whether the June 2025 spike could be connected. I judge it very unlikely for the reasons
above, but the metric's total lack of a bus dimension means it cannot be ruled out with certainty,
only made implausible. This is the item flagged for your read before Q25 moves to Answered.

## Q26. Which Cin7 `taxStatus` values does the poller recognise, and is `Exempt` meant to be one?

**Narrowed.**

Measured, log side: 40 log lines across the poller's whole retained history (its log group started
2026-08-27), all `Unrecognised Cin7 taxStatus "Exempt"`, exactly three distinct orders (`WOR19267`,
`261103`, `261105`), matching what was already on file. No other taxStatus value has ever tripped
this alert.

Measured, population side: extended `survey-cin7-orders.sh` with a `taxStatus` counter (additive,
not yet reviewed) and ran it against the poller's own filters, 1000 orders. `Excl` 598 (59.8%),
`Incl` 390 (39.0%), `Exempt` 12 (1.2%). Only these three values exist in the sample.

Still needs Kian either way: is `Exempt` meant to be mapped, and to what. It now arrives with roughly
1 in 83 orders in this sample carrying it, not three references.

## Q27. Is `faulty-sale-worker-queue-handler` (and its worker) an unguarded consumer that mishandles
CTC records, or one that receives and discards them?

**Narrowed**, toward discard, not toward acted-on. Not closed.

Measured: the dispatcher's worker, `staging-inventory-check-order-faulty-sale`, completes with
`StatusCode 200` and an empty (`null`) response on every observed invocation, CTC and non-CTC alike,
zero errors, sub 1.3 second duration including cold starts. Its only configured decision input,
SSM parameter `staging-faulty-stock-store-map`, maps two store identifiers (`490`, `407`) to one
target and contains neither of CTC's identifiers (branch `51908`/`51909`, warehouse `CTC-QDC`).

Inferred, not proven: if its logic keys off that map, a CTC order matches nothing in it and most
likely no-ops.

Still open, and could not be checked safely or cheaply: whether anything reached
`staging-inventory-v2` (11.7 million items, no index a CTC reference could be looked up by) or
`staging-inventory-bus` for either reference. Confirming that would need either an unreasonable table
scan or another read of a log group already shown to dump unredacted customer records, so it stays
unconfirmed rather than forced.

**Separate from the above, flagged for your call, not a QA verdict on this ticket:** this worker's
own log group dumps the same unredacted record its dispatcher does, customer name, email, shipping
address, at INFO. That is a second log group with this problem beyond the one already on file in
`CTC-customer-data-in-cloudwatch.md`. And CTC has no prior AWS footprint at all: every message this
epic has produced, staging included, is the first CTC data AWS has ever handled, and production has
none yet. So this is not "has it already leaked in prod," it cannot have. It is "this starts on the
first real production order," with nothing to catch it beforehand once the epic ships. Worth weighing
that timing into whatever priority this gets.

## Q29. Does dc-packing resolve `company` from an explicit field or from `brand`, and why does the
value it computes never reach the saved row?

**Narrowed.**

Measured, narrow extraction only: for `261115`'s shipment, the only company/brand fragments logged
are the record's own incoming `company":"CTC`, `brand":"CTC`, `Brand":"THRILLS`, at 23:49:12.552Z.
The SKIP-MARKER guard (`is a CTC record, not for uniWMS`) fires 0.16 seconds later, same invocation,
total execution 260.87 ms.

That is not enough time for the kind of external warehouse round trip that produced the
`"company":"UNIVERSAL"` echo in the Universal Store baseline (BUSY-1158 slice 03, TC7). No such echo
appears here.

So: the skip happens before the external warehouse call. The mid-pipeline `company` value the UNI
pipeline computes is never computed at all for a CTC order, because the CTC order is filtered out by
origin first. This answers the underlying AC8 question by the route anticipated: the explicit field
cannot be what classifies a CTC order, since a CTC order never reaches the code that would set it.

Still open: this is timing evidence, not a source read. The exact code order was inferred, not
confirmed against the implementation.
