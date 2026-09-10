# Result: Slice R13, fresh data verification

**Ticket:** BUSY-1158, BUSY-1159, BUSY-1160, epic BUSY-1065
**Verdict:** One live cycle against fresh Cin7 data, watermark moved forward and schedule enabled
for a bounded window, both undone at the end. K1 (the CTC split) is now CLOSED behaviourally, not
just from code metadata: an unconditional `TRANS_CREATE_ORDER` rule fired for all 9 fresh CTC
orders end to end, no filter anywhere in the chain. Q36 (counter leakage) gets its largest and
cleanest measurement yet: **residual 36 of 56 fetched orders**, all traced to a batch of 43
confirmed-WHOLESALE orders sitting at `Dispatched`. The wholesale silent-drop (R5) reproduces on
fresh data and **extends to a stage never tested before** (`Dispatched`, not just `Fully
Picked`/`Partially Picked`), at 40x the scale of R5's single order. **New, sharper split inside
Q31 part 1**: `skippedStages` correctly counted 4 wholesale orders at `Approved`, but the 43 at
`Dispatched` got no counter and no log line at all - the drop is stage-name-specific, not a
blanket counter failure. The wholesale/ineligible-stage confound (Q35) still did not separate:
the one order that looked like a wholesale-at-eligible-stage candidate (`#262210`, company name
proxy) turned out genuinely ECOM on the poller's own contact-group resolution. K11 (`lastEmittedPayloadHash`
persistence) reverses TC13's prior negative: the field is now present on the stored order row,
value matching the emitted payload exactly, for both a create and an echoed order. K6 reconfirmed.
K4 reconfirmed twice (two independent cycles). TC1/TC1b/TC8/TC16/TC11 all PASS on fresh data.
TC21 PASS (no duplicate write on the second sighting); TC21b still INCONCLUSIVE (suppression
happened but no guard was named in the log, same standing verdict as before, now on fresh data).
**One process mistake this session**: a raw log dump briefly printed unredacted customer PII to
this session's own tool output (not written to any file), from a log group
(`{stage}-orders-cin7-so-poller`) not previously named in `CTC-customer-data-in-cloudwatch.md` -
corrected immediately, and that log group's exposure is itself now a new flagged finding.

## Rules followed

Cin7: GET only throughout, no exceptions - every call in this session used `find-cin7-sales-order.sh`
(`--with-contact`, read only) or the two-hourly window-count script, both pre-existing and
unmodified. Watermark moved back 1h35m (well inside the 24h ceiling). Schedule enabled 06:30:23Z
to 06:33:34Z (3m11s), then disabled. Watermark unset (not restored to the old value) at teardown,
per JJ's instruction.

## S0. Pre-flight

1. **Watermark/schedule, before starting**: `2026-08-28T01:35:45.769Z` / `DISABLED`. Matches
   expectation exactly (`check-ctc-status.sh`). Two pre-existing findings noted, neither caused by
   this session: `staging-orders-v2-dlq.fifo` held 2 dead-lettered messages (shared queue, other
   traffic) and the `staging-orders-cin7-so-poller-stalled` alarm was in `ALARM` (expected while the
   schedule is disabled). Both unchanged at teardown.
2. **`faulty-sale-worker-queue-handler`**: `LastModified` unchanged since 2026-03-04
   (`read-deployed-builds.sh`), same `CodeSha256` as R0 measured. EventBridge rule
   `staging-inventory-faulty--faultysaleworkerfaultysal-O9HvnJv0c14A`, `EventPattern`
   `{"detail-type":["TRANS_CREATE_ORDER"]}` - still unconditional, no `origin`/`company` filter.
   **K1 prediction written down before S2**: since no filter exists, S2 should show every fresh CTC
   `TRANS_CREATE_ORDER` reaching this consumer, not zero.
3. **New-lambda search**: the rule's target is `faulty-sale-worker-queue-populator`
   (Lambda, not a direct-to-SQS target), which forwards to the
   `faulty-sale-worker-queue.fifo` SQS queue the handler consumes from. This function was not in
   R0's tracked list, so its prior state is unknown to this plan. Its `LastModified` is
   **2026-09-07T03:28:13Z, hours before this session** - but so is
   `staging-inventory-check-order-faulty-sale`'s, and so is that of roughly 30 unrelated
   `staging-inventory-core-*` functions (`GetStock*`, `newstore-*`, stock-adjustment workers) all
   stamped within the same 90-second window. **Reading: a routine whole-service redeploy of the
   inventory-core stack, not a targeted change to either function** - confirmed by breadth, not by
   reading either function's code (not attempted, same standing question as R11's Gate A code-read
   decision, not re-raised here since the behavioural test below settles K1 either way).
4. **Stage 5 Manhattan sender DLQ**: 0 waiting, 0 in-flight, before and after this session. No
   naturally-occurring rejection landed since 2026-09-04. **K5 stays open** - TC9/TC15 still cannot
   run off an existing DLQ entry.
5. **`staging-shipments` GSI list**: unchanged from R11, 3 days later - same 7 GSIs
   (`allocated_store_index`, `customer_index`, `idempotency_index`, `status_index`,
   `pending_action_index`, `shipment_index`, `event_index`), still no `origin_index`. **Q37
   unchanged.**

## S1. Window selection

Counted over `[candidate watermark - 5 min, now]` per the poller's own lookback, using
`gate-b-window-check.sh` (unmodified, reused as designed).

| Window | Count | Composition |
|---|---|---|
| 30 min | 7 | 3 ECOM (`Processing`), 4 wholesale-labelled (`Approved`) |
| 60 min | 52 | Same as 30 min, plus a 44-order dispatch-batch signature (wholesale, `Dispatched`, one minute, 05:47:19-20Z) |
| 24 hours (reported, not run) | 523 | 483 `Dispatched`, 21 `Processing`, 14 `New`, 4 `Approved`, 1 `Fraud Warning`. 24h contained several genuine wholesale-at-`New`/`Processing` candidates (13x `THE ICONIC` at `New`, several `City Beach`/`Universal (QLD)` at `Processing`), all 1-5 hours stale relative to the 24h boundary |

**Chosen window: `modifiedSince=2026-09-07T04:54:02.000Z` to now (~96 minutes), 56 orders.**
Smaller than 24h by 9x, and the smallest window that still contained the one candidate that looked
like it could separate R5's wholesale/stage confound: `#262210`, wholesale by company-name proxy,
at `Processing` (eligible). Reaching it necessarily also swept in the 44-order dispatch batch
(unavoidable: the batch sits between `#262210`'s timestamp and now, so any window wide enough for
one is wide enough for both) - accepted because the batch orders sit at `Dispatched`, an ineligible
stage, so they were never going to be **created** regardless of window width; they only add to what
gets **measured**, which is exactly what Q31/Q36 needed.

**Frozen reference list (56), by category, recorded before enabling anything:**

* 8 ECOM, `Processing`: `#262208, #262211, #262216, #262217, #262219, #262221, #262222, #262223`
* 1 labelled-wholesale-by-proxy, `Processing`: `#262210` (company `Noosa Post Office`)
* 4 wholesale, `Approved`: `1066841Sep26, 1066951Sep26, 982409Aug26, 982389Aug26`
* 43 wholesale, `Dispatched`: the `05:47:19-20Z` batch (`GOPE31-2447..2450`, `974712Aug26` x6,
  `980523Aug26` x7, `MAPY004560-9377779363539`, `THE ICONIC`, plus 27 more named-company references,
  full list in the frozen capture)

No repeated option code, no reference over 25 characters, and no known-SCALE-absent SKU was found
in this window on inspection (not deeply searched beyond what the window listing itself showed;
TC6/TC18/TC9/TC15 stay opportunistic per CLAUDE.md, not chased further this session - cheap-first).

## S2. Cycle 1, the create cycle

Watermark set to `2026-09-07T04:59:02.000Z` (1s below the oldest chosen order, `#262208`).
Schedule enabled `06:30:23Z`. One cycle ran at `06:30:43.818Z`, `ordersFetched=56` (exact match to
the frozen count - no drift between freeze and cycle). Disabled `06:33:34Z`.

```
Cin7PollerCycleStart  watermark=2026-09-07T04:59:02.000Z  modifiedSince=2026-09-07T04:54:02.000Z  modifiedBefore=2026-09-07T06:30:34.409Z
Cin7SOPollerCycleComplete  ordersFetched=56 created=9 updated=0 cancelled=0 staleSkipped=0 echoSkipped=0
  skippedLocallyTerminal=0 skippedCounted=4 skippedZeroUnitOrders=0 pendingCreates=0 oversized=0
  skippedZeroQty=3 skippedNoSizes=0 packingBrandMisses=0 skippedStages={"Approved":4}
```

**K4, the 5-minute lookback**: confirmed directly from the log line, not inferred - `modifiedSince`
is exactly 5 minutes before `watermark` (`04:54:02` vs `04:59:02`). Reconfirmed on the second cycle
below too (`06:25:34.409` vs `06:30:34.409`).

### Q36, does the residual reproduce, and by how much

`reconcile-poller-cycles.sh` (unmodified) against this one cycle: **`ordersFetched=56, summed=20,
residual=36`.** The largest residual on any narrow, live-schedule cycle measured across this whole
retest (R5's own cycle: residual 1; R11's full 582-cycle sweep: largest non-backfill residual
before today was single digits). **Full accounting, every one of the 56 references named:**

* **9 created** = exactly the 8 ECOM `Processing` orders + `#262210`. Confirmed by origin, not
  inferred: every one of the 9 `Pushed ... to EventBridge` lines carries `"orderType":"ECOM"` in
  its own payload (`audit-poller-cycle-emits.sh`, built this session - see Scripts section).
  **`#262210` is genuinely ECOM**, not wholesale - the company name on the Cin7 record was
  incidental (a business name in the shipping-company field of an otherwise ordinary
  `Retail - Ecomm` order), not a contact-group signal. Confound not separated this cycle.
* **4 in `skippedStages={"Approved":4}`** = the 4 named-company orders at `Approved`. Spot-checked
  one (`982409Aug26`) via `find-cin7-sales-order.sh --with-contact`: contact group
  `Retailer - Domestic` -> confirmed genuinely WHOLESALE.
* **43 wholesale at `Dispatched`, zero counters, zero log lines** = `skippedCounted(4) +
  skippedZeroQty(3) + residual(36)` = 43 exactly. No per-order log line exists for any of these
  three counters (aggregate only), so the specific split between them and the residual could not be
  attributed to individual references - but the arithmetic closes exactly against the pool of 43,
  with the residual (36) as the dominant share. Spot-checked one (`GOPE31-2450`) via `--with-contact`:
  contact group `Retailer - Majors` -> confirmed genuinely WHOLESALE.

**This is the same wholesale silent-drop R5 found (residual 1, `Fully Picked`), reproduced on fresh
data at ~40x the scale, and for the first time at a stage R5 never tested: `Dispatched`.** Both the
`Approved` and `Dispatched` groups are confirmed genuinely wholesale by contact-group resolution
(not the company-name proxy alone) - so the asymmetry between them is real, not a fixture-labelling
artefact: **`skippedStages` counts a wholesale order at `Approved` correctly, but a wholesale order
at `Dispatched` gets no counter and no log line of any kind.** This sharpens Q31 part 1 past "does
the counter fire post-deploy" (yes, it does - `{"Approved":4}` is live evidence) to a narrower,
new question: **why does the same order type get counted at one ineligible stage name and not
another.** Recorded as **Q38** below.

### Q35, the wholesale destination test

Did not separate this cycle - no confirmed-wholesale order sat at an eligible stage
(`New`/`Processing`/`Partially Picked`/`Fully Picked`) in the fetched window; `#262210` was the only
candidate and it resolved to ECOM. The 43 `Dispatched` and 4 `Approved` wholesale orders are all at
ineligible stages, so this cycle cannot say where an eligible-stage wholesale order would land -
same standing gap R10/R11 already established is hard to reach. Not closed, not worsened.

### K1, does the split exist - CLOSED behaviourally

Traced the full chain for all 9 created orders, safe fields only:
* `faulty-sale-worker-queue-populator`: 9 `Received event` invocations (one per fresh order),
  9 matching SQS `SendMessage` calls. No filtering observed - every event that arrived was forwarded.
* `faulty-sale-worker-queue-handler`: 4 Lambda invocations (SQS batches, up to 6 records per
  invocation), covering all 9 origins between them (`#262208` alone; `#262210, #262221, #262217,
  #262216, #262223, #262222` in one batch; `#262219` alone; `#262211` alone). **9 of 9, zero
  dropped.**
* `staging-inventory-check-order-faulty-sale`: 9 invocations (matches). Durations 1.88-75.99ms.

**No filter anywhere in the chain, on fresh data, for the first time verified end to end rather than
inferred from code metadata.** The S0 prediction ("no filter in config -> S2 should show every
fresh CTC invocation reaching this consumer") held. K1 is now CLOSED: the split described in Kian's
2026-08-31 answer has not landed, MEASURED, not INFERRED.

### K11, `lastEmittedPayloadHash` persistence - reverses TC13

Queried `staging-orders-v2` (`origin_index`, attribute names only, then the one hash value - not
PII) for `#262208`'s `ORDER` row: `lastEmittedPayloadHash` **present**, value `91daeb25`, exactly
matching the value logged in the `Pushed` event's `orderInfo`. Same check on `#262219` (an echoed
order, see S3): also present, value `89019207`, matching its own original emit, unchanged by the
echo. **TC13 previously measured this field absent after a create. On the current build it is
present, matches the emitted value, and survives an echo untouched. K11 CLOSED, reversed from
negative to positive.**

### K6, `company` field - reconfirmed

CTC shipment header (`#262210`, via `inspect-ctc-order.sh`): `company: CTC`. A fresh UNI shipment
header (`find-warehouse-uni-order.sh`, most recent `brand=US`/`FULFILLED` candidate,
`13e90817-32d9-43bf-80f0-a0d78a6101c8`): `company` attribute **absent from the row entirely**
(`aws dynamodb get-item` on that exact key returns null for `.company`). Matches Q29's prior
measurement exactly, now on fresh data both sides.

### PII field-name presence - reconfirmed live, with a new location found

`faulty-sale-worker-queue-handler`'s 4 invocations: all name fields (`customerEmail`, `firstName`,
`lastName`, `street1`, `city`, `postalCode`) present, checked by field-name search only, values
never extracted. Confirms R11 Gate D3's finding survives whatever was deployed since, on today's
build specifically.

**New finding: `staging-inventory-check-order-faulty-sale`'s own echo appears to be gone.** All 9
of its invocations produced exactly `START`/`END`/`REPORT` (plus 3 `INIT_START` for cold starts) -
**zero `INFO` lines, where R1 and R11 Gate D1/D3 both found and relied on an input echo containing
these same field names.** This function's `LastModified` is today (`2026-09-07T03:28:13Z`, the same
broad redeploy noted in S0.3). Read as: **this specific log group may no longer emit the echo**,
which would mean one fewer place logging PII in the clear - genuinely good news if it holds, though
unverified whether it's a deliberate fix or an artefact of these particular 9 orders' code path.
Not chased further (would need reading the function's code, same standing decision as the SO
poller's - left to JJ, not repeated here since it doesn't change any open Kian question).

**New finding, this session's own process note (see below): `/aws/lambda/{stage}-orders-cin7-so-poller`
also logs unredacted customer PII** (`customerEmail`, full shipping name/address) in its own
`Pushed ... to EventBridge` line, for every order it creates. This log group is **not named** in
`CTC-customer-data-in-cloudwatch.md` alongside `faulty-sale-worker-queue-handler` and the
dc-packing workers - it should be. Flagged, not fixed (out of this slice's scope; the doc update is
a recommendation for JJ, not actioned here).

### Regression, free on the same 9 fresh orders

* **TC1/TC1b** (cycle-complete to `wmsSentAt`, not raw Cin7-modified-to-sent): 35.2s to 47.8s across
  all 9. Matches the established 37-46s baseline (R4, R11) closely. PASS.
* **TC8** (row counts): every order's `ORDER`+`ITEM`(xN)+`ADDRESS`+`TRANSACTION` count on the order
  side matches item-count-derived expectation exactly for all 9; shipment side mirrors it
  (header + N item rows). PASS.
* **TC16** (`MessageGroupId == orderId`): true for all 9. PASS.
* **TC11** (bus isolation depths before/after): every queue 0 waiting/0 in-flight both before
  enabling and after the two cycles. `staging-orders-v2-dlq.fifo`'s pre-existing 2 dead-lettered
  messages unchanged (not ours). PASS, no leftover backlog.
* **TC10** (Worship-brand order): none of the 9 fresh orders is Worship-branded (`packingBrand`:
  `THRILLS` for all 9). Not testable this cycle, not a fail - no fresh Worship fixture was in the
  window.

## S3. Cycle 2, the second sighting - happened naturally

The schedule was still enabled between disabling decisions (cycle 1 completed 06:30:43.818Z; the
rule wasn't disabled until 06:33:34Z, 2m51s later), so a second scheduled cycle fired on its own at
`06:32:38.253Z` before the disable took effect:

```
Cin7PollerCycleStart  watermark=2026-09-07T06:30:34.409Z  modifiedSince=2026-09-07T06:25:34.409Z  modifiedBefore=2026-09-07T06:32:32.967Z
Cin7SOPollerCycleComplete  ordersFetched=2 created=0 echoSkipped=2 skippedStages={} (all other counters 0)
```

No third cycle followed (confirmed empty sweep after the disable). This is exactly S3's intended
check, obtained at zero extra cost rather than by deliberately re-setting the watermark and sweeping
the 43-order `Dispatched` batch a second time (which would have added blast radius for no new
signal, since that outcome is already known from cycle 1) - taken as satisfying S3, per this
slice's own cheap-first value order, rather than manufactured again.

* **TC21** (row counts unchanged): re-inspected `#262219` and `#262223` (the two freshest orders,
  both inside the re-swept window) after cycle 2 - row counts identical to cycle 1 (8 rows/8 rows;
  4 rows/4 rows), no second `TRANSACTION` row. PASS.
* **TC21b** (guard named in the log): no per-order log line at all for the `echoSkipped` decision,
  only the aggregate counter. **Same standing verdict as before: the suppression works, but the
  guard is not named, so TC21b stays INCONCLUSIVE** - now reconfirmed on fresh data instead of a
  stale fixture.
* **`echoSkipped`**: fired correctly (2, matching the 2 re-swept orders), first real observation of
  this counter on a genuine second sighting since it did not exist before the 2026-09-03 deploy.
* **K11 again**: `#262219`'s `lastEmittedPayloadHash` (`89019207`) unchanged by the echo - present
  on emit, untouched on echo, never removed.
* **K4 again**: confirmed a second time, independently (`06:25:34.409` = `06:30:34.409` minus 5
  minutes exactly).

## S4. Not attempted

No order had progressed stage naturally by the time this session ended - all 9 fresh orders were
created ~2-5 minutes before the session's own checks ran, and R9 measured `Processing` to
`Dispatched` taking 1-3 hours. Not reachable within this session; left for a later, separate check
if wanted, not scheduled or waited for here.

## Teardown

1. Schedule: `DISABLED`, confirmed via `describe-rule` after the second cycle. No third cycle ran.
2. Watermark: unset via `cin7-watermark.sh --set UNSET --confirm` (dry run previewed first). Read
   back: `UNSET`. Per JJ's instruction - not restored to the old value.
3. DLQ depths: all five queues identical to the S0 baseline (all 0 waiting/0 in-flight except the
   pre-existing, unrelated `staging-orders-v2-dlq.fifo` at 2, unchanged throughout).
4. **References created this session** (9, all ECOM, all `THRILLS`-branded, all reached
   `wmsSentAt`): `#262208, #262210, #262211, #262216, #262217, #262219, #262221, #262222, #262223`.

No Cin7 write at any point (every Cin7 call was a GET, via `find-cin7-sales-order.sh --with-contact`
or the reused window-count script). No order created, edited, approved or voided in Cin7 by this or
any session.

## Process note: a PII printing mistake, corrected in-session

Early in S2, a raw `aws logs filter-log-events --output text` call was printed directly to this
session's own tool output before extraction, and the SO poller's `Pushed` log lines contain the full
`customerEmail` and shipping name/address in the clear. This reached only this conversation's tool
output, not any file, and was corrected immediately: every extraction after that point used a
`python3` regex pulling named safe fields only (`origin`, `orderType`, `sourceStage`,
`packingBrand`, `messageGroupId`, `lastEmittedPayloadHash`), never the surrounding record, matching
the convention `faulty-sale-worker-duration-distribution.sh` already used for a different log group.
Same class of mistake as R1's `cut -c` incident on 2026-09-04 - flagged as a tooling/process issue,
not a system finding on its own. **What is a system finding**: this log group's own PII exposure,
previously uncatalogued, per the PII section above.

## Revised/new question list

| Item | Status entering R13 | Status leaving R13 |
|---|---|---|
| **K1, does the split exist** | INFERRED from code SHA/config (R0/R11) | **CLOSED, MEASURED behaviourally.** All 9 fresh CTC creates traced end to end (populator -> SQS -> handler -> downstream worker), zero filtered anywhere. |
| **Q36, counter leakage** | measured historically, largest live-schedule residual was single digits | **Residual 36 of 56 on one fresh cycle**, fully traced to a 43-order confirmed-wholesale `Dispatched` batch. Largest, cleanest measurement of this leak to date. |
| **Wholesale silent drop (R5)** | real under every design reading (R11 Gate B0), stage/type confound unresolved (Gate B unrunnable) | **Reproduces on fresh data, extends to a new stage (`Dispatched`)**, at 40x R5's scale. Confound (Q35) still not separated - no confirmed-wholesale order reached an eligible stage this cycle. |
| **New: Q38** | did not exist before this slice | Why does `skippedStages` count a wholesale order at `Approved` but not at `Dispatched`, when both are confirmed the same order type and both are LLD-ineligible stages? Narrows Q31 part 1 past "does the counter fire" (it does) to "which stage names does it recognise." |
| **K11, `lastEmittedPayloadHash` persistence** | TC13 measured absent after create | **Reversed: present**, on create and on echo, value matches the emitted payload exactly. |
| **K6, `company` field** | Q29 measured null on UNI, static `CTC` expected | Reconfirmed on fresh data both sides. |
| **K4, 5-minute lookback** | inferred from R5/R10's arithmetic | Confirmed directly from the log line twice, independently. |
| **PII, `faulty-sale-worker-queue-handler`** | confirmed present as of 2026-09-04 (R11) | Reconfirmed present on today's fresh invocations. |
| **New: PII in `{stage}-orders-cin7-so-poller`** | not previously catalogued | **New finding.** The poller's own `Pushed` log line carries full customer name/email/address in the clear. Recommend adding to `CTC-customer-data-in-cloudwatch.md`; not edited this session. |
| **Possible fix: PII echo in `staging-inventory-check-order-faulty-sale`** | present as of 2026-09-04 (R11 Gate D3) | **Appears absent on 9 fresh invocations today**, same day as that function's redeploy. Unverified whether deliberate; flagged as a positive candidate, not claimed as closed. |
| **TC21 / TC21b** | not previously re-run on fresh data | **TC21 PASS. TC21b still INCONCLUSIVE** (suppression works, guard not named) - same standing verdict, now on fresh data. |
| **TC1/TC1b/TC8/TC16/TC11** | last verified on R4's fixtures (2026-09-04) | Reconfirmed clean on 9 new fresh orders. |
| **TC10** | last verified on `WOR19169A` | Not testable this cycle - no fresh Worship order in window. |
| **TC6/TC18/TC9/TC15** | opportunistic, none found yet | Not found in this window either; not deeply searched (cheap-first). K5 (DLQ) still empty, no rejection fixture available. |
| **Q35, wholesale destination** | unresolved, R10/R11 found it hard to reach | Still unresolved. `#262210`, the one candidate that looked promising by proxy, resolved to genuine ECOM on contact-group check. |

## Scripts written

* `audit-poller-cycle-emits.sh` - S2. Read only. Prints only safe fields
  (origin/orderType/sourceStage/packingBrand/messageGroupId-match/lastEmittedPayloadHash) from the
  poller's `Pushed` log lines, never the surrounding record. Built directly because of this
  session's own PII printing mistake (see process note above) - the ad hoc extraction that replaced
  the mistake was promoted to a saved script per this plan's own rule (non-trivial, contains
  parsing logic, plausibly reused by any future slice auditing a cycle's emits). Not reviewed yet.

## Stop and ask JJ

* **Q38 is new and needs a decision on scope**: does resolving "why does `Dispatched` silently
  drop a wholesale order while `Approved` gets counted" belong to this retest, or does it wait for
  Kian's Q35 answer (which family should even hold a wholesale order) since the counter question
  may be moot if wholesale is rerouted entirely.
* **`CTC-customer-data-in-cloudwatch.md` should be updated** to add
  `{stage}-orders-cin7-so-poller` to its list of log groups with unredacted customer data. Not
  edited this session (out of this slice's stated deliverables); flagged for JJ's call.
* **The apparent PII-echo removal in `staging-inventory-check-order-faulty-sale` is worth a second,
  independent check** (a different fresh order, ideally after another natural cycle) before treating
  it as a real fix rather than a one-off.
* Neither "inconclusive twice in a row" nor "teardown failed" nor "blast radius wider than assumed"
  triggered this session - the stop conditions in `CLAUDE.md` do not apply here.
