> **CLOSED 2026-09-09. Do not re-run.** TC2 written not run, TC1/TC1b/TC3/TC4/TC17 BLOCKED. Result:
> `results/06-wholesale-and-blocked.md`. It settled P2 (truncation is downstream) and raised Q40
> (`ShipTo` never reads a delivery company). It also built `../../tools/inspect-lambda-code.sh`, which is
> what makes slice 07 possible.

# Slice 06, wholesale mapping and the blocked remainder

**Cases:** TC1, TC1b, TC2, TC3, TC4, TC17
**Depends on:** R14, which **has now run**. Read
`../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md` before starting
**Estimated:** short, and mostly writing down an answer rather than testing for one

Read only. Rewritten 2026-09-08 after R14 reported. The pre-R14 version is in
`_to_delete/06-wholesale-and-blocked.md.pre-R14`.

## What R14 settled, and it is not what this slice was written to expect

The old version of this slice framed TC2 as a two-way question: the LLD says WHOLESALE is in the
outbound family with its own materialiser and sender, the ticket says it rides ECOM's records and
sender, and R14 would say which. **R14 came back with a third answer, at full-history strength.**

MEASURED, `scan-order-type-distribution.sh`, full-table scans of both tables:

* `staging-orders-v2`, `SK = 'ORDER'`: 13,054 header rows of 125,185 items. `orderType` values:
  12,964 MISSING, **90 ECOM, nothing else**
* `staging-shipments`, `SK` prefix `SHIPMENT#`: 30,802 header rows of 179,097 items. `orderType`
  values: 30,714 MISSING, **88 ECOM, nothing else**

**Across the complete retained history of both tables, `orderType` has only ever held one value.**
Not `WHOLESALE`, not `RTV`, not `STORE_PICK`. The MISSING bucket is expected and says nothing:
`orderType` is a CTC-only field per LLD §3, so every UNI order carries no such attribute.

R14 also swept all 137 tables in the account for `outbound`, `transfer`, `wholesale`, `rtv` and
`bt-` in the name: zero matches. Per LLD §9.2 that is expected either way, since the outbound family
was designed to live inside the two existing tables rather than in a new one, so W1b is the test that
carries the weight.

**No wholesale order has ever been stored anywhere, under any shape.** The design question this
slice was going to settle is not settled, it is untested by the build, because the build has never
had a wholesale order to route.

## The confound R14 does not break, and it is the thing to be careful about

**R14 proves nothing has ever landed. It does not prove wholesale-ness is why.**

Every wholesale order that has actually been through a poll cycle sat at a stage the deployed poller
excludes anyway: 4 at `Approved` and 43 at `Dispatched` in R13's cycle, both confirmed genuinely
wholesale by contact group (`Retailer - Domestic`, `Retailer - Majors`), and R5's one at
`Fully Picked`, which the deployed build also skips on stage per Q31. **Stage alone fully explains
every wholesale absence measured to date.** A type-based drop does not need to exist for the data to
look exactly like this.

Wholesale orders at eligible stages do exist in Cin7. R13's 24-hour listing on 2026-09-07 recorded
**13x `THE ICONIC` at `New`** and several `City Beach` and `Universal (QLD)` at `Processing`, both
LLD-eligible stages. None was polled: R13's chosen 96-minute window sat 1 to 5 hours short of them.
They were also identified by **company name only**, which R13 disproved as a signal in the same
session when `#262210` (`Noosa Post Office`) resolved to genuine `Retail - Ecomm`.

**So Q35 has never separated, and no scan can separate it.** Only a confirmed-wholesale order at
`New` or `Processing`, put through one real cycle, distinguishes "dropped because wholesale" from
"never tested, because every one we watched was at an excluded stage". That is R14's W1c, and it is
the single highest-value outstanding test on this thread.

## What that does to each case

**TC2 is written, not run.** Its verdict is: **no wholesale record family is in use, because no
wholesale order has ever reached AWS.** MEASURED, full retained history of both tables, R14 W1b.
Record it as such, with the scan counts attached, and write both wholesale drift rows in `QA-DOC.md`
as **unresolved by the build** rather than as settled either way. The LLD and the ticket still
disagree, and nothing in the deployed system arbitrates between them, which is a finding for
Lachlan and Kian rather than a QA verdict.

**TC1, TC1b, TC3 and TC4 are BLOCKED, and the blocker changed.** They were blocked on "a wholesale
order in the polled window, population unmeasured". They are now blocked on something stronger and
more useful: **wholesale orders are being silently dropped before they reach AWS at all**, which is
Q35, open with Kian. Record the new blocker with the R14 evidence, and do not plan a fixture hunt
for them. There is nothing to hunt.

Two things worth carrying into those rows:

* **Contact group is the only reliable order-type signal.** A company name in the shipping fields is
  not: R13's `#262210` looked wholesale by company name and resolved to genuine `Retail - Ecomm`. Any
  future case identifying a wholesale order by company name is testing nothing.
* **The `Approved` versus `Dispatched` asymmetry is the sharp end of this**, and R14 sharpened it.
  In one cycle, 4 confirmed-wholesale orders at `Approved` were counted correctly in
  `skippedStages={"Approved":4}`; 43 confirmed-wholesale orders at `Dispatched` produced no counter,
  no log line, no metric, and did not hit `skippedLocallyTerminal`, which was 0 and is the obvious
  place a terminal-stage record would register. That is Q38, now at TRIED 2 and raisable.

**TC1b may still be reachable, and it is the one case worth checking.** The 25-character `ShipTo`
truncation is only a wholesale case if the truncation happens in the poller. If it happens in the
materialiser or the sender, it runs off the synthetic harness with a long `deliveryCompany` and needs
no wholesale order at all. Slice 01 Gate A did not settle where truncation lives. Establish it from
the deployed functions, and if it is downstream, **propose moving TC1b into slice 04** rather than
leaving it blocked here. That is P2 in `PROPOSALS.md`.

## TC17, and why it stays blocked

Unchanged by R14. Two independent blockers, and the second is the real one.

1. It needs a shipment the DC has actually waved in SCALE staging. All 79 CTC shipments there are
   `OPEN`, and the DC team is not yet looking at Manhattan.
2. **It has no defined pass.** Nothing in the ticket or the LLD says how the sender tells a retryable
   rejection from a permanent one. Both arrive as an HTTP 200 carrying `rejectedTransactions > 0`.
   **BUSY-1159's AC8 treats that response as retryable and redrives it; this ticket's AC5 wants the
   same response classified permanent and landed in the DLQ.** Contradictory requirements against an
   identical observable. BUSY-1162 owns the taxonomy and is still To Do.

Record it as BLOCKED with both reasons. **The question is fair to raise**: it is new, not one of the
ones already answered, and it is a design gap rather than a testing one, so Lachlan rather than Kian
on current evidence.

Do not attempt a workaround. A synthetic post-wave rejection would need SCALE in a state we cannot
put it in, and even then there is no agreed correct answer to compare against.

## W1c, and a correction to what this slice first said about it

**R14's W1c was not attempted.** It needs a confirmed-wholesale order at `New` or `Processing`, a
watermark write and the schedule enabled for one cycle, which is one of R14's own stop conditions.

**Correction, 2026-09-08.** The first version of this slice said W1c's marginal value had dropped now
that W1b has run, following R14's own result file. **That reasoning is wrong and is withdrawn.** W1b
measures that nothing has ever landed; it cannot say why, because stage and type are confounded in
every observation to date. W1c is the only test that separates them, so its value is higher than R14
credited, not lower.

What it needs, and the order matters:

1. A **confirmed-wholesale** order at `New` or `Processing`, resolved by **contact group**, not by
   company name. `find-cin7-sales-order.sh --with-contact` does this. Company name alone is how
   `#262210` was nearly taken for wholesale.
2. A window counted over `[candidate watermark - 5 min, now]`, taking the smallest window that holds
   it, and re-counted immediately before enabling.
3. One scheduled cycle, then disable and unset the watermark.
4. Then hunt the created record by reference, by `origin`, and by every `orderType` value W1b turned
   up, which is `ECOM` and nothing else.

**Do not run it from this slice.** It writes the watermark and enables the schedule, which slices 01
to 05 are built to avoid. It runs from the RETEST plan where it was written, and **JJ runs the Cin7
side himself**. Cin7 candidates are perishable: `modifiedDate` is mutable current state, so a
candidate found yesterday cannot be recovered today, and a fresh listing is needed each time.

**Either outcome is worth having.** The order lands, and wholesale rides the native family, which
settles Q35 against the LLD and makes TC1, TC1b, TC3 and TC4 runnable. The order is dropped at an
eligible stage, and the silent drop is confirmed as type-based, which is a defect finding and goes to
Kian with the whole R5, R11, R13, R14 chain attached.

## Stop and ask JJ if

* the deployed system turns out to route wholesale somewhere R14's scans would not have seen, which
  would contradict a full-history scan and needs explaining before any verdict
* TC1b's truncation turns out to be downstream, since that is a case moving between slices
* anything here starts to need the poller schedule or a watermark write. Nothing in this slice
  should

## Write results to

`results/06-wholesale-and-blocked.md`, then update `STATE.md`, the six case rows in `QA-DOC.md`, and
both wholesale drift rows. Cite R14's result file rather than restating its numbers a third time.

Tag every claim MEASURED, INFERRED or UNKNOWN.
