# Deferred test cases, epic BUSY-1065

Cases that came out of QA on BUSY-1158, BUSY-1159 and BUSY-1160 and belong to a later ticket. Started
2026-09-01 after dev confirmed that alerting and resilience are being built as their own task and that
the cases found here can wait for it.

**This is not a backlog of things nobody got to.** Every entry is a case with real evidence behind it
that was deliberately routed elsewhere. The point of writing them down is that the receiving ticket
tests the right thing rather than rediscovering the question and getting it slightly wrong.

**Read the "what must actually be tested" line on each entry.** Several of these have an obvious
wrong version that looks correct until you check what the failure shape really is.

Owner of this file: QA. Add to it whenever a case is deferred; do not delete entries when the
receiving ticket picks one up, mark it.

---

## For BUSY-1162, alerting, error taxonomy and resilience

### D1. Watermark advances past an entry that never reached the bus

**From:** BUSY-1159 TC22, and Plan B.
**Status:** **Deferred to BUSY-1162, decided by JJ 2026-09-01 with dev's agreement.** Closed on BUSY-1159, where it is marked DEFERRED rather than left NOT RUN, so nobody picks it up as outstanding work there.

`PutEvents` can return HTTP 200 carrying `FailedEntryCount` greater than zero. The SDK does not raise
on that. Whether the poller checks the response is unknown and unobservable from outside: the code
logs the outbound request and never the response.

**Evidence already held, so the later ticket does not need to redo it.** Slice 10, MEASURED on the
full retained history rather than a sample: 70 `PutEvents` calls, one entry each, and every
idempotencyId the poller pushed was received by `staging-orders-v2-eda-queue-populator`. Nothing has
ever gone missing. **Latent, not realised.**

**What must actually be tested, and this is the entry most likely to be got wrong.** Dev's reasoning
for deferring is that a rejected order will error downstream and land in the DLQ. That holds for the
case where `PutEvents` throws, and for a downstream lambda failing on an event that did reach the bus.
**It does not hold for the 200 shape.** A failed entry never reaches the bus at all, so no downstream
lambda is invoked, nothing errors, and nothing lands in any DLQ. The failure is silent and upstream of
every mechanism that would catch it.

So the case is: **does the watermark hold when an entry fails on a non-throwing 200?** If it advances,
the record is lost with no trace anywhere. Do not write this case as "a rejected order lands in the
DLQ", because it will pass trivially while testing something else.

**How to force it:** the `INTERNAL_EVENT_BUS_NAME` env var. Targeting a bus that does not exist
returns exactly the 200-with-failures shape. Full method, including the snapshot, the revert proof and
the warm-container trap that will silently defeat it, is in
`BUSY-1065-sales-orders/BUSY-1159/slices/10-putevents-partial-failure.md`. It is `kian-dev` only and writes, so it
needs a coordination window.

**Cheapest useful outcome if nobody wants to force it:** dev adds a `FailedEntryCount` check and logs
the response. Then it is observable and this case becomes a read.

### D2. No echo-skip counter exists anywhere in the poller's output

**From:** BUSY-1159 TC21b.

Replay suppression works, MEASURED: a re-polled unchanged order produced no second transaction row and
no second send. But **not for the reason the design implies.** The order never reached the emit step at
all, and no skip counter moved. The payload-hash echo guard the LLD's risk table points at is not what
suppressed it, and cannot be, because the hash is never written (see D3).

**What must actually be tested:** that a wrong mapping producing a spurious re-emit would be *visible*.
Today nothing counts an echo skip, so the difference between "correctly suppressed" and "never
happened" is invisible in the poller's own telemetry. The case is about observability, not about
whether suppression works.

### D3. `lastEmittedPayloadHash` is never written, and no ticket owns writing it

**From:** BUSY-1159 TC13. **Superseded 2026-09-02 by D17. Read D17 instead; this entry is kept for
history and both of its original claims were wrong.**

It said no hash exists under any other name. Slice 13 measured one on every emit, 8 hex characters,
carried as the trailing segment of `idempotencyId`. It said severity becomes high the moment the
confirmation leg exists. Nobody measured that: a duplicate emit is an identical SAVE on the same
`ShipmentId`, a no-op pre-wave and DLQ noise post-wave.

**Routes two ways:** the observability half is BUSY-1162's, the functional half is the confirmation
epic's (D6). Whoever gets there first should confirm the field is being written before building on it.

Parked with Lachlan against the LLD as of 2026-09-01, by decision, not chased.

### D4. Both alert topics have zero subscribers

**From:** BUSY-1159 TC20, PASS on the case as written.

`staging-orders-cin7-alerts` and `staging-shipping-manhattan-alert-topic` both have zero subscriptions.
The alarms themselves exist and work: one fired during the QA pass and reached nobody.

**What must actually be tested:** not that the alarm fires, which is proven, but that it reaches a
human. An alarm with no subscriber is indistinguishable from a working alerting system in every test
that stops at the alarm.

Both hard-error paths found so far route here and are therefore currently silent: a reference longer
than 25 characters, and an unrecognised `taxStatus`.

### D5. Retryable versus permanent rejection has no defined distinction

**From:** BUSY-1160 TC17, which has no defined pass because of it.

Nothing in the ticket or the LLD says how the sender tells a retryable SCALE rejection from a permanent
one. **Both arrive as an HTTP 200 carrying `rejectedTransactions > 0`.** BUSY-1159's AC8 treats that
response as retryable and redrives it; BUSY-1160's AC5 wants the same response classified permanent
and dead-lettered.

Those two acceptance criteria contradict each other on the same wire response, and BUSY-1162 owns the
taxonomy that would arbitrate. **This is a genuinely open question for dev**, not one of the three
answered verbally on 2026-08-31, so it is fair to raise.

Related mechanics, MEASURED: a rejected shipment retries for roughly 8.3 hours before it dead letters
(`maxReceiveCount` 20 by `VisibilityTimeout` 1500s), so a rejection looks like silence for most of a
working day. Whatever the taxonomy decides, that latency is the thing an operator experiences.

**Narrowed 2026-09-09, BUSY-1160 slice 08, source read of `send-shipment`.** Half of this is already
built: a `rejectedTransactions > 0` response IS classified `"rejected"` and logged and alerted as a
permanent failure, which is what AC5 asked for. What is missing is the consequence. The caller
rethrows on every branch, so a rejection labelled permanent still redelivers up to `maxReceiveCount`
before the DLQ, exactly like a retryable one. **So the case for this ticket is narrower than "define
the taxonomy": does a permanent classification skip the retries, or is labelling all it is meant to
do?** Reconfirmed identical against the 2026-09-09 redeploy, RETEST-POST-1161 R1 Part 1. Still with
Lachlan as a design question first.

---

### D18. A cancel for an order with no header throws instead of no-opping

**From:** BUSY-1160 TC18 Form A.
**Status: deferred to BUSY-1162, JJ's call 2026-09-09.** Dev will roll the fix into that ticket, so it
was not raised as work on BUSY-1160. TC18 keeps its FAIL there, on the evidence, and is not carried
forward as a BUSY-1160 case.

`staging-orders-cin7-cancel-order` logs `SalesOrderCancelReceived`, then throws
`No sales order <PK> to cancel, header is missing.` uncaught when there is no `ORDER` row in
`staging-orders-v2` for the reference. SQS retries it, and within 90 seconds it tripped
`staging-orders-cin7-cancel-order-errors` from OK to ALARM on a topic that has a real subscriber.
`maxReceiveCount` 20 by a 1500s visibility timeout means it re-fires for roughly 8 hours before the
DLQ.

**Evidence already held, so the later ticket does not need to redo it.** `QASYN-08-TC18`, slice 05.
Narrowed in slice 08: **specific to the missing header, not to cancel handling.** A duplicate cancel
against an order that does have an `ORDER` row (`QASYN-09-TC15`, already cancelled) is handled
cleanly, named attribution `SalesOrderAlreadyCancelled`, no throw and no alarm. Reconfirmed unfixed by
source read of the redeployed bundle (`LastModified 2026-09-09T01:20:09Z`), RETEST-POST-1161 R1
Part 1.

**Why it belongs here rather than to the functional tickets.** The throw is not the whole finding.
There is no named failure metric on that branch at all, unlike every success path beside it, so the
only signal an operator gets is a raw stack trace and an alarm with no attribution. That is error
taxonomy and metrics, which is this ticket's scope.

**What must actually be tested.** Send a `CANCEL_ORDER` transaction, in the exact shape the poller
emits, for a reference with no `ORDER` row, and expect a logged no-op with a named metric rather than
a throw. Do not write it as "an unknown cancel does not crash the lambda", because a handled error
that still rethrows will pass that wording while leaving the alarm and the 8 hours of retries in
place. Form C, a shipment that reached the orders service but never reached SCALE, is constructible
and was never run: `BUSY-1065-sales-orders/BUSY-1160/results/04` records the `lineItemId` method for building one
deliberately.

---

### D19. Terminal-stage skips are counted nowhere at all

**From:** Q38, and BUSY-1159 TC21b's wider counter gap.
**Status: answered by Kian 2026-09-09**, "I'll investigate and fix that up in this observability work
if it's still the case." So this is a re-test condition on this ticket rather than an open question.

The poller's per-order loop returns `skip-terminal` for a `Dispatched` order and hits `continue`
before the `skippedStages` counter exists in the loop. Any other non-eligible stage returns
`skip-counted` and is counted. **MEASURED, R13:** 43 confirmed-WHOLESALE orders at `Dispatched` in one
cycle produced no counter and no log line of any kind, while 4 at `Approved` in the same fetch landed
in `skippedStages={"Approved":4}`. R14 ruled out their being counted elsewhere under another name.
Mechanism confirmed by code read, BUSY-1160 slice 08 Part 1a.

**What must actually be tested.** After the fix, a terminal-stage order appears under its own
disposition, not merely somewhere. Do not write it as "the counter is non-zero", because
`skippedStages` is already non-zero from the other stages in the same cycle and would pass that
wording while terminal orders stay invisible. Needs one poll cycle that holds at least one
`Dispatched` order, which is the common case rather than a hard fixture.

---

## For BUSY-1015 to BUSY-1017, the confirmation leg

### D6. Every consumer gated on a shipment leaving `OPEN`

**From:** BUSY-1158 TC4e, BLOCKED, and slice 04's state map.

All 70 CTC shipments on staging are `OPEN`, from a complete table scan. About twelve named consumers
read zero matches only because no CTC record has ever reached the states they subscribe to. **Absence
there is uninformative**, and it is a third case that is neither a skip nor a run: a consumer that was
never called looks exactly like a guarded one.

The stances are BUSY-1158's; the events that would demonstrate them are not. Fulfilment and collection
belong here; address update and rejection belong to BUSY-1160.

**If synthetic events are ever built to unblock this, do not start with a fulfil.**
`SHIPMENT_FULFILLED` is read by two unfiltered inventory lambdas, so a synthetic fulfil could move real
stock in staging inventory, which is the defect we suspect rather than a test of it. A synthetic
address update or rejection has a much smaller blast radius.

### D16. `Carrier` is not sent, by decision, and has to arrive from the other direction

**From:** BUSY-1159 TC1a, 2026-09-02. A decision, not a finding. No receiving ticket named yet.

MEASURED: Cin7 holds `logisticsCarrier: "Australia Post"` on SO `261115`, our order row holds
`carrier: UNASSIGNED`, and Manhattan SCALE holds nothing on shipments `261115` and `261111`. Nothing
is mapped at the poller, so the omission is total rather than conditional.

Confirmed as an intended omission pending a final decision: relayed verbally by james.johnston on
2026-09-02, with no ticket, message or meeting named as the source. **That attribution gap is itself
open**, since this decision is what turns a warehouse-visible gap from a defect into a deferral. The
working assumption is that carrier is chosen when warehouse staff pick the order and mark it ready to
ship, and then flows **back** to us, which is why it sits with the confirmation leg rather than the
outbound send.

**What must actually be tested,** once the decision lands: that a carrier chosen in the WMS at
pick/ready-to-ship reaches the order and shipment records, replacing `UNASSIGNED` with the real value,
and that whatever consumes carrier downstream (labels, manifests, customer notifications) reads the
updated value rather than the placeholder. **The wrong version of this test** is asserting that
`Carrier` is absent on the outbound shipment. That passes today, passes if the inbound leg is never
built, and proves nothing about the thing that matters.

**Also outstanding, and it is not a test.** The LLD's per-type matrix still sends `Carrier` from
`logisticsCarrier` on ECOM, WHOLESALE and RTV. That no longer describes the intended build and is a
correction for Lachlan.

### D7. Does the inventory service move stock on a CTC shipment

**From:** Q5, raised by dev himself as a silent correctness risk with no owner.

MEASURED, BUSY-1158 slice 01: two lambdas are wired to the shipping bus with no origin or company
filter, `staging-inventory-core-shipment-inventory-eda-queue-handler`
(`TRANS_SHIPMENT_ITEM_ALLOCATED`, `TRANS_SHIPMENT_REJECTED`, `SHIPMENT_FULFILLED`) and
`ShipmentItemRejectedEventWorker-queue-handler` (`TRANS_SHIPMENT_ITEM_REJECTED`). Neither has ever been
seen firing on a CTC record, because of D6.

Nothing alerts, because nothing fails. **Rejection is not this epic's**: the sender does a DELETE to
SCALE on rejection, LLD process step 12, which is BUSY-1160. Leave a pointer on both so it does not
fall between them.

### D8. Detail line identity when two lines share a style and an option code

**From:** the BUSY-1159 SCALE UI read of `WOR19261`. **Half answered 2026-09-02, still open.**

The LLD states detail line identity is the **pair** `ErpOrderLineNum` and `SKU.Item`, and that the
confirmation designs must match a pick on both. If the per-unit ECOM grain carries all the way into
SCALE, two lines expanded from one style and one option code share both values and the pair is not
unique, so a short pick could not be attributed to a line.

**The ECOM half is answered and it is the benign branch, by inference rather than direct observation:
`ErpOrderLineNum` is not readable in the SCALE UI, so the pair itself was never seen.** MEASURED 2026-09-02: `WOR19261` holds two
per-unit shipment item rows on our side, same sku and same `lineItemId`, and SCALE holds **one** line,
`PDTC25-1003B-ONE SIZE`, Total Qty 2, UM `EA`. The sender aggregates per-unit rows back into a line
carrying the quantity, so two units of one option arrive as one line and the pair stays unique.

**What is left, and it is why this stays open.** The worry case is not two units of one option, it is
one style expanded into several sizes: every size shares the style's line id, so uniqueness rests
entirely on `SKU.Item` differing. That is the wholesale and RTV per-size grain, which no SCALE read has
covered, and those families use the outbound materialiser rather than the native trickle down. **What
must actually be tested:** a wholesale order whose lines expand from one style into two or more sizes,
read in SCALE, confirming each size arrives as its own line with a distinct `SKU.Item` under a shared
`ErpOrderLineNum`. Testing it on ECOM again proves nothing, because ECOM never carries a per-size grain.

### D14. Which Cin7 date `ScheduledShipDate` maps from

**From:** BUSY-1159 TC1a, 2026-09-02. Untestable on ECOM, not untested.

The LLD maps `ScheduledShipDate` from Cin7 `estimatedDeliveryDate`. MEASURED on SO `261115`: the Cin7
API returns `createdDate` and `estimatedDeliveryDate` as the **identical** value
`2026-08-27T23:41:52Z`, and SCALE holds the same instant. Cin7 appears to set ETD equal to created date
on Shopify ecom orders, so **no ECOM order can discriminate which field the mapping reads.**

Why it matters: if the mapping actually reads `createdDate`, every shipment reaches the DC dated today,
which is warehouse visible and wrong on any order with a real future delivery estimate.

**What must actually be tested:** a wholesale order whose `estimatedDeliveryDate` differs from its
`createdDate`, then read `Scheduled Ship Date` in SCALE and see which one it equals. A test that only
confirms the field is populated passes on either mapping and proves nothing. Watch the timezone: Cin7's
UI renders Brisbane local, SCALE holds the instant it was sent, so a one-day difference in the date
part is display, not drift.

### D15. `CustomerPO` never carries a value on ecom orders

**From:** BUSY-1159 TC1a, 2026-09-02.

The LLD maps `CustomerPO` from Cin7 `customerOrderNo`. MEASURED on SO `261115`: `customerOrderNo` is
empty, so the build correctly omits the element and there is nothing to observe. SCALE renders no
`CustomerPO` field on the planned shipment screen at all; it exists only as a search filter, so even a
populated value has to be verified by searching for it rather than reading it.

**What must actually be tested:** a wholesale order carrying a real `customerOrderNo`, then a
Planned Shipment Insights search on the Customer PO filter for that value, expecting the shipment back.
A test that opens the shipment and looks for the field will report it missing on every order, including
correct ones.

---

## For the CTC reporting LLD

### D17. A confirmation write-back must not produce a second send

**From:** BUSY-1159 TC13, withdrawn 2026-09-02 and reframed. Replaces the attribute test.

**Why it was withdrawn.** TC13 tested whether `lastEmittedPayloadHash` is written. That is an LLD
attribute name, not a behaviour, it is in no acceptance criterion, and QA proposed it at plan creation
rather than deriving it from the ticket. It also cannot be exercised on BUSY-1159 at all: the
confirmation leg that would write back is unbuilt, and the eligibility gate at step 4 excludes
`Dispatched` and, on the deployed build, `Fully Picked`, both before the payload is built at step 5.

**The baseline, MEASURED by slice 13, which the receiving ticket starts from:**

* A hash **is** computed on every emit. 8 hex characters, lowercase, present on 12 of 12 references,
  distinct across all 12, carried as the trailing segment of `idempotencyId`.
* It is not retrievable as a named attribute anywhere: not on the ORDER row, not on any
  `staging-shipments` row (checked for the first time), not inside the stored `orderInfo` payload
  (opened for the first time), and not through `idempotency_index`, whose key is the whole composite
  string you would already need to know.
* **Nothing is being dropped, for the one order compared.** `261119`'s emitted event key set matches
  its persisted rows key for key, so no hash key exists there for `saveUnknown: false` to discard.
  That is a claim about the hash on that order, not a general property of the schema. Enough to say
  this is **not** the schema gap BUSY-1158 TC1b describes; not enough to say nothing is ever dropped.
* Not answered: whether the attribute appears on an update rather than a create. No re-polled fixture
  exists, all 12 orders are terminal at `Dispatched`. A negative here is weak, not clean.

**What must actually be tested,** once the confirmation leg exists: that a confirmation write-back
which leaves the order **eligible** produces no second send. The narrow live path is `Partially
Picked`, which the LLD keeps eligible: stage, tracking, shipped quantities and dispatch dates are none
of them mapped, so the payload hashes identical and only a guard stops a re-emit. `Fully Picked` and `Dispatched` are expected to be caught by the stage gate first, though **that the
gate runs before the payload is built is read from the LLD's process order and has never been measured
at runtime.** If that ordering is wrong the guard matters on those stages too, so confirm it before
sizing this case.

**The wrong version of this test** asserts that `lastEmittedPayloadHash` is present on a row. That
tests an attribute name against a design that may never be built, passes or fails for reasons
unrelated to whether an echo actually bounces, and tells nobody whether a duplicate SAVE reached SCALE.

**Impact, corrected.** Earlier docs said this becomes "high severity the moment the confirmation leg
exists". Nobody measured that and it overstates it. D3 above kept the old wording until an audit caught
it on 2026-09-02: the first version of this entry claimed the retraction had been applied everywhere,
and that was false for the entry directly above it. A duplicate emit produces an identical SAVE on the
same `ShipmentId`. Pre-wave that is a no-op overwrite. Post-wave, BUSY-1160's TC17 expects rejection to
be permanent, so the sender treats it as a failure and retries about twenty times over 8.3 hours into
the DLQ. That is alert noise and queue churn, not double-picking, and the post-wave half is INFERRED
from an unrun case. Size the case accordingly.

**Also outstanding, and it is not a test.** Whether `lastEmittedPayloadHash` is a real requirement or
stale text in the LLD is a decision for Lachlan. No amount of testing answers it.

### D9. Unmarked reporting rows in the orders service

**From:** BUSY-1158 TC6c, BLOCKED, deferred by dev and recorded as a blocker on the ticket.

The current guards cannot exclude unmarked reporting rows on the orders side. Both stream guards pass;
this is the residue. **BUSY-1158's AC7 cannot close while it stands**, which is worth knowing before
anyone tries to sign that ticket off.

---

## No owner at all

These have no receiving ticket. They are recorded so they are not lost, not because someone is
handling them.

### D10. Hold

Named as a trigger in the LLD's consumer audit table and addressed by no section of the LLD. A design
gap rather than a testing one. Sits with Lachlan.

### D11. Reallocation

The audit table gives it a skip stance, but no `TRANS_REALLOCATION` worker was found on the dispatcher
that lists the detail type. Unresolved.

### D12. Customer records in CloudWatch

Three log groups dump whole order records at INFO, including customer name, email and shipping
address. Dev's CTC split removes two of them as a side effect; nothing is planned for
`staging-shipping-v2-dc-packing-shipment-create`, which logs the record on arrival before its guard
runs, so CTC shipments reach it either way.

The timing matters more than the count: Cheap Thrills has no prior AWS footprint at all, so this
begins on the first real production order rather than having already happened. Full writeup in
`CTC-customer-data-in-cloudwatch.md`.

### D13. Pickslip generation leaves no trace

**From:** Q28. Invoked on a CTC shipment, no guard line, no downstream pickslip URL and no
`pickslipUrl` on the row. Sibling consumers on the same dispatcher log an explicit line when they skip.

Dev's 2026-07-29 comment records a guard and a regression test for this consumer, so live evidence
neither confirms nor contradicts him. **Both live samples were themselves CTC orders**, so there is no
non-CTC baseline to compare the two-line shape against. Settled by a code read or one genuine non-CTC
order's log trace, not by more CTC observation.

---

## Standing, not a test case

No script across any of these plans has been reviewed by a second person. Twelve of them now. Most
verdicts in this epic rest on one, so a pass proves the script ran as much as it proves the system
behaved. This is the largest single assumption in the evidence base and has been carried since
BUSY-1159. It is worth a dev hour.
