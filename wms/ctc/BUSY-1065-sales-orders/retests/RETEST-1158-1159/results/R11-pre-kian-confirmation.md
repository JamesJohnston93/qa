# Result: Slice R11, pre-Kian confirmation

**Ticket:** BUSY-1158, BUSY-1159, BUSY-1160, epic BUSY-1065
**Verdict:** Gate B0 does NOT retire R5's wholesale finding. It makes it stronger, and surfaces a
genuine LLD-versus-Jira contradiction on where a WHOLESALE order is even supposed to go (new: Q35).
Gate A confirms R5's own arithmetic was correct and shows the counters have never balanced, before or
after the 2026-09-03 deploy. Gate B is UNRUNNABLE AS DESIGNED against any cycle in retained history -
Cin7 has no point-in-time query, so a historical window cannot be reconstructed once time has passed.
Gate C confirms the `skippedStages` counter stopped firing at the 2026-09-03 deploy, splitting Q31 into
two questions as anticipated. Gate D1 REVERSES R1's INFERRED duration signal on a real sample (n=32
warm CTC vs n=129 warm non-CTC): the median CTC duration is now measurably *below* the non-CTC median,
not above it. Gate D2 closes Q27's write side with a MEASURED zero, via a CloudWatch metric that
sidesteps the key-mapping problem R1 hit. Gate D3 confirms the customer-data exposure is still live as
of the most recent measurement. Gate E is favourable: the weekend (in AEST business-hours terms) shows
close to zero CTC order activity and no dispatch-batch signature, flagged for JJ per the slice's own
stop condition, not acted on.

## Preconditions

MEASURED. `aws sts get-caller-identity --profile staging` returned the staging account
(398353400186). Watermark before starting: `2026-08-28T01:35:45.769Z`, matches expectation. Poller
schedule: `DISABLED`, `rate(2 minutes)`, matches expectation. Both re-confirmed identical at the end
of this session too (see Teardown); nothing in this slice wrote a watermark, changed the schedule, or
invoked the poller.

## Desk findings, 2026-09-07 (read first, per the slice)

Carried over from `STATE.md` and the slice file itself, not re-derived here: the LLD's own query
fetches wholesale on purpose (`branchId IN (51908, 51909)`), skips only `Retail - Shop`, and requires
skips to be counted (section 7). Section 9.2 and 9.3 have WHOLESALE, RTV and STORE_PICK never emitting
native domain events, going straight to an `OUTBOUND_SHIPMENT` family instead - which is why Gate B0
runs before Gate A.

## Gate B0, did the wholesale orders land in the outbound family

**Outcome: MEASURED. Nothing exists in either family, in either building, and the family is not
deployed - but the picture is more specific than that reading suggests.**

**1. Identifying the family, from the LLD.** Section 9.2/9.3: the `OUTBOUND_SHIPMENT` family lives in
the *shipments* table (same table as native shipments, not a separate one), discriminated by fields
rather than key shape: header at `SK = SHIPMENT#<reference>` carrying `orderType`/`company`, items at
`SK = OUTBOUND_ITEM#<line id>#<size code>`, audit `TRANSACTION#<epoch-ms>` with `category = OUTBOUND`,
lifecycle `PENDING_OUTBOUND -> SENT_OUTBOUND`, plus `CANCELLED_OUTBOUND` and `REMOVED_OUTBOUND`. The
LLD names the build ticket: BUSY-1161.

**2. Looking the two references up directly.** `staging-shipments` has **no `origin_index` GSI**
(MEASURED via `describe-table`: `allocated_store_index`, `customer_index`, `idempotency_index`,
`status_index`, `pending_action_index`, `shipment_index`, `event_index` - seven GSIs, none on
`origin`), despite the LLD stating this GSI is "delivered by BUSY-1103." `inspect-ctc-order.sh`'s own
comment says the same thing independently. Without it, the only route to a shipment row is the order's
own `PK`, read off its `ORDER` row in `staging-orders-v2` - and `staging-orders-v2` has **zero rows of
any kind** (re-confirmed today, 3 days after R5, via `inspect-ctc-order.sh` on both references: `0
ORDER, 0 ITEM, 0 ADDRESS, 0 TRANSACTION` for both `1065881Sep26` and `UQLD160-3711A`). This table is
the shared order chain the LLD says all four order types write to, upstream of the native/outbound
split entirely - its absence is not explained by "wholesale goes to a different shipping family."

**3. Widening, per the slice's own step 3.** Queried `status_index` directly for all four
outbound-family lifecycle statuses, across the *whole table*, not scoped to these two references:

```
PENDING_OUTBOUND:   0 rows
SENT_OUTBOUND:      0 rows
CANCELLED_OUTBOUND: 0 rows
REMOVED_OUTBOUND:   0 rows
OPEN (control):     2911 rows
```

The control confirms the query mechanism itself works. Zero rows for every outbound status, system
wide, not just for R5's two orders. Also checked: zero Lambda functions with "outbound" in the name
anywhere in the account; zero EventBridge rules matching an OUTBOUND detail-type pattern on either
`staging-orders-v2-event-bus` or `staging-shipping-v2-event-bus` (19 and 16 rules respectively, read
in full, none OUTBOUND-related). **The outbound family is not deployed to this account at all** - no
data, no compute, no wiring.

**4. Checking BUSY-1160 and BUSY-1161's scope, per the slice's third reading.** This is where the
finding sharpens past "just unbuilt":

* **BUSY-1160** ("Native updates: wholesale mapping, line reconciliation, cancellation", in Review,
  assigned to JJ) states outright: *"Both ECOM and WHOLESALE ship to an external address via a carrier
  with `AllocateComplete = Y`, so wholesale rides the same records and the same sender."* That is the
  **native** family, the opposite of the LLD.
* **BUSY-1161** ("Outbound family: RTV end-to-end", In Progress, assigned to Kian) scopes the outbound
  family to *"RTV as its only order type from sales orders."* STORE_PICK moved out to BUSY-1219 on
  2026-07-28. WHOLESALE is not named anywhere in BUSY-1161's scope, acceptance criteria, or its "what
  to build" section.

So there is no ticket, LLD-compliant or not, that currently claims WHOLESALE as its own build target.
The LLD says outbound; the one ticket that would build wholesale support says native; the one ticket
that builds the outbound family explicitly excludes wholesale. **All three readings converge on the
same observable fact: nothing currently holds a wholesale order anywhere**, because the native family
(checked and empty, per point 2) and the outbound family (checked and empty/undeployed, per point 3)
are the only two candidate destinations either design names, and BUSY-1160's own approach would use the
native one R5 already measured as empty.

**Per CLAUDE.md, the LLD wins where it disagrees with a ticket - the disagreement itself is a
correction to raise, not a defect to log.** Raised as **Q35** in
`../../BUSY-1065-OPEN-QUESTIONS.md`, addressed to Kian: which design is authoritative, and which ticket
(if either) owns wholesale.

**Reading against the slice's three anticipated outcomes:** none of the three fits cleanly on its own.
Not "records exist" (nothing exists anywhere). Not simply "family not deployed, check BUSY-1160" in
isolation, because BUSY-1160 checked out to route wholesale into the *native* family, which was already
measured empty by R5 and re-confirmed here. The honest combined reading: **the drop is real under every
design read available, and it is now the strongest, best-supported finding on the epic** - not a
measurement error, not a "wrong table" false positive, and not something a code read of the outbound
family would resolve, because that family holds nothing for wholesale under any current build ticket's
own stated scope.

## Gate A, counter reconciliation across retained poller history

**Script:** `scripts/reconcile-poller-cycles.sh` (`--stage staging --profile staging`). Read only.
Sweeps every `Cin7SOPollerCycleComplete` line via `aws logs filter-log-events`, sums every printed
disposition counter per cycle dynamically (so a counter added later shows up as a new column rather
than being silently absorbed), and reports the residual (`ordersFetched` minus the sum) with the
cycle's own timestamp.

**Counter names summed** (auditable, printed by the script every run): `created`, `updated`,
`cancelled`, `staleSkipped`, `echoSkipped`, `skippedLocallyTerminal`, `skippedCounted`,
`skippedZeroUnitOrders`, `pendingCreates`, `oversized`, `skippedZeroQty`, `skippedNoSizes`, plus
`skippedStages` (a dict, summed by its own values). Excluded on purpose, and named so the exclusion is
visible: `metric`, `ordersFetched` (the total itself), `watermarkAdvanced`, `newWatermark`,
`pageCapHit`, `requestsThisCycle` (bookkeeping, not a disposition), and `packingBrandMisses` (a
data-quality flag on already-`created` ECOM orders, not an independent disposition - counting it would
double-count orders already in `created`).

**MEASURED, full retained history swept: 2026-08-27T05:38:53Z to 2026-09-04T05:04:33Z (582 cycles,
the log group's entire retention).**

* **Schema note, found in passing:** all 576 pre-2026-09-03 cycles use a 6-field counter set
  (`created`, `oversized`, `pendingCreates`, `skippedCounted`, `skippedZeroQty`,
  `skippedZeroUnitOrders`); all 6 post-deploy cycles use the full 12-field set. The 2026-09-03 deploy
  added `cancelled`, `updated`, `echoSkipped`, `staleSkipped`, `skippedLocallyTerminal`,
  `skippedNoSizes` - consistent with BUSY-1160's scope (update/cancel handling), not a separate
  mid-window schema change.
* **Total cycles: 582. Non-zero residual: 292 (291 of 576 pre-deploy; 1 of 6 post-deploy).**
* **R5's own cycle** (`2026-09-04T01:33:31.987Z`): `ordersFetched=8`, summed=7, **residual=1**. This
  matches R5's own stated arithmetic exactly ("at most 7 accounted... at least one fetched order
  accounted for by nothing" - singular "one," not "at least two"). **Gate A's third stop condition
  ("residual is zero everywhere including R5's own cycle") does NOT trigger. R5's arithmetic is
  confirmed correct, not wrong.**
* **Ten largest-magnitude residuals**, three of which are wide backfill/catch-up cycles rather than
  steady 2-minute cycles (`modifiedSince` spans hours to days, not the usual ~6 minutes):

```
2026-08-28T01:55:21.867Z  ordersFetched=718  summed=319  residual=399
2026-08-28T01:50:30.673Z  ordersFetched=306  summed=241  residual=65
2026-09-02T03:32:59.447Z  ordersFetched=48   summed=8    residual=40
2026-08-28T01:47:57.446Z  ordersFetched=25   summed=0    residual=25
2026-08-27T11:04:53.952Z  ordersFetched=5    summed=0    residual=5
2026-08-27T06:36:53.843Z  ordersFetched=4    summed=0    residual=4
(plus three more small cycles, residual=4 each)
```

**Reading: matches the slice's second anticipated outcome.** "Residual is non-zero across the whole
history: orders have always been able to leave a cycle uncounted." This is NOT "zero before, non-zero
after" (291 of 576 pre-deploy cycles are already non-zero), and NOT "zero everywhere" (R5's own cycle
is not zero, and matches R5's claim precisely). **The finding going to Kian changes from "a new silent
drop introduced by the 2026-09-03 deploy" to "the cycle counters have never fully balanced, and R5's
cycle is one dated, high-confidence instance of a long-standing gap."** This does not weaken R5's
finding (Gate B0 already established the drop is real); it changes its framing from "regression" to
"a long-standing, now precisely measured gap that the deploy did not introduce and did not fix."

## Gate B, the wholesale confound, broken without a fixture

**Outcome: UNRUNNABLE AS DESIGNED. Stopping here rather than forcing a substitute, per CLAUDE.md's
own instruction to stop and say so.**

**Script:** `scripts/gate-b-window-check.sh` (`--modified-since <ISO> --modified-before <ISO>`). One
Cin7 GET for `branchId IN (51908,51909)`, `isApproved=true`, over the exact window, any stage
(deliberately not stage-filtered in the query, so the gate's own read of stage/type happens client
side, per the slice's step 2 before its step 3 contact-resolution).

**What happened.** Extracted the exact `modifiedSince`/`modifiedBefore` window from the poller's own
`Cin7PollerCycleStart` log lines (paired by request ID with each `Cin7SOPollerCycleComplete` line, from
the same full-history sweep as Gate A) for 8 small live-schedule-period cycles (2026-08-27, residuals
1, 3, 4, 4, 4, 5) plus 2 zero-residual controls. **Every single window, small and control alike,
returned zero orders** - not zero wholesale orders, zero orders of any kind, despite the poller's own
log confirming 1 to 5 orders were fetched in each of those exact windows at the time.

**Verified this is not a script bug, three ways:**

1. Re-ran the identical query mechanism against a window from the last 6 hours (genuinely current):
   it returned real orders immediately, including current wholesale orders at branch 51908, confirming
   the query syntax and credentials are correct.
2. Re-ran against R5's own well-documented 8-order window (`2026-09-04T00:57:41Z` to
   `01:33:24.766Z`, only 3 days old, with all 8 references and their stages already on file from R5 and
   R9's own results): **also zero**, despite R9 independently confirming on 2026-09-04 that those exact
   references were live and revisable at that time.
3. R9's own 2026-09-04 finding explains why: CTC orders move from `Processing` to `Dispatched` in 1 to
   3 hours in this environment, and 69 of 70 already-sent references R9 checked had a newer
   `modifiedDate` than when they were first seen - **every order this team has ever tracked has moved
   on since**. Cin7's `modifiedDate` is a live, mutable, current-state field, not an append-only
   history. A query for "modified between X and Y" only matches orders whose modification history has
   not been touched again since - which nothing from more than about a day ago satisfies.

**Conclusion: no historical cycle in retained history, including cycles as recent as 3 days old, can
have its order-set membership reconstructed via a Cin7 GET.** This forecloses Gate B's method
entirely, not just for the stale live-schedule-period cycles R8/R3 already found unreachable for a
different reason (R10's upper-bound problem) - this is the mirror-image lower-bound problem: you
cannot look backward through Cin7 any more than R10 found you could look forward past an already-stale
target. **Never reached the contact-group resolution step** (zero candidates surfaced in any window),
so the "more than about 15 Cin7 GETs" stop condition was never approached; the GET budget used here was
10 window-checks plus 2 sanity checks, well under it.

**R5's confound (wholesale and already-excluded-stage perfectly correlated) stays UNKNOWN from this
gate specifically.** It does not need to stay unresolved overall: Gate B0 already established the drop
is real independent of the stage question, and Gate C below gives an independent, cheaper read on part
of the same confound (whether the stage-skip counter itself is still live).

## Gate C, the `skippedStages` timeline

**Script:** `scripts/skipped-stages-timeline.sh` (`--stage staging --profile staging`). Same sweep
mechanism as Gate A, filtered to non-empty `skippedStages` occurrences only.

**MEASURED, 9 non-empty occurrences across the full 582-cycle retained history:**

```
2026-08-27T09:24:50.846Z  ordersFetched=1    skippedStages={'Fraud Warning': 1}
2026-08-27T09:26:50.747Z  ordersFetched=1    skippedStages={'Fraud Warning': 1}
2026-08-27T09:28:50.812Z  ordersFetched=1    skippedStages={'Fraud Warning': 1}
2026-08-27T09:54:50.738Z  ordersFetched=1    skippedStages={'Fraud Warning': 1}
2026-08-27T09:56:50.840Z  ordersFetched=1    skippedStages={'Fraud Warning': 1}
2026-08-27T09:58:50.799Z  ordersFetched=1    skippedStages={'Fraud Warning': 1}
2026-08-28T01:50:30.673Z  ordersFetched=306  skippedStages={'Fully Picked': 22, 'Partially Picked': 2, 'Fraud Warning': 1}
2026-08-28T01:55:21.867Z  ordersFetched=718  skippedStages={'Fully Picked': 29, 'Partially Picked': 3, 'Fraud Warning': 1}
2026-09-02T03:32:59.447Z  ordersFetched=48   skippedStages={'Fully Picked': 1}
```

The last three match slice 08's `{29, 3}` measurement and slice 11's `{'Fully Picked': 1}` measurement
exactly. `Fraud Warning` is a newly-observed, ineligible-stage value unrelated to Q31 (it is not one of
the LLD's eligible stages, so its presence in this counter is expected behaviour, not a defect).

**Last non-empty occurrence: `2026-09-02T03:32:59.447Z`, BEFORE the 2026-09-03 deploy. Zero non-empty
occurrences in any of the 6 post-deploy cycles**, including R5's own 2026-09-04 cycle, which contained
a genuine `Fully Picked` wholesale order and measured `skippedStages={}` completely empty.

**Reading: matches the slice's anticipated split exactly.** The counter's own behaviour changed at the
deploy (MEASURED), separately from whatever the underlying stage gate itself now does (UNKNOWN, since
Gate B could not test it and no post-deploy ECOM order has ever reached a picked stage to test it
directly either - see TC14 below). **Q31 becomes two questions:**

1. **Counter regression (general):** does `skippedStages` fire at all post-deploy, for any order type?
   UNKNOWN - the only post-deploy candidate that would have tripped it (R5's wholesale target) may not
   reach this counter at all if a wholesale-vs-ECOM gate now runs before the stage check (Gate B0's
   findings make an earlier wholesale-side skip at least as plausible as a broken counter).
2. **Underlying eligibility (specific):** is the stage-gate set itself (`New`, `Processing`,
   `Partially Picked`, `Fully Picked`) still what the poller enforces, independent of whether the
   counter reports it? UNKNOWN, unresolved by this pass.

## Gate D, Q27

### D1, duration: INFERRED reading from R1 does not survive a real sample

**Script:** `scripts/faulty-sale-worker-duration-distribution.sh` (`--profile staging --start-time
2026-08-20T00:00:00Z --end-time 2026-09-07T06:00:00Z`). Read only. Sweeps
`staging-inventory-check-order-faulty-sale` (bounded to skip 7 months of pre-CTC-testing history this
log group's full retention actually holds, back to January), splits CTC (`origin` starts with `CTC#`)
from non-CTC by extracting the `origin` field value alone via a narrow regex anchored on the literal
field name - never printing the surrounding record. Cold invocations (literal `Init Duration` marker
present on the `REPORT` line) excluded.

**One bug found and fixed while building this**, recorded in the script itself: an earlier version
tried to capture the `Init Duration` value inside the same regex as `Duration`, with a lazy `.*?`
ahead of an optional trailing group. That combination let the lazy quantifier silently swallow the
`Init Duration: X ms` text itself before the dedicated group ever matched it, so cold detection came
back all-false (0 excluded in every group) on the first run. Fixed by checking for the literal marker's
presence as a plain substring instead of trying to extract its value (which Gate D1 does not need).

**MEASURED (a real distribution, not R1's n=2 sample):**

```
group      n     p50      p90       max      min
CTC        32    3.49     261.98    575.30   1.85
non-CTC    129   27.02    402.60    807.17   1.44
```

(Cold excluded: 49 CTC, 46 non-CTC.) The two invocations R1 measured are both present and match R1's
own numbers exactly (`261115`: 275.03ms warm; `WOR19261`: 144.56ms warm), confirming the extraction is
accurate - they simply are not representative of the fuller CTC sample now available.

**Reading: this reverses R1's INFERRED directional claim.** R1, from n=2, found both CTC samples above
the "warm non-CTC baseline (15 to 36ms)" and tagged that INFERRED-consistent-with-doing-real-work. With
n=32, the **CTC median (3.49ms) sits below the non-CTC median (27.02ms)** - most CTC invocations (about
20 of 32) complete in under about 15ms, in the same range as an instant field-check bail, while a
minority (roughly a third) run into the hundreds of ms, similar to non-CTC's own upper range. R1's two
samples happened to land in that slower minority, not the typical case. **Tag: the distribution itself
is MEASURED. R1's directional inference is retracted, not confirmed the other way** - duration alone
still cannot show what the function does (R1's own caveat that no invocation, CTC or not, logs anything
beyond an input echo and a static config echo still holds), but it no longer supports "CTC invocations
run longer, consistent with real processing." If anything the shape (many near-instant, some slow) is
at least as consistent with most CTC invocations bailing quickly as with Kian's original claim.

### D2, the write side: MEASURED zero, closes cleanly

**Method:** `aws cloudwatch get-metric-statistics`, `ConsumedWriteCapacityUnits` on `staging-inventory-v2`
(confirmed `PAY_PER_REQUEST`/on-demand via `describe-table`), 1-minute period, `Sum` statistic, over
R1's own two tight windows.

**MEASURED:**

```
261115 window   (23:47-23:51 UTC, invocation at 23:48:53): 0.0 at 23:48 and 23:49 buckets (invocation-covering)
WOR19261 window (11:01-11:05 UTC, invocation at 11:02:56): 0.0 at 11:02 and 11:03 buckets (invocation-covering)
```

The metric is confirmed live (not simply silent): a `Sum=2.0` datapoint appears in the bucket one
minute *before* the 261115 invocation, unrelated timing, proving the metric reports real activity when
it occurs. **This closes the write-side gap R1 left as UNKNOWN** (no viable Cin7-SKU-to-table-key
mapping for a direct query) - the CloudWatch-metric route sidesteps the key-mapping problem entirely,
exactly as Gate D2 was designed to do. **A measured zero write, on top of R1's already-measured zero
bus emission, needs nothing further from Kian on this half of Q27.**

### D3, redaction: still unredacted, confirmed current

**MEASURED, presence only, no values, using the same origin-extraction data as D1** (safe by
construction: only field *names* checked, never printed alongside a value): `customerEmail`,
`firstName`, `lastName`, `street1`, `city`, `postalCode` are all present in the logged record for
`261115` (2026-08-27, R1's original reference) **and** `261844` (2026-09-04, the most recent CTC
invocation in this dataset, one of R4's own orders). **The exposure documented in
`CTC-customer-data-in-cloudwatch.md` is still live as of the most recent measurement, not merely
historical.**

## Gate E, is there a cheaper window in the week

**Script:** `scripts/dispatch-batch-weekday-weekend.sh` (`--hours 72`). Read only, paginated Cin7 GET,
`fields=modifiedDate` only (R10 Gate C's own cheap method).

**MEASURED, last 72 hours (2026-09-04T06:03Z Friday through 2026-09-07T05:51Z Monday, 521 orders
total):**

```
2026-09-04 (Fri)  06:00  2      2026-09-06 (Sun)  22:00  130
2026-09-04 (Fri)  11:00  1      2026-09-06 (Sun)  23:00  51
2026-09-05 (Sat)  08:00  1      2026-09-07 (Mon)  00:00  70
2026-09-06 (Sun)  06:00  1      2026-09-07 (Mon)  01:00  35
2026-09-06 (Sun)  21:00  15     2026-09-07 (Mon)  02:00  91
                                2026-09-07 (Mon)  03:00  66
                                2026-09-07 (Mon)  04:00  11
                                2026-09-07 (Mon)  05:00  47
```

Raw weekday/weekend split by UTC calendar day: 323 weekday, 198 weekend. **That split is misleading on
its own** - 196 of the 198 "weekend" orders fall in the `Sun 21:00` to `Sun 23:59` UTC band, which is
`Mon 07:00` to `09:59` AEST: the start of Monday's business day, not weekend activity. **The genuine
Saturday/Sunday AEST business window** (`Sat 2026-09-05T00:00Z` through `Sun 2026-09-06T21:00Z`, roughly
45 hours) **shows 2 orders total**: one at `Sat 08:00 UTC`, one at `Sun 06:00 UTC`. **Zero
dispatch-batch signatures (10+ orders in one minute) anywhere in that window.** All 16 batch signatures
found in the 72-hour sweep (10 to 52 orders per minute) cluster entirely from `2026-09-06T22:03Z`
onward - Monday's AEST business day.

**Reading: matches the slice's first, favourable outcome.** "Weekend rate materially lower and no
batch signature on Saturday or Sunday: next weekend is the window for R3's actual scope (TC3, TC21,
TC21b)." **Flagged for JJ per the slice's own stop condition - the watermark write that would follow
this reading is his call, not this session's. Not acted on.**

## TC14, the confirmation-leg premise (desk finding, one confirmation attempted)

The desk finding proposed that no ECOM order has ever been observed at a picked stage because the
Cin7-side "confirmation leg" that would write `Fully Picked`/`Partially Picked` back into Cin7 does not
exist yet. Checked for corroboration, not full proof: `BUSY-1163` ("CTC shipment confirmation ingest:
shup files to snapshot transactions", epic BUSY-1070, in Review under Lachlan) is scoped to
**ingesting** SCALE's shipment-confirmation files into our own transaction chain - it does not itself
write anything back into Cin7. No lambda in the account matches a CTC-specific "confirm" or "pick"
naming pattern (checked: `confirm`, `Confirm`, `pick-confirm`, `wave` - the five matches found are all
pre-existing Futura/Magento/generic order-confirmation functions, unrelated to CTC). **Still INFERRED,
strengthened, not MEASURED**: nothing on our AWS side writes to Cin7 at all (consistent with LLD 9.4,
"nothing flows back to Cin7" - by design, for our system), so whatever *does* eventually bump a picked
Cin7 order's `modifiedDate` (Manhattan's own separate connector, or a manual warehouse action) is
outside this epic's build scope entirely, and nothing found here shows it has ever fired for a CTC ECOM
order. TC14 stays a DEFERRED read, not a fixture hunt, pending the confirmation epic - unchanged
recommendation from the desk finding, now with one more negative data point behind it.

## Revised question list for Kian

| Item | Status entering R11 | Status leaving R11 |
|---|---|---|
| **Wholesale silent drop (R5)** | one cycle, wholesale and already-excluded-stage confounded | **MEASURED as real under every current design reading** (Gate B0). The wholesale/stage confound itself stays UNKNOWN (Gate B unrunnable), but no longer matters for whether the drop is real - it is. New: **Q35**, which family (if either) is supposed to hold WHOLESALE, is now the live question, not whether the drop happened. |
| **Q31, the stage gate** | two contradictory measurements four days apart | Splits in two. `skippedStages` counter regression at the 2026-09-03 deploy: **MEASURED** (last non-empty occurrence 2026-09-02, zero on all 6 post-deploy cycles including one that should have tripped it). Underlying eligibility set unchanged: **UNKNOWN**, unresolved (Gate B unrunnable; no post-deploy ECOM picked-stage sample exists per TC14). |
| **Q27, does the lambda run or bail** | INFERRED from two invocations | **Duration signal retracted, not confirmed the other way.** MEASURED on n=32 warm CTC vs n=129 warm non-CTC: CTC median is *below* non-CTC median, the opposite direction from R1's inference. Mechanism itself stays UNKNOWN (no invocation logs visible business logic, CTC or not). |
| **Q27, write side** | UNKNOWN, no key mapping | **MEASURED zero** (CloudWatch metric, sidesteps the key-mapping gap). Closed - needs nothing further from Kian. |
| **Q27, redaction** | previously flagged, not re-verified recently | **MEASURED still present**, on the most recent available CTC invocation, not just historically. |
| **New: Q35** | did not exist before this slice | **Open, for Kian.** LLD says WHOLESALE goes to the outbound family; BUSY-1160 (JJ, Review) says wholesale rides the native family; BUSY-1161 (Kian, In Progress) scopes the outbound family to RTV only. Neither destination holds anything today. Which is authoritative, and which ticket owns it? |
| **TC14, confirmation-leg premise** | INFERRED, needs one confirmation | Still INFERRED, one corroborating negative added (BUSY-1163 is ingest-only; no Cin7-write lambda found anywhere in the account). Recommend treating as DEFERRED, not a fixture hunt, per the original desk finding. |
| **Gate E, cheaper window** | not previously measured | **MEASURED favourable.** Genuine AEST weekend shows ~2 orders across 45 hours and zero batch signatures. Flagged for JJ; the watermark write that would follow is his call. |

## Teardown

None. Watermark and schedule confirmed `2026-08-28T01:35:45.769Z` / `DISABLED` at the start of this
session (before Gate B0) and re-confirmed identical at the end (after Gate E), unchanged throughout.
No Cin7 write at any point (every Cin7 call was a GET). No AWS write at any point (every AWS call was a
read: `logs filter-log-events`/`describe-log-streams`/`describe-log-groups`, `dynamodb
query`/`describe-table`, `events list-rules`/`list-event-source-mappings`, `lambda
list-functions`/`get-function-configuration`, `cloudwatch get-metric-statistics`).

**Found mid-session, not caused by this session:** `slices/R12-question-revalidation.md` and
`slices/R13-fresh-data-verification.md`, plus their result files, appeared in this plan's `slices/` and
`results/` directories partway through this run - a concurrent session progressing the same plan.
`STATE.md` now carries their own "Correction, 2026-09-07" note ahead of R13's watermark-forward,
schedule-enabled step. As of this session's own final check (after Gate E), the watermark and schedule
are still at their original values - that step has not executed yet. Per this slice's own scope ("do
not read the other slices except where R11 names one"), neither R12 nor R13 was read or acted on here.

## Scripts written

All read only, all under the three-line/logic threshold that requires saving, all in `scripts/`, rows
added to `SCRIPTS.md`. **None reviewed yet.**

* `reconcile-poller-cycles.sh` - Gate A
* `gate-b-window-check.sh` - Gate B (confirmed unrunnable as designed; the script itself is correct,
  verified against a live window)
* `skipped-stages-timeline.sh` - Gate C
* `faulty-sale-worker-duration-distribution.sh` - Gate D1 (one regex bug found and fixed during this
  session, documented in the script's own comments)
* `dispatch-batch-weekday-weekend.sh` - Gate E

## Stop and ask JJ

* **Gate E looks favourable** (per the slice's own listed condition). The watermark write that would
  follow is JJ's call, not this session's. Not acted on.
* Gate A did not show R5's own arithmetic was wrong (residual=1, matching R5's stated claim exactly) -
  the "stop and ask" condition for that does not trigger.
* Gate B never approached the ~15-GET budget for contact resolution (zero candidates surfaced before
  that step would have been needed) - the other "stop and ask" condition does not trigger either,
  though Gate B's own unrunnability is worth knowing before it is attempted again on any other
  historical cycle.
