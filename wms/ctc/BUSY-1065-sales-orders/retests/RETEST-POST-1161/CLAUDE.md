# Re-test post BUSY-1161, session context

You are a fresh IDE session re-testing **BUSY-1158, BUSY-1159 and BUSY-1160** after a deploy that
landed on 2026-09-09, after all three tickets' QA was complete.

Condensed from `../../BUSY-1160/CLAUDE.md`. Where this file and that one differ on a path, script name,
profile or region, that one is right.

## Why you are here

Kian deployed BUSY-1161 and says he removed a wrong warehouse code. Neither statement is scoped or
dated. **A fix list from a dev is a claim, not evidence.** Slice R0 replaces it with what the
deployed infrastructure actually shows, and nothing else runs until it reports.

Every verdict on BUSY-1160 was measured against the build in
`../../BUSY-1160/results/01-deployment-gate.md`, `staging-orders-cin7-so-poller` at `LastModified
2026-09-03T01:10:45Z`.

**This has bitten once already.** Q31 was recorded CONFIRMED against a poller measured one day before
a deploy, and it took a week and an unrelated source read to catch. Do not repeat it.

## The routing contract, MEASURED, two stages

`detail-type` is the only field any rule on `staging-orders-v2-event-bus` filters on, across all 19
rules.

**Stage 1:** the poller emits `Source: "orders-cin7.cin7-so-poller.lambda"`,
`DetailType: "CREATE_TRANSACTION"`. The verb (`CREATE_ORDER`/`UPDATE_ORDER`/`CANCEL_ORDER`/
`CREATE_OUTBOUND_ORDER`) travels in `Detail.event`, **not** in `DetailType`. This routes to the
**shared** `staging-orders-v2-eda-queue-populator`, then `staging-orders-v2-create-transaction`,
which persists the `TRANSACTION` row, enforces idempotency and applies the version guard.

**Stage 2:** that handler re-emits `TRANS_*_ORDER`, routing to the cin7-specific populators and the
reconciliation handlers.

**Inject at stage 1.** A harness injecting at stage 2 skips the idempotency index and the audit trail.

## Attribution instruments

The handlers publish their own named metric-shaped log lines. Read the handler's own log group by
request id; **poller-side counters never move for an injected transaction**.

* `staging-orders-cin7-update-order`: `SalesOrderStaleRevision` on a version-guard rejection, naming
  both timestamps. `SalesOrderUpdated` on an applied revision, with `added`/`removed`/`addressChanged`.
* `staging-orders-cin7-cancel-order`: `SalesOrderCancelReceived`, `SalesOrderCancelled`,
  `SalesOrderAlreadyCancelled`. **On the failure path it publishes no named metric at all**, it throws.

## Synthetic records, if any session past R0 emits

R0 does not emit. If a later session does, these are not optional.

**Seed from reality, mutate one thing.** Every payload starts from a real persisted CTC order, never
hand-written from the LLD. BUSY-1260's C5 findings were retracted for exactly this reason.

**Mark and register before the emit.** `QASYN-<seq>-<case>`, under 25 characters, which is the SCALE
`ShipmentId` ceiling. The register is at `../../BUSY-1160/SYNTHETIC-REGISTER.md` and sequence numbers
continue from `QASYN-13-TC2RTV`. **That register and the prefix are the only thing separating
synthetic records from real ones**, since no rule on the bus filters on `source`.

**State the ceiling in every verdict.** Injection proves handler behaviour given an input the system
was sent, not that Cin7 produces it.

## Tools that already exist, do not rebuild

* `../../../tools/inspect-lambda-code.sh`, reads a deployed Lambda's own artifact and deletes it after. Not
  repository access. Has answered four questions without any.
* `../../BUSY-1160/scripts/check-cin7-order-handler-deploy.sh`, `check-bus-routing-contract.sh`,
  `check-cin7-log-recency.sh`.
* `../../BUSY-1160/scripts/emit-synthetic-revision.sh` and `emit-synthetic-outbound-order.sh`.

Read `../../BUSY-1160/SCRIPTS.md` and `../../../tools/SCRIPTS-INDEX.md` before writing anything new.

## Hard constraints

* **No em dashes or en dashes anywhere.** Hyphens only.
* **Evidence, not narration.** A clean PASS is a run count and the value observed. A FAIL is as long as it needs to be.
* **No timestamps in notes** unless the duration is itself the finding.
* **Tag every claim MEASURED, INFERRED or UNKNOWN.** Several corrections on this project came from an inference recorded as fact.
* **Cin7 is CTC's live production system.** Read only, GET only. Never create, edit, approve or void a Cin7 record. Synthetic records are created on the AWS side and never in Cin7.
* **The poller schedule should be DISABLED and the SO watermark UNSET**, and R0 confirms it rather than assuming it. **If either has moved, record it and tell JJ, do not correct it**, since a change there means someone else acted on this environment. No session in this plan needs the schedule enabled; if one seems to, it has drifted.
* `cin7-watermark.sh` defaults to `--poller item`. Every sales order call needs `--poller so`. The wrong flag rewinds the item master feed.
* **The tools are also under test.** A failing case is not a system defect until the script has been ruled out. Confirm it sent what it printed, targeted the right stage, and is not swallowing a non zero exit. Record tool fixes in `TOOL-NOTES.md`.
* **Redact before pasting.** Upstream handlers log customer name, email and delivery address in the clear. Strip them from any excerpt that goes into a ticket, page or chat.
* **API budget.** Cin7 allows about 5,000 calls a day shared with the item master and purchase order feeds. Slices 03 to 05 make no Cin7 calls at all, which is one of the reasons this plan is shaped the way it is.
* **SCALE reads are in Order Planning > Planned Shipment Insights.** Shipping Insights lists post-wave shipments only, and reading an absence off it is how BUSY-1159 briefly concluded SCALE was accepting documents without creating shipments.

## Stop and ask JJ if

* the poller schedule is enabled or the SO watermark is set. Neither should be
* a DLQ has drained, which would mean someone else acted on this environment
* an alarm is currently firing
* a function that existed at the 2026-09-03 baseline has disappeared
* a case is inconclusive twice in a row
* a script looks wrong rather than the system under test

## Data handling

**Extract fields, never print or pipe a whole record.** This has now bitten **five times in four days**: `cut -c` on a multi-line log message (R1), a raw `filter-log-events --output text` dump (R13), an API response body printed before extraction (BUSY-1158 slice 05), and twice in BUSY-1160 slice 03, where a top-level-only redactor missed a nested `addressChanges.shipping` object. The record does not have to come from a log group: a gateway response carries the same customer fields, and so does a DynamoDB row.

**A redactor must recurse.** The slice 03 failure is the instructive one: the allowlist was correct and was applied only at the top level, so a nested object walked straight past it. Verify a redactor against known-PII strings before trusting it, the way slice 03 did after the second incident (`safe-read-order.py`), rather than assuming an allowlist is doing what it looks like it does.

Four log groups carry unredacted customer data: `{stage}-orders-cin7-so-poller`, `staging-faulty-sale-worker-queue-handler`, `staging-inventory-check-order-faulty-sale`, `staging-shipping-v2-dc-packing-shipment-create`. So does the `listOrders` gateway response. See `../../CTC-customer-data-in-cloudwatch.md`.

Route every read through a named-field allowlist, and print presence and length rather than a value where the field itself is the point.
