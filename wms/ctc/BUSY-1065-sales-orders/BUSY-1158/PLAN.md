# BUSY-1158 test plan

**Ticket:** BUSY-1158, Prefactor: CTC-ready order and shipment schema + consumer guards
**Plan location:** /Users/james.johnston/Desktop/QA/wms/ctc/BUSY-1065-sales-orders/BUSY-1158

Ordered so that nothing later has to guess whether something earlier works. Slice 01 produces the
real subscriber list that slice 02 sweeps against, so it runs first even though it needs no live
order.

## Carried, not run here

Six cases in `QA-DOC.md` carry evidence from BUSY-1159 and are not re-run: TC1, TC2, TC3, TC4, TC6,
TC8. Their source case is named in the doc's Notes column. Do not re-run them to "be sure". If
something in this plan contradicts one, that is a finding for JJ.

## Not runnable

| TC | Why |
|---|---|
| TC1b | Schema declaration needs repo access QA does not have. `lastEmittedPayloadHash` already confirmed absent under BUSY-1159 TC13 |
| TC6c | Unmarked reporting rows deferred by dev until the BigQuery reporting LLD lands |
| TC4e | Needs a CTC shipment past `OPEN`. Producing one means accepting or fulfilling in SCALE, out of this pass by decision, pending dev |

Both stay in the doc as BLOCKED. An omitted case reads as covered.

## Manual cases

| TC | What | Why a human |
|---|---|---|
| TC7 | Universal Store order through the dc-packing path | Needs a genuinely warehouse fulfilled `us` or `ps` order in staging. Every real Universal Store order found so far is NEWSTORE and never reaches the shipments table. Getting one put through is a coordination job, not a CLI job |
| TC3b | Quantity-less Universal Store order through shipment item creation | Same fixture as TC7, same problem. Runs in the same sitting once the order exists |

Slice 03 holds both and is gated on that fixture. It is written so that a session can also close them
from log history if a warehouse fulfilled order already passed through, which is checked first.

## IDE cases

| TC | What | Slice | Depends on |
|---|---|---|---|
| TC4c | Read the real event wiring on both buses and produce the true subscriber list | 01 | nothing |
| TC6b | Read how the reporting guard records a skipped CTC row | 01 | nothing, uses existing log history |
| TC2b | Shipment payload block on the transaction row carries the three fields | 02 | a live CTC reference |
| TC4b | The audited consumers the CloudWatch sweep does not reach | 02 | slice 01's subscriber list |
| TC5b | The order behind the Segment guard carried a customer email | 02 | a live CTC reference |

## Order

1. **Slice 01, wiring and guard shape.** No live order needed, no blast radius, and its output is the
   input to slice 02. TC4c, TC6b.
2. **Slice 02, consumer stance on a live order.** One CTC reference, sweep everything slice 01 found.
   TC2b, TC4b, TC5b.
3. **Slice 03, Universal Store regression.** Gated on a warehouse fulfilled Universal Store order.
   TC3b, TC7.
4. **Slice 04, CTC shipment state map.** One read-only scan, no cases. It records whether any CTC
   shipment has ever left `OPEN` on its own. If one has, TC4e becomes runnable for free. If none has,
   TC4e stays BLOCKED and the scan is the evidence for why.

Slice 03 can be attempted at any point once the fixture exists. It shares no setup with the others.
