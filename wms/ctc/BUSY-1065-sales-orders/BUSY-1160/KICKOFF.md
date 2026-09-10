# BUSY-1160 IDE kick-off prompts

Updated 2026-09-09. **Slice 08 is open**, a final sweep before anything goes to dev. Everything
before it has run.

## Slice 08, final sweep before dev

    We are doing QA on BUSY-1160. Read CLAUDE.md, then STATE.md, then PLAN.md's rules on
    synthetic records and suppressor attribution, then run slice 08
    (slices/08-final-sweep-before-dev.md). Do not read the other slices. It has four
    parts and you may stop after any one of them; do Part 1 first regardless. Write
    results/08-final-sweep-before-dev.md, update STATE.md, QA-DOC.md,
    SYNTHETIC-REGISTER.md and the register before you finish.

Needs: nothing. The harness and `../../tools/inspect-lambda-code.sh` both exist.

**Part 1 is read only and is the highest value.** It closes Q38 from evidence already captured,
narrows Q35 to a one-line question, and gives TC17 a defined pass for the first time. If only one
part runs, run that one.

Parts 2 and 3 emit and reach SCALE staging. Part 3 is the one that was wrongly written off: AC1's
downstream half is testable with a synthetic WHOLESALE payload, and Q40 says that is where the defect
is. Part 4 is optional and probably unnecessary.

**Watch for the errors alarm in Part 2** and stop rather than purging if it fires.

## All seven slices closed

| Slice | Outcome |
|---|---|
| 01 deployment gate | Build deployed 2026-09-03, routing contract captured, `PutEvents` permitted |
| 02 taxStatus coverage | TC22 PASS for 3 of 4 values. `Undefined` is the residual |
| 03 synthetic harness and fidelity gate | Harness built, Gate A passed, TC12 PASS |
| 04 revision reconciliation | 9 of 10 PASS. TC6 not runnable as written |
| 05 cancellation and isolation | TC15, TC16, TC20, TC21 PASS. **TC18 FAIL** |
| 06 wholesale and blocked remainder | Four cases BLOCKED. Settled P2, raised Q40 |
| 07 poller cancel emit, source read | **Q30 closes negative.** Found Q31's result stale |
| R14, on the RETEST plan | No wholesale order has ever been stored |

Every slice file carries a CLOSED banner. Read the result file, not the slice.

## If work restarts on this ticket

Three small things, none a slice, all optional and none blocking sign-off.

**TC5's SCALE half.** Retracted for its own emit because the harness generated a non-numeric
`lineItemId` and the sender correctly refused it. Harness fixed. One add-line emit under the fix
confirms the new line reaches Manhattan. Closes the one gap in an otherwise clean AC2.

**TC7 and TC15's SCALE-UI reads.** Shipments `QASYN-03-TC7` and `QASYN-09-TC15` in **Order Planning
> Planned Shipment Insights**. Both traced to a Manhattan accept, but the literal line-level state is
only visible in the UI. JJ's to run, no AWS needed.

**TC6 and TC1b need a decision, not a test.** TC6 asserts a per-size grain no ECOM order has. TC1b
cannot pass while the sender never reads a delivery company into `ShipTo` (Q40).

## What a re-test would need, if dev ships a fix

The harness is `scripts/emit-synthetic-revision.sh` and the technique is documented in `CLAUDE.md`.
`../../tools/inspect-lambda-code.sh` reads a deployed Lambda's own artifact and is what settled Q30, Q40
and TC22's `Exempt` finding. Between them, most of this ticket can be re-verified without waiting on
anyone.

## Standing, if anything here is picked up again

* **Cin7 is CTC production. READ ONLY, GET calls only.** Synthetic records are created on the AWS side
  and never in Cin7. The shared Cin7 daily cap is 5,000 calls and slice 02 found it already exhausted
  once by other feeds.
* **Poller schedule stays DISABLED and the watermark stays unset.** Confirmed at the end of every
  slice. Nothing outstanding needs either.
* Every synthetic record on `SYNTHETIC-REGISTER.md` before the emit. The register and the `QASYN-`
  prefix are the only thing separating synthetic records from real ones.
* **Extract fields, never print or pipe a whole record.** A redactor must recurse and be verified
  against a known-PII sample before it is trusted.
* **`describe-log-streams` returned a stale stream list twice** on the Manhattan sender, both times
  producing a false "no send" read. Use `filter-log-events` against the log group directly.
* Tag every claim MEASURED, INFERRED or UNKNOWN.
* No em dashes or en dashes anywhere.
* Scope is this ticket's own acceptance criteria and the LLD.
