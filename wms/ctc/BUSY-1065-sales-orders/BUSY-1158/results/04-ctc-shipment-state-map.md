# Result: Slice 04, CTC shipment state map

**Ticket:** BUSY-1158
**Verdict:** Outcome 2. Every CTC shipment on staging is `OPEN`. TC4e stays BLOCKED; this scan is the
evidence. No shipment was driven, accepted, or fulfilled by this session.

Saved `scripts/list-ctc-shipment-states.sh`, copying slice 03's scan-and-paginate loop rather than
writing a new one. Full scan of `staging-shipments`, filtered to `company = CTC` shipment headers
(`begins_with(SK, "SHIPMENT#")`). **178,868 rows scanned (entire table), matching slice 03's count
exactly**, so this is a complete scan, not a first-page sample.

## Status distribution

```
OPEN: 70
```

70 CTC shipment headers exist, all of them `OPEN`. `createdAt` range: `2026-08-27T05:39:21Z` to
`2026-08-28T01:50:14Z`, a roughly 20 hour window that matches the CTC test traffic window this plan
and BUSY-1159 have both been working against. No other status value appears at all.

The BUSY-1159 DLQ references (`261070`, `261073`, `261089`) are among the population this scan
covers and were checked directly with `inspect-ctc-order.sh`: all three are `status OPEN` with
`wmsSentAt (absent)`, i.e. the sender never even reached Manhattan for them. That confirms the
slice's own expectation exactly: a sender failure is not a domain rejection and does not move a
shipment out of `OPEN`, so DLQ membership and shipment status are two independent findings, not the
same one.

Not a stop-JJ trigger: the condition is a CTC shipment in a state nobody drove deliberately, and every
one found is in the same starting state (`OPEN`), which is what a shipment looks like before anyone
drives it anywhere.

## What this means for TC4e and slice 02's unresolved consumers

No CTC record has ever exercised anything past shipment creation on staging: not fulfilled, not
rejected, not held, not address-updated, not collected, not reallocated. That is itself the finding,
not an absence of one. TC4e cannot run without either a fixture no one has yet, or driving a shipment
deliberately, which this pass has decided is out of scope (see STATE.md, "Decision, 2026-08-31") and
belongs to the confirmation leg (BUSY-1015 to BUSY-1017) instead.

This also settles the open question from slice 02 about why a dozen lifecycle-gated consumers read as
0 matches there: it was never specific to reference `261115`, every CTC shipment on staging is in the
same boat. Nothing downstream of shipment creation has a live-CTC verdict on file for anyone, not just
the one reference slice 02 used.

## Scripts written

* `scripts/list-ctc-shipment-states.sh`, decides whether TC4e is runnable. Full scan,
  `company = CTC` shipment headers, status distribution and full row list. Read only. **Not
  reviewed.**

## Teardown

None needed. Read only, nothing created, changed, or invoked.
