#!/usr/bin/env bash
# Reads FunctionName, LastModified, CodeSha256 and Version for the six outbound-chain functions
# plus the poller, as a table.
#
# Ticket:       BUSY-1161
# Cases:        Slice 01 Gate A
# Asserts:      each named function exists and captures its deploy identity
# Does NOT:     prove the deployed code is correct, only that it exists and when it last changed.
#               Does not check log recency or compare against an expected deploy date.
# Side effects: read only
#
# Usage: ./check-outbound-chain-deploy.sh --stage <stage> --profile <profile> [--region <region>]
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
	echo "Example: $0 --stage staging --profile staging" >&2
	exit 1
fi

FUNCS=(
	"${STAGE}-orders-cin7-so-poller"
	"${STAGE}-orders-cin7-create-outbound-order"
	"${STAGE}-orders-cin7-update-outbound-order"
	"${STAGE}-orders-cin7-cancel-outbound-order"
	"${STAGE}-shipping-inbound-outbound-order-bridge"
	"${STAGE}-shipping-inbound-materialise-outbound-shipment"
	"${STAGE}-shipping-manhattan-send-outbound-shipment"
)

printf '%-55s | %-30s | %-70s | %s\n' "FunctionName" "LastModified" "CodeSha256" "Version"
for f in "${FUNCS[@]}"; do
	result=$(aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
		--function-name "$f" --query "[LastModified,CodeSha256,Version]" --output text 2>&1) || {
		printf '%-55s | ERROR | %s\n' "$f" "$result"
		continue
	}
	read -r last_modified code_sha version <<< "$result"
	printf '%-55s | %-30s | %-70s | %s\n' "$f" "$last_modified" "$code_sha" "$version"
done
