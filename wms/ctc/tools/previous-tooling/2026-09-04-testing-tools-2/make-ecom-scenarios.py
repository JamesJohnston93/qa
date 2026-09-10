#!/usr/bin/env python3
"""
Derives the scenario fixtures from the redacted baseline, by mutating it.

Every scenario is `01-baseline.json` with **one** thing changed, so a test that uses it proves one
behaviour.

Two of them are sequential rather than independent, because a reduction or a removal is only
meaningful against what a previous revision persisted: **03 must follow 02**, and **05 must follow
04**. Each says so in its own docstring. The rest can be applied to a freshly created order in any
order. Generated rather than hand-written on purpose: a hand-authored payload drifts from what
Cin7 actually sends, and this build has already been bitten twice by exactly that — a fixture
missing `orderedAt` produced a guard that would have dropped `OrderDate` from every send, and a
hand-set `lineItemId` hid the fact that nothing carried it onto an added line.

So the rule is: capture with `find-cin7-sales-order.sh --raw`, redact with
`redact-cin7-payload.py`, and derive everything else here. Refreshing against a newer Cin7 shape is
then one command, and each mutation is visible as code rather than buried in a JSON blob.

    ./make-ecom-scenarios.py                 # regenerate every scenario from the baseline
    ./make-ecom-scenarios.py --list          # describe them without writing

Writes nothing but files under fixtures/ecom/. Never calls Cin7 or AWS.
"""

import argparse
import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SCENARIO_DIR = os.path.join(HERE, 'fixtures', 'ecom')
BASELINE = os.path.join(SCENARIO_DIR, '01-baseline.json')

# Later than the baseline's modifiedDate, so the version guard treats each scenario as a genuine
# revision rather than a replay — but still back-dated, so no ordinary poll picks any of them up.
# Bumped per scenario so two are never mistaken for the same revision.
BASE_MODIFIED = '2026-06-01T01:00:00Z'

# A second style for the multi-style scenarios.
#
# It is NOT enough that the baseline does not already use the code — an earlier version of this
# file said so and was wrong. `sizes[].code` reaches SCALE as `SKU.Item`, so the style must exist
# in SCALE's item master under company CTC or the send is rejected outright. Confirmed live on
# 2026-09-01: the invented `WTA26-118B` produced
#     Invalid shipment detail (3477827): Item "WTA26-118B-10" with company "CTC" does not exist.
# and, per LLD :312, one unrecognised item key fails the *whole* shipment — the valid line on the
# same payload went down with it.
#
# `CLA-104BW` in L/M/S was confirmed available by Kian on 2026-09-01. Verify against SCALE before
# changing it. Sizes here are lettered, not numeric like the baseline's 10/12.
SECOND_STYLE = 'CLA-104BW'
SECOND_STYLE_SIZE = 'L'
# Orders-side only — `name` and `barcode` never reach SCALE, so neither has to be real.
SECOND_STYLE_NAME = 'Classic Crew - Black'

# A stable ErpOrderLineNum per SKU, shared by every scenario.
#
# SCALE keys a detail line on ErpOrderLineNum ALONE — OQ-1160-10, confirmed by probe on 27 Aug and
# again end to end on 1 Sep. Every scenario reuses one shipment id (260001), so if two of them give
# the same line id to different sizes, the first leaves behind a detail the second cannot address:
# SCALE then shows the same option twice under two line numbers. That is a fixture artifact, not a
# middleware defect, but it reads exactly like one and cost a QA cycle to explain.
#
# Keeping the mapping stable makes it impossible — a line id always means the same SKU, so a
# re-seed can only ever overwrite its own line. Add an entry here before using a new SKU; the
# lookup raises rather than inventing an id.
LINE_IDS = {
    'WTA26-225C-10': 3477826,   # the baseline's own line, from the captured payload — do not move
    'WTA26-225C-12': 3477827,
    'WTA26-225C-8': 3477828,
    'WTA26-225C-14': 3477829,
    'CLA-104BW-L': 3477830,
}


def bump(order, minutes):
    order['modifiedDate'] = BASE_MODIFIED.replace(
        'T01:00:00Z', f'T01:{minutes:02d}:00Z'
    )


def first_size(order):
    return order['lineItems'][0]['sizes'][0]


def new_line_for_size(order, size_name, qty, barcode, style=None, product=None):
    """
    A whole new `lineItems[]` entry carrying exactly one size — the shape Cin7 sends when an ecom
    customer buys another size of a style already on the order.

    It is NOT a second entry appended to an existing line's `sizes[]`. Measured 31 Aug 2026 over
    1,000 orders: **0 of 854 ECOM lines carry two distinct size codes**, while six orders buy one
    style in two sizes and every one arrives as two lines with one size each. The in-line size
    matrix is a wholesale ordering construct — `make-wholesale-scenarios.py` is where it belongs.
    Full evidence in `open-questions.md#oq-1160-10`.

    The style `code` is shared across the lines, as the real payloads show; only the id, the size
    and the size suffix on `name` differ. Pass `style` and `product` to mint a line for a
    *different* style instead — the multi-style case.
    """
    line = copy.deepcopy(order['lineItems'][0])
    size = copy.deepcopy(line['sizes'][0])
    code = style or line['code']
    base_name = product or line['name'].rsplit(' - ', 1)[0]
    size_code = f'{code}-{size_name}'
    size['name'] = size_name
    size['code'] = size_code
    size['barcode'] = barcode
    size['qty'] = qty
    # Deliberately a KeyError on an unregistered SKU — see LINE_IDS.
    line['id'] = LINE_IDS[size_code]
    line['code'] = code
    line['name'] = f'{base_name} - {size_name}'
    line['qty'] = qty
    line['sizes'] = [size]
    return line


def scenario_line_qty_increased(order):
    """2 -> 5 units on one size: the update handler inserts rows and leaves the originals alone."""
    first_size(order)['qty'] = 5.0
    order['lineItems'][0]['qty'] = 5.0
    bump(order, 1)


def scenario_line_qty_reduced(order):
    """
    5 -> 2, so it must be applied *after* 02: the reduction is against what 02 persisted, not
    against the baseline. The baseline carries qty 1, so reducing from it is a no-op — an earlier
    version of this scenario did exactly that and tested nothing.

    The pair keeps survivors, so this is a lower-quantity SAVE and never a detail DELETE.
    """
    first_size(order)['qty'] = 2.0
    order['lineItems'][0]['qty'] = 2.0
    bump(order, 2)


def scenario_line_added(order):
    """
    A second size of the same style, as its own `lineItems[]` entry — a new (lineItemId, sku) pair
    with no persisted rows. See `new_line_for_size` for why it is a new line, not a second `sizes[]`
    entry.
    """
    order['lineItems'].append(new_line_for_size(order, '12', 2.0, '9346792999999'))
    bump(order, 3)


def scenario_line_removed(order):
    """
    Two lines, and one of them loses every unit — so the pair vanishes from the payload while the
    order still has work. Applied *after* 04, which is what persisted the second line.

    Deliberately not "the only line goes to zero": that leaves the order with no units at all,
    which the poller skips wholesale as a zero-unit order, and proves the wrong thing. A removal
    only means anything when something survives it.
    """
    # Same id and sku 04 minted, so this addresses the pair 04 persisted rather than a new one.
    survivor = new_line_for_size(order, '12', 2.0, '9346792999999')
    # The baseline line drops out entirely; only the one 04 added remains.
    order['lineItems'] = [survivor]
    bump(order, 4)


def scenario_address_changed(order):
    """Street only. Nothing about the lines moves, so no ADD_ITEM or CANCEL_ITEM should follow."""
    order['deliveryAddress1'] = '55 Changed Avenue'
    bump(order, 5)


def scenario_echo_stage_only(order):
    """
    The echo. Stage moves to a Picked value exactly as our own confirmation leg writes it back, and
    nothing SCALE receives changes — so the mapped-payload hash is identical and the poller must
    emit nothing at all. This is the only fixture that proves the echo guard end to end.
    """
    order['stage'] = 'Fully Picked'
    bump(order, 6)


def scenario_ineligible_declined(order):
    """Loss of eligibility for a non-terminal reason: cancellation, and a header DELETE to SCALE."""
    order['stage'] = 'Declined'
    bump(order, 7)


def scenario_dispatched(order):
    """
    The terminal stage. Completion, not cancellation — this must produce nothing at all. It is the
    gate that stops every successfully fulfilled order raising an alert.
    """
    order['stage'] = 'Dispatched'
    bump(order, 8)


def scenario_multi_line_style(order):
    """
    One style bought in four sizes — four separate `lineItems[]` entries, each with its own id and
    a single size, which is how Cin7 sends it for ecom. Each size therefore gets its own
    ErpOrderLineNum and the details cannot collide.

    Includes a zero-quantity size, which Cin7 really does send and which must be skipped rather
    than sent as Quantity 0. That is the coverage this scenario exists for.
    """
    lines = [
        new_line_for_size(order, name, qty, f'934679299{name.zfill(2)}99')
        for name, qty in (('8', 3.0), ('10', 1.0), ('12', 0.0), ('14', 2.0))
    ]
    order['lineItems'] = lines
    bump(order, 9)


def scenario_second_style_added(order):
    """
    A different style, added as its own line — the multi-style order.

    **52% of real ECOM orders carry two or more distinct styles** (measured 31 Aug 2026 over 392
    orders; up to 13 on one order), yet every other scenario here is single-style. Reconciliation
    runs across the whole line set, so without this nothing proves that touching one style leaves
    the others alone.
    """
    order['lineItems'].append(
        new_line_for_size(
            order, SECOND_STYLE_SIZE, 1.0, '9346792888888',
            style=SECOND_STYLE, product=SECOND_STYLE_NAME,
        )
    )
    bump(order, 10)


def scenario_multi_style_one_changed(order):
    """
    Two styles, and only one of them moves: the baseline style goes 1 -> 4 while the second style's
    line is identical to what 11 persisted. Applied *after* 11.

    The isolation case. A reconciler that rebuilds the whole order rather than the changed pair
    passes every single-style scenario above and fails this one.
    """
    second = new_line_for_size(
        order, SECOND_STYLE_SIZE, 1.0, '9346792888888',
        style=SECOND_STYLE, product=SECOND_STYLE_NAME,
    )
    first_size(order)['qty'] = 4.0
    order['lineItems'][0]['qty'] = 4.0
    order['lineItems'].append(second)
    bump(order, 11)


def scenario_duplicate_size_code(order):
    """
    The same size code twice in one line's `sizes[]`, each at qty 1 — Cin7's *other* way of
    expressing quantity, and it happens on real ECOM orders: `#261306` sends `WTDP-466BAS-8` twice
    with `lineItem.qty` 2, `#261230` sends one code three times with qty 3.

    **The native path handles this correctly, and this fixture exists to keep it that way.**
    `expandLineItems` reads `size.qty` and never `lineItem.qty`, then emits one row per unit under a
    fresh `ITEM#<uuid>`, so two entries become two fungible rows rather than one overwriting the
    other. Reconciliation counts `(lineItemId, sku)` units and `buildDetails` groups on the same
    pair, so SCALE receives Quantity 2. Expect it to pass.

    It is the **outbound** mapper that collapses these — it keys `ITEM#<line id>#<size code>`
    deterministically, so the later write wins. See `open-questions.md`, "Cin7 repeats a size code
    within one line", which is still OPEN and is a wholesale-only defect.

    Note `lineItem.qty` always equals the sum of the entries — in 1,000 orders there is no line
    that repeats a code while claiming qty 1.
    """
    line = order['lineItems'][0]
    line['sizes'] = [copy.deepcopy(line['sizes'][0]) for _ in range(2)]
    for size in line['sizes']:
        size['qty'] = 1.0
    line['qty'] = 2.0
    bump(order, 12)


SCENARIOS = [
    ('02-line-qty-increased', scenario_line_qty_increased),
    ('03-line-qty-reduced', scenario_line_qty_reduced),
    ('04-line-added', scenario_line_added),
    ('05-line-removed', scenario_line_removed),
    ('06-address-changed', scenario_address_changed),
    ('07-echo-stage-only', scenario_echo_stage_only),
    ('08-ineligible-declined', scenario_ineligible_declined),
    ('09-dispatched-terminal', scenario_dispatched),
    ('10-multi-line-style', scenario_multi_line_style),
    ('11-second-style-added', scenario_second_style_added),
    ('12-multi-style-one-changed', scenario_multi_style_one_changed),
    ('13-duplicate-size-code', scenario_duplicate_size_code),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--list',
        action='store_true',
        help='describe the scenarios without writing them',
    )
    args = parser.parse_args()

    if args.list:
        for name, fn in SCENARIOS:
            summary = (fn.__doc__ or '').strip().split('\n')[0]
            print(f'{name:26} {summary}')
        return

    with open(BASELINE) as handle:
        baseline = json.load(handle)

    # Every line id must mean one SKU across the whole set, and no scenario may reuse an id
    # within itself. Both would leave SCALE showing one option under two line numbers after a
    # re-seed — see LINE_IDS. Checked here rather than trusted, since it is invisible in the JSON.
    seen = {}
    written = []

    for name, fn in SCENARIOS:
        order = copy.deepcopy(baseline)
        fn(order)

        ids_here = set()
        for line in order['lineItems']:
            line_id = line['id']
            if line_id in ids_here:
                raise SystemExit(f'{name}: line id {line_id} used twice in one order')
            ids_here.add(line_id)
            for size in line['sizes']:
                owner = seen.setdefault(line_id, size['code'])
                if owner != size['code']:
                    raise SystemExit(
                        f'{name}: line id {line_id} carries {size["code"]}, '
                        f'but another scenario gives it {owner}. '
                        f'A line id must mean one SKU across the set — see LINE_IDS.'
                    )

        path = os.path.join(SCENARIO_DIR, f'{name}.json')
        with open(path, 'w') as handle:
            json.dump(order, handle, indent=2)
            handle.write('\n')
        written.append(name)
        print(f'wrote {name}.json')

    print(f'\n{len(written)} scenarios; {len(seen)} line ids, each mapping to exactly one SKU:')
    for line_id, code in sorted(seen.items()):
        print(f'  {line_id}  {code}')


if __name__ == '__main__':
    main()
