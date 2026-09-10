# Result: Slice R1, faulty sale worker ground truth

**Ticket:** BUSY-1158, AC5
**Verdict:** TC4f FAIL, as R0 Gate D predicted, not a new finding. Q27's first half (split exists) is
confirmed false, already settled by R0. Q27's second half ("cannot execute, fields absent") is
**MEASURED false on the receive side, UNKNOWN on the write side.** The lambda and its downstream
worker both receive and log the full CTC record; nothing in either log group's own output shows a
bail. No write was observed on `staging-inventory-bus` (MEASURED, two independent windows). The
`staging-inventory-v2` table check is UNKNOWN, not a scan substitute: the table's own SKU key format
does not match Cin7's SKU format, so no key exists to query on and this is a legitimate UNKNOWN, not a
false negative. TC4c PASS. TC4d INCONCLUSIVE, same standoff as before. Audit item 8: never invoked in
either window.

**A note on how this slice was run:** one command mid-session (`cut -c1-N` applied to multi-line
CloudWatch log messages) failed to truncate correctly and printed unredacted customer data (name,
email, shipping address) to this session's own tool output before being caught. It was not written to
any file, this result, or `STATE.md`, and no content from it is reproduced anywhere below. Flagged
separately as a tooling mistake, not a system finding. All log reads after that point used a
line-length-safe Python extraction instead.

## Preconditions

MEASURED. `aws sts get-caller-identity --profile staging` returned account `398353400186`. Nothing
created, polled or invoked this session.

## TC4f, sweep the faulty sale worker for a live CTC reference

**FAIL, as expected.** Both `261115` (window 2026-08-27T23:45-00:15Z) and `WOR19261` (window
2026-08-27T11:00-11:30Z) appear in `/aws/lambda/faulty-sale-worker-queue-handler`. MEASURED: one
matching log line each (`261115` at `23:48:53.503Z`, `WOR19261` at `11:02:56.044Z`), each the full
input record, not reproduced here per the redaction rule. `REPORT` lines: `261115` invocation
`Duration 574.98 ms`, `WOR19261` invocation `Duration 319.61 ms`. Both invocations logged
`Successful invocation: TRANS_CREATE_ORDER, <id>, response: { StatusCode: 200, ... }` and
`Failed message IDs: Set(0) {}` - clean completion, no error, no skip marker, no filter of any kind.
This is the expected outcome now that R0 Gate D has established there is no filter or intermediate
lambda in front of this consumer. **Carrying AC5 as FAIL, reason is R0 Gate D, not a new finding here.**

## The behavioural half, does it execute or bail

**MEASURED: the queue-handler synchronously invokes a named downstream worker for every message, CTC
included, and gets a normal response back, not an error.** Its own env var
`WORKER_TRANS_CREATE_ORDER` resolves to
`arn:aws:lambda:ap-southeast-2:398353400186:function:staging-inventory-check-order-faulty-sale`
(read as a value, per the established practice in `../../BUSY-1158/results/01-wiring-and-guard-shape.md`
of reading `WORKER_*` env values to identify downstream targets; this is an infrastructure name, not
customer data). This is an inventory-service-owned function, one level further from the orders
service than R0 or the original investigation looked.

**Correction made mid-session, worth recording:** the downstream worker's second log line on every
invocation studied (`{'407': '8490', '490': '8490'}`) initially looked like a per-order computed
result. It is not. It is a verbatim echo of the `STORE_MAP_PARAM_NAME` SSM parameter
(`staging-faulty-stock-store-map`), confirmed by reading that parameter directly: its value is exactly
`{"490":"8490","407":"8490"}`. This line appears identically on every invocation regardless of CTC or
non-CTC content, so it is evidence the function loads its static config every time, not evidence it
completed per-order processing. This does not by itself distinguish "ran to completion" from "bailed
after loading config" - duration is the only signal available for that.

**Duration comparison, MEASURED, both CTC invocations warm (no `Init Duration` in either `REPORT`
line):**

| Reference | Origin | Duration | Warm/cold |
|---|---|---|---|
| `261115` | CTC | 275.03 ms | warm |
| `WOR19261` | CTC | 144.56 ms | warm |
| (3 non-CTC, same log group, incidental) | `US#NEWSTORE#...` | 1107.65 ms / 15.12 ms / 35.87 ms | cold / warm / warm |

Both CTC durations (144-275ms) sit clearly above the warm non-CTC baseline (15-36ms) and well below
the cold-start baseline (1107ms, which includes a 674ms `Init Duration` the two CTC calls did not
have). **INFERRED, not MEASURED as a verdict:** this is consistent with the CTC invocation doing more
work than an instant field-check bail would take, but the two log lines available (input echo, static
config echo) do not show what that work is. Tag this INFERRED, not MEASURED, and UNKNOWN for the exact
mechanism. No invocation, CTC or non-CTC, logged anything of its own beyond the input and the config
echo, so silence here is a property of this function generally, not something unique to how it treats
CTC - the slice's own instruction to not read silence as a bail applies to every invocation studied,
not just the CTC ones.

## The write side, never checked before

**Bus: MEASURED, no emission.** `staging-inventory-bus` has a catch-all logging rule
(`staging-inventory-bus-logging-rule`, pattern `{"account":["398353400186"]}`, target
`staging-inventory-bus-logs`) that logs every event on the bus regardless of type. Confirmed the
pipeline itself is live: 12 events logged in a wider ~67 minute window around `261115`'s invocation.
In the tight ~100 second window bracketing each CTC invocation specifically (`261115`:
2026-08-27T23:48:20-23:50:00Z; `WOR19261`: 2026-08-27T11:02:20-11:04:10Z), **zero events**, both
references. Nothing was emitted onto `staging-inventory-bus` for either CTC invocation.

**Table: UNKNOWN, not a scan substitute, and not a false negative dressed up as one.**
`staging-inventory-v2`'s key schema is `sku` (HASH) + `store` (RANGE). A direct `Query` (not a scan)
for `261115`'s two Cin7 SKUs (`TA26-200C-S`, `TDP-321EDD-28`, read from our own orders table via
`inspect-ctc-order.sh`, no extra Cin7 call) returned zero items for either. Before reading that as
"nothing written," a 2-item sample `Scan` of the table showed its actual key shape: `sku` values are
short numeric strings (e.g. `32800579`), `store` values are `ABS#<n>` style codes, neither of which
resembles a Cin7 SKU or a Cin7 branch id. **There is no established mapping from a Cin7 SKU or branch
id to this table's key**, so a query keyed on the Cin7 identifiers proves nothing either way - it
would return zero items whether or not a write happened, because it is very likely the wrong key
entirely. Marking this UNKNOWN rather than reporting a false "nothing written," per the slice's own
instruction that this is a legitimate outcome.

## TC4c, re-sweep against the real event wiring

**PASS.** Re-ran `read-event-wiring.sh --stage staging --profile staging`: 231 lines (was 226 in slice
01, +5, consistent with the `cancel-order` family's rule, target and event source mapping being new).
Confirmed present: rule `staging-orders-cin7-stagingorderscin7cancelordereda-HUt0zThIKlU6` on
`TRANS_CANCEL_ORDER` -> `staging-orders-cin7-cancel-order-eda-queue-populator`, and the queue ->
`staging-orders-cin7-cancel-order-eda-queue-handler` mapping, Enabled. `faulty-sale-worker-queue-handler`
still on its own rule for `TRANS_CREATE_ORDER`, unconditional, unchanged. No subscriber turned up on
these event types outside the union of slice 01's table and R0's newly-appeared BUSY-1160 names.
**Confirmation at rule/target level of what R0 Gate B already established at function level.**

## TC4d, pickslip on a live CTC shipment

**INCONCLUSIVE, same standoff as slice 01, code changed under it.**
`staging-shipping-v2-generate-pickslip` changed on 2026-09-03 (R0 Gate B). Swept both references: 2
matching log lines each, both substantial JSON dumps (~950-1080 chars), no short named guard/skip
line anywhere in either invocation's full frame (`START` through `REPORT`, 5 lines total for `261115`:
`START`, input echo, one more record echo, `END`, `REPORT`, `Duration 98.57 ms`). Checked the
`pickslipUrl` attribute directly on the shipment header row (`staging-shipments`, keyed on the order's
PK, found via `staging-orders-v2` scan-by-origin then a targeted `Query` on `staging-shipments`, not a
full scan): **absent**, on `261115`'s header. Neither a guard line nor a produced artefact. Recorded as
INCONCLUSIVE again, not upgraded, per the slice's own instruction: a real skip and an unguarded run
that produced nothing are not distinguishable from outside this log group alone.

**Incidental, useful for R6:** the shipment header row does carry a `shipmentId` field
(`staging-shipments` table), which `inspect-ctc-order.sh` does not print. `261115`'s
`shipmentId` was read (not reproduced here, not customer data, but no need to publish it either since
R4's own orders are the ones R6 actually needs); R4's result has been corrected to hand R6 the
`shipmentId` for one of its own four orders using this same method.

## Audit item 8, `staging-orders-dn-rec-eda-queue-handler`

**Stance: never invoked, both windows.** Swept for both references directly: 0 matches. Checked more
broadly for ANY invocation (`START`/`REPORT` lines, no reference filter) across both full 30-minute
windows: 0 in each. This function was not invoked at all around either reference's own processing
time. Consistent with its own detail types (`EGC_DN_MISSING`, `SHIPPING_DN_MISSING`,
`REFUND_SHIPPING_DN_MISSING`) being internally-raised "a DN failed to arrive" signals rather than
something a normal, successfully-sent CIN7_SO order lifecycle emits - both references sent cleanly
(`wmsSentAt` set), so no DN-missing condition would have fired for them. This does not test what
happens if a CTC order genuinely produces a DN-missing condition, only that neither of these two
successful sends touched it. Upgrading from "UNKNOWN not MEASURED" to **MEASURED never invoked, for
these two specific successful-send cases** - the broader question of stance under a DN-missing
condition remains open, unchanged from before.

## Fails if / Stop and ask JJ

None of the four stop conditions triggered:

* nothing was written to `staging-inventory-v2` (UNKNOWN, not confirmed either way) or emitted on
  `staging-inventory-bus` (confirmed, nothing was) for a CTC reference - no hard stop, but the table
  side remains a real gap, not a clean answer
* the lambda's own log lines do not show it "processing" a CTC order in the sense of visible business
  logic (nothing is visible beyond an input echo and a static config echo for any invocation, CTC or
  not) - so this does not contradict Q27's second half on its own; the duration differential is the
  only signal pointing that way, and it is INFERRED, not MEASURED
* TC4c: no new subscriber outside the audit table and the sweep script
* customer data exposure in this log group is unchanged (still logs full unredacted records on every
  invocation, same as previously documented in `../../CTC-customer-data-in-cloudwatch.md`)

**Recommend to JJ:** Q27's second half cannot be closed either way from this slice alone. The write
side needs one of: (a) the actual Cin7-SKU-to-inventory-v2-key mapping, from Kian or the source, so a
real key can be queried, or (b) accepting the bus-side negative plus the duration signal as sufficient
and closing Q27 as "wasted invocation, no confirmed write" with the table side named as an open gap
rather than a settled negative.

## Scripts written

None new. Used `read-event-wiring.sh` (`../../BUSY-1158/scripts/`), `inspect-ctc-order.sh` (tools root),
`aws logs filter-log-events`, `aws dynamodb query`/`scan --limit`, `aws ssm get-parameter`, `aws events
list-rules`/`list-targets-by-rule`, all ad hoc reads under the three-line/one-off threshold or reused
existing tools.

## Teardown

None. Nothing was changed.
