# BUSY-1158 scripts

Scripts written for this ticket. Reusable ones get promoted to `../../tools/` and indexed in
`../../tools/SCRIPTS-INDEX.md` instead.

**The Reviewed column is filled by a human, never by the session that wrote the script.** Until it is
filled, a passing run proves the script ran, not that the system behaved.

Read this file, `../../tools/SCRIPTS-INDEX.md` and `../BUSY-1159/SCRIPTS.md` before writing anything.
Extending an existing script beats writing a new one that overlaps it.

| Script | TC | Purpose | What it does NOT check | Read only | Reviewed by |
|---|---|---|---|---|---|
| `read-event-wiring.sh` | TC4c | Enumerates every EventBridge rule and target on the orders-v2 and shipping-v2 buses, every Lambda event source mapping in the account, both services' table streams, and any SNS topic seen as a rule target | Whether a subscriber has a CTC stance, or whether that stance is correct, or which detail-types a CTC record actually emits (that took a separate log read this session, not the script) | yes | |
| `read-transaction-payload.sh` | TC2b | Reads one shipment TRANSACTION row and prints the payload block's (`shipmentInfo`) key names plus `company`/`orderType`/`cin7Id` presence and value. Never prints `shippingAddress` or any other field's value | Whether the confirmation leg can actually consume the block, only that the fields are on it | yes | |
| `check-order-email-present.sh` | TC5b | Reads one order row and reports whether `customerEmail` is present and its length. Never the value | Whether the Segment guard actually reads this field | yes | |
| `find-warehouse-uni-order.sh` | TC3b, TC7 | Full scans `staging-shipments` for a `brand US`, `status FULFILLED`, non click-and-collect shipment header, prints the most recent one found (by `createdAt`) so the fixture reflects currently deployed code, not an old pre-ticket record | Whether the candidate is actually free of any CTC interference beyond brand/company field checks; a full scan, opportunistic, may find a different (more recent) candidate on a later run | yes | |
| `list-ctc-shipment-states.sh` | none (decides whether TC4e is runnable) | Full scans `staging-shipments` for `company = CTC` shipment headers, prints the status distribution, the `createdAt` range, and every matching row's PK/SK/status/createdAt. Copies slice 03's scan-and-paginate loop rather than writing a new one | Why a shipment is in a given state, or anything about its order/item rows | yes | |
| `find-stores-source.sh` | TC9 | Prints a lambda's env vars and its execution role's inline IAM policy statements, so a DynamoDB table or SSM parameter candidate for a "stores" source can be confirmed or ruled out by permission | Whether the function's code actually uses any resource it is permitted to read, whether a hardcoded constant exists, resource-based policies | yes | |
| `query-listorders-gateway.sh` | TC9 | Finds the API Gateway method fronting a given function ARN and calls it via `test-invoke-method` with a caller-supplied path and query string, printing only a fixed safe-field allowlist per order (never address/email/name) | Whether the gateway filters under a different query shape, anything past page one, who calls the endpoint. Invokes the target lambda for real | yes, but invokes | |

## Planned by the slices, not yet written

None currently. All scripts named in the four slices have been written.

## Shared scripts this plan depends on

| Script | Where | Note |
|---|---|---|
| `check-ctc-consumer-guards.sh` | tools root | Every carried guard verdict in `QA-DOC.md` rests on this. Extended in slice 02 (TC4b) with two new rows, purely additive, see `TOOL-NOTES.md`. Not reviewed by a second person |
| `list-transaction-rows.sh` | `../BUSY-1159/scripts/` | Lists transaction row keys for one order. Not reviewed |
| `inspect-ctc-order.sh` | tools root | Row counts for one reference |
