# Slice 19, TC6d, the empty `sizes[]` fallback the poller does not do

**S1 DONE, 2026-09-10. S2 is JJ's and is the only route left.** `skippedNoSizes` read 0 on all 8
cycles carrying it. **TC6d is INCONCLUSIVE, not closed**: the divergence is measured, occurrence is
not, and the sample is about 3 days of poller activity. Q43 `TRIED 2, negative`.
**Two corrections to this file's own text:** log retention is `null`, unlimited, not 30 days; and the
counter shipped in the **2026-09-03** deploy, with 2026-09-04 being the first observed cycle to carry
it.

**Ticket:** BUSY-1159. **Case:** TC6d. **Register:** Q43.
**Added:** 2026-09-10, out of the artefact read that closed TC6c in slice 18.
**Cost:** S1 is a log read, free. S2 is JJ's Cin7 query.

**This is the one thing on BUSY-1159 that should be settled before anyone signs the doc.** Not because
it is proven broken, but because if it is, the failure is a silently lost line on the create path.

## The divergence, and it is measured on one side already

**The LLD specifies a fallback, in five places.** An empty `sizes[]` means a single-size item, and the
line's own `code` and `qty` are used:

* §5 detail-line table: "`SKU.Item` ... `lineItems[].code` when `sizes[]` is empty (single-size item)"
* §5 detail-line table: "`SKU.Quantity` ... or `lineItems[].qty` for a single-size item"
* §5 line-grain prose: "Where `sizes[]` is empty the style is a single-size item and `lineItems[].code`
  and `lineItems[].qty` are used directly"
* §5 item-key contract: "the option code is `lineItems[].sizes[].code`, **falling back to
  `lineItems[].code` for a single-size item**"
* §11.1 poller test: "size explosion: a multi-size line produces one item per size; **an empty
  `sizes[]` falls back to the line's own `code`/`qty`**"

**The deployed poller skips instead.** MEASURED 2026-09-10 against
`staging-orders-cin7-so-poller` via `inspect-lambda-code.sh`, recorded in
`results/18-unrun-cases.md`. `expandLineItems` opens:

```
const sizes = lineItem.sizes ?? [];
if (!sizes.length) { skippedNoSizesCount += 1; continue; }
```

No fallback to `lineItem.code` / `lineItem.qty` on that branch. The line produces **no order item**,
and therefore no shipment item and no `ShipmentDetail`.

**Why it matters more than a zero-quantity skip.** A `qty: 0` size is nothing, so dropping it is
right, which is what TC6c confirmed. A single-size line is a real line a customer paid for. Dropping
it is a lost line, and it is lost **quietly**: the counter increments, nothing alerts (contrast the
sibling `qty < 0` branch, which does `console.warn`), and **LLD §7's divergence check would not catch
it**, because that check compares `lastModified` between the order and the shipment record and both
are still created. The shipment is simply short a line, and SCALE has no way to know.

**It is latent until the condition is shown to occur.** That is the whole question, and it is why this
is a case and not a defect ticket.

## What is already ruled out, so this stage does not redo it

* **The counter exists and is deployed.** `skippedNoSizes` was one of six fields added to the poller's
  cycle-complete summary by the **2026-09-03** deploy. MEASURED in
  `../retests/RETEST-1158-1159/results/R11-pre-kian-confirmation.md` and corroborated in
  `R14-wholesale-shape-and-bundling.md`, which characterises it as "a line-shape gate".
* **Its value has never been read.** No result file in this plan records a `skippedNoSizes` reading.
  Every counter tally on record covers `skippedZeroQty`, `skippedZeroUnitOrders`, `skippedCounted` and
  `skippedStages`, never this one. **That is the gap S1 closes.**
* **This is not `skippedZeroQty` and not `skippedZeroUnitOrders`.** Three distinct counters on three
  distinct shapes: a size at `qty: 0` (TC6c, closed on the mechanism), a whole order netting to zero
  units, and a line with no `sizes[]` array at all (this case). Do not read one for another.

## S1. Read the counter across every retained cycle. Free, read only

**Steps**

1. Pull the poller's cycle-complete summary line from `/aws/lambda/staging-orders-cin7-so-poller`
   across the **full retained window**, and report `skippedNoSizes` per cycle alongside
   `ordersFetched` and `created`. Field allowlist only; that log group carries unredacted customer
   data on other lines.
2. Report it as a distribution, not a single reading: how many cycles, how many carried a non-zero
   `skippedNoSizes`, and the largest value. **A run of zeroes across many cycles is the useful
   negative here** and it needs the cycle count attached to mean anything.
3. If any cycle is non-zero, get that cycle's order references from its own log lines, so S2 has a
   named order rather than a population.

**Reads as**

* **Non-zero on any cycle:** the condition occurs in real traffic, so a real line has been dropped.
  **That is a FAIL against LLD §5 and a defect**, not a drift row, because the LLD's specified
  behaviour and the deployed behaviour differ on a case that loses data. Stop, name the references, and
  take it to JJ. Q43 moves to `EXHAUSTED` on QA's side and this goes to Kian with evidence.
* **Zero across every retained cycle:** the divergence is real but **latent**. Q43 becomes
  `TRIED 2, negative`, and the disposition is a **drift row plus a correction**, because the LLD says
  one thing and the build does another even though nothing has been lost yet. Note the retention
  window: 30 days is not "never", so say what window was covered.
* **The counter is absent from the summary line:** contradicts R11 and R14. Re-read those before
  concluding, then say which is wrong.

## S2. Does Cin7 ever produce an empty `sizes[]` on a CTC order. JJ's, Cin7 side

**Only run this if S1 came back all-zero.** If S1 found a non-zero cycle the condition demonstrably
occurs and this stage is redundant.

The Cin7 call is JJ's per the standing credentials rule. **Named query:** for a sample of CTC ECOM
references, `GET /v1/SalesOrders` and report whether any `lineItems[]` entry has an empty or absent
`sizes[]` array. `results/18-unrun-cases.md` carries a 100-reference list if a sample is wanted.

**Reads as**

* **Cin7 never produces an empty `sizes[]` for CTC:** the branch is unreachable in practice. TC6d
  closes as **PASS on unreachability**, with the row stating plainly that the LLD's fallback is
  unimplemented and that the case passes because the input never occurs, not because the code is
  right. **That distinction has to be in the row**, because a future product change to CTC's Cin7
  catalogue would make it reachable again with nothing watching.
* **Cin7 does produce it, and S1 read zero:** contradiction. Either the orders carrying it never
  reached an eligible stage, or the counter is not wired to the branch. Stop and ask JJ.

## Stop and ask JJ if

* **S1 finds a non-zero `skippedNoSizes` on any cycle.** That is a real line loss and it changes this
  ticket's sign-off.
* S1 finds the counter absent from the summary line, contradicting R11 and R14.
* S2's outcome contradicts S1's.

## Deliverable

`results/19-empty-sizes-fallback.md`. **Propose the row change, do not edit `QA-DOC.md`**: it is at 29
cases and synced to Confluence, so an edit here would desynchronise them. Update Q43's verification
state in `../BUSY-1065-OPEN-QUESTIONS.md` with what each attempt ruled out.
