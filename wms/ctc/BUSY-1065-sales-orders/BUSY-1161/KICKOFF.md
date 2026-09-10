# BUSY-1161 IDE kick-off prompts

Open the IDE with **this folder** as the working folder, not the tooling root, or the `../../` paths inside the slices will not resolve.

Before any slice: `aws sso login --profile staging`. It expires between sittings and needs a browser, so it is not something a session can do for itself.

The engineer's toolset is `../../tools/`, beside the epic folders. Every revision command needs `--family outbound`.

Nothing has run. Slice 01 is next.

## Slice 01, build and environment gate

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then run slice 01
    (slices/01-build-and-environment-gate.md). Do not read the other slices. It is
    read only, four gates, and Gate A's table is what every later slice scopes
    against. Write results/01-build-and-environment-gate.md and update STATE.md
    before you finish.

Needs: nothing beyond the SSO login.

## Slice 02, tool fidelity gate

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then
    results/01-build-and-environment-gate.md, then run slice 02
    (slices/02-tool-fidelity-gate.md). Do not read the other slices. Read SCRIPTS.md
    before you start, and the engineer's own CLAUDE.md at
    "~/Desktop/QA/wms/ctc/tools/CLAUDE.md". Write results/02-tool-fidelity-gate.md
    and update STATE.md before you finish.

Needs: slice 01 done, Gate A passed. `../../tools/inspect-lambda-code.sh` present, which is the only way to read a deployed artefact.

**Do not skip this one to get to the cases faster.** The revision tool rebuilds the mapping in Python rather than calling the deployed code, and its difference list is what decides how narrowly every later verdict has to be written.

## Slice 03, creation, both types

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then
    results/02-tool-fidelity-gate.md, then run slice 03
    (slices/03-creation-both-types.md). Do not read the other slices. Register every
    synthetic reference in ../BUSY-1160/SYNTHETIC-REGISTER.md before you emit it,
    and pass --family outbound on every command. Write
    results/03-creation-both-types.md, update QA-DOC.md and STATE.md before you
    finish.

Needs: slice 02 done. A SCALE staging login, or TC1a to TC1d are BLOCKED rather than run. JJ, or someone with SCALE access, available to read the Shipments.

## Slice 04, line reconciliation

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then
    results/03-creation-both-types.md for the two order references and the baseline
    line count, then run slice 04 (slices/04-line-reconciliation.md). Do not read
    the other slices. The fixtures only mean anything in sequence. Write
    results/04-line-reconciliation.md, update QA-DOC.md and STATE.md before you
    finish.

Needs: slice 03's wholesale order and its three-size order both alive and uncancelled, their references recorded. A SCALE login for each case's second half.

## Slice 05, address, field clearing, cancellation

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then
    results/04-line-reconciliation.md and results/03-creation-both-types.md for the
    order references, then run slice 05
    (slices/05-address-clearing-cancellation.md). Do not read the other slices. TC6b
    has no fixture and its first step is choosing between extending the engineer's
    generator and recording it BLOCKED. The two cancellations end both orders, so
    run them last. Write results/05-address-clearing-cancellation.md, update
    QA-DOC.md, ../BUSY-1160/SYNTHETIC-REGISTER.md and STATE.md before you finish.

Needs: slices 03 and 04 done. TC8 already recorded, because cancellation makes the sent state unreadable. A SCALE login.

## Slice 06, guards, duplicates and the size cap

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then
    results/02-tool-fidelity-gate.md, then run slice 06
    (slices/06-guards-duplicates-size-cap.md). Do not read the other slices. Use
    fresh references, not the orders from slices 03 to 05. The version cases are
    driven by re-applying an earlier fixture after a later one, since the fixtures
    ascend in last-modified value. Write results/06-guards-duplicates-size-cap.md,
    update QA-DOC.md and STATE.md before you finish.

Needs: slice 02 done. **Independent of slices 03 to 05**, so run it next if the SCALE login is what is holding those up. Only TC10 and TC20 need SCALE. Seven cases, the largest slice here; stop after TC13 and write results if context runs short.

**TC22 is the one to watch.** It has a fixture for the empty-`sizes[]` shape that BUSY-1159 carried as correction C10 with no observed occurrence. Whichever way it goes, it changes what C10 is.

## Slice 07, the Cin7-reading half

    We are doing QA on BUSY-1161. Read CLAUDE.md, then STATE.md, then
    results/01-build-and-environment-gate.md for Gate D's recorded schedule and
    watermark values, then run slice 07 (slices/07-cin7-reading-half.md). Do not
    read the other slices. Record the watermark before you move it and restore it at
    the end, confirmed with a direct get-parameter. Write
    results/07-cin7-reading-half.md, update QA-DOC.md and STATE.md before you
    finish.

Needs: **JJ present.** The watermark move and the schedule enable are his to authorise, and finding an eligible real wholesale order is a judgement call. Slices 03 to 06 done first, because restoring the schedule makes staging noisy for everything else.

## TC18 has no prompt

The first real RTV raised on branch `51908` or `51909` is a confirmation run. Nothing schedules it. It is carried in the QA doc as DEFERRED so the gap is recorded rather than assumed closed.
