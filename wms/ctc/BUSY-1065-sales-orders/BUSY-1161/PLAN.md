# BUSY-1161 test plan

**Ticket:** BUSY-1161, Outbound family: RTV end-to-end
**Plan location:** /Users/james.johnston/Desktop/QA/wms/ctc/BUSY-1065-sales-orders/BUSY-1161
**Toolset:** /Users/james.johnston/Desktop/QA/wms/ctc/tools

29 cases. The QA doc beside this file is the artefact; this file is the ordering.

## The shape of the problem

Two order types, one machinery. WHOLESALE has real Cin7 data and a full fixture set; RTV has neither. Every RTV in Cin7 sits on branch `3`, which the integration never asks for, so RTV is provable only against composed stand-ins until one is raised on `51908` or `51909`.

That asymmetry sets the ordering. Wholesale carries the line-level cases because it has the fixtures. The engineer's fixtures are generic to both types, though, so an RTV arm costs one extra command; TC5d takes the highest-value one and the rest sit in `PROPOSALS.md` as P16. TC18 exists so the real-data gap is recorded rather than assumed closed.

## Manual versus IDE, and why the split is unusual here

**Every SCALE-side confirmation is manual.** Nothing in any toolset reads a Shipment back, and a successful send logs neither the document sent nor SCALE's reply. The closest programmatic signal is the sender's own accepted-and-rejected count on the response. Everything past that is a human read in the SCALE UI.

**Manual cases**

| TC | What needs a person |
|---|---|
| TC1a to TC1d | Reading the Shipment, its Ship To block and its detail lines in SCALE |
| TC2 to TC7b, TC20 | The SCALE half of each revision. The emit and the stored-record half are IDE |
| TC9 | Choosing a real eligible wholesale order, and the judgement that SCALE matches Cin7 |
| TC18 | Cannot be scheduled. Runs the first time a real RTV appears in scope |

**IDE cases**

Everything else: every emit, every DynamoDB read, every log read, every queue and DLQ check, and the guard, duplicate and size-cap cases, which never reach SCALE at all.

## What drives a case

`invoke-so-revision.sh --family outbound --order-type <WHOLESALE|RTV> --scenario <fixture>`, from `~/Desktop/QA/wms/ctc/tools/cin7-sales-orders/`. Every mutation is a pre-built fixture; there is no free-form field edit.

The fixtures ascend in last-modified value, which is load-bearing twice over. It is how TC12 and TC13 are driven, by re-applying an earlier scenario after a later one. It is also why several scenarios only mean anything in sequence: `03` after `02`, `05` after `04`, `17` after `16`, `18` after `17`.

Fixture to case:

| Fixture | Case |
|---|---|
| `01-baseline` | TC1a, TC1b, and the older save in TC12 |
| `02-size-qty-increased`, `03-size-qty-reduced` | TC2, TC3 |
| `04-size-added`, `05-size-removed` | TC4, TC5, TC5b, TC5d |
| `06-address-changed` | TC6 |
| `08-ineligible-declined` | TC7a, TC7b, TC13 |
| `09-dispatched-terminal` | TC11 |
| `10-zero-qty-size` | TC21, and the newer save in TC13 |
| `11-single-size-line` | TC22 |
| `13-branch-qdc` | TC16's injected half |
| `14-duplicate-size-code` | TC20 |
| `16-sizes-share-one-line`, `17-middle-size-removed`, `18-removed-size-readded` | TC15, TC5c |
| `rtv/01-baseline`, `rtv/02-supplier-email` | TC1b, TC1c, TC1d |
| none | TC6b, TC14 |

**TC6b and TC14 have no fixture.** TC6b needs a scenario that clears an optional mapped field; TC14 needs a payload past the event size cap, and the engineer's nearest fixture is marked not runnable end to end. Both routes go through `make-wholesale-scenarios.py`, which its own README sanctions as the way to add a scenario. Slice 05 and slice 06 each decide whether that is worth it or whether the case becomes BLOCKED on tooling.

## Ordering

| Slice | Cases | Depends on |
|---|---|---|
| 01, build and environment gate | none | nothing |
| 02, tool fidelity gate | none | 01 |
| 03, creation, both types | TC1a, TC1b, TC1c, TC1d, TC8, TC15 | 02 |
| 04, line reconciliation | TC2, TC3, TC4, TC5, TC5b, TC5c, TC5d | 03 |
| 05, address, field clearing, cancellation | TC6, TC6b, TC7a, TC7b | 04 |
| 06, guards, duplicates and the size cap | TC10, TC12, TC13, TC14, TC20, TC21, TC22 | 02 |
| 07, the Cin7-reading half | TC9, TC11, TC16, TC17 | schedule and watermark restored, JJ present |

**TC18 has no slice.** It cannot be driven. It is carried as DEFERRED with its trigger written down: the first RTV raised on `51908` or `51909` is a confirmation run and gets watched.

Slice 07 is last on purpose. Restoring the poller schedule pulls real CTC traffic into staging continuously, which makes every other slice noisier. Run it when the injected cases are done.

Slice 06 is independent of 03 to 05, so it can run first if the SCALE login is what is holding those up. Only TC10 and TC20 need SCALE.

## Slice 01 is a gate, not a formality

The handover names six components QA has never measured, four on the `staging-shipping-inbound-` prefix that appears in no earlier plan in this folder. Slice 01 confirms they exist, when they deployed, and that the chain matches what BUSY-1160 slice 08 traced. Its changed-component table is what every later slice scopes against.

## Slice 02 is the one that stops a false pass

The revision tool reimplements the service's mapping rules in Python and manufactures the transaction itself rather than calling the deployed code. Its own header says so. A green end-to-end run therefore proves that SCALE accepts that document, not that the deployed mapper builds it.

Slice 02 measures the gap: it reads the deployed poller's own outbound command builders and compares them field by field against what the tool constructs on `--dry-run`. Every difference found is either a tool correction or a case whose verdict has to be written more narrowly. BUSY-1160 slice 03 ran the same gate against a different harness and caught two bugs before any verdict rested on them.

## Standing rules for every slice

- **`--family outbound` on every revision command.** Five fixture basenames exist in both the ECOM and outbound sets with unrelated content, and auto-resolution picks ECOM first.
- Register a synthetic record in `../BUSY-1160/SYNTHETIC-REGISTER.md` **before** emitting it, continuing that file's sequence.
- Never reuse an order reference. A reused reference materialises and then silently never sends, and the documented reset ends in a step locked to the `kian-dev` stage, so on staging a reference is single use.
- The five-minute content dedup window on the orders-to-shipping queue means an identical replay inside it is dropped silently. TC10 depends on this; every other case must avoid it.
- Allow five minutes end to end before calling a case failed.
- When a case fails, rule out the tool before recording a defect. Slice 02's measured shapes are the reference for what the tool should have sent.
- Leave the poller schedule DISABLED and the watermark UNSET at the end of any slice that changed them.
