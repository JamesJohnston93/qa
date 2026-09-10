#!/usr/bin/env python3
"""
Replaces the customer-identifying fields in a captured Cin7 Sales Order with stable fake values.

Why substitute rather than delete: a captured payload is the only record of what Cin7 actually
sends, and an absent key is real information — it means Cin7 does not send that field at all. So
every key is preserved and only the value changes, and a value that was null stays null.

Read-only against Cin7 (it never calls it): input is a file, output is a file.

    ./redact-cin7-payload.py raw.json > redacted.json
    ./redact-cin7-payload.py raw.json --check      # report what would change, write nothing
    ./redact-cin7-payload.py raw.json --as-test-order 260001 > baseline.json

`--as-test-order` is what makes a captured order safe to test with. A real reference is a real
order: it may already exist in SCALE, and it can reach SCALE through the production flow while we
are testing, so the two become indistinguishable. Passing a reference rewrites the identity of the
order — its `reference` and Cin7 `id` — and back-dates it, so no ordinary poll will ever pick it up
and nothing in SCALE can collide with it.

The SKUs are deliberately left real: SCALE's item master has to already know the item code, which
is the go-live gate for this whole flow. A fake SKU would make every line fail for the wrong
reason.

The substitutions are deterministic, so re-redacting the same capture produces the same file and a
diff shows only genuine payload changes.
"""

import argparse
import json
import sys

# value replacements, applied only when the field is present and not null
IDENTITY = {
    'email': 'ctc.customer@example-test.invalid',
    'firstName': 'Jamie',
    'lastName': 'Reyes',
    'company': 'Test Customer Pty Ltd',
    'phone': '0400000000',
    'mobile': '0400000000',
    'deliveryFirstName': 'Jamie',
    'deliveryLastName': 'Reyes',
    'deliveryCompany': 'Test Customer Pty Ltd',
    'deliveryAddress1': '12 Riverside Dr',
    'deliveryAddress2': '',
    'billingFirstName': 'Jamie',
    'billingLastName': 'Reyes',
    'billingCompany': 'Test Customer Pty Ltd',
    'billingAddress1': '12 Riverside Dr',
    'billingAddress2': '',
    # Free text a human typed. Not identity as such, but it is the field most likely to carry
    # something that should not leave Cin7.
    'internalComments': '',
    'customerOrderNo': 'TEST-ORDER-NO',
    'customerName': 'Jamie Reyes',
}

# Kept as-is on purpose, with the reason, so nobody "tidies" them later:
#   deliveryCity / deliveryState / deliveryPostalCode / deliveryCountry
#     — mapped to SCALE and code-translated (stateCodeForName, countryCodeForName). Faking them
#       would make the fixture prove the wrong thing.
#   memberId — the contact-group lookup key. Order type is derived from it, so a fake value
#       changes which family the order routes to.
#   reference / id — the origin key and the confirmation contract. Redaction leaves them alone,
#       because a payload captured for reference is only useful if it still says which order it
#       was. `--as-test-order` rewrites them separately, and only when asked.
PRESERVED_BY_REDACTION = (
    'deliveryCity', 'deliveryState', 'deliveryPostalCode', 'deliveryCountry',
    'memberId', 'reference', 'id',
)


def redact(node, changed):
    """Walks the payload, substituting identity values wherever they appear, at any depth."""
    if isinstance(node, list):
        return [redact(item, changed) for item in node]
    if not isinstance(node, dict):
        return node

    out = {}
    for key, value in node.items():
        if key in IDENTITY and value is not None and value != '':
            if value != IDENTITY[key]:
                changed.append(f'{key}: {value!r} -> {IDENTITY[key]!r}')
            out[key] = IDENTITY[key]
        else:
            out[key] = redact(value, changed)
    return out


# Back-dated well before any watermark a test would plausibly use, so a scheduled poll never sees
# it. Kept as a date rather than "now minus N" so the fixture is byte-stable across regenerations.
TEST_ORDER_DATE = '2026-06-01T00:00:00Z'


def as_test_order(order, reference, changed):
    """Rewrites the order's identity so it cannot be confused with, or collide with, a real one."""
    old_reference = order.get('reference')
    new_reference = reference if reference.startswith('#') else f'#{reference}'
    order['reference'] = new_reference
    changed.append(f'reference: {old_reference!r} -> {new_reference!r}')

    # The Cin7 record id is the confirmation flow's addressing key, so it has to move with the
    # reference — leaving the real id would point write-backs at a real order.
    digits = ''.join(c for c in reference if c.isdigit()) or '900001'
    new_id = int('9' + digits[-5:].rjust(5, '0'))
    changed.append(f'id: {order.get("id")!r} -> {new_id!r}')
    order['id'] = new_id

    # Each line carries `transactionId`, its back-reference to the order. Rewriting only the
    # top-level id leaves the real order id sitting inside every line — which is both an identity
    # leak and a pointer at a real Cin7 record.
    #
    # `productId`, `productOptionId` and `parentId` are deliberately left alone: they address the
    # item master, not the order, and SCALE has to already know those items. Same reasoning as the
    # SKUs.
    for line in order.get('lineItems') or []:
        if line.get('transactionId') is not None:
            changed.append(
                f'lineItems[].transactionId: {line["transactionId"]!r} -> {new_id!r}'
            )
            line['transactionId'] = new_id

    for field in ('createdDate', 'modifiedDate', 'estimatedDeliveryDate'):
        if order.get(field):
            changed.append(f'{field}: {order[field]!r} -> {TEST_ORDER_DATE!r}')
            order[field] = TEST_ORDER_DATE

    for line in order.get('lineItems') or []:
        if line.get('createdDate'):
            line['createdDate'] = TEST_ORDER_DATE

    return order


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', help='captured Cin7 payload (JSON)')
    parser.add_argument(
        '--check',
        action='store_true',
        help='report what would change and write nothing',
    )
    parser.add_argument(
        '--as-test-order',
        metavar='REFERENCE',
        help='rewrite the reference and Cin7 id, and back-date the order, so it cannot '
        'collide with a real one or be picked up by an ordinary poll',
    )
    args = parser.parse_args()

    with open(args.input) as handle:
        payload = json.load(handle)

    # The finder wraps a capture as {"salesOrders": [ ... ]}; a hand-saved one may be the order
    # itself. Unwrap to a single order either way, so every fixture in the set has one shape.
    if isinstance(payload, dict) and 'salesOrders' in payload:
        orders = payload['salesOrders']
        payload = orders[0] if orders else {}
    elif isinstance(payload, list):
        payload = payload[0] if payload else {}

    changed = []
    redacted = redact(payload, changed)

    if args.as_test_order:
        redacted = as_test_order(redacted, args.as_test_order, changed)

    if args.check:
        print(f'{len(changed)} field(s) would change:', file=sys.stderr)
        for line in changed:
            print(f'  {line}', file=sys.stderr)
        return

    print(f'redacted {len(changed)} field(s)', file=sys.stderr)
    for line in changed:
        print(f'  {line}', file=sys.stderr)
    json.dump(redacted, sys.stdout, indent=2)
    print()


if __name__ == '__main__':
    main()
