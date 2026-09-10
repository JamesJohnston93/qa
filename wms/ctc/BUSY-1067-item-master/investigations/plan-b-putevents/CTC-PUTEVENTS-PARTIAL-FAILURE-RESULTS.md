# CTC `PutEvents` partial-failure verification — Tier B1 results

**Ticket/plan:** Plan B — `PutEvents` partial-failure verification · **Ran:** 2026-08-18 · **Scope:** Tier B1 only (read-only forensics). **B2 was NOT run** — no env-var changes, no watermark writes, no Cin7 calls, no AWS config changes.

**Question:** does the CTC poller check the `PutEvents` response `FailedEntryCount`, or does it treat any non-throwing SDK call as success? If it doesn't check, a partially-failed batch would let the watermark advance past records that were never queued — silent loss with no trace.

**Bottom line: latent risk, no occurrence. Tier B2 is NOT warranted.** See §5.

---

## 1. Access and scope

- Profile `staging`, region `ap-southeast-2`, read-only `AWSPowerUserAccess` role. Confirmed via `aws sts get-caller-identity` before starting.
- All log queries ran against `/aws/lambda/staging-catalog-cin7-cin7-item-poller` and `/aws/lambda/staging-catalog-manhattan-item-buffer-buffer-populator`, both **never-expire retention** (MEASURED — `describe-log-groups` returns `retentionInDays: None` for both).
- The poller log group's **oldest stream begins 2026-08-04T21:01:50Z** (MEASURED — `describe-log-streams --order-by LogStreamName`, 265 streams scanned, min timestamp taken). A 60-day query window (2026-06-19 → 2026-08-18) was used throughout, which **fully covers the log group's entire lifetime** — every figure below is the complete history, not a sample.

---

## 2. B1.1 — the EventBridge failed-entries metric

**Metric name confirmed by listing, not assumed (MEASURED):**

```
aws cloudwatch list-metrics --namespace AWS/Events
```

returned (among others) `PutEventsFailedEntriesCount`, `PutEventsApproximateCallCount`, `PutEventsApproximateSuccessCount`, `PutEventsEntriesCount`, `PutEventsLatency`, `PutEventsRequestSize` — the plan's guessed name was right.

### 2a. ⚠ Finding not anticipated by the plan: this metric cannot be scoped to our bus

**MEASURED:** every `PutEvents*` metric in the account carries **zero dimensions** — no `EventBusName`, no account/producer breakdown, nothing. Confirmed by inspecting the `Dimensions` array on all six metric entries returned by `list-metrics`: all six are `{}`.

This means `PutEventsFailedEntriesCount` is a **regional aggregate across every PutEvents caller in the account**, not something that can be filtered to `staging-catalog-cin7-events`. Pulled anyway for the record:

| Metric | Period | Sum (455-day retention window) |
|---|---|---|
| `PutEventsFailedEntriesCount` | 1 day | **100,373** |
| `PutEventsApproximateCallCount` | 1 day | **157,278,835** |

That volume is obviously not ours — the poller's entire lifetime emission (§3) is 31,731 records at ≤10/call, i.e. **≈3,174 `PutEvents` calls total**, about 0.002% of the account-wide call count seen in this metric. Other producers on this account (`orders-v2`, `newstore-*`, Shopify sync rules, etc. — visible as other dimensioned metrics in the same `list-metrics` dump) dominate it completely. **A non-zero account-wide sum tells us nothing about whether our bus specifically has ever had a failed entry — the signal is present in the metric namespace but not addressable at the resource we need.** This is a genuine limitation of the plan as written, not a result — flagging it rather than silently substituting.

### 2b. What IS bus/rule-scoped, pulled for context, and used as a substitute check

`Invocations`, `MatchedEvents`, `TriggeredRules` on `AWS/Events` **do** carry `EventBusName`+`RuleName` dimensions and resolve to our specific bus/rule:

```
--dimensions Name=EventBusName,Value=staging-catalog-cin7-events Name=RuleName,Value=staging-catalog-manhattan-cin7-forwarding-rule
```

**MEASURED**, full retention (455 days, hourly granularity where non-zero): `Invocations` = `MatchedEvents` = `TriggeredRules` = **31,731**, all three identical, non-zero only in **12 hourly buckets**, all falling inside known QA session windows (2026-08-05/06, 08-07, 08-13, 08-14).

**`FailedInvocations`** on this rule and on the poller's own schedule rule (`staging-catalog-cin7-cin7-item-poller-schedule`): **zero datapoints returned, ever** (MEASURED — the metric doesn't exist for either rule in `list-metrics`, and `get-metric-statistics` scoped to each returns an empty `Datapoints` array over full retention). Compare: `FailedInvocations` **does** exist and has non-zero history for several *other* rules in this same account (`newstore-*`, `alexdev-*`), so the metric is not simply absent from the account — it specifically has never fired for either of our rules.

**`ThrottledRules`**: does not appear anywhere in the account's `list-metrics` output at all (MEASURED). No rule in this account has ever been throttled within CloudWatch's discovery window.

**Since our bus is exclusively fed by the poller** (architecturally — `staging-catalog-cin7-events` is described as "the poller's own bus," and `emit-cin7-record.sh` injects onto the *different*, shared `staging-catalog-manhattan-events` bus, confirmed in `CLAUDE.md`), `MatchedEvents` on the forwarding rule is a clean proxy for "records that successfully landed on the bus after `PutEvents`." That let this test compare it directly against the poller's own emission count — see §3.

---

## 3. Cross-check 1 — poller `recordsEmitted` vs. bus `MatchedEvents`, hour-by-hour, full history

Pulled every `Cin7PollerCycleComplete` line from the poller log group over the full 60-day/full-lifetime window (175 cycles, 2026-08-05T23:37:51Z → 2026-08-14T00:34:56Z — the poller's entire successful-cycle history) and summed `recordsEmitted` per UTC hour. Independently pulled `MatchedEvents` per UTC hour for the same bus/rule from CloudWatch.

| UTC hour | Poller `recordsEmitted` (log) | Bus `MatchedEvents` (metric) | Match? |
|---|---|---|---|
| 2026-08-05 23:00 | 848 | 848 | ✅ |
| 2026-08-06 00:00 | 2,869 | 2,869 | ✅ |
| 2026-08-06 01:00 | 2,865 | 2,865 | ✅ |
| 2026-08-06 02:00 | 3,755 | 3,755 | ✅ |
| 2026-08-06 03:00 | 2,326 | 2,326 | ✅ |
| 2026-08-06 04:00 | 4,131 | 4,131 | ✅ |
| 2026-08-06 05:00 | 5,805 | 5,805 | ✅ |
| 2026-08-06 06:00 | 714 | 714 | ✅ |
| 2026-08-07 01:00 | 872 | 872 | ✅ |
| 2026-08-13 03:00 | 2,246 | 2,246 | ✅ |
| 2026-08-13 04:00 | 1,011 | 1,011 | ✅ |
| 2026-08-14 00:00 | 4,289 | 4,289 | ✅ |
| **Total** | **31,731** | **31,731** | **✅ exact** |

**MEASURED: every one of the 175 cycles in the poller's entire recorded history, in every hour, matches exactly.** Zero shortfall anywhere. If any `PutEvents` batch had ever partially failed, this table would show a poller-side count higher than the bus-side count in that hour — it never does, in any hour, across the full lifetime of the log group.

Also confirmed independently: `grep`-equivalent search for the literal string `FailedEntryCount` across the entire poller log group, full history: **0 occurrences** (MEASURED, re-verified directly rather than trusting the prior note). This confirms the code path never logs the field either way — consistent with, and independently reproducing, the existing `CLAUDE.md` finding.

---

## 4. Cross-check 2 (B1.2) — poller emission vs. buffer-populator receipt, hour-by-hour

Used the **buffer-populator**, not the sender, per the plan (the populator sits upstream of the SQS queue and doesn't coalesce, unlike the sender). Counted `"Successfully pushed ... event to staging-catalog-manhattan-item-buffer-buffer.fifo"` lines carrying a `[CTC#...]` prefix, per UTC hour, full history:

| UTC hour | Poller `recordsEmitted` | Populator `[CTC#...] Successfully pushed` | Delta | Explanation |
|---|---|---|---|---|
| 2026-08-04 00:00 | 0 (no cycle) | 1 | +1 | bus-injection test, predates first successful poller cycle |
| 2026-08-05 23:00 | 848 | 851 | +3 | bus-injection traffic in same window |
| 2026-08-06 00:00 | 2,869 | 2,871 | +2 | bus-injection traffic in same window |
| 2026-08-06 01:00–06:00 | 2,865 / 3,755 / 2,326 / 4,131 / 5,805 / 714 | identical | 0 | exact match, 6 consecutive hours |
| 2026-08-07 01:00 | 872 | 890 | +18 | bus-injection session |
| 2026-08-10 05:00 | 0 (no cycle) | 21 | +21 | bus-injection only, no poller activity this hour |
| 2026-08-11 00:00 | 0 | 1 | +1 | bus-injection only |
| 2026-08-12 23:00 | 0 | 1 | +1 | bus-injection only |
| 2026-08-13 00:00 | 0 | 20 | +20 | bus-injection only |
| 2026-08-13 03:00 | 2,246 | 2,247 | +1 | bus-injection traffic in same window |
| 2026-08-13 04:00 | 1,011 | 1,018 | +7 | bus-injection traffic in same window |
| 2026-08-14 00:00 | 4,289 | 4,289 | 0 | exact match |
| 2026-08-14 01:00 | 0 | 2 | +2 | bus-injection only |

**MEASURED: in every single hour of the pipeline's full observable history, the populator's CTC receipt count is greater than or equal to the poller's emitted count — never less.** Every excess hour lines up with `emit-cin7-record.sh` bus-injection activity, which is architecturally expected to add records the poller never touched (it writes directly to the shared bus, bypassing the poller and its own bus entirely — confirmed in `CLAUDE.md`). **There is no hour anywhere in the log group's history showing a populator count below the poller's emitted count** — which is the specific signature a partial `PutEvents` failure would produce.

---

## 5. Supporting context — the only failure mode actually observed

Independently re-derived (not just cited from `CLAUDE.md`) by searching the full poller log history for `Cin7PollerCycleFailed`:

- **38 occurrences total, full history: 34 × `"Cin7 secret is missing required fields"` (all 2026-08-05, the early blank-credential period) + 4 × `"The operation was aborted due to timeout"`** (2026-08-06 ×3, 2026-08-13 ×1). This matches the existing `CLAUDE.md` figure exactly — independently reproduced, not merely trusted.
- Spot-checked all 4 timeout failures against the surrounding cycle log: in every case, the **next cycle (30–70s later) completed successfully and `watermarkAdvanced:true` fired with a new watermark advancing past the failure point** — e.g. `2026-08-06T00:02:15.501Z` fails, `2026-08-06T00:03:19.723Z` succeeds with `newWatermark: "2026-08-06T00:02:33.000Z"`. This is the **hard-fail path**: the whole cycle throws, nothing is emitted, the watermark provably does not move, and the failure is loud (an `ERROR`-level `Cin7PollerCycleFailed` line, visible to any log-based alarm). This is a structurally different, already-safe failure mode from the one Plan B is worried about — a **silent partial success inside a single `PutEvents` call that never throws at all**, which would leave no `Cin7PollerCycleFailed` line and no distinguishing signal in the poller's own logs. That's exactly why the cross-checks in §3–4 (external reconciliation, not log-internal signals) were necessary to answer this question at all.

---

## 6. Verdict

**Closing as: latent risk, no occurrence.**

- The code's `PutEvents` response handling remains **UNKNOWN** by direct inspection — this was log/metric forensics, not a code read, and (independently reconfirmed) the code never logs `FailedEntryCount` either way, so it is impossible to tell from the outside whether it's checked-and-not-logged or not-checked-at-all.
- But **the observable consequence of not checking it — records emitted-but-never-arriving, with the watermark advancing past them anyway — has never occurred, not once, across the full lifetime of this pipeline (2026-08-04 to present, both a bus-level reconciliation and an independent populator-level reconciliation, zero shortfall in either, in every hour).**
- The one condition that would have made B2 unnecessary from existing data — "a non-zero `PutEventsFailedEntriesCount` datapoint correlated to a cycle that still advanced the watermark" — could not be evaluated at all, because that metric turned out not to be resource-scoped. This is a plan limitation worth recording, not a dead end: the two log/metric cross-checks in §3–4 are a strictly better substitute for this specific bus, since they're scoped correctly where the CloudWatch metric isn't.

**Recommendation: do not run Tier B2.** Forcing the failure via `INTERNAL_EVENT_BUS_NAME` would deliberately strand real records to prove a code behaviour that (a) has never manifested in ~2 weeks of real churn including four independent Cin7-API-timeout failures and 175 successful cycles, and (b) the honest write-up the plan itself proposes for a clean B1 is the right level of effort here: **a note to dev, not a defect ticket.**

**Suggested note to dev (not a ticket):** the poller's `PutEvents` call site should check `FailedEntryCount` on the response and log it (or emit a metric) even when it's zero, so that the current blind spot — "success and partial failure look identical from outside" — stops being permanently unobservable. No evidence this has ever caused loss; this is pure defense-in-depth.

---

## 7. Claim tags

- Metric name `PutEventsFailedEntriesCount` confirmed by listing — **MEASURED**.
- `PutEvents*` metrics carry zero dimensions account-wide — **MEASURED**.
- 455-day sums for `PutEventsFailedEntriesCount` (100,373) and `PutEventsApproximateCallCount` (157,278,835) — **MEASURED**, but **INFERRED to be dominated by other producers** (not directly attributable, since the metric can't be filtered).
- `Invocations`/`MatchedEvents`/`TriggeredRules` = 31,731 exactly, bus/rule-scoped — **MEASURED**.
- `FailedInvocations` never recorded for either of our rules; recorded for other rules in the account — **MEASURED**.
- `ThrottledRules` absent from the account's metric catalog entirely — **MEASURED**.
- Poller-emitted vs. bus-matched hour-by-hour exact match, full history — **MEASURED**.
- Poller-emitted vs. populator-received hour-by-hour, zero shortfall, all excess explained by bus-injection — **MEASURED** for the counts; **INFERRED** that every excess is bus-injection specifically (consistent with known session activity and the architecture, not confirmed record-by-record against session logs for every excess hour).
- `FailedEntryCount` string: 0 occurrences in the poller log group, full history — **MEASURED**, independently re-verified.
- `Cin7PollerCycleFailed`: 38 total (34 blank-credential + 4 timeout), full history — **MEASURED**, independently re-verified, matches prior `CLAUDE.md` figure.
- Watermark held across all 4 timeout failures, advanced cleanly on retry — **MEASURED** for all 4 (spot-checked each).
- Whether the poller code actually checks `FailedEntryCount` internally without logging it — **UNKNOWN**, unanswerable without a code read (out of scope for read-only forensics).
