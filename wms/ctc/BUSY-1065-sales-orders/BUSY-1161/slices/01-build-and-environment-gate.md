# Slice 01, build and environment gate

**Ticket:** BUSY-1161
**Cases:** none. This slice produces the scope every later slice runs against.
**Depends on:** nothing
**Estimated:** one session, read only, about 30 minutes

Four gates. Run them in order and stop at the first that makes the rest pointless.

## Preconditions

- `aws sso login --profile staging` has been run in this terminal. It expires between sittings.
- `aws sts get-caller-identity --profile staging` returns the staging account.

## Setup

Nothing to set up. Every step here is read only. Change nothing, including the watermark and the schedule.

## Cases

### Gate A, do the six outbound components exist, and when did they deploy

The handover names six functions QA has never measured. Four carry a `staging-shipping-inbound-` prefix that appears in no earlier plan in this folder.

Trigger: `aws lambda get-function-configuration` for each of `staging-orders-cin7-so-poller`, `staging-orders-cin7-create-outbound-order`, `staging-orders-cin7-update-outbound-order`, `staging-orders-cin7-cancel-outbound-order`, `staging-shipping-inbound-outbound-order-bridge`, `staging-shipping-inbound-materialise-outbound-shipment`, `staging-shipping-manhattan-send-outbound-shipment`.

Expect: all seven exist.

Capture: `FunctionName`, `LastModified`, `CodeSha256`, `Version` for each, as a table. This table is the deliverable.

Fails if: a function the handover names does not exist. That is a handover correction, not a defect, and it changes the Services table in `QA-DOC.md`.

Save this as `scripts/check-outbound-chain-deploy.sh`. `../BUSY-1160/scripts/check-cin7-order-handler-deploy.sh` is the model; extend it rather than starting fresh if the function list is the only difference. The newer `check-ctc-status.sh` in the engineer's toolset already reports the outbound stage rows and alarms, so run that first and only build what it leaves out.

### Gate B, does the chain match what was traced before

`../retests/RETEST-POST-1161/results/R1-targeted-retest.md` traced a synthetic outbound order through `create-outbound-order` to `outbound-order-bridge` to the shipping-side `create-transaction` to `send-outbound-shipment` on 2026-09-09.

Trigger: read the three queues and their DLQs named in `QA-DOC.md`'s Services table, and list the event source mapping on each **by `--event-source-arn`, never by function name**.

Expect: each queue has one enabled mapping, and the consuming function is the one the Services table names.

Capture: queue name, mapping state, consuming function ARN, `ApproximateNumberOfMessages`, DLQ depth, redrive policy.

Fails if: a queue has no enabled mapping, or its consumer is a different function from the one named. Record the real one; the Services table is then wrong.

Note: `QASYN-12-TC2` is a known poison message cycling on a 25 minute loop toward `staging-shipping-manhattan-sender-dlq.fifo`. Its presence in a snapshot is expected and is not a finding.

### Gate C, access and the toolset

The engineer's toolset landed on 2026-09-10 and is now `../../tools/`. This gate confirms it is usable, not that it exists.

Trigger: for each, answer yes or no with evidence, not an assumption.

1. **The toolset's own credentials.** A `.env` at its root holds the Cin7 key. Copy `.env.example` if there is no `.env` yet, and confirm with a read-only call, `find-cin7-sales-order.sh --limit 1`. Cin7 is production; nothing here writes to it.
2. **SCALE staging login.** Confirm with JJ that he can open the SCALE staging site and search Shipments. **This is the one blocker that can stop the pass.** Nothing in any toolset reads a Shipment back, so without the UI, every creation and revision case is BLOCKED rather than run.
3. **The fixture set is intact.** 19 wholesale scenarios, 2 RTV. List them and confirm their last-modified values ascend, because the stale and out-of-order cases in slice 06 are driven by that ordering.

Expect: nothing in particular. This gate records reality.

Capture: a yes or no plus how it was established, for each of the three.

Fails if: nothing here fails. An unanswered question is worse than a no.

**Already answered, do not re-ask.** There is no programmatic Shipment read-back from SCALE. The toolset's own docs say so in three places, and the sender logs neither the document nor the reply on success. The SCALE half of this plan is manual and that is settled.

### Gate D, environment state

Trigger: read the poller schedule rule state, the sales order watermark, every DLQ depth, and any alarm currently in ALARM.

Expect: schedule DISABLED, watermark UNSET, no cycle since 2026-09-07.

Capture: the actual values. `../../tools/cin7-sales-orders/check-ctc-status.sh` gives most of this in one view.

Fails if: the schedule is enabled or the watermark is set. Do not correct it. Record it and tell JJ, because something else moved it and that changes what the injected slices are running against.

## Teardown

Nothing was changed. Confirm that: re-read the schedule state and the watermark and check they read the same as Gate D found them.

## Write results to

`results/01-build-and-environment-gate.md`, using the result file format in `../../BUSY-1065-sales-orders/BUSY-1160/results/` as the model. Gate A's table and Gate C's three answers are the two things later slices read.

## Stop and ask JJ if

- a function the handover names does not exist
- the poller schedule is enabled or the watermark is set
- a queue's consumer is not the function the Services table names
- an alarm is firing that is not the known `so-poller-stalled` one
- JJ has no SCALE staging login. Nothing past slice 02 is worth starting until that is settled.
