#!/usr/bin/env bash
# Reads one shipment TRANSACTION row and prints only the payload block's key names plus the three
# CTC fields (company, orderType, cin7Id). Never prints shippingAddress or any other field's value.
#
# Ticket:      BUSY-1158
# Cases:       TC2b
# Asserts:     company, orderType and cin7Id are present inside shipmentInfo (the transaction payload
#              block), not just on the shipment header
# Does NOT:    check the header itself (inspect-ctc-order.sh already reads that), or prove the
#              confirmation leg can actually consume the block, only that the fields are there
# Side effects: read only
#
# Usage: ./read-transaction-payload.sh --stage <stage> --profile <profile> --pk <pk> --sk <sk>
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
PK=""
SK=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--pk) PK="$2"; shift 2 ;;
		--sk) SK="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$PK" || -z "$SK" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --pk <pk> --sk <sk>" >&2
	echo "Example: $0 --stage staging --profile staging --pk 7e02c7f6-... --sk 'TRANSACTION#1787874540902'" >&2
	exit 1
fi

aws dynamodb get-item --table-name "${STAGE}-shipments" --profile "$PROFILE" --region "$REGION" \
	--key "{\"PK\":{\"S\":\"${PK}\"},\"SK\":{\"S\":\"${SK}\"}}" \
	--output json \
| python3 -c '
import json, sys

def unwrap(v):
    if "S" in v: return v["S"]
    if "N" in v: return v["N"]
    if "BOOL" in v: return v["BOOL"]
    if "NULL" in v: return None
    if "M" in v: return {k: unwrap(x) for k, x in v["M"].items()}
    if "L" in v: return [unwrap(x) for x in v["L"]]
    return "(other type)"

item = json.load(sys.stdin).get("Item")
if not item:
    print("NOT FOUND")
    sys.exit(1)

info = unwrap(item.get("shipmentInfo", {"M": {}}))
if not isinstance(info, dict):
    print("shipmentInfo: absent or not a map")
    sys.exit(0)

print(f"shipmentInfo keys ({len(info)}):", ", ".join(sorted(info.keys())))
print()
for field in ("company", "orderType", "cin7Id"):
    present = field in info
    status = "present" if present else "ABSENT"
    line = f"  {field}: {status}"
    if present:
        line += f" = {info.get(field)}"
    print(line)

item_info = unwrap(item.get("shipmentItemInfo", {"L": []}))
if isinstance(item_info, list) and item_info and isinstance(item_info[0], dict):
    print()
    print(f"shipmentItemInfo[0] keys ({len(item_info[0])}):", ", ".join(sorted(item_info[0].keys())))
    has_company = "company" in item_info[0]
    status = "present" if has_company else "ABSENT"
    line = f"  company: {status}"
    if has_company:
        company_val = item_info[0].get("company")
        line += f" = {company_val}"
    print(line)
'
