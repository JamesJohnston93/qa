# Plan D — run sheet for IDE agent sessions

> ## ✅ COMPLETE 2026-08-18 — Runs 1 and 2 passed. Runs 3, 4 and 5 dropped with reasons.
>
> **Run 1:** 20/20 CTC controls delivered, DLQ +1. **Run 2:** 5/5 UNI controls delivered from the same
> batch as a CTC poison — cross-tenant risk closed. Results: `MODEA-BATCH-CONTAINMENT-RESULTS.md`.
>
> **Runs 3/4/5 dropped:** the bisection is proven content- and tenant-agnostic, so remaining triggers route
> through the same recovery. Run 4's only real value was sharpening a **code-intent** question about the
> `weight` type guard, which a behaviour test can't answer — ask dev. Prompts retained below for the record.

**Five runs. Each self-contained. Copy the prompt, paste, go.**
**Plan:** `PLAN-D-MODEA-BATCH-CONTAINMENT.md` (Rev 2) · **Drafted:** 2026-08-18

---

## Sequencing rules — read before starting

**1. Run 1 first, and let its result decide whether Runs 4 and 5 are worth doing.**
If Run 1 comes back **DLQ +1 with controls delivered in seconds**, Mode A recovers like Mode B, the
finding downgrades to "delay only", and Runs 4/5 add little. **Run 2 is still worth doing either way** —
cross-tenant is a separate question.

**2. Run 3 must be alone.** It's the only run that touches the watermark, and real records flowing
contaminate every other run's attribution. Don't overlap it with anything.

**3. Don't rely on DLQ *depth* deltas if runs overlap.** A poison takes ~30 min to reach the DLQ, so a
later run starting sooner will muddle the arithmetic. **Attribute by `MessageGroupId`, not by depth.** All
prompts name records `QA-D-R<n>-*` for exactly this reason.

**4. Allow ~35–40 min per run** for a poison to finish its 10 retries and land. Runs 4 and 5 have several
sub-runs and will take longer.

**5. Cin7 GETs are fine. Cin7 WRITES are never fine.** Every prompt says so; it's the one constraint.

---

## ⚠ Four corrections from the final check

**1. UNI controls must use NUMERIC item codes — this would have broken Run 2.**
Per BUSY-1113, sender validation is **per company**: UNI requires **numeric** item codes, CTC requires a
non-empty product option code. So a UNI control named `QA-D-R2-UNI-CTRL1` would **fail UNI validation and
become a second poison**, confounding the entire cross-tenant test. Use numeric codes (e.g. `9100001`…),
as the earlier ID1 test did with `3141592`.

**2. `missing item_code` produces `message_group_id = "CTC#"`.**
All such records share one FIFO group, so SQS serialises them. Fine, but don't send more than one per run
and don't expect them to behave like distinct groups.

**3. Confirm coalescing before interpreting anything.** 21 distinct item codes are 21 FIFO message groups;
they *should* land in one call (Phase 2 saw real batches of 534), but it isn't guaranteed. If
`ManhattanBatch received=N` doesn't show them together, the run is void — tighten the window and re-send.

**4. The good outcome may look like "the controls were redelivered without the poison."** That's still a
PASS — it means recovery works. Don't misread a second, poison-free invocation as the test failing.

---

## Run 1 — the core answer ⭐ start here

```
Read CLAUDE.md in ~/Desktop/testing-tools (request folder access if needed), then
POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md, then PLAN-D-MODEA-BATCH-CONTAINMENT.md.

Run TIER 1 only. JJ has lifted budget and blast-radius constraints — spend AWS calls, Manhattan sends and
DLQ depth freely. THE ONE HARD CONSTRAINT: NEVER WRITE TO CIN7. GET-only, no POST/PUT/PATCH/DELETE, and no
hand-rolled equivalent via curl/aws/a script. If a test seems to need a Cin7 write, stop and tell me.
This tier needs no Cin7 calls at all — bus-injection only, no watermark writes.

The gap: when the sender's own validateItemDownload throws uncaught, the invocation aborts BEFORE the send.
We have never measured what happens to the VALID records in that same batch — all five Mode A repros were
sent one at a time, ~3 min apart, on the untested assumption that batching them would destroy the good
ones. Every fast-isolation result we cite (13-22s, 180 of 181 fine) is Mode B, where Manhattan rejects a
value and the call completes. That is not evidence for Mode A.

Steps:
1. Pre-flight read-only: check-status.sh. Confirm buffer 0/0, MEASURE the exact DLQ depth (do not assume
   19), confirm watermark UNSET, confirm sender LastModified.
2. Inject, dry-run each first, all within 60-90 seconds so they land in ONE buffer flush:
   - QA-D-R1-POISON-<ts>  with --size set to a 30-character string (the limit is 25)
   - QA-D-R1-CTRL01 ... QA-D-R1-CTRL20-<ts>, all fully valid
3. Tail sender and buffer logs.

CHECK THE DISCRIMINATOR BEFORE INTERPRETING ANYTHING. In Mode A nothing is sent, so that invocation should
show ManhattanBatch received=N and reason:"size_too_long" but NO ManhattanRequestOutcome and NO
accepted=/rejected= line. If accepted= appears you reproduced Mode B by accident — say so and re-run.
Also confirm from received=N that the poison and controls actually coalesced into ONE call. If they split
across calls the run is void — tighten the send window and re-send.

Capture: every invocation and what it received/delivered · wall-clock from first send to each control's
confirmed delivery · ApproximateReceiveCount on anything reaching the DLQ (peek non-destructively, 5s
visibility timeout, DELETE NOTHING) · final DLQ depth vs baseline, attributed by MessageGroupId not just
depth.

Note: if the controls come back in a SECOND, poison-free invocation and are delivered, that is a PASS —
recovery worked. Don't read it as a failure.

Headline result: does the DLQ gain only the poison, or the controls too? Write
MODEA-BATCH-CONTAINMENT-RESULTS.md with a Run 1 section. Tag every claim MEASURED / INFERRED / UNKNOWN,
quote log lines verbatim. Tell me which control codes need a SCALE UI lookup from me.
```

---

## Run 2 — cross-tenant ⚠ the most consequential

```
Read CLAUDE.md in ~/Desktop/testing-tools, then PLAN-D-MODEA-BATCH-CONTAINMENT.md T4, then the Run 1
results file if it exists.

Run TIER 4 only — the cross-tenant test. Budget and blast-radius constraints are lifted; disturbing the
shared staging pipeline is expected and is the point of this test. THE ONE HARD CONSTRAINT: NEVER WRITE TO
CIN7 (GET-only, no hand-rolled writes). No Cin7 calls needed here — bus-injection only, no watermark writes.

The question: the buffer is SHARED across UNI/PS/CTC, and while the coalesce key is (company, item_code)
the BATCH is not company-scoped. So a CTC record that throws uncaught may abort an invocation containing
UNI records — meaning a CTC data-entry error could block UNI item sync. That would be a cross-tenant
availability defect on a live integration outside CTC's scope. Nobody has ever tested it.

⚠ CRITICAL SETUP DETAIL — get this right or the test is meaningless. Sender validation is PER COMPANY
(BUSY-1113): UNI requires NUMERIC item codes, CTC requires a non-empty product option code. So a UNI
control with a name like QA-D-R2-UNI-CTRL1 would FAIL UNI VALIDATION AND BECOME A SECOND POISON. Use
numeric item codes for all UNI controls — e.g. 9100001 through 9100005 — the way the earlier ID1 test used
3141592. Verify in the dry-run output that each UNI control's item_code is numeric before sending.

Steps:
1. Pre-flight: check-status.sh, buffer 0/0, MEASURE exact DLQ depth, watermark UNSET.
2. Inject into ONE buffer flush, dry-run each first:
   - QA-D-R2-POISON-<ts>  --company CTC, --size a 30-character string (limit 25)
   - five UNI controls, --company UNI, numeric item codes 9100001..9100005, otherwise fully valid
3. Confirm from ManhattanBatch received=N that the CTC poison and the UNI controls actually COALESCED INTO
   ONE CALL. If they didn't, the test cannot answer the question — report that as the finding (it would
   mean batches are effectively company-isolated, which is itself good news worth stating) and do not
   force it.
4. Check the Mode A discriminator as in Run 1 (no accepted=/rejected= for the aborting invocation).
5. Measure whether the UNI records are delivered, delayed, or land in the DLQ. Record per-record latency
   and ApproximateReceiveCount.

Verdict: UNI delivered normally = blast radius is bounded, state it explicitly. UNI delayed = quantify it.
UNI in the DLQ = CROSS-TENANT DATA-AVAILABILITY DEFECT, flag it hard and prominently — it affects a live
integration outside this epic's scope.

Append a Run 2 section to MODEA-BATCH-CONTAINMENT-RESULTS.md. Tag claims MEASURED / INFERRED / UNKNOWN.
Tell me which UNI codes need a SCALE UI lookup from me.
```

---

## Run 3 — real traffic (must run alone)

```
Read CLAUDE.md in ~/Desktop/testing-tools, then PLAN-D-MODEA-BATCH-CONTAINMENT.md T3, then any existing
Run 1/2 results.

Run TIER 3 only — real traffic. THIS RUN MUST BE ALONE: it is the only one that touches the watermark, and
real records flowing would contaminate any other run's attribution. Confirm nothing else is mid-test first.

Budget constraints are lifted — Cin7 GET budget, AWS calls, Manhattan sends and DLQ depth are all fair
game, and a watermark rewind is expected. THE ONE HARD CONSTRAINT: NEVER WRITE TO CIN7. GET-only, no
POST/PUT/PATCH/DELETE, no hand-rolled equivalent. Reads and rewinds are fine; writes never are.

The point: Runs 1 and 2 use synthetic controls and prove the mechanism. This proves the actual scenario JJ
observed — REAL valid CTC updates blocked by one bad record.

Steps:
1. Pre-flight: check-status.sh, buffer 0/0, MEASURE exact DLQ depth, snapshot the current watermark value.
2. preview-cin7-sync.sh over a window of a few hours. This is for INTERPRETATION, not budget — you need to
   know which real records to expect so you can tell delivered from missing. Save the predicted set.
3. Set the watermark to that floor and --confirm. Confirm with a direct get-parameter, not script output.
   SSM lag is variable in BOTH directions — once 11 cycles / ~33 min, once 1 cycle / ~1m39s. Do not
   re-write impatiently.
4. As real records start flowing, inject QA-D-R3-POISON-<ts> (--size a 30-character string) timed to land
   in the SAME buffer flush as a batch of them. Confirm from ManhattanBatch received=N that it coalesced
   with real records — that's the whole point.
5. Reconcile: for every record the preview predicted, did it reach SCALE? Compare poller recordsEmitted
   against populator receipts and sender deliveries for that window. Any real record that went missing is
   the finding.
6. Teardown: cin7-watermark.sh --unset --confirm, confirm via direct get-parameter, wait for queues to
   drain to 0/0, record final DLQ depth and attribute every new message.

Append a Run 3 section to MODEA-BATCH-CONTAINMENT-RESULTS.md. Lead with whether any REAL record failed to
arrive. Tag claims MEASURED / INFERRED / UNKNOWN. Confirm the watermark is UNSET at the end.
```

---

## Run 4 — all five Mode A triggers

**Skip if Run 1 came back clean** (+1 and controls delivered in seconds) — breadth adds little once the
mechanism is shown safe. Worth it if Run 1 showed any impact.

```
Read CLAUDE.md in ~/Desktop/testing-tools, then PLAN-D-MODEA-BATCH-CONTAINMENT.md T2, then the Run 1
results.

Run TIER 2 only — all five Mode A triggers, 5 valid controls each, in SEPARATE buffer windows so results
stay attributable. Budget and blast-radius constraints lifted. THE ONE HARD CONSTRAINT: NEVER WRITE TO
CIN7 (GET-only, no hand-rolled writes). No Cin7 calls needed — bus-injection only, no watermark writes.

Five sub-runs, each = 1 poison + QA-D-R4-<x>-CTRL1..5:
  a) missing item_code          — note this produces message_group_id "CTC#", so all such records share ONE
                                  FIFO group and SQS serialises them. Send only one.
  b) blank desc                 — --desc-raw ""
  c) non-numeric weight         — --weight-raw abc
  d) over-length Size           — 30 chars (limit 25)
  e) over-length item_code      — 55 chars (limit 50)

Leave ~35-40 min between sub-runs so each poison finishes its 10 retries and lands before the next starts.
If you don't, attribute by MessageGroupId rather than DLQ depth arithmetic.

WATCH (c) ESPECIALLY. Non-numeric weight has NO validation check in front of it — it fails deeper as
TypeError: value.toFixed is not a function in roundToSchemaPrecision, with no reason logged. If it behaves
DIFFERENTLY from the named checks — aborts earlier, or takes controls down when the others don't — the
missing type guard has real consequences and that changes what we ask dev. If it behaves the same, it's
known-and-harmless.

Check the Mode A discriminator for each sub-run, and confirm each poison coalesced with its own controls.

Append a Run 4 section to MODEA-BATCH-CONTAINMENT-RESULTS.md with a per-trigger comparison table:
trigger | coalesced? | controls delivered? | control latency | DLQ additions. Call out any trigger that
behaves differently from the rest. Tag claims MEASURED / INFERRED / UNKNOWN.
```

---

## Run 5 — density and mixed modes

**Skip if Run 1 came back clean.** These are edge cases on top of a mechanism that would already be shown safe.

```
Read CLAUDE.md in ~/Desktop/testing-tools, then PLAN-D-MODEA-BATCH-CONTAINMENT.md T5, then the Run 1
results.

Run TIER 5 only. Budget and blast-radius constraints lifted. THE ONE HARD CONSTRAINT: NEVER WRITE TO CIN7
(GET-only, no hand-rolled writes). No Cin7 calls needed — bus-injection only, no watermark writes.

Three sub-runs, ~35-40 min apart, named QA-D-R5-*:

a) DENSITY — 3 Mode A poisons (use three different triggers) + 10 valid controls in one flush. Question:
   does bisection converge, or thrash and drag everything through repeated retries? Record how many
   invocations it takes to isolate all three and what each control's ApproximateReceiveCount reaches.

b) MIXED MODES — one Mode A poison (over-length Size, 30 chars) + one Mode B poison (dimension_uom=M) +
   5 valid controls, one flush. These two recovery paths have NEVER been exercised against each other.
   Mode A aborts before the send; Mode B completes and returns accepted/rejected counts. Question: does
   the aborting throw prevent Mode B's normal isolation from working at all? Watch carefully whether you
   ever see an accepted=/rejected= line — if Mode A aborts first, Mode B never gets evaluated, and that
   asymmetry is the finding.

c) POSITION — same 1 poison + 5 controls, sent poison-first in one flush and poison-last in another.
   Probably irrelevant; worth one line either way.

Check the Mode A discriminator throughout and confirm coalescing per sub-run.

Append a Run 5 section to MODEA-BATCH-CONTAINMENT-RESULTS.md. Tag claims MEASURED / INFERRED / UNKNOWN.
```

---

## After the runs

Update, in this order: **`POSSIBLE-DEFECTS-SENDER-BATCH-HANDLING.md`** (the Mode A row in the two-mode
table, and the plain-language summary — which currently says we couldn't measure this) →
**`DRAFT-QA-DOC-BUSY-1116.md`** §7 → **`CLAUDE.md`** failure-behaviour section → **`CTC-QA-STATE-INDEX.md`**.

**Then the dev conversation**, with a measurement instead of a question — and if Run 2 showed UNI records
affected, that conversation gets a different and much wider audience.
