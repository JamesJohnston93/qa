# Slice 05, the listOrders gateway

**Ticket:** BUSY-1158
**Cases:** TC9
**Depends on:** nothing. Read only, no writes anywhere, no Cin7 calls.
**Estimated:** 10 to 15 minutes.

## Why this case exists

The LLD's consumer audit gives most consumers a skip stance. The `listOrders` gateway is different:
the LLD says it starts working once `CTC` exists in `Stores`. So the question is not whether it has a
guard, it is whether the store entry exists and what the gateway does with a CTC order as a result.
Either answer is fine, as long as it is deliberate. An accidental inclusion would put CTC orders in
front of a Universal Store consumer of that API.

## Gate A, does `CTC` exist in `Stores`

Find where the `Stores` list actually lives before assuming a table. Candidates, cheapest first: a
DynamoDB table with `store` in the name, an SSM parameter, or a constant the gateway reads. Report
which one it is and how it was found, since no script in this plan looks it up today.

Then: is there an entry for `CTC`, and what shape does it have next to a Universal Store entry.

Record MEASURED with the source, or UNKNOWN if the store list is not readable from outside the repo.
Do not infer it from the gateway's behaviour.

## Gate B, what the gateway returns

Take a known CTC order reference from `fixtures.md` or one of R13's nine (`#262208`, `#262210`,
`#262211`, `#262216`, `#262217`, `#262219`, `#262221`, `#262222`, `#262223`).

Read the gateway's own behaviour on that order. Prefer its logs over calling it. If it has to be
called, use a read path only, and say plainly in the result that it was invoked.

The three outcomes and what each means:

* **`CTC` is absent from `Stores` and the gateway returns nothing for a CTC order.** Matches the LLD.
  TC9 PASS, with the note that the exclusion rests on the store entry being absent rather than on a
  guard, so it changes the day `CTC` is added.
* **`CTC` is present and the gateway returns the order.** Also matches the LLD, but then the question
  is whether anything downstream of that API expects Universal Store orders only. Name the callers if
  the wiring shows them, and flag it rather than deciding.
* **`CTC` is present and the gateway returns nothing, or absent and it returns the order.** Neither
  matches the design. That is the finding, and it goes in the result file with the evidence.

## Deliverable

`results/05-listorders-gateway.md`. TC9's verdict, the store-list source, and which of the three
outcomes was observed. Update `STATE.md` and set TC9's row in `QA-DOC.md`. If a script was written,
add a row to `SCRIPTS.md` with its `Does NOT` line filled.

## Stop and ask JJ if

* The gateway cannot be observed without invoking a write path.
* The store list is not readable from outside the repository, in which case Gate A is UNKNOWN and
  Gate B still runs.
