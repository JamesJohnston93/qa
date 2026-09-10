# Results, slice 17, TC2b, reallocation on CTC ECOM orders

**Ticket:** BUSY-1159. **Case:** TC2b. **Depends on:** `results/15-non-pass-sweep-1.md` S2, read
before this stage, checkout caveat included: that read was source only, branch
`UNI-1167-cc-reminder-master`, HEAD 2026-02-12, no git remote, predates PR #1568. It evidenced the
pre-CTC shape of `create-shipment-items.ts` and nothing about what the CTC build changed. This stage
is what settles the deployed build's behaviour.

**Cost:** read only. No fixture created, no Cin7 call, no watermark move, no schedule change. No new
script for the read itself, per the slice's instruction; the nine-reference loop was run by hand, not
wrapped in a new script, so no `SCRIPTS.md` row is needed for it.

## Step 1, baseline, load-bearing

Ran `scripts/list-transaction-rows.sh --stage staging --profile staging --reference 262208` first,
before the other eight, per the slice's instruction.

Result: `TRANSACTION rows: 1`, `TRANSACTION#1788762643235  event=CREATE_ORDER
idempotencyId=CREATE_ORDER#CTC#262208#2026-09-07T04:59:03Z#04175d3c`.

MEASURED: the partition returns rows. The read is valid. Proceeded to the other eight.

## Step 2 and 3, all nine references, count and attribute

| Reference | TRANSACTION rows | idempotencyId prefixes seen | REALLOCATION# present |
|---|---|---|---|
| 262208 | 1 | CREATE_ORDER | no |
| 262210 | 1 | CREATE_ORDER | no |
| 262211 | 1 | CREATE_ORDER | no |
| 262216 | 1 | CREATE_ORDER | no |
| 262217 | 1 | CREATE_ORDER | no |
| 262219 | 1 | CREATE_ORDER | no |
| 262221 | 1 | CREATE_ORDER | no |
| 262222 | 1 | CREATE_ORDER | no |
| 262223 | 1 | CREATE_ORDER | no |

MEASURED, all nine, via `scripts/list-transaction-rows.sh`, field allowlist only (SK, event,
idempotencyId). Every reference resolved to exactly one TRANSACTION row, every row is `CREATE_ORDER`.
No reference failed to resolve. No `REALLOCATION#` idempotencyId appeared on any of the nine. The
only prefix present across the whole set is `CREATE_ORDER#`, which is expected since these are the
R13 references and none of them has had an update or a shipment-item-creation event replayed since.

## Step 4, the artefact read

Deployed function name resolved via `aws lambda list-functions --profile staging --region
ap-southeast-2 --query "Functions[?contains(FunctionName, 'create-shipment-items')].FunctionName"`,
not guessed: `staging-shipping-v2-create-shipment-items`, last modified 2026-09-09T01:33:01Z.

Ran `inspect-lambda-code.sh --stage staging --profile staging --function
staging-shipping-v2-create-shipment-items --search "company,CTC"`, then a second pass with `--search
"REALLOCATION,isCTCOriginKey,isB2BTransfer"` to see the branch structure around the reallocation emit
rather than only the isolated `company`/`CTC` hits from the first pass.

MEASURED, deployed bundle, 2026-09-09:

* `var isCTCOriginKey = (origin) => !!origin?.startsWith(CTC_ORIGIN_KEY_PREFIX)`, with
  `CTC_ORIGIN_KEY_PREFIX = "CTC#"`.
* The branch structure in the handler is now four-way, not two:
  `if (isB2BTransfer) {...} else if (existingCtcShipment) { attachItemsToOpenShipment(...) } else if
  (isCTC) { await createCtcShipment(transaction) } else { /* REALLOCATION emit */ }`.
* `isCTC` is computed as `isCTCOriginKey(transaction.origin)` before the branch.
* The `REALLOCATION` emit (`event: "REALLOCATION"`, `idempotencyId: REALLOCATION#<txn SK
  segment>`) sits only in the final `else`, reachable only when `isB2BTransfer` is false, no open CTC
  shipment exists, and `isCTC` is also false.
* A CTC ECOM order has `origin` prefixed `CTC#CIN7_SO#...` (per LLD §3 and confirmed by this same
  script's own `Origin: CTC#CIN7_SO#262208` line), so `isCTCOriginKey` is true for it and
  `isB2BTransfer` is false for a non-IBT item. Such an order takes the `existingCtcShipment` or
  `isCTC` branch, never the trailing `else`.

This is not literally a `company` field guard, it is an origin-prefix guard reaching the same
outcome: on this deployed version, a CTC-originated order structurally cannot reach the line that
emits `REALLOCATION`. The `grep` term named in the slice (`company,CTC`) found the guard under the
`CTC` term specifically, `isCTCOriginKey`/`CTC_ORIGIN_KEY_PREFIX`, not under `company` (those hits
were all unrelated schema field definitions, e.g. address `company` fields).

## Reading the outcome against the slice's three branches

Per the slice's "Reads as" section: none of the nine references carries a `REALLOCATION#` record,
and `CTC` is present in the artefact as a real origin-based guard that structurally routes CTC orders
away from the reallocation branch. This is the second branch: **the CTC build guarded it.**

None of the "Stop and ask JJ" conditions fired:
* step 1 returned rows, not empty
* no contradiction (guard absent + no reallocation) arose, since the guard is present
* all nine references resolved
* no `REALLOCATION#` record appeared
* the function name resolved cleanly from `list-functions`, no guess needed

## Proposed verdict

**TC2b: PASS, MEASURED.** Reallocation is not triggered for a CTC ECOM order on the deployed
2026-09-09 build of `staging-shipping-v2-create-shipment-items`, by structural guard
(`isCTCOriginKey`) rather than by absence of a wired consumer, confirmed both by a DynamoDB read
across all nine R13 references (no `REALLOCATION#` audit row) and by the deployed code's branch
logic (the reallocation emit is unreachable for an `isCTC` origin outside the B2B-transfer path).

**Proposed correction, not a defect:** LLD §11.3's instruction to QA to "assert that
`create-shipment-items` is unmodified" is the clause that is wrong as written. The file has been
modified, adding the `isCTC`/`existingCtcShipment` branches and `createCtcShipment`, and that
modification is exactly what makes the "reallocation is not triggered" half of §11.3 true. The two
clauses cannot both hold, as slice 15 S2 first flagged; this stage resolves which one is correct
against the deployed build. This should be raised with Kian as a drift-table row (LLD §11.3 vs
observed deployed behaviour), for BUSY-1160's drift table or this ticket's own, whichever Kian
prefers. **Not made here**, per instruction: `QA-DOC.md` is not edited by this stage.

Proposed QA doc row change (not applied): split TC2's existing row stays as is for the stamps half
(PASS); add a TC2b row: Verdict PASS, Evidence "9/9 R13 references, no REALLOCATION# TRANSACTION
record; deployed create-shipment-items guards CTC origin via isCTCOriginKey, routes to
createCtcShipment/attachItemsToOpenShipment instead of the REALLOCATION emit", Tag MEASURED.

## Ceiling

This closes the reallocation half of TC2/TC2b for the nine R13 references and for the deployed build
as read on 2026-09-09. It does not prove no CTC order can ever reach the trailing `else`: that branch
is still reachable in principle if `isCTCOriginKey` or the upstream `origin` field is ever wrong for a
given order, which this stage did not test. It also does not prove the guard was present at every
point in the ticket's history, only that it is present now.

## Scripts written

None. Per the slice's instruction, `scripts/list-transaction-rows.sh` (existing, indexed against
TC21b in `SCRIPTS.md`, Reviewed column still "not yet") was reused as is, run by hand nine times
plus the baseline. No new script or wrapper was written, so no new `SCRIPTS.md` row.

**Caveat:** `list-transaction-rows.sh` is not yet reviewed. A clean result here shows the script ran
and printed what it found; it does not independently establish the script's own correctness beyond
what slice 09/TC21b already exercised. `inspect-lambda-code.sh` (tools root) is also not yet reviewed
under its own Reviewed column (checked against `../../SCRIPTS-INDEX.md` conventions; this stage did
not check that index's Reviewed column value, only used the script as documented in its own header).
