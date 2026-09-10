# Slice 02, tool fidelity gate

**Ticket:** BUSY-1161
**Cases:** none. This slice decides how much every later verdict is worth.
**Depends on:** slice 01 (component names confirmed, Gate A table in results/01)
**Estimated:** one session, mostly read only, one emit at the end

The revision tool reimplements the service's mapping rules in Python and manufactures the transaction itself rather than calling the deployed code. Its own header says so: a green end-to-end run proves the document SCALE accepts, **not** that the deployed mapper builds it.

That caveat cannot just be written into every result file and left there. This slice measures how big the gap actually is, so a later FAIL can be attributed to the system rather than to the tool, and so a later PASS is written as narrowly as the evidence deserves.

BUSY-1160 slice 03 ran the same gate against a different harness and caught two bugs before any verdict rested on them.

## Preconditions

- `results/01-build-and-environment-gate.md` exists and Gate A passed.
- `aws sso login --profile staging`.
- `../../tools/inspect-lambda-code.sh` available. The engineer's toolset has no equivalent.

## Steps

### 1. Read the deployed builders

Read `staging-orders-cin7-so-poller` with `../../tools/inspect-lambda-code.sh` and extract the real shapes of the three outbound command builders, whatever they are actually called. BUSY-1160 slice 08 found them as `buildCreateOrderCommand` and outbound counterparts; confirm rather than assume.

Capture: the measured field set for the create, update and cancel outbound commands, verbatim.

### 2. Dry-run the tool against each

Trigger: for each of create, update and cancel, run the revision tool with `--family outbound --dry-run` and print the constructed entry.

Expect: the constructed `Source`, `DetailType`, `EventBusName` and full `Detail` key set match step 1's measurement.

Capture: one constructed entry per command, in full, beside the measured shape.

Fails if: a constructed entry carries a field the real command does not, or is missing one it does. **Record every difference and its size.** A cosmetic difference narrows one verdict; a difference in a version-guard or identity field invalidates a slice.

### 3. Check the order-type substitution

The wholesale fixtures are declared generic to both types and RTV borrows them through `--order-type RTV`. TC5d rests on that being true.

Trigger: dry-run one wholesale line-level scenario as WHOLESALE and again as RTV, and diff the two constructed entries.

Expect: the order type and `AllocateComplete` differ, and nothing else that reaches SCALE does.

Capture: the diff.

Fails if: the substitution changes a field it should not, in which case TC5d proves less than it claims and its note has to say so.

### 4. One real emit

Trigger: register the next sequence number in `../BUSY-1160/SYNTHETIC-REGISTER.md`, then emit an outbound create followed by an update that changes nothing material.

Expect: both land, the update applies, no rejection.

Capture: the publish result, the handler metric lines for both, and the stored header's last-modified after each.

Fails if: the update does not reach the materialiser. Check the routing rule before reading that as a system defect.

## Teardown

Leave the order in place. It is registered, and on staging a reference cannot be cleared.

## Write results to

`results/02-tool-fidelity-gate.md`. **Step 1's measured shapes and step 2's difference list are the two things every later slice reads.** Put them in full; re-reading the artefact costs a session.

## Stop and ask JJ if

- a constructed entry differs from the deployed shape in a version-guard, identity or last-modified field
- the order-type substitution changes something that reaches SCALE
- the fidelity gate cannot be run because the function will not download
