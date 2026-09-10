# BUSY-1161 proposed cases

| ID | Case | State | Times proposed | Last |
|----|------|-------|----------------|------|
| P1 | Removed line's stored state and the per-line delete deriving from it, not from a payload diff | accepted, now TC5b | 1 | plan creation |
| P2 | A field cleared in Cin7 against SCALE's additive SAVE | accepted, now TC6b | 1 | plan creation |
| P3 | Older save replayed against the materialiser | accepted, now TC12 | 1 | plan creation |
| P4 | Save delivered after the header is cancelled | accepted, now TC13 | 1 | plan creation |
| P5 | Wholesale order past the event size cap | accepted, now TC14. Handed here by BUSY-1159 TC19's routing half | 1 | plan creation |
| P6 | Style expanded across several sizes, line identity on the pair | accepted, now TC15. Handed here by BUSY-1159 TC6b | 1 | plan creation |
| P7 | Wholesale order on branch `51908` after the warehouse constant landed | accepted, now TC16 | 1 | plan creation |
| P8 | Native ECOM path undisturbed by the outbound family | accepted, now TC17 | 1 | plan creation |
| P9 | First real RTV on an in-scope branch | accepted, now TC18, DEFERRED with no trigger date | 1 | plan creation |
| P10 | Removed size re-added | accepted, now TC5c | 1 | toolset review |
| P11 | The removal case run as RTV | accepted, now TC5d | 1 | toolset review |
| P12 | Duplicate size code on one line | accepted, now TC20 | 1 | toolset review |
| P13 | Zero-quantity size skipped and counted | accepted, now TC21 | 1 | toolset review |
| P14 | Line with an empty `sizes[]` array | accepted, now TC22 | 1 | toolset review |
| P15 | Delivery contact and company both absent, the withheld-ship-to alert | deferred | 1 | toolset review |
| P16 | The remaining line-level cases run as RTV, not just the removal | deferred | 1 | toolset review |
| P17 | Oversize `ShipTo` truncated at 25 characters | declined, already MEASURED twice | 1 | toolset review |
| P18 | The 101-size ordinal cap | declined, the fixture is marked not runnable end to end | 1 | toolset review |

## Deferred, and why

- **P15.** A fixture exists for it. The observable is an alert, and alerting is BUSY-1162's, with both topics carrying zero subscribers. Worth taking if TC14 shows the error path is readable without an alert subscription.
- **P16.** The fixture set is generic to both order types, so each extra RTV arm costs one command. Held back only to keep the pass at a reviewable size. TC5d is the representative arm; say the word and the rest follow.

## Declined, with reasons

- **P17** Oversize `ShipTo`. Measured twice already, on both a wholesale and an RTV payload, and the truncation warning captured both times. Re-running it proves nothing new.
- **P18** The 101-size ordinal cap. The engineer's own fixture is marked not runnable end to end. TC14 covers the payload-size limit, which is the one with a real failure mode behind it.

2 on the declined list.
