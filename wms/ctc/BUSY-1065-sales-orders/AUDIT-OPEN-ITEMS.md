# Evidence audit, open items

From the 2026-09-02 audit of every result file against the QA doc rows built from it. The confirmed
findings were fixed the same day and are recorded in each ticket's `STATE.md`. **These are the leads
that were not verified.** Two of the four claims that were checked turned out wrong, so nothing below
is a finding until someone reads the file.

Ordered by what it would change if true. Each names the one check that settles it.

---

## 1. Q27 may be closed on a dev answer our own measurement contradicts

**Would change:** BUSY-1158's AC5, which cannot be signed while Q27 is open, and the register's rule
that a dev answer is evidence rather than settled fact.

The register closes Q27 on dev's statement that the faulty sale worker "cannot execute on a CTC order
because the fields it needs are absent". The investigation measured every invocation, CTC and non-CTC,
returning `StatusCode 200`, `Payload null`, `Errors 0`. It runs to completion. The investigation's own
verdict is "narrowed, not closed", and the write side (`staging-inventory-v2`, `staging-inventory-bus`)
was never checked.

**Check:** read `investigations/kian-questions-2026-08-31/results/02-behavioural.md` and `FINDINGS.md`
against the Q27 entry in the register. If the disagreement holds, that disagreement is the finding and
it goes to Kian, since it means the fix in flight may be aimed at the wrong thing.

## 2. TC5's PASS may cover three different mechanisms

**Would change:** an AC5 case on BUSY-1159 that currently reads as clean.

TC5 expects "no order rows, skip counters move" and passes on four references. Slice 04 says POS
orders are excluded by branch before any stage or type gate, and dispatched orders are "most likely
excluded by the Cin7 query's own server-side stage filter rather than a post-fetch skip". If so, two
of the four never reach the code that increments a counter, and confirm nothing about counter
behaviour.

**Check:** `results/04-eligibility-and-skips.md`, the TC5 section. Split the row if the mechanisms
differ.

## 3. TC7's NEWSTORE evidence may be non-diagnostic

**Would change:** an AC4 isolation case, and it is the classic absence-as-pass shape.

TC7 passes on five Universal Store orders, all NEWSTORE, none reaching the shipments table. Slice 06
says in-store sales never proceed to shipment creation at all, which is a channel characteristic, not
the CTC guard firing. The row carries a sample-size caveat but not this one. A genuinely
warehouse-fulfilled order was never tested.

**Check:** `results/06-routing-and-isolation.md`. BUSY-1158's P10 already raised the same fixture gap.

## 4. Q2 and Q25 may be closed harder than the investigation supports

**Would change:** two register closures, and Q25 carries an explicit unread flag.

Both investigation slices record their verdict as "narrowed", and Q25's slice says outright that JJ
should see the account-wide `PutEventsFailedEntriesCount` spike of about 46,000 in June 2025 before
Q25 is treated as settled. The register's Q25 entry never mentions it.

**Check:** `investigations/kian-questions-2026-08-31/results/01-cheap-reads.md` against Q2 and Q25.

## 5. TC22's note may state something slice 10 never measured

**Would change:** the note BUSY-1162 inherits, which is the whole point of the deferral.

TC22's note says a failed entry never reaches the bus so nothing lands in a DLQ, and warns that a
naive version of the case passes trivially. Slice 10 records its write half as NOT RUN. The claim may
be true of EventBridge generally, but it is not this ticket's evidence and is not labelled as
inferred.

**Check:** `results/10-putevents-partial-failure.md`.

## 6. TC16 measured an epic-scope correction that reached no document

**Would change:** Q3, and the assumed blast radius of BUSY-1258's fallback defect.

Slice 06 records that this flow was expected to be on the list of callers affected by BUSY-1258 and
was not, leaving two live hypotheses: either it was never affected, or something already isolates it.
The QA doc row records only "3 messages, all order specific".

**Check:** `results/06-routing-and-isolation.md`, TC16 section, against Q3.

## 7. Gate B's observability gaps reached no document

**Would change:** nothing on a test row, but it is a measured silent-failure risk with no owner.

Slice 01 measured that pipeline stages 3 and 4 have no DLQ at all, stage 5 has no alarm on DLQ depth
or send failure, and the poller schedule DLQ has no alarm either. TC20 covers only the four named
alarms and the subscriber counts. Nothing else carries it.

**Check:** `results/01-environment-gate.md`, Gate B. Likely a deferred case for BUSY-1162 rather than
a test here.

## 8. One consumer was measured as unresolved and never surfaced

**Would change:** BUSY-1158's TC4c, which already lists the consumers with no stance.

`orders-dn-rec-eda-queue-handler`'s env vars were read and the conclusion recorded as "UNKNOWN not
MEASURED, out of scope, but not confirmed either way". TC4c and the blockers name the Futura
dispatchers and the two inventory lambdas, not this one.

**Check:** `BUSY-1065-sales-orders/BUSY-1158/results/01-wiring-and-guard-shape.md`, TC4c section.

## 9. BUSY-1158's diagram marks checked consumers as unchecked

**Would change:** how much work the next session thinks is outstanding.

Reallocation, NewStore, Shopify and click-and-collect are shown as "unchecked" against TC4b. Slice 02
shows each was queried, returned zero matches, and was judged inconclusive because the shipment never
left `OPEN`. Checked and uninformative is not the same as untried, and the difference is a fixture,
not a session.

**Check:** `BUSY-1065-sales-orders/BUSY-1158/results/02-consumer-stance-live-order.md`.

---

## How to work these

Items 1 and 4 are register questions and need no AWS. Items 2, 3, 5, 6, 8 and 9 are read-and-compare
against a result file already on disk, so they are a Cowork session, not an IDE one. Item 7 is a
deferred-case write-up. **None of these needs a new test run.** Every one is answered by reading a file
that already exists, which is the same shape as the three errors that started this audit.
