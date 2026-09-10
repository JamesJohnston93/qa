# Slice 02, behavioural

**Cases:** Q27 what the faulty sale worker does, Q29 where dc-packing's company value comes from
**Depends on:** slice 01 only in that JJ should have read its results first
**Estimated:** one session. Q27 is most of it. Q29 is a stretch goal, not a commitment.

**Read the redaction rule in `BRIEF.md` before your first log call.** This slice reads the two log
groups on this epic that dump whole order records in the clear. Getting this wrong puts customer
email and address into a file that goes to a developer.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
```

Have a CTC reference to hand. `261115` and `WOR19261` are the two the faulty sale worker was already
observed receiving, and both are documented in `../../BUSY-1159/fixtures.md`.

## Q27, what does the faulty sale worker actually do with a CTC record

What is already MEASURED, from BUSY-1158 slice 01: it subscribes to `TRANS_CREATE_ORDER` on its own
EventBridge rule with no origin or company filter, and it received the full record for both
references with no guard line. It is not in the LLD audit table.

**What is not known, and is the whole point of this case: does it act on them.** "Receives and
discards" and "receives and processes" are very different conversations to have with a developer, and
right now we can only say the first word of either.

Trigger: establish the worker's behaviour after receipt, without reading a record body.

1. **Its own outputs.** Read its log group with a pattern that cannot match the record dump. Match on
   completion and failure markers, not on content: `"Successful invocation"`, `"Failed message IDs"`,
   the batch item failure shape, and its own error lines. Never widen to `?"CTC" ?"skip"`, which will
   return the INFO body dump in full.
2. **What it is wired to.** `get-function-configuration` on it: read its environment variables, the
   way BUSY-1158 slice 01 resolved dispatchers to their workers by reading `WORKER_*` keys. Table
   names, queue names, topic ARNs or downstream function names in its env are the map of what it can
   touch.
3. **Whether anything moved.** For each writable target found in step 2, check for a row, message or
   invocation carrying either reference in the window each order was created. A fraud or faulty sale
   path most plausibly writes a flag, a queue message or a table row somewhere.
4. **A non-CTC baseline.** Read the same completion markers for a Universal Store order in a nearby
   window. If a CTC record and a UNI record produce the same shape of output, it is processing both
   identically. If the CTC one stops earlier, something is filtering it after receipt and before
   effect, which would change the answer materially.

Capture: invoked yes or no, completed cleanly or errored, every downstream target named in its
configuration, and for each one whether anything appeared for these references.

**The three outcomes, and say which one plainly:**

* **Receives and acts.** A CTC order produced an artefact somewhere. This stops being an open question
  and becomes a defect. Stop and tell JJ.
* **Receives and discards.** Invoked, completes, nothing downstream, same shape as a UNI order up to
  the point it stops. Q27 stays a design question, not a live problem, and the ask to Kian softens to
  "should it be in the audit table" rather than "is it mishandling CTC data".
* **Cannot tell.** Also a real answer. Say which step defeated it.

Note either way that the PII exposure is independent of all three. It receives and logs the record in
the clear regardless of what it does next, and that is already written up separately.

## Q29, where does dc-packing get its company value

What is MEASURED, from BUSY-1158 slice 03, on a warehouse fulfilled Universal Store order: incoming
record `brand: 'US'`, in-memory object `company: undefined`, an external warehouse response carrying
its own `"company":"UNIVERSAL"`, a mid-pipeline object `company: 'UNIVERSAL'`, and a final saved object
`company: null`. The persisted row has no `company` attribute.

The limit is structural: on a Universal Store order, inference from `brand` and an explicit field
agree, so no UNI order can tell them apart. Do not spend the session trying to defeat that.

Trigger: the one comparison that might discriminate. Read the same worker's logs for a **CTC**
shipment (`261115`), narrowly, extracting only `company` and `brand` fragments. Compare the sequence
against the UNI one above.

Expect: the CTC record is skipped before any of that pipeline runs, since dc-packing's guard fired on
it in BUSY-1158 slice 02 (`"is a CTC record, not for uniWMS"`).

**Narrows if:** the skip happens before the external warehouse call. That would mean the mid-pipeline
`company` value is only ever computed for orders that are already known to be UNI, which makes the
question "why compute and discard it" rather than "does it drive classification", and answers AC8 by a
different route: the explicit field cannot be what classifies a CTC order, because the CTC order never
reaches the code that sets it.

**Unchanged if:** you cannot see where in the sequence the guard fires. Say so and stop. This one is
allowed to come back empty.

## Write FINDINGS.md

This is the deliverable, and it is the reason the session exists. Written after both slices, covering
all five questions including slice 01's.

One section per question. Each one:

* the question in one line, as it would be asked
* **Closed, Narrowed or Unchanged**
* what was measured, with the evidence a developer would want to check it against
* what is still unknown, stated as a question rather than a gap
* nothing else. No method narration, no transcript, no restating the register

Write it for someone who has not read any of this and will give it four minutes. If a section runs
past a short paragraph, it is carrying method that belongs in the result file instead.

## Write results to

`results/02-behavioural.md`, then `FINDINGS.md` at the investigation root.

## Stop and ask JJ if

* the faulty sale worker turns out to act on CTC records
* answering anything here would need a write, an invoke, or a config change
* a log read returns customer data despite a narrow pattern, so the pattern needs revising before
  anything is saved to a file
