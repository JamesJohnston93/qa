# BUSY-1158 proposed cases

The ledger of every case proposed for this ticket and what happened to it. It exists so a case JJ
said no to does not vanish, and so a case he keeps deferring becomes visibly persistent.

**Deferred** means propose it again next cleanup run, with the count. **Declined** means never propose
it again, and it stays listed.

| ID | Case | State | Times proposed | Last |
|----|------|-------|----------------|------|
| P1 | Shipment payload block carries `company`, `orderType`, `cin7Id` | accepted, now TC2b | 1 | plan creation |
| P2 | Confirm the Segment guarded order actually carried a customer email | accepted, now TC5b | 1 | plan creation |
| P3 | Reporting guard records a skip as debug, not an error branch | accepted, now TC6b | 1 | plan creation |
| P4 | Re-sweep the consumer audit against the real event wiring | accepted, now TC4c | 1 | plan creation |
| P5 | Universal Store order through shipment item creation, no `quantity` attribute | accepted, now TC3b | 1 | plan creation |
| P6 | Inventory service consumption on a rejected CTC shipment. Slice 01 confirmed two unconditionally wired lambdas; only a shipment leaving `OPEN` can show whether they act | declined | 2 | cleanup 2026-09-08 |
| P7 | Consumers gated on a later shipment lifecycle state, unreachable while the shipment sits at `OPEN` | accepted, now TC4e, BLOCKED on the accept or fulfil path | 1 | cleanup 2026-08-31 |
| P8 | `listOrders` gateway: the LLD says it starts working once `CTC` exists in `Stores`, so the case is whether `CTC` is there and what the query returns, not whether it has a guard | accepted, now TC9 | 2 | cleanup 2026-09-08 |

## Not proposed as cases, on purpose

* **Negative test for the Dynamoose silent drop.** Writing an undeclared attribute and confirming it
  vanishes needs write access to the orders table and proves a library behaviour, not this ticket's
  work. It stays a gotcha.
* **The outbound family records.** `OUTBOUND_ITEM#` lines, `category = OUTBOUND` and the transaction
  category enum are named in the LLD but owned by BUSY-1161 and BUSY-1219, and are not built.

## Declined, with reasons

* **P6, inventory consumption on a shipment leaving `OPEN`.** JJ, 2026-09-08: shipments only leave
  `OPEN` at fulfilment, and all handling of the shipments themselves belongs to the picks epic. This is
  the orders epic. Worth noting as an observation, which it now is in Out of scope, and needs no
  attention paid to it here. Do not propose again.
