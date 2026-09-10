# Manual checks, parallel to R11

2026-09-07. None of these needs AWS or the IDE session, so they run alongside R11. M1 and M2 are the
two that can retire a question before it reaches Kian, so do those first.

## M1, LLD, is wholesale exclusion designed or accidental

LLD page 1802698758, section 9.1 and the eligibility sequence around it.

* Is there a documented exclusion on order type, contact group or branch, and does it sit before or
  after the stage check.
* Is any skip counter specified by name, `skippedStages` and `skippedCounted` in particular.

**Why first:** if wholesale exclusion is designed, R5's finding drops from "silent drop" to "designed
behaviour with no counter", which is a much smaller thing to raise and may not need Kian at all. If it
is not in the LLD, the finding stands and it is also a design gap for Lachlan.

## M2, Jira, does the CTC split have a ticket

* Search the epic for a ticket covering the split Kian described on 2026-08-31 (CTC routed out a layer
  above `faulty-sale-worker-queue-handler`).
* Status of BUSY-1160 and BUSY-1161, and what else is in Sprint 41.

**Why:** if the split is ticketed and unstarted, BUSY-1158 AC5 is a sequencing question, not a defect,
and TC4f's FAIL is expected rather than reportable. If no ticket exists, that is the finding.

## M3, SCALE UI read, TC1a on R4's four orders

Order Planning > Planned Shipment Insights. Orders `261842`, `261843`, `261844`, `WOR19169A`, all sent
2026-09-04.

`261842`'s `shipmentId` is `18145142-944e-54db-9b3a-2bcc6a8e7777`. **Flagged uncertainty:** the 09-02
note says the UI is searched on `ShipmentId` with the Cin7 reference unchanged, but the shipment header
row holds a UUID. Try the Cin7 reference first, and if it does not resolve, the other three UUIDs need
one query each from the IDE session, so ask rather than guessing.

Capture the mapping read for TC1a. Two things not doable today: the update-side read (nothing has sent
an update) and TC18's SCALE half (no order over 25 characters has been sent, the 39-character candidate
R9 found is already `Dispatched`).

## M4, TC14, is it BLOCKED or NOT APPLICABLE

From the LLD or the dev handover: can a CTC ecommerce order ever reach `Fully Picked` or `Partially
Picked` in Cin7, or is picking only used on the wholesale side. Nine checks across the plan have never
found one.

If ECOM structurally cannot reach those stages, TC14 closes NOT APPLICABLE and BUSY-1159 loses one of
its two blockers. One sentence from Kian settles it if the documents do not.

## M5, Lachlan's list, one message not five

No testing needed on any of these. Group them:

* C1, C2, C3, stale acceptance criteria on BUSY-1159.
* C4, purchase orders LLD 1796702216 section 9.1 contradicting its own section 8 on the Cin7 budget.
* C5, `ShipmentID` and `ERPOrder` casing, and `Warehouse = 'UNI-CTC'` as a constant, in both HLDs.
* The `Carrier` row in the LLD per-type matrix, which currently rests on one verbal relay and needs a
  written source.
* Whether `lastEmittedPayloadHash` is a real requirement or stale text.
* The audit-table gap behind Q27: the consumer is still missing from the LLD table that section 11
  derives regression tests from, so the method that missed it is untouched.

## M6, one local hygiene item

Promote the "no width-based truncation as redaction" rule from `slices/R3-update-semantics-no-cin7-write.md`
into `CLAUDE.md`, so a session inherits it without having read R3. Recommended in
`FINDINGS-2026-09-04.md` and not yet done.
