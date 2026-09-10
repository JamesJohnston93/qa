#!/usr/bin/env bash
# Finds the API Gateway REST API and resource fronting a given lambda's GET method, then uses
# apigateway test-invoke-method to call it with a --status filter, printing only safe fields from
# each returned order (never an address, email or name). Built for TC9 Gate B, generic to any
# single-lambda-behind-API-Gateway GET route.
#
# Ticket:      BUSY-1158
# Cases:       TC9 (Gate B)
# Asserts:     what a given status query actually returns from the gateway right now: which origins,
#              stores and cin7Ids come back, unfiltered by anything this script does itself.
# Does NOT:    prove the gateway never filters by store under some other query shape it was not asked
#              here. Does NOT paginate past the first page (a status like OPEN can hold tens of
#              thousands of rows) — a specific reference may not appear on page one even if the
#              gateway would return it eventually. Does NOT identify who calls this endpoint; that is
#              a separate, manual wiring question this script does not attempt.
# Side effects: invokes the lambda for real via test-invoke-method (counts as calling it, not reading
#               logs). The lambda's own IAM role must be read-only (Query/GetItem/Scan/BatchGetItem,
#               no Put/Update/Delete) for this to stay a read path — check that separately before
#               relying on this script; it does not check it for you.
#
# Usage: ./query-listorders-gateway.sh --stage <stage> --profile <profile> --function <lambda-name> \
#          --path /orders --query "status=OPEN"
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
FUNCTION=""
PATH_PART=""
QUERYSTRING=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--function) FUNCTION="$2"; shift 2 ;;
		--path) PATH_PART="$2"; shift 2 ;;
		--query) QUERYSTRING="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$FUNCTION" || -z "$PATH_PART" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --function <lambda-name> --path </route> [--query \"k=v\"]" >&2
	echo "Example: $0 --stage staging --profile staging --function staging-orders-v2-list-orders --path /orders --query \"status=OPEN\"" >&2
	exit 1
fi

FUNCTION_ARN=$(aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
	--function-name "$FUNCTION" --query 'FunctionArn' --output text)

echo "Looking for the API Gateway REST API and resource that invokes: ${FUNCTION_ARN}" >&2

FOUND=0
for API_ID in $(aws apigateway get-rest-apis --profile "$PROFILE" --region "$REGION" \
		--query 'items[].id' --output text); do
	MATCH=$(aws apigateway get-resources --profile "$PROFILE" --region "$REGION" \
		--rest-api-id "$API_ID" \
		--query "items[?path=='${PATH_PART}'].id" --output text 2>/dev/null || true)
	if [[ -n "$MATCH" ]]; then
		# Confirm this resource's method actually targets the function before trusting the path match.
		for HTTP_METHOD in GET POST; do
			URI=$(aws apigateway get-method --profile "$PROFILE" --region "$REGION" \
				--rest-api-id "$API_ID" --resource-id "$MATCH" --http-method "$HTTP_METHOD" \
				--query 'methodIntegration.uri' --output text 2>/dev/null || true)
			if [[ "$URI" == *"$FUNCTION_ARN"* ]]; then
				echo "Match: api-id=${API_ID} resource-id=${MATCH} method=${HTTP_METHOD}" >&2
				REST_API_ID="$API_ID"
				RESOURCE_ID="$MATCH"
				METHOD="$HTTP_METHOD"
				FOUND=1
				break 2
			fi
		done
	fi
done

if [[ "$FOUND" -ne 1 ]]; then
	echo "No API Gateway method found targeting ${FUNCTION_ARN} at path ${PATH_PART}." >&2
	exit 1
fi

echo "Invoking (this is a real call to the lambda, not a log read): GET ${PATH_PART}?${QUERYSTRING}" >&2

RESULT=$(mktemp)
aws apigateway test-invoke-method --profile "$PROFILE" --region "$REGION" \
	--rest-api-id "$REST_API_ID" --resource-id "$RESOURCE_ID" --http-method "$METHOD" \
	--path-with-query-string "${PATH_PART}?${QUERYSTRING}" --output json > "$RESULT"

python3 - "$RESULT" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    result = json.load(fh)

print("HTTP status:", result.get("status"))

body_raw = result.get("body", "")
try:
    body = json.loads(body_raw)
except json.JSONDecodeError:
    print("Body (not JSON):", body_raw[:500])
    sys.exit(0)

if not isinstance(body, dict) or "orders" not in body:
    print("Body:", json.dumps(body)[:1000])
    sys.exit(0)

for key, value in body.items():
    if key != "orders":
        print(f"{key}: {value}")

SAFE_FIELDS = ["id", "origin", "originId", "store", "cin7Id", "status", "orderType", "warehouse"]
orders = body.get("orders", [])
print(f"orders returned this page: {len(orders)}")
for order in orders:
    safe = {k: order.get(k) for k in SAFE_FIELDS if k in order}
    print(safe)
PY
