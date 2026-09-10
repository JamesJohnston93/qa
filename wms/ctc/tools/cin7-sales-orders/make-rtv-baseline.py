#!/usr/bin/env python3
"""
Derives the RTV baseline fixture from two real redacted payloads.

There is no captured in-scope RTV to redact — see OQ-1161-05. Rather than hand-author one, this
composes the two halves we do have evidence for:

  * **Header shape** from `_shared/BUSY-1065/fixtures/variants/rtv-observed-topgrowth.json`, the one
    real RTV in Cin7: `deliveryCompany` empty with the supplier name in `deliveryFirstName`, no
    customer email, `projectName` empty. That shape is what `deriveShipTo`'s fallback exists for,
    and composing it here means the fallback is exercised rather than the wholesale
    `deliveryCompany` path.
  * **Line structure** from `fixtures/wholesale/01-baseline.json` — 4 style lines over 17 sizes,
    real option codes that exist in the SCALE staging item master. The observed RTV carries one line
    at one size, which would not exercise per-size detail lines or `ErpOrderLineNum` repetition.

Exactly three things are synthesised, and all three are recorded here because they are the reason
this fixture is not evidence of anything by itself:

  1. **An Australian delivery address.** Confirmed with the team 2026-09-07: most real RTVs go to
     overseas suppliers, and the address map is Australia-only (OQ-1159-27), so a real one hard
     errors at `countryCodeForName`. Testing against an Australian address is the agreed interim —
     international is a separate piece of work, and RTV cannot be enabled in production before it.
  2. **`branchId` 51909.** Confirmed with the team 2026-09-07: existing RTVs sit on branch 3 and are
     out of scope; new ones will be raised on 51908/51909. The poller filter is already correct for
     that, so this fixture matches the scope as it will be, not as the one observed order was.
  3. **`stage: New`.** The observed RTV is `Dispatched` — terminal, and correctly produces nothing.

Everything else — option codes, size grain, quantities, the empty `logisticsCarrier` Cin7 leaves
until dispatch — is carried over from real captured data unchanged.

Also writes `02-supplier-email.json`: the same order one revision later, carrying a supplier
email. Cin7 does hold RTVs with an email address (confirmed with the team 2026-09-08), and the
mapper now passes one through rather than dropping it, so the two fixtures together cover both
the absent and the present case.

    ./make-rtv-baseline.py            # write fixtures/rtv/{01-baseline,02-supplier-email}.json
    ./make-rtv-baseline.py --print    # dump to stdout without writing

Writes nothing but those two files. Never calls Cin7 or AWS.
"""

import argparse
import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WHOLESALE_BASELINE = os.path.join(HERE, 'fixtures', 'wholesale', '01-baseline.json')
OBSERVED_RTV = os.path.join(
    HERE, '..', '..', 'fixtures', 'variants', 'rtv-observed-topgrowth.json'
)
OUT = os.path.join(HERE, 'fixtures', 'rtv', '01-baseline.json')
EMAIL_OUT = os.path.join(HERE, 'fixtures', 'rtv', '02-supplier-email.json')

# Distinct from every wholesale and ecom reference so the two never collide on ShipmentId in SCALE
# staging, and self-describing in the SCALE UI. 12 chars, inside ShipmentId's stringLength_25.
REFERENCE = 'RTV1161Sep26'
CIN7_ID = 776001

# Later than the wholesale baseline's own modifiedDate so the two are never mistaken for revisions
# of one order, and whole-second as Cin7 emits it.
MODIFIED_DATE = '2026-09-07T00:00:00Z'

# One revision on from the baseline, so the email scenario is an UPDATE of the same order rather
# than a second order. Whole-second, and strictly later, so the version guards admit it.
EMAIL_MODIFIED_DATE = '2026-09-08T00:00:00Z'
SUPPLIER_EMAIL = 'rtv.supplier@example-test.invalid'


def build():
    with open(WHOLESALE_BASELINE) as f:
        order = json.load(f)
    with open(OBSERVED_RTV) as f:
        observed = json.load(f)

    order = copy.deepcopy(order)
    supplier = observed['deliveryFirstName']

    order['id'] = CIN7_ID
    order['reference'] = REFERENCE
    order['modifiedDate'] = MODIFIED_DATE
    order['memberId'] = observed['memberId']

    # The RTV header shape, from the observed order: the supplier name lives in the delivery first
    # name and `deliveryCompany` is empty, which is what deriveShipTo's fallback is for.
    order['firstName'] = supplier
    order['lastName'] = ''
    order['company'] = supplier
    order['deliveryFirstName'] = supplier
    order['deliveryLastName'] = ''
    order['deliveryCompany'] = ''

    # The observed RTV carries no customer email, so the baseline carries none either — it is
    # what proves SCALE accepts a shipment with no EmailAddress element. Cin7 does hold RTVs that
    # have one; that case is 02-supplier-email.json.
    order['email'] = ''
    order['memberEmail'] = ''

    # Synthesised: an Australian supplier address (reason 1 in the docstring). The address fields
    # themselves are the wholesale baseline's, already redacted.
    order['deliveryCountry'] = 'Australia'

    # Synthesised: in-scope branch (reason 2) and an eligible stage (reason 3).
    order['branchId'] = 51909
    order['stage'] = 'New'
    order['status'] = 'APPROVED'
    order['isApproved'] = True

    # Non-ecom orders carry free text or nothing in projectName, so no packingBrand is derived.
    order['projectName'] = ''
    # Cin7 assigns the carrier at dispatch, so it is empty at the only moment the poller reads it
    # (OQ-1159-08) and the mapper omits the Carrier element entirely.
    order['logisticsCarrier'] = ''
    order['internalComments'] = ''
    order['cancellationDate'] = None
    order['isVoid'] = False
    order['source'] = 'Backend'

    return order


def build_with_email(baseline):
    """The baseline one revision later, with a supplier email Cin7 supplied."""
    order = copy.deepcopy(baseline)
    order['modifiedDate'] = EMAIL_MODIFIED_DATE
    order['email'] = SUPPLIER_EMAIL
    order['memberEmail'] = SUPPLIER_EMAIL
    return order


def summarise(order, path):
    sizes = sum(len(li.get('sizes') or []) for li in order['lineItems'])
    print(f'Wrote {os.path.relpath(path, HERE)}')
    print(
        f'  {order["reference"]} — {len(order["lineItems"])} style lines, {sizes} sizes, '
        f'branch {order["branchId"]}, stage {order["stage"]}, '
        f'modified {order["modifiedDate"]}'
    )
    print(f'  email: {order["email"]!r}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--print', action='store_true', dest='to_stdout',
        help='dump the fixtures without writing them',
    )
    args = parser.parse_args()

    order = build()
    with_email = build_with_email(order)

    if args.to_stdout:
        print(json.dumps(order, indent=1))
        print(json.dumps(with_email, indent=1))
        return

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    for target, payload in ((OUT, order), (EMAIL_OUT, with_email)):
        with open(target, 'w') as f:
            f.write(json.dumps(payload, indent=1) + '\n')
        summarise(payload, target)

    print(f'  ShipTo derives from deliveryFirstName: {order["deliveryFirstName"]!r}')


if __name__ == '__main__':
    main()
