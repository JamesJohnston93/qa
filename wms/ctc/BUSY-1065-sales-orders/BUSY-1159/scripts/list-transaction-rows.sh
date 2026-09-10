#!/usr/bin/env bash
# Lists TRANSACTION row SKs and idempotencyId for one order, redaction-safe (never prints the
# customerEmail, addressChanges or orderInfo also stored on that row).
#
# Ticket:      BUSY-1159
# Cases:       TC21b
# Asserts:     how many TRANSACTION rows exist for an order's origin, and each one's SK
#              (a millisecond timestamp) and idempotencyId, so a re-poll can be checked for a
#              new row and whether its idempotencyId collides with an existing one
# Does NOT:    prove the transaction writer deduped anything. It only lists what is stored;
#              pairing two runs before/after an invoke is what shows a dedupe happened
# Side effects: read only
#
# Usage: ./list-transaction-rows.sh --stage <stage> --profile <profile> --reference <ref>
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
	echo "Example: $0 --stage staging --profile staging --reference 261119" >&2
	exit 1
fi

REFERENCE="${REFERENCE#\#}"
ORIGIN="CTC#CIN7_SO#${REFERENCE}"

echo "Origin: ${ORIGIN}"

aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "${STAGE}-orders-v2" --index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
	--output json 2>/dev/null \
| python3 -c "
import json, sys
items = json.load(sys.stdin).get('Items', [])
txns = [i for i in items if i.get('SK', {}).get('S', '').startswith('TRANSACTION')]
print(f'TRANSACTION rows: {len(txns)}')
for t in sorted(txns, key=lambda i: i['SK']['S']):
    sk = t['SK']['S']
    idem = t.get('idempotencyId', {}).get('S', '(absent)')
    event = t.get('event', {}).get('S', '(absent)')
    print(f'  {sk}  event={event}  idempotencyId={idem}')
"
