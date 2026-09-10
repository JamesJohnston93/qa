# Result: Slice R2, lifecycle-gated consumers on a CTC shipment

**Ticket:** BUSY-1158, AC5
**Verdict:** **STOPPED at the precondition gate.** All 79 CTC shipment headers on staging are still
`OPEN`. TC4e stays BLOCKED, unchanged from slice 04. No cases were run.

## A documentation inconsistency, worth fixing before this slice is handed off again

This slice's own header says "**Depends on: R3**... Do not run before R3 has produced an address
change or a cancellation." `KICKOFF.md`'s revised run order says the opposite: "The slice no longer
depends on R3 producing the state change, since R3 cannot. Any route off `OPEN` will do," and lists R2
as runnable "whenever the shipment states move," independent of R3. The user's own instruction for this
session matched `KICKOFF.md`. Ran the precondition check on that basis. **The slice file
(`slices/R2-lifecycle-gated-consumers.md`) was not updated to match `KICKOFF.md`'s revision** and
should be, so the next session reading only the slice file (per the standing "read only the one slice"
rule) does not get the stale instruction.

In this run the distinction was moot either way: R3 did not move anything (stopped before touching
Cin7 or the watermark, see `results/R3-update-semantics-no-cin7-write.md`), so there is no R3-produced
fixture regardless of which dependency reading is correct.

## Preconditions

MEASURED. Staging identity confirmed.

```
./list-ctc-shipment-states.sh --stage staging --profile staging
```

Total rows scanned (entire table, this is the same full-table scan slice 04 used): 178,975.
`company=CTC` shipment headers found: **79**, `createdAt` range 2026-08-27T05:39:21Z to
2026-09-04T02:48:31Z.

**Every one of the 79 is `OPEN`.** Directly comparable to slice 04's original finding (all 70 `OPEN`
at that time); the count has grown from 70 to 79 as this pass's own sessions created and sent more
orders (R4's four, R9's discovery run touched none, R5's target never sent), but the state
distribution is unchanged: 100% `OPEN`, 0% anything else.

## TC4e and the cancellation path

**Not run.** Per the slice's own instruction: "If every CTC shipment is still `OPEN`... this slice
stops here." No shipment has moved, so none of the six named consumers (reallocation, NewStore,
Shopify, click-and-collect, `dc-packing-shipment-address-update`, `dc-packing-shipment-delete`) were
checked, and the cancellation path was not examined.

## Fails if / Inconclusive if

**TC4e stays BLOCKED**, exactly the state it has held since slice 04. Not a new finding, a
re-confirmation that the fixture still does not exist. This is not "inconclusive," it is the expected,
correctly-identified outcome of a gate that has not been met.

## Recommendation

TC4e depends on the same class of naturally-occurring fixture R9 watches for, but R9 does not
currently check shipment state directly (it watches for a Cin7-side revision, not a change to our own
shipment row's `status`). Given R3's own path to moving a shipment off `OPEN` is blocked by the
blast-radius problem in `results/R3-update-semantics-no-cin7-write.md`, and no other mechanism in this
plan moves that state, TC4e likely stays blocked until either R3 can be safely re-attempted with a
narrower window, or some other naturally-occurring event (a genuine Cin7-side cancellation reaching our
system) produces one. Worth considering as a seventh angle for the fixture watcher if R9 is extended
further, alongside R8's proposed sixth check.

## Teardown

None. Nothing was changed. `list-ctc-shipment-states.sh` is read only.
