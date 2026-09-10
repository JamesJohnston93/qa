#!/usr/bin/env bash
# Reads LastModified for the BUSY-1160 order-handler functions and flags any that miss the deploy date.
#
# Ticket:      BUSY-1160
# Cases:       Slice 01 Gate A
# Asserts:     which of the poller, the update/cancel reconciliation handlers, their eda-queue
#              handler/populator pairs, and list-orders carry a given deploy's LastModified timestamp
# Does NOT:    prove the deployed code is correct, only that it was deployed on the expected date.
#              Does not check log recency, use check-cin7-log-recency.sh for that.
# Side effects: read only
#
# Usage: ./check-cin7-order-handler-deploy.sh --stage <stage> --profile <profile> --expect-date <YYYY-MM-DD> [--region <region>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
EXPECT_DATE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--expect-date) EXPECT_DATE="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$EXPECT_DATE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --expect-date <YYYY-MM-DD> [--region <region>]" >&2
	echo "Example: $0 --stage staging --profile staging --expect-date 2026-09-03" >&2
	exit 1
fi

FUNCS=(
	"${STAGE}-orders-cin7-so-poller"
	"${STAGE}-orders-cin7-update-order"
	"${STAGE}-orders-cin7-update-order-eda-queue-handler"
	"${STAGE}-orders-cin7-update-order-eda-queue-populator"
	"${STAGE}-orders-cin7-cancel-order"
	"${STAGE}-orders-cin7-cancel-order-eda-queue-handler"
	"${STAGE}-orders-cin7-cancel-order-eda-queue-populator"
	"${STAGE}-orders-v2-list-orders"
)

for f in "${FUNCS[@]}"; do
	last_modified=$(aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
		--function-name "$f" --query "LastModified" --output text 2>&1) || {
		echo "$f | ERROR | $last_modified"
		continue
	}
	if [[ "$last_modified" == "$EXPECT_DATE"* ]]; then
		echo "$f | MATCH | $last_modified"
	else
		echo "$f | MISMATCH | $last_modified"
	fi
done
