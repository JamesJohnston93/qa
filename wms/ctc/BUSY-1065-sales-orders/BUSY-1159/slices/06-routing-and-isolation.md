# Slice 06, routing and isolation

**Ticket:** BUSY-1159
**Cases:** TC7, TC11, TC16
**Depends on:** slice 02 (a CTC order that reached the sender)
**Estimated:** one session, coordinated with whoever can put a Universal Store order through staging

This slice needs a CTC order and an ordinary Universal Store order flowing in the same window. That coordination is the hard part, not the observation.

## Preconditions

* Slice 02 complete.
* Sender rule on the shipping bus enabled:
```bash
aws events list-rules --event-bus-name staging-shipping-v2-event-bus --profile "$AWS_PROFILE" --region ap-southeast-2
```
* Someone able to get a `us` or `ps` order through staging in the same period. **Nothing invoked by hand**, on either side, or TC11 is invalid.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
```
Snapshot queue and dead letter depths before anything flows. Reading a dead letter queue with `--visibility-timeout 0` still increments the receive count, so snapshot first and compare, rather than reading messages twice.
```bash
./check-ctc-status.sh --stage staging --profile "$AWS_PROFILE"
```

## Cases

### TC7, Universal Store orders unaffected
Trigger: let a normal `us` or `ps` order flow through the usual path.
Expect: its order and shipment items are created exactly as before, one row per unit, no CTC stamps, `company` absent. Its reference does not appear in the CTC sender log group, its queue or its dead letter queue.
Capture: the record shape for the UNI order, and the negative search across the sender log group.
Fails if: any CTC stamp appears on a UNI record, or the UNI reference reaches the CTC sender.

### TC11, CTC only routing
Trigger: the CTC order from slice 02 and the UNI order from TC7, both flowing unattended.
Expect: the sender log holds the CTC reference and not the UNI one. The sender dead letter queue stays empty. Each CTC shipment uses its own message group.
Capture: both searches, and the dead letter depth before and after.
Fails if: a UNI shipment reaches the CTC sender queue. That means the `company = CTC` filter is not applied, and at UNI volumes it would flood the queue. Escalate immediately rather than continuing the slice.

### TC16, message group is real
Trigger: read the message attributes on a CTC shipment message, or process two CTC shipments and check they do not interleave.
Expect: the message group is the order key. Never the literal string `undefined`.
Capture: the message group value verbatim.
Expect a FAIL here rather than a pass. BUSY-1258, which fixes the fallback, is To Do and slated for Sprint 41, so the defective behaviour is very likely still live. Confirming it is still the job, because the fix's scope is explicitly epic wide and this flow needs to be on the list of callers it checks.
Fails if: the value is `undefined`. This is the BUSY-1258 populator fallback, and its blast radius is not limited to this flow. A single poison message in that group serialises and then blocks every Manhattan send including purchase orders. Raise it against BUSY-1258 and tell Kian the same day.

## Teardown

Snapshot the queue and dead letter depths again and record any change. Purge nothing without asking JJ. Disable the schedule rule if no further slice runs today.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/06-routing-and-isolation.md`
