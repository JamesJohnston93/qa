# Result: Slice R0, build identification

**Verdict: the deploy is not a scoped outbound patch. It is a near-total redeploy of the whole
orders/shipping platform, including the shared `create-transaction` handler and both native
reconciliation handlers BUSY-1160 depends on. R1 is required, and it is not small.**

Read only throughout. No emit, no watermark write, no schedule change, no Cin7 call. All findings
below came from `lambda:get-function-configuration`, `cloudformation:describe-stacks`,
`events:list-rules`/`describe-rule`/`list-targets-by-rule`, `sqs:get-queue-attributes`,
`cloudwatch:describe-alarms`, `logs:filter-log-events`, `dynamodb:query`, and direct code reads via
`inspect-lambda-code.sh` against the redeployed artifacts.

## Gate A, what moved

### Changed-component table, in full

Baseline is `../../BUSY-1160/results/01-deployment-gate.md` (`2026-09-03T01:xx:xxZ` window) where a prior
`LastModified` was recorded; `no baseline recorded` where this plan never captured one before today.
`CodeSha256` and `Version` are this session's read, for future diffing.

| Function | Old LastModified | New LastModified | Changed | New CodeSha256 |
|---|---|---|---|---|
| `staging-orders-cin7-so-poller` | 2026-09-03T01:10:45Z | 2026-09-09T01:20:09Z | **YES** | `iI9VFACg...` |
| `staging-orders-cin7-update-order` | 2026-09-03T01:11:22.015Z | 2026-09-09T01:20:09Z | **YES** | `1aZErjR7...` |
| `staging-orders-cin7-update-order-eda-queue-populator` | 2026-09-03T01:13:09.370Z | 2026-09-03T01:13:09.370Z | no | `YIJNXmTj...` (unchanged) |
| `staging-orders-cin7-update-order-eda-queue-handler` | 2026-09-03T01:13:09.072Z | 2026-09-03T01:13:09.072Z | no | `IkMdwLSb...` (unchanged) |
| `staging-orders-cin7-cancel-order` | 2026-09-03T01:11:21.919Z | 2026-09-09T01:20:09Z | **YES** | `QcP4mIYd...` |
| `staging-orders-cin7-cancel-order-eda-queue-populator` | 2026-09-03T01:13:08.978Z | 2026-09-03T01:13:08.978Z | no | `YIJNXmTj...` (unchanged) |
| `staging-orders-cin7-cancel-order-eda-queue-handler` | 2026-09-03T01:13:09.077Z | 2026-09-03T01:13:09.077Z | no | `IkMdwLSb...` (unchanged) |
| `staging-orders-v2-list-orders` | 2026-09-03T01:09:55Z | 2026-09-09T01:19:17Z | **YES** | `hsp6s9mT...` |
| `staging-orders-v2-eda-queue-populator` | 2026-08-20T20:49:37Z | 2026-08-20T20:49:37Z | no | `YIJNXmTj...` (unchanged; not on this ticket's routing anyway, per slice 01) |
| `staging-orders-v2-eda-queue-handler` | 2026-02-23T18:08:32Z | 2026-02-23T18:08:32Z | no | `IkMdwLSb...` (unchanged) |
| `staging-shipping-manhattan-send-shipment` | no baseline recorded | 2026-09-09T01:38:35Z | **YES** (inferred: no prior baseline captured, but the `staging-shipping-manhattan` stack updated today) | `42IrTmhs...` |
| **`staging-orders-v2-create-transaction`** | no baseline recorded | 2026-09-09T01:19:17Z | **YES** | `d+dBCREY...` |
| `staging-orders-cin7-create-outbound-order` | no baseline recorded | 2026-09-09T01:20:46.671Z | yes (this is the function BUSY-1161 built; expected) | `KyjOTFFH...` |
| `staging-orders-cin7-outbound-orders-eda-queue-populator` | no baseline recorded | 2026-09-09T01:22:34.194Z | yes (expected) | `YIJNXmTj...` |
| `staging-orders-cin7-outbound-orders-eda-queue-handler` | no baseline recorded | 2026-09-09T01:22:33.564Z | yes (expected) | `IkMdwLSb...` |
| `staging-shipping-inbound-outbound-order-bridge` | no baseline recorded | 2026-09-09T01:35:09.554Z | yes (expected) | `USL0voG9...` |
| `staging-shipping-inbound-outbound-bridge-eda-queue-handler` | no baseline recorded | 2026-09-09T01:36:56.364Z | yes (expected) | `NLdvtpNB...` |
| `staging-shipping-v2-create-transaction` | no baseline recorded | 2026-09-09T01:33:06Z | yes (expected) | `/6uXSIBw...` |
| `staging-shipping-manhattan-send-outbound-shipment` | no baseline recorded | 2026-09-09T01:39:12.476Z | yes (expected) | `MxhokKVL...` |
| `staging-shipping-v2-dc-packing-shipment-create` | no baseline recorded | 2026-09-09T01:33:01Z | **YES**, unexpected under a "scoped outbound fix" reading | `zPKxndXr...` |
| `staging-shipping-v2-generate-pickslip` | 2026-09-03 (BUSY-1158 read) | 2026-09-03T01:24:32Z | no | `Fxzw+2oX...` (unchanged, not touched today) |
| `faulty-sale-worker-queue-handler` | 2026-03-04T10:13:10Z (unrelated, old) | 2026-03-04T10:13:10Z | no | unchanged |
| `staging-inventory-check-order-faulty-sale` | pre-2026-09-07 (not recorded) | 2026-09-07T03:28:13Z | **yes, but on 2026-09-07, not in today's 01:xx window** -- a separate, earlier, unaccounted-for change | `Mb0wle0s...` |

**One naming note.** `faulty-sale-worker-queue-handler` carries no `staging-` prefix, unlike every
other function in this account (MEASURED, `lambda:list-functions --query "contains(...)"`). Not a
finding, just worth knowing before a future script assumes the prefix pattern holds universally.

### The headline: this was not a scoped patch

Kian's own framing ("I removed the CTC-WH... in this latest deploy") reads as a small, targeted
change. **MEASURED, `cloudformation:describe-stacks`: every orders/shipping CloudFormation stack in
this account updated within an 01:16-01:44 UTC window today** --
`staging-orders-v2`, `staging-orders-cin7`, `staging-orders-historical-sync`, `staging-orders-dn-rec`,
`staging-orders-newstore`, `staging-orders-reporting`, `staging-ps-orders`, `staging-us-orders`,
`staging-shipping-v2`, `staging-shipping-cin7`, `staging-shipping-manhattan`, `staging-shipping-inbound`,
`staging-shipping-dn-rec`, `staging-shipping-newstore`, `staging-shipping-reporting`,
`staging-ps-shipping`, `staging-us-shipping`. The one exception in the whole orders/shipping family:
**`staging-orders-reconciliation` last updated 2026-02-21, untouched today.**

This is consistent with a full monorepo-style release, not a hand-picked warehouse-code patch. **The
fix list from a dev is a claim, and the claim understated its own blast radius.** Every function this
plan or BUSY-1160 has ever touched, across all three source tickets, redeployed today except the six
rows marked "no" above.

## Gate B, the shared handler -- read directly, not assumed

`staging-orders-v2-create-transaction` changed (Gate A). Read with `inspect-lambda-code.sh`.

**1. Schema and enum lists, compared against what the native harness sends.**

The `itemChanges` schema now has two sibling blocks where BUSY-1160 slice 08 only ever exercised one:
`added` (unchanged) and a second block, `refunded`, not previously documented in this plan.

* `itemChanges.added[].status` enum: `OPEN, FULFILLED, FULFILLED_B2B, REFUNDED, RETURNED,
  UNDELIVERABLE, DELIVERED, PENDING_SEND, PENDING_CREATE` -- **identical, value for value, to what
  BUSY-1160 slice 08 recorded before today's deploy, still no `CANCELLED`.** `emit-synthetic-
  revision.sh`'s harness fix (map a locally-`CANCELLED` status to `OPEN` before emit) is still
  necessary and still correct against this build. MEASURED, native path unaffected.
* `itemChanges.refunded[].status` enum: `OPEN, FULFILLED, FULFILLED_B2B, REFUNDED, CANCELLED,
  RETURNED, UNDELIVERABLE, DELIVERED, PENDING_SEND` -- has `CANCELLED`, drops `PENDING_CREATE`. **The
  native harness never populates `itemChanges.refunded`** (confirmed by reading
  `emit-synthetic-revision.sh` -- it only ever constructs `{"itemChanges": {"added": items}}`), so this
  block is not reachable by anything BUSY-1160 tests. Flagging its existence since it is new to this
  plan's documentation, not because it affects a native verdict.
* Top-level `event` enum still lists `UPDATE_ORDER`, `CANCEL_ORDER` alongside the new
  `CREATE_OUTBOUND_ORDER`/`UPDATE_OUTBOUND_ORDER`/`CANCEL_OUTBOUND_ORDER` trio -- **additive, not
  narrowed.**
* Idempotency: `TransactionModel.query("idempotencyId").eq(idempotencyId)`, unchanged in shape from
  what this plan's CLAUDE.md describes.

**Reads as: changed only by addition, for everything the native harness actually constructs.** No
enum value the native harness sends now falls outside its list. **BUSY-1160's TC12, TC13, TC14 verdicts
(idempotency and version-guard behaviour) stand on this specific gate**, subject to the version guard
itself being read directly below since it does not live in this function.

**2. Passthrough whitelist.** `create-transaction` builds its persisted `TRANSACTION` row from an
explicit `...event.X && {X: event.X}` spread list. Read in full: `itemChanges`, `addressChanges`,
`paymentChanges`, `onHoldChanges`, `orderInfo`, `inboundOrderInfo`/`inboundItemInfo`,
`outboundOrderInfo`/`outboundItemInfo`, plus the ecom-era fields (`shopifyRefundId`, etc.) are all
still passed through unconditionally. **No native field (`itemChanges`, `orderInfo`) stopped being
passed through.** The whitelist gained the two outbound blocks (matching BUSY-1161's own AC) and lost
nothing native.

**3. Version guard and idempotency logic.** The version guard is **not** in this function --
`create-transaction` only does the idempotency check above and an unconditional persist/re-emit. The
guard lives in the reconciliation handlers themselves (`staging-orders-cin7-update-order` and
`-cancel-order`, both of which also redeployed today -- read directly, not inferred):

```
function isCurrentRevision(header, incomingLastModified) {
  const stored = header?.lastModified;
  if (!stored) return true;
  return incomingLastModified >= stored;
}
```

**Identical logic to what this plan's CLAUDE.md documents**: passes on `>=`, not strict `>`, so an
equal-timestamp revision still applies. MEASURED against the redeployed code, unchanged. The named
attribution instruments RETEST-POST-1161's own CLAUDE.md lists (`SalesOrderStaleRevision`,
`SalesOrderUpdated`, `SalesOrderCancelReceived`, `SalesOrderCancelled`, `SalesOrderAlreadyCancelled`)
are all still present, verbatim, in the redeployed `update-order` and `cancel-order` bundles.

**Reads as: the shared handler changed, but not in a way that alters the existing native path.**
BUSY-1160's TC12, TC13, TC14 (idempotency/version-guard cases) are not invalidated by this read. This
is the "changed only by addition" branch of R0's own framework for Gate B, not the "changed in a way
that alters an existing native path" branch.

## Gate C, the two claims

**C1, the warehouse map. CONFIRMED, stronger than the claim itself.** Read
`staging-orders-cin7-so-poller` directly: `WAREHOUSE_BY_BRANCH_ID` (`{51909: "CTC-QDC", 51908:
"CTC-WH"}`, the 2026-09-09-earlier-session read) is **gone from the code entirely** -- no `"CTC-WH"`
string anywhere in the bundle. Replaced by a single constant, `var CTC_WAREHOUSE = "CTC-QDC"`, read
directly and passed as `warehouse: CTC_WAREHOUSE` unconditionally into every command builder this
function calls: `buildCreateOrderCommand`, `buildUpdateOrderCommand`, `buildCancelOrderCommand`, and
all three outbound counterparts. **This is not "both branches now map to CTC-QDC," it is "there is no
longer a branch-keyed lookup to map from."** Kian's claim confirmed by source read, not re-trusted.
**Q41 closed** in `../../BUSY-1065-OPEN-QUESTIONS.md` on this evidence.

**C2, does the outbound pipeline still behave as measured. NOT re-run, per this slice's own
instruction.** Gate A shows every function in the outbound chain changed today. BUSY-1160's TC1b, TC2
and TC3 were proven against this exact pipeline, and this is the pipeline BUSY-1161 redeployed.
**These three verdicts are the most likely in the whole plan to be stale and must be re-run in R1,
not assumed to still hold.** Not re-run from this slice, as instructed.

## Gate D, environment state

* **Poller schedule: DISABLED. SO watermark: UNSET.** MEASURED, `check-ctc-status.sh`. Matches last
  recorded state, no drift, nothing to report to JJ on this point.
* **DLQ depths**, MEASURED via `check-ctc-status.sh` and direct `sqs:get-queue-attributes`:
  * `staging-orders-v2-dlq.fifo`: **4**, matches the known-parked count exactly.
  * `staging-shipping-manhattan-sender-dlq.fifo`: **7**, matches `SYNTHETIC-REGISTER.md`'s own
    last-recorded count from slice 06 (2026-09-09), not the "roughly 8" this slice's own text
    estimated -- the register's precise figure is the one to trust.
  * `staging-orders-cin7-cancel-order-dlq.fifo`: **0**.
  * No new arrivals in any of the three against what the register already tracks.
* **One unexplained anomaly, flagged, not resolved.** `staging-shipping-manhattan-sender.fifo` shows
  `0 waiting, 1 in-flight`. `logs:filter-log-events` against
  `/aws/lambda/staging-shipping-manhattan-send-shipment` for the last hour returned **zero events**;
  the log group's last activity of any kind was 2026-09-08T13:30:35Z, over 12 hours before this read.
  Queue `VisibilityTimeout` is 1500s (25 min); a message truly stuck in-flight for over 12 hours with
  no invocation to show for it does not fit a normal processing delay. **Tagged UNKNOWN.** Two
  candidate explanations, neither confirmed: a stale `ApproximateNumberOfMessagesNotVisible` count
  (a known SQS imprecision on low-throughput queues) or a message genuinely wedged past its
  visibility window without redelivering. Not investigated further -- out of a read-only slice's
  reach, and does not block R0's own verdict -- but worth a second read before any R1 session touches
  this queue.
* **Synthetic orders.** All of `QASYN-01-TC12` through `QASYN-13-TC2RTV` still return rows on
  `origin_index` (MEASURED, row counts 1-13, all present, matches the register, nothing purged).
  **`QASYN-10-TC16`: MEASURED directly, `status: OPEN`, `sourceStage: "Fully Picked"`** -- exactly as
  the register recorded it, no drift.
* **CloudWatch alarms currently in ALARM**, filtered to the orders/shipping namespace, DynamoDB
  autoscaling `AlarmLow` noise excluded (pre-existing, unrelated to this ticket):
  * `staging-orders-cin7-so-poller-stalled` -- ALARM since **2026-09-07T07:33:40Z**. MEASURED cause:
    `SoPollerCycleComplete`, no datapoints for 2 periods. **This predates today's deploy by two days
    and is the expected consequence of the schedule being deliberately DISABLED** for slices 01-05 of
    BUSY-1160 (per that ticket's own CLAUDE.md invariant), not a new condition from today's redeploy.
    Not new, but still literally an alarm in ALARM state -- flagged per this slice's own stop
    condition, see below.
  * `staging-orders-cin7-purchase-order-poller-stalled` -- ALARM since 2026-08-27, unrelated (item
    master poller, not sales order).
  * `staging-shipping-manhattan-upload-forwarder-errors` and `-heartbeat` -- both ALARM since
    2026-09-03, i.e. the *previous* deploy, not today's. Pre-existing, unrelated to this session.
  * **No alarm across these chains newly entered ALARM as a result of today's 01:xx-01:44 UTC
    deploy.**

## Reads as

**The shared `create-transaction` handler changed, but only by addition against everything the native
harness sends -- BUSY-1160's TC12/TC13/TC14 stand.** The version guard and the named attribution
instruments, read directly in the redeployed reconciliation handlers, are byte-for-byte the same
logic this plan's CLAUDE.md already documents. **The warehouse claim (C1) is CONFIRMED and stronger
than stated -- Q41 closes.** But **the poller itself, `update-order` and `cancel-order` all redeployed
today too** (Gate A), which is wider than "wholesale and RTV land in 1161" implies, and **the entire
outbound chain changed**, so **TC1b, TC2 and TC3 are the most likely verdicts in the whole plan to be
stale and must be re-run, not assumed**. This is R0's "shared handler changed" branch by the letter of
its own framework, even though the shared-handler read itself turned out benign for the native path --
the poller and the two reconciliation handlers changing independently is what keeps this the wide
case rather than the narrow one.

**R1 needed. Scope for R1, read from this table rather than re-derived:**

1. **Re-run BUSY-1160 TC1b, TC2, TC3** against the redeployed outbound chain (Gate C2). Highest
   priority -- these are named as stale by the plan's own framework, and Q41's fix (C1) should now let
   the wholesale-branch rejection (`QASYN-12-TC2`, Q41's original finding) succeed on a fresh emit,
   which is itself worth confirming rather than assumed.
2. **Confirm the native reconciliation handlers still reconcile correctly post-redeploy**, since both
   `update-order` and `cancel-order` carry new `CodeSha256` values that this slice did not diff
   line-for-line beyond the version guard, the attribution metrics, and the enum the harness uses.
   A single fresh TC12-style revision (idempotency + version guard) and a single fresh cancel would
   close this without re-running the full slice 03-05 suite.
3. **Do not re-open Q30/Q31.** Both closed 2026-09-09 against the *pre-redeploy* poller
   (`LastModified 2026-09-03T01:10:45Z`, confirmed identical to the original baseline at the time
   slices 06/07 ran). Today's redeploy changed the poller's `CodeSha256` again. Their evidence should
   be re-confirmed against the current build before being treated as settled going forward -- flagging
   per this plan's own standing warning about exactly this failure mode, not re-opening them here
   since that is R1's job, not R0's.

## Stop and ask JJ

**One item hit, one worth a heads-up, neither blocking R0's own read:**

* **`staging-orders-cin7-so-poller-stalled` is currently in ALARM.** Explained (schedule deliberately
  disabled since 2026-09-07, matches this plan's own invariant) and not new from today's deploy, but
  this slice's own stop list says "an alarm is currently firing" without a carve-out for an explained
  one. Flagging for an explicit go-ahead before R1 rather than deciding unilaterally that "explained"
  means "ignorable."
* **The 1 in-flight Manhattan-sender message with no log activity in 12+ hours** (Gate D) is
  unexplained. Not a DLQ arrival, not a new count anywhere, but worth a second look before any R1
  session emits toward that queue.

No DLQ has drained, no function that existed at baseline has disappeared, and the changed set, while
wide, is answerable with a small, targeted R1 (three items above) rather than a full re-run -- so the
"changed set too large for a targeted re-test" stop condition was not hit.

## New open questions

**Q41 closed**, not opened -- see `../../BUSY-1065-OPEN-QUESTIONS.md`, updated this session with the
closing read and moved to Answered. No new question raised; the create-transaction `refunded` block
and the sender in-flight anomaly are recorded above as flags for R1/JJ, not epic-level questions, since
neither blocks a verdict this plan needs.

## Scripts written

Two, both ticket specific, both **unreviewed**. Rows added to `SCRIPTS.md`.

* `check-full-chain-deploy.sh` -- Gate A. Extends `../../BUSY-1160/scripts/check-cin7-order-handler-deploy.sh`'s
  eight-function native-only list to the full 22-function native/shared/outbound/consumer set this
  slice needed, and adds `CodeSha256`/`Version` alongside `LastModified`. Run once, output folded into
  the changed-component table above.
* `check-synthetic-orders-exist.sh` -- Gate D. Replaces an inline loop over 11 `QASYN-` references
  with a saved script, per this plan's own rule against un-saved loops. Run twice (once inline before
  being saved, once after, to confirm identical output), folded into Gate D's synthetic-order-existence
  check.

A passing run from either proves the script printed what AWS returned, not that the system under test
is correct. Unreviewed, per this plan's standing rule that review is deferred until the bulk of
testing is done.
