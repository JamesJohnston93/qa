#!/usr/bin/env bash
# Prints message counts for the Manhattan sync queues, CloudWatch alarm states, and the
# dashboard URL, in the given stage.
# Since the stack went store-independent (one shared buffer/sender for both us and ps), each
# store gets its own enrich-worker queue+DLQ+alarms, but there's only one shared buffer
# queue+DLQ+alarm and one shared dashboard/alert topic total (Task 5 / BUSY-1048).
# Usage: ./check-status.sh --stage <stage> --profile <profile> [--store <us|ps>]
# With no --store, checks both stores' enrich queues/alarms plus the shared buffer/dashboard.
set -euo pipefail

ALL_STORES=(us ps)

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
STORE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--store <us|ps>] [--region <region>]" >&2
	echo "Example: $0 --stage staging --profile staging" >&2
	echo "Example (one store's enrich queue only): $0 --stage staging --profile staging --store us" >&2
	exit 1
fi

if [[ -n "$STORE" && "$STORE" != "us" && "$STORE" != "ps" ]]; then
	echo "--store must be 'us' or 'ps' — got: $STORE" >&2
	exit 1
fi

STORES_TO_CHECK=("${ALL_STORES[@]}")
[[ -n "$STORE" ]] && STORES_TO_CHECK=("$STORE")

QUEUES=()
for s in "${STORES_TO_CHECK[@]}"; do
	QUEUES+=(
		"${STAGE}-catalog-manhattan-${s}-item-eda-queue.fifo"
		"${STAGE}-catalog-manhattan-${s}-item-eda-dlq.fifo"
	)
done
# Shared between both stores — checked once regardless of --store.
QUEUES+=(
	"${STAGE}-catalog-manhattan-item-buffer-buffer.fifo"
	"${STAGE}-catalog-manhattan-item-buffer-dlq.fifo"
)

echo "Manhattan sync queue status — stage: $STAGE"
echo "--------------------------------------------------"

for queue in "${QUEUES[@]}"; do
	url=$(aws sqs get-queue-url --profile "$PROFILE" --region "$REGION" \
		--queue-name "$queue" --query "QueueUrl" --output text 2>/dev/null) || {
		echo "$queue: NOT FOUND (has this stage been deployed?)"
		continue
	}

	attrs=$(aws sqs get-queue-attributes --profile "$PROFILE" --region "$REGION" \
		--queue-url "$url" \
		--attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
		--output json)

	visible=$(echo "$attrs" | python3 -c "import json,sys; print(json.load(sys.stdin)['Attributes']['ApproximateNumberOfMessages'])")
	in_flight=$(echo "$attrs" | python3 -c "import json,sys; print(json.load(sys.stdin)['Attributes']['ApproximateNumberOfMessagesNotVisible'])")

	echo "$queue: $visible waiting, $in_flight in-flight (being retried)"
done

echo ""
echo "A clean/idle state before testing looks like: all queues at 0 waiting, 0 in-flight."
echo "Messages in a *-dlq.fifo queue mean an item exhausted all retries — see the README for what that means."

# Task 5 / BUSY-1048: DLQ + validation-failure alarms, one shared dashboard. Not deployed on
# branches before BUSY-1048 — a NOT FOUND result below is expected on those stages.
ALARMS=()
for s in "${STORES_TO_CHECK[@]}"; do
	ALARMS+=(
		"${STAGE}-catalog-manhattan-${s}-enrich-dlq-depth"
		"${STAGE}-catalog-manhattan-${s}-validation-failures"
	)
done
ALARMS+=("${STAGE}-catalog-manhattan-send-dlq-depth")

echo ""
echo "Alarm status:"
echo "--------------------------------------------------"
for alarm in "${ALARMS[@]}"; do
	state=$(aws cloudwatch describe-alarms --profile "$PROFILE" --region "$REGION" \
		--alarm-names "$alarm" --query "MetricAlarms[0].StateValue" --output text 2>/dev/null)
	if [[ -z "$state" || "$state" == "None" ]]; then
		echo "$alarm: NOT FOUND (not deployed on this branch/stage, or stage name mismatch)"
	else
		echo "$alarm: $state"
	fi
done

echo ""
echo "OK/idle is expected — these alarms are deliberately hard to trigger with normal test data"
echo "(the validation-failure alarm needs 11+ genuine failures in 15 minutes; the DLQ alarms need"
echo "10 consecutive throws on the same message). See the README's Task 5 section before trying to"
echo "force one — deliberately breaking the OAuth secret or IAM to trigger a DLQ alarm affects"
echo "every store's sends, not just the one you're testing."
echo ""
echo "Dashboard: https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=${STAGE}-catalog-manhattan-dashboard"
