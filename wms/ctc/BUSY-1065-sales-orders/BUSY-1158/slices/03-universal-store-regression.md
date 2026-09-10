# Slice 03, Universal Store regression

**Ticket:** BUSY-1158
**Cases:** TC3b, TC7
**Depends on:** a genuinely warehouse fulfilled Universal Store order in staging. Not on slices 01 or 02.
**Estimated:** one session, once the fixture exists

This is the half of the ticket that protects the incumbent. AC4 and AC8 both say Universal Store
behaviour is unchanged, and `create-shipment-items` and the dc-packing workers were both edited to
achieve it. Nothing has tested either.

**The fixture is the whole problem.** All 5 real Universal Store orders found under BUSY-1159 were
NEWSTORE, in store and already fulfilled, and never reach the shipments table at all. A NEWSTORE order
cannot answer either case. Do the search first and stop early if it comes up empty, rather than
burning a session on it.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
```

Then find a candidate before anything else. A Universal Store order that reached the shipments table,
with a delivery method that routes it to the warehouse rather than an in store pick.

Save the search as `scripts/find-warehouse-uni-order.sh`. It will be run again, because this fixture
is opportunistic across sessions the same way BUSY-1159's TC14 was.

If nothing is found: write the result file saying so, mark both cases BLOCKED on the fixture, and stop.
Do not manufacture an order. That is JJ's call and a coordination job with the ecommerce team.

## Setup

Record the order's key, delivery method and store, and confirm it predates any CTC traffic in the same
window, so nothing you observe can be attributed to a CTC record.

## Cases

### TC3b, quantity-less Universal Store order through shipment item creation

Trigger: read the order items and shipment items for the candidate.

Expect: one shipment item row per unit, under the existing Universal Store key convention, and no
`quantity` attribute on the row. The `quantity` passthrough AC4 added must be invisible to an order
that does not carry one.

Capture: row count against unit count, the key shape, and the attribute list of one row.

Fails if: a `quantity` attribute appears on a Universal Store shipment item, or the row count no longer
matches the unit count. Either means the passthrough changed the incumbent grain, which is the
regression AC4 is written to prevent.

### TC7, Universal Store order through the dc-packing path

Trigger: read the dc-packing worker logs for that order.

Expect: the worker handled the order and resolved its company from the explicit `company` field. AC8
replaced a `brand` based inference with that field.

Capture: the handling line, and whatever the worker logs about how it resolved company.

Fails if: the order was skipped, or was misclassified.

Inconclusive if: the worker logs nothing about how company was resolved, which is likely. In that case
record what you did see, mark the case inconclusive rather than PASS, and raise it as a question for
Kian: does the dc-packing worker log its company source, and if not, what would settle AC8 from
outside the repository. An unchanged outcome is weak evidence for AC8, because the inference and the
explicit field agree on every Universal Store order. They only disagree on a CTC order, and a CTC
order is supposed to be skipped before it gets there.

That tension is worth stating plainly in the result file. AC8 may not be provable from outside at all,
in which case it belongs in the doc's automated tests table rather than as a live case.

## Teardown

None. Read only throughout.

## Write results to

`results/03-universal-store-regression.md`.

## Stop and ask JJ if

* no warehouse fulfilled Universal Store order exists, which is the expected outcome on a first
  attempt and needs a person to arrange one
* TC3b fails, since that is a live regression on the incumbent flow and outranks everything else in
  this plan
