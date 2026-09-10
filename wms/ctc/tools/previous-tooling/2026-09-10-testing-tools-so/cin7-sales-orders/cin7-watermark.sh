#!/usr/bin/env bash
# Views or sets a Cin7 poller's watermark — the SSM parameter that controls which window of Cin7
# records that poller re-reads on its next scheduled cycle. Cin7 test data can't be created or
# edited directly (read-only API access only), so this is the actual test lever: set the
# watermark back to a UTC timestamp before some known Cin7 activity and wait for a cycle.
#
# --poller picks which flow. They are separate parameters on purpose: each advances
# independently, and resetting one must never rewind another.
#
#   --poller so     /{stage}/orders/cin7-so-watermark          sales orders  -> SCALE Shipments
#   --poller po     /{stage}/orders/cin7-po-watermark          purchase orders
#   --poller item   /{stage}/cin7-manhattan/item-watermark     item master   -> SCALE Items
#
# NOTE: --poller DEFAULTS TO item, for backwards compatibility with the BUSY-1067 item-master
# tooling this script came from. For sales-order testing you must pass --poller so every time.
#
# Cadence differs per poller: the sales-order poller runs every 2 minutes, the item poller every
# 3 (plus a buffer flush, so allow ~10 minutes end-to-end for items).
#
# IMPORTANT: the watermark value is always UTC (ISO 8601, e.g. 2026-07-20T00:00:00.000Z), never
# local time. If you're thinking in AEST, subtract 10 hours (11 during daylight saving) first.
#
# Usage:
#   Get:  ./cin7-watermark.sh --stage <stage> --profile <profile> [--poller item|so|po]
#   Set:  ./cin7-watermark.sh --stage <stage> --profile <profile> [--poller item|so|po] --set <UTC-ISO8601> [--confirm]
#
# --set without --confirm is a dry run: validates the value and shows what would change, but
# does not write anything. Pass --confirm to actually update the parameter.
#
# Special value: --set UNSET resets to the "never run yet" sentinel — the poller then stays
# inactive (the sales-order poller logs Cin7SOPollerInactive, the item poller
# Cin7ItemPollerInactive, and neither calls Cin7 at all) on every subsequent cycle until an
# operator sets a real start date with this script, same as a fresh deploy.
#
# Example (view SO):     ./cin7-watermark.sh --stage staging --profile staging --poller so
# Example (dry run):     ./cin7-watermark.sh --stage staging --profile staging --poller so --set 2026-07-20T00:00:00.000Z
# Example (set for real):./cin7-watermark.sh --stage staging --profile staging --poller so --set 2026-07-20T00:00:00.000Z --confirm
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
SET_VALUE=""
CONFIRM="false"
POLLER="item"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--set) SET_VALUE="$2"; shift 2 ;;
		--poller) POLLER="$2"; shift 2 ;;
		--confirm) CONFIRM="true"; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--poller item|so|po] [--set <UTC-ISO8601>] [--confirm]" >&2
	echo "Example (view SO): $0 --stage staging --profile staging --poller so" >&2
	echo "Example (set SO):  $0 --stage staging --profile staging --poller so --set 2026-07-20T00:00:00.000Z --confirm" >&2
	echo "NOTE: --poller defaults to 'item'. Sales-order testing needs --poller so." >&2
	exit 1
fi

# One watermark per poller. They are separate parameters on purpose: each flow advances
# independently, and resetting one must never rewind another.
case "$POLLER" in
	item) PARAM_NAME="/${STAGE}/cin7-manhattan/item-watermark" ;;
	so)   PARAM_NAME="/${STAGE}/orders/cin7-so-watermark" ;;
	po)   PARAM_NAME="/${STAGE}/orders/cin7-po-watermark" ;;
	*)    echo "Unknown --poller '$POLLER' (expected: item, so, po)" >&2; exit 1 ;;
esac

echo "Poller: ${POLLER}"

CURRENT_VALUE=$(aws ssm get-parameter --profile "$PROFILE" --region "$REGION" \
	--name "$PARAM_NAME" --query "Parameter.Value" --output text 2>/dev/null) || {
	echo "Could not read $PARAM_NAME — has this stage been deployed?" >&2
	exit 1
}

if [[ -z "$SET_VALUE" ]]; then
	echo "Current Cin7 watermark [$POLLER] ($STAGE): $CURRENT_VALUE"
	echo "  parameter: $PARAM_NAME"
	echo "(This value is UTC. \"UNSET\" means the poller is inactive and won't call Cin7 at all.)"
	exit 0
fi

# Accept the UNSET sentinel as-is; otherwise require a UTC ISO 8601 datetime ending in Z.
if [[ "$SET_VALUE" != "UNSET" ]] && ! [[ "$SET_VALUE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$ ]]; then
	echo "Invalid watermark value: \"$SET_VALUE\"" >&2
	echo "Must be UTC ISO 8601 (e.g. 2026-07-20T00:00:00.000Z), or the literal \"UNSET\"." >&2
	echo "Remember: this is UTC, not local time — AEST is UTC+10 (UTC+11 during daylight saving)." >&2
	exit 1
fi

echo "Parameter:           $PARAM_NAME"
echo "Current watermark:   $CURRENT_VALUE"
echo "Requested watermark: $SET_VALUE"

if [[ "$CONFIRM" != "true" ]]; then
	echo ""
	echo "Dry run — no change made. Re-run with --confirm to actually set the watermark."
	exit 0
fi

aws ssm put-parameter --profile "$PROFILE" --region "$REGION" \
	--name "$PARAM_NAME" --value "$SET_VALUE" --type String --overwrite >/dev/null

NEW_VALUE=$(aws ssm get-parameter --profile "$PROFILE" --region "$REGION" \
	--name "$PARAM_NAME" --query "Parameter.Value" --output text)

echo ""
echo "Watermark updated: $NEW_VALUE"
if [[ "$POLLER" == "item" ]]; then
	echo "The poller re-reads this on its next scheduled cycle (every 3 minutes). Allow ~10 minutes"
	echo "total (poll cycle + buffer flush) before checking Manhattan SCALE staging for the result."
else
	echo "The poller re-reads this on its next scheduled cycle (every 2 minutes). Allow a couple of"
	echo "cycles before checking Manhattan SCALE staging for the result."
fi
