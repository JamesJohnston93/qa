#!/usr/bin/env python3
"""
Derives the WHOLESALE scenario fixtures from the redacted wholesale baseline.

The wholesale twin of `make-ecom-scenarios.py`, and it exists separately because the two families have
different grains. ECOM is one order item per **unit**; outbound is one per **size**, carrying a
quantity. So "quantity increased" is an in-place edit of one record here, where on the ECOM side it
inserts rows — the same Cin7 edit proves a different thing in each family.

Same rule as the ECOM generator: capture with `find-cin7-sales-order.sh --group <wholesale group>
--raw`, redact with `redact-cin7-payload.py`, and derive everything else here. A hand-authored
payload drifts from what Cin7 actually sends, and this epic has been bitten by that repeatedly —
most recently a captured order revealing duplicate size codes that no hand-written fixture had.

    ./make-wholesale-scenarios.py            # regenerate every scenario from the baseline
    ./make-wholesale-scenarios.py --list     # describe them without writing

Writes nothing but files under fixtures/wholesale/. Never calls Cin7 or AWS.

Baseline: 982409Aug26 — 4 style lines, 17 sizes, stage New, branch 51908 (CTC-WH), contact group
`Retailer - Domestic`. Chosen small so a scenario diff is readable; the awkward cases live in
_shared/BUSY-1065/fixtures/variants/wholesale-large-27-lines.json (27 lines, 136 sizes,
8 duplicate-code groups) — design evidence, kept outside this bundle.

Five things real data does NOT cover, so the scenarios below synthesise them: a zero-quantity size,
an empty `sizes[]` (the single-size fallback), branch 51909, a `deliveryCompany` longer than
`ShipTo`'s 25 characters, and a line carrying more sizes than the ErpOrderLineNum fraction can
number. The first four are reachable in production and none appeared in the 12 orders captured; the
fifth is not reachable from a real garment and exists only to prove the refusal is loud.
"""

import argparse
import copy
import json
import os
import zlib
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SCENARIO_DIR = os.path.join(HERE, 'fixtures', 'wholesale')
BASELINE = os.path.join(SCENARIO_DIR, '01-baseline.json')

# Derived from the baseline's own modifiedDate rather than a constant, so a scenario is always a
# later revision than the order it mutates. A hardcoded date silently inverted that when the
# baseline was recaptured: every scenario predated it by three months, and the version guards
# downstream dropped the lot as stale. Bumped per scenario so two are never mistaken for the same
# revision — Cin7's modifiedDate is whole-second, and two fixtures sharing one would collide in the
# idempotency keys downstream.
BASE_MODIFIED = None


def bump(order, minutes):
    order['modifiedDate'] = (
        BASE_MODIFIED + timedelta(minutes=minutes)
    ).strftime('%Y-%m-%dT%H:%M:%SZ')


def first_line(order):
    return order['lineItems'][0]


def first_size(order):
    return first_line(order)['sizes'][0]


def relabel(size, template, name, qty):
    """A sibling size on the same style: same prefix, new suffix, distinct barcode.

    The name must be a size the style really has in the warehouse's item master. An invented one
    passes every unit test and is then rejected end to end — *Item "WTH26-116AHW-XXL" with
    company "CTC" does not exist* — because the code is validated there, not merely carried.

    crc32 rather than hash(): Python randomises string hashing per process, so barcodes moved on
    every regeneration and a real change to a fixture was indistinguishable from that churn.
    """
    size['name'] = name
    size['code'] = template['code'].rsplit('-', 1)[0] + f'-{name}'
    size['barcode'] = f'934679299{zlib.crc32(name.encode()) % 10000:04d}'
    size['qty'] = qty
    return size


def scenario_size_qty_increased(order):
    """One size 1 -> 5: the same OUTBOUND_ITEM record updates in place, never a new key."""
    size = first_size(order)
    size['qty'] = 5.0
    first_line(order)['qty'] = sum(s['qty'] for s in first_line(order)['sizes'])
    bump(order, 1)


def scenario_size_qty_reduced(order):
    """
    5 -> 2, so it must follow 02: the reduction is against what 02 persisted, not the baseline.
    The pair keeps survivors, so this is a lower-quantity detail SAVE and never a DELETE.

    A detail SAVE does lower a quantity in place — confirmed in SCALE by Kian, 4 Sep 2026, running
    this scenario end to end: the line's quantity dropped and no DELETE was sent for it. A DELETE
    and re-SAVE is not needed, and would be wrong, because it would churn the line identity the
    ordinal exists to keep stable.
    """
    size = first_size(order)
    size['qty'] = 2.0
    first_line(order)['qty'] = sum(s['qty'] for s in first_line(order)['sizes'])
    bump(order, 2)


def scenario_size_added(order):
    """A new size on an existing style — a fresh (lineId, code) pair with no persisted record.

    `14` is a real size on this style, held back from the baseline's five so there is something
    genuine to add. It takes the next free ordinal; the five already assigned are untouched.
    """
    line = first_line(order)
    line['sizes'].append(relabel(copy.deepcopy(first_size(order)), first_size(order), '14', 3.0))
    line['qty'] = sum(s['qty'] for s in line['sizes'])
    bump(order, 3)


def scenario_size_removed(order):
    """
    A size vanishes from the payload while the order still has work, so the materialiser marks it
    REMOVED_OUTBOUND and the next send carries a per-line DELETE alongside surviving SAVEs.

    Applied after 04, which is what persisted the size being dropped. Deliberately not "every size
    goes", which the poller skips wholesale as a zero-unit order and which proves nothing about
    removal.
    """
    line = first_line(order)
    line['sizes'] = [relabel(copy.deepcopy(first_size(order)), first_size(order), '14', 3.0)]
    line['qty'] = 3.0
    bump(order, 4)


def scenario_address_changed(order):
    """
    Street only. The delivery address must reach SCALE — and the mapped-payload hash must change,
    or the echo guard swallows the edit and both systems agree on a stale address forever.
    """
    order['deliveryAddress1'] = '55 Changed Avenue'
    bump(order, 5)


def scenario_echo_stage_only(order):
    """
    The echo. Stage moves to a Picked value exactly as our own confirmation leg writes it back, and
    nothing SCALE receives changes — so the hash is identical and the poller must emit nothing.
    """
    order['stage'] = 'Fully Picked'
    bump(order, 6)


def scenario_ineligible_declined(order):
    """Loss of eligibility for a non-terminal reason: a cancellation, and a header DELETE."""
    order['stage'] = 'Declined'
    bump(order, 7)


def scenario_dispatched(order):
    """The terminal stage. Completion, not cancellation — this must produce nothing at all."""
    order['stage'] = 'Dispatched'
    bump(order, 8)


def scenario_zero_qty_size(order):
    """
    A size with qty 0 alongside survivors. Cin7 really sends these; they must be skipped and
    counted, never sent as SKU.Quantity 0. The zero is synthetic — none of the 12 captured orders
    carried one — but the size codes are the style's real ones, so the document survives
    item-master validation.
    """
    line = first_line(order)
    template = first_size(order)
    line['sizes'] = [
        relabel(copy.deepcopy(template), template, '4', 4.0),
        relabel(copy.deepcopy(template), template, '6', 0.0),
        relabel(copy.deepcopy(template), template, '8', 2.0),
    ]
    line['qty'] = 6.0
    bump(order, 9)


def scenario_single_size_line(order):
    """
    An empty `sizes[]`, so the line's own code and qty are used directly. Synthetic — every
    captured order expanded into sizes, so this fallback has never been seen in real data.
    """
    line = first_line(order)
    line['sizes'] = []
    line['qty'] = 3.0
    bump(order, 10)


def scenario_shipto_oversize(order):
    """
    A delivery company past ShipTo's 25 characters. ShipTo truncates; the untruncated value must
    survive in ShipToAddress.Name, or the company name is lost from the document entirely.
    Synthetic — the longest captured deliveryCompany was well under the cap.
    """
    order['deliveryCompany'] = 'Retailer International Pty Ltd'
    bump(order, 11)


def scenario_branch_qdc(order):
    """
    The other branch. Warehouse no longer follows branchId — every CTC order ships from CTC-QDC,
    confirmed with the stakeholder after SCALE rejected the CTC-WH the design documents named — so
    this now proves the branch does *not* change the warehouse, which is the opposite of what it
    was built for and worth keeping for exactly that reason.
    """
    order['branchId'] = 51909
    bump(order, 12)


def scenario_duplicate_size_code(order):
    """
    The merged-order shape: one size code twice in a single line, each with its own quantity.
    Cin7 merges by appending rather than summing, so ~1 in 6 real wholesale orders look like this.

    The current key collapses the pair and under-ships the line. Kept as a fixture so whatever is
    decided is proven against the real shape rather than a guess.
    """
    line = first_line(order)
    template = first_size(order)
    dup = relabel(copy.deepcopy(template), template, '4', 1.0)
    line['sizes'] = [dup, copy.deepcopy(dup), relabel(copy.deepcopy(template), template, '6', 2.0)]
    line['qty'] = 4.0
    order['internalComments'] = 'merged 982408Aug26'
    bump(order, 13)


def scenario_no_ship_to(order):
    """
    No delivery company and no delivery contact name. There is nothing to put in ShipTo, so the
    order must be alerted and withheld rather than sent with an empty identifier.
    """
    order['deliveryCompany'] = ''
    order['deliveryFirstName'] = ''
    order['deliveryLastName'] = ''
    bump(order, 14)


def _single_line_with_sizes(order, names_and_qtys):
    """Cuts the order down to its first style line carrying exactly the sizes named.

    The baseline's 4 lines and 17 sizes already collide on ErpOrderLineNum, so it proves the fix
    works — but 17 details is too much to read in an XML diff. These trim to one line so the
    fraction on each detail can be checked by eye.
    """
    line = first_line(order)
    template = copy.deepcopy(first_size(order))
    line['sizes'] = [
        relabel(copy.deepcopy(template), template, name, qty)
        for name, qty in names_and_qtys
    ]
    line['qty'] = sum(qty for _, qty in names_and_qtys)
    order['lineItems'] = [line]


def scenario_sizes_share_one_line(order):
    """
    Three sizes of one style, so one Cin7 line id becomes three warehouse lines rather than one.

    The warehouse keys a detail on its line number alone, so before the ordinal these three
    overwrote each other and the last one written was all that survived — accepted, unflagged.
    Expect ErpOrderLineNum 3239305, 3239305.01 and 3239305.02 in one document.
    """
    _single_line_with_sizes(order, [('4', 2.0), ('6', 3.0), ('8', 1.0)])
    bump(order, 15)


def scenario_middle_size_removed(order):
    """
    The middle of the three goes. Follows 16, which is what assigned the ordinals.

    Deliberately the middle rather than the first: the survivors then hold non-contiguous
    ordinals, so the DELETE has to name the slot that size was sent under rather than being
    reconstructed from the surviving sizes' positions. Expect a SAVE at 3239305 and 3239305.02
    and a DELETE at 3239305.01.
    """
    _single_line_with_sizes(order, [('4', 2.0), ('8', 1.0)])
    bump(order, 16)


def scenario_removed_size_readded(order):
    """
    The removed middle size comes back. Follows 17.

    It must return to the slot it held, not take the next free one — the warehouse still holds
    that line, and a new number would leave the old one deleted and the stock on a second line.
    Expect 3239305.01 again, never 3239305.03.
    """
    _single_line_with_sizes(order, [('4', 2.0), ('6', 3.0), ('8', 1.0)])
    bump(order, 17)


def scenario_ordinal_cap_exceeded(order):
    """
    NOT RUNNABLE END TO END — its 101 size codes are invented, and the warehouse rejects an item
    its master does not hold, so the document never reaches the ordinal check. The cap is covered
    by the assigner's unit tests; this fixture only documents the shape.

    101 sizes on one style line: ordinals 0-99 fit the two-digit fraction and the 101st does not.

    100 sizes would pass — the cap is the ordinal, not the count — so the off-by-one is the point
    of the fixture. Synthetic, and not reachable from any real garment; it exists to prove the
    refusal is loud. Nothing may be sent, because a size that silently wrapped would land on a
    slot another size already holds, which is the failure the ordinal scheme exists to prevent.
    """
    _single_line_with_sizes(
        order, [(f'{index:03d}', 1.0) for index in range(101)]
    )
    bump(order, 18)


# (name, mutation, base) — `base` is the scenario this one is a revision *of*, so the only thing
# that differs between the two files is the change under test. Deriving every scenario from the
# baseline instead, as this list used to, silently reverted the previous scenario's edit: walking
# 03 then 04 changed a quantity back *and* added a size, and the run could not say which of the two
# it was exercising. `03`'s own docstring already claimed to follow `02`; only the generator didn't.
#
# `None` means the baseline. A scenario nothing lists as its base is a leaf: it is a one-off probe
# whose end state — a terminal stage, an unmappable address — must not leak into what follows.
SCENARIOS = [
    ('02-size-qty-increased', scenario_size_qty_increased, None),
    ('03-size-qty-reduced', scenario_size_qty_reduced, '02-size-qty-increased'),
    ('04-size-added', scenario_size_added, '03-size-qty-reduced'),
    ('05-size-removed', scenario_size_removed, '04-size-added'),
    ('06-address-changed', scenario_address_changed, '05-size-removed'),
    # Leaves. Each ends the order in a state later scenarios must not inherit.
    ('07-echo-stage-only', scenario_echo_stage_only, '06-address-changed'),
    ('08-ineligible-declined', scenario_ineligible_declined, '06-address-changed'),
    ('09-dispatched-terminal', scenario_dispatched, '06-address-changed'),
    # The line-shape probes resume the spine from 06, which is the last state with a live stage.
    ('10-zero-qty-size', scenario_zero_qty_size, '06-address-changed'),
    # A leaf: it empties `sizes[]`, so anything built on it has no size to mutate.
    ('11-single-size-line', scenario_single_size_line, '10-zero-qty-size'),
    ('12-shipto-oversize', scenario_shipto_oversize, '10-zero-qty-size'),
    ('13-branch-qdc', scenario_branch_qdc, '12-shipto-oversize'),
    ('14-duplicate-size-code', scenario_duplicate_size_code, '13-branch-qdc'),
    ('15-no-ship-to', scenario_no_ship_to, '14-duplicate-size-code'),
    ('16-sizes-share-one-line', scenario_sizes_share_one_line, '14-duplicate-size-code'),
    ('17-middle-size-removed', scenario_middle_size_removed, '16-sizes-share-one-line'),
    ('18-removed-size-readded', scenario_removed_size_readded, '17-middle-size-removed'),
    ('19-ordinal-cap-exceeded', scenario_ordinal_cap_exceeded, '18-removed-size-readded'),
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
        for name, fn, base in SCENARIOS:
            summary = (fn.__doc__ or '').strip().split('\n')[0]
            print(f'{name:26} (from {base or "01-baseline":24}) {summary}')
        return

    with open(BASELINE) as handle:
        baseline = json.load(handle)

    global BASE_MODIFIED
    BASE_MODIFIED = datetime.strptime(
        baseline['modifiedDate'], '%Y-%m-%dT%H:%M:%SZ'
    ).replace(tzinfo=timezone.utc) + timedelta(hours=1)

    built = {}
    for name, fn, base in SCENARIOS:
        order = copy.deepcopy(built[base] if base else baseline)
        fn(order)
        built[name] = copy.deepcopy(order)
        # A scenario at or before the baseline is dropped by the version guards downstream, which
        # looks like a broken handler rather than a broken fixture.
        assert order['modifiedDate'] > baseline['modifiedDate'], (
            f'{name} is dated {order["modifiedDate"]}, not after the baseline'
            f' at {baseline["modifiedDate"]}'
        )
        path = os.path.join(SCENARIO_DIR, f'{name}.json')
        with open(path, 'w') as handle:
            json.dump(order, handle, indent=2)
            handle.write('\n')
        print(f'wrote {name}.json')


if __name__ == '__main__':
    main()
