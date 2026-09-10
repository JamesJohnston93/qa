#!/usr/bin/env bash
# Reads every rule on an EventBridge bus and prints its event pattern and targets verbatim, so a
# synthetic transaction's routing contract can be confirmed from the rule rather than assumed.
#
# Ticket:      BUSY-1160
# Cases:       Slice 01 Gate B
# Asserts:     the exact event pattern (detail-type, source, or any other filtered field) and the
#              full target list for every rule on the given bus
# Does NOT:    prove a target Lambda accepts what routes to it. EventBridge routing on detail-type
#              does not mean the receiving handler skips its own validation of source or other
#              fields; that needs a code read or a captured real invocation.
# Side effects: read only
#
# Usage: ./check-bus-routing-contract.sh --stage <stage> --profile <profile> --bus <event-bus-name> [--region <region>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
BUS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--bus) BUS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$BUS" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --bus <event-bus-name> [--region <region>]" >&2
	echo "Example: $0 --stage staging --profile staging --bus staging-orders-v2-event-bus" >&2
	exit 1
fi

RULE_NAMES=$(aws events list-rules --profile "$PROFILE" --region "$REGION" \
	--event-bus-name "$BUS" --query "Rules[].Name" --output text)

for r in $RULE_NAMES; do
	echo "=== $r ==="
	aws events describe-rule --profile "$PROFILE" --region "$REGION" \
		--event-bus-name "$BUS" --name "$r" --query "EventPattern" --output text
	aws events list-targets-by-rule --profile "$PROFILE" --region "$REGION" \
		--event-bus-name "$BUS" --rule "$r" --query "Targets[].Arn" --output text
	echo
done
