# Re-test post BUSY-1161, IDE kick-off

Open the IDE with `BUSY-1065-sales-orders/retests/RETEST-POST-1161` as the working folder, not the tooling root, or the
`../` and `../../` paths in the slice will not resolve.

`aws sso login --profile staging` first. It expires between sessions and needs a human in a browser.

## R0, build identification

    We are re-testing BUSY-1158, 1159 and 1160 after a deploy. Read CLAUDE.md, then
    PLAN.md, then run slice R0 (slices/R0-build-identification.md). Do not read any
    other slice; R1 onward do not exist yet and R0 is what decides them. Write
    results/R0-build-identification.md before you finish, including the full
    changed-component table.

Needs: nothing. Read only, no emit, no watermark write, no Cin7 call.

**R0 is the whole session.** It produces the fix list QA was never given. Its changed-component table
sets the scope for everything after it.

The gate that matters most is Gate B, the shared `staging-orders-v2-create-transaction` handler.
BUSY-1161's own acceptance criteria say it modifies that handler's schema, enum lists and passthrough
whitelist, and **every BUSY-1160 case runs through it**.

## R1, targeted re-test

    We are re-testing BUSY-1158, 1159 and 1160 after a deploy. Read CLAUDE.md, then
    PLAN.md, then results/R0-build-identification.md, then run slice R1
    (slices/R1-targeted-retest.md). Do not read any other slice. It has four parts and
    you may stop after any one; do Part 1 first regardless. Write
    results/R1-targeted-retest.md and update the BUSY-1160 plan folder and the register
    before you finish.

Needs: R0, which has run. Its changed-component table sets this slice's scope.

**Part 1 is read only and carries most of the value.** Four findings were established against
artifacts that have since been replaced, and each is one grep. It re-confirms Q30, Q31, TC17 and
TC22, and it re-checks TC18, which is the only FAIL on the ticket and is about to go to dev.

Parts 2 and 3 emit. **Part 3 opens by re-reading the stuck in-flight message on the native Manhattan
sender queue**, and does not emit toward it while that is unresolved.

Part 4 is read only and covers BUSY-1158's TC4b, which passed on a consumer that redeployed today.

## Standing

* **Cin7 is CTC production. READ ONLY, GET calls only.** Nothing in R0 needs a Cin7 call.
* **Poller schedule should be DISABLED and the watermark UNSET.** If either has moved, record it and
  tell JJ. Do not correct it.
* Extract fields, never print or pipe a whole record. A redactor must recurse.
* Use `filter-log-events` against a log group directly. `describe-log-streams` has produced a false
  "no send" read twice on the Manhattan sender.
* Tag every claim MEASURED, INFERRED or UNKNOWN.
* No em dashes or en dashes anywhere.
