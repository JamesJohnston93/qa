# BUSY-1116 Phase 3 Results — Failure injection (destructive)

**Date:** 2026-08-14 · **Author:** Claude (QA session) · **Scope:** Phase 3 of `BUSY-1116-RETEST-PLAN.md` Rev 2, per this session's kick-off (cases TC1, TC2, TC3, ERR1, ERR5, STR3, ERR3 alarm threshold, ERR2). Read Phase 0/1/2 results first — this file assumes their findings (populator not redeployed, no `MAX_PAGES_PER_RUN`/Cin7-base-URL env var on the poller, DLQ baseline 18, watermark `UNSET`).

**Method note (same convention as Phase 0–2):** every claim is tagged **MEASURED**, **INFERRED**, or **UNKNOWN**.

---

## 0. Reverted-but-unverified / still-open items — READ FIRST

**Nothing was left reverted-but-unverified this phase.** No AWS/Lambda configuration was changed at any point (see §1 — both TC1/TC2 levers were assessed as inapplicable/not worth attempting rather than tried-and-reverted). No watermark write was made — it was `UNSET` at the start and is confirmed `UNSET` at the end, untouched throughout. The only mutating actions this session were bus-injections (`emit-cin7-record.sh --confirm`, three sends onto the shared internal bus) and the DLQ purge described in §7.

**Still open, not closed by this phase, carried forward:**
1. **ERR2 (Manhattan endpoint unavailable) — DEFERRED, JJ's explicit call this session.** Blast radius (every store's sends via the shared `staging/manhattan/oauth2` secret) was judged too broad for this pass. Not attempted. See §6.
2. **TC1/TC2/ERR1's poller-side forced failure is still not QA-executed from outside** — closed on dev attestation only (§1). This is unchanged in kind from the 08-06/Phase-0-2 position; nothing new was forced.
3. **TC3's poller-layer (PutEvents-to-own-bus) partial-batch question is a genuine, newly-identified open verification gap**, not just "not run" — see §2. It needs a source-code answer from dev, not more QA black-box testing.
4. ~~The STR3 poison probe was still draining to the DLQ as this file was first drafted~~ — **RESOLVED before this session ended.** It landed at `2026-08-14T01:30:57Z` (11 receives, ~30m24s from first enqueue), body intact. DLQ is fully reconciled — see §7. Nothing left open here.

---

## 1. TC1 / TC2 / ERR1 — forced poller failure (Products fail, then ProductOptions fail, missing-`item_code` sender crash)

### Fresh deploy-state re-check (MEASURED, this session)

Re-ran `get-function-configuration` on the poller fresh (not reused from Phase 0/2):

```
staging-catalog-cin7-cin7-item-poller
  LastModified: 2026-08-12T22:45:44Z  (unchanged)
  Environment.Variables: WATERMARK_PARAMETER_NAME, STAGE, CIN7_SECRET_NAME,
                         AWS_NODEJS_CONNECTION_REUSE_ENABLED, INTERNAL_EVENT_BUS_NAME
```

**Third independent confirmation (Phase 0, Phase 2, now Phase 3) of the same five env vars, in the same order, unchanged.** No `MAX_PAGES_PER_RUN`. No Cin7-base-URL-shaped variable of any kind. The only Cin7 connectivity configuration surface on this Lambda is `CIN7_SECRET_NAME=staging/catalog/cin7` — a Secrets Manager reference, not an env var.

### Lever (a) — invalid `MAX_PAGES_PER_RUN`

**Assessed, not attempted.** The plan's own text frames this as a config-parse throw "at init" — i.e. at Lambda cold start / module load, not per-invocation. That means its only chance of ever firing is on a *fresh* container. Phase 0/2 (and CLAUDE.md's own documented history) already establish that this specific defeat mechanism — warm-container reuse silently absorbing a Lambda configuration update without a cold start — is exactly what defeated the 08-06 attempts, including literally "a Lambda config update (add/remove a no-op env var) did NOT force a cold start (no `INIT_START` in the next invocation)". Setting a brand-new `MAX_PAGES_PER_RUN=NOT_A_NUMBER` key is the same category of action against the same container, subject to the same defeat mechanism — it is not a materially different lever from the one already disproven, it is a different variable name applied to an already-disproven technique. Combined with three independent sessions confirming this constant isn't even read from the environment on this deployment (it has never once appeared, and the page cap has never fired in ~54,000+ scanned log records across every churn level observed, including a 1,764-record single cycle — Phase 0 §3/C2), spending a live watermark window to reconfirm an outcome already predicted by the existing evidence base was judged not worth the real Cin7 cost and the exposure of an active watermark window on shared infrastructure. **Recorded as: lever assessed, not exercised, on this reasoning — flagged transparently rather than silently skipped, so this call can be revisited if JJ wants it forced anyway.**

### Lever (b) — Cin7 base-URL env var

**Confirmed inapplicable, not just untried.** The plan's own wording is conditional: *"if a Cin7 base-URL env var exists, point it at an unroutable host."* It does not exist (§ above, fresh check). The only other place Cin7 connectivity is configured is inside the `staging/catalog/cin7` secret itself — redirecting or corrupting that secret is explicitly the **"secret corruption"** category the hard constraints for this phase say not to repeat. So this lever has no available form that isn't already excluded.

### Verdict

**Neither cheap lever is available to try, for reasons stronger than "tried and failed": one (`MAX_PAGES_PER_RUN`) doesn't exist and would be defeated by the identical warm-container mechanism already proven against a like-for-like action; the other (Cin7 base-URL) doesn't exist and its only substitute is explicitly forbidden.** Per the kick-off's own instruction, **TC1/TC2/ERR1 close on the dev integration-test attestation.**

**Attestation obtained fresh this session (read-only Jira lookup, BUSY-1116, better evidence than Phase 0 had — Phase 0 only paraphrased "Kian's 31 Jul comment"):**

> Kian Noctor, comment on BUSY-1116, **2026-07-31T08:44:17+10:00**:
> *"Implementation and live staging verification are done — all three forced-failure cases are covered, coalescing and a full re-sync were proven live, and the runbook is written and published to Confluence. ... Added the last missing forced-failure test (second endpoint failing), closing out AC #1."*
>
> Kian Noctor, comment on BUSY-1116, **2026-07-31T16:36:16+10:00**:
> *"Live-tested the watermark's failure-recovery behavior, confirming failed cycles never lose data and overlapping re-syncs converge correctly. ... this surfaced a real bug, now fixed: large backfills could exceed the poller's execution time limit and get stuck retrying the same window (fixed by batching how records are emitted)."*
>
> PR: https://github.com/UniversalStore/monorepo/pull/1522 (2026-08-03T12:31:01+10:00)

**Caveat, stated plainly for the sign-off table:** this attestation is a narrative summary, not a named test file / test name / CI run link — Kian's comments describe live-testing "on a personal dev stage" (his words, 31 Jul second comment), not an automated integration-test suite with a citable green run. **This is weaker evidence than "test file + test names + last green run" (Phase 0 §5.4's original ask), and that specific ask is still open** — if a harder citation is needed for sign-off, it has to come from Kian directly (test file path, test names, CI link), not from re-deriving it from these comments. Recording this distinction rather than overstating what was obtained.

**ERR1 (missing-`item_code` sender crash) is unchanged from all prior sessions** — this is the well-established, already-confirmed-live defect (crash-not-skip, bisects, lands in DLQ after ~10 retries). Nothing new to add; not re-run this phase (re-running it would just reproduce `BUSY-1115-CLOSEOUT-RESULTS.md`'s already-verbatim evidence at real cost for zero new information).

---

## 2. TC3 — mid-emit / partial-batch failure, re-framed for the new ≤10-per-`PutEvents` batching (C3)

Two distinct layers exist between "Cin7 record" and "delivered to Manhattan," and C3 changed the batching shape of the **first** one. Both needed separate treatment.

### 2.1 Poller layer — poller's own `PutEvents` (≤10 records/call) onto `staging-catalog-cin7-events`

**Log-forensics only; this failure mode cannot be forced from outside, and — this is the important finding — it may not even be observable if it happened organically.**

CloudWatch Logs Insights query, full retained history (`/aws/lambda/staging-catalog-cin7-cin7-item-poller`, 54,103 records scanned):

```
fields @timestamp, @message | filter @message like /FailedEntryCount/ | limit 50
→ recordsMatched: 0
```

**Zero occurrences, ever.** But the more important finding is *why* that's inconclusive rather than reassuring: I pulled several real `"Pushed {\"Entries\":[...]}"` log lines (e.g. `2026-08-14T00:34:56.868Z`, three consecutive 10-entry batches from a live cycle) and confirmed **this line logs the outbound `PutEvents` request payload, logged before the call — it is never followed by any logged response, success confirmation, or `FailedEntryCount` check.** There is no companion log line anywhere in the retained history that confirms a `PutEvents` call actually succeeded, partially failed, or fully failed at the EventBridge-response level.

**MEASURED consequence:** if EventBridge ever returned `FailedEntryCount > 0` for a subset of a ≤10-record batch (e.g. under real throttling), there is currently **no code-observable trace of it either way** — success and partial-failure look identical from outside (both just show the pre-send "Pushed" line and then, downstream, either the record turns up at the populator or it doesn't). This is structurally the same shape of risk as the ERR5/whitespace defect (a fault with zero log trace), except **one layer earlier** — before the record even reaches the shared bus, let alone the populator.

**This cannot be forced by QA**: EventBridge `PutEvents` doesn't fail sub-entries based on payload content (all these entries are well-formed JSON matching the expected schema) — a real partial failure needs actual service-side throttling or an outage, which isn't something bus-injection or watermark control can reach, and deliberately inducing EventBridge-level faults is outside any lever available here.

**Verdict: UNVERIFIED, and worse than "not run" — this is an open verification gap that needs a source-code answer, not more black-box QA.** The concrete question for dev: does the poller check `PutEventsCommand`'s response `FailedEntryCount` and retry/fail-the-cycle on a nonzero value (protecting the watermark, per AC1's intent), or does it treat any non-throwing SDK call as success regardless of per-entry results (which would mean a partial `PutEvents` failure could silently advance the watermark past records that were never actually queued)? **Recommend raising this as a new finding** — it's exactly the class of gap `STRESS-AND-ERROR-TEST-CASES.md` already flags as worth a dedicated "GE9: faults before the queue" case, and this is a second instance of that class, one layer upstream of the known ERR5 one.

### 2.2 Sender layer — coalesced-send partial-batch rejection (the "mid-emit" mechanism downstream of the buffer)

**Fresh, clean, deliberately-forced live evidence this session (see §5, STR3) — the best evidence yet for this layer, better than Phase 2's organic timeout examples because it's a controlled rejection, not an incidental one:**

A 2-item coalesced send (`{"metric":"ManhattanBatch","received":2,"coalesced":2}`) containing one guaranteed-reject item (`dimension_uom=M`) and one healthy control item was sent to Manhattan in **one call**. Manhattan's own response reported `acceptedTransactions:1, rejectedTransactions:1` for that single 2-item call — Manhattan does not identify *which* item was rejected, only counts. The sender logged `Permanent failure sending group [POISON, CONTROL]` (both codes) for that call, then — **one second later, the very next invocation** — retried and delivered `CONTROL` alone (`accepted=1 rejected=0`, `ManhattanRequestOutcome: success`), while `POISON` continued retrying alone on its own ~3-minute cadence. **Total time from send to `CONTROL`'s confirmed delivery: ~22 seconds**, despite having been in the same rejected batch as the poison item one cycle earlier.

**Verdict: PASS at this layer, freshly and cleanly reconfirmed.** The sender's bisection/isolation mechanism correctly separates a rejected item from a healthy one sharing the same coalesced call, and does so fast — consistent with (and a cleaner demonstration than) Phase 2's organic `network_error`/timeout evidence and the historical GE3/ST8 findings.

### 2.3 TC3 overall verdict

**PARTIAL, same shape as before but for a new reason.** The sender-layer partial-batch mechanism is well-evidenced and passes. The poller-layer partial-batch question — the one C3 specifically re-framed TC3 around — **cannot be exercised or even observed from outside**, and that inability is itself the finding: current logging gives no visibility into `PutEvents` response-level partial failures at all. Do not read "zero occurrences in logs" as "never happens" — read it as "would be invisible either way."

---

## 3. ERR5 — whitespace `item_code`, confirm-still-broken (gated on Phase 0's populator finding)

### Gate re-check (MEASURED, fresh this session)

```
staging-catalog-manhattan-item-buffer-buffer-populator
  LastModified: 2026-08-03T13:02:56Z   (unchanged — third independent confirmation: Phase 0, CTC-FINAL-QA-PASS 08-13, now Phase 3)
  DeadLetterConfig: null
  EventInvokeConfig: none
```

**Not redeployed. Per the kick-off's own gating instruction, this is a confirm-still-broken pass, not a re-test of a fix.**

### Live confirmation

`emit-cin7-record.sh --item-code "QA-P3-ERR5 INTERIOR" --confirm`, sent `2026-08-14T00:59:36Z` — an interior-space shape, matching the CLAUDE.md-documented real-live-shaped repro (`'WTW23-922G  -XS'`), not just a leading/trailing edge case.

**MEASURED, verbatim from `staging-catalog-manhattan-item-buffer-buffer-populator` logs, RequestId `0f632228-...`:**
```
INFO  Received event: ... "item_code":"QA-P3-ERR5 INTERIOR" ...
INFO  params { MessageGroupId: 'CTC#QA-P3-ERR5 INTERIOR', ... }
INFO  InvalidParameterValue: Value CTC#QA-P3-ERR5 INTERIOR for parameter MessageGroupId is invalid.
      Reason: MessageGroupId can only include alphanumeric and punctuation characters. 1 to 128 in length.
      ... (full stack trace, caught internally)
END RequestId: 0f632228-...
REPORT ... Duration: 967.80 ms ...
```

No `ERROR`-level unhandled-invocation marker, no re-throw — the exception is logged at `INFO` and swallowed, exactly as previously documented. The Lambda invocation completes "cleanly" (`END`/`REPORT`, no `Invoke Error`).

**Metric re-check (MEASURED, `AWS/Lambda` namespace, 2026-08-14T00:30–01:30Z, 5-min periods):**
```
Invocations: 407 (sum)
Errors:        0 (sum) — zero datapoints above 0 in the entire window
```

**Confirms Phase 1's finding again, on a fresh live throw: `Invocations` increments, `Errors` never does**, because the exception never reaches Lambda's own unhandled-error path. Any alarm built on this Lambda's `Errors` metric would still see nothing.

**Verdict: CONFIRM-STILL-BROKEN, unchanged.** The record vanishes upstream of the SQS queue with zero DLQ trace, zero `Errors` metric signal — exactly as documented since 08-07. No new information; the defect is unfixed, as Phase 0's gate predicted before this test was even run.

---

## 4. STR3 — poison + healthy throughput, at scale (regression)

See §2.2 for the full mechanism (shared evidence with TC3's sender-layer verdict — this is the same live test, reported once and cross-referenced rather than duplicated).

**Sequence (MEASURED, all timestamps from sender CloudWatch logs):**

| Time | Event |
|---|---|
| 01:00:25.447 | Poison sent (`dimension_uom=M`) |
| 01:00:26.761 | Control sent, ~1.3s later |
| 01:00:39 | First sender invocation: both pulled together, `received:2, coalesced:2` |
| 01:00:43.623 | Manhattan responds `accepted:1, rejected:1` for the 2-item call; sender logs permanent failure for **both** codes (can't tell which from Manhattan's count-only response) |
| 01:00:44.602 | **Next invocation, ~1s later:** control retried alone, `received:1, coalesced:1` |
| 01:00:47.863 | Control **delivered** — `ManhattanRequestOutcome: success`, `ManhattanItemsDelivered count:1` |
| 01:03:38 / 01:06:38 / 01:09:38 ... | Poison retried alone every ~3 min (buffer flush cadence), rejected each time (`Invalid dimension um "M"`), isolated — never blocks anything else |

**Control record: sent → isolated → delivered in ~22 seconds, despite sharing its first send attempt with a poison record.** Poison continues retrying alone toward `maxReceiveCount` (10) / DLQ, on schedule (§7 records the landing).

**Verdict: PASS, cleanly reconfirmed.** Consistent with (and a tighter, more deliberate demonstration than) the historical GE7/ST8/Phase-2 evidence — poison isolation does not block healthy throughput, and isolation-to-delivery is fast (~22s here, ~13s in the prior 08-07 ST8 case — both well under the ~30-minute poison-to-DLQ timescale).

---

## 5. ERR3 — DLQ landing + alarm fire threshold

### Alarm threshold — SETTLED from configuration (MEASURED), not just "can't observe a fresh transition"

```
aws cloudwatch describe-alarms --alarm-names staging-catalog-manhattan-send-dlq-depth
  ComparisonOperator: GreaterThanThreshold
  Threshold: 0.0
  EvaluationPeriods: 1
  Period: 300 (5 min)
  State: ALARM since 2026-08-10T06:09:50Z
  StateReason: "Threshold Crossed: 1 datapoint [1.0 (10/08/26 06:03:00)] was greater than the threshold (0.0)"
```

**The threshold itself is fully known and precise: `depth > 0`, evaluated over a single 5-minute period.** In plain terms — *any* message landing in the DLQ, even one, is sufficient to fire this alarm within one 5-minute evaluation window. This is a stricter/more sensitive threshold than CLAUDE.md's "11 in 15 min" figure, which is the **validation-failure** alarm's threshold (a different alarm, confirmed in Phase 1 §4/ERR4 as `staging-catalog-manhattan-sender-validation-failures`, watching `SenderValidationFailures`, threshold `>10` in 900s) — don't conflate the two when writing this up.

**What genuinely can't be re-demonstrated, and why it doesn't matter for this question:** a fresh `OK → ALARM` transition, because the alarm has been saturated in `ALARM` since 2026-08-10 and a new arrival on top of an already-`ALARM`'d metric produces no new state transition or fresh SNS publish. **This is a saturation problem, not an unknown-threshold problem** — the config above is a complete, precise answer to "what is the alarm fire threshold," even though the live end-to-end fire-and-notify path can't be watched fresh in this environment. State it as an environment limit on **demonstration**, not a gap in **knowledge**.

### DLQ landing

**CONFIRMED, MEASURED.** DLQ depth changed `18 → 19` at **2026-08-14T01:30:57Z** (live-monitored). Peeked the new message directly (`aws sqs receive-message`, 5s visibility timeout, non-destructive — returned to the queue automatically):

```
MessageGroupId: CTC#QA-P3-STR3-POISON-20260814T010025Z
SentTimestamp:  1786669233227  (= 2026-08-14T01:00:33Z, i.e. the group's first enqueue)
ApproximateReceiveCount: 11
Body: {"message_group_id":"CTC#QA-P3-STR3-POISON-20260814T010025Z", ... "dimension_uom":"M", ...}
      — byte-for-byte identical to the original emitted payload, nothing altered/truncated.
```

**11 receives (1 initial + 10 retries) from first enqueue (01:00:33Z) to DLQ landing (01:30:57Z) — ~30 minutes 24 seconds, matching the documented `maxReceiveCount=10` / ~3-minute-cadence pattern exactly.** Body intact, zero data loss — consistent with every prior poison-landing observation in this project (GE7, ST8, Phase 2's organic timeouts).

**Verdict: PASS, cleanly reconfirmed.** Landing mechanism unchanged from all prior sessions; nothing about the new batched-emit deploy altered it.

---

## 6. ERR2 — Manhattan endpoint unavailable

**DEFERRED — JJ's explicit decision this session, asked directly given the blast radius.** Corrupting `staging/manhattan/oauth2`'s `client_secret` affects **every store's sends** (UNI, PS, CTC), not just the CTC pipeline under test, for the duration of the corruption. Presented as a choice (run now with proven restore, vs. defer) before touching anything; JJ chose **defer**. Nothing was attempted — no secret was read or touched. **Legitimate outcome per the plan's own framing** ("deferring with a stated reason is a legitimate outcome"). Carries forward unchanged to Phase 4/future sign-off discussion.

---

## 7. Teardown and reconciliation

**Final state, confirmed MEASURED at session end:**

```
Watermark: UNSET (unchanged throughout this entire phase — no write was ever made;
           TC1/TC2's lever was assessed, not exercised, per §1)
staging-catalog-manhattan-item-buffer-buffer.fifo: 0 waiting, 0 in-flight
staging-catalog-manhattan-item-buffer-dlq.fifo:    19 waiting, 0 in-flight
```

**DLQ: 18 → 19, exactly +1, exactly accounted for.** The single new arrival is `QA-P3-STR3-POISON-20260814T010025Z` (confirmed §5), landed and peeked with body intact. Nothing else this phase could have added to the DLQ: the ERR5 whitespace probe cannot land there by construction (dies upstream in the populator — §3); `QA-P3-STR3-CONTROL-20260814T010025Z` delivered successfully (§4); no watermark rewind occurred; ERR2 was deferred untouched. **Not purged** — per this session's own poison record and consistent with the project convention of leaving named/attributable QA evidence in place rather than purging mid-investigation (the naming, `QA-P3-*`, makes it identifiable on a future check same as prior sessions' `QA-B2-*`/`QA-D0-*` messages already sitting in the same queue).

**Buffer queue:** confirmed drained to 0/0 — the poison's final retry cycle completed and it moved to the DLQ; nothing left in-flight.

**No AWS resource configuration was changed at any point in this phase.** The only mutating actions were three `emit-cin7-record.sh --confirm` bus-injections (ERR5 interior-whitespace probe, STR3 poison, STR3 control) — all onto the shared internal bus, none touching Cin7, secrets, IAM, or Lambda config.

---

## Phase 3.5 — follow-ups

**Session: 2026-08-19, strictly read-only. Stage staging, profile staging, region ap-southeast-2. No watermark writes, no AWS config changes, no Cin7 rewinds. Ran alongside a separate concurrent session doing a forced blank-secret test — that session's own files were not touched.**

### 1. The 2026-08-13T04:43Z SenderValidationFailures near-miss (9/900s, threshold >10) — NOISE, not a real cluster

**MEASURED**, from `describe-alarm-history` on `staging-catalog-manhattan-sender-validation-failures`:

```
"newState":{"stateValue":"OK","stateReason":"Threshold Crossed: 1 datapoint [9.0 (13/08/26 04:43:00)]
was not greater than the threshold (10.0).","stateReasonData":{...,"startDate":"2026-08-13T04:43:00.000+0000",
"evaluatedDatapoints":[{"timestamp":"2026-08-13T04:43:00.000+0000","sampleCount":9.0,"value":9.0}]}}
```

The evaluated 900s window is `[2026-08-13T04:43:00Z, 04:58:00Z)`. Pulling the sender log group
(`/aws/lambda/staging-catalog-manhattan-item-sender`) for exactly that window returns **exactly 9**
`ManhattanSenderValidationFailure` lines — matching the alarm's datapoint precisely:

```
04:45:35.838  company=CTC reason=item_code_too_long item_code=<51 "S" chars>
04:45:35.872  company=CTC reason=item_code_too_long item_code=<51 "S" chars>
04:45:35.878  company=CTC reason=item_code_too_long item_code=<53 "S" chars>
04:45:35.907  company=CTC reason=item_code_too_long item_code=<53 "S" chars>
04:45:35.930  company=CTC reason=item_code_too_long item_code=<56 "S" chars>
04:48:35.889  company=CTC reason=item_code_too_long item_code=<51 "S" chars>
04:48:35.909  company=CTC reason=item_code_too_long item_code=<51 "S" chars>
04:48:35.918  company=CTC reason=item_code_too_long item_code=<53 "S" chars>
04:51:35.899  company=CTC reason=item_code_too_long item_code=<51 "S" chars>
```

**All 9 are `company:"CTC"`, `reason:"item_code_too_long"`, and all 9 item_codes are literal `"SSSS...S"`
placeholder strings** — not real Cin7 product data — at exactly **3 distinct lengths (51/53/56 chars,
all >50, the `Item` field limit)**. Widening the query to the full retained history around this event
shows the **same 3 lengths (plus a 4th, 64 chars) recurring every ~3 minutes from 2026-08-13T04:15:36.921Z
through 04:51:35.899Z — a ~36-minute span — then nothing after.** That is the documented uncaught-throw
retry pattern (**10 retries over ~30 min**, buffer-handler bisection landing repeatedly on the same
already-known poison records each ~3-min cycle) tailing off, not a fresh burst of distinct failures.

**Verdict: NOISE, not a real cluster.** This was **one earlier synthetic over-length-`item_code` test
batch (co-batching at least 4 distinct oversized test controls) still being bisected/retried**, and the
alarm's 15-minute sliding window happened to catch 9 of that retry storm's tail-end echoes — 3 of the
same already-identified poison records, each appearing across 3 buffer-handler cycles (04:45/04:48/04:51).
It was never close to reflecting 9 *new* or *distinct* failing items; it reflects one batch's retry count
landing just under the threshold as it approached its DLQ/exhaustion point. No live-defect or fresh-signal
read-through is warranted from this near-miss.

**INFERRED (not directly observed in these log lines, but consistent with the documented mechanism):**
the underlying batch itself was a QA-injected test fixture (STRESS/EXTENDED coverage over-length `Item`
probes), not organic Cin7 data — no genuine Cin7 product could plausibly carry a literal `"SSSS...S"`
code.

### 2. SCALE staging item lookup — BLOCKED, not attempted; cannot be closed by an agent session

**Not run.** `PLAN-C-SCALE-MANUAL-CHECKS.md` states explicitly, in its own heading: *"For JJ to run by
hand in the SCALE staging UI. No agent session needed."* Checked for a route in before declining:

- No SCALE staging URL, login flow, or credential reference exists anywhere in this repo's docs
  (`CTC-RESYNC-RUNBOOK.md`, `CTC-QA-STATE-INDEX.md`, `PLAN-C-SCALE-MANUAL-CHECKS.md`, `aws-console-guide.md`
  all checked) — the only place a "navigation path" is discussed is as an open item **to be captured by
  JJ**, not a known value an agent can look up.
- No existing authenticated browser tab/session was available this run (`tabs_context_mcp` returned no
  tab group) — there is no already-logged-in SCALE session to drive.
- Manhattan SCALE is a real login-gated WMS, not a Cin7/AWS surface this harness has any sanctioned
  automated access to. Guessing at a URL or attempting a login without credentials is out of scope for a
  read-only agent pass and was not attempted.

**Plain statement:** this cannot be closed as "environment-limited" from this session, because it was
never genuinely *attempted* — it's an access gap, not a searched-and-failed one. CLAUDE.md already
records that JJ personally found the item lookup screen exists (confirmed 2026-08-18) but that the
**navigation path itself was never written down**. That capture — the actual menu path plus facility
context — still needs JJ to do it by hand (screenshot or one line of text) next time he's in the SCALE
staging UI; no agent session can substitute for that, now or on a retry, without either credentials being
handed over (against this project's working style) or JJ himself supplying the path. **Recommend:
JJ captures it directly rather than re-queuing this as agent follow-up work.**

### 3. check-status.sh — already fixed, no changes made

**Verified against the live file — both fixes described in CLAUDE.md are already present; nothing to
change, so no diff to show.**

- The alarm-name list (script lines ~102–105) already uses the single-`cin7-` names correctly:
  `"${STAGE}-catalog-cin7-poller-errors"` and `"${STAGE}-catalog-cin7-watermark-stale"` — no doubled
  `cin7-cin7-` prefix anywhere in the script.
- `"${STAGE}-catalog-manhattan-sender-validation-failures"` (script line ~96) is already in the checked
  `ALARMS` list, with a comment explaining it's separate from the per-store `${s}-validation-failures`
  alarms and was previously missing.

Both match CLAUDE.md's "✅ FIXED 2026-08-18" note exactly. **No further action taken on this item.**

### 4. Exhaustive search for the poller's page-cap lever outside Lambda env vars — proven, not assumed

**Every plausible QA-reachable configuration channel was checked; all were empty except the one already
known (the `MAX_PAGES_PER_RUN` env var, confirmed absent).** This time the code itself was read, not just
the deployed config, so the conclusion is now code-verified rather than inferred from absence:

- **SSM:** no parameter with `page`, `Page`, `cap`, or `PAGES` anywhere in its name exists in the whole
  account (`describe-parameters` full-account query, zero matches). Everything under `/catalog` is
  exactly three parameters: two BigQuery-credential params (`staging/ps`, `staging/us`) and the watermark
  itself — no page-cap parameter under any path.
- **AppConfig:** `list-applications` in `ap-southeast-2` returns `{"Items": []}` — **AppConfig is not used
  in this account at all**, in this region.
- **Lambda layers:** `get-function-configuration` on `staging-catalog-cin7-cin7-item-poller` returns
  `"Layers": null` — no layers attached, so nothing could be baked into a layer either.
  ⚠ Side note, MEASURED but unrelated to this question: this call's `LastModified` now reads
  `2026-08-19T03:50:10.000+0000`, newer than CLAUDE.md's recorded `2026-08-12T22:45:44Z` — the function
  has been redeployed or reconfigured since that baseline (plausibly by the concurrent forced-break
  session). **The env var set is unchanged regardless** (see below), so this doesn't affect the
  conclusion here, but flagging since it contradicts a "measured" fact on record.
- **Deployed code itself, read directly** (downloaded the function's own code package via
  `get-function`'s presigned `Code.Location`, read-only): the bundle reads exactly **8** environment
  variables anywhere in it — `INTERNAL_EVENT_BUS_NAME`, `SECRETS_MANAGER_ENDPOINT`, `MAX_PAGES_PER_RUN`,
  `WATERMARK_PARAMETER_NAME`, `CIN7_SECRET_NAME`, `SSM_ENDPOINT`, `STAGE`, `PORT` — the last three of
  which are AWS-SDK/local-dev plumbing, not business config. **Zero `AppConfig` references anywhere in the
  bundle.** The literal line that sets the page cap:

  ```js
  const maxPages = Number(process.env.MAX_PAGES_PER_RUN ?? "30");
  ```

  and separately, the page size is a hardcoded constant, not configurable from anywhere:

  ```js
  var CIN7_BASE_URL = "https://api.cin7.com";
  var CIN7_PAGE_SIZE = 250;
  var CIN7_ID_FILTER_BATCH_SIZE = 100;
  ```

  This directly confirms the runbook's stated default (30 pages × 250 rows = 7,500 rows/endpoint/cycle)
  as a **code fact**, not a runbook claim taken on trust — and confirms there is no second, hidden read
  path (no SSM `GetParameter` call for it, no AppConfig client) that could override it besides the one env
  var already known to be unset.

**Verdict: "no QA-reachable lever exists" is now a proven statement.** Every channel that could plausibly
carry this value — env var, SSM (any path, whole account), AppConfig (not present in the account/region
at all), Lambda layers (none attached) — was checked directly, and the code itself confirms
`MAX_PAGES_PER_RUN` is the *only* input the running code will ever look at. With that env var absent
(confirmed independently four times now, including this pass), the deployed cap is the literal code
default of **30**, and there is no other route to change it short of a redeploy.

**MEASURED/INFERRED tagging for this section:** all four bullets and the code excerpt are MEASURED
(direct API/code reads). The characterization of `SECRETS_MANAGER_ENDPOINT`/`SSM_ENDPOINT`/`PORT` as
"SDK/local-dev plumbing rather than business config" is INFERRED from naming and standard AWS SDK
conventions, not independently confirmed against AWS SDK source.

