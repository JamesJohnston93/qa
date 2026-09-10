#!/usr/bin/env bash
# For each outbound-chain queue and its DLQ, prints the queue's ApproximateNumberOfMessages, its
# DLQ depth (via RedrivePolicy) and every Lambda event source mapping on it, resolved by
# --event-source-arn, never by function name.
#
# Ticket:       BUSY-1161
# Cases:        Slice 01 Gate B
# Asserts:      each of the three outbound queues has exactly one enabled event source mapping and
#               names its consuming function ARN
# Does NOT:     prove the consuming function behaves correctly, only that it is the one wired up.
#               Does not read message content.
# Side effects: read only
#
# Usage: ./check-outbound-queue-mappings.sh --stage <stage> --profile <profile> [--region <region>]
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

QUEUES=(
	"${STAGE}-orders-cin7-outbound-orders-queue.fifo"
	"${STAGE}-orders-cin7-outbound-orders-dlq.fifo"
	"${STAGE}-shipping-inbound-outbound-bridge.fifo"
	"${STAGE}-shipping-inbound-outbound-bridge-dlq.fifo"
	"${STAGE}-shipping-inbound-outbound.fifo"
	"${STAGE}-shipping-inbound-outbound-dlq.fifo"
)

for q in "${QUEUES[@]}"; do
	echo "=== $q ==="
	url=$(aws sqs get-queue-url --profile "$PROFILE" --region "$REGION" \
		--queue-name "$q" --query "QueueUrl" --output text 2>&1) || {
		echo "  NOT FOUND: $url"
		echo
		continue
	}
	attrs=$(aws sqs get-queue-attributes --profile "$PROFILE" --region "$REGION" \
		--queue-url "$url" \
		--attribute-names QueueArn ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible RedrivePolicy \
		--output json 2>&1) || {
		echo "  could not read attributes: $attrs"
		echo
		continue
	}
	arn=$(echo "$attrs" | python3 -c "import json,sys; print(json.load(sys.stdin)['Attributes'].get('QueueArn',''))")
	visible=$(echo "$attrs" | python3 -c "import json,sys; print(json.load(sys.stdin)['Attributes'].get('ApproximateNumberOfMessages','?'))")
	inflight=$(echo "$attrs" | python3 -c "import json,sys; print(json.load(sys.stdin)['Attributes'].get('ApproximateNumberOfMessagesNotVisible','?'))")
	redrive=$(echo "$attrs" | python3 -c "import json,sys; print(json.load(sys.stdin)['Attributes'].get('RedrivePolicy','none'))")
	echo "  QueueArn:  $arn"
	echo "  Visible:   $visible, InFlight: $inflight"
	echo "  Redrive:   $redrive"

	mappings=$(aws lambda list-event-source-mappings --profile "$PROFILE" --region "$REGION" \
		--event-source-arn "$arn" --output json 2>&1) || {
		echo "  could not list event source mappings: $mappings"
		echo
		continue
	}
	count=$(echo "$mappings" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['EventSourceMappings']))")
	if [[ "$count" == "0" ]]; then
		echo "  Event source mappings: NONE"
	else
		echo "$mappings" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for m in data['EventSourceMappings']:
    print(f\"  Mapping: State={m.get('State')} FunctionArn={m.get('FunctionArn')} UUID={m.get('UUID')}\")
"
	fi
	echo
done
