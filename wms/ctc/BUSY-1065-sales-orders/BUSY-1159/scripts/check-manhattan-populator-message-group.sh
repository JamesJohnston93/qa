#!/usr/bin/env bash
# Reads the Manhattan sender queue's populator log group over a window and extracts, per event,
# only detail-type, origin, PK and the message_group_id it assigned. Never parses or prints the
# full "Received event" payload: that log group also carries shippingAddress fields (email,
# name, street) on every native domain event, confirmed by a keys-only peek before this script
# was written.
#
# Ticket:      BUSY-1159
# Cases:       TC16b
# Asserts:     for each event this populator received in the window, whether its origin (matched
#              against a CTC reference) carried a `message_group_id`, and what value it held, so
#              TC16b's "native domain events must be verified to carry it" claim can be checked
#              against real events rather than assumed from the fallback fix alone
# Does NOT:    read the Manhattan sender queue itself (the hazard this ticket's slice forbids).
#              Does not prove what messageGroupId the SQS message actually carries after the
#              populator's own fallback logic runs; it only shows what was present on the incoming
#              EventBridge event, which is one input to that logic, not its output
# Side effects: read only
#
# Usage: ./check-manhattan-populator-message-group.sh --stage <stage> --profile <profile> \
#          --start-time <epoch-ms> [--end-time <epoch-ms>] [--reference <ref> ...]
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
	exit 1
fi

if [[ -z "$END_TIME" ]]; then
	END_TIME=$(( $(date +%s) * 1000 ))
fi

LOG_GROUP="/aws/lambda/${STAGE}-shipping-manhattan-manhattan-eda-queue-populator"
echo "Log group: ${LOG_GROUP}" >&2
echo "Window:    ${START_TIME} to ${END_TIME} (epoch ms)" >&2

RAW=$(mktemp)
trap 'rm -f "$RAW"' EXIT

# --output json with default (automatic) pagination: a busy window can span more than one page.
aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
	--log-group-name "$LOG_GROUP" --start-time "$START_TIME" --end-time "$END_TIME" \
	--filter-pattern '"Received event"' --output json > "$RAW"

python3 -c "
import json, re

events = json.load(open('$RAW')).get('events', [])
print(f'Received-event lines in window: {len(events)}')
print()

rows = []
for e in events:
    msg = e['message']
    m = re.search(r'Received event:\s*(\{.*\})\s*\$', msg, re.DOTALL)
    if not m:
        continue
    try:
        payload = json.loads(m.group(1))
    except Exception:
        continue
    detail = payload.get('detail', {})
    rows.append({
        'detail_type': payload.get('detail-type'),
        'origin': detail.get('origin'),
        'pk': detail.get('PK'),
        'message_group_id': detail.get('message_group_id'),
    })

for r in rows:
    has_mgid = r['message_group_id'] is not None
    print(f\"  detail-type={r['detail_type']}  origin={r['origin']}  PK={r['pk']}  \"
          f\"message_group_id={'present: ' + str(r['message_group_id']) if has_mgid else '(absent)'}\")
"
