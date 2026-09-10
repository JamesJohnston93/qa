#!/usr/bin/env bash
# Scans staging-shipments for company = CTC and prints a status distribution, so TC4e's fixture
# question (does any CTC shipment exist past OPEN, without anyone driving one there) can be answered
# from what is already on staging rather than by moving one.
#
# Ticket:      BUSY-1158
# Cases:       none directly, decides whether TC4e is runnable
# Asserts:     the status distribution of every CTC shipment header in the table, and the total item
#              count scanned, so a partial scan can't be mistaken for a complete one
# Does NOT:    explain why a shipment is in a given state, or say anything about order or item rows.
#              Header rows only (SK begins_with SHIPMENT#)
# Side effects: read only
#
# Usage: ./list-ctc-shipment-states.sh --stage <stage> --profile <profile>
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
	echo "Usage: $0 --stage <stage> --profile <profile>" >&2
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
			--filter-expression "begins_with(SK, :sk) AND #c = :c" \
			--expression-attribute-names '{"#s":"status","#c":"company"}' \
			--expression-attribute-values '{":sk":{"S":"SHIPMENT#"},":c":{"S":"CTC"}}' \
			--projection-expression "PK,SK,#s,createdAt" \
			--output json)
	else
		RESP=$(aws dynamodb scan --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" \
			--filter-expression "begins_with(SK, :sk) AND #c = :c" \
			--expression-attribute-names '{"#s":"status","#c":"company"}' \
			--expression-attribute-values '{":sk":{"S":"SHIPMENT#"},":c":{"S":"CTC"}}' \
			--projection-expression "PK,SK,#s,createdAt" \
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

echo "Total rows scanned (entire table): ${TOTAL_SCANNED}" >&2
echo

python3 -c "
import json, sys
from collections import Counter

def unwrap(v):
    if 'S' in v: return v['S']
    if 'N' in v: return v['N']
    return None

rows = []
with open('$TMP_RESULTS') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        d = {k: unwrap(v) for k, v in item.items()}
        rows.append(d)

print(f'Total company=CTC shipment headers found: {len(rows)}')
print()

counts = Counter(r.get('status') for r in rows)
for status, n in counts.most_common():
    print(f'  {status}: {n}')

print()
if rows:
    created = sorted(int(r['createdAt']) for r in rows if r.get('createdAt'))
    from datetime import datetime, timezone
    print('createdAt range:', datetime.fromtimestamp(created[0], tz=timezone.utc), 'to', datetime.fromtimestamp(created[-1], tz=timezone.utc))

print()
print('Rows, PK / SK / status / createdAt:')
for r in sorted(rows, key=lambda r: int(r.get('createdAt') or 0)):
    print(f\"  {r.get('PK')}  {r.get('SK')}  {r.get('status')}  {r.get('createdAt')}\")
"
