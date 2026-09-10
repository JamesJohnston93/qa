# IDE kick-off prompts, Kian questions investigation

Open the IDE with `investigations/kian-questions-2026-08-31` as the working folder, or the `../../`
paths will not resolve.

Run `aws sso login --profile staging` first if the session has expired. Browser device-code flow,
needs a human.

## Slice 01, cheap reads

    We are narrowing the open questions for Kian on epic BUSY-1065. Read BRIEF.md, then run
    slice 01 (slices/01-cheap-reads.md). Do not read slice 02. Write
    results/01-cheap-reads.md before you finish. For each question say explicitly whether
    it is Closed, Narrowed or Unchanged.

Needs: nothing. Everything in it is a read.

## Slice 02, behavioural

    We are narrowing the open questions for Kian on epic BUSY-1065. Read BRIEF.md, then run
    slice 02 (slices/02-behavioural.md). Do not read slice 01, its results are in
    results/01-cheap-reads.md if you need them. Write results/02-behavioural.md, then write
    FINDINGS.md at the investigation root covering all five questions.

Needs: slice 01 done and JJ to have read its results. If slice 01 closed Q2 and Q25, the FINDINGS
sections for those are already written and slice 02 only adds Q27 and Q29.

Read the redaction rule in BRIEF.md before the first log call in this slice. It reads the two log
groups that dump whole order records in the clear.
