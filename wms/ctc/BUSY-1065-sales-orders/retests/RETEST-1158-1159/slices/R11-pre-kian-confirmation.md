# Slice R11, pre-Kian confirmation

**Ticket:** BUSY-1158, BUSY-1159, BUSY-1160, epic BUSY-1065
**Cases:** none directly. This slice strengthens, re-scopes or retracts four findings before they are
put to Kian, and settles whether the fresh-fixture path is runnable today.
**Depends on:** R0, R1, R5, R9, R10, all done 2026-09-04.
**Estimated:** 60 to 75 minutes.
**Write scope: none.** No watermark set, no schedule change, no poller invoke, no Cin7 write. Every
gate is a CloudWatch history read, a DynamoDB read, a CloudWatch metric read or a Cin7 GET.

## Why this slice exists

Four things are queued for Kian. Three of them rest on a single cycle, a single pair of invocations or
an unmeasured premise, and each has a history-based test that costs no blast radius. Run those first.

| Finding | Current strength | Gate that settles it |
|---|---|---|
| Wholesale orders vanish with no counter and no log line (R5) | one cycle, wholesale and already-excluded-stage perfectly confounded | A, B, C |
| Q31, the stage gate | two contradictory measurements four days apart | C |
| Q27, the faulty sale worker runs rather than bails | INFERRED from two invocations | D |
| Q27 write side to `staging-inventory-v2` | UNKNOWN, no key mapping | D2 |

**Do not raise any item with Kian until its gate has run or has been recorded as unrunnable.**

## Desk findings, 2026-09-07, read this before Gate A

Two desk checks ran outside this plan and both change what the gates mean. Neither needed AWS.

**The LLD does not exclude wholesale, and it requires that skips are counted.** LLD 1802698758: the
Cin7 query itself filters `branchId IN (51908, 51909)` at step 2, both CTC branches, so wholesale
orders are fetched deliberately. Step 3 classifies contact group to ECOM, WHOLESALE or RTV and skips
only `Retail - Shop`, "skipped and counted". Step 4 is the eligibility stage check. There is no
order-type exclusion at any gate, and section 7 names the counters the poller must emit.

So R5's two vanished wholesale orders are not designed behaviour, and an uncounted disappearance
fails the LLD's own stated principle regardless of what caused it. The "designed exclusion" branch in
Gate A and Gate B is closed. That makes the finding stronger, and it also makes the next paragraph
mandatory before it is raised.

**Wholesale may not land in the record family we looked in.** Section 9.3 has WHOLESALE, RTV and
STORE_PICK never emitting native domain events at all, going "straight to the outbound family".
`inspect-ctc-order.sh` checks native rows (ORDER, ITEM, ADDRESS, TRANSACTION) and the shipment header.
R5 read zero rows there and called it a silent drop. **If wholesale is meant to land somewhere else,
R5 looked in the wrong place and the finding is a false positive.** Gate B0 settles that first.

**TC14 is probably not a fixture hunt at all.** The LLD has `Fully Picked` and `Partially Picked`
eligible for all order types including ECOM, and says those stages are in the set because the
confirmation leg writes them into Cin7 on the first pick. The confirmation leg does not exist yet. So
no ECOM order can currently be at a picked stage, which explains nine fruitless searches. INFERRED,
not measured: if it holds, TC14 is DEFERRED pending the confirmation epic rather than BLOCKED on a
fixture, and BUSY-1159 loses one of its two blockers. Confirm the mechanism, do not assume it.

**Jira, for context, not a gate.** No ticket covers the CTC split Kian described. BUSY-1164, "Consumer
guards: CTC fulfilment events must not trigger UNI machinery", sits in Review under Lachlan and
describes a guard inside the consumer, which is the opposite design to splitting CTC out a layer up.
BUSY-1160 is now in Review and assigned to JJ, so QA owns its verdict.

## Gate B0, did the wholesale orders land in the outbound family

**Run this before Gate A. It can retire the largest finding in the pass.**

R5's two orders are `1065881Sep26` (`Fully Picked`, branch 51908) and `UQLD160-3711A` (`Dispatched`).

1. Identify the outbound record family LLD section 9.2 and 9.3 describe, by name, from the LLD rather
   than by guessing a table.
2. Look both references up in it directly, and in any queue, bus or DLQ that family feeds.
3. If nothing holds them, widen once: scan for any record created in R5's cycle window
   (`2026-09-04T00:57:41Z` to `01:33:24Z`) in that family, not keyed by reference, in case the key
   shape differs from the Cin7 reference the way `staging-inventory-v2`'s did.

**Reads as:**

* Records exist: R5 measured the wrong table. The finding shrinks to "processed but absent from the
  cycle counters", which is still a real gap against section 7 but is a metrics defect, not a data
  loss. Say so plainly in the result and correct R5's own file.
* Nothing exists anywhere in that family, and the family is deployed: the drop is confirmed against
  the LLD's design, and it is the strongest finding on the epic.
* The family is not deployed yet: then wholesale handling is simply unbuilt, R5 measured an unbuilt
  path, and the only live question is why nothing counted it. Check BUSY-1160's scope before
  concluding, since wholesale mapping is named in that ticket.

Tag the outcome MEASURED or UNKNOWN. Do not infer from absence in one table.


## Gate A, counter reconciliation across retained poller history

R5's cycle does not balance: `ordersFetched=8`, and the printed counters account for at most 7
(`created=5`, `skippedCounted=1` which is the named Nelson hard error, `skippedZeroQty=1` which
accounts for at most one of the two wholesale orders). At least one fetched order is accounted for by
nothing.

Sweep every `Cin7SOPollerCycleComplete` line in the poller's full retained history. For each cycle
compute `ordersFetched` minus the sum of every printed disposition counter, and record the residual
with the cycle timestamp.

Save it as a script (`scripts/reconcile-poller-cycles.sh` or a Python equivalent), per `CLAUDE.md`.
Print the counter names it summed, so the arithmetic is auditable and a counter added by the
2026-09-03 deploy is visible as a new column rather than silently absorbed.

**Reads as:**

* Residual is zero on every cycle before 2026-09-03 and non-zero after: the deploy introduced an
  unaccounted disposition. Strongest possible version of the finding, and it is dated.
* Residual is non-zero across the whole history: orders have always been able to leave a cycle
  uncounted. R5 measured normal behaviour, the wholesale reading is unsupported, and the finding
  going to Kian changes from "new silent drop" to "the cycle counters have never balanced".
* Residual is zero everywhere including R5's own cycle: the arithmetic in R5's result is wrong.
  Stop and re-derive before anything is raised.

## Gate B, the wholesale confound, broken without a fixture

R5's two vanished orders were wholesale AND at stages that were already excluded before the deploy.
R8 tried to break that by finding a live wholesale order at `New` or `Processing` and stopped on blast
radius. History does the same job for free: the schedule was live against real Cin7 traffic until
2026-08-28, so cycles containing wholesale orders at eligible stages already ran.

1. Pick 5 to 10 cycles from the live-schedule period, spread across dates, each with a known window
   (`modifiedSince` and `modifiedBefore` are both in the cycle's own log lines).
2. For each window, a Cin7 GET for `branchId IN (51908, 51909)` over exactly that window, GET only.
3. Resolve stage and order type for the orders returned. Contact group is the definition, not the
   company name, and `--with-contact` costs one GET per distinct member, so resolve only the
   wholesale-looking candidates at `New` or `Processing`.
4. For each such order, check whether that cycle's counters and log lines account for it.

**Reads as:** pre-deploy, a wholesale order at an eligible stage either lands in a named counter or it
does not. `STATE.md` line 267 records one that did (`skippedCounted 1`, `skippedStages {}`), which is
one data point in favour of "it used to be counted". Confirm or break that across several cycles.

* Used to be counted, now is not: the drop is real and dated, and the confound is gone.
* Was never counted: R5 measured long-standing behaviour and the only live question is whether
  wholesale exclusion is intended and undocumented.

## Gate C, the `skippedStages` timeline

Extract every occurrence of `skippedStages` with a non-empty value across the full retained history,
with its date and contents. Slice 08 measured `{29, 3}` on 2026-08-28 and slice 11 measured
`{'Fully Picked': 1}` on 2026-09-02. R5 measured `{}` on 2026-09-04 on a cycle that contained a
`Fully Picked` order.

**Reads as:** if the last non-empty `skippedStages` predates the 2026-09-03 deploy, the counter stopped
firing at the deploy, which is a finding in its own right and it separates cleanly from the question of
whether the stage gate itself changed. Q31 then becomes two questions, not one, and only one of them is
about eligibility.

## Gate D, Q27, converting INFERRED to MEASURED

R1 rests on two CTC invocations. Two is not a distribution.

**D1, duration.** Pull every invocation of `staging-inventory-check-order-faulty-sale` in retained
history. Split CTC from non-CTC by the reference on the invoking `faulty-sale-worker-queue-handler`
message. Report warm-only durations as counts and percentiles for each group, not means. The claim
under test is Kian's: a CTC order cannot execute because the fields it needs are absent. If CTC
durations across a real sample sit above the non-CTC warm baseline, the premise is measurably wrong
rather than doubtfully wrong, and that changes how the question is put to him.

Cold starts must be excluded explicitly, not eyeballed. `Init Duration` on the `REPORT` line is the
marker.

**D2, the write side, without the key mapping.** `staging-inventory-v2` could not be queried because
its key format has no known mapping from a Cin7 SKU or branch id. Do not solve the mapping, sidestep it:

* CloudWatch metric `ConsumedWriteCapacityUnits` on the table, one minute period, over tight windows
  around known CTC invocations, against control windows with no CTC invocation.
* If the table is on-demand and the metric is sparse, read `ItemCount` from `describe-table` either
  side of a window instead, and record that `ItemCount` is updated roughly every six hours, so a null
  result from it is UNKNOWN and not a negative.

Either result is worth having. A measured zero write closes Q27 on the bus negative plus a table
negative and needs nothing from Kian. A non-zero write in a CTC window is a defect, not a question.

**D3.** Confirm in the same read whether customer data is still unredacted in that log group. One line,
presence only, no values. Extract named fields only. Width truncation (`cut -c`, `head -c`) is not
redaction, see the R1 incident in `FINDINGS-2026-09-04.md`.

## Gate E, is there a cheaper window in the week

R10 Gate C measured 22 elevated-volume events inside the active period across roughly 4.5 days and
found no reliable gap. That measurement did not separate weekdays from the weekend, and the warehouse
dispatch batch that caused both blast-radius stops is a warehouse job, so it is plausibly weekday only.

**Revised 2026-09-07: this gate no longer has a same-day payoff.** It was written on the Sunday. Run it
anyway, because the answer sets when the remaining fixture-dependent cases can be attempted at all.

Count CTC orders per hour across the last 72 hours, split weekend from weekday, and flag every
dispatch-batch signature (tens of orders inside about 90 seconds) with its timestamp. Read only, no
watermark.

**Reads as:**

* Weekend rate materially lower and no batch signature on Saturday or Sunday: next weekend is the
  window for R3's actual scope (TC3, TC21, TC21b), and TC21b is the only case sitting INCONCLUSIVE on
  BUSY-1159. Say so with the numbers.
* No weekend difference: the only usable gap is the daily quiet period R10 already identified, and the
  fresh-fixture path has to run inside it. Record and stop.

Either way, report the batch timestamps. A batch that lands at a predictable time is a schedule the
next session can work around, which is worth more than one window.

## Stop and ask JJ if

* Gate A shows R5's own arithmetic was wrong.
* Gate B needs more than about 15 Cin7 GETs to resolve contact groups.
* Gate E looks favourable. The watermark write that follows is JJ's call, not this session's.

## Deliverable

`results/R11-pre-kian-confirmation.md`, and a revised question list for Kian with each item marked
MEASURED, INFERRED or UNKNOWN as it now stands. Update `STATE.md`. Any new question goes into
`../../BUSY-1065-OPEN-QUESTIONS.md` with the next Q number.
