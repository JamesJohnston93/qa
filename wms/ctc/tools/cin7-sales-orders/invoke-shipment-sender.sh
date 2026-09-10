#!/usr/bin/env bash
# Invokes a Manhattan sender with a real record, then prints the redacted XML and the outcome
# lines from its log.
#
# Native (default): invokes the shipment sender directly with a SHIPMENT_CREATED event rebuilt
# from a real shipment row. `create-shipment.ts` emits SHIPMENT_CREATED as the whole shipment
# record plus `message_group_id`, so the stored header row *is* the event payload — nothing here
# reconstructs an intermediate shape that could drift from what the lambda really receives. A
# direct invoke bypasses the EventBridge rule, so the rule's state is irrelevant.
#
# --family outbound: puts a TRANS_OUTBOUND_SHIPMENT_READY on the shipping bus instead of invoking
# anything directly, exercising the real chain the materialiser's own signal takes — the rule, the
# populator (which stamps worker key SEND_OUTBOUND_SHIPMENT), the shared sender queue, and finally
# the outbound sender — against records a save/delete has already materialised. There is
# deliberately no direct-invoke path for the outbound sender: it reads the persisted
# OUTBOUND_SHIPMENT header and lines as its only source of truth, so a directly-built event
# payload would prove nothing an indirect one doesn't already prove more faithfully.
#
# Either way, what decides whether anything reaches Manhattan is the OAuth secret:
#
#   incomplete secret  ->  ManhattanConfigError, no network call        (Gate B — the default)
#   complete secret    ->  a REAL SEND to whatever base_url points at   (Gate C — needs --send)
#
# Usage: ./invoke-shipment-sender.sh --stage <stage> --profile <profile> --reference <ref> [--family native|outbound] [--send]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
REFERENCE=""
FAMILY="native"
SEND="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		--family) FAMILY="$2"; shift 2 ;;
		--send) SEND="true"; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFERENCE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --reference <ref> [--family native|outbound] [--send]" >&2
	echo "Example (Gate B): $0 --stage staging --profile staging --reference 100234" >&2
	echo "Example (outbound): $0 --stage staging --profile staging --reference 982409Aug26 --family outbound" >&2
	exit 1
fi

if [[ "$FAMILY" != "native" && "$FAMILY" != "outbound" ]]; then
	echo "--family must be native or outbound — got '${FAMILY}'." >&2
	exit 1
fi

# The stored origin key carries the normalised reference — the poller strips Cin7's leading '#'.
REFERENCE="${REFERENCE#\#}"
ORIGIN="CTC#CIN7_SO#${REFERENCE}"
SECRET_ID="${STAGE}/manhattan/oauth2"

# The shipments table has no origin index; both families' rows hang off the order's own
# partition key, so every branch below starts by resolving it from the orders table, which does.
ORDER_PK=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "${STAGE}-orders-v2" --index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
	--query 'Items[0].PK.S' --output text)

if [[ -z "$ORDER_PK" || "$ORDER_PK" == "None" ]]; then
	echo "NO_ORDER: nothing in ${STAGE}-orders-v2 for ${ORIGIN}" >&2
	exit 3
fi

if [[ "$FAMILY" == "outbound" ]]; then
	FUNCTION="${STAGE}-shipping-manhattan-send-outbound-shipment"
else
	FUNCTION="${STAGE}-shipping-manhattan-send-shipment"
fi
LOG_GROUP="/aws/lambda/${FUNCTION}"

echo "Family:   ${FAMILY}"
echo "Function: ${FUNCTION}"
echo "Origin:   ${ORIGIN}"

# --- safety: is the credential usable? A usable one means this really sends. ---
SECRET_JSON=$(aws secretsmanager get-secret-value --profile "$PROFILE" --region "$REGION" \
	--secret-id "$SECRET_ID" --query SecretString --output text 2>/dev/null || echo "")

SECRET_STATE=$(python3 -c "
import json, sys
raw = sys.argv[1]
if not raw:
    print('ABSENT'); raise SystemExit
try:
    s = json.loads(raw)
except ValueError:
    print('UNREADABLE'); raise SystemExit
missing = [f for f in ('client_id','client_secret','token_url','base_url') if not s.get(f)]
print('INCOMPLETE:' + ','.join(missing) if missing else 'COMPLETE:' + str(s.get('base_url')))
" "$SECRET_JSON")

echo "Secret:   ${SECRET_STATE}"

if [[ "$SECRET_STATE" == COMPLETE:* ]]; then
	if [[ "$SEND" != "true" ]]; then
		echo >&2
		echo "REFUSED: ${SECRET_ID} is complete, so invoking would perform a REAL SEND to" >&2
		echo "  ${SECRET_STATE#COMPLETE:}" >&2
		echo "Confirm that URL is staging, then re-run with --send." >&2
		exit 1
	fi
	echo >&2
	echo "!! This WILL send to ${SECRET_STATE#COMPLETE:}" >&2
	read -r -p "Type the reference (${REFERENCE}) to send: " TYPED
	[[ "$TYPED" == "$REFERENCE" ]] || { echo "Aborted." >&2; exit 1; }
fi

if [[ "$FAMILY" == "outbound" ]]; then
	# --- confirm the materialised record exists; the sender refuses to send without one ---
	OUTBOUND_PK="$ORDER_PK"
	OUTBOUND_ROWS=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
		--table-name "${STAGE}-shipments" \
		--key-condition-expression 'PK = :pk' \
		--expression-attribute-values "{\":pk\":{\"S\":\"${OUTBOUND_PK}\"}}" \
		--output json)

	python3 -c "
import json, sys
rows = json.loads('''${OUTBOUND_ROWS}''').get('Items', [])

def plain(v):
    (kind, value), = v.items()
    return value

headers = [r for r in rows if plain(r['SK']).startswith('SHIPMENT#')]
lines = [r for r in rows if plain(r['SK']).startswith('OUTBOUND_ITEM#')]
if not headers:
    print('NO_HEADER', file=sys.stderr)
    sys.exit(3)
h = {k: plain(v) for k, v in headers[0].items()}
print(f\"  status={h.get('status')}  company={h.get('company')}  orderType={h.get('orderType')}\"
      f\"  allocateComplete={h.get('allocateComplete')}  lines={len(lines)}\")
print(f\"  sentAt={h.get('sentAt', '(absent)')}\")
"

	echo
	START_MS=$(( $(date +%s) * 1000 ))
	ENTRY=$(python3 -c "
import json
print(json.dumps([{
    'Source': 'testing-tools.invoke-shipment-sender',
    'DetailType': 'TRANS_OUTBOUND_SHIPMENT_READY',
    'EventBusName': '${STAGE}-shipping-v2-event-bus',
    'Detail': json.dumps({
        'PK': '${OUTBOUND_PK}',
        'message_group_id': '${OUTBOUND_PK}',
    }),
}]))
")
	RESULT=$(aws events put-events --profile "$PROFILE" --region "$REGION" \
		--entries "$ENTRY" --output json)
	FAILED=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read())['FailedEntryCount'])" <<<"$RESULT")
	if [[ "$FAILED" != "0" ]]; then
		echo "put-events reported ${FAILED} failed entr(ies):" >&2
		python3 -m json.tool <<<"$RESULT" >&2
		exit 1
	fi
	echo "Published TRANS_OUTBOUND_SHIPMENT_READY for ${OUTBOUND_PK}."

	echo
	echo "Waiting for logs… (this goes through the rule, the populator and the shared sender"
	echo "queue before the outbound sender itself runs, so it lags a direct invoke — re-run the"
	echo "filter below if nothing shows up yet)"
	sleep 15
else
	# --- rebuild the event from the stored header row ---
	ROWS=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
		--table-name "${STAGE}-shipments" \
		--key-condition-expression 'PK = :pk' \
		--expression-attribute-values "{\":pk\":{\"S\":\"${ORDER_PK}\"}}" \
		--output json)

	PAYLOAD=$(mktemp)
	python3 - "$PAYLOAD" <<PY
import json, sys

rows = json.loads('''${ROWS}''').get('Items', [])

def plain(node):
    """DynamoDB JSON -> plain JSON, recursively (packages is a list of maps)."""
    (kind, value), = node.items()
    if kind == 'S':    return value
    if kind == 'N':    return float(value) if '.' in value else int(value)
    if kind == 'BOOL': return value
    if kind == 'NULL': return None
    if kind == 'L':    return [plain(v) for v in value]
    if kind == 'M':    return {k: plain(v) for k, v in value.items()}
    if kind in ('SS', 'NS'): return list(value)
    return None

items = [{k: plain(v) for k, v in row.items()} for row in rows]
# Shipment items copy the order item's SK ('ITEM#<uuid>'); the header's SK is a bare uuid.
headers = [i for i in items if not str(i.get('SK', '')).startswith('ITEM') and 'packages' in i]

if not headers:
    print('NO_HEADER', file=sys.stderr)
    raise SystemExit(3)
if len(headers) > 1:
    print(f'WARN: {len(headers)} header rows matched; using the first', file=sys.stderr)

event = dict(headers[0])
# create-shipment.ts emits {...shipment, message_group_id: shipment.PK}
event['message_group_id'] = event.get('PK')

with open(sys.argv[1], 'w') as fh:
    json.dump(event, fh)

units = sum(len(p.get('shipmentItems', [])) for p in event.get('packages', []))
print(f"  company={event.get('company')}  packages={len(event.get('packages', []))}  units={units}")
print(f"  wmsSentAt={event.get('wmsSentAt', '(absent)')}")
PY

	echo
	START_MS=$(( $(date +%s) * 1000 ))
	OUT=$(mktemp)
	aws lambda invoke --profile "$PROFILE" --region "$REGION" \
		--function-name "$FUNCTION" --payload "fileb://${PAYLOAD}" \
		"$OUT" --query 'FunctionError' --output text || true

	echo "FunctionError: $(cat "$OUT" | head -c 400)"
	rm -f "$OUT" "$PAYLOAD"

	echo
	echo "Waiting for logs…"
	sleep 8
fi

aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
	--log-group-name "$LOG_GROUP" --start-time "$START_MS" \
	--query 'events[].message' --output text 2>/dev/null \
	| tr '\t' '\n' \
	| grep -E 'ManhattanShipmentPayloadBytes|ShipmentDownload \(redacted\)|ManhattanConfigError|ManhattanRequestOutcome|Manhattan' \
	|| echo "  (nothing yet — logs lag; re-run the filter in a few seconds)"

cat <<'EOF'

Reading it:
  ManhattanConfigError present, no ManhattanRequestOutcome  -> Gate B success: payload built, send refused
  ManhattanRequestOutcome present                           -> something reached Manhattan
  no redacted XML                                           -> LOG_REDACTED_PAYLOAD is unset (a redeploy wipes it)
EOF