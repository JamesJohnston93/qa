#!/usr/bin/env bash
# One-shot manual invoke of the Cin7 sales-order poller, then prints this run's structured
# metric lines from CloudWatch.
#
# Refuses while the schedule rule is enabled: a scheduled cycle firing underneath a manual one
# would race the same watermark, and the result would be unreadable rather than merely noisy.
#
# Usage: ./invoke-so-poller.sh --stage <stage> --profile <profile> [--force]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
FORCE="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--force) FORCE="true"; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--force]" >&2
	echo "Example: $0 --stage kian-dev --profile dev" >&2
	exit 1
fi

FUNCTION="${STAGE}-orders-cin7-so-poller"
RULE="${STAGE}-orders-cin7-so-poller-rule"
LOG_GROUP="/aws/lambda/${FUNCTION}"

RULE_STATE=$(aws events describe-rule --profile "$PROFILE" --region "$REGION" \
	--name "$RULE" --query 'State' --output text 2>/dev/null || echo "NOT_FOUND")

echo "Function:   ${FUNCTION}"
echo "Rule:       ${RULE} (${RULE_STATE})"

if [[ "$RULE_STATE" == "ENABLED" && "$FORCE" != "true" ]]; then
	echo >&2
	echo "REFUSED: the schedule is ENABLED, so a scheduled cycle can run against the same" >&2
	echo "watermark while this one does. Disable it first:" >&2
	echo "  aws events disable-rule --profile ${PROFILE} --region ${REGION} --name ${RULE}" >&2
	echo "(--force overrides, but the run is then not a controlled single cycle.)" >&2
	exit 1
fi

# Everything logged from this point belongs to this invocation.
START_MS=$(( $(date +%s) * 1000 ))

echo
echo "Invoking…"
OUT=$(mktemp)
aws lambda invoke --profile "$PROFILE" --region "$REGION" \
	--function-name "$FUNCTION" --payload '{}' --cli-binary-format raw-in-base64-out \
	"$OUT" --query 'FunctionError' --output text

echo "Response: $(cat "$OUT")"
rm -f "$OUT"

echo
echo "Waiting for logs…"
sleep 8

# The poller's own structured lines. Anything with a "metric" key is one of ours.
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
' || echo "  (no metric lines yet — logs can lag; re-run the filter in a few seconds)"

echo
echo "Reminder — an alert line means an order was dropped, not that the cycle failed:"
echo "  Cin7SOPollerAlert     a hard-error skip; read its message"
echo "  Cin7SOPollerInactive  the watermark is still UNSET, so nothing was polled"
