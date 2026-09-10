# Slice R0, build identification

**Ticket:** BUSY-1158 and BUSY-1159 re-test
**Cases:** none directly. This slice gates R1 to R6.
**Depends on:** nothing. Read only, no poll, no writes, no order created.
**Estimated:** 20 minutes, not a full session.

Kian deployed BUSY-1160 plus fixes to 1158 and 1159 on or before 2026-09-04. QA has no fix list. This
slice produces one from the deployed infrastructure. Every later session's scope is set by what you
find here, so record what you measured, not what you expected.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
```

If it fails, `aws sso login --profile staging` first. Browser device-code flow, needs a human.

## Gate A, does the present-order path exist

The most consequential read in the slice. BUSY-1160 moves line reconciliation into the orders service
handlers: an update handler, a cancel handler, both version-guarded on the order's stored
last-modified value.

Enumerate the orders service lambdas and look for update, cancel or reconcile handlers.

```bash
aws lambda list-functions --profile staging --region ap-southeast-2 \
  --query 'Functions[].{Name:FunctionName,Modified:LastModified,Sha:CodeSha256,Ver:Version}' --output table
aws lambda list-event-source-mappings --profile staging --region ap-southeast-2
```

For each candidate, `get-function-configuration` for `LastModified`, `CodeSha256`, `Version` and the
**names only** of its environment variables. Do not print environment variable values.

Expect: at least one handler that did not exist on 2026-09-02.

**If absent:** BUSY-1160 is not deployed to staging. Record it, stop the slice, tell JJ. R2 does not
run, and the expectation inversion that R3 is built around does not apply.

This is also BUSY-1160 slice 01 Gate A. Answer it once, here, and let that ticket read this result.

## Gate B, what changed everywhere

The authoritative consumer list is the subscriber table in
`../../BUSY-1158/results/01-wiring-and-guard-shape.md`. Use it rather than re-deriving the wiring, and
say so in the result.

Capture `LastModified`, `CodeSha256` (first 12 chars is enough) and `Version` for at least:

* the sales order poller
* the orders service create, update and cancel handlers
* the shipment sender
* `faulty-sale-worker-queue-handler`
* the dc-packing workers
* the pickslip generator
* the Segment consumer
* the orders reporting stream and the shipping reporting stream
* the two inventory dispatchers (`staging-inventory-v2`, `staging-inventory-bus`)
* `orders-dn-rec-eda-queue-handler`
* the Shopify move-fulfilment listener and the Futura delivery notification listeners

Plus stack level:

```bash
aws cloudformation describe-stacks --profile staging --region ap-southeast-2 \
  --query 'Stacks[].{Name:StackName,Updated:LastUpdatedTime,Status:StackStatus}' --output table
```

Save the read as `scripts/read-deployed-builds.sh`. It loops, it is more than three lines, and R4's
scope decision and every future re-test will want it again.

**Capture:** one row per function: name, `LastModified`, short sha, and a `Changed since 2026-09-02`
column. That table is the deliverable the rest of the plan reads.

## Gate C, environment state

Three reads. Do not correct anything you find, record it.

**Poller schedule.** Expect DISABLED, set 2026-08-28.

```bash
aws scheduler get-schedule --name <sales-order-poller-schedule> --profile staging --region ap-southeast-2
# or, if it is an EventBridge rule rather than a schedule
aws events describe-rule --name <rule> --profile staging --region ap-southeast-2
```

If it is ENABLED, the deploy re-enabled it and live cycles have been running since. Record when.

**Watermark.** Expect `2026-08-28T01:35:45.769Z`.

```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```

`--poller so` every time. The flag defaults to `item` and the wrong flag rewinds the item master
feed. This is a read only. If the value has moved, **do not reset it**, record it and tell JJ.

**DLQ.** Depths on the sales order path, and whether the three known parked references (`261070`,
`261073`, `261089`) are still there. A cleared DLQ means someone drained it, which changes what TC9
and TC15 are re-testing against.

## Gate D, did the CTC split land

Read only. R1 does the behavioural sweep, this gate establishes the structure it will sweep against.

Q27's dev answer is that CTC is being split out a layer up so it never reaches
`faulty-sale-worker-queue-handler`, and that the lambda "cannot execute on a CTC order because the
fields it needs are absent". **Neither half is accepted as evidence here.** Our own investigation
measured every invocation, CTC and non-CTC, returning `StatusCode 200`, `Payload null`, `Errors 0`,
which contradicts "cannot execute". Establish the truth from behaviour, not from the answer.

Determine, from the infrastructure:

* what `faulty-sale-worker-queue-handler` still subscribes to: event types, rule patterns, event
  source mapping filter criteria
* whether a filter or an intermediate lambda has appeared in front of it that excludes CTC
* whether its own code changed (from Gate B)

**Capture the filter pattern verbatim** if one exists, and the rule or mapping it sits on. If CTC is
excluded structurally, name the mechanism. If it is not, say so plainly: the split has not landed and
R1 is testing the old shape.

Also record the two inventory write targets `staging-inventory-v2` and `staging-inventory-bus`, since
the write side was never checked and R1 will need to know what it is looking at.

## Teardown

None. Nothing was changed.

## Write results to

`results/R0-build-identification.md`.

Put the Gate B table in full, not just its conclusion. Every later slice reads it.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* the poller schedule is ENABLED or the watermark has moved. Live cycles have then run against
  fixtures the existing results assume were untouched, and several PASS rows may be stale.
* Gate A finds no update or cancel handler. The re-test premise is wrong and the plan needs re-cutting
  before any session runs.
* nothing in Gate B changed at all. Nothing was deployed to staging and the fixes are on another
  environment.
* a lambda changed that is not in the BUSY-1158 subscriber table. That is a new consumer on these
  event types, which is an AC5 finding on 1158 before any sweep runs.
