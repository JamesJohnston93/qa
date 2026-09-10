#!/usr/bin/env bash
# Reads back the whole chain for one CTC sales order — Order, items, address, shipment header,
# shipment items — and prints the stamps Gate B checks. Read-only: no writes, no Cin7 calls.
#
# Usage: ./inspect-ctc-order.sh --stage <stage> --profile <profile> --reference <ref>
#   --reference takes the normalised reference (no leading '#'), e.g. 100234
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
REFERENCE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFERENCE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --reference <ref>" >&2
	echo "Example: $0 --stage kian-dev --profile dev --reference 100234" >&2
	exit 1
fi

# The stored origin key carries the normalised reference — the poller strips Cin7's leading '#'
# so the key splits into a predictable three segments.
REFERENCE="${REFERENCE#\#}"
ORIGIN="CTC#CIN7_SO#${REFERENCE}"

echo "Origin: ${ORIGIN}"
echo

query_origin() {
	aws dynamodb query --profile "$PROFILE" --region "$REGION" \
		--table-name "$1" --index-name origin_index \
		--key-condition-expression 'origin = :o' \
		--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
		--output json 2>/dev/null || echo '{"Items":[]}'
}

REPORT=$(mktemp)
query_origin "${STAGE}-orders-v2"  > "${REPORT}.orders"

# The shipments table has no origin index; shipment rows hang off the order's partition key.
ORDER_PK=$(python3 -c "
import json
items = json.load(open('${REPORT}.orders')).get('Items', [])
print(items[0]['PK']['S'] if items else '')
")

if [[ -n "$ORDER_PK" ]]; then
	aws dynamodb query --profile "$PROFILE" --region "$REGION" \
		--table-name "${STAGE}-shipments" \
		--key-condition-expression 'PK = :pk' \
		--expression-attribute-values "{\":pk\":{\"S\":\"${ORDER_PK}\"}}" \
		--output json > "${REPORT}.shipments"
else
	echo '{"Items":[]}' > "${REPORT}.shipments"
fi

python3 - "$REPORT" <<'PY'
import json, sys

base = sys.argv[1]

def load(path):
    with open(path) as fh:
        return json.load(fh).get('Items', [])

def plain(item):
    """DynamoDB JSON -> plain values, shallow enough for the stamps we check."""
    out = {}
    for key, wrapped in item.items():
        (kind, value), = wrapped.items()
        if kind == 'S':
            out[key] = value
        elif kind == 'N':
            out[key] = float(value) if '.' in value else int(value)
        elif kind == 'BOOL':
            out[key] = value
        elif kind == 'NULL':
            out[key] = None
        else:
            out[key] = f'<{kind}>'
    return out

orders = [plain(i) for i in load(base + '.orders')]
shipments = [plain(i) for i in load(base + '.shipments')]

def show(label, value, note=''):
    shown = '(absent)' if value is None else value
    print(f'  {label:<20} {shown}{note}')

# --- orders side ---
order_rows = [o for o in orders if o.get('SK') == 'ORDER']
item_rows  = [o for o in orders if str(o.get('SK', '')).startswith('ITEM')]
addr_rows  = [o for o in orders if str(o.get('SK', '')).startswith('ADDRESS')]
txn_rows   = [o for o in orders if str(o.get('SK', '')).startswith('TRANSACTION')]

print(f'{ (base.split("/")[-1]) and "" }ORDERS  ({len(orders)} rows: '
      f'{len(order_rows)} ORDER, {len(item_rows)} ITEM, {len(addr_rows)} ADDRESS, {len(txn_rows)} TRANSACTION)')

if not order_rows:
    if txn_rows:
        print('  !! transaction rows but no ORDER row — create-order has not run (or failed).')
    else:
        print('  !! nothing found for this origin.')
else:
    o = order_rows[0]
    # `store` is not its own attribute: Order.fromDynamo splits it off the composite origin.
    o.setdefault('store', str(o.get('origin', '')).split('#')[0] or None)
    for field in ('store', 'origin', 'orderType', 'cin7Id', 'allocatedStore',
                  'warehouse', 'carrier', 'packingBrand', 'scheduledShipDate', 'status'):
        show(field, o.get(field))
    if o.get('carrier') == 'UNASSIGNED':
        print('     ^ expected: Cin7 assigns the carrier at dispatch (OQ-1159-15)')
    if o.get('packingBrand') is None:
        print('     ^ packingBrand absent — projectName literal mismatch, silent by design (OQ-1159-22)')

# item SK collision is the slice-04 bug returning
sks = [i.get('SK') for i in item_rows]
print(f'\n  ITEM SKs distinct: {len(set(sks))}/{len(sks)}'
      + ('' if len(set(sks)) == len(sks) else '   !! COLLISION — slice-04 bug'))

# --- shipping side ---
print(f'\nSHIPMENTS  ({len(shipments)} rows)')
headers = [s for s in shipments if not str(s.get('SK', '')).startswith('ITEM')]
sitems  = [s for s in shipments if str(s.get('SK', '')).startswith('ITEM')]

if not headers:
    print('  !! no shipment header. If items exist, the CTC branch in create-shipment-items')
    print('     did not fire — check the transaction origin prefix (OQ-1159-03).')
else:
    h = headers[0]
    for field in ('company', 'brand', 'status', 'holdStatus', 'warehouse',
                  'carrier', 'orderType', 'cin7Id', 'wmsSentAt'):
        show(field, h.get(field))
    if h.get('wmsSentAt') is not None:
        print('     ^ wmsSentAt SET — something sent to Manhattan. Expected absent in Gate B.')

print(f'\n  shipment items: {len(sitems)}')
for s in sitems[:5]:
    print(f"    {s.get('SK')}  sku={s.get('sku')}  lineItemId={s.get('lineItemId')}"
          f"  company={s.get('company')}  quantity={s.get('quantity', '(absent)')}")
if len(sitems) > 5:
    print(f'    … {len(sitems) - 5} more')
PY

rm -f "${REPORT}" "${REPORT}.orders" "${REPORT}.shipments"
