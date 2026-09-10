#!/usr/bin/env bash
# Prints the ADDRESS row's field lengths for one order, never the field values. Exists so a
# truncation case (TC18 and anything like it) can be checked without ever putting a customer
# name, email or address into a script's stdout, a result file, or this chat.
#
# Ticket:      BUSY-1159
# Cases:       TC18
# Asserts:     the string length of every ADDRESS row attribute for one order
# Does NOT:    prove the content is correct, only its length. Redaction-safe by construction,
#              not a substitute for a real value comparison if one is ever needed
# Side effects: read only
#
# Usage: ./address-field-lengths.sh --stage <stage> --profile <profile> --reference <ref>
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
	echo "Example: $0 --stage staging --profile staging --reference 261106" >&2
	exit 1
fi

REFERENCE="${REFERENCE#\#}"
ORIGIN="CTC#CIN7_SO#${REFERENCE}"

ORDER_PK=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "${STAGE}-orders-v2" --index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
	--query 'Items[0].PK.S' --output text 2>/dev/null)

if [[ -z "$ORDER_PK" || "$ORDER_PK" == "None" ]]; then
	echo "No order found for origin ${ORIGIN}" >&2
	exit 1
fi

aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "${STAGE}-orders-v2" \
	--key-condition-expression 'PK = :pk AND begins_with(SK, :sk)' \
	--expression-attribute-values "{\":pk\":{\"S\":\"${ORDER_PK}\"},\":sk\":{\"S\":\"ADDRESS\"}}" \
	--output json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("Items", [])
print("address rows:", len(items))
for it in items:
    print("SK:", it.get("SK", {}).get("S"))
    for k, v in it.items():
        if k in ("PK", "SK"):
            continue
        (kind, val), = v.items()
        if kind == "S":
            print(f"  {k}: length={len(val)}")
        else:
            print(f"  {k}: <{kind}>")
'
