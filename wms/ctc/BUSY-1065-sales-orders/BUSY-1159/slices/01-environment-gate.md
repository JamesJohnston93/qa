# Slice 01, environment gate

**Ticket:** BUSY-1159
**Cases:** TC20, plus the access baseline every later slice reads
**Depends on:** nothing
**Estimated:** one short session

## Preconditions

None. This slice exists to establish them. Confirm the AWS CLI is installed and a staging profile is configured before starting, since nothing else here works without it.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
aws sts get-caller-identity --profile "$AWS_PROFILE"
```

## Cases

### Gate A, credentials and feed state
Trigger:
```bash
aws secretsmanager describe-secret --secret-id staging/orders/cin7 --profile "$AWS_PROFILE" --region ap-southeast-2
aws secretsmanager get-secret-value --secret-id staging/orders/cin7 --profile "$AWS_PROFILE" --region ap-southeast-2 --query 'length(SecretString)'
aws secretsmanager describe-secret --secret-id staging/manhattan/oauth2 --profile "$AWS_PROFILE" --region ap-southeast-2
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```
Expect: both secrets exist and the Cin7 one is populated rather than empty. The watermark reads either `UNSET` or a real ISO 8601 UTC timestamp.
Capture: the watermark value verbatim, into `fixtures.md`. Do not change it in this slice.
Fails if: either secret is absent or empty. That is a blocker for Kian, not a defect.

### Gate B, pipeline status
Trigger:
```bash
./check-ctc-status.sh --stage staging --profile "$AWS_PROFILE"
```
Expect: queue depths and dead letter depths at zero, the poller schedule state reported, the alarms listed.
Capture: schedule enabled or disabled, every dead letter depth. A non zero dead letter depth at the start is pre existing and must be recorded before any test runs, or a later failure will be misattributed.

### Gate C, Cin7 tooling reachable
Trigger:
```bash
./find-cin7-sales-order.sh --group 'Retail - Ecomm' --max-pages 1
```
Expect: a list of recent CTC ecommerce orders with contact groups resolved.
Capture: nothing yet, this only proves the `.env` credentials work.
Fails if: the script errors on credentials. Blocker for Kian.

### TC20, alarms and alert routing
Trigger:
```bash
aws cloudwatch describe-alarms --profile "$AWS_PROFILE" --region ap-southeast-2 \
  --alarm-names staging-orders-cin7-so-poller-errors staging-orders-cin7-so-poller-stalled \
                staging-orders-cin7-so-poller-page-cap-hit staging-orders-cin7-so-poller-alert \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Actions:AlarmActions}'

for T in staging-orders-cin7-alerts staging-shipping-manhattan-alert-topic; do
  ARN=$(aws sns list-topics --profile "$AWS_PROFILE" --region ap-southeast-2 \
        --query "Topics[?contains(TopicArn, '$T')].TopicArn" --output text)
  echo "$T -> $ARN"
  aws sns list-subscriptions-by-topic --topic-arn "$ARN" --profile "$AWS_PROFILE" --region ap-southeast-2 \
    --query 'length(Subscriptions)'
done
```
Expect: four alarms present. Subscriber counts recorded as observation. Zero subscribers is the expected state and belongs to BUSY-1162.
Capture: alarm names, states and subscriber counts, into the result file and `fixtures.md`.
Fails if: an alarm named in the handover does not exist. Record it, do not treat a zero subscriber count as a FAIL.

### Gate D, historic stage evidence (answers Q1 cheaply)
Trigger: if the feed has ever run in staging, its own log history already says whether picked orders are being skipped. One query, no polling, no API budget.
```bash
aws logs filter-log-events --log-group-name /aws/lambda/staging-orders-cin7-so-poller \
  --profile "$AWS_PROFILE" --region ap-southeast-2 \
  --start-time $(( ( $(date +%s) - 14*86400 ) * 1000 )) \
  --filter-pattern '{ $.metric = "Cin7SOPollerCycleComplete" }' \
  --query 'events[].message' --output text | grep -o 'skippedStages[^}]*}' | sort | uniq -c
```
Expect: the distinct `skippedStages` values seen over the last two weeks.
Capture: whether `Fully Picked` or `Partially Picked` appear as skipped stages, and how often.
Why it matters: the LLD puts both stages **inside** the eligible set on purpose. If they show up as skipped, that is very likely a defect, and TC14 in slice 04 becomes a confirmation rather than an investigation. See Q1 in the open questions register for the consequence.
Blocked if: the feed has never run and the log group is empty. Say so, TC14 then has to establish it by polling.

### Gate E, real resource names
Trigger: the plan and the QA doc name only two lambdas, both from the dev handover and neither verified. The trickle down workers, the reallocation worker and the transaction handlers are referenced by role with no resource name, and TC2 and TC12 both need those log group names.

Free, no AWS call:
```bash
grep -o '/aws/lambda/[a-z0-9-]*' ../../tools/cin7-sales-orders/check-ctc-consumer-guards.sh | sort -u
```
Then confirm against the account:
```bash
aws lambda list-functions --profile "$AWS_PROFILE" --region ap-southeast-2 \
  --query 'Functions[?contains(FunctionName,`cin7`) || contains(FunctionName,`manhattan`) || contains(FunctionName,`shipment`)].FunctionName' \
  --output text | tr '\t' '\n' | sort
```
Expect: the two named lambdas exist, plus the consumer and trickle down workers the handover never named. The BUSY-1260 purchase order handlers live in the same stack, so expect `create-inbound-order`, `update-inbound-order` and `cancel-inbound-order` alongside them. Do not confuse those with the sales order path.
Capture: the full list into `fixtures.md`, flagged as MEASURED. Note any lambda the handover named that does not exist, and any consumer the guard script checks that the LLD audit table does not list.
Why it matters: the QA doc's Services table is currently short by whatever this turns up, and a missing log group name turns TC2 and TC12 into false passes, since a search that finds nothing looks the same as a guard that worked.

## Teardown

Nothing changed. Leave the watermark and the schedule exactly as found, and record both states.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/01-environment-gate.md`
