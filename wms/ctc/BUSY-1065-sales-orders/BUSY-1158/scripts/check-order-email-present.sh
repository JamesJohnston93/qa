#!/usr/bin/env bash
# Reads one order row and reports whether a customer email is present. Prints presence and length
# only, never the value.
#
# Ticket:      BUSY-1158
# Cases:       TC5b
# Asserts:     whether the order carries a customerEmail field, and its field name, so a Segment
#              guard PASS can be told apart from an incidental empty-email early return
# Does NOT:    prove the Segment guard actually reads this field, only that the field exists on the
#              row. Pair with the guard script's own log read for that
# Side effects: read only
#
# Usage: ./check-order-email-present.sh --stage <stage> --profile <profile> --pk <pk>
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
PK=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--pk) PK="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$PK" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --pk <pk>" >&2
	echo "Example: $0 --stage staging --profile staging --pk 7e02c7f6-..." >&2
	exit 1
fi

aws dynamodb get-item --table-name "${STAGE}-orders-v2" --profile "$PROFILE" --region "$REGION" \
	--key "{\"PK\":{\"S\":\"${PK}\"},\"SK\":{\"S\":\"ORDER\"}}" \
	--output json \
| python3 -c '
import json, sys

item = json.load(sys.stdin).get("Item")
if not item:
    print("NOT FOUND")
    sys.exit(1)

field = "customerEmail"
val = item.get(field, {}).get("S")
if val:
    print(f"{field}: present, length {len(val)}")
else:
    print(f"{field}: ABSENT")
'
