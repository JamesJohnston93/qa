# BUSY-1159 fixtures

Real values captured during the run. Filled in by the slice that discovers each one.

| Key | Value | Captured by |
|---|---|---|
| AWS profile | `staging` (SSO role AWSPowerUserAccess, account 398353400186). Session token expires; re-run `aws sso login --profile staging` if a call errors with "SSO session expired". | slice 01 |
| Watermark value at start | `2026-08-27T23:28:50.423Z` (MEASURED, poller so) | slice 01 |
| Poller schedule state at start | ENABLED (MEASURED, pre-existing, not set by this session) | slice 01 |
| Alert topic subscriber counts | `staging-orders-cin7-alerts` = 0, `staging-shipping-manhattan-alert-topic` = 0 (MEASURED, expected per Q24) | slice 01 |
| Pre-existing Stage 5 DLQ depth at start | 3 dead-lettered on `staging-shipping-manhattan-sender-dlq.fifo`, 2 in-flight on the sender queue (MEASURED, before any test traffic this run) | slice 01 |
| Found condition for TC9/TC15 | Cin7 SO `261111-SplitShipment-HARBOUR-TOWN` (id 964465, modifiedDate `2026-08-27T23:30:03Z`), reference 33 chars, exceeds 25-char ShipmentId limit. Poller logs a hard ERROR and refuses to send (`Cin7SOPollerAlert` metric, tripped `staging-orders-cin7-so-poller-alert` alarm). Order never reaches SQS, distinct from the Stage 5 DLQ dead-letters. Use this as the naturally-occurring hard-error case rather than manufacturing one. | slice 01 |
| TC1 order reference (normalised, no `#`) | `261115` (MEASURED) | slice 02 |
| TC1 order Cin7 `modifiedDate` | `2026-08-27T23:48:03Z` (MEASURED) | slice 02 |
| TC1 order `branchId` and `projectName` | `51909`, `ShopifyV2_thrills` (MEASURED) | slice 02 |
| TC1 `wmsSentAt` | `2026-08-27T23:49:16.535Z` (MEASURED) | slice 02 |
| Found condition for TC9/TC15, second source | CTC ECOM orders affected by missing SCALE staging item master entries: `261073`, `261089`, `261104` (missing SKU `TH25-318B-28`), `WOR19270` (missing SKU `WPR25-104A-10`). Retry mechanics: `maxReceiveCount 20`, `VisibilityTimeout 1500s`, so roughly 8.3 hours from first rejection to DLQ. CONFIRMED (slice 06) that `261070`, `261073` and `261089` are now actually sitting on `staging-shipping-manhattan-sender-dlq.fifo` (3 messages, matches the count first seen in slice 01). Use these directly for TC9, no need to wait for one to cycle through. | slice 02, confirmed slice 06 |
| Item master gap, answers Q8's second half | CTC item master in SCALE staging is measurably incomplete. At least 4 distinct SKUs confirmed absent via rejection messages over 2 calendar days: `TH25-318B-28`, `WPR25-104A-10`, plus 2 more references whose specific missing SKU was not captured (`261073`, `261089`). | slice 02 |
| Repeated option order reference | `WOR19261` (also the Worship reference, one order satisfies both) (MEASURED) | slice 05 |
| Worship order reference | `WOR19261` (MEASURED, already sent, `wmsSentAt 2026-08-27T11:03:15.283Z`, `packingBrandMisses:0`) | slice 05 |
| Long ship to name order reference | `261106` (MEASURED, already sent, `wmsSentAt 2026-08-27T22:19:28.005Z`, ship-to name truncated 29→25 chars, full value preserved on ADDRESS row across firstName/lastName) | slice 05 |
| Worship order known to be rejected, do not reuse for TC10 manual read | `WOR19270` (missing SKU `WPR25-104A-10`, see slice 02 fixtures) | slice 02/05 |
| Watermark value at end of slice 07 (session pause point) | `2026-08-28T00:36:50.476Z` (MEASURED, poller so). Schedule DISABLED at this point, session paused before slice 08. | slice 07, recorded at pause |
| Watermark width at first poller timeout | Not reached at 6h/24h/3 days (28.7s/91.85s/136.6s, 2/55/91 Cin7 requests). Rate approx 1.5-1.7s per request. INFERRED ceiling around 190-200 requests, roughly 6-7 days of backlog at current volume. Not pushed wider, see results/08. | slice 08 |
| New hard-error type: unrecognised taxStatus | `WOR19267`, `261103`, `261105` (MEASURED). "Unrecognised Cin7 taxStatus \"Exempt\"", tripped `staging-orders-cin7-so-poller-alert` to ALARM. Logged as Q26. | slice 08 |
| TC14 follow-up: 32 real Fully Picked/Partially Picked orders, 3 day window | All wholesale (Hillzeez Subculture, Universal (QLD), Ozmosis, THE ICONIC and 14 more), zero ECOM (MEASURED, checked by company name, one confirmed directly: `UQLD160-3709`, `memberCostCenter "Cin7 Wholesale"`). TC14 stays BLOCKED. | slice 08 |
| Watermark value at end of slice 08 | `2026-08-28T01:35:45.769Z` (MEASURED, poller so, restored to the slice's recorded restore point). Schedule DISABLED. | slice 08 |
| TC21 order reference | `261119` (MEASURED, modifiedDate `2026-08-28T00:30:03Z`, wmsSentAt `2026-08-28T00:31:21.129Z`, single TRANSACTION row `TRANSACTION#1787877056557`) | slice 09 |
| Watermark value at end of slice 09 | `2026-08-28T01:35:45.769Z` (MEASURED, poller so). Left at its natural post-invoke value, not rewound, see slice 09 result deviation note. Schedule DISABLED at this point. | slice 09 |
| Backlog catch-up side effect | A single manual invoke after the schedule had been off for about an hour created and sent 5 real orders in one cycle: `261123`, `261122`, `261124`, `261125`, `261120` (MEASURED). Not part of any test case, a consequence of the invoke window running to "now". | slice 09 |
