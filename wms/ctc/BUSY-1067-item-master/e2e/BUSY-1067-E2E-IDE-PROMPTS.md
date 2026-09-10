# BUSY-1067 E2E pass - the seven IDE kick-off prompts

Each block below is self-contained. Paste one into a fresh IDE session, nothing else needed.
Run order is 1, 2, 3, 4, 5, 6, 7. Sessions 3 and 4 can go ahead of 2 if you want the zero-spend work
first. E7 needs no session: it passed on 19 Aug.

Individual copies are also on disk at `~/Desktop/testing-tools/e2e-prompts/session-1.txt` through
`session-7.txt`.

---

## Session 1 - pre-flight and E1, full-chain trace

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 1 of 7: E1, full-chain trace of one real Cin7 change.
Fresh session, no memory of any other. The pass is documented on Confluence page 1899429895.

GUARDRAILS
- Cin7 is PRODUCTION and GET-only. No POST/PUT/PATCH/DELETE, and no hand-rolled curl or aws call to
  work around that, ever. If a test appears to need a Cin7 write, stop and tell me. Do not build or
  scaffold write tooling.
- Do not touch staging/manhattan/oauth2. Its blast radius covers UNI and PS as well as CTC.
- Do not modify any alarm, dashboard, Lambda config, EventBridge rule, Confluence page or Jira issue.
- Run preview-cin7-sync.sh before every watermark --set. Show me the dry run and wait for my OK
  before you add --confirm to anything.
- Confirm every SSM or secret write with a direct aws ssm get-parameter or aws secretsmanager
  get-secret-value read. Never trust a script's success message: on 13 Aug --unset --confirm reported
  success and the poller ran 11 more active cycles over 33 minutes.
- Manhattan always returns HTTP 200. Judge delivery on accepted=N rejected=0 and rejectedTransactions,
  never on HTTP status.
- E7 (forced Cin7 outage) already PASSED on 19 Aug. Do not break the Cin7 secret, do not force an
  outage, do not re-run it.
- End to end is 6 to 10 minutes. Do not call anything missing before 10 minutes have passed.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it.
- Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.

STEP 0 - STATE CHECK (read-only, ~3 min)
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - record the literal value and version
c) ./check-status.sh --stage staging --profile staging - record all four alarm states, the buffer
   queue depths, and THE DLQ DEPTH, which is this session's baseline
d) The last 10 minutes of /aws/lambda/staging-catalog-cin7-cin7-item-poller: ACTIVE cycles
   (Cin7PollerCycleComplete) or INACTIVE (Cin7ItemPollerInactive)?
Expected: watermark UNSET at v249, secret restored and healthy, cin7-poller-errors and
cin7-watermark-stale both OK, send-dlq-depth in ALARM since 10 Aug (not new, not caused by this
pass). If live state contradicts that, STOP and tell me before changing anything.

STEP 1 - PICK A CANDIDATE (read-only)
./preview-cin7-sync.sh --since <now minus 2 hours, UTC ISO8601>
From the candidates it lists, choose ONE product option that has a real barcode and a real weight,
not a placeholder. Tell me which one you picked, its product id, its size-suffixed item_code, and
why. If nothing in the last 2 hours has both, widen to 6 hours and preview again rather than
settling for a record that cannot exercise XRef and WeightUm.

STEP 2 - SET THE WATERMARK
Dry run first: ./cin7-watermark.sh --stage staging --profile staging --set <T-2h>
Show me the dry run, then set it with --confirm, then confirm the new value and version by a direct
aws ssm get-parameter read. Record the OLD value and version too.

STEP 3 - WATCH THE POLLER
Poll until you see a Cin7PollerCycleComplete with watermarkAdvanced:true and recordsEmitted>0.
Record: cycle timestamp, productsFetched, recordsEmitted, recordsSkipped, and the exact value the
watermark advanced TO. THAT VALUE IS WHAT SESSION 2 NEEDS - record it verbatim, in the log and to me.

STEP 4 - TRACE THE CHOSEN item_code THROUGH ALL FOUR LOG GROUPS, IN ORDER
poller, then buffer populator, then buffer handler, then sender. Quote the line and timestamp from
each. Record the observed end-to-end latency.

STEP 5 - ASSERT THE OUTGOING XML, FIELD BY FIELD
From the sender's outgoing ItemDownload XML for that item_code, confirm each of these separately and
report each as its own PASS or FAIL with the observed value quoted:
  Company=CTC · Item is the size-suffixed option code, not the bare productOptionCode ·
  ItemClass=CTC-<sub-group-id> · UserDef1 carries the brand · Color · Size · DimensionUm=MM ·
  WeightUm=KG · one XRef per barcode
Then confirm the sender logged accepted=N rejected=0 with an empty rejectedTransactions.
Do NOT summarise this as "fields correct". One line per field, with the value.

STEP 6 - E1 VERDICT
PASS or FAIL with the evidence named, plus the observed latency and the record counts.

STEP 9 - PARK AND HAND OFF
a) Return the watermark to idle: ./cin7-watermark.sh --stage staging --profile staging --unset
   --confirm, confirm Value: UNSET by direct get-parameter, and confirm the poller logs
   Cin7ItemPollerInactive on its next cycle.
b) Confirm the buffer queue is 0 visible / 0 in flight, and record the DLQ depth against this
   session's step 0 baseline. Explain any change.
c) Append a "=== STATE (end of session 1) ===" block to the log containing: the E1 verdict, watermark
   value and version, all four alarm states, queue and DLQ depths, every value you changed with its
   exact undo command, and - stated explicitly by name - the watermark value E1's cycle advanced to,
   the chosen item_code, and the DLQ baseline depth.
d) Print to me: the verdict in one line, anything needing my decision, and the literal line
   "Session 1 complete. Run the Session 2 prompt in a fresh session."
Then stop. Do not start the next case.
```

---

## Session 2 - E3, duplicate convergence at the inclusive boundary

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 2 of 7: E3, duplicate convergence at the inclusive watermark
boundary. Fresh session, no memory of session 1.

GUARDRAILS
- Cin7 is PRODUCTION and GET-only. No POST/PUT/PATCH/DELETE, and no hand-rolled curl or aws call to
  work around that, ever. If a test appears to need a Cin7 write, stop and tell me.
- Do not touch staging/manhattan/oauth2. Do not modify any alarm, dashboard, Lambda config,
  EventBridge rule, Confluence page or Jira issue.
- Run preview-cin7-sync.sh before every watermark --set. Show me the dry run and wait for my OK
  before you add --confirm.
- Confirm every SSM write with a direct aws ssm get-parameter read, never a script's success message.
- Manhattan always returns HTTP 200. Judge delivery on accepted=N rejected=0 and rejectedTransactions.
- E7 already PASSED on 19 Aug. Do not break the Cin7 secret or force an outage.
- End to end is 6 to 10 minutes. Do not call anything missing before 10 minutes have passed.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it. Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.

STEP 0 - STATE CHECK (read-only, ~3 min)
Read the LAST "=== STATE ===" block in ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md and take from it
the exact watermark value that E1's cycle advanced to, and the item_code E1 traced. If that block is
missing or does not name a watermark value, STOP and tell me. Do not guess a value and do not pick
your own. Then verify live, do not assume:
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - literal value and version
c) ./check-status.sh --stage staging --profile staging - four alarm states, queue depths, and THE DLQ
   DEPTH, which is this session's baseline. Do not carry a DLQ figure in from session 1.
d) The last 10 minutes of the poller log group: ACTIVE or Cin7ItemPollerInactive?
If live state contradicts the STATE block, STOP and tell me before changing anything.

STEP 1 - RE-SET THE WATERMARK TO E1'S ADVANCED VALUE
Preview first: ./preview-cin7-sync.sh --since <that value>, so we know the blast radius. Then show me
the watermark dry run, set with --confirm, and confirm by direct get-parameter read.
Setting the floor back to the value the poller itself advanced to means the boundary second is
re-read, which is the whole point of the case. There is no overlap window in this pipeline.

STEP 2 - MEASURE CONVERGENCE
Wait for the cycle, then from the SENDER log record:
  - ManhattanBatch received=N coalesced=M, and confirm M is strictly less than N
  - exactly one send per item_code - list the item_codes and their send counts
  - rejected=0
Quote the lines. If M equals N, that is a real finding, not a mis-run: say so and do not retry to
get a nicer number.

STEP 3 - CONFIRM NOTHING WAS LEFT BEHIND
Buffer queue back to 0 visible / 0 in flight. DLQ depth unchanged from this session's step 0
baseline. Watermark advanced monotonically and never decreased.

STEP 4 - E3 VERDICT
PASS or FAIL with the evidence quoted.

STEP 9 - PARK AND HAND OFF
a) ./cin7-watermark.sh --stage staging --profile staging --unset --confirm, confirm Value: UNSET by
   direct get-parameter, and confirm Cin7ItemPollerInactive on the next cycle.
b) Confirm the buffer queue is 0/0 and record the DLQ depth against this session's baseline.
c) Append a "=== STATE (end of session 2) ===" block: E3 verdict, watermark value and version, four
   alarm states, queue and DLQ depths, every value changed with its exact undo command.
d) Print to me: the verdict in one line, anything needing my decision, and the literal line
   "Session 2 complete. Run the Session 3 prompt in a fresh session."
Then stop.
```

---

## Session 3 - E2 and E5, injection only

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 3 of 7: E2 (cross-company isolation) and E5 (mapping, defaults and
length edges). Both are bus-injection only. Fresh session, no memory of the others.

GUARDRAILS
- Cin7 is PRODUCTION and GET-only. No POST/PUT/PATCH/DELETE, ever. Injection goes onto
  staging-catalog-manhattan-events, never to Cin7.
- LEAVE THE WATERMARK AT UNSET THE WHOLE SESSION. Do not set it at all. Injection bypasses the
  poller, so an active poller would only add real traffic to the windows we are trying to read.
- Do not touch staging/manhattan/oauth2. Do not modify any alarm, dashboard, Lambda config,
  EventBridge rule, Confluence page or Jira issue.
- Every emit-cin7-record.sh call is dry-run first, shown to me, and only then re-run with --confirm.
- Synthetic payload rules from CLAUDE.md: use desc not description, and include additional_eans: []
  or the sender throws instead of validating.
- Manhattan always returns HTTP 200. Judge delivery on accepted=N rejected=0 and rejectedTransactions.
- E7 already PASSED on 19 Aug. Do not break the Cin7 secret or force an outage.
- Injection is not the poller: it builds message_group_id by raw concatenation while the real poller
  collapses whitespace runs to an underscore. A failure seen only through injection is not
  automatically a live defect - say so if it comes up.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it. Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.

STEP 0 - STATE CHECK (read-only, ~3 min)
Read the LAST "=== STATE ===" block in the log. Then verify live:
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - expect UNSET
c) ./check-status.sh --stage staging --profile staging - four alarm states, queue depths, and THE DLQ
   DEPTH, which is this session's baseline
d) The poller log group: expect Cin7ItemPollerInactive
If live state contradicts the STATE block, STOP and tell me before changing anything.

STEP 1 - E2, CROSS-COMPANY ISOLATION
Inject item_code 3141592 twice inside ONE buffer window: once with --company CTC, once with
--company UNI. Keep the UNI code numeric - a non-numeric UNI code becomes a second poison and
answers a different question.
Assert, each separately:
  - the populator shows CTC#3141592 and UNI#3141592 as two DISTINCT message_group_ids
  - the sender makes TWO SAVE calls, each accepted with rejected=0
  - no coalescing across companies - the two never merge into one send
E2 verdict, with the lines quoted.

STEP 2 - E5 PART A, the four benign edges, ONE window
Inject four records:
  a) --no-barcode          expect a present-but-EMPTY <XRefs></XRefs> in the XML, and accepted
  b) --blank-category      expect ItemClass=CTC-000
  c) height/length/width all 0 (the default)  expect a ManhattanDefaultedField log line with
     company:"CTC", and 0.1 sent for each dimension with DimensionUm=MM
  d) --desc-raw at exactly 101 characters   expect it to ARRIVE TRUNCATED TO 100, silently: no log
     line, no metric
Report each of the four as its own PASS or FAIL with the observed value quoted. Two of these
truncate and two do not: do not state one behaviour for all of them.
Confirm rejected=0 across this window and the DLQ depth unchanged.

STEP 3 - E5 PART B, the length error, ITS OWN window
Inject one record with --size at 26 characters. Expect the sender to error with
reason:"size_too_long" and NOT to reach Manhattan.
This record is a poison: it will retry to maxReceiveCount and land in the buffer DLQ. That is
EXPECTED, it is the correct behaviour, and it is exactly ONE message. Record the DLQ depth going to
baseline+1 and say plainly that this is expected, not loss.
Field limits for reference: Desc 100, Colour 25, Size 25, item_code 50.

STEP 4 - VERDICTS
E2 and E5 each as their own PASS or FAIL with the evidence named.

STEP 9 - PARK AND HAND OFF
a) Confirm the watermark is still UNSET by direct get-parameter (you should not have changed it).
b) Confirm the buffer queue is 0 visible / 0 in flight.
c) Append a "=== STATE (end of session 3) ===" block: both verdicts, watermark value and version,
   four alarm states, queue depths, and the DLQ depth recorded explicitly as "baseline + 1 from E5
   part B, expected" so session 4 starts from the right number.
d) Print to me: both verdicts in one line each, anything needing my decision, and the literal line
   "Session 3 complete. Run the Session 4 prompt in a fresh session."
Then stop.
```

---

## Session 4 - E4, poison containment and no-loss

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 4 of 7: E4, one bad record cannot take good ones with it.
Bus-injection only. Fresh session, no memory of the others.

GUARDRAILS
- Cin7 is PRODUCTION and GET-only. No POST/PUT/PATCH/DELETE, ever.
- LEAVE THE WATERMARK AT UNSET. Do not set it at all this session.
- Do not touch staging/manhattan/oauth2. Do not modify any alarm, dashboard, Lambda config,
  EventBridge rule, Confluence page or Jira issue.
- Every emit-cin7-record.sh call is dry-run first, shown to me, and only then re-run with --confirm.
- Synthetic payload rules from CLAUDE.md: use desc not description, and include additional_eans: [].
- Manhattan always returns HTTP 200. Judge delivery on accepted=N rejected=0 and rejectedTransactions.
- E7 already PASSED on 19 Aug. Do not break the Cin7 secret or force an outage.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it. Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.

STEP 0 - STATE CHECK (read-only, ~3 min)
Read the LAST "=== STATE ===" block in the log. Then verify live:
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - expect UNSET
c) ./check-status.sh --stage staging --profile staging - four alarm states, queue depths, and THE DLQ
   DEPTH. Expected: session 3's baseline + 1, the expected E5 part B poison. Note both figures. This
   session will add exactly ONE more.
d) The poller log group: expect Cin7ItemPollerInactive
If live state contradicts the STATE block, STOP and tell me before changing anything.

STEP 1 - INJECT 11 RECORDS INTO ONE WINDOW
1 poison: --size at 26 characters.
10 controls: valid records, distinct item_codes, each with a barcode.
Dry-run the batch, show me one representative command, then confirm.
Record the exact injection times and every item_code.

STEP 2 - CONTAINMENT: DID BISECT RUN
From the buffer handler log, quote processWithBisect and "Poison pill identified".

STEP 3 - NO LOSS: DID ALL TEN CONTROLS GET THROUGH
All 10 controls delivered with accepted=10 rejected=0 INSIDE ONE CYCLE. List all 10 item_codes
against their send confirmations. 9 out of 10 is a FAIL, not a rounding error.

STEP 4 - THE ABORTED SEND
The sender invocation that handled the poison must log the validation reason and must NOT log
ManhattanRequestOutcome. If you see accepted= anywhere in that invocation you reproduced a Manhattan
REJECTION rather than a pre-send validation throw, which answers a different question - say so
explicitly rather than reporting it as the same thing.

STEP 5 - THE POISON'S FATE
Poll the DLQ every 5 minutes for up to 45 minutes until the poison arrives. Confirm:
  - ApproximateReceiveCount is 11 (10 retries plus the original)
  - the message body is byte-for-byte identical to what was injected - diff it, do not eyeball it
  - DLQ depth is exactly this session's step 0 baseline + 1
If we get cut off before it arrives, that is fine and does not invalidate anything: DLQ retention is
4 days and a later session can read it. Say so in the log rather than rushing.

STEP 6 - E4 VERDICT
Report BOTH halves, in this order and in these terms: there is no per-record containment inside the
sender, AND nothing is lost. Both are true and the second is the one the DC team cares about.

STEP 9 - PARK AND HAND OFF
a) Confirm the watermark is still UNSET by direct get-parameter.
b) Confirm the buffer queue is 0 visible / 0 in flight.
c) Append a "=== STATE (end of session 4) ===" block: the E4 verdict, watermark value and version,
   four alarm states, queue depths, and the DLQ depth with its accounting spelled out (expected +2
   across the pass so far, actual N, explained).
d) Print to me: the verdict in one line, anything needing my decision, and the literal line
   "Session 4 complete. Run the Session 5 prompt in a fresh session."
Then stop.
```

---

## Session 5 - E6, bounded re-sync from the published runbook

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 5 of 7: E6, bounded re-sync executed straight from the runbook.
Fresh session, no memory of the others.

The point of this case is not that the data arrives. It is that the RUNBOOK works as published and
costs what it says it costs, because the DC team will run it without me present.

GUARDRAILS
- Cin7 is PRODUCTION and GET-only. No POST/PUT/PATCH/DELETE, ever.
- Do not touch staging/manhattan/oauth2. Do not modify any alarm, dashboard, Lambda config,
  EventBridge rule, Confluence page or Jira issue.
- Run preview-cin7-sync.sh before every watermark --set. Show me the dry run and wait for my OK
  before you add --confirm.
- Confirm every SSM write with a direct aws ssm get-parameter read, never a script's success message.
- Manhattan always returns HTTP 200. Judge delivery on accepted=N rejected=0 and rejectedTransactions.
- E7 already PASSED on 19 Aug. Do not break the Cin7 secret or force an outage.
- End to end is 6 to 10 minutes. Do not call anything missing before 10 minutes have passed.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it. Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.

STEP 0 - STATE CHECK (read-only, ~3 min)
Read the LAST "=== STATE ===" block in the log. Then verify live:
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - literal value and version
c) ./check-status.sh --stage staging --profile staging - four alarm states, queue depths, and THE DLQ
   DEPTH, which is this session's baseline. Do not carry a figure in from an earlier session.
d) The poller log group: ACTIVE or Cin7ItemPollerInactive?
If live state contradicts the STATE block, STOP and tell me before changing anything.

STEP 1 - READ THE RUNBOOK AND FOLLOW IT, NOT YOUR OWN METHOD
Read the published re-sync runbook (Confluence page 1845100600; the local copy is
CTC-RESYNC-RUNBOOK.md). Execute a 6 hour rewind BY ITS STEPS, in its order, using its commands.
Where the runbook and your own instinct disagree, follow the runbook and RECORD THE DISAGREEMENT.
Every step that does not match what actually happened is a finding worth more than the test result.

STEP 2 - COST IT IN REQUESTS, NOT RECORDS
Count Cin7ProductsFetched, Cin7ProductOptionsFetched and Cin7TriggeredProductsFetched and derive the
ACTUAL requests spent. Expect roughly 15, not thousands: cost tracks pages and id-chunks, not record
volume. If it comes out in the hundreds, stop and tell me before continuing.

STEP 3 - ASSERT THE WINDOW
Converges in ONE cycle in about a minute. No Cin7ItemPollerPageCapHit. Watermark monotonic and never
decreasing. rejected=0. DLQ depth unchanged from this session's step 0 baseline.

STEP 4 - E6 VERDICT
PASS or FAIL with the evidence named, plus a separate list titled "Runbook amendments needed", one
line per mismatch, or "none" if it ran clean as written.

STEP 9 - PARK AND HAND OFF
a) ./cin7-watermark.sh --stage staging --profile staging --unset --confirm, confirm Value: UNSET by
   direct get-parameter, and confirm Cin7ItemPollerInactive on the next cycle.
b) Confirm the buffer queue is 0/0 and record the DLQ depth against this session's baseline.
c) Append a "=== STATE (end of session 5) ===" block: the E6 verdict, the runbook amendment list,
   watermark value and version, four alarm states, queue and DLQ depths, every value changed with
   its exact undo command.
d) Print to me: the verdict in one line, the runbook amendments, anything needing my decision, and
   the literal line "Session 5 complete. Run the Session 6 prompt in a fresh session."
Then stop.
```

---

## Session 6 - E8, quiet steady state, tooling, shutdown

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 6 of 7: E8, quiet steady state, tooling health, shutdown. This is
the last session that touches AWS and it ends with the watermark at UNSET. Fresh session, no memory
of the others.

This session has a real objective beyond the shutdown: it manufactures the zero-record ACTIVE cycle
that BUSY-1117 AC5 has never been able to observe. The 19 Aug re-run found ZERO such cycles in 7 days
of retained history, so AC5 currently sits at UNKNOWN. Treat step 2 as the point of the session.

GUARDRAILS
- Cin7 is PRODUCTION and GET-only. No POST/PUT/PATCH/DELETE, ever.
- Do not touch staging/manhattan/oauth2. Do not modify any alarm, dashboard, Lambda config,
  EventBridge rule, Confluence page or Jira issue.
- Run preview-cin7-sync.sh before every watermark --set. Show me the dry run and wait for my OK
  before you add --confirm.
- Confirm every SSM write with a direct aws ssm get-parameter read, never a script's success message.
- E7 already PASSED on 19 Aug. Do not break the Cin7 secret or force an outage.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it. Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.

STEP 0 - STATE CHECK (read-only, ~3 min)
Read the LAST "=== STATE ===" block in the log. Then verify live:
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - literal value and version
c) ./check-status.sh --stage staging --profile staging - four alarm states, queue depths, DLQ depth
d) The poller log group: ACTIVE or Cin7ItemPollerInactive?
If live state contradicts the STATE block, STOP and tell me before changing anything.

STEP 1 - MANUFACTURE A GENUINELY QUIET ACTIVE POLLER
Preview, then set the watermark to (now minus 1 minute) with --confirm, and confirm by direct
get-parameter read. A floor of "now" means the next cycles are ACTIVE but have nothing to fetch,
which is exactly the state we want to observe.

STEP 2 - THREE QUIET CYCLES, AND THE AC5 ANSWER
Tail at least 3 consecutive Cin7PollerCycleComplete events with recordsEmitted:0. For EACH ONE record
whether watermarkAdvanced was true or false. Report as its own finding, MEASURED:
  - advances on empty cycles -> the staleness alarm stays quiet through a genuinely quiet period,
    AC5's claim holds structurally
  - does NOT advance -> watermark-stale will false-positive through any quiet period, which is a
    PRODUCTION finding, not a staging quirk, because the ticket itself says off-peak CTC months see
    very few changes
Do not infer either way. If you cannot get three clean empty cycles, say UNKNOWN.

STEP 3 - NO ALARM MOVED
describe-alarm-history across this session's window for all four alarms: cin7-poller-errors,
cin7-watermark-stale, manhattan-sender-validation-failures, manhattan-send-dlq-depth. Confirm no
transition. Note that send-dlq-depth has been stuck in ALARM since 10 Aug and cannot transition, so
"no transition" there means nothing either way - say so rather than counting it as a pass.

STEP 4 - TOOLING HEALTH, FIRST LIVE VERIFICATION SINCE THE FIXES
./check-status.sh --stage staging --profile staging
Confirm it finds ALL FOUR alarms with none reported NOT FOUND, and reports the buffer queue at 0/0.
This is the first live run since its two bugs were fixed on 18 Aug, so its own output is under test
here, not just the pipeline. Cross-check at least one alarm state and the queue depth against a
direct AWS call and confirm they agree.

STEP 5 - SHUT DOWN
./cin7-watermark.sh --stage staging --profile staging --unset --confirm
Confirm Value: UNSET by direct get-parameter read, and confirm the poller logs
Cin7ItemPollerInactive on its next TWO cycles with no further Cin7PollerCycleComplete. On 13 Aug
--unset --confirm reported success and the poller ran 11 more active cycles over 33 minutes: that is
why two cycles, not one.
Note that watermark-stale will now false-positive on the idle poller. That is expected and already
recorded, it is not a new finding.

STEP 6 - E8 VERDICT plus the AC5 answer stated separately.

STEP 9 - PARK AND HAND OFF
a) Confirm the watermark is UNSET and the poller inactive (done in step 5 - restate it).
b) Confirm the buffer queue is 0/0 and record the DLQ depth.
c) Append a "=== STATE (end of session 6) ===" block: the E8 verdict, the AC5 answer with its
   evidence and tag, watermark value and version, four alarm states, queue and DLQ depths, and a
   plain statement that the pass is complete on AWS and nothing is left changed except the poller
   Lambda description breadcrumb.
d) Print to me: the verdict and the AC5 answer in one line each, anything needing my decision, and
   the literal line "Session 6 complete. Run the Session 7 prompt in a fresh session."
Then stop.
```

---

## Session 7 - write-up and close-out, no AWS

```
Read CLAUDE.md and BUSY-1067-E2E-LOG.md in ~/Desktop/testing-tools.

BUSY-1067 EPIC E2E PASS - SESSION 7 of 7: consolidate and close out.

NO AWS CALLS THIS SESSION. Read-only on everything: no Confluence pushes, no Jira changes, no
watermark or secret touches. You draft, I push.

STEP 1 - RESULTS FILE
Write ~/Desktop/testing-tools/BUSY-1067-E2E-RESULTS.md from the log: one section per case E1 to E8,
each with its verdict, the evidence quoted, and its MEASURED / INFERRED / UNKNOWN tag.
E7's evidence comes from BUSY-1117-AC1-RERUN-RESULTS.md, not from this pass: both alarm transitions,
both emails received (15:53 and 18:14 AEST), time to alarm 2h31 from the last good cycle accepted as
within band, recovery in one catch-up cycle of 216 products / 1,429 records.
Include the DLQ accounting: expected +2 across the pass, actual N, explained.

STEP 2 - CONFLUENCE DRAFT, DO NOT PUSH
Draft the updates for page 1899429895: the status cell for each of E1 to E8, the sign-off Result
line, the residual-risk list, and the AC5 answer from E8 if it landed.

STEP 3 - JIRA DRAFTS, DO NOT PUSH
Draft a comment for BUSY-1067 recording the epic-level QA verdict. BUSY-1067 is still In Progress
with all five children Done, so say whether QA considers it closable.
Draft a comment for BUSY-1117 if E8's AC5 answer changes its position. Note that 1117 is closed Done
with no QA comment on it at all and its five AC checkboxes unticked, so if E8 settled AC5 that is
worth saying on the ticket.

STEP 4 - WHAT IS STILL OPEN
List anything still UNKNOWN or unsubstantiated, and anything needing a decision from me. Do not fill
a gap with an inference.
Include the standing items I already know about, so they do not get lost: the E2E handover page
1894973441 still tells downstream readers the alerts topic has zero subscribers and nobody will be
told, which has been false since 19 Aug; page 1894088713 carries both "80+ minutes" and "94 minutes"
with nothing distinguishing the two runs, and its AC1 row still reads NOT CLOSED with a descope
request that the re-run has superseded.
```
