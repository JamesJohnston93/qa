#!/usr/bin/env bash
# Reads back the whole chain for one CTC sales order — Order, items, address, shipment header,
# shipment items — and prints the stamps Gate B checks. Read-only: no writes, no Cin7 calls.
#
# Works for both families off the one --reference: the native ECOM chain (Order/ITEM/ADDRESS +
# Shipment header/items) and the outbound WHOLESALE/RTV chain (the same Order/ITEM rows, plus the
# OUTBOUND_SHIPMENT header, its OUTBOUND_ITEM lines and its TRANSACTION rows). Whichever actually
# has data for this reference is what prints — nothing here needs telling which family it is.
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

# The outbound header's own PK is deterministic from company + reference — unlike the native
# shipment above, it needs no indirection through the order's partition key at all.
aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "${STAGE}-shipments" \
	--key-condition-expression 'PK = :pk' \
	--expression-attribute-values "{\":pk\":{\"S\":\"OUTBOUND_SHIPMENT#CTC#${REFERENCE}\"}}" \
	--output json > "${REPORT}.outbound" 2>/dev/null || echo '{"Items":[]}' > "${REPORT}.outbound"

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
outbound = [plain(i) for i in load(base + '.outbound')]

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
                  'warehouse', 'carrier', 'packingBrand', 'scheduledShipDate', 'status',
                  # Revision state. `lastModified` is the version guard's subject and
                  # `lastEmittedPayloadHash` is the echo guard's — without both you cannot tell
                  # why a poll did or did not emit.
                  'sourceStatus', 'sourceStage', 'lastModified',
                  'lastEmittedPayloadHash'):
        show(field, o.get(field))
    if o.get('carrier') == 'UNASSIGNED':
        print('     ^ expected: Cin7 assigns the carrier at dispatch (OQ-1159-15)')
    if o.get('packingBrand') is None:
        print('     ^ packingBrand absent — projectName literal mismatch, silent by design')
    if o.get('status') == 'CANCELLED':
        print('     ^ withdrawn: the shipment should carry status REMOVED and SCALE should have')
        print('       received a header DELETE')
    if not o.get('lastEmittedPayloadHash'):
        print('     ^ no echo hash stored — the next poll of this order will read it as changed')
        print('       and emit an update. Expected only before the first emit.')
    elif o.get('lastEmittedPayloadHash') == 'stale000':
        print('     ^ hash deliberately staled by stale-payload-hash.sh. Restore it when done:')
        print('       ./stale-payload-hash.sh --reference <ref> --restore ...')

# A duplicate SK would mean two rows for one unit, which no revision should ever produce.
sks = [i.get('SK') for i in item_rows]
print(f'\n  ITEM SKs distinct: {len(set(sks))}/{len(sks)}'
      + ('' if len(set(sks)) == len(sks) else '   !! COLLISION'))

# Reconciliation is per (lineItemId, sku) unit counts, so this breakdown is what shows whether an
# update actually landed: a quantity change moves the OPEN count and leaves the surviving rows
# alone, and a removal or cancellation turns rows CANCELLED without deleting any.
from collections import Counter
by_status = Counter(i.get('status') for i in item_rows)
print('  ITEM status:      '
      + (', '.join(f'{k}={v}' for k, v in sorted(by_status.items(), key=lambda kv: str(kv[0])))
         or '(none)'))

is_outbound_order = order_rows and order_rows[0].get('orderType') in ('WHOLESALE', 'RTV')

if is_outbound_order:
    # Outbound's grain is one row per SIZE, carrying its own `quantity` — there is no row-per-unit
    # to count, so the OPEN total is a sum of that field rather than a row tally.
    totals = Counter()
    for i in item_rows:
        if i.get('status') == 'OPEN':
            totals[(i.get('lineItemId'), i.get('sku'))] += i.get('quantity') or 0
    pairs = totals
else:
    pairs = Counter(
        (i.get('lineItemId'), i.get('sku')) for i in item_rows if i.get('status') == 'OPEN'
    )

if pairs:
    print('  OPEN units per (lineItemId, sku) — the grain SCALE receives:')
    for (line_id, sku), count in sorted(pairs.items(), key=lambda kv: str(kv[0])):
        print(f'      line {line_id or "<none>":<12} {sku or "<none>":<24} x{count}')
    if any(line_id is None for line_id, _ in pairs):
        print('      !! a unit with no lineItemId — the sender refuses to send this, because')
        print('         ErpOrderLineNum is half the identity the confirmation flows match on')

# --- shipping side: native ---
# Outbound orders never populate this table via the order's own PK — they use the deterministic
# OUTBOUND_SHIPMENT# key below instead — so an empty result here is expected for them, not a
# fault. Only warn about a missing header for an order this side actually expects one from.
if not is_outbound_order:
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

# --- shipping side: outbound (WHOLESALE/RTV) ---
outbound_header_rows = [o for o in outbound if str(o.get('SK', '')).startswith('SHIPMENT#')]
outbound_item_rows   = [o for o in outbound if str(o.get('SK', '')).startswith('OUTBOUND_ITEM#')]
outbound_txn_rows    = [o for o in outbound if str(o.get('SK', '')).startswith('TRANSACTION#')]

if outbound or is_outbound_order:
    print(f'\nOUTBOUND_SHIPMENT  ({len(outbound)} rows: {len(outbound_header_rows)} header, '
          f'{len(outbound_item_rows)} OUTBOUND_ITEM, {len(outbound_txn_rows)} TRANSACTION)')

    if not outbound_header_rows:
        print('  !! no OUTBOUND_SHIPMENT header. If the order exists, the bridge or the')
        print('     materialiser has not run yet — check their queues in check-ctc-status.sh.')
    else:
        oh = outbound_header_rows[0]
        for field in ('status', 'company', 'orderType', 'cin7Id', 'reference', 'shipTo',
                      'carrier', 'allocateComplete', 'warehouse', 'scheduledShipDate',
                      'orderDate', 'sourceStatus', 'lastModified', 'sentAt', 'customerOrderNo'):
            show(field, oh.get(field))
        show('shipToAddress', oh.get('shipToAddress'))
        if oh.get('status') == 'CANCELLED_OUTBOUND':
            print('     ^ cancelled: the next send should carry a header DELETE, never a SAVE')
        if oh.get('status') == 'SENT_OUTBOUND' and not oh.get('sentAt'):
            print('     ^ SENT_OUTBOUND with no sentAt — the SENT transaction is missing a field')
        if oh.get('status') == 'PENDING_OUTBOUND' and oh.get('sentAt'):
            print('     ^ sentAt SET but status is still PENDING_OUTBOUND — the SENT transaction')
            print('       either has not arrived yet or was dropped by the version guard')

    line_status = Counter(i.get('status') for i in outbound_item_rows)
    print('\n  OUTBOUND_ITEM status: '
          + (', '.join(f'{k}={v}' for k, v in sorted(line_status.items(), key=lambda kv: str(kv[0])))
             or '(none)'))
    for i in sorted(outbound_item_rows, key=lambda i: str(i.get('SK')))[:10]:
        print(f"    {i.get('SK')}  item={i.get('item')}  qty={i.get('qty')}"
              f"  status={i.get('status')}")
    if len(outbound_item_rows) > 10:
        print(f'    … {len(outbound_item_rows) - 10} more')

    if outbound_txn_rows:
        txn_events = Counter(t.get('event') for t in outbound_txn_rows)
        print('\n  TRANSACTION events (oldest to newest): '
              + ', '.join(f'{k}={v}' for k, v in sorted(txn_events.items(), key=lambda kv: str(kv[0]))))
        for t in sorted(outbound_txn_rows, key=lambda t: str(t.get('SK'))):
            print(f"    {t.get('SK')}  event={t.get('event')}  idempotencyId={t.get('idempotencyId')}")
PY

rm -f "${REPORT}" "${REPORT}.orders" "${REPORT}.shipments" "${REPORT}.outbound"
