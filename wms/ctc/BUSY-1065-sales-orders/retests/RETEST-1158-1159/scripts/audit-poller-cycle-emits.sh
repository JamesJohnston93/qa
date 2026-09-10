#!/usr/bin/env bash
# Reads every "Pushed ... to EventBridge" line and the Cin7SOPollerCycleComplete summary from one
# SO poller invocation window, and prints only the non-PII fields per emitted order: origin,
# orderId, messageGroupId (and whether it matches orderId, for TC16), packingBrand, sourceStage,
# and lastEmittedPayloadHash. Built because the raw log line is NOT safe to print or dump: the
# Detail payload carries customerEmail, firstName, lastName and the full shipping address in the
# clear (see finding in results/R13-fresh-data-verification.md -- this log group,
# /aws/lambda/{stage}-orders-cin7-so-poller, was not previously named in
# CTC-customer-data-in-cloudwatch.md alongside faulty-sale-worker-queue-handler and the dc-packing
# workers, and should be).
#
# Ticket:      RETEST-1158-1159
# Slice:       R13, S2
# Asserts:     which references were actually emitted (CREATE_TRANSACTION pushed to EventBridge)
#              in a given window, their sourceStage/orderType/packingBrand at emit time, whether
#              messageGroupId equals orderId (TC16), and whether lastEmittedPayloadHash is present
#              on the emitted payload (does not check whether it was PERSISTED onto the order row
#              afterwards -- that needs a separate DynamoDB read, by design, since this script never
#              touches AWS state, only CloudWatch Logs).
# Does NOT:    print or return customerEmail, firstName, lastName, street1, city or postalCode at
#              any point, even internally -- those capture groups are never extracted. Does NOT
#              cover skipped/echoed/cancelled orders, only ones that were actually created this
#              invocation (skips never get a per-order log line, only an aggregate counter).
# Side effects: read only (CloudWatch Logs filter-log-events).
#
# Usage: ./audit-poller-cycle-emits.sh --stage <stage> --profile <profile> \
#          --start-time <epoch-ms> --end-time <epoch-ms>
set -euo pipefail

STAGE=""
PROFILE=""
START_TIME=""
END_TIME=""
REGION="ap-southeast-2"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--start-time) START_TIME="$2"; shift 2 ;;
		--end-time) END_TIME="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$START_TIME" || -z "$END_TIME" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --start-time <epoch-ms> --end-time <epoch-ms>" >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
	--log-group-name "/aws/lambda/${STAGE}-orders-cin7-so-poller" \
	--start-time "$START_TIME" --end-time "$END_TIME" \
	--output json > "${WORKDIR}/events.json"

python3 -c "
import json, re
data = json.load(open('${WORKDIR}/events.json'))
print('Emitted orders (safe fields only, no PII extracted):')
for ev in data['events']:
    msg = ev['message']
    origin = re.search(r'origin\\\\?\":\\\\?\"(CTC#CIN7_SO#[\w-]+)', msg)
    if not origin:
        continue
    order_id = re.search(r'orderId\\\\?\":\\\\?\"([a-f0-9-]+)', msg)
    mgid = re.search(r'message_group_id\\\\?\":\\\\?\"([a-f0-9-]+)', msg)
    stage = re.search(r'sourceStage\\\\?\":\\\\?\"([A-Za-z ]+)', msg)
    otype = re.search(r'orderType\\\\?\":\\\\?\"([A-Z]+)', msg)
    brand = re.search(r'packingBrand\\\\?\":\\\\?\"([A-Za-z0-9]+)', msg)
    payhash = re.search(r'lastEmittedPayloadHash\\\\?\":\\\\?\"([a-f0-9]+)', msg)
    oid = order_id.group(1) if order_id else None
    mg = mgid.group(1) if mgid else None
    print(f'  origin={origin.group(1)} orderType={otype.group(1) if otype else None} '
          f'sourceStage={stage.group(1) if stage else None} packingBrand={brand.group(1) if brand else None} '
          f'messageGroupId==orderId={mg==oid if mg and oid else None} '
          f'lastEmittedPayloadHash={payhash.group(1) if payhash else \"ABSENT\"}')

print()
print('Cycle summary line(s):')
for ev in data['events']:
    if 'Cin7SOPollerCycleComplete' in ev['message'] or 'Cin7PollerCycleStart' in ev['message']:
        print(' ', ev['message'])
"
