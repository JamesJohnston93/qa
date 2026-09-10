#!/usr/bin/env bash
# Polls the SO poller's log group until a Cin7SOPollerCycleComplete event newer than --after
# appears, then prints every such event found and exits 0. Exists so TC1/TC3/TC4 style cases
# can wait for "the next scheduled cycle" without a manual invoke, which would invalidate them.
#
# Ticket:      BUSY-1159
# Cases:       TC1, TC3, TC4
# Asserts:     a poller cycle completed after the given time, nothing about its content
# Does NOT:    check what the cycle did. Read the printed event, or pipe reference into
#              capture-tc1-evidence.sh, to see created/skipped counts and per-order outcome
# Side effects: read only
#
# Usage: ./wait-for-so-cycle.sh --stage <stage> --profile <profile> --after <epoch-ms> [--timeout-seconds 300] [--poll-seconds 15]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
AFTER=""
TIMEOUT_SECONDS=300
POLL_SECONDS=15

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--after) AFTER="$2"; shift 2 ;;
		--timeout-seconds) TIMEOUT_SECONDS="$2"; shift 2 ;;
		--poll-seconds) POLL_SECONDS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$AFTER" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --after <epoch-ms> [--timeout-seconds N] [--poll-seconds N]" >&2
	echo "Example: $0 --stage staging --profile staging --after 1787873700000" >&2
	exit 1
fi

LOG_GROUP="/aws/lambda/${STAGE}-orders-cin7-so-poller"
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))

echo "Waiting for a Cin7SOPollerCycleComplete event after epoch-ms ${AFTER} in ${LOG_GROUP} (timeout ${TIMEOUT_SECONDS}s)" >&2

while true; do
	EVENTS=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" \
		--profile "$PROFILE" --region "$REGION" \
		--start-time "$AFTER" \
		--filter-pattern '{ $.metric = "Cin7SOPollerCycleComplete" }' \
		--query 'events[].message' --output text 2>/dev/null || true)

	if [[ -n "$EVENTS" && "$EVENTS" != "None" ]]; then
		echo "$EVENTS"
		exit 0
	fi

	if (( $(date +%s) >= DEADLINE )); then
		echo "Timed out after ${TIMEOUT_SECONDS}s with no cycle-complete event after ${AFTER}." >&2
		exit 1
	fi

	sleep "$POLL_SECONDS"
done
