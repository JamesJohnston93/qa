# Result: Slice 01, environment gate

**Ticket:** BUSY-1159
**Verdict:** PASS, with two pre-existing conditions recorded before any test traffic

## Gate A, credentials and feed state

MEASURED. Profile `staging` (SSO role `AWSPowerUserAccess`, account 398353400186) required an `aws sso login` refresh before use, then worked for every call in this slice.

MEASURED. `staging/orders/cin7` secret exists, `SecretString` length 68 (populated, not empty). Last changed 2026-08-21.
MEASURED. `staging/manhattan/oauth2` secret exists. Last changed 2026-07-15.
MEASURED. Watermark (`--poller so`): `2026-08-27T23:28:50.423Z`, a real ISO 8601 UTC value, not `UNSET`.

This resolves Q7 and Q8 as no longer blocking: both secrets are populated and the watermark already holds a real value, contrary to STATE.md's note that they ship empty/UNSET. Someone (presumably Kian) populated both ahead of this session.

Not changed: watermark left exactly as read.

## Gate B, pipeline status

MEASURED, via `check-ctc-status.sh --stage staging --profile staging`:

* Stage 1 (poll schedule DLQ): 0 waiting, 0 in-flight
* Stage 2 (`staging-orders-v2.fifo` + dlq): 0 waiting, 0 in-flight both
* Stage 3 (`staging-shipping-v2-orders.fifo`): 0 waiting, 0 in-flight
* Stage 4 (`staging-shipping-v2.fifo`): 0 waiting, 0 in-flight
* Stage 5 send (`staging-shipping-manhattan-sender.fifo`): 0 waiting, **2 in-flight**
* Stage 5 DLQ (`staging-shipping-manhattan-sender-dlq.fifo`): **3 dead-lettered**, script annotates "send failed 20 times"
* Watermark: `2026-08-27T23:28:50.423Z`
* Schedule: **ENABLED**

PRE-EXISTING, recorded before any test run so a later failure is not misattributed to this session's work: 3 messages already on the Manhattan sender DLQ, and 2 in-flight on the sender queue. The poller schedule was already ENABLED coming into this slice (nobody in this session enabled it).

Script's own reading: stages 3 and 4 have no DLQ at all (silent failure risk), stage 5 has no alarm on either its DLQ depth or a send failure, the poller schedule DLQ (stage 1) has no alarm either.

## Gate C, Cin7 tooling reachable

MEASURED. `find-cin7-sales-order.sh --group 'Retail - Ecomm' --max-pages 1` returned 5 orders, contact groups resolved to ECOM correctly. Credentials in `.env` work.

Notable among the 5: `SO #261111-SplitShipment-HARBOUR-TOWN` (id 964465), reference is 33 characters. See TC20 finding below, this is the order behind the live alarm.

## TC20, alarms and alert routing

MEASURED. All four named alarms exist:

| Alarm | State |
|---|---|
| staging-orders-cin7-so-poller-errors | OK |
| staging-orders-cin7-so-poller-stalled | OK |
| staging-orders-cin7-so-poller-page-cap-hit | OK |
| staging-orders-cin7-so-poller-alert | **ALARM** |

MEASURED. Subscriber counts: `staging-orders-cin7-alerts` = 0, `staging-shipping-manhattan-alert-topic` = 0. Zero subscribers is expected per Q24, belongs to BUSY-1162. Not a FAIL.

FINDING, MEASURED. `staging-orders-cin7-so-poller-alert` was OK on the first `check-ctc-status.sh` run in Gate B and ALARM two minutes later on the direct `describe-alarms` call. Not a tool discrepancy, confirmed by `StateUpdatedTimestamp: 2026-08-27T23:31:31Z` and a real threshold crossing at 23:16. Metric is `staging-orders-cin7 / SoPollerAlert`, sourced from a metric filter on `{ $.metric = "Cin7SOPollerAlert" }` in `/aws/lambda/staging-orders-cin7-so-poller`.

MEASURED, the log line that tripped it (23:30:51Z, ERROR level):
```
Cannot build CREATE_ORDER for Cin7 SO #261111-SplitShipment-HARBOUR-TOWN (modified 2026-08-27T23:30:03Z)
- order not sent. Cin7 reference "261111-SplitShipment-HARBOUR-TOWN" is 33 characters, over the
25-character ShipmentId limit. Refusing to truncate - a truncated key would silently overwrite a
sibling split shipment.
```

This is a real, currently-live hard-error condition at the poller stage (order never reaches SQS at all, distinct from the Stage 5 DLQ dead-letters, which are a different mechanism further downstream). It is a naturally-occurring "found condition" for slice 07 (TC9, TC15). Recorded in `fixtures.md` for that slice to pick up, rather than requiring a manufactured case.

## Gate D, historic stage evidence (Q1)

MEASURED, 14 day window, `Cin7SOPollerCycleComplete` events, `skippedStages` values:

```
   6 skippedStages":{"Fraud Warning":1}
 532 skippedStages":{}
```

`Fully Picked` and `Partially Picked` do not appear as skipped stages anywhere in 14 days of history (538 cycles total). Only `Fraud Warning` appears skipped, 6 times. This is evidence against the dev handover's claim and consistent with the LLD (Q1, Answered). Not a substitute for TC14's direct confirmation in slice 04, since this window may not contain a Picked-stage order at all, but no evidence of the suspected defect turned up either.

## Fails if conditions

None triggered. Both secrets present and populated. Cin7 tooling reachable. All four named alarms exist.

## Teardown

Nothing changed. Watermark left at `2026-08-27T23:28:50.423Z`. Schedule left ENABLED (found that way, not touched). Per PLAN.md, disable the schedule only at the end of a session that is not immediately followed by another; this session continues into later slices.

## Open items raised

* Sender DLQ (3 dead-lettered) and schedule ENABLED are pre-existing baseline conditions, not caused by this slice. Recorded in `fixtures.md` so slice 02 onward does not misattribute them.
* The split-shipment 25-character ShipmentId limit hard error is a live found condition for TC9/TC15 (slice 07). Recorded in `fixtures.md`.
* No new open question raised. Q7 and Q8 resolved (no longer blocking). Q1 gained supporting (not conclusive) evidence.
