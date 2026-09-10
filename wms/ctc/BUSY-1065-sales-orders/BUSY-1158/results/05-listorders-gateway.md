# Result: Slice 05, the listOrders gateway

**Ticket:** BUSY-1158
**Case:** TC9
**Verdict:** PASS, with Gate A UNKNOWN and one item flagged rather than decided (Q39)

Read only throughout. No Cin7 calls, no writes anywhere, no watermark or schedule change. The
gateway itself was invoked for Gate B (not just logs), read path only, as the slice allows. Said
plainly here as required.

## Gate A, does `CTC` exist in `Stores`

**UNKNOWN, not readable from outside the repo. Ruled out by IAM permission, not assumed.**

Checked the two cheapest candidates named in the slice against `staging-orders-v2-list-orders`'s own
execution role, `find-stores-source.sh`:

* Environment variables: only `STAGE`, `ORDERS_TABLE_NAME=staging-orders-v2`,
  `AWS_NODEJS_CONNECTION_REUSE_ENABLED`. No SSM parameter name, no second table name.
* Inline IAM policy (`stagingordersv2listordersServiceRoleDefaultPolicy1FE7808B`): one DynamoDB
  statement, `Resource` scoped to `staging-orders-v2` and `staging-orders-v2/index/*` only. No
  second table, no SSM `GetParameter*` action at all, anywhere in the role.

MEASURED: this function cannot read any DynamoDB table other than its own orders table, and cannot
read SSM at all. That rules out a DynamoDB "stores" table (a `staging-stores` table does exist,
scanned it directly: 5 items, keyed `STORE#<numeric id>` with `hardware`/`distributionCentre`/`NM#`
fields, reads as physical retail terminal config, not a company/origin allowlist, and this function
has no permission to read it regardless) and rules out an SSM parameter. That leaves only "a constant
the gateway reads" as the remaining candidate the slice named, which needs the function's own code
and is not visible from outside the repository. Recorded as **UNKNOWN**, per the slice's own
instruction not to infer it from Gate B's behaviour.

## Gate B, what the gateway returns

**MEASURED. The gateway returns a live CTC order, unfiltered, alongside every other store.**

`staging-orders-v2-list-orders` is fronted by API Gateway `djluw8bw97`
(`staging-orders-v2-events-api`), `GET /orders`, `AWS_PROXY` straight to the function, API-key
required at the real endpoint. No event source mapping, no other trigger. CloudWatch logs for this
function's own log group run out in September 2025, over a year stale against `LastModified`
2026-09-03, so logs do not cover any live-code behaviour and were not usable for this gate as the
slice prefers; invoking was necessary and is disclosed here.

Used `query-listorders-gateway.sh`, which finds the API Gateway method behind a given function ARN
and calls it via `apigateway test-invoke-method` (a real invocation, bypassing the API key
requirement, not a raw HTTPS call). This is still a read path only: the function's IAM role (Gate A
check, same role) grants `Query`/`GetItem`/`Scan`/`BatchGetItem`/`GetRecords`/`GetShardIterator`/
`ConditionCheckItem`/`DescribeTable` and nothing that writes, so no request shape sent to it could
have mutated anything regardless of query string.

Called `GET /orders` first with no query string to see the shape; it 400'd with
`"status query parameter is required"`, confirming a real invocation happened and revealing the one
required parameter. Read order `262208`'s own status via `inspect-ctc-order.sh` (one of R13's nine):
`OPEN`. Called `GET /orders?status=OPEN`, page one (`pageSize=20`, `count=20`, of roughly 16,932 rows
at that status account-wide, per a direct `status_index` count, so a single reference is not
guaranteed to land on page one and pagination past it was not attempted, per the script's own limit):

```
{'id': '8235184f-14d8-5210-9f68-0df4b6bc1795', 'origin': 'CIN7_SO', 'originId': '261071',
 'store': 'CTC', 'cin7Id': 964350, 'status': 'OPEN', 'orderType': 'ECOM', 'warehouse': 'CTC-QDC'}
```

`261071` is a genuine `CIN7_SO` order, `store: CTC`, returned on the first page of an unfiltered
`status=OPEN` query, sitting in the same list as `SHOPIFY_ECOM`/`store: PS`, `SHOPIFY_ECOM`/
`store: US` and `NEWSTORE`/`store: US` rows with no store-based separation visible anywhere in the
response shape (`orders`, `nextToken`, `count`, `pageSize` are the only top-level keys; no
per-store grouping or exclusion flag). Not one of R13's nine references specifically (that batch's
own status likely moved off `OPEN` toward the delivery/dispatch stages the poller's own field
tracks, not re-checked here), but it is the same origin family, same live table, same code path,
found by the same query the slice asked to try. A second, unrelated CTC row also appeared on the
same page: a `CIN7_PO` (purchase order, not sales order) row, `store: CTC`, confirming the store
value is not filtered on this endpoint for any CTC-origin record, not just the sales order family
this ticket covers.

This matches the slice's second outcome: **CTC is present and the gateway returns the order.**
Nothing observed contradicts the LLD; the endpoint appears to apply no store-based filtering at all
(every store value seen came back mixed together on one page), which is consistent with, though does
not itself independently confirm, "CTC exists in Stores" being the true state Gate A could not read
directly.

## Downstream callers, flagged not decided

Per the slice, named the callers if the wiring shows them rather than deciding whether their
assumptions are safe. It does not show them cleanly:

* The API's usage plan (`staging-orders-v2-usage-plan`) has exactly one API key
  (`staging-orders-v2-api-key`), generically named, not per-consumer.
* No Lambda event source mapping, EventBridge target or other trigger calls this function; it is
  reached only through this one API Gateway method.
* A name-based sweep of the account's ~1,466 Lambda functions for an obvious BEFE/CX/admin caller
  (`befe`, `cx-`, `*order*admin*`, `dashboard`) found nothing that reads as a listOrders client;
  the closest hits (`staging-tp-befe-*`) are Team Portal auth/session functions, and
  `staging-orders-v2-send-cx-email` is an event consumer, not a caller of this API. A full sweep of
  every function's environment variables for this API's id or host was not attempted, out of
  proportion to this slice's budget.

**Not resolved from infrastructure alone within this session.** Logged as **Q39** in
`../BUSY-1065-OPEN-QUESTIONS.md` rather than left in this file only.

## Process note

An early Gate B call (before the script above redirected output through the safe-field extractor)
printed full order bodies, including `customerEmail` and `shippingAddress`, directly into this
session's own tool output. Caught immediately, not written to any file, and every call after that
point used `query-listorders-gateway.sh`, which prints only `id`/`origin`/`originId`/`store`/
`cin7Id`/`status`/`orderType`/`warehouse`. Same class of mistake R13 flagged for a different
log group; this one is on the gateway's own response body rather than a CloudWatch log, so it is not
an addition to `CTC-customer-data-in-cloudwatch.md`, but is the same lesson: extract fields, never
print or pipe a whole record.

## Scripts written

* `scripts/find-stores-source.sh` - Gate A. Prints a function's env vars and its execution role's
  inline policy statements, so a DynamoDB table or SSM parameter candidate can be confirmed or ruled
  out by permission rather than guessed. Does NOT read the function's code, so cannot confirm a
  hardcoded constant exists, only that nothing external is reachable; does NOT check resource-based
  policies. Read only (`iam:Get*`/`List*`, no writes). Not reviewed.
* `scripts/query-listorders-gateway.sh` - Gate B. Finds the API Gateway method fronting a given
  function ARN and calls it via `test-invoke-method` with a caller-supplied path and query string,
  printing only a fixed safe-field allowlist per order, never an address, email or name. Does NOT
  prove the gateway never filters under some other query shape not tried; does NOT paginate past
  page one; does NOT identify callers. Invokes the target lambda for real, so only safe to use
  against a function already confirmed read-only by IAM role, which this file did separately before
  relying on it. Not reviewed.

## Stop and ask JJ

None of the three stop conditions in `slices/05-listorders-gateway.md` applied: the gateway was
observable via a read-path invocation (not a write path), and the store list's unreadability was the
anticipated UNKNOWN outcome the slice itself allows, not a fresh blocker.
