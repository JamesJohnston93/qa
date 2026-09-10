# BUSY-1158

**Status:** full plan built, no slice has run yet.

`QA-DOC.md` is the artefact UAT and E2E read. `PLAN.md` is the order, `STATE.md` is where things
stand, and a fresh IDE session should read `CLAUDE.md` first.

## What this ticket is

The prefactor BUSY-1159 sits on. It adds the CTC fields to the order, order item and shipment
schemas, and gives every existing consumer of order and shipment events an explicit stance on CTC
records. It moves no orders itself.

## What is already evidenced

Six cases carry evidence from BUSY-1159 slices and are not re-run: TC1 and TC2 (schema fields and
header stamps), TC3 (record grain), TC4 and TC6 (the seven consumers reachable in CloudWatch,
including both reporting streams), TC8 (Universal Store orders untouched on the orders side). Each row
in the doc names its source case.

## What runs here

Three slices, in `slices/`. Slice 01 reads the real event wiring, because the LLD audit table is known
to be incomplete and everything else sweeps against what it produces. Slice 02 takes one live CTC
reference and covers the consumers the sweep never reached, the transaction payload block, and whether
the Segment guarded order actually carried an email. Slice 03 is the Universal Store regression and is
gated on a warehouse fulfilled order that staging has not yet produced.

## What is not runnable

TC1b and the declared-not-inferred half of AC1 need repo access QA does not have. TC6c is deferred by
dev until the BigQuery reporting LLD lands. Both stay in the doc as BLOCKED, because an omitted case
reads as covered.

Tools and the shared script index sit at `../../`.
