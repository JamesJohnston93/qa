# BUSY-1159 proposed cases

| ID | Case | State | Times proposed | Last |
|----|------|-------|----------------|------|
| P1 | `lastEmittedPayloadHash` written on create | accepted, now TC13 | 1 | plan creation |
| P2 | One hard error order does not block valid orders in the same cycle | accepted, now TC15 | 1 | plan creation |
| P3 | Message group is the order key, not the literal `undefined` | accepted, now TC16 | 1 | plan creation |
| P4 | Watermark width at which the poller times out | accepted, now TC17 | 1 | plan creation |
| P5 | Consumer guard sweep on the first real CTC ecom order | accepted, now TC12 | 1 | plan creation |
| P6 | Eligibility of `Fully Picked` and `Partially Picked` orders | accepted, now TC14 | 1 | plan creation |
| P7 | Ship to name over 25 characters | accepted, now TC18 | 1 | plan creation |
| P8 | Alarm existence and alert topic subscriber count | accepted, now TC20 | 1 | plan creation |
| P9 | Small script pulling `deliveryCountry` from a raw Cin7 page across the ECOM population, to give Q22 a real number instead of "unmeasurable" | proposed, not yet built | 3 | cleanup 2026-09-08 |
| P10 | TC7's shipment-side UNI comparison needs a genuinely warehouse-fulfilled `us`/`ps` order (Shopify or M2 channel), not a NEWSTORE in-store order, which never reaches the shipments table at all | moved to BUSY-1158, now its TC3b and TC7 | 2 | cleanup 2026-08-30 |
| P11 | Replay suppression with the echo guard inoperative: TC13 proved the hash is never written, so name what actually stopped TC3's replay, and record whether an echo skip counter exists at all | accepted, now TC21 and TC21b | 1 | cleanup 2026-08-28 |
| P12 | `Warehouse` derived from `branchId`, 51909 to `CTC-QDC` and 51908 to `CTC-WH`. Every order tested so far was 51909, so the derivation itself is unverified, and both HLDs show a wrong constant that SCALE would accept | not now | 3 | cleanup 2026-09-08 |
| P13 | An unmapped contact group is a permanent error that alerts and is not sent. Slice 04 evidenced the skip buckets but never the alert path | not now | 3 | cleanup 2026-09-08 |
| P14 | Residual eligibility gates named in AC5 but never exercised: a DRAFT order never entering the population, and the locally dispatched guard the LLD describes as a second line of defence | not now | 3 | cleanup 2026-09-08 |
| P15 | TC13 measures the wrong thing. A payload hash does exist, as the trailing segment of every `idempotencyId`, so the case should test whether the hash is **retrievable** at the point the echo guard needs it, not whether one named attribute is present. Splits into TC13b, TC13c and TC13d | accepted, slice 13 written, not run | 1 | SCALE UI wrap-up 2026-09-02 |

## Declined, with reasons

(none yet)

Declined count: 0

## Added at the 2026-09-08 cleanup

| ID | Case | State | Times proposed | Last |
|----|------|-------|----------------|------|
| P16 | Every order a cycle fetches is accounted for by exactly one disposition counter. Read `ordersFetched` against the sum of the printed counters on a live cycle | proposed | 1 | cleanup 2026-09-08 |
| P17 | An ineligible order at stage `Dispatched` is counted in `skippedStages`, the same as one at `Approved`. AC5 names dispatched as a skip and no case currently reads the counter for it | proposed | 1 | cleanup 2026-09-08 |
| P18 | The emitted payload hash is a fixed-width, content-derived, order-varying value in `idempotencyId`'s trailing segment (slice 13's TC13b, TC13c and TC13d, which ran and have no row) | proposed | 1 | cleanup 2026-09-08 |

## Update, 2026-09-08 evening, after R14 ran

| ID | New state | Why |
|----|-----------|-----|
| P16 | **closed by measurement** | R14 ran 2026-09-08 03:13. `orderType` has only ever held `ECOM` across the full retained history of both tables, and no outbound-family table exists across all 137 in the account. MEASURED. The counter residual is fully explained by wholesale orders at `Dispatched`, and no wholesale order has ever been stored. Nothing left for a 1159 case. `../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md` |
| P17 | **closed by measurement** | Same source. The `Approved` against `Dispatched` counter asymmetry is Q38, an epic-level question with the project team, not a 1159 case |
| P18 | **still open, the only one that is** | Slice 13's TC13b, TC13c and TC13d ran and have no rows in the QA doc. **Amended: TC13c's measurement is dead.** There are two hashes, not one: `idempotencyId`'s trailing segment and `lastEmittedPayloadHash` hold different values, MEASURED on four real orders by the 2026-09-08 BUSY-1160 session. A row must not carry the superseded measurement, and must not assert a hash matching a computed expectation. Asserting one changed is fine |
| P9, P12, P13, P14 | unchanged, still "not now" at three proposals each | Carried a fourth time is a decision for JJ, not a stage |
