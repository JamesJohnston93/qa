# Slice 01, cheap reads

**Cases:** Q2 shape, Q25 metric, Q26 population
**Depends on:** nothing
**Estimated:** one short session. Every step here is a read, and two of the three could close their
question outright.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
```

If it fails, `aws sso login --profile staging` first. Browser device-code flow, needs a human.

## Q2, does the sales order handler batch 10 against 60 seconds

The question as filed compares this handler to the purchase order one, where that shape timed out on
143 of 361 invocations and left headers current over partly written lines. **We never saw that on
sales orders.** We are checking whether the same shape exists here, not whether the same failure did.

Trigger: read the configuration directly.

```bash
aws lambda list-event-source-mappings --profile staging --region ap-southeast-2 \
  --query 'EventSourceMappings[?contains(FunctionArn,`orders-v2-eda-queue-handler`)].[FunctionArn,BatchSize,MaximumBatchingWindowInSeconds,ScalingConfig]'

aws lambda get-function-configuration --profile staging --region ap-southeast-2 \
  --function-name staging-orders-v2-eda-queue-handler \
  --query '[Timeout,MemorySize,ReservedConcurrentExecutions]'
```

Slice 01 of the BUSY-1158 plan established that the real fan-out sits behind
`orders-v2-eda-queue-handler`, and that `create-order` and friends are invoked from inside it rather
than wired independently. So the batch and timeout that matter are the dispatcher's, not the
individual workers'. Check the workers' own timeouts too, since a worker timing out inside a batch is
the same failure wearing a different hat.

Capture: batch size, batching window, dispatcher timeout, worker timeouts.

**Closes if:** the shape is materially different from 10 against 60 seconds. Then the PO failure mode
does not transfer and Q2 is answered without Kian.

**Narrows if:** the shape is the same. Then Q2 becomes "the shape is identical, has it ever failed
here", which is a much better question than the one currently filed. Pull the dispatcher's `Errors`
and `Duration` p99 over the full retained period while you are there, since a timeout leaves a
`Status: timeout` marker (the `REPORT.*Task timed out` pattern returns nothing on this runtime,
carried over from BUSY-1260).

## Q25, has a PutEvents partial failure ever happened

Read `../../../claude/`-side project doc `Plan B, PutEvents partial-failure verification` if you can
reach it; the method below is its Tier B1 transposed to the sales order bus. **Tier B2, forcing it by
pointing the poller at a non-existent bus, is out of scope. Do not do it.**

Trigger:

```bash
# read the real metric name, do not assume it
aws cloudwatch list-metrics --namespace AWS/Events --profile staging --region ap-southeast-2

# then the full retained period for the orders bus
aws cloudwatch get-metric-statistics --namespace AWS/Events \
  --metric-name <the name you actually found> \
  --dimensions Name=EventBusName,Value=staging-orders-v2-event-bus \
  --statistics Sum --period 86400 \
  --start-time <retention start> --end-time <now> \
  --profile staging --region ap-southeast-2
```

Also pull `ThrottledRules` and `FailedInvocations` on the same bus for context.

Capture: the exact metric name used, the sum, and every non-zero datapoint with its timestamp.

**Closes if:** the sum is zero across the full retained period. Then the risk is latent and never
realised, and Q25 becomes a note to dev ("please add a `FailedEntryCount` check and log the
response") rather than a question.

**Escalates if:** any datapoint is non-zero. Correlate its timestamp against the poller cycle covering
it and check whether that cycle logged the watermark advancing. That combination demonstrates the
defect from existing data with no test at all, and it is a stop-and-tell-JJ moment, not a finding to
write up quietly.

If time allows, the second half of B1: compare the poller's emitted count per cycle against what the
downstream consumer logged receiving for the same window. A shortfall in a cycle where the watermark
still advanced is the same defect caught retrospectively. Skip it if the metric is flat and the
session is running long, and say you skipped it.

## Q26, how common is taxStatus Exempt

Three orders are known: `WOR19267`, `261103`, `261105`, from the BUSY-1159 slice 08 backfill on
2026-08-28. **The number that decides whether Kian cares is not three, it is what share of the
population this is.** Get both halves.

**Log half**, every occurrence and its timestamp:

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/staging-orders-cin7-so-poller \
  --filter-pattern '"taxStatus"' --profile staging --region ap-southeast-2 \
  --start-time <epoch-ms for the earliest retained> --end-time <now>
```

Capture: every distinct order reference, every distinct `taxStatus` value the poller has complained
about (it may not only be `Exempt`), the first and last timestamps, and the total count.

**Cin7 half**, the population. `survey-cin7-orders.sh` in the shared toolset already pages the sales
order endpoint; check whether it exposes `taxStatus` before writing anything new. If it does not,
extend it rather than writing a second surveyor, the way BUSY-1158 slice 02 extended the guard script.

Count, across a decent window of real orders on the poller's own filters (`isApproved`,
`branchId IN (51908, 51909)`): how many distinct `taxStatus` values exist, and how many orders carry
each. GET only.

Capture: the value distribution as a table. If `Exempt` is one order in a thousand it is a curiosity;
if it is one in twenty, every one of those is permanently stuck at that gate with no auto retry, and
that is a different conversation.

**Closes if:** nothing. Q26 needs Kian either way, because only he knows whether `Exempt` is meant to
be mapped. But it arrives with a number attached instead of three references.

## Write results to

`results/01-cheap-reads.md`. For each question, state Closed, Narrowed or Unchanged explicitly.

## Stop and ask JJ if

* the failed-entries metric has any non-zero datapoint
* `survey-cin7-orders.sh` would need more than a page or two of extra Cin7 calls to answer the
  population question, since the daily cap is shared across three pollers
