#!/usr/bin/env bash
# Captures one poller cycle's summary counters and one order's Manhattan send outcome, for the
# TC1 family (unattended create, replay, second-sighting). Prints structured fields only, never
# the raw XML body, so its output is safe to paste into a result file as-is.
#
# Ticket:      BUSY-1159
# Cases:       TC1, TC1b, TC3, TC4
# Asserts:     what the SO poller's cycle-complete line and the sender's outcome line say
#              about one reference, in one time window
# Does NOT:    prove the order is correct end to end. Pair with inspect-ctc-order.sh for the
#              stamp-level checks (TC2, TC8), and with check-latency.sh for TC1b's gap
# Side effects: read only
#
# Usage: ./capture-tc1-evidence.sh --stage <stage> --profile <profile> --reference <ref> --after <epoch-ms>
#   --reference is the normalised reference, no leading '#'
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
REFERENCE=""
AFTER=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		--after) AFTER="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFERENCE" || -z "$AFTER" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --reference <ref> --after <epoch-ms>" >&2
	echo "Example: $0 --stage staging --profile staging --reference 261115 --after 1787874000000" >&2
	exit 1
fi

REFERENCE="${REFERENCE#\#}"
POLLER_LOG="/aws/lambda/${STAGE}-orders-cin7-so-poller"
SENDER_LOG="/aws/lambda/${STAGE}-shipping-manhattan-send-shipment"

echo "=== poller cycle-complete events since ${AFTER} ==="
aws logs filter-log-events --log-group-name "$POLLER_LOG" \
	--profile "$PROFILE" --region "$REGION" \
	--start-time "$AFTER" \
	--filter-pattern '{ $.metric = "Cin7SOPollerCycleComplete" }' \
	--query 'events[].message' --output text 2>/dev/null

echo
echo "=== sender outcome for reference ${REFERENCE} since ${AFTER} ==="
aws logs filter-log-events --log-group-name "$SENDER_LOG" \
	--profile "$PROFILE" --region "$REGION" \
	--start-time "$AFTER" \
	--filter-pattern "{ \$.metric = \"ManhattanRequestOutcome\" && \$.reference = \"${REFERENCE}\" }" \
	--query 'events[].message' --output text 2>/dev/null

echo
echo "=== any hard error or rejection lines mentioning ${REFERENCE} since ${AFTER} (redacted-safe: metric/error lines only, no XML) ==="
aws logs filter-log-events --log-group-name "$SENDER_LOG" \
	--profile "$PROFILE" --region "$REGION" \
	--start-time "$AFTER" \
	--filter-pattern "\"${REFERENCE}\"" \
	--query 'events[].message' --output text 2>/dev/null \
	| grep -E "ERROR|does not exist|Permanent failure|ManhattanRejectionError" || echo "(none)"
