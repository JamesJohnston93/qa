# Slice 01, wiring and guard shape

**Ticket:** BUSY-1158
**Cases:** TC4c, TC6b
**Depends on:** nothing. No live order, no poll, no writes.
**Estimated:** one session

This slice answers the question the whole ticket rests on: who actually subscribes to these events.
The LLD audit table is known to be wrong. Dev traced four subscribers it does not list (the Shopify
and Futura delivery notification listeners, the inventory service and the orders service) and found
two of the five it does name already covered or unreachable. Nobody has updated it. Everything slice
02 sweeps comes from what you produce here.

## Preconditions

```bash
aws sts get-caller-identity --profile staging          # SSO session alive, staging account
aws events list-event-buses --profile staging --region ap-southeast-2 \
  --query 'EventBuses[?contains(Name,`orders-v2`)||contains(Name,`shipping-v2`)].Name'
```

Both buses must come back. If the SSO call fails, `aws sso login --profile staging` first, it needs a
human in a browser.

## Setup

None. This slice is read only and touches no order.

## Cases

### TC4c, re-sweep the audit against the real event wiring

Trigger: enumerate every subscriber on the order and native shipment event types, from the
infrastructure rather than from the LLD table. Cover all four paths, because subscribers hide in
different places:

```bash
# EventBridge rules and their targets, both buses
aws events list-rules --event-bus-name staging-orders-v2-event-bus --profile staging --region ap-southeast-2
aws events list-targets-by-rule --rule <rule> --event-bus-name staging-orders-v2-event-bus --profile staging --region ap-southeast-2
# repeat for staging-shipping-v2-event-bus

# lambdas driven by a queue or a stream rather than a rule
aws lambda list-event-source-mappings --profile staging --region ap-southeast-2

# table streams, which is how the reporting consumers are wired
aws dynamodb describe-table --table-name staging-orders-v2 --profile staging --region ap-southeast-2 \
  --query 'Table.LatestStreamArn'
aws dynamodb describe-table --table-name staging-shipments --profile staging --region ap-southeast-2 \
  --query 'Table.LatestStreamArn'

# SNS fan-out, if any rule targets a topic
aws sns list-subscriptions-by-topic --topic-arn <arn> --profile staging --region ap-southeast-2
```

Save this as `scripts/read-event-wiring.sh`. It is more than three lines, it loops, and slice 02 and
any future cleanup run will want it again.

Expect: a subscriber list that is a superset of the LLD audit table. The four dev named should appear.
The inventory service is the one that matters most, because it has no row in the table at all and dev
called it a silent correctness risk with no owner.

Capture: one row per subscriber, with the event type or stream it reads, whether the LLD audit table
lists it, and whether `check-ctc-consumer-guards.sh` currently checks it. Three columns, and the
difference between column two and column three is the finding.

Fails if: a subscriber exists on these event types that is in neither the audit table nor the sweep
script. That is not a defect in itself, it is an unguarded consumer, which is exactly what AC5 claims
does not exist. Record it as a FAIL against AC5 and name the consumer.

Inconclusive if: a target resolves to something you cannot identify from its ARN. Say so rather than
guessing, and list it as unresolved.

### TC6b, how the reporting guard records a skip

Trigger: read the reporting stream log groups over a window that already contains CTC traffic. The
references used under BUSY-1159 are in `../BUSY-1159/fixtures.md`; `261115` and `WOR19261` both have
known create times.

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/staging-orders-v2-order-reporting-stream \
  --filter-pattern '"CTC"' --profile staging --region ap-southeast-2 \
  --start-time <epoch-ms> --end-time <epoch-ms>
```

Expect: the skip is a debug level line and nothing else moves. The ticket is specific that the guard
sits before row classification so that a skip is a debug log rather than an error branch.

Capture: the literal guard line and its level, from both the orders and the shipping reporting stream.
Then the lambda's `Errors` metric over the same window, which should be flat.

Fails if: the skip is logged at error or warn level, or the `Errors` metric moves on a CTC record.
Either means CTC rows are taking an error path in a pipeline that runs on every order, which will bury
real reporting failures once volume arrives.

## Teardown

None. Nothing was changed.

## Write results to

`results/01-wiring-and-guard-shape.md`.

The subscriber table from TC4c is the deliverable other slices read, so put it in the result file in
full, not just its conclusion.

## Stop and ask JJ if

* the wiring read turns up more than two unguarded subscribers, which would make slice 02 much bigger
  than one sitting
* a target cannot be identified at all
* the inventory service turns out to be actively consuming these events, since that is a live
  correctness risk on someone else's service and JJ will want it raised before more testing
