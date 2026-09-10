#!/usr/bin/env bash
# Scans staging-shipments for a Universal Store shipment header that reached the table via a
# warehouse route (not click and collect) and was fulfilled, picking the most recent one found so it
# reflects the currently deployed code rather than an old pre-BUSY-1158 record.
#
# Ticket:      BUSY-1158
# Cases:       TC3b, TC7
# Asserts:     nothing about the system. It only finds a candidate row and prints its identifying
#              keys, brand, delivery method, status and createdAt, for a human to read TC3b/TC7 from
# Does NOT:    guarantee the candidate returned is CTC-free at read time, only that it predates any
#              CTC traffic if its createdAt is checked against the epoch this ticket's work started.
#              Full table scan, opportunistic: a later run may find a more recent candidate
# Side effects: read only
#
# Usage: ./find-warehouse-uni-order.sh --stage <stage> --profile <profile> [--brand US]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
BRAND="US"
CLICK_COLLECT_METHODS="PICKUP CLICK_COLLECT CC"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--brand) BRAND="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--brand US]" >&2
	exit 1
fi

TABLE="${STAGE}-shipments"
TMP_RESULTS=$(mktemp)
trap 'rm -f "$TMP_RESULTS"' EXIT

LAST_KEY=""
PAGE=0
TOTAL_SCANNED=0

while true; do
	PAGE=$((PAGE + 1))
	if [[ -z "$LAST_KEY" ]]; then
		RESP=$(aws dynamodb scan --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" \
			--filter-expression "begins_with(SK, :sk) AND brand = :b AND #s = :st" \
			--expression-attribute-names '{"#s":"status"}' \
			--expression-attribute-values "{\":sk\":{\"S\":\"SHIPMENT#\"},\":b\":{\"S\":\"${BRAND}\"},\":st\":{\"S\":\"FULFILLED\"}}" \
			--output json)
	else
		RESP=$(aws dynamodb scan --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" \
			--filter-expression "begins_with(SK, :sk) AND brand = :b AND #s = :st" \
			--expression-attribute-names '{"#s":"status"}' \
			--expression-attribute-values "{\":sk\":{\"S\":\"SHIPMENT#\"},\":b\":{\"S\":\"${BRAND}\"},\":st\":{\"S\":\"FULFILLED\"}}" \
			--exclusive-start-key "$LAST_KEY" \
			--output json)
	fi

	SCANNED=$(echo "$RESP" | jq -r '.ScannedCount')
	TOTAL_SCANNED=$((TOTAL_SCANNED + SCANNED))
	echo "$RESP" | jq -c '.Items[]' >> "$TMP_RESULTS"

	LAST_KEY=$(echo "$RESP" | jq -c '.LastEvaluatedKey // empty')
	echo "page ${PAGE}: scanned ${SCANNED} (running total ${TOTAL_SCANNED})" >&2
	[[ -z "$LAST_KEY" ]] && break
done

echo "Total rows scanned: ${TOTAL_SCANNED}" >&2
echo

python3 -c "
import json, sys

CLICK_COLLECT = set('$CLICK_COLLECT_METHODS'.split())

def unwrap(v):
    if 'S' in v: return v['S']
    if 'N' in v: return v['N']
    if 'BOOL' in v: return v['BOOL']
    return None

candidates = []
with open('$TMP_RESULTS') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        d = {k: unwrap(v) for k, v in item.items()}
        method = d.get('deliveryMethod')
        if method in CLICK_COLLECT:
            continue
        candidates.append(d)

print(f'Candidates (brand=$BRAND, status=FULFILLED, non click-and-collect delivery method): {len(candidates)}')
if not candidates:
    print('NONE FOUND')
    sys.exit(0)

candidates.sort(key=lambda d: int(d.get('createdAt') or 0), reverse=True)
best = candidates[0]
print()
print('Most recent candidate:')
for k in ('PK', 'SK', 'shipmentId', 'brand', 'deliveryMethod', 'status', 'createdAt', 'carrier', 'allocatedStore'):
    print(f'  {k}: {best.get(k)}')
"
