#!/usr/bin/env bash
# Reads LastModified, CodeSha256 and Version for every function across the native, shared and
# outbound chains, so a changed-component table can be built against a recorded baseline.
#
# Ticket:      RETEST-POST-1161
# Cases:       R0 Gate A
# Asserts:     which functions carry a LastModified different from a given baseline date, and the
#              CodeSha256/Version recorded at read time, for later comparison against a specific
#              baseline file
# Does NOT:    prove the deployed code is correct, only that it was (or was not) redeployed since
#              the given baseline date. Does not diff code content; a same-day redeploy with no
#              functional change would still show as changed here.
# Side effects: read only
#
# Usage: ./check-full-chain-deploy.sh --stage <stage> --profile <profile> --baseline-date <YYYY-MM-DD> [--region <region>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
BASELINE_DATE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--baseline-date) BASELINE_DATE="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$BASELINE_DATE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --baseline-date <YYYY-MM-DD> [--region <region>]" >&2
	echo "Example: $0 --stage staging --profile staging --baseline-date 2026-09-03" >&2
	exit 1
fi

FUNCS=(
	# native chain
	"${STAGE}-orders-cin7-so-poller"
	"${STAGE}-orders-v2-eda-queue-populator"
	"${STAGE}-orders-v2-eda-queue-handler"
	"${STAGE}-orders-cin7-update-order"
	"${STAGE}-orders-cin7-update-order-eda-queue-populator"
	"${STAGE}-orders-cin7-update-order-eda-queue-handler"
	"${STAGE}-orders-cin7-cancel-order"
	"${STAGE}-orders-cin7-cancel-order-eda-queue-populator"
	"${STAGE}-orders-cin7-cancel-order-eda-queue-handler"
	"${STAGE}-orders-v2-list-orders"
	"${STAGE}-shipping-manhattan-send-shipment"
	# shared handler, the one that matters most
	"${STAGE}-orders-v2-create-transaction"
	# outbound chain
	"${STAGE}-orders-cin7-create-outbound-order"
	"${STAGE}-orders-cin7-outbound-orders-eda-queue-populator"
	"${STAGE}-orders-cin7-outbound-orders-eda-queue-handler"
	"${STAGE}-shipping-inbound-outbound-order-bridge"
	"${STAGE}-shipping-inbound-outbound-bridge-eda-queue-handler"
	"${STAGE}-shipping-v2-create-transaction"
	"${STAGE}-shipping-manhattan-send-outbound-shipment"
	# consumers BUSY-1158 measured
	"${STAGE}-shipping-v2-dc-packing-shipment-create"
	"${STAGE}-shipping-v2-generate-pickslip"
	"${STAGE}-faulty-sale-worker-queue-handler"
	"${STAGE}-inventory-check-order-faulty-sale"
)

printf '%s|%s|%s|%s|%s\n' "Function" "LastModified" "MatchesBaseline" "CodeSha256" "Version"
for f in "${FUNCS[@]}"; do
	out=$(aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
		--function-name "$f" \
		--query "[LastModified,CodeSha256,Version]" --output text 2>&1) || {
		printf '%s|NOT_FOUND|-|-|-\n' "$f"
		continue
	}
	last_modified=$(echo "$out" | awk '{print $1}')
	code_sha=$(echo "$out" | awk '{print $2}')
	version=$(echo "$out" | awk '{print $3}')
	if [[ "$last_modified" == "$BASELINE_DATE"* ]]; then
		match="SAME_DAY_AS_BASELINE"
	else
		match="DIFFERENT"
	fi
	printf '%s|%s|%s|%s|%s\n' "$f" "$last_modified" "$match" "$code_sha" "$version"
done
