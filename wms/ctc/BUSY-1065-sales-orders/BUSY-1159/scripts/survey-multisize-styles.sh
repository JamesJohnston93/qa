#!/usr/bin/env bash
# Scans staging-orders-v2 (all ITEM rows for CTC-origin orders) and staging-shipments (ITEM rows
# with company=CTC) separately, groups each by (order PK, lineItemId), and reports which groups
# carry two or more distinct sku values, i.e. a multi-size style. The orders-v2 side carries
# `origin` and `deliveryMethod` directly on every row, so it also gives a reference/orderType/
# stored-item-count list for the whole population without a second per-order lookup.
#
# Ticket:      BUSY-1159
# Cases:       TC6b, TC6c
# Asserts:     population counts (rows scanned, distinct CTC orders, (order,lineItemId) groups) on
#              both tables, the count of groups carrying 2+ distinct sku values on each, the largest
#              distinct-sku count seen, and for each multi-size group its reference, lineItemId,
#              distinct sku count and whether a quantity attribute is present on any row. Also
#              prints, per order, the orders-v2 ITEM row count vs the shipments ITEM row count and
#              the deliveryMethod breakdown, so a difference between the two counts can be
#              attributed to the known DIGITAL/INSTORE shipping-side exclusion rather than assumed
#              to be a zero-quantity skip
# Does NOT:    call Cin7, so it cannot see a size that never produced any stored row at all (TC6c's
#              zero-quantity shape), and does not itself confirm a reconciliation against the Cin7
#              line total or decide PASS/FAIL, only surveys what is stored
# Side effects: read only
#
# Usage: ./survey-multisize-styles.sh --stage <stage> --profile <profile> [--region <region>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--region <region>]" >&2
	exit 1
fi

ORDERS_TABLE="${STAGE}-orders-v2"
SHIPMENTS_TABLE="${STAGE}-shipments"

ORDERS_RESULTS=$(mktemp)
SHIPMENTS_RESULTS=$(mktemp)
trap 'rm -f "$ORDERS_RESULTS" "$SHIPMENTS_RESULTS"' EXIT

scan_table() {
	local table="$1" filter="$2" names="$3" values="$4" projection="$5" outfile="$6"
	local last_key="" page=0 total=0 resp scanned
	echo "Scanning ${table} ..." >&2
	while true; do
		page=$((page + 1))
		if [[ -z "$last_key" ]]; then
			resp=$(aws dynamodb scan --table-name "$table" --profile "$PROFILE" --region "$REGION" \
				--filter-expression "$filter" --expression-attribute-names "$names" \
				--expression-attribute-values "$values" --projection-expression "$projection" \
				--output json)
		else
			resp=$(aws dynamodb scan --table-name "$table" --profile "$PROFILE" --region "$REGION" \
				--filter-expression "$filter" --expression-attribute-names "$names" \
				--expression-attribute-values "$values" --projection-expression "$projection" \
				--exclusive-start-key "$last_key" --output json)
		fi
		scanned=$(echo "$resp" | jq -r '.ScannedCount')
		total=$((total + scanned))
		echo "$resp" | jq -c '.Items[]' >> "$outfile"
		last_key=$(echo "$resp" | jq -c '.LastEvaluatedKey // empty')
		echo "  page ${page}: scanned ${scanned} (running total ${total})" >&2
		[[ -z "$last_key" ]] && break
	done
	echo "  total rows scanned (entire table): ${total}" >&2
}

scan_table "$ORDERS_TABLE" \
	'begins_with(SK, :sk) AND begins_with(#o, :o)' \
	'{"#o":"origin"}' \
	'{":sk":{"S":"ITEM#"},":o":{"S":"CTC#CIN7_SO#"}}' \
	'PK,SK,sku,lineItemId,#o,deliveryMethod' \
	"$ORDERS_RESULTS"

scan_table "$SHIPMENTS_TABLE" \
	'begins_with(SK, :sk) AND #c = :c' \
	'{"#c":"company"}' \
	'{":sk":{"S":"ITEM#"},":c":{"S":"CTC"}}' \
	'PK,SK,sku,lineItemId,quantity' \
	"$SHIPMENTS_RESULTS"

echo

python3 -c "
import json
from collections import defaultdict, Counter

def unwrap(v):
    if 'S' in v: return v['S']
    if 'N' in v: return v['N']
    return None

def load(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            rows.append({k: unwrap(v) for k, v in item.items()})
    return rows

def report(label, rows, has_origin):
    orders = set(r['PK'] for r in rows)
    print(f'=== {label} ===')
    print(f'ITEM rows found: {len(rows)}')
    print(f'Distinct CTC orders represented: {len(orders)}')

    groups = defaultdict(list)
    for r in rows:
        groups[(r['PK'], r.get('lineItemId'))].append(r)

    multi = {k: v for k, v in groups.items() if len(set(x['sku'] for x in v)) >= 2}
    largest = max((len(set(x['sku'] for x in v)) for v in groups.values()), default=0)

    print(f'(order, lineItemId) groups total: {len(groups)}')
    print(f'Groups with 2+ distinct sku (multi-size style candidates): {len(multi)}')
    print(f'Largest distinct-sku count seen in any group: {largest}')
    if multi:
        print('Candidates (order, lineItemId, distinct sku count, row count):')
        for (pk, lid), v in multi.items():
            ref = v[0].get('origin', pk) if has_origin else pk
            skus = sorted(set(x['sku'] for x in v))
            print(f'  {ref}  lineItemId={lid}  distinct_sku={len(skus)}  rows={len(v)}')
    else:
        print('No candidates found.')
    print()
    return rows, orders

orders_rows, orders_pop = report('staging-orders-v2 (pre-shipping-filter, all ITEM rows for CTC origin)', load('$ORDERS_RESULTS'), True)
ship_rows, ship_pop = report('staging-shipments (company=CTC ITEM rows, post DIGITAL/INSTORE filter)', load('$SHIPMENTS_RESULTS'), False)

print('=== Per-order comparison, orders-v2 ITEM count vs shipments ITEM count ===')
orders_by_pk = defaultdict(list)
for r in orders_rows:
    orders_by_pk[r['PK']].append(r)
ship_count_by_pk = Counter(r['PK'] for r in ship_rows)

for pk, rows in sorted(orders_by_pk.items(), key=lambda kv: kv[1][0].get('origin', '')):
    origin = rows[0].get('origin', '(absent)')
    dm_counts = Counter(r.get('deliveryMethod') for r in rows)
    ov_count = len(rows)
    sh_count = ship_count_by_pk.get(pk, 0)
    diff = ov_count - sh_count
    dm_str = ', '.join(f'{k}:{v}' for k, v in sorted(dm_counts.items()))
    flag = ''
    if diff != 0:
        excluded_dm = sum(v for k, v in dm_counts.items() if k in ('DIGITAL', 'INSTORE'))
        flag = '  <- matches DIGITAL/INSTORE exclusion' if diff == excluded_dm and excluded_dm > 0 else '  <- UNEXPLAINED DIFFERENCE, candidate for zero-qty reconciliation'
    print(f'  {origin}  orders-v2={ov_count}  shipments={sh_count}  diff={diff}  deliveryMethod=({dm_str}){flag}')
"
