# Slice 17, TC2b, does shipment item creation trigger reallocation for a CTC ECOM order

**DONE, 2026-09-10. Do not re-run.** Verdict **TC2b PASS, MEASURED**, applied to `QA-DOC.md`.
Evidence `results/17-tc2b-reallocation.md`. It produced corrections **C7** and **C8** in the register.
Its KICKOFF prompt has been removed.

**Ticket:** BUSY-1159 only.
**Case:** TC2b (new 2026-09-09, split out of TC2).
**Depends on:** `results/15-non-pass-sweep-1.md`, which is where this case came from. **Read that
file's S2 section before running this stage**, including its checkout caveat.
**Cost:** one stage, read only, no fixture, no Cin7 call, no watermark move, no schedule change.

**This is the only open item on BUSY-1159 that can still change a verdict.** Everything else left is
either deferred to another ticket, handed to E2E, or a cheap addition. Run this first.

## Why the case exists

TC2 used to carry two halves. The stamps half is MEASURED and stays PASS. The no-reallocation half was
PASS with an INFERRED caveat, resting on silence in poller and sender logs that had been pulled for
another purpose, and no reallocation log group had ever been identified, let alone searched.

A source read on 2026-09-09 made that inference unsafe **in the other direction**. From
`results/15-non-pass-sweep-1.md`, all MEASURED on a 2026-02-12 checkout:

* The chain is `SHIPMENT_ITEM_CREATE` to `create-shipment-items.ts`, which emits a `REALLOCATION`
  transaction, to `create-transaction.ts`, which relabels it `TRANS_REALLOCATION`, to
  `allocate-shipment-items.ts`. LLD §3's audit row has the **trigger** right and names the consumer
  one hop early.
* `create-shipment-items.ts` has two branches and no third: `if (isB2BTransfer)`, or an `else`
  commented `// Regular orders - trigger reallocation`. `grep -nE "isB2BTransfer|company|CTC"` on the
  file returns only the branch flag. No `company` guard, no `CTC` string, no `origin` filter.
* A CTC ECOM order is not a B2B transfer, so on that version of the file it takes the else branch.

**LLD §11.3 asks for two things that cannot both hold on that version.** It wants a CTC ECOM order to
produce native records "and **reallocation is not triggered**", and in the same paragraph it wants QA
to "**assert that `create-shipment-items` is unmodified**". The reallocation emit lives inside that
file. §9.2's "the reallocation path is never entered for CTC orders" and §3's `Skip` stance both hang
on which of the two actually happened.

## The caveat that governs this whole stage

The checkout read was branch `UNI-1167-cc-reminder-master`, HEAD **2026-02-12**, **no git remote
configured**, and it predates PR \#1568. It holds no `cin7`, `orders-cin7`, `so-poller` or `ctc` path.
So it evidences the **pre-CTC** shape of the existing UNI consumers, which is exactly what the §3
consumer-guard audit is a stance about, and it evidences **nothing** about what the CTC build changed.

**What the deployed build does is UNKNOWN. That is what this stage settles.**

## Why the evidence is in DynamoDB and not in a log group

LLD §3: the transaction chain "persists the audit record in the order's partition" at
`SK = TRANSACTION#<epoch-ms>`. A `REALLOCATION` emit therefore leaves an audit record carrying an
`idempotencyId` prefixed `REALLOCATION#` **in the same partition TC2 already read**.

So no log group, no event-bus rule walk, no lambda name sweep. Slice 15 S2's original step 1 planned
all three and none is needed.

## No new script. Use the one that exists

`scripts/list-transaction-rows.sh` already does this: "Lists TRANSACTION row SKs and idempotencyId for
one order's origin, redaction-safe (never the customerEmail/addressChanges/orderInfo also stored on
that row)". It is indexed in `SCRIPTS.md` against TC21b.

**Do not write a new script for the read itself.** If you wrap it in a loop over the nine references,
that wrapper is a script with logic and goes in `scripts/` with a row in `SCRIPTS.md` before it runs.
Running the existing script nine times by hand is also fine and needs no new row.

Note its Reviewed column reads "not yet", like every script in this plan. A pass here proves the
script ran as much as it proves the system behaved. Say so in the result.

## Fixtures

The nine R13 references, which are the fresh orders every current-build verdict on this ticket rests
on:

`262208`, `262210`, `262211`, `262216`, `262217`, `262219`, `262221`, `262222`, `262223`

**Normalised, no leading `#`.** The plan's notes write them as `#262208`; `inspect-ctc-order.sh`
documents `--reference` as taking the reference with no leading `#`. If `list-transaction-rows.sh`
wants an origin rather than a reference, the origin is `CTC#CIN7_SO#<reference>` per LLD §3.
**Resolve the key with the script rather than hand-building it**, and if a reference does not resolve,
say which and stop rather than assuming the partition is empty.

## Steps

1. **Baseline the read on one order first.** Run the existing script for `262208` and confirm you get
   `TRANSACTION#` rows back at all. If the partition returns nothing, the read is wrong and every
   subsequent "no reallocation" would be a false negative. **This is the step that stops this stage
   repeating slice 15 S2's original mistake.**
2. **All nine.** For each reference, list `TRANSACTION#` row SKs and `idempotencyId`, field allowlist
   only. Report every distinct `idempotencyId` prefix you see, not only the reallocation one, so the
   result shows what the partition actually holds.
3. **Count and attribute.** For each reference, state plainly: any `idempotencyId` beginning
   `REALLOCATION#`, yes or no.
4. **Then the artefact read, and only then.** `../../tools/inspect-lambda-code.sh` against the deployed
   create-shipment-items function, searching `company,CTC`. Resolve the real function name first; do
   not guess it. This is what tells the two outcomes below apart instead of inferring.

## Reads as

* **A `REALLOCATION#` record on any of the nine.** Reallocation **is** triggered for CTC ECOM orders.
  That is a **FAIL** against AC7 and against LLD §9.2, a real defect, not a partial pass. Log it with
  the references it appeared on and the `idempotencyId` values. It is the first FAIL on this ticket,
  so expect it to change the sign-off.
* **None on all nine, and `company` or `CTC` present in the artefact.** The CTC build guarded it.
  Verdict **PASS**, MEASURED. **LLD §11.3's "assert `create-shipment-items` is unmodified" is then the
  clause that is wrong**, since the file must have changed to carry the guard. That is a correction for
  Kian, recorded on the drift table, not a defect.
* **None on all nine, and no `company` or `CTC` in the artefact.** Contradiction: the mechanism has no
  guard and yet did not fire. **Stop and take it to JJ before writing a verdict.** Candidate
  explanations to name but not to assert: the CTC order took the B2B branch after all, the deployed
  create-shipment-items is a different function than the one inspected, or the emit fired and the
  audit record is written somewhere other than the order partition.
* **Step 1 returns nothing for `262208`.** The read itself is wrong. Fix the read, do not record a
  verdict.

## Stop and ask JJ if

* Step 1 comes back empty.
* The third bullet above fires.
* Any reference does not resolve to a partition.
* A `REALLOCATION#` record appears, since that is a FAIL and it changes the ticket's sign-off.
* The deployed create-shipment-items function name cannot be resolved without guessing.

## Deliverable

`results/17-tc2b-reallocation.md`, one section, carrying the per-reference table, the artefact read,
the verdict it proposes for TC2b, and the script-not-reviewed caveat. **Propose the row change, do not
edit `QA-DOC.md`**: it is at 28 cases locally, Confluence is still at version 14, and it is synced
separately once this case resolves.
