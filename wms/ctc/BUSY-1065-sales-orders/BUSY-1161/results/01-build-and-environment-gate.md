# Result: Slice 01, build and environment gate

**Ticket:** BUSY-1161
**Verdict:** All four gates pass. No stop condition hit. Proceed to slice 02.

Read only throughout. No watermark write, no schedule change, no Cin7 call beyond one GET, no
injection. Findings below came from `lambda:get-function-configuration`, `sqs:get-queue-url` /
`get-queue-attributes`, `lambda:list-event-source-mappings` (by `--event-source-arn`, never by
function name), `events:describe-rule`, `ssm:get-parameter`, `../../tools/cin7-sales-orders/check-ctc-status.sh`,
`find-cin7-sales-order.sh --limit 1`, and a direct read of both fixture directories.

## Gate A, do the six outbound components exist, and when did they deploy

All seven exist (MEASURED, `get-function-configuration` on each).

| FunctionName | LastModified | CodeSha256 | Version |
|---|---|---|---|
| `staging-orders-cin7-so-poller` | 2026-09-09T01:20:09.000+0000 | `iI9VFACg8rAo6QvIG49S/aoiIeDWLLesHeFedTbA6zo=` | $LATEST |
| `staging-orders-cin7-create-outbound-order` | 2026-09-09T01:20:46.671+0000 | `KyjOTFFHhkI6XU0pw3RnhTlBiEk2+TmqrLuJw/sMvkM=` | $LATEST |
| `staging-orders-cin7-update-outbound-order` | 2026-09-09T01:20:45.911+0000 | `s4dIOlY7CfSLOMUzCJLQ2QbTg78a+mgx3GdrCR25+tI=` | $LATEST |
| `staging-orders-cin7-cancel-outbound-order` | 2026-09-09T01:20:45.615+0000 | `VdNMtYDFvEZoz2AxaX7v4KVWWt74gH925y/yXdIIGBc=` | $LATEST |
| `staging-shipping-inbound-outbound-order-bridge` | 2026-09-09T01:35:09.554+0000 | `USL0voG9gbgMaTdYkB/K4Ycx3cl2O2zSJtc6GQ1/z/o=` | $LATEST |
| `staging-shipping-inbound-materialise-outbound-shipment` | 2026-09-09T01:35:09.328+0000 | `Sqr7Xt7RQOHnloSi1kHIGS0kkeA6Oua7K8j2lJJjDGA=` | $LATEST |
| `staging-shipping-manhattan-send-outbound-shipment` | 2026-09-09T01:39:12.476+0000 | `MxhokKVLW1TfCETWsqscUbNS8LtDLGjQggInzaE8aSs=` | $LATEST |

All seven carry a 2026-09-09 deploy timestamp, poller included, and land in one narrow window
(01:20:09 to 01:39:12). MEASURED: the deploy is not partial with respect to this ticket. No
stop condition (a missing function) was hit.

## Gate B, does the chain match what was traced before

Read all three outbound queues named in `QA-DOC.md`'s Services table plus each one's DLQ, and
listed the event source mapping on each by `--event-source-arn` (MEASURED).

| Queue | Visible/InFlight | Mapping state | Consuming function |
|---|---|---|---|
| `staging-orders-cin7-outbound-orders-queue.fifo` | 0/0 | Enabled, one mapping | `staging-orders-cin7-outbound-orders-eda-queue-handler` |
| `staging-orders-cin7-outbound-orders-dlq.fifo` | 0/0 | none | n/a (DLQ, no consumer) |
| `staging-shipping-inbound-outbound-bridge.fifo` | 0/0 | Enabled, one mapping | `staging-shipping-inbound-outbound-bridge-eda-queue-handler` |
| `staging-shipping-inbound-outbound-bridge-dlq.fifo` | 0/0 | none | n/a (DLQ, no consumer) |
| `staging-shipping-inbound-outbound.fifo` | 0/0 | Enabled, one mapping | `staging-shipping-inbound-outbound-eda-queue-handler` |
| `staging-shipping-inbound-outbound-dlq.fifo` | 0/0 | none | n/a (DLQ, no consumer) |

Each live queue has exactly one enabled mapping, no DLQ has a mapping of its own (expected; a DLQ
is a destination, not a source here), and all three queues sit at 0/0. So the earlier "was
`QASYN-12-TC2` cycling toward the sender DLQ present in this snapshot" caveat does not apply to
these three queues; it lands on `staging-shipping-manhattan-sender-dlq.fifo`, a different queue,
covered below under Gate D.

**This corrects the Services table.** Each queue's direct consumer is a separate
`*-eda-queue-handler` function, not the function the Services table names as the "handler" for
that stage:

- `staging-orders-cin7-outbound-orders-eda-queue-handler` consumes the outbound order queue, not
  `staging-orders-cin7-{create,update,cancel}-outbound-order` directly.
- `staging-shipping-inbound-outbound-bridge-eda-queue-handler` consumes the bridge queue, not
  `staging-shipping-inbound-outbound-order-bridge` directly.
- `staging-shipping-inbound-outbound-eda-queue-handler` consumes the materialiser queue, not
  `staging-shipping-inbound-materialise-outbound-shipment` directly.

All three `-eda-queue-handler` functions exist and carry the same 2026-09-09 deploy window
(MEASURED, `get-function-configuration`: 01:22:33, 01:36:56, 01:36:56 respectively). This is the
same two-stage pattern BUSY-1160's Gate A already found on the native side (a shared or per-queue
`-eda-queue-handler` sitting in front of the named business handler), not a new mechanism, so
INFERRED that the eda-queue-handler dispatches to the Gate A function by direct invocation rather
than a second SQS hop, consistent with there being no fourth queue for it. Not confirmed by a code
read in this slice. Worth fixing in the Services table so a later session does not go looking for
activity on the wrong function name; not a defect.

No stop condition (missing enabled mapping, or a consumer belonging to neither the named function
nor a documented wrapper) was hit.

## Gate C, access and the toolset

1. **Toolset's own Cin7 credentials.** `.env` already present at `../../tools/.env` (present since
   2026-07-28, predates this session). Confirmed live with a read-only call:
   `find-cin7-sales-order.sh --limit 1` returned SO #262539 (APPROVED, branch 51909, 2 line items).
   MEASURED: **yes**, working.
2. **SCALE staging login.** Confirmed directly with JJ in this session: **yes**, JJ can open the
   SCALE staging site and search Shipments today. MEASURED (JJ's own confirmation, not assumed).
   This is the one blocker that can stop the pass, and it is clear.
3. **Fixture set intact.** 19 wholesale scenarios, 2 RTV, both directories read directly.
   MEASURED: every fixture's own `modifiedDate` field ascends, wholesale
   `2026-08-27T04:08:59Z` through `2026-08-27T05:26:59Z` across all 19 files in filename order,
   RTV `2026-09-07T00:00:00Z` then `2026-09-08T00:00:00Z`. The file-system mtimes on the
   wholesale set are not ascending (most carry a `Sep 9 11:41` regeneration timestamp with
   `01-baseline.json` left at `Aug 28`), but that is irrelevant: the tool drives fixtures off
   the JSON payload's own `modifiedDate` field, not the file's mtime, and that field is what
   slice 06's stale/out-of-order cases depend on.

No stop condition (no SCALE login) was hit.

## Gate D, environment state

MEASURED directly (`events:describe-rule`, `ssm:get-parameter`), cross-checked against
`check-ctc-status.sh`'s own view, both agreeing:

| Item | Value |
|---|---|
| Schedule rule `staging-orders-cin7-so-poller-rule` | DISABLED, `rate(2 minutes)` when enabled |
| Watermark `/staging/orders/cin7-so-watermark` | literal string `UNSET`, last modified 2026-09-07T16:42:46+10:00 |
| `staging-orders-cin7-so-poller-stalled` alarm | ALARM (the known one, expected) |
| every other listed alarm | OK |

Ten other alarms read OK: `so-poller-errors`, `so-poller-page-cap-hit`, `so-poller-alert`,
`update-order-errors`, `cancel-order-errors`, `sales-order-cancel-withheld`,
`create-outbound-order-errors`, `update-outbound-order-errors`, `cancel-outbound-order-errors`,
`outbound-order-cancel-withheld`.

DLQ depths from `check-ctc-status.sh` (MEASURED, read only, not otherwise driven this slice):
`staging-orders-v2-dlq.fifo` 4 dead-lettered (shared ECOM queue, other UNI traffic, not this
ticket's), `staging-shipping-manhattan-sender-dlq.fifo` 8 dead-lettered (CTC-only, shared with the
outbound sender). Consistent with STATE.md's carried note that `QASYN-12-TC2` cycles toward this
DLQ on a 25 minute loop; its presence in this snapshot is expected and not a new finding. Not
further investigated, since Gate D asks only that the state be recorded, not diagnosed.

Matches expectation exactly: schedule DISABLED, watermark UNSET, no cycle since 2026-09-07. No
stop condition was hit.

## Teardown

Nothing was changed this slice; every action taken was a read (`get-function-configuration`,
`get-queue-attributes`, `list-event-source-mappings`, `describe-rule`, `get-parameter`,
`find-cin7-sales-order.sh --limit 1`, `check-ctc-status.sh`, and two local file reads). The direct
`describe-rule` and `get-parameter` calls above are themselves the confirming re-read Gate D's
teardown step asks for: schedule DISABLED and watermark UNSET, unchanged from what
`check-ctc-status.sh` reported earlier in the same session.

## Reads as

**All four gates pass. Proceed to slice 02.**

* Gate A: all seven components present, one deploy window (2026-09-09).
* Gate B: routing intact, one enabled mapping per queue, but the direct consumer on each queue is
  a `-eda-queue-handler` wrapper rather than the function the Services table names. Correction,
  not a defect.
* Gate C: Cin7 read access confirmed live, SCALE staging login confirmed by JJ, fixture set
  intact and ascending on its own `modifiedDate` field.
* Gate D: schedule DISABLED, watermark UNSET, only the known `so-poller-stalled` alarm firing.

## New open questions

None raised for the epic register. The queue-consumer correction in Gate B is a correction to
this plan's own Services table (see `QA-DOC.md`), not a question for dev.

## Scripts written

Two, both in `scripts/`, both ticket specific, both **unreviewed**. Rows added to `SCRIPTS.md`.

* `check-outbound-chain-deploy.sh`, Gate A. Extends BUSY-1160's
  `check-cin7-order-handler-deploy.sh` model for the seven outbound-chain functions; captures
  `LastModified`, `CodeSha256` and `Version` rather than comparing against an expected date, since
  this ticket has no prior deploy date to check against.
* `check-outbound-queue-mappings.sh`, Gate B. For each of the three outbound queues and its DLQ,
  reads depth, redrive policy and every event source mapping by `--event-source-arn`. Re-run once
  after being written with identical output.

A passing run from either proves the script ran and printed what AWS returned, not that the
system under test is correct. Neither has a second reviewer yet.
