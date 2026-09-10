# BUSY-1067 epic E2E pass - IDE session plan

**Written 2026-08-20.** Companion to Confluence page [1899429895](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1899429895).
The Confluence page carries the coverage story. This file carries the paste-ready prompts.

---

## Where you actually are

From `BUSY-1117-AC1-RERUN-RESULTS.md` (Session B, 19 Aug, ended 20:05:44 AEST):

| Thing | State |
|---|---|
| Cin7 secret `staging/catalog/cin7` | Restored and verified, `VersionId c92a3046-83e2-4948-a9de-cbb0c13b9a4b` |
| Poller | Idle by design. Watermark **`UNSET`, v249**, verified by direct read, `Cin7ItemPollerInactive` on two following cycles |
| `cin7-poller-errors` | OK (ALARM to OK at 09:51:32Z) |
| `cin7-watermark-stale` | OK (ALARM to OK at 09:51:49Z) |
| `send-dlq-depth` | Still in ALARM, has been since 10 Aug. Not new |
| Residue | Poller Lambda `Description` breadcrumb only |
| Local backup file | `~/cin7-secret-backup.json` deleted. Pre-break secret is preserved as `AWSPREVIOUS` |

**E7 is already done.** The 19 Aug forced outage produced everything E7 asks for, measured:
`poller-errors` OK to ALARM `05:53:32Z`, `watermark-stale` OK to ALARM `08:14:49Z` on 8 of 8
breaching periods, 81 failed cycles with the watermark floor static throughout, both alarms back to
OK within 4 minutes of restore, and one catch-up cycle clearing 216 products and 1,429 records.
**Do not run it again.** Both follow-ups are now closed, 20 Aug:

1. **Email delivery: MEASURED.** The `watermark-stale` SNS email was received at **18:14 AEST**, the
   same minute as the `08:14:49Z` transition, naming the alarm, the reason and the timestamp.
   Notification latency is effectively zero, so time to human awareness is just detection time. The
   email body also states `OK:` and `INSUFFICIENT_DATA:` as empty and `Dimensions:` as empty, which
   turns two carried findings (nothing notifies on recovery, no per-company alarming) from inferred
   into quoted-from-AWS.
2. **The timing overshoot is accepted.** 2h31 from the last good cycle against the AC's "~2 hours".
   JJ's call, 20 Aug: within band of acceptance. The overshoot is CloudWatch period-bucket alignment
   rather than alarm logic, and the threshold is tunable in prod if it matters there.

So the pass is **E1, E3, E2, E5, E4, E6, E8**, in that order, in seven sessions.

---

## How the slicing works

Three rules make any session safe to abandon mid-way:

1. **Every session ends with the watermark back at `UNSET`.** That is the documented idle state, it
   stops the Cin7 quota burn, and it means an interruption never leaves staging running hot. A
   session that needs a specific watermark value just sets it again at the start.
2. **Every session starts with the same read-only state check** and refuses to change anything if
   what it finds disagrees with the log. No session trusts the previous one's word.
3. **One append-only log**, `~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md`, with a
   `=== STATE (end of session n) ===` block at the end of each session. That block is the handoff.

Evidence you might worry about losing to an interruption mostly survives without you: alarm history
keeps 14 days, DLQ messages keep 4 days, CloudWatch logs keep their retention. The only thing an
interruption really costs is the Cin7 requests already spent, and those are cheap.

| Session | Case | Rough time | Cin7 spend | Ends at a natural stop because |
|---|---|---|---|---|
| 1 | Pre-flight + E1 | 45 min | ~15 requests | One record is proven delivered field by field |
| 2 | E3 | 25 min | ~15 requests | Convergence measured, buffer back to zero |
| 3 | E2 + E5 | 40 min | none, poller stays idle | Injection only, nothing left in flight but one expected DLQ message |
| 4 | E4 | 50 min | none | Controls delivered, then a wait you can walk away from |
| 5 | E6 | 30 min | ~15 requests | Runbook executed once, converged in one cycle |
| 6 | E8 | 35 min | ~10 requests | Ends by design at `UNSET` |
| 7 | Write-up | 40 min | none | No AWS at all |

About 3 hours 45 of session time. Sessions 3 and 4 can be swapped ahead of 2 if you want the
zero-spend work first.

**One thing to plan for:** E5 and E4 each deliberately create one record the sender cannot validate,
so each one lands one message in the buffer DLQ. **Expected DLQ increase across the whole pass is
exactly +2.** Anything more than that is a finding. Measure the depth at the start of every session
and never quote a figure from an earlier one.

---

## Standard blocks

Every prompt below already contains these. They are repeated here so you can see what you are
agreeing to once rather than seven times.

**Guardrails**

```
GUARDRAILS
- Cin7 is GET-only. No POST/PUT/PATCH/DELETE, no hand-rolled curl or aws call to work around that,
  ever. If a test appears to need a Cin7 write, stop and tell me. Do not build write tooling.
- Do not touch staging/manhattan/oauth2. Its blast radius covers UNI and PS as well as CTC.
- Do not modify any alarm, dashboard, Lambda config, EventBridge rule, Confluence page or Jira issue.
- preview-cin7-sync.sh before every --set, always. Show me the dry run and wait for my OK before
  you add --confirm to anything.
- Confirm every SSM or secret write with a direct get-parameter or get-secret-value read. Never
  trust a script's success message: on 13 Aug --unset --confirm reported success and the poller ran
  11 more active cycles over 33 minutes.
- Manhattan always returns HTTP 200. Judge delivery on accepted=N rejected=0 and rejectedTransactions.
- Do not re-run E7. It passed on 19 Aug and re-running it costs 4 hours and proves nothing new.
- Tag every claim MEASURED / INFERRED / UNKNOWN. Anything you cannot substantiate: flag it, do not
  fill it.
- Append every step to ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md with UTC timestamps.
```

**Step 0, the state check**

```
STEP 0 - STATE CHECK (read-only, ~3 min)
If ~/Desktop/testing-tools/BUSY-1067-E2E-LOG.md exists, read the LAST "=== STATE ===" block in it
and take your starting values from there. Then verify them live, do not assume:
a) aws sts get-caller-identity --profile staging
b) ./cin7-watermark.sh --stage staging --profile staging - record the literal value and version
c) ./check-status.sh --stage staging --profile staging - record all four alarm states, the buffer
   queue depths, and THE DLQ DEPTH, which is this session's baseline. Do not carry a DLQ figure in
   from an earlier session.
d) The last 10 minutes of /aws/lambda/staging-catalog-cin7-cin7-item-poller: is it running ACTIVE
   cycles (Cin7PollerCycleComplete) or INACTIVE (Cin7ItemPollerInactive)?
If live state contradicts the STATE block, STOP and tell me before you change anything.
```

**Step 9, park and hand off**

```
STEP 9 - PARK AND HAND OFF
a) Return the watermark to idle: ./cin7-watermark.sh --stage staging --profile staging --unset
   --confirm, then confirm Value: UNSET by a direct get-parameter read, and confirm the poller logs
   Cin7ItemPollerInactive on its next cycle.
b) Confirm the buffer queue is 0 visible / 0 in flight, and record the DLQ depth against the
   baseline you took in step 0. Explain any change.
c) Append a "=== STATE (end of session <n>) ===" block to the log containing: the case verdict,
   watermark value and version, all four alarm states, queue and DLQ depths, every value you
   changed with its exact undo command, and any value the next session needs by name.
d) Print to me: the verdict in one line, anything that needs my decision, and the literal line
   "Session <n> complete. Run the Session <n+1> prompt in a fresh session."
Then stop. Do not start the next case.
```

---

## SESSION 1 - pre-flight and E1, full-chain trace

The spine of the pass. If this fails nothing else matters, so it goes first and alone.

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 1 of 7: E1, full-chain trace of one real Cin7 change.
Fresh session, no memory of any other. The whole pass is documented on Confluence page 1899429895.

E7 in that plan is ALREADY PASSED from the 19 Aug forced-outage run. Do not break the Cin7 secret,
do not force an outage, do not touch alarms.

[GUARDRAILS block]

[STEP 0 block]

Expected starting state: watermark UNSET v249, secret restored and healthy, poller-errors and
watermark-stale both OK, send-dlq-depth in ALARM since 10 Aug (not new, not caused by this pass).

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
each. Record the observed end-to-end latency. Expect 6 to 10 minutes at a 3 minute cadence plus a
3 minute buffer flush. Do not call anything missing before 10 minutes have passed.

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

[STEP 9 block, as session 1]
Values session 2 needs, state them explicitly: the watermark value E1's cycle advanced to, the
chosen item_code, and the DLQ baseline depth.
```

---

## SESSION 2 - E3, duplicate convergence at the inclusive boundary

Cheap and quick, and it reuses session 1's output. There is no overlap window in this pipeline: the
duplicates come from the inclusive `>=` floor re-reading the boundary second.

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 2 of 7: E3, duplicate convergence at the inclusive watermark
boundary. Fresh session, no memory of session 1.

[GUARDRAILS block]

[STEP 0 block]
Additionally: read the "=== STATE (end of session 1) ===" block and take from it the exact watermark
value that E1's cycle advanced to, and the item_code E1 traced. If that block is missing or does not
name a watermark value, STOP and tell me - do not guess a value and do not pick your own.

STEP 1 - RE-SET THE WATERMARK TO E1'S ADVANCED VALUE
preview first (./preview-cin7-sync.sh --since <that value>) so we know the blast radius, show me the
watermark dry run, then set with --confirm and confirm by direct get-parameter read.
Setting the floor back to the value the poller itself advanced to means the boundary second is
re-read, which is the whole point of the case.

STEP 2 - MEASURE CONVERGENCE
Wait for the cycle, then from the SENDER log record:
  - ManhattanBatch received=N coalesced=M, and confirm M is strictly less than N
  - exactly one send per item_code - list the item_codes and their send counts
  - rejected=0
Quote the lines. If M equals N, that is a real finding, not a mis-run: say so and do not retry to
get a nicer number.

STEP 3 - CONFIRM NOTHING WAS LEFT BEHIND
Buffer queue back to 0 visible / 0 in flight. DLQ depth unchanged from this session's step 0
baseline. Watermark advanced monotonically, never decreased.

STEP 4 - E3 VERDICT, then [STEP 9 block, as session 2]
```

---

## SESSION 3 - E2 and E5, injection only

Zero Cin7 spend and the poller stays idle throughout, which also keeps the buffer windows clean of
real traffic. Two cases fit comfortably in one session because they share a setup.

Note the deliberate split in E5: the four benign edges go in one window, and the 26-character size
record goes in a window of its own. That record is a poison by definition, it will retry and land in
the DLQ, and isolating it keeps the DLQ accounting exact.

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 3 of 7: E2 (cross-company isolation) and E5 (mapping, defaults and
length edges). Both are bus-injection only. Fresh session, no memory of the others.

[GUARDRAILS block]

Additional guardrail for this session: LEAVE THE WATERMARK AT UNSET THE WHOLE TIME. Injection goes
straight onto staging-catalog-manhattan-events and bypasses the poller, so an active poller would
only add real traffic to the windows we are trying to read. Do not set the watermark at all.

Synthetic payload rules, from CLAUDE.md: use desc not description, and include additional_eans: []
or the sender throws instead of validating. Every emit-cin7-record.sh call is dry-run first, shown to
me, and only then re-run with --confirm.

[STEP 0 block]

STEP 1 - E2, CROSS-COMPANY ISOLATION
Inject item_code 3141592 twice inside ONE buffer window: once with --company CTC, once with
--company UNI. Keep the UNI code numeric - a non-numeric UNI code becomes a second poison and
answers a different question.
Assert, each separately:
  - the populator shows CTC#3141592 and UNI#3141592 as two DISTINCT message_group_ids
  - the sender makes TWO SAVE calls, each accepted with rejected=0
  - no coalescing across companies - the two never merge into one send
E2 verdict.

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

STEP 4 - E2 and E5 VERDICTS, then [STEP 9 block, as session 3]
In the STATE block, record the DLQ depth explicitly as "baseline + 1 from E5 part B, expected" so
session 4 starts from the right number.
```

---

## SESSION 4 - E4, poison containment and no-loss

The one session with real waiting in it, and the waiting is the safest part to be interrupted
during: DLQ messages keep for 4 days, so the poison's arrival can be verified later without redoing
anything.

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 4 of 7: E4, one bad record cannot take good ones with it.
Bus-injection only. Fresh session, no memory of the others.

[GUARDRAILS block]

Additional guardrail: LEAVE THE WATERMARK AT UNSET. Do not set it at all this session.

[STEP 0 block]
Expected DLQ depth at step 0 is session 3's baseline + 1 (the expected E5 part B poison). Note both
figures. This session will add exactly ONE more.

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

STEP 5 - THE POISON'S FATE (this is the part you can walk away from)
Poll the DLQ every 5 minutes for up to 45 minutes until the poison arrives. Confirm:
  - ApproximateReceiveCount is 11 (that is 10 retries plus the original)
  - the message body is byte-for-byte identical to what was injected - diff it, do not eyeball it
  - DLQ depth is exactly this session's step 0 baseline + 1
If we get cut off before it arrives, that is fine and does not invalidate anything: DLQ retention is
4 days and a later session can read it. Say so in the log rather than rushing.

STEP 6 - E4 VERDICT
Report BOTH halves, in this order and in these terms: there is no per-record containment inside the
sender, AND nothing is lost. Both are true and the second one is the one the DC team cares about.

[STEP 9 block, as session 4]
```

---

## SESSION 5 - E6, bounded re-sync from the published runbook

The point of this case is not that the data arrives. It is that **the runbook works as published and
costs what it says it costs**, because the DC team will run it without you.

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 5 of 7: E6, bounded re-sync executed straight from the runbook.
Fresh session, no memory of the others.

[GUARDRAILS block]

[STEP 0 block]

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
Converges in ONE cycle in about a minute. No Cin7ItemPollerPageCapHit. Watermark monotonic and
never decreasing. rejected=0. DLQ depth unchanged from step 0 baseline.

STEP 4 - E6 VERDICT, plus a separate list titled "Runbook amendments needed", one line per
mismatch, or "none" if it ran clean as written.

[STEP 9 block, as session 5]
```

---

## SESSION 6 - E8, quiet steady state, tooling, shutdown

Last session that touches AWS, and it ends the pass by design. It also does something the earlier
sessions could not: **it manufactures the zero-record active cycle that AC5 has never been able to
observe.** Setting the watermark to roughly now means the query floor is now, so the next cycles are
genuinely active and genuinely empty. `BUSY-1117-AC1-RERUN-RESULTS.md` recorded AC5 as UNKNOWN
because that scenario has never occurred in retained history. This session is the cheapest chance to
settle it, so treat it as a real objective rather than a formality.

```
Read CLAUDE.md in ~/Desktop/testing-tools. Stage staging, profile staging, region ap-southeast-2.

BUSY-1067 EPIC E2E PASS - SESSION 6 of 7: E8, quiet steady state, tooling health, shutdown. This is
the last session that touches AWS and it ends with the watermark at UNSET. Fresh session, no memory
of the others.

[GUARDRAILS block]

[STEP 0 block]

STEP 1 - MANUFACTURE A GENUINELY QUIET ACTIVE POLLER
Preview, then set the watermark to (now minus 1 minute) with --confirm, and confirm by direct
get-parameter read. A floor of "now" means the next cycles are ACTIVE but have nothing to fetch,
which is exactly the state we want to observe.

STEP 2 - THREE QUIET CYCLES
Tail at least 3 consecutive Cin7PollerCycleComplete events with recordsEmitted:0. For EACH ONE record
whether watermarkAdvanced was true or false.
This resolves BUSY-1117 AC5, which is currently UNKNOWN because no zero-record active cycle exists
anywhere in the retained history. Report it as its own finding, MEASURED:
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

STEP 6 - E8 VERDICT plus the AC5 answer, then [STEP 9 block, as session 6]
In the STATE block, state plainly that the pass is complete on AWS and that nothing is left changed
except the poller Lambda description breadcrumb.
```

---

## SESSION 7 - write-up and close-out, no AWS

```
Read CLAUDE.md and BUSY-1067-E2E-LOG.md in ~/Desktop/testing-tools. NO AWS CALLS THIS SESSION,
read-only on everything.

BUSY-1067 EPIC E2E PASS - SESSION 7 of 7: consolidate and close out.

STEP 1 - Write ~/Desktop/testing-tools/BUSY-1067-E2E-RESULTS.md from the log: one section per case
E1 to E8, each with its verdict, the evidence quoted, and its MEASURED / INFERRED / UNKNOWN tag.
E7's evidence comes from BUSY-1117-AC1-RERUN-RESULTS.md, not from this pass. Include the DLQ
accounting: expected +2, actual N, explained.

STEP 2 - Draft, do not push, the Confluence updates for page 1899429895: the status cell for each
of E1 to E8, the sign-off Result line, and the residual-risk list.

STEP 3 - Draft, do not push, a Jira comment for BUSY-1067 recording the epic-level QA verdict, and
one for BUSY-1117 if the AC5 answer from E8 changes its position. BUSY-1117 is closed Done with no
QA comment on it at all, so if E8 settled AC5 that is worth saying on the ticket.

STEP 4 - List anything still UNKNOWN or unsubstantiated, and anything that needs a decision from me.
Do not fill a gap with an inference.
```

---

## Loose ends this plan deliberately does not fix

These came out of checking the record before writing the plan. None of them blocks the pass, and
none is QA's to close alone.

1. **BUSY-1117 is closed Done with no QA comment on the ticket at all**, and its five AC checkboxes
   are still unticked, unlike 1115 and 1116. The AC1 descope request exists only on the Confluence
   page, addressed to nobody, and was never accepted or rejected on the record. The re-run has since
   made it moot, which is worth one comment.
2. **Epic BUSY-1067 is still In Progress** with all five children Done. This pass is what closes it.
3. **The E2E handover page (1894973441) still tells downstream readers that the alerts topic has
   zero subscribers and nobody will be told.** That has been false since 19 Aug. It is the page the
   E2E testers and the DC team will actually read, and it is the most misleading sentence in the set.
4. **Page 1894088713 still carries both "80+ minutes" and "94 minutes"** with nothing saying they
   describe two different runs, the corrupted-secret attempt and the blank-secret run.
5. **Nothing notifies on recovery.** `OKActions` and `InsufficientDataActions` are empty on all four
   alarms, so an operator who gets paged is never told it cleared. Compounded by the permanently red
   DLQ alarm, which can never transition again and so can never page anyone.
