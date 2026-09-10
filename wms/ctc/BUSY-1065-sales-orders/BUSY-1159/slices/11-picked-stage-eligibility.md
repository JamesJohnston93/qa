# Slice 11, picked stage eligibility and cancellation on loss of eligibility

**Cases:** TC14, plus a retrospective observation that feeds BUSY-1160 TC15 and TC16
**Depends on:** nothing. Slices 01 to 10 are done and none is a prerequisite beyond the fixtures
**Estimated:** one session

**This slice exists to answer a question ourselves rather than ask dev.** Dev has confirmed the
intent: `New`, `Processing`, `Partially Picked` and `Fully Picked` are all eligible, matching the LLD.
Whether the deployed poller does that is QA's to establish, and we have evidence pointing the other
way. Bring him a result, not a question.

**What we already hold, and why it is not enough on its own.** Slice 08's 3 day window recorded
`skippedStages {"Fully Picked":29,"Partially Picked":3,"Fraud Warning":1}`. Slice 04 recorded that a
type-based skip leaves `skippedStages` empty (`1038295Dec26`, stage `New`, `skippedCounted 1`,
`skippedStages {}`). Together those say the picked-stage orders were skipped **on stage**. But both
are aggregates or single incidental observations, not a controlled run, and every one of the 32 was
wholesale, which is skipped on type anyway. A named order polled in a bounded window, with its
counters read, is a different quality of evidence and is what this slice produces.

## The trap that decides how this slice is built

**A manual invoke's window runs to "now" regardless of where you put the floor.** Slice 09 reset the
watermark to replay one order and caught up the entire backlog, creating and sending 5 real orders as
a side effect. The schedule has been DISABLED since 2026-08-28 and the watermark sits at
`2026-08-28T01:35:45.769Z`, so a naive reset now sweeps several days.

**So pick a target order modified in the last few hours**, and set the floor just before its
`modifiedDate`. The window is then small and the blast radius is whatever genuinely arrived today,
which is the normal cost of a cycle rather than a backfill. Record every order the cycle touches
either way.

Do not widen the window to find a target. If nothing recent exists, say so and stop; the slice is
cheap to re-run tomorrow.

## Gate A, find a target, and prefer an ECOM one

```bash
BUSY-1065-sales-orders/BUSY-1159/scripts/find-picked-stage-orders.sh --since <a few hours ago>
```

It prints company names so a wholesale account is obvious. On any candidate that does not look like a
wholesale account, resolve it properly before treating it as ECOM:

```bash
./find-cin7-sales-order.sh --reference <ref> --with-contact
```

Company name is a proxy, contact `group` is the real answer, and the order type gate keys on the
group.

* **An ECOM order at a picked stage.** Rare, never yet observed, and the strongest possible fixture:
  eligibility can be read directly from whether an order row is created, with no counter inference at
  all. Use it and say so prominently in the result.
* **Wholesale only**, which is the likely case. Still usable, but the test changes shape: a wholesale
  order is skipped on type whatever its stage, so **row creation tells you nothing and the counters
  are the entire test.** Part 2's control becomes mandatory rather than optional.
* **Nothing at either stage in the recent window.** Stop. Record the window searched. Do not widen.

Record the target's reference, `modifiedDate`, stage, branch, and resolved contact group.

## Part 1, the controlled poll

1. Snapshot the watermark: `./cin7-watermark.sh --poller so`. **Every call needs `--poller so`**, the
   script defaults to the item master poller and the wrong flag rewinds the item feed.
2. Confirm the schedule state and leave it as you found it.
3. Set the floor to just before the target's `modifiedDate`, with `--confirm`, and read it back.
4. Run one cycle: `./invoke-so-poller.sh`, or `scripts/wait-for-so-cycle.sh` if you re-enable the
   schedule instead. Do not retry on a client-side throttling error, that is the CLI's own patience
   running out while the invocation completes normally; check CloudWatch for the `REPORT` line first.
5. Read that cycle's `Cin7SOPollerCycleComplete` line in full. The counters are the result:
   `ordersFetched`, `created`, `skippedCounted`, `skippedStages`, `watermarkAdvanced`.
6. `./inspect-ctc-order.sh <reference>` for the target: does an order row exist.

### Reading it

| Observed | Verdict |
|---|---|
| Target's stage appears in `skippedStages` | **The deployed poller skips picked stages.** Contradicts the stated intent. This is the finding, and it is now evidence rather than suspicion |
| `skippedCounted` moved, `skippedStages` empty or without that stage | Skipped on type, not stage. For a wholesale target this is the **expected** result if the stage gate is correct, and it is what a correctly behaving build looks like |
| ECOM target, order row created | **Picked stages are eligible and processed.** TC14 PASS outright, nothing to raise |
| ECOM target, no row and no counter movement | Something else entirely. Do not guess, capture the cycle line and stop |

## Part 2, the control, and it is what makes Part 1 mean anything

**Mandatory when the target is wholesale.** In the same cycle if the window allows, otherwise a second
bounded cycle: a **wholesale order at stage `New` or `Processing`**, one that is stage-eligible and
type-ineligible.

That order must show `skippedCounted` incremented and its stage **absent** from `skippedStages`, the
way `1038295Dec26` did in slice 04. If it does, the two counters demonstrably discriminate, and a
picked-stage order landing in `skippedStages` is a stage-based skip. If instead its stage also appears
in `skippedStages`, then the counter records the stage of any skipped order regardless of reason,
**slice 08's evidence proves nothing, and the whole picked-stage concern evaporates.**

That second outcome would mean QA has been wrong about this since this morning. It is the single most
valuable thing this slice can find and it is why the control is not optional.

## Part 3, Q30, cancellation on loss of eligibility, read-only

Entirely retrospective. No watermark work, no polling.

Every CTC order this plan has sent is in `fixtures.md` with its `wmsSentAt`: `261115`, `WOR19261`,
`261106`, `261119`, `261110`, `261111`, `261113`, and the slice 09 backlog set `261120`, `261122`,
`261123`, `261124`, `261125`.

For each, read its **current** Cin7 stage, then check whether anything was emitted since it was sent:

```bash
./find-cin7-sales-order.sh --reference <ref>
BUSY-1065-sales-orders/BUSY-1159/scripts/list-transaction-rows.sh <ref>
./inspect-ctc-order.sh <ref>
```

* Any that are still `New` or `Processing`: nothing to learn, note and move on.
* Any now at `Dispatched`: the design says this emits nothing. Confirm no cancel transaction and no
  DELETE. A cancel here would be a defect.
* **Any now at a picked stage: this is the Q30 case, live.** If picked stages are eligible, the order
  has not lost eligibility and no cancel should exist. If a cancel or DELETE was emitted, then loss of
  eligibility is being inferred from a picked stage and a live warehouse job was deleted. That is a
  serious finding and it ties Part 1 and Part 3 together: the same wrong eligibility list would cause
  both.

**Gate the negative.** BUSY-1160 owns cancellation and is In Progress, possibly not deployed. Absence
of a cancel may mean "correct" or may mean "not built yet", and those are different. Check whether the
cancellation path is deployed before reading silence as a pass, the way BUSY-1160's slice 01 Gate A
does.

## Teardown

Restore the watermark to its snapshotted value unless leaving it forward saves a pointless re-poll,
which was the call in slice 09. Leave the schedule as you found it. Record the final watermark value
and schedule state.

## Stop and ask JJ if

* the control in Part 2 shows a stage-eligible order's stage appearing in `skippedStages`, which
  would overturn the premise
* Part 3 finds a cancel or DELETE against an order at a picked stage
* the only available target is wholesale **and** the Part 2 control cannot be run, since Part 1 alone
  proves nothing in that case
* anything would need a config change, a Cin7 write, or a window wider than a few hours

## Write results to

`results/11-picked-stage-eligibility.md`, then update `STATE.md`, TC14 in `QA-DOC.md`, and the Q30,
Q31 and Q32 entries in `../BUSY-1065-OPEN-QUESTIONS.md`.

Tag every claim MEASURED, INFERRED or UNKNOWN. If this produces a finding for dev, write it as the
evidence he needs to act on: the reference, the cycle's counter line, the window, and what a correct
result would have looked like.
