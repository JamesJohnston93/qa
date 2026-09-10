# Testing scripts index

Every script in this folder tree, what it is for, and whether it has been reviewed. **Read this before writing a new script.** Most of what a test needs already exists, and rebuilding it from scratch costs time, costs tokens, and quietly changes what gets asserted.

Two locations, one rule:

* **Reusable across tickets** goes in the tools root, `~/Desktop/testing-tools-so/`, and gets a row here.
* **Specific to one ticket** goes in that ticket's `test-plans/BUSY-xxxx/scripts/`, and gets a row in that plan's own `SCRIPTS.md`.

If a ticket script gets used by a second ticket, promote it to the root and move its row here.

## Reviewed

Reviewed means a human has read it and agrees it asserts what it claims. Until then a passing run proves the script ran, not that the system is correct.

| Script | Purpose | Flow | Read only | Reviewed by |
|---|---|---|---|---|
| `find-cin7-sales-order.sh` | Lists recent CTC ecommerce orders, resolves contact groups | SO | yes | Kian |
| `survey-cin7-orders.sh` | Population distributions, stages, carriers, project names, taxStatus, stage x projectName, stage x branchId | SO | yes | Kian, taxStatus counter added 2026-08-31 (investigation `kian-questions-2026-08-31` Q26); stage x projectName and stage x branchId cross-tabs added 2026-09-02 for BUSY-1159 TC14 (`results/14-ecom-picked-stage-population.md`), purely additive, not yet reviewed |
| `inspect-ctc-order.sh` | Reads the whole chain for one order, order to shipment items | SO | yes | Kian |
| `check-ctc-status.sh` | Pipeline status, queue and dead letter depths, watermark, alarms | SO | yes | Kian |
| `check-ctc-consumer-guards.sh` | Walks every consumer and reports ran or skipped | SO | yes | Kian |
| `cin7-watermark.sh` | Views or sets a poller watermark. Defaults to `--poller item` | all | no, writes SSM | Kian |
| `invoke-so-poller.sh` | One shot manual poller run, diagnosis only | SO | no, invokes | Kian |
| `invoke-shipment-sender.sh` | One shot manual sender run, diagnosis only | SO | no, invokes | Kian |
| `clean-ctc-order.sh` | Destructive cleanup, hard locked to `kian-dev` | SO | no, deletes | Kian |
| `tail-logs.sh` | Tails item master lambdas only, no sales order option | item | yes | Kian |
| `find-cin7-item.sh`, `find-parent-product.sh`, `find-product-variants.sh`, `find-test-variant.sh`, `check-option-modified-date.sh`, `check-status.sh`, `preview-cin7-sync.sh`, `trigger-netsuite-update.sh`, `trigger-test-change.sh` | Item master era tooling, BUSY-1067 | item | mixed | Kian |

## Written by QA

Anything QA or Claude writes lands here once it is reusable. Empty until the first one is promoted.

| Script | Purpose | Flow | Read only | Written for | Reviewed by |
|---|---|---|---|---|---|
| `inspect-lambda-code.sh` | Downloads a deployed Lambda's own code package via `aws lambda get-function` and greps it for one or more search terms, printing context; deletes the code afterward. Not monorepo access -- inspects the artifact already running, under existing credentials | all | yes | BUSY-1160 slice 06 (TC1b / Q40: where the 25-char `ShipTo` truncation lives) | not yet |
