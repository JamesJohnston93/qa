# Result: Slice R14, wholesale record shape and the bundling mechanism

**Ticket:** BUSY-1159, BUSY-1160, epic BUSY-1065
**Verdict:** Neither of Kian's 2026-09-07 premises survives. **W1: no wholesale record shape exists
anywhere in either table's full retained history**, not just for the two references R5 checked or
the 47 R13 checked. **W2: no bundling mechanism exists anywhere** - not in the full cycle log, not
in CloudWatch's custom metric namespace, not as a new log-line type introduced by the 2026-09-03
deploy. The 43 `Dispatched` wholesale orders from R13's cycle are unaccounted for in every place
this session could think to look. Q35 stays open, for Kian's decision, materially strengthened.
Q36 stays closed by QA, now with a second corroborating negative. Q38 gets its second,
differing-kind attempt, still not settled at the code level, but the "hidden somewhere else"
explanation is now ruled out. W1c not attempted (needs a watermark write and the schedule enabled,
per the slice's own stop condition - not run without asking).

Cin7 stays read-only throughout. No order created, edited, approved or voided. No watermark write,
no schedule change - everything in this slice reads AWS state that already exists.

## W1. Does a wholesale record shape exist anywhere

### W1a. List the tables

`aws dynamodb list-tables` (MEASURED): 137 tables in the account. Grepped the full list for
`outbound`, `transfer`, `wholesale`, `rtv`, `bt-`/`-bt`: **zero matches.** No table exists anywhere
in the account under a name that suggests the LLD's outbound family. This extends R11 Gate B0's
finding (no lambda, no EventBridge rule, zero DynamoDB rows for any outbound-lifecycle status,
checked against the two known tables) to a full account-wide sweep of table names: there is nowhere
else to look by name.

Per the LLD (§9.2, re-read this session), this is expected regardless of outcome: the outbound
family was designed to "mirror the inbound family's conventions" inside `staging-orders-v2` and
`staging-shipments` themselves (`origin` carries the Cin7 reference, `OUTBOUND_ITEM#` line
convention), not as a separate table. A new table would only appear if the build had deviated from
its own design. W1b is the test that actually matters.

### W1b. Scan for the shape itself

Built `scripts/scan-order-type-distribution.sh` (new, see Scripts written). Full-table scan, header
rows only, projecting `SK`, `origin`, `orderType`, tallying distinct `orderType` values including a
`MISSING` bucket for rows with no such attribute. Same class of cost as R2's prior full scan of
`staging-shipments` (178,975 items) - not asked about, since it repeats a known-cost operation on a
same-sized or smaller table.

**`staging-orders-v2`, `SK = 'ORDER'` (MEASURED):**
```
Header rows matched: 13054 (of 125185 items scanned)
Distinct orderType values:
    12964  MISSING
       90  ECOM
```

**`staging-shipments`, `SK` begins with `'SHIPMENT#'` (MEASURED):**
```
Header rows matched: 30802 (of 179097 items scanned)
Distinct orderType values:
    30714  MISSING
       88  ECOM
```

**Across the whole retained history of both tables, `orderType` has only ever taken one value:
`ECOM`.** Not `WHOLESALE`, not `RTV`, not `STORE_PICK`, not anything else. `MISSING` is expected and
large in both tables - `orderType` is a CTC-only field per the LLD's record model (§3), so every
UNI order (the overwhelming majority of both tables) carries no such attribute at all; that bucket
says nothing about wholesale.

**This is the stronger finding the slice anticipated.** R5 and R13 measured specific references
(2, then 47) and found them absent. This measures the field's entire value space across the
complete retained history of both tables that would hold it under the LLD's own design, and finds
exactly one value ever written. **Kian's first premise - "wholesale orders land in AWS but have a
different shape or identifier" - does not survive.** No shape, under any name, in either table,
ever.

One loose thread, not chased: `staging-orders-v2` shows 90 ECOM headers against `staging-shipments`'
88 ECOM headers. A 2-order gap is consistent with very recent creates whose shipment side has not
yet materialised (trickle-down lag), not investigated further since it is off this slice's question
and small enough to be a timing artefact.

### W1c. Not attempted

Needs fresh data: a confirmed-wholesale order at `New` or `Processing`, a watermark write, and the
schedule enabled for one cycle. This is explicitly one of the slice's own stop conditions ("W1c is
needed, since it writes the watermark and enables the schedule"). Not run without asking JJ first.
Given W1b's result, W1c's marginal value has also changed: it would tell us where an
eligible-stage wholesale order lands, but W1b already tells us it has never landed anywhere yet,
which is itself the answer Kian needs for his premise. W1c stays available if JJ wants the
where-it-lands answer specifically rather than the does-it-exist-at-all answer W1b gives.

## W2. Find the bundling

### W2a. Read the whole cycle, not just the summary line

Used the exact cycle R13 measured, `2026-09-07T06:30:43.818Z`, `ordersFetched=56`
(`RequestId f624e53d-fe50-46d2-b256-ebc1928c255d`, recovered from a CloudWatch read already on hand
from same-day work on a different slice, not a fresh log pull). MEASURED: 16 log lines total in
this invocation, every one of them one of six known types (`INIT_START`/`START` boilerplate,
`Cin7WatermarkAgeMs`, `Cin7PollerCycleStart`, `Cin7SOFetched`, 9x `Pushed ... to EventBridge`,
`Cin7SOPollerCycleComplete`, `Cin7SalesOrderApiUsage`, `END`/`REPORT` boilerplate). 9 `Pushed` lines
exactly matches `created=9`, so nothing is being swallowed at the count level either.

Searched the full text of all 16 lines (safe fields only, never printing a `Pushed` line whole per
the standing PII rule) for `bundle`, `aggregate`, `group`, `batch` (all case variants) and
`Dispatched`: **zero hits for every keyword except a lowercase `group`, which is `message_group_id`
on each `Pushed` line** (the FIFO group id per LLD §3, "one key per revision, not one per change" -
this is the SQS-FIFO grouping key, not a wholesale bundle). **No line, of any kind, in this cycle
names a bundle, a group of orders, an aggregate, or any of the 43 `Dispatched` references.** Closes
W2a negative.

### W2b. Custom metrics

`aws cloudwatch list-metrics` found one relevant namespace, `staging-orders-cin7` (MEASURED), with
six metric names: `PollerCycleComplete`, `Cin7ApiRequests`, `PurchaseOrderLineSkipped`,
`SoPollerCycleComplete`, `SoPollerAlert`, `Cin7SalesOrderApiRequests`. Checked
`SoPollerCycleComplete` over the exact cycle window (06:25-06:40Z): two datapoints, `Sum=1` each,
one per cycle (06:30 and 06:32), no dimensions. **This is a bare execution counter - one data point
per completed cycle, no breakdown by disposition, no per-order or per-type dimension at all.**
`SoPollerAlert` returned zero datapoints for the whole day (consistent with no unmapped contact
group or permanent error firing). Nothing in this namespace records anything about what happens to
a skipped or dropped order. Closes W2b negative.

### W2c. Compare vocabularies across the deploy

Pulled a pre-deploy cycle, `2026-09-02T03:32:52.889Z` (`RequestId b4a53731-2c2b-43b4-9530-8832b2ccae52`,
oldest readily available stream still short of the 2026-09-03 deploy). MEASURED: same six line
types as post-deploy - the deploy introduced no new log LINE type at all, only new FIELDS inside
the existing `Cin7SOPollerCycleComplete` summary.

Pre-deploy field set, 13 (excluding `metric` itself): `ordersFetched`, `created`, `skippedCounted`,
`skippedStages`, `skippedZeroQty`, `skippedZeroUnitOrders`, `oversized`, `packingBrandMisses`,
`watermarkAdvanced`, `newWatermark`, `pageCapHit`, `pendingCreates`, `requestsThisCycle`.

Post-deploy field set, 19 (per slice 01's BUSY-1160 result, same object): all 13 above, plus
`updated`, `cancelled`, `staleSkipped`, `echoSkipped`, `skippedLocallyTerminal`, `skippedNoSizes`.

**Six new fields, all directly explained by BUSY-1160's own stated scope**: `updated`/`cancelled`
are the two new transaction dispositions this ticket adds; `echoSkipped`/`staleSkipped` are the
echo-guard and stale-replay counters the LLD's §9.1 describes; `skippedLocallyTerminal` matches the
terminal-stage gate (§9.1, "the poller also skips when the order it just read is already dispatched
or fulfilled locally"); `skippedNoSizes` is a line-shape gate. **None of the six is shaped like a
bundle, a group count, or an outbound-family counter of any kind.** This corrects R11's "6 to 12
fields" figure to 13 to 19 (a different pre-deploy sample may explain the gap; not chased further,
since the actual field names, not the count, are what answers W2c). Closes W2c negative: whatever
the deploy changed, it did not add a bundling mechanism.

One field is worth flagging on its own: `skippedLocallyTerminal` exists and is a plausible landing
spot for `Dispatched` records specifically, since `Dispatched` is the LLD's named terminal stage for
sales orders. It was `0` on both cycles in R13's window. If the 43 `Dispatched` wholesale orders
were hitting this gate, it would be nonzero. It was not, so this specific counter is ruled out as
where they went, same as everything else checked this session.

### W2d. The Approved versus Dispatched asymmetry

Since W2a, W2b and W2c all came back negative, there is no bundle to check the 43 against for
membership. **The asymmetry stands with no compensating explanation found anywhere this session
looked**: 4 confirmed-wholesale orders at `Approved` get `skippedStages={"Approved":4}`; 43
confirmed-wholesale orders at `Dispatched`, in the same cycle, get zero counter, zero log line,
zero metric, and (per W2c) do not hit the one counter (`skippedLocallyTerminal`) that would be the
obvious place for a terminal-stage record to register. **This is a sharper version of the finding
Q38 already holds**, not a new one: the 43 are not merely uncounted by `skippedStages`, they are
unaccounted for by anything measurable in AWS.

## Reads as

Both of Kian's rough premises are now measured, not just untested:

* **"Different shape or identifier"**: false, at the strength of a full-history scan of both tables
  that would hold it.
* **"Bundled together in some form"**: false, at the strength of a full-cycle log read, a
  metrics-namespace check, and a pre/post-deploy line-type diff.

The 43 `Dispatched` wholesale orders from R13's cycle, and R5's and R13's other vanished wholesale
references before them, are genuinely, silently dropped, with no compensating record anywhere this
session could find. The open question is no longer "did QA look in the wrong place" - it is
squarely a design/build question, which is what Q35 already asks and Q38 already narrows.

## Open questions register, updates

Edited `../../BUSY-1065-OPEN-QUESTIONS.md` directly, following the pattern already set there (Q36's
own text already folds in R13's findings rather than only pointing at a result file).

**Q35**: stays open, for Kian, unchanged in who owns it and what unblocks it. Added this session's
full-history scan as stronger evidence against his own "different shape" premise, specifically -
that theory is now falsified, not just unconfirmed, though the underlying question (which design is
authoritative) is still his to answer.

**Q36**: stays `Answered`/closed by QA. Added a note that this session searched independently for a
compensating record (log, metric, or new line type) and found none, which corroborates the closed
answer rather than reopening it.

**Q38**: moved from `TRIED 1` to `TRIED 2, negative`. This session's attempt (full raw log,
CloudWatch metrics namespace, pre/post-deploy line-type diff) is a genuinely different kind from
R13's (reading the cycle summary line and doing arithmetic), satisfying the register's own "TRIED 1,
not EXHAUSTED" bar for a second attempt before raising. **The attempt is a negative result**: it
rules out "hidden elsewhere in AWS" as the explanation, but does not itself say whether `Dispatched`
is a stage-name omission from a list or an entirely separate, earlier code path - that distinction
still needs the code read the register already flags as JJ's call, not QA's to take unilaterally.
Marked raisable with both attempts and this session's negative findings attached, since two
differing-kind attempts is the register's own stated bar, not a QA judgement call to withhold.

**No new open question raised.** Everything found this session narrows or corroborates Q35, Q36 and
Q38; nothing here needs a new Q number.

## Scripts written

One, `scripts/scan-order-type-distribution.sh`, **unreviewed**. Row added to `SCRIPTS.md`.

Full-table scan of an orders/shipments-shaped table's header rows (caller supplies the SK match,
`eq:VALUE` or `prefix:VALUE`), projecting only `SK`, `origin`, `orderType`, tallying distinct
`orderType` values including a `MISSING` bucket. Read only. Run twice this session (once per table)
with consistent, sane output both times (13,054 and 30,802 header rows respectively, against
125,185 and 179,097 total items scanned, both close to each table's known `ItemCount`). Does not
prove a record under a given `orderType` is well-formed or reachable by any other lookup - only that
the value exists or does not, across the table's complete current state.

**Promotion candidate.** This is the "documented lookup path" the slice's deliverable asks for if
W1b finds nothing, so a future slice does not repeat this hunt from scratch. Left in this ticket's
`scripts/` rather than promoted to the tools root this session, since it has not been reviewed and
promoting an unreviewed script raises its visibility beyond what a single Reviewed-column gap
should carry. Recommend promoting once reviewed, given the LLD's outbound family question spans
every future BUSY-1160/1161/1219 slice, not just this one.
