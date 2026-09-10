# Result: Slice R0, build identification

**Ticket:** BUSY-1158 and BUSY-1159 re-test
**Verdict:** BUSY-1160 plus fixes to 1158/1159 confirmed deployed to staging (Gate A, Gate B). Poller
schedule and watermark unchanged (Gate C). One DLQ finding needs flagging (Gate C). The CTC split
named in Q27's dev answer has NOT landed (Gate D) - `faulty-sale-worker-queue-handler`'s rule is
unchanged and still unconditional. This gates R1-R6: R2's premise (split landed) does not hold, R1's
sweep is against the old shape for that consumer specifically.

## Preconditions

MEASURED. `aws sts get-caller-identity --profile staging` returned the staging account
(398353400186), SSO session alive, no login needed this session.

## Gate A, does the present-order path exist

MEASURED. Present. Found, all absent from the BUSY-1158 subscriber table
(`../../BUSY-1158/results/01-wiring-and-guard-shape.md`) and all last-modified 2026-09-03 (after the
2026-09-02 baseline):

* `staging-orders-v2-create-transaction`, `staging-orders-v2-update-transaction` - both env-var-named
  `ORDERS_TABLE_NAME`, `EVENT_BUS_NAME`, `STAGE` (names only, per the no-values rule). Not found on
  any Lambda event source mapping, not found as a rule target on either bus. Same "invoked from
  inside a queue handler's own code" shape the prior slice named as a fifth, infrastructure-invisible
  path.
* `staging-orders-cin7-cancel-order`, plus its own dispatcher pair
  `staging-orders-cin7-cancel-order-eda-queue-handler` / `-eda-queue-populator`. The handler IS on an
  event source mapping (`arn:...:sqs:...:staging-orders-cin7-cancel-order-queue.fifo`, Enabled), fed
  by an EventBridge rule on `staging-orders-v2-event-bus`
  (`staging-orders-cin7-stagingorderscin7cancelordereda-HUt0zThIKlU6`, ENABLED, pattern
  `{"detail-type":["TRANS_CANCEL_ORDER"]}`, no origin or company filter).

**Not present:** no function matching a version-guard check was read (code was not opened, per the
no-code-read discipline of this gate; the guard is inferred only from the fact that both new
transaction-side handlers share `ORDERS_TABLE_NAME` env var access, consistent with reading and
writing the order's stored last-modified value, not confirmed as version-guarded logic).

BUSY-1160 slice 01 Gate A: this result answers it, same finding, do not re-run there.

## Gate B, what changed everywhere

Method: `../../BUSY-1158/results/01-wiring-and-guard-shape.md` subscriber table used as the authoritative
consumer list, not re-derived. Read via `scripts/read-deployed-builds.sh --stage staging --profile
staging`, saved this session (see Scripts written). Function names for "shipment sender" (Manhattan
send leg), poller and cancel-order family were located first via `list-functions` plus
`list-event-source-mappings`/`describe-rule`, since the slice names them by role rather than by exact
name.

| Function | LastModified | Sha (12) | Version | Changed since 2026-09-02 |
|---|---|---|---|---|
| `staging-orders-cin7-so-poller` | 2026-09-03T01:10:45.000+0000 | `YTJ0QGQMRY1C` | $LATEST | yes |
| `staging-orders-v2-create-order` | 2026-09-03T01:09:58.000+0000 | `C07olsEagJvI` | $LATEST | yes |
| `staging-orders-v2-create-transaction` | 2026-09-03T01:10:04.000+0000 | `KFeolrR7WYnC` | $LATEST | yes |
| `staging-orders-v2-update-transaction` | 2026-09-03T01:09:55.000+0000 | `JMDrWcDudH1Z` | $LATEST | yes |
| `staging-orders-cin7-cancel-order` | 2026-09-03T01:11:21.919+0000 | `y+xidVQ0v4mC` | $LATEST | yes |
| `staging-orders-cin7-cancel-order-eda-queue-handler` | 2026-09-03T01:13:09.077+0000 | `IkMdwLSb76IM` | $LATEST | yes |
| `staging-orders-cin7-cancel-order-eda-queue-populator` | 2026-09-03T01:13:08.978+0000 | `YIJNXmTj+DBO` | $LATEST | yes |
| `staging-shipping-manhattan-send-shipment` | 2026-09-03T01:27:07.000+0000 | `5JjXEaxhFdYz` | $LATEST | yes |
| `faulty-sale-worker-queue-handler` | 2026-03-04T10:13:10.000+0000 | `NLdvtpNBwr83` | $LATEST | **no** |
| `staging-shipping-v2-dc-packing-eda-queue-handler` | 2025-12-11T05:33:23.000+0000 | `NLdvtpNBwr83` | $LATEST | **no** |
| `staging-shipping-v2-dc-packing-shipment-create` | 2026-09-03T01:24:22.000+0000 | `2RRywtPr8KP8` | $LATEST | yes |
| `staging-shipping-v2-dc-packing-shipment-delete` | 2026-09-03T01:24:22.000+0000 | `I6v9X9GnpYe3` | $LATEST | yes |
| `staging-shipping-v2-dc-packing-shipment-hold-update` | 2026-09-03T01:24:22.000+0000 | `Glp3i5jeZz1S` | $LATEST | yes |
| `staging-shipping-v2-dc-packing-shipment-address-update` | 2026-09-03T01:24:23.000+0000 | `7CfMjOpeWqIU` | $LATEST | yes |
| `staging-shipping-v2-generate-pickslip` | 2026-09-03T01:24:32.000+0000 | `Fxzw+2oXTq/g` | $LATEST | yes |
| `staging-orders-v2-segment-eda-queue-handler` | 2025-10-02T06:41:48.000+0000 | `IkMdwLSb76IM` | $LATEST | **no** |
| `staging-orders-v2-order-reporting-stream` | 2026-08-27T01:29:18.000+0000 | `sDUIhtAasAbz` | $LATEST | **no** |
| `staging-shipping-v2-shipment-reporting-stream` | 2026-09-03T01:24:32.000+0000 | `a0V5FXEJEFRz` | $LATEST | yes |
| `staging-inventory-core-shipment-inventory-eda-queue-handler` | 2026-01-18T22:25:50.000+0000 | `NLdvtpNBwr83` | $LATEST | **no** |
| `ShipmentItemRejectedEventWorker-queue-handler` | 2026-05-25T04:55:57.103+0000 | `NLdvtpNBwr83` | $LATEST | **no** |
| `staging-orders-dn-rec-eda-queue-handler` | 2025-12-30T23:56:36.000+0000 | `IkMdwLSb76IM` | $LATEST | **no** |
| `staging-shipping-v2-shopify-move-fulfilment-orders` | 2026-09-03T01:24:22.000+0000 | `0Z+MfD+FNE02` | $LATEST | yes |
| `staging-orders-v2-orders-futura-eda-queue-handler` | 2025-11-28T01:36:03.000+0000 | `IkMdwLSb76IM` | $LATEST | **no** |
| `staging-shipping-v2-shipment-futura-eda-queue-handler` | 2026-07-22T22:20:45.000+0000 | `NLdvtpNBwr83` | $LATEST | **no** |

Stack level (`aws cloudformation describe-stacks`), filtered to stacks in this integration's
footprint. `staging-orders-v2`, `staging-shipping-v2`, `staging-orders-cin7`,
`staging-shipping-manhattan`, `staging-orders-dn-rec` and `staging-shipping-dn-rec` all
`UPDATE_COMPLETE` at 2026-09-03T01:09 through 01:31. `staging-inventory-core` and
`staging-inventory-faulty-sale` last updated 2026-07-30 and 2026-07-29 respectively, both before the
baseline, consistent with the per-function rows above showing no change on either inventory dispatcher
or the faulty-sale handler.

**Reading the table.** Six named targets show no change since 2026-09-02:
`faulty-sale-worker-queue-handler`, `staging-shipping-v2-dc-packing-eda-queue-handler` (the top-level
dispatcher, though its four downstream workers did change), `staging-orders-v2-segment-eda-queue-handler`,
`staging-orders-v2-order-reporting-stream`, the two inventory dispatchers, `staging-orders-dn-rec-eda-queue-handler`
and `staging-orders-v2-orders-futura-eda-queue-handler`. Everything else in the table changed. Not
"nothing changed" (stop condition does not trigger), and no function in the table is missing from the
BUSY-1158 subscriber table's coverage in a way that reads as a surprise new consumer: the
newly-appeared names (`create-transaction`, `update-transaction`, `cancel-order` family) are exactly
what Gate A went looking for, not an unrelated addition.

## Gate C, environment state

**Poller schedule.** MEASURED DISABLED. `aws events describe-rule --name staging-orders-cin7-so-poller-rule`:
`State: DISABLED`, `ScheduleExpression: rate(2 minutes)`. Matches expectation, unchanged from
2026-08-28.

**Watermark.** MEASURED unchanged. `cin7-watermark.sh --stage staging --profile staging --poller so`
returned `2026-08-28T01:35:45.769Z`, `/staging/orders/cin7-so-watermark`. Matches expectation exactly.

**DLQ.** Two separate DLQs matter here and this slice checked both.

* `staging-shipping-manhattan-sender-dlq.fifo` (stage 5, the send-to-SCALE leg where the three known
  references were parked): MEASURED 0 waiting, 0 in-flight, via `check-ctc-status.sh --stage staging
  --profile staging`. **The three known parked references (`261070`, `261073`, `261089`) are NOT
  confirmed still there because the queue is empty.** This DLQ held all three as of the last BUSY-1159
  session record (`STATE.md`: "Found conditions in the DLQ have grown since slice 02: now `261070`,
  `261073`, `261089` (3, stage-5 DLQ count unchanged at 3..."). It is now 0. **Someone drained it.**
  Per this slice's own instruction, not corrected, only recorded: whatever TC9 and TC15 read as PASS
  evidence in `../../BUSY-1159/results/07-failure-handling.md` was captured before this drain and is not
  re-verified by this slice. A fresh rejection would need to be found or manufactured before either
  case is re-run against current state.
* `staging-orders-v2-dlq.fifo` (stage 2, order-creation DLQ, unrelated to the three known refs):
  MEASURED 2 waiting. Peeked (10-second visibility timeout, not deleted, both messages left to return
  to the queue) to check whether either is CTC: both carry `origin: US#SHOPIFY_ECOM#...` (`category
  CHARGE`, `event CREATE_ORDER`, `detailType CREATE_TRANSACTION`), neither is a CIN7_SO record. Not a
  CTC-relevant finding, noted only because `check-ctc-status.sh` surfaces it as "2 thing(s) above need
  attention." No customer field (orderId, idempotencyId, shopifyExternalOrderId only) was printed;
  `customerId`, `customerEmail`, `itemChanges`, `addressChanges`, `paymentChanges` were present on both
  messages and never printed.
* All other DLQs on the sales-order path (`staging-orders-cin7-cancel-order-dlq.fifo`,
  `staging-orders-cin7-inbound-orders-dlq.fifo`, `staging-orders-cin7-so-poller-schedule-dlq`,
  `staging-orders-cin7-update-order-dlq.fifo`) MEASURED at 0.

**Alarm status**, from the same `check-ctc-status.sh` run: `staging-orders-cin7-so-poller-stalled` is
in `ALARM`, consistent with the poller being disabled (expected, not a new condition, the script's own
reading notes this alarm is poller-only). The other three poller alarms are `OK`.

## Gate D, did the CTC split land

MEASURED. **The split has not landed.** `faulty-sale-worker-queue-handler` is unchanged since
2026-03-04 (Gate B), still subscribes to the same rule
(`staging-inventory-faulty--faultysaleworkerfaultysal-O9HvnJv0c14A`, on `staging-orders-v2-event-bus`,
`State: ENABLED`), same verbatim pattern `{"detail-type":["TRANS_CREATE_ORDER"]}`, **no origin or
company filter**, same single target (`faulty-sale-worker-queue-populator`), same event source mapping
(`faulty-sale-worker-queue.fifo`, Enabled). No intermediate lambda sits between the rule and the
populator. Its own code did not change (Gate B). Q27's dev answer (CTC split out a layer up, the
lambda "cannot execute on a CTC order") does not hold against this infrastructure: nothing here would
stop a CTC `TRANS_CREATE_ORDER` event reaching this consumer exactly as it did in the prior slice's
measurement. R1 testing this consumer is testing the pre-1160 shape; treat any PASS or FAIL there as
against the unchanged system, not the fix Q27 describes.

**Inventory write targets**, not previously checked: `staging-inventory-v2` (DynamoDB table,
`ACTIVE`, stream enabled, 11,748,645 items) and `staging-inventory-bus` (EventBridge bus,
`arn:aws:events:ap-southeast-2:398353400186:event-bus/staging-inventory-bus`). Both exist. Neither's
content or recent write activity was read, existence and shape only.

## Fails if conditions

None of this slice's own stop conditions triggered:

* poller schedule DISABLED, watermark unchanged - no
* Gate A found both an update-side handler pair and a cancel-side handler pair - no
* Gate B: most named targets changed, six did not - "nothing changed at all" does not apply - no
* no lambda changed that reads as a new, unexplained consumer outside what Gate A/B already account
  for - no

**Worth flagging to JJ regardless, not a hard stop:** the stage-5 Manhattan-sender DLQ (three known
parked references) has been drained since the last BUSY-1159 session. This is closer to the slice's
own "stop and ask" spirit for DLQ state even though it is not one of the four listed conditions
verbatim, since it changes what evidence TC9/TC15 can be checked against going forward. Recorded, not
corrected.

## Scripts written

* `scripts/read-deployed-builds.sh`, Gate B. Loops the fixed set of order/shipment consumer lambdas,
  prints `LastModified`, first 12 chars of `CodeSha256`, `Version`, and a changed-since-baseline flag.
  Read only. **Not reviewed.**

## Open questions raised

None new. Gate D's finding narrows Q27 (does `faulty-sale-worker-queue-handler` need a CTC stance):
it confirms the wiring Q27 was already raised against is still current, does not answer Q27 itself.

## Teardown

None. Nothing was changed. The two DLQ peeks used `--visibility-timeout 30` / default receive without
delete; both sets of messages return to visible state on their own, nothing was removed from either
queue.
