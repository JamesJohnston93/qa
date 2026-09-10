# BUSY-1161 test plan state

**Last updated after:** slice 02, tool fidelity gate. Two real fidelity gaps found and fixed
(cancel shape, `orderedAt` field name); one doc bug flagged for Kian; `orderId` noted, not fixed.

| Slice | Status | Result file |
|-------|--------|-------------|
| 01, build and environment gate | done, all gates pass | `results/01-build-and-environment-gate.md` |
| 02, tool fidelity gate | done, fixes landed | `results/02-tool-fidelity-gate.md` |
| 03, creation, both types | next | |
| 04, line reconciliation | blocked on 03 | |
| 05, address, field clearing, cancellation | blocked on 04 | |
| 06, guards, duplicates and the size cap | ready (independent of 03-05) | |
| 07, the Cin7-reading half | blocked, needs JJ and the schedule restored | |

29 cases. TC18 has no slice and cannot be driven.

## Open items

- **SCALE staging access confirmed by JJ in slice 01 Gate C.** He can open the SCALE staging site and search Shipments. This blocker is clear; still nothing reads a Shipment back programmatically, so every "reaches SCALE" verdict from slice 03 on is still a human read in the UI.
- **TC6b has no fixture.** Clearing an optional mapped field is the one drive capability the toolset lacks. The route is to add a scenario to `make-wholesale-scenarios.py`, which its README sanctions. Slice 05 decides whether that is worth the effort or whether TC6b becomes BLOCKED on tooling.
- **TC18 cannot be scheduled.** No RTV exists on an in-scope branch. Carried as DEFERRED.
- Four drift rows in `QA-DOC.md` are unresolved. Two need Lachlan (`AllocateComplete`, the warehouse mapping), one is stale ticket text (C6, already raised), one is an open LLD point the build settled (RTV ship-to).
- **A tooling finding worth passing to Kian, not a case:** the consumer-guard sweep in the new toolset checks fewer consumers than the version validated live under BUSY-1158, and its log counting reverted to a pagination pattern the older script's comment records as producing false zeroes. Nothing here depends on it.
- **Slice 02 found and fixed two real fidelity gaps in `invoke-so-revision.sh`** (JJ's call on both): the outbound `CANCEL` command was built from the same template as `CREATE`/`UPDATE` (sent full item/address data the real cancel builder never sends), and the order-date field was named `orderDate` instead of the deployed `orderedAt` (silently dropped on save). Both fixed and re-verified; full detail in `results/02-tool-fidelity-gate.md` and `TOOL-NOTES.md`. TC7a, TC7b and TC13 (cancel-driven) can now be trusted against the fix.
- **A tooling finding worth passing to Kian:** the tool's own header comment shows a broken example for the RTV order-type substitution TC5d needs (fails exactly as documented). The working form is passing the scenario as a file path rather than a bare name; not a code bug, just a wrong example in his comment. Slice 04 (TC5d) must use the path form.
- **`orderId` on a freshly created synthetic order is a random UUID4, not the deployed poller's deterministic derivation.** JJ's call: noted, not fixed, since no case asserts `orderId`'s value.

## Notes for the next session

**TC1a's wholesale order already exists.** Slice 02 step 4 created it (`fixtures/wholesale/01-baseline.json`,
reference `982409Aug26`, `orderId 23adfe1c-b10a-4122-b5e7-bc7cbb4a52fb`, registered as seq 17 in
`../BUSY-1160/SYNTHETIC-REGISTER.md`) as its one mandatory real emit, and it already reached SCALE
(`status SENT_OUTBOUND`, `sentAt 2026-09-10T04:54:41.754Z`). Slice 03 should read it (the DB rows and
the SCALE UI) for TC1a rather than re-emitting `01-baseline` as a fresh CREATE, which would either
error (a reference is single use) or, if attempted anyway, do nothing useful. A content-neutral
`UPDATE_OUTBOUND_ORDER` was also already applied against it (same fixture, unchanged) to prove the
tool fidelity gate's step 4 — this does not consume any of `02` through `19`, all of which remain
untouched for slices 03-06's own cases.

Read `QA-DOC.md`'s drift table before writing a verdict on TC1a or TC16. Both exist because the LLD and the deployed build disagree, and the point of the case is to record what the build does, not to pass or fail it against the LLD.

Two prior runs already cover ground this plan would otherwise re-walk. `../retests/RETEST-POST-1161/results/R1-targeted-retest.md` traced a synthetic wholesale and a synthetic RTV through this chain to Manhattan acceptance on the current build. The engineer's RTV fixtures carry his own staging results from 7 and 8 September. **Neither is a QA verdict.** They say where to expect no surprises, not what to skip.
