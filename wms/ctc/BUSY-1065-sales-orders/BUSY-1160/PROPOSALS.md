# BUSY-1160 proposed cases

Cases proposed but not yet in `QA-DOC.md`, and what happened to them. A case proposed three times and
parked three times is a decision for JJ, not a slice.

| ID | Case | State | Times proposed | Last |
|----|------|-------|----------------|------|
| P1 | `taxStatus` value-set coverage, from Kian's answer that he mapped only the values he saw while testing | accepted, now TC22 | 1 | plan creation 2026-09-01 |
| P2 | Move TC1b out of slice 06 -- **settled, 2026-09-09, MEASURED by direct inspection of both deployed Lambda code packages.** `ShipTo` does not appear anywhere in `staging-orders-cin7-so-poller`'s bundle; `truncateShipTo()` (25-char ceiling, `console.warn` then `.slice(0, 25)`) lives entirely in `staging-shipping-manhattan-send-shipment`, called unconditionally from `serializeShipmentDownload`. **Accepted: TC1b runs off the synthetic harness, no wholesale order needed.** But the same read found `ShipTo` is unconditionally `fullName(address)` (firstName + lastName only) with no branch reading `address.company` at all -- so even a synthetic WHOLESALE emit would not produce "ShipTo = deliveryCompany" today. TC1b as written cannot pass until that mapping is built. See Q40 and `results/06-wholesale-and-blocked.md` | **accepted, and a new defect found underneath it** | 2 | slice 06, 2026-09-09 |
| P3 | Financial totals reconciling against a line-item mutation. `subtotal`, `grandTotal` and `taxPaid` pass through the harness from the seed unchanged, so no current case can assert this. Needs the harness extended before it is a case at all | proposed, needs harness work | 1 | slice 03, 2026-09-08 |
| P4 | Whether the reconciliation handler emits an outward event on every applied revision or only on a content-changing one. Slice 03 measured zero outward events across three content-neutral revisions and could not separate the two readings. Folded into TC11 rather than raised as its own case, but if TC11 shows no emit on a content change either, that is a defect and needs its own row | folded into TC11, slice 04 | 1 | slice 03, 2026-09-08 |
| P5 | TC6 reworded for ECOM: a revision carrying an extra unit of a SKU already on the order is treated as an addition (`added:1`), distinguishable from a new-SKU add-line. Replaces the current wording, which asserts a per-size grain no ECOM order has | proposed, from slice 04 | 1 | cleanup 2026-09-08 |
| P6 | Line identity read against the real Manhattan detail lines. AC3 turns on line identity not churning, and the identity the LLD names is the `ErpOrderLineNum` and `SKU.Item` pair in the XML. TC10 could only check the DB-side proxy, so the AC's own stated identity has never been read. One manual read of a revised shipment in Planned Shipment Insights closes it | proposed, from cleanup | 1 | cleanup 2026-09-08 |
| P7 | TC18 re-run in two further forms: a duplicate cancel against an already-cancelled order, and a cancel of an order whose shipment never reached SCALE | **done, one of two forms. Form B (duplicate cancel) run: PASS, `SalesOrderAlreadyCancelled`, clean. Narrows TC18 to Form A's missing-`ORDER`-row bug specifically. Form C not run this sitting, small follow-up** | 1 | slice 08, 2026-09-09, `results/08-final-sweep-before-dev.md` |
| P8 | AC1's downstream half by synthetic WHOLESALE payload. Cannot prove contact-group resolution (TC4, upstream) but proves everything Q40 names, at runtime rather than by code read. Also settles TC2's drift row empirically | **done, and it found more than expected.** The poller routes WHOLESALE/RTV through a dedicated `CREATE_OUTBOUND_ORDER` pipeline (Part 1b), not the native path Q40 examined -- required a new harness, `emit-synthetic-outbound-order.sh`. Two real emits: TC2/TC3 PASS, TC1b PASSES and reverses Q40, and a new real defect surfaced (Q41: Manhattan has no `CTC-WH` warehouse configured) | 1 | slice 08, 2026-09-09, `results/08-final-sweep-before-dev.md` |
| P9 | TC17's classification half by source read of the sender. The wave cannot be produced, but the blocking half is that nothing defines retryable versus permanent, and that is readable | **done: CONFIRMED.** A rejection is classified `"rejected"` and logged/alerted as permanent, exactly AC5's want. One nuance for Lachlan: classification doesn't change retry count, only logging | 1 | slice 08, 2026-09-09, `results/08-final-sweep-before-dev.md` |

## Worth considering once slices start reporting

Not proposals yet, recorded so they are not rediscovered.

* **A real-revision corroboration pass.** Every synthetic result proves handler behaviour given an
  input, not that the input occurs. One real Cin7 revision, caught opportunistically, corroborating
  any one of the slice 04 cases would lift the whole set. Worth planning before sign-off, blocks
  nothing.
* ~~**TC1b may be synthetic.**~~ Settled by slice 06, 2026-09-09. See P2 above and Q40.
