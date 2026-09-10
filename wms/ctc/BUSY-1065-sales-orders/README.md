# BUSY-1065, Cin7 Sales Order Integration

CTC sales orders raised in Cin7 flow into the orders service, trickle down into the shipping service, and are sent to Manhattan SCALE as Shipment XML so the Arundel DC can pick and dispatch them. Four order types travel this path: ECOM, WHOLESALE, RTV and STORE_PICK.

## Tasks

| Folder | Task | QA state |
|---|---|---|
| `BUSY-1158/` | Prefactor: CTC-ready order and shipment schema, consumer guards | Jira Done |
| `BUSY-1159/` | Walking skeleton: ECOM order from Cin7 to Shipment in SCALE | Signed off with limits, page at version 18 |
| `BUSY-1160/` | Native updates: wholesale mapping, line reconciliation, cancellation | 23 cases, 1 FAIL, not signable |
| `BUSY-1161/` | Outbound family: RTV end to end | 29 cases, nothing run |

Refresh this table from each task's `STATE.md` rather than trusting it.

## Everything else here

| Path | What it is |
|---|---|
| `retests/` | Passes that span several tasks, named for the deploy or the pair they cover rather than one ticket |
| `investigations/` | Questions chased outside any one task |
| `BUSY-1065-OPEN-QUESTIONS.md` | The epic register. A new question gets the next Q number here, not a line in a result file |
| `DEFERRED-TEST-CASES.md` | Cases deliberately routed to a later ticket, each with the evidence behind it |
| `AUDIT-OPEN-ITEMS.md` | Leads from the evidence audit that were never verified |
| `CTC-customer-data-in-cloudwatch.md` | Customer data readable in CloudWatch on staging. Read before pasting raw log output anywhere |
| `results/` | Findings that belong to the epic rather than to one task |

## Source of truth

The LLD, Confluence page 1802698758, "LLD - Cin7: Sales Orders and Branch Transfers to Manhattan SCALE WMS (CTC)". Where the Jira ticket, an HLD or a dev handover disagrees with it, the LLD wins and the other artefact is a correction to raise, not a defect to log.

QA docs are published to Confluence space QD as `QA Doc - BUSY-xxxx`.

## Tooling

`../tools/cin7-sales-orders/` and `../tools/common/`. Read `../tools/SCRIPTS-INDEX.md` before writing anything.
