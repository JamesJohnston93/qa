# BUSY-1160, parked

**Status:** QA doc only. No slices built, nothing runnable here yet.

`QA-DOC.md` is the doc UAT reads. It is a first draft, 22 cases, all NOT RUN.

## Why nothing has run

Updated 2026-09-08. The build **is** deployed to staging, since 2026-09-03, and the ticket is in
Review. Ten of 23 cases are answered. See `STATE.md` for current state and `KICKOFF.md` for what runs
next. The paragraph below is kept only as a record of how the plan was first framed; most
of the ticket needs an order to change in Cin7, which is production and read only, so those cases
wait on a real CTC user making a real edit. The doc marks which cases are drivable by watermark reset
and which wait on live traffic.

## The question to settle before slicing

Wholesale record family. The LLD puts WHOLESALE in the outbound family with its own materialiser and
sender, the ticket says it rides the same records and the same sender as ECOM. Which is true changes
almost every wholesale case, so TC2 in the doc settles it first.

Second open question, for dev: nothing says how the sender tells a retryable rejection from a
permanent one. Both arrive as an HTTP 200 carrying `rejectedTransactions > 0`. TC17 has no defined
pass until that is answered, and the error taxonomy that would arbitrate is BUSY-1162, still To Do.

## When picking this up

Re-run `qa-doc-cleanup` on `QA-DOC.md` first. It was drafted before the build landed, so the drift
table will have moved. Then build `PLAN.md`, `STATE.md`, `slices/` and `results/` the way
`../BUSY-1159` is laid out.
