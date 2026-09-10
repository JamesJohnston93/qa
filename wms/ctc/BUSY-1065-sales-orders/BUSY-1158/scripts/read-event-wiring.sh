#!/usr/bin/env bash
# Enumerates every subscriber on the order and native shipment event types: EventBridge rules and
# targets on both buses, lambda event source mappings, table streams, and SNS fan-out from any rule
# target that turns out to be a topic.
#
# Ticket:      BUSY-1158
# Cases:       TC4c
# Asserts:     the full subscriber list on these event types, so it can be diffed against the LLD
#              audit table and against what check-ctc-consumer-guards.sh currently checks
# Does NOT:    say whether any subscriber has a CTC stance, or whether that stance is correct. It is
#              an inventory, not a guard check. Pair with check-ctc-consumer-guards.sh and a manual
#              log read for the guard-shape question (TC6b).
# Side effects: read only
#
# Usage: ./read-event-wiring.sh --stage <stage> --profile <profile> [--region <region>]
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

ORDERS_BUS="${STAGE}-orders-v2-event-bus"
SHIPPING_BUS="${STAGE}-shipping-v2-event-bus"

TARGET_ARNS_FILE=$(mktemp)
trap 'rm -f "$TARGET_ARNS_FILE"' EXIT

echo "=== EventBridge rules and targets ==="
for BUS in "$ORDERS_BUS" "$SHIPPING_BUS"; do
	echo
	echo "--- bus: $BUS ---"
	RULES_JSON=$(aws events list-rules --event-bus-name "$BUS" --profile "$PROFILE" --region "$REGION" --output json)
	while read -r RULE; do
		[[ -z "$RULE" ]] && continue
		DETAIL_TYPES=$(echo "$RULES_JSON" | jq -r --arg r "$RULE" '
			.Rules[] | select(.Name==$r) | .EventPattern as $p
			| (try ($p | fromjson | .["detail-type"] // ["(any, no detail-type filter)"] | join(",")) catch "(unparsed pattern)")')
		TARGETS_JSON=$(aws events list-targets-by-rule --rule "$RULE" --event-bus-name "$BUS" --profile "$PROFILE" --region "$REGION" --output json)
		echo "$TARGETS_JSON" | jq -r '.Targets[].Arn' >> "$TARGET_ARNS_FILE"
		echo "$TARGETS_JSON" | jq -r --arg rule "$RULE" --arg dt "$DETAIL_TYPES" '
			if (.Targets | length) == 0 then
				[$rule, $dt, "(no targets)"] | @tsv
			else
				.Targets[] | [$rule, $dt, .Arn] | @tsv
			end'
	done < <(echo "$RULES_JSON" | jq -r '.Rules[].Name')
done

echo
echo "=== Lambda event source mappings (queue or stream driven, not a rule target) ==="
aws lambda list-event-source-mappings --profile "$PROFILE" --region "$REGION" --output json \
	| jq -r '.EventSourceMappings[] | [.FunctionArn, .EventSourceArn, .State] | @tsv'

echo
echo "=== Table streams ==="
for TABLE in "${STAGE}-orders-v2" "${STAGE}-shipments"; do
	ARN=$(aws dynamodb describe-table --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" \
		--query 'Table.LatestStreamArn' --output text 2>/dev/null || echo "NOTFOUND")
	echo "${TABLE} -> ${ARN}"
done

echo
echo "=== SNS topics seen as a rule target above ==="
TOPIC_ARNS=$(grep ':sns:' "$TARGET_ARNS_FILE" | sort -u || true)
if [[ -z "$TOPIC_ARNS" ]]; then
	echo "(none found among the targets above)"
else
	while read -r TOPIC_ARN; do
		[[ -z "$TOPIC_ARN" ]] && continue
		echo "--- topic: ${TOPIC_ARN} ---"
		aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --profile "$PROFILE" --region "$REGION" --output json \
			| jq -r '.Subscriptions[] | [.Protocol, .Endpoint] | @tsv'
	done <<< "$TOPIC_ARNS"
fi
