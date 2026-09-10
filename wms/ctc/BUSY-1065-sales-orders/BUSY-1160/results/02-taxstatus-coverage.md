# Result: Slice 02, taxStatus coverage

**Ticket:** BUSY-1160
**Verdict:** TC22 substantially answered, one residual item named. **Part 1 closed properly**:
Cin7's own API documentation enumerates exactly four `taxStatus` values, not the three the 1000-order
sample observed. **Part 2 answered, and it turned into Part 3 as well**, because a direct code read
found the fix has already landed: `Exempt` is now explicitly mapped in the currently deployed poller,
contradicting the historical hard-error behaviour this case was written against. The fourth
documented value, `Undefined`, is not explicitly handled and would still hard-error today if it ever
occurred -- never observed on a real order, but not confirmed deliberate either.

## Part 1, the value set

**Widening the survey did not run.** `survey-cin7-orders.sh --max-pages 16` failed on its very first
page with `HTTP 429`, `"Calls are limited to 3 per second, 60 per minute and 5000 per day."` Retried
across 4 more attempts spaced 20 seconds apart (each internally retrying once already, per the
script's own logic) -- still `429` every time. A per-second or per-minute throttle would have cleared
within that window; it did not, so this reads as the shared 5000/day cap already spent by other
traffic today (the item master and purchase order feeds share it, and this ticket's own SO poller
schedule stays disabled throughout, so it is not this plan's own usage). **Not retried further this
session** -- each attempt is itself a call against the same shared budget, and hammering it does not
help if the cap is genuinely exhausted for the day. The existing 1000-order sample (`Excl` 598,
`Incl` 390, `Exempt` 12, MEASURED 2026-09-08) stands, but per the slice's own framing that is
evidence about frequency, not coverage -- **and it is not what closes this case.**

**The authoritative list does, and it exists.** Cin7's own published API documentation
(`https://api.cin7.com/api/Help/ResourceModel?modelName=TaxStatus`) enumerates the `TaxStatus` type
directly:

| Value | Enum index | Description |
|---|---|---|
| `Undefined` | 0 | "Undefined" |
| `Incl` | 1 | "Tax inclusive" |
| `Excl` | 2 | "Tax exclusive" |
| `Exempt` | 3 | "Tax exempt" |

**MEASURED against a real, external, authoritative source, not inferred from a sample.** This is
Cin7's own published API reference, fetched read-only (a documentation page, not a call against the
live order-data API, so unaffected by the rate limit above and outside the "GET-only against
production order data" constraint's scope). **The coverage target is these four values.** The
1000-order sample already accounts for three of them; `Undefined` has never been observed in it,
and was not expected to be given what it represents (index 0, an order Cin7 has not itself computed
a tax status for) -- but "never observed in 1000" is not the same claim as "cannot occur", which is
exactly why Part 1 asked for the authoritative list rather than a bigger sample.

## Part 2 and Part 3, together -- the fix has already landed

Part 2 asked for the pass condition to be written down before checking whether the fix meets it. Part
3 said not to check unless the fix has landed, and to confirm deployment first. **Both apply now: the
same source read that answered Q30 and Q40 (slices 06/07, `inspect-lambda-code.sh` against
`staging-orders-cin7-so-poller`) shows the fix already deployed**, on the exact same 2026-09-03
build (`LastModified 2026-09-03T01:10:45Z`, identical to the timestamp `results/01-deployment-gate.md`
and slice 07 both already recorded) -- this is not a new deploy to confirm, it is the one this whole
plan has tested against from the start, and nobody had checked this specific function's tax handling
until now.

The live code:
```
function deriveOrderMoneyContext(order) {
  if (order.taxStatus === "Exempt") {
    return { currency: order.currencyCode, headerTaxRate: 0, taxStatus: "Exempt" };
  }
  if (order.taxStatus !== "Incl" && order.taxStatus !== "Excl") {
    throw new Error(`Unrecognised Cin7 taxStatus "${order.taxStatus}" for SO ${order.reference} — refusing to guess a tax treatment.`);
  }
  return { currency: order.currencyCode, headerTaxRate: order.taxRate ?? 0, taxStatus: order.taxStatus };
}
```
Called from `buildOrderCommandBody`, the shared body-builder behind `buildCreateOrderCommand`,
`buildUpdateOrderCommand` and `buildCancelOrderCommand` alike (confirmed by call-site read, not
assumed) -- this is the live path for every transaction type, not a dead or unreachable branch.

Checking every value from Part 1's authoritative set against Part 2's pass condition:

| Value | Behaviour, MEASURED from the current code | Verdict |
|---|---|---|
| `Incl` | Falls to the final branch: mapped, `headerTaxRate = order.taxRate`, builds and sends normally | **Mapped.** PASS |
| `Excl` | Same final branch, same treatment | **Mapped.** PASS |
| `Exempt` | **Explicitly mapped**, first branch: `headerTaxRate: 0`, tax-exempt treatment (confirmed downstream in `taxBreakdown`: `taxPaid: 0`, `grandTotal = subtotal`) | **Mapped -- the fix.** This directly contradicts BUSY-1159 slice 08's historical finding (40 log lines, all `Exempt`, hard-erroring on 3 real orders) -- that finding was correct for the poller build it measured, which predates this one. `Exempt` orders now reach the warehouse. PASS |
| `Undefined` | Matches neither `"Exempt"` nor `"Incl"`/`"Excl"` -- falls through to the `throw`, same generic hard-error-and-alert path as any truly unrecognised value | **Neither confirmed mapped nor confirmed deliberately refused.** No code comment or LLD note marks this as intentional. This is the one open item TC22 still names |

**`Undefined` is the residual finding, not `Exempt`.** It has never been observed in the 1000-order
sample or in the poller's 30-day log retention (nothing to check there either, since the historical
`Exempt` errors are the only ones on record and those are now stale). Given it represents "Cin7 has
not itself set a tax status" rather than a normal order state, it is plausibly rare-to-nonexistent on
a real submitted sales order -- but that is INFERRED, not confirmed, and the case's own pass
condition requires either mapping or a documented deliberate refusal, neither of which exists for it
today. Recommend a short question to Kian: is refusing `Undefined` (same hard error, same alert)
intentional, or was it simply not on his radar the same way `Exempt` originally was not.

## Reconciling with the stop condition

The slice says stop and ask JJ if a fourth value turns up in the wider survey. The wider survey never
ran (rate-limited); the fourth value turned up in the documentation instead, and it is not a live
data anomaly requiring an urgent pause -- it is an enum value that has never been seen and is not
expected to be common. Reported plainly rather than treated as an alarm: **this is new information
that changes what "complete" means for TC22, not evidence of anything actively wrong in production.**

## Standing constraints

Read only throughout. No Cin7 write of any kind attempted (GET-only, consistent with every other
script in this plan). No AWS write either -- the code read is the same read-only technique slices 06
and 07 already used. Poller schedule DISABLED, SO watermark UNSET, unaffected by anything this slice
did.

## Stop and ask JJ

None of the three listed conditions were hit in the form they were written (no live survey ran to
turn up a fourth value; no documentation contradicted an observed value -- if anything it explained
one; no fix was found deployed-but-still-failing on `Exempt`, the opposite). The closest match is the
first, and it is reported above rather than escalated as urgent, since the practical risk is low and
this is new information rather than an active incident.

## Scripts written

None new. Reused `inspect-lambda-code.sh` (built slice 06, already reused unchanged in slice 07)
against a third question on a function it had already partly read. `survey-cin7-orders.sh`'s existing
`taxStatus` counter was invoked but did not return data (rate-limited); no script change needed or
made.

## Data handling

No customer data read. The Cin7 documentation fetch returned a public API schema page, no order data.
The code read excerpted the minimum needed (the tax-context function, its call site, and the
downstream tax-breakdown function it feeds), not a full bundle dump; the downloaded package was
deleted after the check, per `inspect-lambda-code.sh`'s own design.
