# Plan B — `PutEvents` partial-failure verification

**Question:** does the poller check the `PutEvents` response, or does it treat any non-throwing SDK call as success?
**Why it matters:** if it doesn't check, a partially-failed batch under EventBridge throttling would let the **watermark advance past records that were never queued** — silent data loss with no trace. Same shape as the whitespace defect but one layer earlier.
**Owner:** JJ (QA) · **Drafted:** 2026-08-18 · **Status:** NOT RUN

**"Write what up?"** — raising this as a **new defect ticket** against the poller. This plan decides whether it's a confirmed defect, a latent risk worth a note, or a non-issue.

**Read first:** `claude/CTC QA — current state & results index`

---

## What we know

- `Pushed {"Entries":[...]}` logs the **outbound request, before the call.** It is **never** followed by a response, a success confirmation, or a `FailedEntryCount` check anywhere in the retained history.
- `FailedEntryCount` appears **0 times in 54,103 scanned log records** — but that is uninformative, because the code apparently never logs it either way. **Success and partial failure look identical from outside.**
- Emit is **batched ≤10 records per `PutEvents`** (2,678 of 2,821 batches are exactly 10), so a partial failure would strand up to 9 records while the 10th succeeded.
- QA cannot make EventBridge partially fail on **content** — these entries are well-formed and schema-valid.

---

## Tier B1 — free forensics. Answers "has this ever happened?"

Both checks are read-only and cost nothing.

**B1.1 — the CloudWatch metric.** EventBridge publishes a failed-entries metric in the **`AWS/Events`** namespace, dimensioned by event bus. Confirm the exact metric name first with `aws cloudwatch list-metrics --namespace AWS/Events` (expect something like `PutEventsFailedEntriesCount`; **do not assume the name — read it**). Then pull the full retained period for bus `staging-catalog-cin7-events`.

- **Sum = 0 across all history** ⇒ no partial failure has ever occurred here. The risk is **latent, not realised**.
- **Any non-zero datapoint** ⇒ it has happened. Correlate the timestamp against poller cycles and check whether the watermark advanced in that cycle. **If it advanced, the defect is demonstrated from existing data with no test needed.**

Also pull `ThrottledRules` and `FailedInvocations` on the same bus for context.

**B1.2 — emit-vs-receive reconciliation.** For a sample of cycles, compare the poller's `Cin7RecordEmitted` count (and the cycle's own `recordsEmitted`) against the number of records the **buffer-populator** logged receiving for the same window. A clean match across every cycle sampled means no records went missing between `PutEvents` and the populator. A shortfall in a cycle where the watermark still advanced is the defect, caught retrospectively.

Note the known confound: coalescing and boundary re-emission mean sender-side counts won't match poller counts — **compare against the populator, which is upstream of the queue and does not coalesce.**

**If B1 shows zero failed entries and clean reconciliation, that is a legitimate stopping point.** The honest write-up is: *no occurrence in ~41 days; the code's handling is unverified and unobservable; recommend dev add a `FailedEntryCount` check and log the response.* A note to dev, not a defect ticket.

---

## Tier B2 — force it. Only if B1 is inconclusive or you want the code's behaviour proven.

**There is a lever, and it's one I missed earlier: `INTERNAL_EVENT_BUS_NAME` is a real env var on the poller.** Confirmed present in Phase 0's `get-function-configuration` read.

**Mechanism:** `PutEvents` targeting a **non-existent event bus** does not throw — it returns HTTP 200 with per-entry failures (`FailedEntryCount` > 0, `ErrorCode: ResourceNotFoundException`). That is exactly the partial/total-failure-without-exception shape we need, and it's reachable by a single revertible env-var change.

**Method**

1. Snapshot the current value of `INTERNAL_EVENT_BUS_NAME` verbatim.
2. Snapshot the watermark and record DLQ depth.
3. Set `INTERNAL_EVENT_BUS_NAME` to a name that does not exist (e.g. `staging-catalog-cin7-events-qa-nonexistent`).
4. Set a **tight** watermark floor — minutes, so only a handful of records are in play.
5. Watch one cycle. The observable that matters: **does `Cin7PollerCycleComplete` report `watermarkAdvanced:true`?**
6. **Revert the env var immediately** and prove the revert with a fresh `get-function-configuration`.
7. If the watermark advanced, **rewind to the snapshotted floor** so the stranded records are re-covered, and confirm they land.

**Decision rule**

| Observed | Verdict |
|---|---|
| Watermark **advanced** despite every entry failing | **Confirmed defect.** The cycle treats a non-throwing `PutEvents` as success; records are silently lost. Raise it, high severity |
| Cycle failed / watermark **held** | **The code checks the response.** Non-issue — close it and record the evidence |
| Cycle threw an unhandled error | Also fine — the contract holds, just noisily. Record which |

**Risks, stated plainly**

- **Records in that cycle genuinely don't reach the pipeline.** That is the point of the test. Recoverable by rewinding to the snapshotted floor — which is why step 1 is non-negotiable.
- **Warm containers may defeat it.** If the code reads the env var at module init rather than per invocation, a warm container keeps the old bus name and the test silently does nothing. The 08-06 sessions found a Lambda config update did **not** force a cold start. **Mitigation:** confirm an `INIT_START` appears in the invocation you're measuring; if it doesn't, you are not testing what you think you are — wait for natural recycling or abandon B2 and close on B1.
- **CTC-only blast radius.** No other company's records flow through this bus. Still coordinate.
- Revert does **not** survive a deploy either way, and a deploy mid-test would silently restore the real name — check `LastModified` before and after.

---

## Deliverable

`CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md` in `testing-tools/`. B1 findings first with the exact metric name used and the reconciliation table; B2 only if run, with the env-var snapshot, the revert proof, and an `INIT_START` confirmation. Every claim tagged **MEASURED / INFERRED / UNKNOWN**. Close with the decision-rule verdict and, if it's a defect, a drafted ticket body.

Then update `claude/CTC QA — current state & results index` open item 3.

---

## Kick-off prompt (fresh session)

```
Read the project doc "Plan B — PutEvents partial-failure verification" and CLAUDE.md in
~/Desktop/testing-tools. Run TIER B1 ONLY and stop. Read-only: no Cin7 calls, no watermark writes,
no config changes. Do not run B2.

The question: does the CTC poller check the PutEvents response FailedEntryCount, or does it treat any
non-throwing SDK call as success? If it doesn't check, a partially-failed batch would let the
watermark advance past records that were never queued - silent loss with no trace. I need to know
whether that has ever actually happened before deciding whether to raise a defect.

B1.1 - Find the EventBridge failed-entries metric. Run
  aws cloudwatch list-metrics --namespace AWS/Events
FIRST and read the actual metric name rather than assuming it - I think it's something like
PutEventsFailedEntriesCount but confirm. Then pull the full retained period for event bus
staging-catalog-cin7-events. Report the sum and any non-zero datapoints with timestamps. Also pull
ThrottledRules and FailedInvocations on the same bus for context.
  - If you find a non-zero datapoint, correlate its timestamp to the poller cycle covering it and
    check whether that cycle logged watermarkAdvanced:true. That combination would demonstrate the
    defect from existing data with no test needed - chase it if you find it.

B1.2 - Emit-vs-receive reconciliation. For a decent sample of cycles, compare the poller's
recordsEmitted / Cin7RecordEmitted counts against the number of records the BUFFER-POPULATOR logged
receiving for the same window. Use the populator, not the sender - the sender coalesces and the
populator doesn't, so only the populator gives a clean comparison. Report any cycle with a shortfall,
and for any shortfall check whether the watermark still advanced.

Write CTC-PUTEVENTS-PARTIAL-FAILURE-RESULTS.md with a B1 section only. Tag every claim MEASURED /
INFERRED / UNKNOWN, and state the exact metric name you used. Then say whether this closes as
"latent risk, no occurrence" or whether Tier B2 (forcing it via the INTERNAL_EVENT_BUS_NAME env var)
is warranted. Do not run B2.
```
