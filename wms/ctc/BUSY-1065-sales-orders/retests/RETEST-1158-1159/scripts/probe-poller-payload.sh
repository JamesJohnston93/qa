#!/usr/bin/env bash
# One-shot manual invoke of the Cin7 sales-order poller with a custom payload, to test whether
# the handler honours an upper-bound override on its fetch window. Mirrors invoke-so-poller.sh's
# invoke-then-tail-logs pattern, but sends the given payload instead of '{}'.
#
# Ticket:      RETEST-1158-1159, slice R10 Gate B
# Cases:       none directly, infrastructure for R3/R8/TC6/TC9/TC15's reachability
# Asserts:     what modifiedSince/modifiedBefore the poller actually logs for a given payload
# Does NOT:    prove the override changes fetch behaviour beyond the logged window; that still
#              needs ordersFetched cross-checked against a direct Cin7 count, done separately
# Side effects: invokes the poller lambda once per call (real Cin7 GET, real event processing for
#              whatever falls in the resulting window)
#
# Usage: ./probe-poller-payload.sh --stage <stage> --profile <profile> --payload '<json>'
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
PAYLOAD=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--payload) PAYLOAD="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$PAYLOAD" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --payload '<json>'" >&2
	exit 1
fi

FUNCTION="${STAGE}-orders-cin7-so-poller"
LOG_GROUP="/aws/lambda/${FUNCTION}"

echo "Payload: ${PAYLOAD}"
START_MS=$(( $(date +%s) * 1000 ))

OUT=$(mktemp)
aws lambda invoke --profile "$PROFILE" --region "$REGION" \
	--function-name "$FUNCTION" --payload "$PAYLOAD" --cli-binary-format raw-in-base64-out \
	"$OUT" --query 'FunctionError' --output text
echo "Response: $(cat "$OUT")"
rm -f "$OUT"

echo "Waiting for logs..."
sleep 8

aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
	--log-group-name "$LOG_GROUP" --start-time "$START_MS" \
	--query 'events[].message' --output text 2>/dev/null \
	| tr '\t' '\n' \
	| grep '"metric"' \
	| python3 -c '
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        parsed = json.loads(line)
    except ValueError:
        print(line)
        continue
    metric = parsed.pop("metric", "?")
    rest = " ".join(f"{k}={v}" for k, v in parsed.items())
    print(f"  {metric:<34} {rest}")
' || echo "  (no metric lines yet)"
