# Slice 02 results, behavioural

Ran 2026-08-31. AWS session was live, no SSO login needed.

## Redaction incident, disclosed up front

While tracing Q27, a log filter on `staging-inventory-check-order-faulty-sale` used what looked like
a safe correlator (a UUID taken from the dispatcher's own "Successful invocation" line) and it
returned two full record dumps, including customer name, email and shipping address, for `261115`
and one order not in scope, `261116`. The UUID was not a content-free Lambda RequestId, it was the
order's own `message_group_id`/`PK` field, which also appears inside the record body this log group
dumps at INFO, so filtering on it matched the whole line. That content reached this session's
transcript and is not reproduced here or in `FINDINGS.md`, only reference numbers and structural
facts below. From that point on, all further reads of this worker used only content-free filters
(`REPORT RequestId`, exact non-PII guard phrases pulled from `check-ctc-consumer-guards.sh`, or
narrow post-hoc regex extraction piped straight through a script that never prints the matched line,
the same method TOOL-NOTES.md already established for `dc-packing-shipment-create`).

**New privacy fact, added to the existing writeup rather than repeated here in detail:**
`staging-inventory-check-order-faulty-sale`, the worker `faulty-sale-worker-queue-handler` invokes,
dumps the same unredacted record at INFO that its dispatcher does. This is a second log group with
the same problem, not previously named in `CTC-customer-data-in-cloudwatch.md`. JJ has this and is
deciding what to do with it; not edited here.

**Separately, and material to how that doc gets prioritised:** CTC/Cheap Thrills has no prior
footprint in AWS at all. Every Cin7 message this epic has produced anywhere, staging included, is the
first CTC data AWS has ever handled. Production has none of it yet. That means the exposure is not
"has this already happened in prod," it cannot have, it is "this fires on the first real order the
moment the integration ships," with no gap to catch it in afterward.

## Q27, what does the faulty sale worker do with a CTC record

**Verdict: Narrowed.**

**Wiring, MEASURED.** `faulty-sale-worker-queue-handler`'s own environment names its worker:
`WORKER_TRANS_CREATE_ORDER` resolves to `staging-inventory-check-order-faulty-sale`. That worker's
environment names what it can touch: `TABLE_NAME=staging-inventory-v2`,
`EVENT_BUS_NAME=staging-inventory-bus`, `STORE_MAP_PARAM_NAME=staging-faulty-stock-store-map`.

**Invocation shape, MEASURED, both `261115`'s window (2026-08-27T23:45 to 00:15) and `WOR19261`'s
(11:00 to 11:30).** The dispatcher calls the worker synchronously (`invocationType: RequestResponse`)
and logs the result: every invocation in both windows returned `StatusCode: 200`,
`Payload: 'null'`, for CTC and non-CTC orders alike (5 invocations in the first window, one of them
`261115`, one `261116`; 6 in the second, one of them `WOR19261`). `Failed message IDs: Set(0) {}`
every time. The worker's own `Errors` metric is 0 across both windows. Duration ranges from single
digit milliseconds to about 1.3 seconds including cold start init, with no pattern that separates CTC
from non-CTC invocations, so duration cannot be used to tell them apart.

**The one input that would decide its behaviour, MEASURED.** `staging-faulty-stock-store-map`
currently holds `{"490":"8490","407":"8490"}`. Two source store identifiers, one target. Neither of
CTC's identifiers, branch `51908`/`51909` or warehouse `CTC-QDC`, appears in it.

**What this supports, INFERRED, not proven.** If the worker's logic keys off this map (consistent
with its name and its only configured lookup), a CTC order's store identifier has nothing to match,
and the check most likely short circuits into a no-op. This is the shape of "receives and discards,"
not "receives and acts."

**What is still unknown, and could not be checked safely or cheaply.** Whether anything was written
to `staging-inventory-v2` (11.7 million items, keyed by `sku`+`store`, no index that a CTC order
reference could be looked up by, a full scan is disproportionate to a cheap read) or emitted onto
`staging-inventory-bus` for either reference specifically (no per-order metric exists for that bus;
confirming it either way would mean another read of a log group already shown to dump unredacted
records). This is the one part of Q27 that stays formally open.

**Which of the three outcomes:** not "receives and acts", nothing here shows a CTC record producing
an artefact. Closest to "receives and discards", but the specific step that would confirm it, a
table row or bus event, was not reachable without either an unreasonable scan or repeating the
redaction risk, so call it narrowed toward discard rather than confirmed.

## Q29, where does dc-packing get its company value

**Verdict: Narrowed**, matching the case the slice predicted.

**MEASURED**, narrow extraction only (company/brand fragments and the exact guard phrase from
`check-ctc-consumer-guards.sh`, never a whole line): for `261115`'s shipment, the only
company/brand-shaped fragments in `staging-shipping-v2-dc-packing-shipment-create`'s logs are
`company":"CTC`, `brand":"CTC`, `Brand":"THRILLS`, timestamped 23:49:12.552Z. The SKIP-MARKER guard
line, `shipment <uuid> is a CTC record, not for uniWMS`, fires 0.16 seconds later at 23:49:12.711Z,
on the same invocation (`REPORT RequestId: 97aa5141-...`, total execution 260.87 ms, most of the
974 ms billed being a 712 ms cold start init).

**What this means.** 260 ms of actual execution is not enough time for a real external warehouse
round trip, the kind that produced the `"company":"UNIVERSAL"` echo in BUSY-1158 slice 03's Universal
Store baseline (TC7). No such echo, or any second company/brand fragment, appears anywhere in this
invocation. The guard fires immediately after the record's own incoming fields are read, before any
external call could plausibly have completed.

**So:** the skip happens before the external warehouse call. The mid-pipeline `company` value the
UNI pipeline computes from that external response is never computed at all for a CTC order, because
the CTC order is filtered out by origin before that code runs. This answers AC8's underlying question
by the route the slice named: the explicit field cannot be what classifies a CTC order, since a CTC
order never reaches the code that would set it.

**What is still unknown.** This is timing evidence, not a source read. The exact code order (guard
before the warehouse call, not merely fast enough to look that way) was not confirmed against the
source itself, only inferred from duration and log sequence.

## Scripts written

None. Every read this slice used was either a single `aws logs filter-log-events` /
`get-metric-statistics` call at or under the three line threshold, or a narrow extraction piped
straight through a short one-off Python filter (never saved, matching the precedent set in
BUSY-1158 slice 02 for the same log group: ad hoc, single reference, promote only if reused).

## For FINDINGS.md

Both cases narrow rather than close. `FINDINGS.md` at the investigation root now covers all five
questions from both slices.
