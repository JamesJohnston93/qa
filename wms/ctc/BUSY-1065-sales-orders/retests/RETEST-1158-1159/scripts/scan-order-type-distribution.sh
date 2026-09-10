#!/usr/bin/env bash
# Full-table scan of an orders/shipments-shaped table's header rows, tallying distinct orderType
# values (and a MISSING bucket for rows with no orderType attribute at all).
#
# Ticket:      RETEST-1158-1159 (BUSY-1159, BUSY-1160)
# Cases:       R14 W1b
# Asserts:     the complete distinct-orderType population of a table's header rows, so a wholesale,
#              RTV or STORE_PICK record under any orderType value would show up as a nonzero count
# Does NOT:    prove a record with a given orderType is well-formed or reachable by any other lookup.
#              Header rows only, selected by the caller's --sk-match; does not inspect line items,
#              addresses or transactions. Does not print any customer-identifying attribute, only
#              SK, origin and orderType.
# Side effects: read only. Full table scan (whole retained item count), same class of cost as R2's
#               prior full scan of staging-shipments (178,975 items).
#
# Usage: ./scan-order-type-distribution.sh --stage <stage> --profile <profile> --table <table-name> \
#          --sk-match <eq:VALUE|prefix:VALUE> [--region <region>]
# Example: ./scan-order-type-distribution.sh --stage staging --profile staging \
#            --table staging-orders-v2 --sk-match eq:ORDER
# Example: ./scan-order-type-distribution.sh --stage staging --profile staging \
#            --table staging-shipments --sk-match prefix:SHIPMENT#
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
TABLE=""
SK_MATCH=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--table) TABLE="$2"; shift 2 ;;
		--sk-match) SK_MATCH="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$TABLE" || -z "$SK_MATCH" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --table <table-name> --sk-match <eq:VALUE|prefix:VALUE> [--region <region>]" >&2
	exit 1
fi

MODE="${SK_MATCH%%:*}"
VALUE="${SK_MATCH#*:}"
case "$MODE" in
	eq) FILTER_EXPR="SK = :skval" ;;
	prefix) FILTER_EXPR="begins_with(SK, :skval)" ;;
	*) echo "sk-match must be eq:VALUE or prefix:VALUE" >&2; exit 1 ;;
esac

echo "Scanning $TABLE ($STAGE, $PROFILE), SK $MODE '$VALUE'..." >&2
echo "(No --max-items given, so the AWS CLI paginates internally across the whole table and returns" >&2
echo "one merged result. This is a full-table scan, same class of cost as R2's prior scan.)" >&2

RESULT=$(aws dynamodb scan --profile "$PROFILE" --region "$REGION" --table-name "$TABLE" \
	--filter-expression "$FILTER_EXPR" \
	--expression-attribute-values "{\":skval\":{\"S\":\"$VALUE\"}}" \
	--projection-expression "SK, orderType, origin" \
	--output json)

echo "$RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Header rows matched:', d.get('Count', 0), '(of', d.get('ScannedCount', 0), 'items scanned)')
from collections import Counter
c = Counter()
for it in d.get('Items', []):
    ot = it.get('orderType', {}).get('S', 'MISSING')
    c[ot] += 1
print('Distinct orderType values:')
for val, n in c.most_common():
    print(f'  {n:>7}  {val}')
"
