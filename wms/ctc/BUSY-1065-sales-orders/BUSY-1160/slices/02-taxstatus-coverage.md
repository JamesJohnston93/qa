> **CLOSED 2026-09-09. Do not re-run.** TC22 PASS for 3 of 4 values. Cin7's own API docs gave the
> authoritative set (`Undefined`, `Incl`, `Excl`, `Exempt`), and a code read found the `Exempt` fix
> already deployed. `Undefined` is the one residual, unhandled and not confirmed deliberate.
> Result: `results/02-taxstatus-coverage.md`.

# Slice 02, taxStatus coverage

**Case:** TC22
**Depends on:** nothing. Independent of the deployment gate, so it runs today
**Estimated:** short. Most of it is already measured, this slice turns it into a case

Read only. No Cin7 writes, no watermark writes, no config changes.

## Why this is a BUSY-1160 case at all

It is not in the ticket. It arrived from a dev answer.

An unrecognised Cin7 `taxStatus` is a hard error in the poller: the order refuses to build and alerts
rather than guessing a tax treatment. BUSY-1159 slice 08 found this live on three real orders, all
carrying `Exempt`. Asked which values the poller recognises, Kian said **he had only mapped the values
he happened to see while testing**, and said he would check the Cin7 documentation and wrap the fix
into BUSY-1160.

So the case is not "does `Exempt` fail", which is measured. It is **whether every value Cin7 can
return is either mapped or refused deliberately**, and whether the mapping the fix introduces covers
the actual population rather than the sample.

**Do not raise this with Kian again.** He answered it and the fix is his. This slice measures what the
fix has to cover, and later re-checks it once it lands.

## What is already MEASURED, do not re-derive it

* 40 log lines across the poller's whole retained history, all `Unrecognised Cin7 taxStatus "Exempt"`,
  exactly three distinct orders (`WOR19267`, `261103`, `261105`). No other value has ever tripped it.
* Population sample of 1000 orders against the poller's own filters: `Excl` 598, `Incl` 390,
  `Exempt` 12. Only those three values in the sample.
* `survey-cin7-orders.sh` was extended with a `taxStatus` counter to produce that. Additive change,
  **not reviewed by a second person.**

## Part 1, establish the value set rather than the sample

A 1000 order sample is evidence about frequency, not about the value set. A value appearing zero
times in 1000 orders is not a value that cannot occur.

1. Widen the survey. Run the `taxStatus` counter over a materially larger window than the original
   1000, and report whether any fourth value appears. State the window and the count, and say plainly
   that this is still a sample.
2. Find the authoritative list. Cin7's own documentation or API schema for the sales order
   `taxStatus` field is the only thing that closes this properly. If it enumerates the values, that
   list is the coverage target and the sample becomes supporting evidence. If it does not, say so,
   and the case closes at "no fourth value observed in N orders" rather than at "the set is these
   three".
3. Record which of the two you got. The difference matters: one is a coverage guarantee, the other is
   an observation.

## Part 2, define the pass condition for the fix

Write the expected behaviour down now, before the fix lands, so the re-check is not negotiated after
the fact.

For every value in the set from Part 1, exactly one of these must be true:

* **Mapped**, to a stated tax treatment, and an order carrying it builds and sends.
* **Refused deliberately**, with the existing hard error and alert, and a note in the code or the LLD
  saying refusal is the intended handling rather than an oversight.

The failure mode this guards against is the third case: a value that is neither mapped nor
deliberately refused, which today means a silent hard error on a real order and an alarm that reaches
nobody, since both alert topics have zero subscribers.

`Exempt` specifically: 12 in 1000, roughly 1 in 83 orders. At Cheap Thrills' volume that is not an
edge case, and the current behaviour is that those orders never reach the warehouse. Whether it should
be mapped and to what is Kian's decision, not QA's, but record the frequency alongside it so the
decision is made against a real number.

## Part 3, the re-check, only once the fix is deployed

Not part of this session unless the fix has landed. Confirm the deployment first, the way slice 01's
Gate A does.

1. Poll a window containing an `Exempt` order. `WOR19267`, `261103` and `261105` are the known ones,
   though their log windows may have aged out of the 30 day retention.
2. Confirm it either builds and sends with the mapped treatment, or still refuses with the alert.
3. Confirm no value from Part 1's set is unhandled.

## Stop and ask JJ if

* a fourth `taxStatus` value turns up in the wider survey
* the Cin7 documentation contradicts the observed values
* the fix appears to be deployed and an `Exempt` order still hard errors

## Write results to

`results/02-taxstatus-coverage.md`, then the TC22 row in `QA-DOC.md`.

Tag every claim MEASURED, INFERRED or UNKNOWN. Be explicit about which parts are sample-based.
