# Slice R0, build identification

**Purpose:** produce the fix list QA was not given, and set every later session's scope
**Cases:** none. This slice measures the environment, it does not test behaviour
**Depends on:** nothing
**Estimated:** about 20 minutes

**Read only throughout.** No emit, no watermark write, no schedule change, no Cin7 call.

**Nothing downstream runs until this reports.** R1 onward are deliberately unwritten.

## Why every gate here matters

A dev's fix list is a claim. This slice replaces it with what the deployed infrastructure shows. Two
statements are under test, neither scoped nor dated:

* "Wholesale and RTV land in the ticket I just deployed 1161"
* "I've removed the CTC-WH in this latest deploy ... everything should flow to the one CTC-QDC
  warehouse regardless of branch"

## Gate A, what moved

Use `../../BUSY-1160/scripts/check-cin7-order-handler-deploy.sh` where it fits, and extend the function
list rather than re-deriving it. **The baseline is `../../BUSY-1160/results/01-deployment-gate.md`**,
which recorded the whole native chain at `2026-09-03T01:10:45Z` and later. Compare against that file,
do not rebuild the expected set from memory.

Report `LastModified`, `CodeSha256` and `Version` for every function in both chains:

**Native chain (BUSY-1159 and BUSY-1160's coverage):** `staging-orders-cin7-so-poller`,
`staging-orders-v2-eda-queue-populator`, `staging-orders-v2-eda-queue-handler`,
`staging-orders-cin7-update-order` and its `-eda-queue-populator`/`-handler`,
`staging-orders-cin7-cancel-order` and its pair, `staging-orders-v2-list-orders`,
`staging-shipping-manhattan-send-shipment`.

**Shared, and this is the one that matters most:** `staging-orders-v2-create-transaction`.

**Outbound chain (what BUSY-1161 owns):** `staging-orders-cin7-create-outbound-order`,
`staging-orders-cin7-outbound-orders-eda-queue-populator` and `-handler`,
`staging-shipping-inbound-outbound-order-bridge`,
`staging-shipping-inbound-outbound-bridge-eda-queue-handler`,
`staging-shipping-v2-create-transaction`, `staging-shipping-manhattan-send-outbound-shipment`.

**Consumers BUSY-1158 measured:** `staging-shipping-v2-dc-packing-shipment-create`,
`staging-shipping-v2-generate-pickslip`, `staging-faulty-sale-worker-queue-handler`,
`staging-inventory-check-order-faulty-sale`.

Also read stack last-update times where available, and note any function in the chains above that
**did not exist** at the 2026-09-03 baseline.

**Produce a changed-component table.** Function, old timestamp, new timestamp, changed yes or no.
That table is this slice's deliverable and every later session's scope.

## Gate B, the shared handler, and it outranks the fix verification

`staging-orders-v2-create-transaction` is the shared handler behind every chain in BUSY-1160's plan.
BUSY-1161's own acceptance criteria say the outbound work adds payload blocks to its **passthrough
whitelist**, its **transaction schema** and its **enum lists**, and that "writes are rejected
otherwise."

**Every BUSY-1160 case passes through this handler.** BUSY-1160 slice 08 already saw it reject a
payload on an enum value outside its list, so this is a failure mode this plan has met, not a
theoretical one.

If Gate A shows it changed, read it with `../../../tools/inspect-lambda-code.sh`:

1. The transaction schema and the enum lists. Compare against what BUSY-1160's harnesses construct.
   Do any values the native harness sends now fall outside an enum?
2. The passthrough whitelist. Did any native field stop being passed through?
3. The version guard and idempotency logic, which BUSY-1160 TC12, TC13 and TC14 all rest on.

**Reads as.** Unchanged, or changed only by addition, and BUSY-1160's native verdicts stand on this
hop. Changed in a way that alters an existing native path, and those verdicts need re-running, which
is what R1 becomes.

## Gate C, the two claims

**C1, the warehouse map.** Read `staging-orders-cin7-so-poller` for `WAREHOUSE_BY_BRANCH_ID` or
whatever replaced it. The 2026-09-09 read found `{ 51909: "CTC-QDC", 51908: "CTC-WH" }`. Kian says
`CTC-WH` is gone and everything routes to `CTC-QDC` regardless of branch.

Record what is actually there. **If the lookup is gone entirely, find what replaced it** rather than
reporting an absence. Q41 closes on this read if the code now yields `CTC-QDC` for both branches.

**C2, does the outbound pipeline still behave as measured.** BUSY-1160's TC1b, TC2 and TC3 were
proven against this pipeline on 2026-09-09, and BUSY-1161 is this pipeline, redeployed. If Gate A
shows any outbound function changed, those three verdicts are the most likely in the plan to be
stale. Say so plainly in the result; do not re-run them from this slice.

## Gate D, environment state

* Poller schedule state and SO watermark value. Last recorded: schedule **DISABLED**, watermark
  **UNSET**. **If either moved, record it, do not correct it.**
* DLQ depths on `staging-orders-v2-dlq.fifo`, `staging-shipping-manhattan-sender-dlq.fifo` and
  `staging-orders-cin7-cancel-order-dlq.fifo`. Known parked entries: roughly 8 in the Manhattan sender
  DLQ from BUSY-1160's `lineItemId` bug, and 4 in the orders DLQ. **Confirm the known ones are still
  parked and report any new arrival**, since a new deploy can drain or add to these.
* Whether the synthetic orders `QASYN-01-TC12` through `QASYN-13-TC2RTV` still exist, and whether
  `QASYN-10-TC16` is still `OPEN` with `sourceStage: "Fully Picked"`.
* Any CloudWatch alarm currently in ALARM across the chains above.

## Reads as

* **Nothing changed.** Kian's deploy did not reach staging, or reached a different account. Say so.
  Every current verdict stands and this whole plan closes with no R1. That is a complete and useful
  outcome.
* **Only outbound functions changed.** BUSY-1158 and BUSY-1159 are unaffected. BUSY-1160's native
  verdicts stand; TC1b, TC2 and TC3 need re-running. R1 is small.
* **The shared create-transaction handler changed.** Widest case. Every BUSY-1160 case is potentially
  affected and R1 has to establish whether the native path still behaves, before anything is signed.
* **The poller changed.** BUSY-1159's create-path coverage is in scope too, and Q31's and Q30's source
  reads both need redoing, since both were read off the previous artifact.

## Stop and ask JJ if

* the poller schedule is enabled or the watermark is set, since neither should be
* a DLQ has drained, which would mean someone else acted on this environment
* an alarm is currently firing
* Gate A shows a function that existed at baseline has disappeared
* the changed set is large enough that a targeted re-test is not obviously cheaper than a full re-run

## Write results to

`results/R0-build-identification.md`, then update this plan's `STATE.md` if one exists by then, and
**write the changed-component table into the result file in full**, since R1's scope is read from it
rather than re-derived.

Tag every claim MEASURED, INFERRED or UNKNOWN. Extract fields, never print a whole record.
