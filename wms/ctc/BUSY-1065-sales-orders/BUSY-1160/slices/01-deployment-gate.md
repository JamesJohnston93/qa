> **CLOSED 2026-09-08. Do not re-run.** All three gates passed. Result:
> `results/01-deployment-gate.md`. Its routing note was superseded by slice 03, which found the
> contract has two stages: read `CLAUDE.md`'s routing section, not this slice's Gate B prose.

# Slice 01, deployment gate

**Cases:** none directly. This slice establishes what the rest of the plan is testing against
**Depends on:** nothing
**Estimated:** short, half a session

Read only throughout. No watermark writes, no config changes, no Cin7 calls, no injection.

**Rewritten 2026-09-08.** The 2026-09-01 version carried three gates. Gate B (wholesale record family)
and Gate C (wholesale population) moved to `../retests/RETEST-1158-1159/slices/R14-wholesale-shape-and-bundling.md`,
which measures both and was already written. Running both would mean two scans of the same tables and
two result files that can disagree. The old file is kept as `01-deployment-gate-and-family.md.bak-20260908`.

## Why this still needs running even though the build is deployed

BUSY-1160 deployed to staging on 2026-09-03 and the ticket moved to Review. That answers "is anything
there". It does not answer "what is there", and the QA doc's 23 cases were all written on 2026-08-28
against a design that had not shipped, by an author who could not see the code.

Three specific things the plan needs before slice 03 constructs its first payload.

## Gate A, characterise the deploy

1. `get-function-configuration` on `staging-orders-cin7-so-poller` and on every order handler you can
   identify. Read `LastModified` and confirm it against 2026-09-03. Note anything that did **not**
   move on that date, because a handler still carrying an August timestamp is not running this
   ticket's code.
2. **Check log recency before trusting any silence.** `staging-orders-v2-list-orders` last logged in
   September 2025 against a 2026-09-03 deploy, so its log group cannot evidence current behaviour and
   BUSY-1158 slice 05 had to invoke it read-only instead. Do the same check on every handler here
   before concluding anything from an empty log group.
3. Identify the reconciliation handlers by name. This ticket's distinctive content is the update
   handler that inserts, updates in place and marks removed, and the cancel handler that flips
   without deleting. If the LLD names them, confirm they exist. If it does not, find their log groups.
4. Note the counter vocabulary. R11 established the poller's counter set went from 6 fields pre-deploy
   to 12 post-deploy, and that `skippedStages` stopped populating on 2026-09-03. Record the current
   set so slice 04 knows what a disposition counter looks like before it needs one.

## Gate B, the routing contract slice 03 has to match

This is the part slice 03 cannot proceed without, and it has never been read.

The poller reaches the handlers by `PutEvents` onto `staging-orders-v2-event-bus`, which
`staging-orders-v2-eda-queue-populator` consumes. A synthetic transaction has to satisfy the same
routing, so the rule's event pattern is the contract.

1. `list-rules` on `staging-orders-v2-event-bus`, then `describe-rule` and read the **event pattern**
   for every rule that targets the populator or a handler.
2. Record the exact `source` and `detail-type` values a transaction must carry to route, and any
   other field the pattern filters on. Verbatim, not paraphrased.
3. List the targets per rule, so slice 04 knows every consumer a single injected event will reach.
   AC7 is "exactly one outward event per revision", and counting outward events needs the full
   target list, not an assumed one.

## Gate C, can QA write to the bus at all

Cheap, and the whole synthetic approach rests on it. Nobody has checked.

1. Confirm whether the QA `staging` role permits `events:PutEvents` on `staging-orders-v2-event-bus`.
   Read the role's own policy rather than inferring from what other scripts do, the way BUSY-1158's
   Gate A ruled out a DynamoDB table and an SSM parameter from the function's IAM role.
2. Do **not** test it by emitting something. A stray untagged event on that bus is exactly the record
   the marking rule exists to prevent, and slice 03 emits the first one deliberately and on the
   register.
3. If the permission is absent, say so plainly and stop. That is a complete session, and the answer
   is an access ask rather than a QA failure.

## Reads as

* **Everything present, pattern readable, PutEvents permitted.** Proceed to slice 03.
* **PutEvents not permitted.** Stop. The synthetic plan needs an access grant before slices 03 to 05
  can run. Slice 02 and R14 are still available and neither depends on it.
* **Handlers present but the event pattern cannot be read.** Stop and say which check defeated you.
  Do not guess a pattern and do not reverse-engineer one from a captured emit without saying that is
  what you did, because a captured emit shows what the poller sends, not what the rule accepts, and
  the two can differ in ways that only show up as silence.
* **Reconciliation handlers absent despite the deploy.** That is a finding for Kian, and it means the
  ticket is in Review against code that is not on staging. Stop and tell JJ before raising it.

## Stop and ask JJ if

* the deploy looks partial in a way you cannot characterise
* the reconciliation handlers are absent
* anything here would need a watermark write, a poll, a Cin7 call or an emit

## Write results to

`results/01-deployment-gate.md`, then update `STATE.md`. Record Gate B's event pattern verbatim in
the result file, because slice 03 reads it from there rather than re-deriving it.

Tag every claim MEASURED, INFERRED or UNKNOWN.
