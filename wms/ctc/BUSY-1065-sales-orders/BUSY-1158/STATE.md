# BUSY-1158 test plan state

**Last updated after:** slice 05, the listOrders gateway.

| Slice | Status | Result file |
|-------|--------|-------------|
| 01 wiring and guard shape | done, TC6b PASS, TC4c FAIL against AC5 (one new gap) | `results/01-wiring-and-guard-shape.md` |
| 02 consumer stance on a live order | done, TC2b PASS, TC5b PASS, TC4b PASS on 2 confirmed consumers, 1 UNKNOWN (Q28), rest inconclusive (order never reached those lifecycle states) | `results/02-consumer-stance-live-order.md` |
| 03 Universal Store regression | done, fixture found (14,474 candidates, not the "none found" the plan expected), TC3b PASS, TC7 INCONCLUSIVE (Q29) | `results/03-universal-store-regression.md` |
| 04 CTC shipment state map | done, Outcome 2: all 70 CTC shipments on staging are `OPEN`. TC4e stays BLOCKED | `results/04-ctc-shipment-state-map.md` |
| 05 listOrders gateway | done, TC9 PASS. Gate A UNKNOWN (ruled out DynamoDB table and SSM by IAM role, leaving only a code constant, unreadable from outside the repo). Gate B MEASURED: gateway invoked read-only (logs a year stale), returns a live `CIN7_SO`/`store: CTC` order unfiltered alongside PS/US/NEWSTORE rows, matching the LLD. Downstream callers not traceable from infrastructure, flagged as Q39 | `results/05-listorders-gateway.md` |

## Open items

* Six cases carry evidence from BUSY-1159 and are not re-run here: TC1, TC2, TC3, TC4, TC6, TC8.
  Source case named per row in `QA-DOC.md`.
* Slice 01 found one confirmed unguarded consumer, `faulty-sale-worker-queue-handler`
  (`TRANS_CREATE_ORDER`, no origin filter, receives full unredacted CTC transaction records including
  customer email/address). Not in the LLD table, not one of dev's four named additions, not checked by
  `check-ctc-consumer-guards.sh`. Logged as Q27. Needs an answer before AC5 signs off clean.
* Slice 01 also flagged, but did not fully close, consumer-mapping questions for slice 02 to pick up:
  whether the event-driven `*_TO_BIGQUERY` reporting pair exists on the shipping side too (mirroring
  the already-deferred orders-side gap, TC6c), and whether `orders-dn-rec-eda-queue-handler` is a
  fifth delivery-notification-family consumer or out of scope (its own workers read as a DN-repair
  job, not a Shopify/Futura notification path). Of dev's three named-but-unmatched additions, two are
  now MEASURED rather than inferred: `orders-v2-shipment-eda-queue-handler` (workers literally named
  `staging-orders-v2-shipment-*`, confirms "orders service") and `shipping-v2-shipment-futura-eda-queue-handler`
  (every worker is `WORKER_DN_SHIPMENT_*`, confirms "Futura delivery notification listener"). Still
  open: `shipping-v2-shopify-eda-queue-handler` for "Shopify" is a functional match only, no worker
  literally named "dn"; and `orders-v2-orders-futura-eda-queue-handler` (order-side) turned out to be
  *also* fully `WORKER_DN_*`-named, so there are two DN-branded Futura dispatchers, one per bus, and
  which one dev meant (or whether both need a stance) is unresolved without the LLD table's literal
  text. Also corrected: `shipping-v2-order-created` (checked by the guard script) actually lives behind
  `shipping-v2-order-eda-queue-handler`, a distinct dispatcher on the *orders* bus, not behind
  `shipping-v2-shipment-eda-queue-handler` as first drafted. See `results/01-wiring-and-guard-shape.md`
  for the full subscriber table.
* Slice 01's sweep method (EventBridge rules, event source mappings, table streams, SNS fan-out) has a
  confirmed blind spot: direct Lambda-to-Lambda invocation from inside a queue handler's own code.
  Four of `check-ctc-consumer-guards.sh`'s seven checked functions are invoked this way and do not
  appear in any of the four paths swept, though three were confirmed by log content directly.
* TC1b and TC6c are BLOCKED and stay that way. TC1b needs repo access, TC6c is deferred by dev until
  the BigQuery reporting LLD lands. Neither is a QA action.
* Slice 03's fixture problem is resolved: a full scan of `staging-shipments` found 14,474
  `brand US`, `status FULFILLED`, warehouse-routed candidates, not the zero the plan and BUSY-1159
  both expected. Used the most recent one (created 2026-08-31, the same day as this session), so it
  reflects currently deployed code. `scripts/find-warehouse-uni-order.sh` will find one again if a
  fresher candidate is wanted later; the earlier BUSY-1159 search that found only NEWSTORE orders was
  evidently narrower than a full `brand`/`status` scan, not proof none exist.
* `check-ctc-consumer-guards.sh` has never been reviewed by a second person, and every carried guard
  verdict rests on it. Same standing item as BUSY-1159.
* No engineering QA handover page and no PR exist for this ticket, so there is no named commit behind
  what is deployed on staging. Worth one question to Kian before sign-off.
* The LLD audit table has no inventory service row. Dev flagged the inventory service as consuming
  these event types and called it a silent correctness risk with no owner. TC4c confirmed the wiring
  (Q5); actual consumption on a live CTC shipment is still unconfirmed.
* Slice 02 confirmed `dc-packing-shipment-create` and `shopify-move-fulfilment-orders` are cleanly
  guarded against a live CTC reference (`261115`), and extended `check-ctc-consumer-guards.sh` with
  both. `generate-pickslip` is genuinely UNKNOWN, not PASS or FAIL: invoked, no guard line, but also no
  confirmed side effect (no downstream pickslip-URL call, no `pickslipUrl` field on the shipment row).
  Logged as Q28. A batch of other named consumers (dc-packing address-update/delete/hold-update,
  reallocation, several Shopify/click-and-collect/CX-email ones) read 0 matches, but this order's
  shipment has sat at status OPEN for 4 days and never reached the lifecycle state those consumers
  react to, so absence there is uninformative, not a pass. See `results/02-consumer-stance-live-order.md`
  for the full breakdown, including two named items not resolved to a specific function this session
  (`TRANS_REALLOCATION`'s worker, and whether `staging-orders-v2-list-orders` needs a CTC stance at
  all, being a query API rather than an event consumer).
* Slice 03: TC3b PASS on a strong case (two units, same SKU, no `quantity` attribute on either row).
  TC7 INCONCLUSIVE for the reason the slice itself named (inference-from-`brand` and an explicit field
  agree on every Universal Store order, so a UNI fixture can't tell them apart), but with more to show
  for it than silence: `dc-packing-shipment-create`'s logs show it computing `company: 'UNIVERSAL'`
  mid-pipeline (matching `brand US`, apparently sourced from an external warehouse/ERP response) and
  then not carrying that value into the saved row. Logged as Q29. Not a defect by itself, since a UNI
  row never getting a persisted `company` may be entirely intentional.
* Slice 04: full scan of `staging-shipments` (178,868 rows, matches slice 03's count) for
  `company = CTC` shipment headers found 70, every one `status OPEN`, `createdAt` range
  `2026-08-27T05:39` to `2026-08-28T01:50`. The three BUSY-1159 DLQ references (`261070`, `261073`,
  `261089`) are confirmed among them, `OPEN` with `wmsSentAt` absent, i.e. sender failures that never
  reached Manhattan, not domain rejections, exactly as expected. **TC4e stays BLOCKED**: no CTC
  shipment on staging has ever left `OPEN`, so nothing downstream of shipment creation has a live-CTC
  verdict for anyone, not just for the reference slice 02 used. This is also why slice 02's dozen
  lifecycle-gated consumers all read 0 matches: not specific to `261115`, no CTC reference anywhere on
  staging has exercised those states.

* Slice 05: `staging-orders-v2-list-orders`'s execution role can reach only its own `staging-orders-v2`
  table, no SSM permission at all, so the `Stores` list the LLD gates it on is neither a DynamoDB table
  nor an SSM parameter, by IAM permission not by guess. It must be a code constant if it exists, which
  needs repo access. The function's own logs run out September 2025, over a year stale against its
  2026-09-03 `LastModified`, so Gate B needed a real (read-only) invocation: `GET /orders?status=OPEN`
  returns a live `CIN7_SO`/`store: CTC` order (`261071`) on page one, mixed in with PS/US/NEWSTORE rows
  with no store-based filtering visible in the response shape at all. Matches the LLD's "works once CTC
  exists in Stores" reading. Whether anything downstream expects Universal-Store-only results from this
  endpoint could not be traced from infrastructure (one generically named API key, no event source
  mapping, a name-based Lambda sweep found no obvious caller) and is logged as Q39, not decided.
* `KICKOFF.md` holds the paste-ready IDE prompt for each slice, with a `Needs` line saying what has
  to be arranged first. Regenerate it if slices are added or renumbered.

## Decision, 2026-08-31

Accepting or fulfilling a CTC shipment in SCALE is out of this pass. Checked against the sources
afterwards, and neither the ticket nor the LLD asks for it here: LLD section 11 item 6 verifies the
consumer guards with one regression test per audit-table row at the handler boundary, and section 2
puts dispatch confirmation in the downstream design. Fulfilment and collection belong to BUSY-1015 to
BUSY-1017, address update and rejection to BUSY-1160. Hold is named as a trigger in the audit table
and addressed nowhere in the LLD, which is a design gap worth raising.

TC4e and P6 stay deferred. Slice 04 is a read-only state map that records whether a usable shipment
already exists without anyone driving one. **Run: no usable shipment exists.** All 70 CTC shipments on
staging are `OPEN`. TC4e has no fixture and stays BLOCKED until either a real CTC order's shipment
progresses on its own, or a synthetic event is deliberately built (see the fulfil-vs-address-update
blast radius note below, still applicable if that ever happens).

If synthetic events are built later, do not start with a fulfil. `SHIPMENT_FULFILLED` is read by the
two unfiltered inventory lambdas, so a synthetic fulfil could move real stock in staging inventory,
which is the defect we suspect rather than a test of it. A synthetic address update or rejection is in
scope for the design and has a smaller blast radius.

## Dev answers, 2026-08-31

Kian answered Q25, Q26 and Q27 verbally and has fixes in flight. **Do not raise any of them with him
again.** They are test cases now, recorded in the epic register under "Answered verbally, verify when
the fix lands".

For this ticket that means Q27: CTC is being split out a layer up so `faulty-sale-worker-queue-handler`
never receives it, which he says is wasted invocations rather than a correctness problem since the
lambda cannot execute without fields a CTC order does not carry. **Re-test when it lands:** no CTC
reference anywhere in that log group. That also ends the customer data exposure on this path, so
confirm both in the same read. AC5 stays FAIL until then.

The audit table gap is not fixed by his change and is not his to fix. The consumer is still missing
from the LLD table that section 11 derives the regression tests from. That is Lachlan's.

## Notes for the next session

* The poller schedule was left DISABLED at the end of BUSY-1159, watermark
  `2026-08-28T01:35:45.769Z`. None of the four slices in this plan touched it; all four used an
  existing order, a full scan, or nothing at all, rather than polling.
* Orders already used under BUSY-1159 are listed in `../BUSY-1159/fixtures.md`. `261115` (used in both
  slices 01 and 02 here) and `WOR19261` are the best documented CTC references. The Universal Store
  fixture for slice 03 is `977ade0a-d17c-4c02-a575-bf622f439a96` /
  `SHIPMENT#ca3c8a5e-b202-46db-8d26-d168e2a94ebf`, or re-run `find-warehouse-uni-order.sh` for a
  fresher one. `list-ctc-shipment-states.sh` will find a non-`OPEN` CTC shipment the moment one exists,
  no need to re-derive the scan.
* All five slices written so far (01-05) are done. TC4e stays BLOCKED on a fixture nobody has driven
  yet, and by decision this pass does not drive one itself. Remaining open work is the
  manual/coordination items in `PLAN.md` and the open questions this plan raised (Q5, Q27, Q28, Q29,
  Q39) rather than another slice, unless a sixth slice gets written for a fixture that shows up later.
* `tail-logs.sh` only knows the item master lambdas. Use `aws logs` directly.
* AWS SSO for the `staging` profile expires between sessions. `aws sso login --profile staging` is a
  browser device-code flow and needs a human.

## Q29 closed out, 2026-09-01

The behavioural investigation slice did run and did write a result file
(`../investigations/kian-questions-2026-08-31/results/02-behavioural.md`, plus `FINDINGS.md`).
Any note saying otherwise is wrong.

Q29 is **narrowed and, for this ticket's purposes, finished**. On a CTC shipment the dc-packing guard
fires 0.16 seconds after the record's own fields are read, in the same 260.87 ms invocation, which is
too short for the external warehouse round trip that produced the `"company":"UNIVERSAL"` echo on the
Universal Store baseline. The skip precedes the code that sets `company`.

The consequence for this ticket: **AC8 cannot be proved from outside the repository by any order of
either company.** A UNI order cannot separate inference from an explicit field because they agree, and
a CTC order never reaches the code that would set either. This is now TC7b in the QA doc, and AC8's
verification is handed to the dc-packing unit tests rather than left open. Do not spend another
session trying to observe it.

Q27 stays open on its remaining half only: whether anything reached `staging-inventory-v2` or
`staging-inventory-bus` for those references. That could not be checked without either a full scan of
an 11.7 million item table with no usable index, or another read of a log group that dumps unredacted
records. It is not worth forcing, and Kian's split makes it moot on the CTC path once it lands.

A third log group with the customer data problem was found on that path,
`staging-inventory-check-order-faulty-sale`, and is recorded in
`../CTC-customer-data-in-cloudwatch.md`. The split covers it too, since the dispatcher invokes it.

## 2026-09-07, doc reconciled against the re-test

This plan's own four slices are unchanged. Everything since came from
`../retests/RETEST-1158-1159/`, whose results now carry this ticket's remaining AC5 and AC8 evidence:
`R0-build-identification.md`, `R1-faulty-sale-worker-ground-truth.md`,
`R11-pre-kian-confirmation.md`, `R13-fresh-data-verification.md`. Read those, not this file, for
anything about the faulty sale worker, the inventory write side, or `company` on a shipment header.

Applied to `QA-DOC.md` this pass: TC4c FAIL to PASS (unguarded consumer confirmed, no side effect
measured), TC4f NOT RUN to N/A (the split is not shipping and AC5 does not need it), TC7 and TC7b
INCONCLUSIVE to N/A (not provable outside the repository), TC1b's field list corrected because the
poller now writes `lastEmittedPayloadHash`, TC4e's shipment count 70 to 79, and a trim pass.

Doc verdict: signable with limits. Open items are repo access, the orders-side reporting deferral,
and AC8's dependency on the dc-packing unit tests.

## Slice 05, the listOrders gateway, run 2026-09-08

TC9 **PASS**, `results/05-listorders-gateway.md`. Gate A UNKNOWN: the store list is not readable from
outside the repo, and a DynamoDB table and an SSM parameter were both ruled out by the function's own
IAM role rather than assumed, leaving only a code constant. Gate B MEASURED: `GET /orders?status=OPEN`
returns a live `CIN7_SO` order with `store: CTC` unfiltered, mixed in with PS, US and NEWSTORE rows,
which matches the LLD. A `CIN7_PO` row came back on the same page, so the endpoint applies no
store-based filtering to any CTC-origin record, not just this family.

Two things worth carrying: the function's own log group runs out in September 2025 against a
2026-09-03 `LastModified`, so its logs cannot evidence current behaviour and the gate had to invoke it
read-only. And `staging-stores` exists but is physical terminal config, 5 items keyed
`STORE#<numeric id>`, not a company or origin allowlist.

Downstream callers could not be traced from infrastructure. Logged as **Q39** for the project team,
not decided here. Doc tally is now 14 PASS, 3 N/A, 3 BLOCKED, 1 INCONCLUSIVE, and the legend no longer
carries NOT RUN.

---

## 2026-09-09, read-only wrap-up note. No testing on this ticket

Written during BUSY-1160's final wrap-up because two facts affect this ticket and lived only in other
folders. Nothing here was measured today.

**TC4b survived the 2026-09-09 platform redeploy, and this file never said so.** Kian deployed
BUSY-1161 and, in doing so, redeployed the whole orders and shipping monorepo, including
`staging-shipping-v2-dc-packing-shipment-create`, which TC4b's guard lives in.
`../retests/RETEST-POST-1161/results/R1-targeted-retest.md` Part 4 read the new bundle directly and found the
guard byte-identical. The note reached `QA-DOC.md`'s TC4b row and not this log. Source read only;
no post-redeploy invocation was observed, so it is not runtime-confirmed.

**Q29 is no longer Kian's, and its closing route now exists.** Its own `EXHAUSTED` reasoning was "only
a source read settles it", and `../../tools/inspect-lambda-code.sh` now does exactly that against any
deployed function, by pulling the artefact through `aws lambda get-function`. The register was updated
on 2026-09-09 to say this is QA's to attempt here before it is asked. So the question of whether
`dc-packing-shipment-create` resolves `company` from an explicit field or from `brand`, and why the
value it computes never reaches the saved row, is now answerable without repo access. **TC7 and TC7b
are N/A on the reasoning that it is not provable from outside the repo, and that reasoning is what has
changed.**

**Two other rows rest on the same superseded assumption**, and both are candidates rather than
findings. INFERRED, not measured, and each needs checking against its own row before anything moves:

* **TC1b, BLOCKED on "no repo access".** It asks whether three fields nothing writes yet are absent
  from the row and whether their declaration is unreadable. The row half is already measured; the
  declaration half is what repo access was for.
* **TC4d, INCONCLUSIVE, and Q28 behind it.** Its closing route was also a code read, to tell a real
  guarded skip from an unguarded run, which live logs cannot separate. Q28 currently sits in the
  register's "reassigned to a later epic" bucket, so moving it back is a decision, not a given.

**Ticket state, from the files, unchanged today.** 21 case rows: 14 PASS, 3 BLOCKED, 1 INCONCLUSIVE,
3 N/A. Sign-off reads "signable with limits", and its named limits are repo access, the orders-side
reporting deferral for AC7, and AC8's dependency on the dc-packing unit tests. **The first of those
three is the one that has moved.** `slices/_deferred-lifecycle-gated-consumers.md` has no result file
and is parked by its own filename, not unrun work.
