#!/usr/bin/env bash
# Reads the last log event timestamp for the BUSY-1160 order-handler log groups, so a silent
# handler can be told apart from one that has simply not been invoked yet.
#
# Ticket:      BUSY-1160
# Cases:       Slice 01 Gate A
# Asserts:     when each handler's log group last received an event, or that it does not exist yet
# Does NOT:    explain WHY a log group is silent. A missing watermark or a disabled schedule can
#              produce exactly this result with no handler defect at all; check those separately
#              before reading silence as a problem.
# Side effects: read only
#
# Usage: ./check-cin7-log-recency.sh --stage <stage> --profile <profile> [--region <region>]
set -uo pipefail

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
	"${STAGE}-orders-cin7-update-order"
	"${STAGE}-orders-cin7-update-order-eda-queue-handler"
	"${STAGE}-orders-cin7-update-order-eda-queue-populator"
	"${STAGE}-orders-cin7-cancel-order"
	"${STAGE}-orders-cin7-cancel-order-eda-queue-handler"
	"${STAGE}-orders-cin7-cancel-order-eda-queue-populator"
	"${STAGE}-orders-v2-list-orders"
)

for f in "${FUNCS[@]}"; do
	lg="/aws/lambda/$f"
	# stdout and stderr are captured separately and the exit code checked explicitly. Merging them
	# with 2>&1 into one pipe raced on buffering in an earlier version of this script and let a
	# ResourceNotFoundException on stderr lose to a stray "None" on stdout, misreporting a missing
	# log group as an empty one.
	err_file=$(mktemp)
	result=$(aws logs describe-log-streams --profile "$PROFILE" --region "$REGION" \
		--log-group-name "$lg" --order-by LastEventTime --descending --max-items 1 \
		--query "logStreams[0].lastEventTimestamp" --output text 2>"$err_file" | head -n1)
	exit_code=${PIPESTATUS[0]}
	err=$(cat "$err_file")
	rm -f "$err_file"
	if [[ $exit_code -ne 0 ]]; then
		if [[ "$err" == *"ResourceNotFoundException"* ]]; then
			echo "$lg | NO LOG GROUP"
		else
			echo "$lg | ERROR | $err"
		fi
	elif [[ "$result" == "None" || -z "$result" ]]; then
		echo "$lg | LOG GROUP EMPTY, no streams"
	else
		# lastEventTimestamp is epoch millis
		iso=$(python3 -c "import datetime,sys; print(datetime.datetime.utcfromtimestamp(int(sys.argv[1])/1000).isoformat()+'Z')" "$result")
		echo "$lg | last event $iso"
	fi
done
