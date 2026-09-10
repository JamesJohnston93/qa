# QA DOC - BUSY-1117 (new)

**Status: DRAFT — no BUSY-1117 QA doc exists in the QD space today.** Its findings currently live only
inside the 1114/1115/1116 docs and `CLAUDE.md`. This draft consolidates them into a standalone page.
JJ creates and applies this by hand. **Drafted:** 2026-08-18.

**Scope of BUSY-1117 (as understood from existing docs):** observability for the CTC/Manhattan
pipeline — metrics, alarms, dashboard, alerting. This doc covers what was actually measured about that
observability layer, separate from the item-sync correctness work in 1113–1116.

---

## Sign-off

**Ticket is in Review.** ⚠ **AC4 cannot pass as written** — see the AC map below. The remaining ACs are
a mix of pass-with-caveat and not-run. Nothing here is a code defect; the gaps are notification
plumbing, an untested dashboard, and one alarm that cannot distinguish idle from outage.

### AC coverage map (ACs quoted from the Jira ticket)

| AC | Verdict | Basis |
|---|---|---|
| **AC1** — breaking the staging Cin7 credentials fires the watermark-staleness alarm within ~2 hours | **PARTIAL** | The alarm exists and demonstrably trips after ~2h with no `Cin7PollerCycleComplete`, which is what broken credentials would cause — and there is real historical precedent: **34 `Cin7PollerCycleFailed` events with `"Cin7 secret is missing required fields"` on 2026-08-05**. But **the scenario was never deliberately forced**, and whether the alarm actually fired during that incident was not verified. ⚠ Compounded by §4 — the alarm cannot distinguish a genuine credential outage from an ordinary `UNSET` idle period, so a firing is not by itself evidence the AC's scenario occurred |
| **AC2** — a single failed cycle raises no alarm; 3 consecutive poller errors do | **NOT RUN** | `staging-catalog-cin7-poller-errors` exists and reads `OK`. Neither half was tested: no single-blip suppression check, no 3-consecutive-error check. ✅ **A free check is available and worth doing:** 4 single `TimeoutError` cycle failures are already in the retained logs (2026-08-06 ×3, 2026-08-13 ×1) — confirming the alarm did **not** fire for any of them would close the first half at zero cost |
| **AC3** — dashboard shows fetched/emitted counts per cycle, watermark age, and 429 count alongside per-company pipeline metrics | **NOT RUN** | `staging-catalog-manhattan-observability-dashboard` is confirmed to exist and `check-status.sh` auto-detects it, but **its panels have never been reviewed against this AC's list**. ⚠ Note two things that constrain what the dashboard can show: the 429 count will be permanently zero (**no 429 has ever occurred** — zero 4xx of any kind in the poller's entire history), and per-company breakdown is **log-level only** since every sender metric carries `Dimensions: []` (the carried-over BUSY-1113 gap) |
| **AC4** — alarm notifications arrive by email via the shared alerts topic subscription | **⚠ FAIL — cannot pass as written** | `staging-catalog-manhattan-observability-alerts` has **zero subscriptions** (§2). No alarm on this pipeline can deliver an email to anyone. The intended recipient list is an SSM parameter that is not seeding any subscription, and the business distribution address (**LLD OQ-4**) has been unresolved since **2026-07-31**. **This is a genuine AC failure, not a footnote** — it needs either the address supplied and the subscription created, or the AC explicitly descoped with a stated reason |
| **AC5** — empty cycles (zero items fetched) raise nothing | **PASS with a documented caveat** | Empty cycles are the norm and none has ever raised an alarm. ⚠ **But this holds only for a cycle that runs with a real watermark set** and logs `Cin7PollerCycleComplete` while finding nothing. The `UNSET` no-op branch is a **different code path** — it logs only `Cin7ItemPollerInactive`, never `Cin7PollerCycleComplete`, so it **does** trip `cin7-watermark-stale` after ~2h (§4). The AC as written doesn't distinguish the two, and the distinction is the whole of §4 |

**Cheapest route to improving this picture:** AC2's first half is free from retained logs, and AC3 is a
single dashboard review. AC4 needs a decision from someone outside QA.

### Findings detail

## 1. Sender-validation alarm — earlier finding WITHDRAWN, corrected here

**⚠ An earlier pass recorded "no alarm watches CTC validation failures" as a confirmed gap. That finding
was wrong and is withdrawn.**

`staging-catalog-manhattan-sender-validation-failures` **exists**, in the correct namespace, watching
the correct metric (`SenderValidationFailures`), with threshold **>10 in 900s** (1 evaluation period),
targeting the shared `staging-catalog-manhattan-observability-alerts` SNS topic. Configured
**2026-08-10T04:51:19Z** — before the investigation that "found" it missing. It has a **real recorded
near-miss datapoint of 9 against the threshold of 10** at `2026-08-13T04:43:00Z`.

**Why it was missed:** `check-status.sh` never queried that alarm name (see §6). The alarm itself was
never broken — the tooling reading it was.

**The real, narrower gap:** the alerts topic it fires into has zero subscribers (§2). A correctly-firing
alarm that notifies nobody is a notification-plumbing gap, not a missing-alarm gap. **Do not conflate
the two in any writeup** — they have different owners and different fixes.

There is also a separate `staging-catalog-cin7-validation-failures` alarm on the **poller's** log group
(metric filter on `ManhattanValidationFailure`). It is a poller-side signal and does **not** watch
sender/CTC item validation failures — don't mistake it for the one above.

---

## 2. Alerts SNS topic — zero subscriptions

`staging-catalog-manhattan-observability-alerts` has **zero subscriptions** in staging. Nothing in
staging currently notifies anyone when any alarm on this pipeline fires — not just the validation
alarm in §1, but every alarm that targets this topic, including `send-dlq-depth` (§3).

The intended recipient list is an SSM parameter,
`/catalog/manhattan-observability/alert-emails/staging`, which is presumably meant to seed the
subscription but currently does not.

**This is the actual observability gap in this ticket's scope** — not absent alarms, but alarms that
fire into a topic nobody listens to. ⚠ **And it is not merely a gap: it is the direct cause of AC4
failing.** AC4 requires notifications to arrive by email. With zero subscriptions none can. Treat this as
the one item on this ticket that needs a decision before sign-off, and note the blocker is the unresolved
business distribution address (LLD OQ-4, open since 2026-07-31), not anything in the code.

---

## 3. `send-dlq-depth` alarm — threshold known, but saturated

Threshold is exact: **`depth > 0`, 1 × 300s period** — any single message on the buffer DLQ fires it.
It has been **in ALARM continuously since 2026-08-10**, because the DLQ currently holds 19 messages
(all attributable QA evidence from named sessions — see `CLAUDE.md` environment-state section — none
deleted).

**Consequence: a fresh ALARM→OK→ALARM transition cannot be demonstrated while the DLQ holds this
evidence.** This is a limit on *demonstrating* the alarm works, not on *knowing* its configuration —
the threshold and period are directly read from the alarm definition, not inferred from behaviour.

Don't confuse this alarm's `>0/300s` threshold with the validation alarm's `>10/900s` (§1) — they
watch different metrics with different sensitivities.

---

## 4. `cin7-watermark-stale` — fires on ordinary idle, not just outage

This alarm watches `Cin7PollerCycleComplete` only. While the watermark is `UNSET` (the expected idle
state — see `CLAUDE.md` Hard Constraint 4), the poller logs `Cin7ItemPollerInactive` and never
`Cin7PollerCycleComplete`, so the alarm trips after roughly two hours of *any* idle gap — including a
deliberate, correct `UNSET`.

**Practical consequence for on-call / dashboard review: check whether the watermark has simply been
idle before treating a firing of this alarm as a real outage signal.** As written, it cannot
distinguish "poller stopped working" from "nobody is testing right now."

---

## 5. `PutEventsFailedEntriesCount` — cannot be scoped to our bus

Confirmed by listing (`aws cloudwatch list-metrics --namespace AWS/Events`): every `PutEvents*` metric
in the account, including `PutEventsFailedEntriesCount`, carries **zero dimensions** — no
`EventBusName`, no per-producer breakdown. It is a **regional aggregate across every `PutEvents` caller
in the account**.

Measured 455-day sums: `PutEventsFailedEntriesCount` = 100,373; `PutEventsApproximateCallCount` =
157,278,835. The poller's entire lifetime is ≈3,174 `PutEvents` calls (31,731 records at ≤10/call) —
about 0.002% of the account-wide call volume in this metric. The non-zero aggregate is almost
certainly other producers on the same account (other EventBridge rules visible in the same
`list-metrics` dump), not attributable to us.

**Consequence for any future 1117 monitoring/alarm design: do not build an alarm around this metric
expecting it to be scoped to this pipeline. It cannot be.** What *is* bus/rule-scoped and usable:
`Invocations`, `MatchedEvents`, `TriggeredRules`, `FailedInvocations` (dimensioned by
`EventBusName`+`RuleName`). `FailedInvocations` has never fired for either of our rules
(`staging-catalog-manhattan-cin7-forwarding-rule` or the poller's own schedule rule) across full
retention, while it has fired for other rules in the same account — so its absence here is a
meaningful negative, not just missing data.

This finding came out of Plan B (`CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md`), which was scoped to
BUSY-1116's item-sync question, but the dimensionality limitation itself is a 1117 observability
finding and belongs in this doc, not just there.

---

## 6. `check-status.sh` — two bugs, both fixed

Prior to 2026-08-18, `check-status.sh` had two bugs that masked the corrected finding in §1:

1. Doubled `cin7-cin7-` alarm-name lookups (should have been the single `cin7-` prefix the deployed
   alarms actually use).
2. `staging-catalog-manhattan-sender-validation-failures` was never in the checked list at all.

**Both fixed 2026-08-18.** The script's alarm summary can be trusted again going forward.

---

## Not substantiated from the results files — flagged, not filled in

- **Whether the alerts topic's SSM recipient parameter is actually wired to anything** — confirmed
  empty of subscriptions, but no results file traces whether infrastructure code references that SSM
  param at all, or whether it's simply unused. Worth one question if this ticket's fix touches the
  topic.
- **Dashboard content review** — `staging-catalog-manhattan-observability-dashboard` is confirmed to
  exist and be auto-detected by `check-status.sh`, but no results file describes reviewing its panels
  for correctness. Out of scope for this draft unless JJ has already done that pass elsewhere.
