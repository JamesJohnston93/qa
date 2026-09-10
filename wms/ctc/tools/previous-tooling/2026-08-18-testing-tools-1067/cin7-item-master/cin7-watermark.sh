#!/usr/bin/env bash
# Views or sets the Cin7 item poller's watermark — the single SSM parameter
# (/catalog/cin7-manhattan/item-watermark/{stage}) that controls which window of Cin7 products
# the poller re-reads on its next scheduled cycle (every 3 minutes). Cin7 test data can't be
# created or edited directly (read-only API access only), so this is the actual test lever:
# set the watermark to a UTC timestamp before some known Cin7 activity, wait ~10 minutes for a
# poll cycle + buffer flush, then check Manhattan SCALE staging for the result.
#
# IMPORTANT: the watermark value is always UTC (ISO 8601, e.g. 2026-07-20T00:00:00.000Z), never
# local time. If you're thinking in AEST, subtract 10 hours (11 during daylight saving) first.
#
# Usage:
#   Get:    ./cin7-watermark.sh --stage <stage> --profile <profile>
#   Set:    ./cin7-watermark.sh --stage <stage> --profile <profile> --set <UTC-ISO8601> [--confirm]
#   Unset:  ./cin7-watermark.sh --stage <stage> --profile <profile> --unset [--confirm]
#
# --set/--unset without --confirm is a dry run: validates the value and shows what would change,
# but does not write anything. Pass --confirm to actually update the parameter.
#
# --unset (equivalent to --set UNSET) resets to the "never run yet" sentinel — the poller then
# stays inactive (logs Cin7ItemPollerInactive and does not call Cin7 at all) on every subsequent
# cycle until an operator sets a real start date with this script, same as a fresh deploy. There's
# no Cin7 sandbox and the daily API call cap is shared across every environment (see the README's
# Cin7/CTC constraints section) — UNSET is the norm whenever you're not actively mid-test, not
# just a post-test nicety, so reach for --unset as soon as a test session ends.
#
# Example (view):               ./cin7-watermark.sh --stage staging --profile staging
# Example (dry run):            ./cin7-watermark.sh --stage staging --profile staging --set 2026-07-20T00:00:00.000Z
# Example (actually set):       ./cin7-watermark.sh --stage staging --profile staging --set 2026-07-20T00:00:00.000Z --confirm
# Example (back to idle):       ./cin7-watermark.sh --stage staging --profile staging --unset --confirm
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
SET_VALUE=""
CONFIRM="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--set) SET_VALUE="$2"; shift 2 ;;
		--unset)
			if [[ -n "$SET_VALUE" ]]; then
				echo "--unset and --set are mutually exclusive" >&2
				exit 1
			fi
			SET_VALUE="UNSET"
			shift
			;;
		--confirm) CONFIRM="true"; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--set <UTC-ISO8601> | --unset] [--confirm]" >&2
	echo "Example (view):   $0 --stage staging --profile staging" >&2
	echo "Example (set):    $0 --stage staging --profile staging --set 2026-07-20T00:00:00.000Z --confirm" >&2
	echo "Example (unset):  $0 --stage staging --profile staging --unset --confirm" >&2
	exit 1
fi

PARAM_NAME="/catalog/cin7-manhattan/item-watermark/${STAGE}"

CURRENT_VALUE=$(aws ssm get-parameter --profile "$PROFILE" --region "$REGION" \
	--name "$PARAM_NAME" --query "Parameter.Value" --output text 2>/dev/null) || {
	echo "Could not read $PARAM_NAME — has this stage been deployed?" >&2
	exit 1
}

if [[ -z "$SET_VALUE" ]]; then
	echo "Current Cin7 watermark ($STAGE): $CURRENT_VALUE"
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

echo "Current watermark ($STAGE): $CURRENT_VALUE"
echo "Requested watermark:        $SET_VALUE"

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
echo "The poller re-reads this on its next scheduled cycle (every 3 minutes). Allow ~10 minutes"
echo "total (poll cycle + buffer flush) before checking Manhattan SCALE staging for the result."
