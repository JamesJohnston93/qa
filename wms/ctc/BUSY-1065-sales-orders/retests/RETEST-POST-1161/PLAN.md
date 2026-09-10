# Re-test plan, post BUSY-1161 deploy

Built 2026-09-09. Covers **BUSY-1158, BUSY-1159 and BUSY-1160**, because the deploy that triggered
this touches a component all three depend on.

Named for the deploy rather than the tickets, since the ticket set is what R0 decides. The existing
`RETEST-1158-1159` folder is a different, earlier pass and is untouched.

## Why this exists

Kian told JJ two things on 2026-09-09:

* "Wholesale and RTV land in the ticket I just deployed 1161"
* "I've removed the CTC-WH in this latest deploy. I've spoken with CM and everything should flow to
  the one CTC-QDC warehouse regardless of branch in Cin7"

**A fix list from a dev is a claim, not evidence.** Neither statement is scoped, dated or complete,
and neither says what else moved. Every verdict on BUSY-1160 was measured against the build recorded
in `../../BUSY-1160/results/01-deployment-gate.md`, `staging-orders-cin7-so-poller` at `LastModified
2026-09-03T01:10:45Z`.

**This has already bitten once on this epic.** Q31 was recorded `CONFIRMED` against a poller measured
2026-09-02, one day before the 2026-09-03 deploy. BUSY-1160 slice 07 only caught it because the
timestamps happened to line up. The cost was a week of downstream reasoning built on a stale premise.

## The finding that outranks the fix verification

**BUSY-1161 modifies a component every BUSY-1160 case runs through.**

Its own acceptance criteria say the outbound work adds "the outbound shipment and item payload blocks
added to the **create-transaction passthrough whitelist**, the **transaction schema**, and the **enum
lists** - writes are rejected otherwise."

That is `staging-orders-v2-create-transaction`, which BUSY-1160 slice 08 identified as the shared
handler behind every chain in the plan, native and outbound alike. It persists the `TRANSACTION` row,
enforces idempotency, applies the version guard and re-emits the domain event. **Every BUSY-1160 case
passes through it.**

It is also already known to reject on schema grounds: BUSY-1160 slice 08 Part 2 hit
`ValidationError` from this exact handler when a payload carried a status value outside its enum. So
a schema or enum change here is not theoretical, it is the failure mode this plan has already seen.

**A second, sharper exposure.** BUSY-1160's TC1b, TC2 and TC3 were proven against the outbound
pipeline on 2026-09-09. **BUSY-1161 is that pipeline, and it has just been redeployed.** Those three
verdicts are the most likely in the whole plan to be stale, and the wholesale drift row rests on them.

## Cases that passed on an absence, and are therefore at risk

A pass built on "nothing happened" cannot tell a correct skip from a consumer nobody wired up, and a
new deploy adds consumers. Listed so R0's changed-component table can be read against them:

| Ticket | Case | Passed on |
|---|---|---|
| BUSY-1160 | TC21 | A Universal Store order untouched by the update and cancel paths |
| BUSY-1160 | TC16, `Dispatched` arm | No outward event |
| BUSY-1160 | TC20 | No second send |
| BUSY-1158 | TC4d | INCONCLUSIVE already, a real skip and an unguarded run indistinguishable |

## Scope, and what a clean run does not close

**R0 sets the scope. Nothing downstream is written until it reports.**

The re-test covers only what the deploy could have flipped. Everything else stays where it is and is
worked by `busy-sweep`, one sweep at a time, not folded in here.

**Not re-testable by this plan, whatever R0 finds:**

* **BUSY-1159 TC9 and TC15.** Both already passed against a pre-deploy build and their own notes say
  they cannot be re-run on the current one. A further deploy does not change that. Handed to E2E.
* **BUSY-1158 TC1b and TC6c.** Repo access and a BigQuery LLD that has not landed.
* **BUSY-1158 TC7, TC7b, TC4f.** Recorded N/A on reasoning, not on a build state.
* **BUSY-1160 TC17.** Needs a waved shipment in SCALE, which is the DC team's, not a build matter.
* **BUSY-1160 TC6.** A case/reality mismatch. It needs rewording or deferring, which is JJ's
  decision, not a test.

**Also outstanding and not this plan's job:** BUSY-1159's slices 15 and 16 are written and have never
run. They are `busy-sweep` work and predate this deploy.

**Who signs the residue.** Whatever a clean run cannot close goes to Kian or Lachlan with the
evidence attached, per JJ's standing position: run to the limit of what QA can test, then hand over
the remainder rather than leaving it silently open.

## Sessions

| # | Session | State |
|---|---|---|
| R0 | Build identification | **Written and run 2026-09-09.** Read only |
| R1 | Targeted re-test | **Written and run 2026-09-09, all four parts complete (Part 3 across two sessions).** Part 3's first attempt stopped correctly at the Manhattan-sender anomaly; JJ amended the gate, a second session characterised it (a known, unrelated, already-registered poison message) and ran Part 3's two emits. See `results/R1-targeted-retest.md` |

Writing R1 onward from this plan alone would produce files that get voided the moment R0 reports a
changed-component table different from what the plan guessed. That is the same mistake BUSY-1160's
own plan avoided by not writing slices 03 to 06 up front.

## Environment invariants

* `aws sso login --profile staging`, region `ap-southeast-2`. SSO expires between sessions and needs
  a human in a browser.
* `cin7-watermark.sh` needs `--poller so` on every sales order call. The flag defaults to `item` and
  the wrong flag rewinds the item master feed.
* **Confirm the poller schedule state and watermark in R0. If either moved, record it, do not correct
  it.** Last recorded state: schedule DISABLED, SO watermark UNSET.
* Cin7 is CTC live production. GET only. JJ runs production API calls and writes any
  production-credentialed script himself.
* The faulty sale worker and dc-packing log groups carry unredacted customer data. Extract only the
  fields needed, never print a matched line whole.
* **No script across these plans has a second review**, by decision, until testing is done. A verdict
  resting on a script proves the script ran, not that the system behaved.

## Tools that already exist, do not rebuild

* `../../../tools/inspect-lambda-code.sh`, reads a deployed Lambda's own artifact. Has answered four questions
  without repository access.
* `../../BUSY-1160/scripts/check-cin7-order-handler-deploy.sh`, `LastModified` per function against an
  expected deploy date.
* `../../BUSY-1160/scripts/check-bus-routing-contract.sh`, every rule's event pattern and targets.
* `../../BUSY-1160/scripts/emit-synthetic-revision.sh` and `emit-synthetic-outbound-order.sh`, the
  native and outbound harnesses.
