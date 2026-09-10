# Result: Slice 01, deployment gate

**Ticket:** BUSY-1160
**Verdict:** Everything present, pattern readable, PutEvents permitted. Proceed to slice 03.

Read only throughout. No watermark writes, no config changes, no Cin7 calls, no injection. All
findings below came from `get-function-configuration`, `describe-log-streams`/`get-log-events`,
`events:list-rules`/`describe-rule`/`list-targets-by-rule`, `iam:simulate-principal-policy`,
`events:describe-event-bus`, `sqs:list-queues`, and the LLD (Confluence 1802698758, sections 3, 9.1
and 11 read in full for this slice).

## Gate A, characterise the deploy

### Function LastModified against the 2026-09-03 deploy

| Function | LastModified | Matches deploy |
|---|---|---|
| `staging-orders-cin7-so-poller` | 2026-09-03T01:10:45Z | MEASURED, yes |
| `staging-orders-cin7-update-order` | 2026-09-03T01:11:22.015Z | MEASURED, yes |
| `staging-orders-cin7-update-order-eda-queue-handler` | 2026-09-03T01:13:09.072Z | MEASURED, yes |
| `staging-orders-cin7-update-order-eda-queue-populator` | 2026-09-03T01:13:09.370Z | MEASURED, yes |
| `staging-orders-cin7-cancel-order` | 2026-09-03T01:11:21.919Z | MEASURED, yes |
| `staging-orders-cin7-cancel-order-eda-queue-handler` | 2026-09-03T01:13:09.077Z | MEASURED, yes |
| `staging-orders-cin7-cancel-order-eda-queue-populator` | 2026-09-03T01:13:08.978Z | MEASURED, yes |
| `staging-orders-v2-list-orders` | 2026-09-03T01:09:55Z | MEASURED, yes |
| `staging-orders-v2-eda-queue-populator` | 2026-08-20T20:49:37Z | MEASURED, no |
| `staging-orders-v2-eda-queue-handler` | 2026-02-23T18:08:32Z | MEASURED, no |

The last two did not move on deploy day, but they are not part of this ticket's routing (see Gate B):
the shared `orders-v2` populator/handler pair consumes a different rule, one that does not list
`TRANS_UPDATE_ORDER` or `TRANS_CANCEL_ORDER` among its detail-types. **This corrects CLAUDE.md's own
description**, which says the poller's events reach handlers through "`staging-orders-v2-eda-queue-populator`".
Measured routing (Gate B) shows the two cin7-specific populators are the actual consumers for this
ticket's transaction types. Worth fixing in CLAUDE.md so a later session does not go looking for
this ticket's activity on the wrong function.

The seven cin7-specific functions and `list-orders` all carry the 2026-09-03 deploy timestamp.
MEASURED: the deploy is not partial with respect to the functions this ticket needs.

### Log recency, before trusting any silence

| Log group | Last event | Read |
|---|---|---|
| `/aws/lambda/staging-orders-cin7-so-poller` | 2026-09-07T06:32:38.267Z | MEASURED |
| `/aws/lambda/staging-orders-v2-list-orders` | 2026-09-08T00:45:24.186Z | MEASURED |
| `/aws/lambda/staging-orders-cin7-update-order` | no log group exists | MEASURED |
| `/aws/lambda/staging-orders-cin7-update-order-eda-queue-handler` | no log group exists | MEASURED |
| `/aws/lambda/staging-orders-cin7-update-order-eda-queue-populator` | no log group exists | MEASURED |
| `/aws/lambda/staging-orders-cin7-cancel-order` | log group exists, 0 bytes stored, no streams | MEASURED |
| `/aws/lambda/staging-orders-cin7-cancel-order-eda-queue-handler` | no log group exists | MEASURED |
| `/aws/lambda/staging-orders-cin7-cancel-order-eda-queue-populator` | no log group exists | MEASURED |

`list-orders` is current, unlike the BUSY-1158 precedent (stale since September 2025 against a
2026-09-03 deploy). No silence-reading risk there.

The reconciliation handlers and their queue populators/handlers have never logged anything. This is
an absence, so it needs a cause rather than being read as a pass or a fail on its own: **the poller
schedule is currently DISABLED and the SO watermark is currently UNSET** (confirmed below, and
matches STATE.md's "carried from BUSY-1159" note), so no revision or cancellation has been fed to
these handlers since deploy. Zero invocations is the expected state given that, not evidence the
handlers are broken. Tagged INFERRED for the causal link (schedule state explains the silence);
MEASURED for the schedule and watermark values themselves.

**One thing worth flagging, not a stop condition.** The poller's own log group shows two invocations
about two minutes apart on 2026-09-07 (06:30:34 and 06:32:32 watermark timestamps), with a live
watermark advancing between them and 9 orders created (`Cin7SOPollerCycleComplete`:
`ordersFetched:56, created:9` then `ordersFetched:2, created:0`, both `updated:0` and `cancelled:0`).
This is the "manual invoke after the schedule has been off a while catches up the entire backlog"
pattern STATE.md already documents from BUSY-1159, but with a different count (9 created here vs the
5 recorded there) and a date (2026-09-07) not yet in STATE.md's carried notes. The schedule rule
(`staging-orders-cin7-so-poller-rule`) is DISABLED and the watermark is UNSET right now, so the
current state matches what slices 01-05 need; this is a record of what happened before this session,
read from existing logs, not something this session caused. INFERRED that it was a manual invoke
(matches the documented pattern exactly); MEASURED are the counter values and timestamps. Flagging for
JJ's awareness, not blocking.

### Reconciliation handlers, identified and confirmed present

The LLD (§3, "Order handlers") describes them functionally rather than by Lambda name: "Update and
cancel reconcile lines against the incoming set: new lines inserted, changed quantities updated in
place under the same `SK`, vanished lines marked removed, cancel flipping the order status. All
version-guarded on the order's stored `lastModified`." MEASURED against the account: this maps to
`staging-orders-cin7-update-order` and `staging-orders-cin7-cancel-order`, each with its own
`-eda-queue-handler` and `-eda-queue-populator` pair, all four confirmed present via
`lambda:list-functions` and `get-function-configuration` above. Their SQS infrastructure exists too:
`staging-orders-cin7-update-order-queue.fifo` / `-dlq.fifo` and
`staging-orders-cin7-cancel-order-queue.fifo` / `-dlq.fifo` (MEASURED, `sqs:list-queues`). Full chain
present: rule, populator, FIFO queue, DLQ.

### Counter vocabulary

`staging-orders-cin7-so-poller` emits one `Cin7SOPollerCycleComplete` metric line per cycle (MEASURED,
from the 2026-09-07 log). Fields, 19 excluding the `metric` name itself: `ordersFetched`, `created`,
`updated`, `cancelled`, `staleSkipped`, `echoSkipped`, `skippedLocallyTerminal`, `skippedCounted`,
`skippedZeroUnitOrders`, `pendingCreates`, `oversized`, `skippedZeroQty`, `skippedNoSizes`,
`packingBrandMisses`, `skippedStages` (an object keyed by stage name, e.g. `{"Approved": 4}`),
`watermarkAdvanced`, `newWatermark`, `pageCapHit`, `requestsThisCycle`. `created`, `updated` and
`cancelled` are the three dispositions this ticket's transaction types map to.

**This corrects an assumption carried in CLAUDE.md from R11**, that "`skippedStages` stopped
populating on 2026-09-03." MEASURED here: `skippedStages` populated (`{"Approved": 4}`) in the first
of the two 2026-09-07 cycles. Either R11's finding predates this log window or something changed
between R11 and now; either way, slice 04 should not assume this field is empty by construction.

## Gate B, the routing contract slice 03 has to match

19 rules total on `staging-orders-v2-event-bus` (MEASURED, `list-rules`, no pagination). **No rule on
this bus filters on `source`, only on `detail-type`.** Verbatim event patterns for the two rules this
ticket needs, plus the one adjacent rule checked to rule out an overlap:

**Update:**
```
Rule: staging-orders-cin7-stagingorderscin7updateordereda-hEEPyjK4RaGZ
EventPattern: {"detail-type":["TRANS_UPDATE_ORDER"]}
Target: arn:aws:lambda:ap-southeast-2:398353400186:function:staging-orders-cin7-update-order-eda-queue-populator
```

**Cancel:**
```
Rule: staging-orders-cin7-stagingorderscin7cancelordereda-HUt0zThIKlU6
EventPattern: {"detail-type":["TRANS_CANCEL_ORDER"]}
Target: arn:aws:lambda:ap-southeast-2:398353400186:function:staging-orders-cin7-cancel-order-eda-queue-populator
```

Each of `TRANS_UPDATE_ORDER` and `TRANS_CANCEL_ORDER` appears in exactly one rule's detail-type list
across all 19 rules (MEASURED, checked against the full rule set, not assumed). Each of those two
rules has exactly one target. **A synthetic event carrying `detail-type: TRANS_UPDATE_ORDER` or
`TRANS_CANCEL_ORDER` reaches exactly one Lambda, whatever its `source` field says**, since no rule
inspects `source`. This is the whole routing contract: `detail-type` is the only field that matters.

One more rule matches every event on the bus regardless of content
(`Events-Archive-stagingordersv2EventArchive52DD92F8-3tio0PCh3JJQ`, pattern
`{"account":["398353400186"],"replay-name":[{"exists":false}]}`), but its target is EventBridge's own
archive feature (`arn:aws:events:ap-southeast-2:::`, an `InputTransformer` writing to an archive ARN),
not a Lambda consumer. MEASURED: this does not count toward AC7's "exactly one outward event per
revision", since it is infrastructure, not a business consumer.

**Cross-checked against the LLD.** §11.2 (numbered "2. Order handlers" in the source): "exactly one
outward event per revision, of the right type for the family." §3's transaction-type description
("`CREATE_ORDER` / `UPDATE_ORDER` / `CANCEL_ORDER`") matches the `TRANS_`-prefixed detail-type
convention observed on every other rule on this bus (`TRANS_CREATE_ORDER`, `TRANS_HOLD_ORDER`,
`TRANS_ADD_ITEM`, etc). The measured routing is consistent with the design.

**Caveat, out of this gate's scope.** This confirms what EventBridge itself will route on. It does not
confirm the populator or handler Lambdas do no additional validation of `source` or other fields once
invoked; that would need code or a captured real invocation, neither of which this read-only gate
does. UNKNOWN, flagged for slice 03 to watch for as a possible source of an unexplained rejection.

## Gate C, can QA write to the bus at all

**Confirmed permitted, without emitting anything.**

Current identity (`sts:get-caller-identity`): `arn:aws:sts::398353400186:assumed-role/AWSReservedSSO_AWSPowerUserAccess_3585bf83c4521897/james.johnston`
(MEASURED).

Read the role's own attached policies rather than inferring (MEASURED, `iam:list-attached-role-policies`
on `AWSReservedSSO_AWSPowerUserAccess_3585bf83c4521897`): `PowerUserAccess` and `IAMFullAccess`, no
inline policies, no permissions boundary on the role.

Rather than reading the PowerUserAccess policy document and reasoning about it, simulated the exact
action against the exact resource (MEASURED, `iam:simulate-principal-policy`):

```
Action:   events:PutEvents
Resource: arn:aws:events:ap-southeast-2:398353400186:event-bus/staging-orders-v2-event-bus
Decision: allowed
Matched:  PowerUserAccess (IAM policy)
Organizations: AllowedByOrganizations = true
```

Also checked the bus's own resource policy (MEASURED, `events:describe-event-bus`): none set (`Policy: None`),
so there is no bus-level restriction layered on top of the identity-based allow.

No event was emitted to test this, per the slice's instruction. Gate C passes on the simulation and
the resource policy check alone.

## Reads as

**Everything present, pattern readable, PutEvents permitted. Proceed to slice 03.**

* Deploy: all seven cin7-specific functions and `list-orders` carry the 2026-09-03 timestamp.
* Reconciliation handlers: present, matching the LLD's functional description, full queue/DLQ chain
  confirmed.
* Routing contract: `detail-type` only, one rule and one target per transaction type, verbatim above
  for slice 03 to consume without re-deriving it.
* PutEvents: allowed, confirmed by policy simulation against the real role and the real resource, and
  by the bus having no restrictive resource policy.

No stop condition was hit. The deploy is not partial with respect to what this ticket needs, the
reconciliation handlers are present, and nothing in this slice needed a watermark write, a poll, a
Cin7 call or an emit.

## New open questions

None raised. The routing-consumer correction (Gate A) and the `skippedStages` correction (Gate A
counter vocabulary) are corrections to this plan's own documentation, not questions for dev, and are
recorded above rather than added to `../BUSY-1065-OPEN-QUESTIONS.md`.

## Scripts written

Three, all in `scripts/`, all ticket specific, all **unreviewed**. Rows added to `SCRIPTS.md`.

* `check-cin7-order-handler-deploy.sh`, Gate A. Loops function `LastModified` against an expected
  deploy date for the poller, both reconciliation handlers, their eda-queue pairs, and list-orders.
* `check-cin7-log-recency.sh`, Gate A. Last log event per handler log group, tells "no log group" from
  "log group exists but empty" from "has recent events". Written, tested, and fixed once in this
  session: see `TOOL-NOTES.md` for the stdout/stderr race the first version had. Re-run 3 times after
  the fix with identical output.
* `check-bus-routing-contract.sh`, Gate B. Every rule's event pattern and target list on a given
  event bus, verbatim, no paraphrasing. Re-run after being written; its output matches the manual
  `describe-rule`/`list-targets-by-rule` calls used to draft Gate B above.

A passing run from any of these three proves the script ran and printed what AWS returned, not that
the system under test is correct. None has a second reviewer yet.
