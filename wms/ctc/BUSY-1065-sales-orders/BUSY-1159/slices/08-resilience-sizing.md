# Slice 08, resilience sizing

**Ticket:** BUSY-1159
**Cases:** TC17, TC19
**Depends on:** slice 04 (population shape known)
**Estimated:** one session. Run it last.

This slice deliberately pushes the poller until it fails, and it spends Cin7 API budget doing so. Do not run it alongside other testing, and tell JJ before starting.

## Preconditions

* Slices 01 to 07 attempted, so a timeout here cannot corrupt an unfinished case.
* Nobody else running against the shared Cin7 budget.
* Current watermark recorded, so it can be restored exactly.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so    # record, this is the restore point
```

## Cases

### TC17, backfill ceiling
Trigger: widen the watermark reset in steps and watch the poller's duration and outcome. Start narrow. Suggested steps are 6 hours, 24 hours, 3 days, stopping at the first failure. Between steps, read the watermark back and confirm it advanced.
Expect: at some window width the poller hits its 5 minute timeout, writes nothing, and leaves the watermark untouched, so the next cycle repeats the same doomed work. On the purchase order flow this happened three times in a row with no cycle failure metric, because the metric only fires on an explicit throw.
Capture: the widest window that completed, the first width that failed, the poller duration at each step, and whether any failure metric or alarm fired. Tag each as MEASURED.
Fails if: nothing. The output is a number, not a verdict. Record the ceiling.
Watch: the shared API budget on the dashboard. Stop early if the day's usage climbs sharply, and say where you stopped.

### TC19, oversized order
Trigger: look for an order whose detail exceeds the event size limit. Both LLDs state 256 KB consistently, alongside a 400 KB DynamoDB item cap and a 1 MB SCALE payload limit. The roughly 240 KB figure comes from the purchase order QA pass, so it is a measured effective ceiling rather than a competing document. The likely explanation, INFERRED not measured, is that the 256 KB is an EventBridge entry cap counting the envelope as well as the payload.
Expect: skipped with an alert, never truncated or split.
Capture: whether such an order exists in the population at all, and the actual limit if one is hit.
Blocked if: unreachable. At ECOM per unit grain this is very unlikely, so BLOCKED with that reason is the expected outcome. If an oversize event is ever seen, record the actual payload size at which it tripped, since the gap between the documented 256 KB and the measured 240 KB is worth closing with a real number.

## Teardown

Restore the watermark to the value recorded in setup, read it back, and confirm. **Disable the poller schedule rule** before ending the session, whatever the outcome, so a wide window is not left backfilling unattended.

```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so --set <restore-point> --confirm
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
aws events disable-rule --name staging-orders-cin7-so-poller-rule --profile "$AWS_PROFILE" --region ap-southeast-2
```

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/08-resilience-sizing.md`
