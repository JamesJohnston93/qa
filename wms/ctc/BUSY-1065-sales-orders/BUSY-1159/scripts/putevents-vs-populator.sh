#!/usr/bin/env bash
# Compares the SO poller's own "Pushed {...}" PutEvents log lines against the eda-queue-populator's
# "Received event" log lines for the same window, matched by idempotencyId, so a shortfall (an
# order the poller says it pushed that the populator never logged receiving) shows up directly
# from evidence instead of an inference from counts alone.
#
# Ticket:      BUSY-1159
# Cases:       TC22 (Gate B, slice 10)
# Asserts:     every idempotencyId the poller logged pushing in the window also appears in a
#              "Received event" line at the populator, sourced from this poller, in the same window
# Does NOT:    prove the code checks the PutEvents response. A clean match only shows the risk is
#              latent, not that a failed entry would be caught; that needs the forced test in
#              slice 10's write half. Also does not cover event types other than CREATE_TRANSACTION
#              (this ticket only implements create), and only checks what CloudWatch has retained.
# Side effects: read only
#
# Usage: ./putevents-vs-populator.sh --stage <stage> --profile <profile> --start-time <epoch-ms> [--end-time <epoch-ms>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
START_TIME=""
END_TIME=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--start-time) START_TIME="$2"; shift 2 ;;
		--end-time) END_TIME="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$START_TIME" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --start-time <epoch-ms> [--end-time <epoch-ms>]" >&2
	echo "Example: $0 --stage staging --profile staging --start-time 1787809133409" >&2
	exit 1
fi

if [[ -z "$END_TIME" ]]; then
	END_TIME=$(( $(date +%s) * 1000 ))
fi

POLLER_LOG="/aws/lambda/${STAGE}-orders-cin7-so-poller"
POPULATOR_LOG="/aws/lambda/${STAGE}-orders-v2-eda-queue-populator"

echo "Poller log:     ${POLLER_LOG}" >&2
echo "Populator log:  ${POPULATOR_LOG}" >&2
echo "Window:         ${START_TIME} to ${END_TIME} (epoch ms)" >&2

PUSHED_FILE=$(mktemp)
RECEIVED_FILE=$(mktemp)
trap 'rm -f "$PUSHED_FILE" "$RECEIVED_FILE"' EXIT

# --output json with default (automatic) pagination, no --limit and no --no-paginate: filter-log-events
# can span more than one underlying page in a busy window, and capping to one page under-counts real
# matches (see TOOL-NOTES.md, the check-ctc-consumer-guards.sh false-FAIL fix). Written to temp files
# rather than shell variables: log lines can carry arbitrary customer text, unsafe to interpolate
# straight into a python -c string.
aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
	--log-group-name "$POLLER_LOG" --start-time "$START_TIME" --end-time "$END_TIME" \
	--filter-pattern '"Pushed"' --output json > "$PUSHED_FILE"

aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
	--log-group-name "$POPULATOR_LOG" --start-time "$START_TIME" --end-time "$END_TIME" \
	--filter-pattern '"cin7-so-poller.lambda" "Received event"' --output json > "$RECEIVED_FILE"

python3 -c "
import json, re, sys

pushed = json.load(open('$PUSHED_FILE'))['events']
received = json.load(open('$RECEIVED_FILE'))['events']

def ids(events):
    out = []
    for e in events:
        for m in re.finditer(r'idempotencyId\\\\?\":\\\\?\"([^\"\\\\\\\\]+)', e['message']):
            out.append(m.group(1))
    return out

pushed_ids = ids(pushed)
received_ids = ids(received)

pushed_set = set(pushed_ids)
received_set = set(received_ids)

print(f'Pushed lines (poller):        {len(pushed)}')
print(f'idempotencyIds in pushed:     {len(pushed_ids)} ({len(pushed_set)} distinct)')
print(f'Received lines (populator):   {len(received)}')
print(f'idempotencyIds in received:   {len(received_ids)} ({len(received_set)} distinct)')
print()

missing = pushed_set - received_set
extra = received_set - pushed_set

if missing:
    print(f'SHORTFALL: {len(missing)} idempotencyId(s) pushed but never seen received:')
    for i in sorted(missing):
        print(f'  {i}')
else:
    print('No shortfall: every pushed idempotencyId also appears received in this window.')

if extra:
    print(f'{len(extra)} idempotencyId(s) received but not pushed in this window (window edge, not a shortfall):')
    for i in sorted(extra):
        print(f'  {i}')
"
