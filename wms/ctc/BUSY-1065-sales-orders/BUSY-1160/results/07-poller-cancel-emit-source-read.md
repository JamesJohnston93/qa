# Result: Slice 07, does the poller emit a cancel for a disappeared order

**Ticket:** BUSY-1160
**Verdict:** **Q30 closes NEGATIVE for the specific risk it named.** The currently deployed poller's
eligibility list (`ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"]`)
already matches dev's stated intent exactly, and `Fully Picked`/`Partially Picked` orders are routed
through the ordinary update path, never the cancel path. **A real, working cancellation-inference
mechanism does exist** (an already-tracked order that comes back from Cin7 classified ineligible gets
withdrawn), but it is not triggered by reaching a picked stage in the currently deployed code.

**A second finding, not asked for but necessary to report: Q31's "CONFIRMED" result is stale.** It
measured a poller build from 2026-09-02, one day before the 2026-09-03 deploy this whole plan has
been testing against. The code read this slice against is the deploy already measured in
`results/01-deployment-gate.md` (`LastModified 2026-09-03T01:10:45Z`, identical timestamp). Q31 and
Q30 both updated in `BUSY-1065-OPEN-QUESTIONS.md` with this correction. **This is not a QA verdict
reversal -- it is new evidence that the underlying bug was most likely fixed by the same deploy that
introduced the risk (BUSY-1160's own 2026-09-03 release), and the register said so was possible from
the start** ("most likely explanation... the build is in progress and staging predates the change").

Read only. No emit, no watermark write, no schedule change, no Cin7 call. Code downloaded via
`inspect-lambda-code.sh`, deleted afterward.

## What was read

`staging-orders-cin7-so-poller`, the same function slice 06 already touched for a different question
(`ShipTo`, TC1b/Q40). `ShipTo` appeared zero times in it then; this slice searched the same bundle for
`CANCEL_ORDER`, the eligibility classifier, and the per-order dispatch loop.

## The mechanism, traced end to end

**1. Every order the poller fetches from Cin7 gets classified, unconditionally:**
```
// src/cin7/eligibility/eligibility.ts
var ELIGIBLE_STAGES = ["New", "Processing", "Fully Picked", "Partially Picked"];
var TERMINAL_STAGE = "Dispatched";
function classifyEligibility({ status, stage, isLocallyDispatchedOrFulfilled }) {
  if (isLocallyDispatchedOrFulfilled || stage === TERMINAL_STAGE) {
    return "skip-terminal";
  }
  if (status?.toUpperCase() === "APPROVED" && ELIGIBLE_STAGES.includes(stage)) {
    return "eligible";
  }
  return "skip-counted";
}
```
**MEASURED: `ELIGIBLE_STAGES` includes both `Fully Picked` and `Partially Picked`, matching dev's
stated intent verbatim** ("New, Processing, Partially Picked and Fully Picked", per the register).
`Dispatched` is handled as its own `TERMINAL_STAGE`, routed to `skip-terminal`, not `skip-counted`.

**2. The per-order loop, which is where Q30's actual question lives:**
```
const eligibility = classifyEligibility({ status: order.status, stage: order.stage, isLocallyDispatchedOrFulfilled: false });
if (eligibility === "skip-terminal") continue;
const reference = normaliseReference(order.reference);
const originState = await orderRepository.findOrderStateByOriginID(reference, "CIN7_SO", "CTC");
if (eligibility === "skip-counted") {
  const stage2 = order.stage || "(absent)";
  skippedStages.set(stage2, (skippedStages.get(stage2) ?? 0) + 1);
  if (originState.state !== "present") {
    counters.skippedCounted += 1;
    continue;
  }
  await withdrawOrder(order, originState.order, counters);
  continue;
}
if (originState.state === "pending") { counters.pendingCreates += 1; continue; }
if (originState.state === "present") { await updateOrder(order, originState.order, orderModifiedDate, counters); continue; }
await createOrder(order, reference, cin7, contactGroupCache, counters);
```
**MEASURED: this settles Q30's actual mechanism.** It is not "disappearance from the query result
set" -- the order is still present in what Cin7 returns. The trigger is: this cycle's classification
comes back `skip-counted` (neither eligible nor the `Dispatched` terminal case) **and** a persisted
record already exists for it (`originState.state === "present"`). Only then is `withdrawOrder` called:
```
async function withdrawOrder(order, persisted, counters) {
  let builtCancel;
  try {
    builtCancel = buildCancelOrderCommand({ order, orderId: persisted.id, orderType: persisted.orderType, ... });
  } catch (err) {
    alert(`Cannot build CANCEL_ORDER for Cin7 SO ${order.reference} ... cancel not sent. ${err...}`);
    return;
  }
  const pushedCancel = await eventBridge.pushToEventBus(process.env.EVENT_BUS_NAME, "CREATE_TRANSACTION", builtCancel.command, "orders-cin7.cin7-so-poller.lambda");
  if (!pushedCancel) { throw new Error(`Failed to emit CANCEL_ORDER for Cin7 SO ${order.reference}.`); }
  counters.cancelled += 1;
}
```
This confirms `withdrawOrder` genuinely emits a real `CANCEL_ORDER` `CREATE_TRANSACTION`, the same
event shape the synthetic harness constructs and slice 05's TC15 proved executes unconditionally
downstream (flip plus header DELETE, no stage check).

**3. Applying this to the picked-stage scenario.** An order the poller already created, now sitting
at `Fully Picked` or `Partially Picked` with status still `APPROVED` (the ordinary case -- nothing in
a normal pick changes Cin7's approval status), classifies as `"eligible"`, not `"skip-counted"`. It
never reaches the `withdrawOrder` branch at all -- it goes to `updateOrder`, the same reconciliation
path slice 04/05 already exercised via synthetic injection. **The specific risk Q30 named does not
exist in the currently deployed poller.**

**4. `withdrawOrder` is real and does fire, for genuine loss-of-eligibility reasons.** `skip-counted`
also covers: a stage outside `ELIGIBLE_STAGES` and not `Dispatched` (an unexpected/unmapped stage
value), or `status` moving away from exactly `APPROVED` (uppercased) -- which is precisely how
CLAUDE.md describes the design intent ("cancellation is inferred from loss of eligibility... the LLD
deliberately leaves `isApproved` out of the Cin7 query because voiding may clear it and hide
cancellations"). A voided Cin7 order most plausibly loses its `Approved` status, which routes it here
-- correctly, by design, not a bug. This mechanism was not tested end-to-end this slice (it needs
either a real voided order or a synthetic build the harness does not currently construct), and is not
what Q30 was asking about.

**5. `updateOrder`'s own second-guess, for completeness.** Once inside `updateOrder`, the same
`classifyEligibility` runs again, this time with `isLocallyDispatchedOrFulfilled` set from the
*persisted* order's own local status (`FULFILLED`/`FULFILLED_B2B`). If that flips it to
`skip-terminal`, the order is silently skipped (`counters.skippedLocallyTerminal += 1`) -- **still not
a cancel**. This is an extra safety net: even if Cin7 has not yet reported `Dispatched` but our own
system already marked the order fulfilled some other way, it is treated the same as `Dispatched`,
never withdrawn.

## Reading this against the slice's three possible outcomes

Not a clean match to either of the two named outcomes, and that is reported honestly rather than
forced into one:

* Not "only from an explicit signal" -- `withdrawOrder` fires from a computed classification
  (`skip-counted` + already-present), not a literal void flag read directly off the order.
* Not "emits `CANCEL_ORDER` on disappearance from the result set" either -- the order is never
  absent from what Cin7 returns; the classification of an order Cin7 *did* return is what changes.
* **The actual finding: the mechanism the slice worried about is real, but the specific input that
  would trigger it for a picked-stage order (`Fully Picked`/`Partially Picked` being classified
  ineligible) does not occur in the currently deployed code, because that list already matches dev's
  intent.** This is closer to the first outcome in consequence (the risk does not exist today) but
  for a different reason than "no disappearance-based path exists at all" -- one does exist, it is
  just gated correctly today.

## Why Q31 needs correcting, not just Q30

`staging-orders-cin7-so-poller`'s `LastModified` here is `2026-09-03T01:10:45Z` -- **identical to the
timestamp `results/01-deployment-gate.md` already recorded for the 2026-09-03 deploy this whole plan
tests against.** BUSY-1159 slice 11, Q31's evidence, ran **2026-09-02** -- one day earlier. The
straightforward reading: Q31 measured the poller as it stood the day before BUSY-1160 shipped, and the
`ELIGIBLE_STAGES` list found in this slice's read is what shipped with it. **INFERRED, not directly
re-measured against a Cin7 order** (that would need a live poller cycle, which this plan's slices 03-06
are built to avoid), but well supported: the timestamps line up exactly, and the register's own
Q31 entry already named "the build is in progress and staging predates the change" as the leading
candidate explanation, before this slice existed. Both Q30 and Q31 updated in
`BUSY-1065-OPEN-QUESTIONS.md` with this finding.

## What this slice cannot do

This reads the artifact deployed to staging on 2026-09-03. It does not prove this exact artifact is
what ships to production, and it is not a substitute for dev confirming the fix was intentional. If
asked, the honest form is "the staging build deployed 2026-09-03 does not route a picked-stage order
to cancellation", not "picked-stage cancellation can never happen."

## Stop and ask JJ

None of the three conditions were hit: the read did not come back positive (it is a clean negative for
the named risk); the bundle downloaded and read without issue; the logic traced to its actual decision
point within this one function, nothing required chasing into another function to attribute.

## Scripts written

None new. Reused `inspect-lambda-code.sh` (built slice 06), same download-grep-delete pattern, no
changes needed.

## Data handling

No customer data read -- this function's code contains application logic and lookup tables only. Code
excerpts above are the minimum needed to support the finding (the classifier, the dispatch loop, the
withdraw function), not a full bundle dump; the downloaded package was deleted after the check.
