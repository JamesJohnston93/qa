# Cheap Thrills customer data is readable in CloudWatch on staging

Raised from QA on BUSY-1158, 31 August 2026. Not a QA finding about that ticket's acceptance
criteria, which is why it is here and not in the QA doc.

## What was found

Two consumers in the shipping and orders services log complete order records, in the clear, to
CloudWatch on every invocation.

**`staging-faulty-sale-worker-queue-handler`** logs its entire incoming SQS record body at INFO level.
For a Cheap Thrills sales order that includes the customer's email address and full shipping name and
address. Observed on two real Cin7 orders. Every other consumer read during this work logs a short
line, not the record.

**`staging-shipping-v2-dc-packing-shipment-create`** logs object dumps that include the customer's
name and other order detail. Observed on a Universal Store order, so this is not specific to Cheap
Thrills traffic.

Both were found while reading logs for an unrelated reason. Neither was being looked for.

## Why the first one matters more than the second

The faulty sale worker subscribes to order creation on its own EventBridge rule, with no filter on
origin or company. It is not in the integration's design document, it is not one of the consumers the
developer identified as needing attention, and it is not in the script QA uses to check that
consumers ignore Cheap Thrills records.

So it is both unguarded and verbose. Cheap Thrills is a separate business whose customers have no
relationship with Universal Store, and their contact details are currently being written into a log
group belonging to a Universal Store fraud detection path that nobody has decided should see them.

Whether the worker acts on those records is not yet known. It receives them.

## What is not known

Whether the same behaviour exists in production. This was observed on staging only, against real
Cin7 production orders, which is how the customer data is real.

The retention on these log groups, and who has read access to them.

Whether any other consumer does the same. Only a handful were read.

## Update, 2026-08-31

Dev is splitting Cheap Thrills traffic out a layer above the faulty sale worker, so it will stop
receiving these records entirely. That removes the exposure on that path as a side effect rather than
as a deliberate fix, and it is not yet deployed.

**It does not cover the second consumer.** `staging-shipping-v2-dc-packing-shipment-create` still logs
the whole record, and Cheap Thrills shipments reach it whether or not its guard fires, because the
record is logged on arrival and the guard runs afterwards. Nothing is currently planned for that one.

So the question below still needs an owner, narrowed: not "should this worker see CTC records", which
is being handled, but "should either of these workers be logging whole order records at all".

## Update 2, 2026-08-31, a third log group and a point about timing

A behavioural investigation into the same worker found a **third** log group with the same problem,
and one fact that changes how this should be prioritised.

**`staging-inventory-check-order-faulty-sale`**, the worker that
`staging-faulty-sale-worker-queue-handler` invokes, dumps the same unredacted record at INFO that its
dispatcher does. Customer name, email and shipping address. This is the second log group on the
faulty sale path, not a second path: the dispatcher invokes this worker synchronously, so the split
described above removes Cheap Thrills traffic from both at once. It is recorded here because the
count of affected log groups was previously two and is actually three, and because if the split is
ever descoped, two log groups need the fix on that path rather than one.

**The timing point, which matters more than the count.** Cheap Thrills has no prior footprint in AWS
at all. Every Cin7 message this epic has produced anywhere, staging included, is the first Cheap
Thrills data AWS has ever handled, and production has none of it yet.

So this is not a question of whether customer data has already been exposed in production. It cannot
have been. It is that the exposure begins on the first real production order, with no window in which
to notice it beforehand. Whatever the fix is, it is cheaper now than at any later point, and there is
no backlog of already-logged records to clean up if it lands before go live.

## What QA is doing about it

The testing plan now treats these log groups as hazardous to read: extract the single field needed
with a narrow pattern, never print a matched line. That is recorded in the plan's tool notes.

A read during that investigation returned two full record dumps despite using what looked like a safe
correlator: a UUID taken from the dispatcher's own success line, which turned out to be the order's
own key field and therefore also appears inside the record body these groups dump. One of the two
records belonged to an order not under test. Content-free filters only from that point on: request
ids, exact guard phrases, or a narrow extraction piped through a script that never prints the matched
line. The correlator you filter on has to be one that cannot appear in the body.

The guard question itself is logged as Q27 in the epic's open questions register and is holding one
acceptance criterion on BUSY-1158 open.

None of that addresses the logging itself, which is why this needs an owner.

## Update 3, 2026-09-07, a fourth log group, and a narrower fix than it first looks like

Found during BUSY-1158/1159 retest slice R13 (`BUSY-1065-sales-orders/RETEST-1158-1159/results/R13-fresh-data-verification.md`),
while auditing one fresh Cin7 poller cycle behaviourally.

**A fourth log group, upstream of all three named above: `{stage}-orders-cin7-so-poller` itself.**
Its own `Pushed ... to EventBridge` line, logged once per order it creates, carries the customer's
email and full shipping name and address in the clear, for every single order, CTC or not, this is
the log group that starts the chain the other three all sit downstream of. This is the SO poller
Lambda, not a consumer of its output, so it is upstream of the split described in the 2026-08-31
update below, not covered by it even in principle. Found the same way as the others: read while
auditing something unrelated (which orders got created in one cycle), not being looked for.

That printing happened directly in this session's own tool output for a few seconds before being
caught and corrected (see the R13 result file's process note); it was never written to a file.
Every extraction after that point used a saved script
(`BUSY-1065-sales-orders/RETEST-1158-1159/scripts/audit-poller-cycle-emits.sh`) that pulls named safe fields
only, matching the "narrow pattern, never print the matched line" rule this doc already calls for.

**A second thing, which reads like progress but is not the split landing.** `staging-inventory-check-order-faulty-sale`
(the third log group above) produced zero record-dump lines across 9 fresh CTC invocations tested
this session - only `START`/`END`/`REPORT`, where R1 (2026-09-04) and the retest's R11 (also
2026-09-07) both found and relied on the same echo this doc describes. This function's own
`LastModified` is today, coincident with a same-day redeploy of roughly 30 unrelated functions in
the same service (stock/newstore workers), read as a routine service-wide deploy, not a targeted
fix. **Traffic was not reduced**: all 9 fresh CTC orders still reached this worker synchronously, via
the unchanged (since 2026-03-04) dispatcher upstream of it, with no origin/company filter anywhere in
the chain (EventBridge rule pattern still unconditional `TRANS_CREATE_ORDER`). So whatever changed,
it is a change to this one function's *logging*, not the "split Cheap Thrills traffic out a layer
above the faulty sale worker" fix this doc's 2026-08-31 update describes - that fix, if it has
shipped anywhere, has not reached this path. Worth a second, independent check on a different fresh
order before treating the logging change as confirmed rather than a one-off; not re-verified within
this session.

**Running count is now four log groups**, one of them (the poller) upstream of the split entirely and
therefore untouched by it even once shipped: `{stage}-orders-cin7-so-poller`,
`staging-faulty-sale-worker-queue-handler`, `staging-inventory-check-order-faulty-sale` (logging
possibly changed, traffic unchanged), `staging-shipping-v2-dc-packing-shipment-create` (not
re-checked this session).

## Which ticket owns this, added 2026-09-07

**BUSY-1162**, "Resilience & observability: error taxonomy, alerts, metrics, PII-safe logging". In
Progress, Kian, created 2026-07-22, Sprint 41. Its acceptance criteria are explicit: logs and alerts
carry no customer contact fields, spot-checked across the poll, persist, materialise and send hops, and
logging is PII-redacted with order references at every hop and never customer address, email or phone.

So this is not an unowned finding and it is not a question for anyone. **It is measured evidence
against BUSY-1162's acceptance criteria, on two of the hops that AC names**, as at 2026-09-07:
`{stage}-orders-cin7-so-poller` on the poll hop and `staging-faulty-sale-worker-queue-handler`
downstream. No ticket in the BUSY project names any of the four log groups above alongside a logging or
PII concern, so the evidence has to be attached to BUSY-1162 rather than found by whoever picks it up.

Nothing has been posted to that ticket. **JJ's call, 2026-09-07: BUSY-1162 is not being worked on now,
so this waits until it is picked up.** When it is, the four log groups, the field names and the
measurement dates in this doc are the evidence, and the poller is the one that needs its own fix
regardless of how the guard question resolves.

## Suggested next steps

Confirm whether the same logging exists in production, and at what retention.

Decide whether the faulty sale worker should receive Cheap Thrills records at all. If it should not,
it needs the same guard as the other consumers. If it should, the logging still needs to change.

Reduce all four consumers to logging identifiers rather than record bodies, independently of the
guard decision. A guard stops the record being processed; it does not necessarily stop it being
logged on arrival. The poller (`{stage}-orders-cin7-so-poller`) is upstream of the guard/split
question entirely - it logs the record it is about to emit, before any downstream consumer sees it -
so it needs its own fix regardless of how the other three are resolved.
