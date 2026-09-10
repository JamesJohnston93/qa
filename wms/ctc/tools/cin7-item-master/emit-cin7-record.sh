#!/usr/bin/env bash
# Bus-injection fallback for CTC/Cin7 testing (BUSY-1114+): PutEvents a synthetic
# manhattan_item_enriched record directly onto the shared internal bus
# (staging-catalog-manhattan-events), bypassing the Cin7 poller entirely. This is the
# documented fallback for exact controlled content when the watermark lever (real Cin7 data)
# can't isolate a specific field shape narrowly — e.g. no-barcode, blank category, or a missing
# productOptionCode, none of which can be targeted via a narrow watermark rewind when Cin7's
# real recent activity doesn't happen to include that shape (see QA-BUNDLE-REPLAN.md).
#
# Wire format reverse-engineered from a real poller "Pushed {...}" log line (tail-logs.sh
# --lambda cin7-poller), confirmed against the deployed EventBridge rule
# (staging-catalog-manhattan-*, event-bus staging-catalog-manhattan-events, pattern
# detail-type=manhattan_item_enriched) which targets the buffer-populator Lambda directly — so
# this reaches the same buffer -> sender -> Manhattan SCALE path a real poller emit would,
# skipping only the poller's own Cin7-read + trigger-fan-in logic.
#
# GOTCHA (BUSY-1113): the field is `desc`, not `description` — and `additional_eans` must be
# present (an array, [] if none) — omitting either makes the sender throw instead of validating
# normally, per CLAUDE.md.
#
# Defaults to a dry run (prints the exact PutEvents entry, does not call AWS) — pass --confirm
# to actually emit. Every value has a sensible CTC-realistic default; override only what your
# test needs. --no-barcode / --blank-category / --missing-option-code are convenience flags for
# the three shapes the watermark lever can't reach on demand.
#
# Usage:
#   ./emit-cin7-record.sh --stage <stage> --profile <profile> [options] [--confirm]
#
# Options (all optional):
#   --item-code <s>          (default: QA-TEST-<timestamp>) also drives message_group_id
#   --company <CTC|UNI>       (default: CTC) drives the message_group_id prefix ("<company>#...")
#                              and the detail.company field — use UNI to test cross-tenant
#                              coalesce-key isolation (BUSY-1115 ID1)
#   --desc <s>                (default: "QA E2E Test <item-code> <timestamp>")
#   --desc-raw <s>             escape hatch: sets desc verbatim, bypassing the auto-fill-when-empty
#                              logic below (--desc "" still auto-fills; --desc-raw "" does not —
#                              use this to put a genuinely blank desc on the wire, e.g. ERR2)
#   --weight-raw <s>           escape hatch: sets weight verbatim, bypassing num()'s coercion of
#                              unparseable values to 0 — use this to put a non-numeric weight on
#                              the wire as a literal string, e.g. ERR4
#   --size <s>                (default: One Size)
#   --colour <s>               (default: Black)
#   --brand <s>                (default: Thrills Co.)
#   --sub-group-id <s>         (default: 179) — blank string means uncategorised (CTC-000 fallback)
#   --weight <n>                (default: 0.5)
#   --height <n> --length <n> --width <n>   (default: 0 each, i.e. "missing" like real data today)
#   --dimension-uom <s>         (default: "" — blank, matching real observed data)
#   --qty-uom <s>               (default: "" — blank, matching real observed data)
#   --conversion-rate <n>      (default: 0)
#   --ean <s>                   (default: 9300000000001)
#   --additional-eans <csv>    (default: empty)
#   --no-barcode                convenience: --ean "" --additional-eans ""
#   --blank-category             convenience: --sub-group-id ""
#   --missing-option-code        convenience: --item-code "" — this is the ERR1 shape (blank
#                                 item_code passes the populator, then crashes the sender in
#                                 validateItemDownload; bisects and lands in the buffer DLQ after
#                                 ~10 retries/~30 min). It does NOT and cannot exercise the
#                                 poller-side eligibility-skip (TC7/PW6): bus-injection bypasses
#                                 the poller entirely, so that skip is untestable via this script.
#   --is-giftcard <true|false>  (default: false)
#
# Example (dry run):    ./emit-cin7-record.sh --stage staging --profile staging --no-barcode
# Example (real send):  ./emit-cin7-record.sh --stage staging --profile staging --blank-category --confirm
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
CONFIRM="false"

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
ITEM_CODE="QA-TEST-${TIMESTAMP}"
COMPANY="CTC"
DESC=""
SIZE="One Size"
COLOUR="Black"
BRAND="Thrills Co."
SUB_GROUP_ID="179"
WEIGHT="0.5"
HEIGHT="0"
LENGTH="0"
WIDTH="0"
DIMENSION_UOM=""
QTY_UOM=""
CONVERSION_RATE="0"
EAN="9300000000001"
ADDITIONAL_EANS=""
IS_GIFTCARD="false"
ITEM_CODE_SET="false"
DESC_RAW="false"
WEIGHT_RAW="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--item-code) ITEM_CODE="$2"; ITEM_CODE_SET="true"; shift 2 ;;
		--company) COMPANY="$2"; shift 2 ;;
		--desc) DESC="$2"; shift 2 ;;
		--desc-raw) DESC="$2"; DESC_RAW="true"; shift 2 ;;
		--weight-raw) WEIGHT="$2"; WEIGHT_RAW="true"; shift 2 ;;
		--size) SIZE="$2"; shift 2 ;;
		--colour) COLOUR="$2"; shift 2 ;;
		--brand) BRAND="$2"; shift 2 ;;
		--sub-group-id) SUB_GROUP_ID="$2"; shift 2 ;;
		--weight) WEIGHT="$2"; shift 2 ;;
		--height) HEIGHT="$2"; shift 2 ;;
		--length) LENGTH="$2"; shift 2 ;;
		--width) WIDTH="$2"; shift 2 ;;
		--dimension-uom) DIMENSION_UOM="$2"; shift 2 ;;
		--qty-uom) QTY_UOM="$2"; shift 2 ;;
		--conversion-rate) CONVERSION_RATE="$2"; shift 2 ;;
		--ean) EAN="$2"; shift 2 ;;
		--additional-eans) ADDITIONAL_EANS="$2"; shift 2 ;;
		--is-giftcard) IS_GIFTCARD="$2"; shift 2 ;;
		--no-barcode) EAN=""; ADDITIONAL_EANS=""; shift 1 ;;
		--blank-category) SUB_GROUP_ID=""; shift 1 ;;
		--missing-option-code) ITEM_CODE=""; ITEM_CODE_SET="true"; shift 1 ;;
		--confirm) CONFIRM="true"; shift 1 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [options] [--confirm]" >&2
	echo "Example (dry run):   $0 --stage staging --profile staging --no-barcode" >&2
	echo "Example (real send): $0 --stage staging --profile staging --blank-category --confirm" >&2
	exit 1
fi

if [[ "$STAGE" != "staging" ]]; then
	echo "Note: --stage $STAGE — the shared bus name below assumes the staging naming convention" >&2
	echo "(staging-catalog-manhattan-events). Confirm this stage's bus name before proceeding if it differs." >&2
fi

if [[ "$COMPANY" != "CTC" && "$COMPANY" != "UNI" ]]; then
	echo "--company must be 'CTC' or 'UNI' — got: $COMPANY" >&2
	exit 1
fi

if [[ -z "$DESC" && "$DESC_RAW" != "true" ]]; then
	if [[ -z "$ITEM_CODE" ]]; then
		DESC="QA E2E Test (missing item_code) ${TIMESTAMP}"
	else
		DESC="QA E2E Test ${ITEM_CODE} ${TIMESTAMP}"
	fi
fi

EVENT_BUS_NAME="${STAGE}-catalog-manhattan-events"
MESSAGE_GROUP_ID="${COMPANY}#${ITEM_CODE}"

ENTRY_JSON=$(python3 - "$ITEM_CODE" "$MESSAGE_GROUP_ID" "$DESC" "$SIZE" "$COLOUR" "$BRAND" \
	"$SUB_GROUP_ID" "$WEIGHT" "$HEIGHT" "$LENGTH" "$WIDTH" "$DIMENSION_UOM" "$QTY_UOM" \
	"$CONVERSION_RATE" "$EAN" "$ADDITIONAL_EANS" "$IS_GIFTCARD" "$EVENT_BUS_NAME" "$WEIGHT_RAW" "$COMPANY" <<'PYEOF'
import json, sys, time

(item_code, message_group_id, desc, size, colour, brand, sub_group_id, weight, height, length,
 width, dimension_uom, qty_uom, conversion_rate, ean, additional_eans_csv, is_giftcard,
 event_bus_name, weight_raw, company) = sys.argv[1:21]

def num(s):
	try:
		f = float(s)
		return int(f) if f.is_integer() else f
	except ValueError:
		return 0

additional_eans = [e.strip() for e in additional_eans_csv.split(",") if e.strip()]

missing_fields = []
for name, val in [("dimension_uom", dimension_uom), ("qty_uom", qty_uom),
                   ("height", height), ("length", length), ("width", width),
                   ("conversion_rate", conversion_rate), ("weight", weight)]:
	if val in ("", "0", 0):
		missing_fields.append(name)

detail = {
	"message_group_id": message_group_id,
	"read_at": int(time.time() * 1000),
	"item_code": item_code,
	"company": company,
	"size": size,
	"colour": colour,
	"ean": ean,
	"additional_eans": additional_eans,
	"weight": weight if weight_raw == "true" else num(weight),
	"height": num(height),
	"length": num(length),
	"width": num(width),
	"conversion_rate": num(conversion_rate),
	"dimension_uom": dimension_uom,
	"qty_uom": qty_uom,
	"desc": desc,
	"product_group_id": "CTC",
	"sub_group_id": sub_group_id,
	"is_giftcard": is_giftcard == "true",
	"brand": brand,
	"missing_fields": missing_fields,
}

entry = {
	"Source": "qa-testing-tools.emit-cin7-record",
	"DetailType": "manhattan_item_enriched",
	"EventBusName": event_bus_name,
	"Detail": json.dumps(detail),
}

print(json.dumps({"detail": detail, "entry": entry}, indent=2))
PYEOF
)

DETAIL_PRETTY=$(echo "$ENTRY_JSON" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['detail'], indent=2))")
ENTRY_FOR_AWS=$(echo "$ENTRY_JSON" | python3 -c "import json,sys; print(json.dumps([json.load(sys.stdin)['entry']]))")

echo "Event bus:  $EVENT_BUS_NAME"
echo "Detail-type: manhattan_item_enriched"
echo ""
echo "Record detail:"
echo "$DETAIL_PRETTY"

if [[ -z "$ITEM_CODE" ]]; then
	echo ""
	echo "NOTE: item_code is blank — this is the ERR1 shape. It passes the populator (message_group_id"
	echo "\"${MESSAGE_GROUP_ID}\" is valid), then crashes the sender in validateItemDownload; expect bisection and a"
	echo "DLQ landing after ~10 retries/~30 min. This does NOT exercise the poller-side eligibility-skip"
	echo "(TC7/PW6) — bus-injection bypasses the poller entirely, so that path is untestable here."
fi

if [[ "$CONFIRM" != "true" ]]; then
	echo ""
	echo "Dry run — no event sent. Re-run with --confirm to actually PutEvents onto $EVENT_BUS_NAME."
	exit 0
fi

RESULT=$(aws events put-events --profile "$PROFILE" --region "$REGION" --entries "$ENTRY_FOR_AWS")
FAILED_COUNT=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('FailedEntryCount', 1))")

echo ""
if [[ "$FAILED_COUNT" == "0" ]]; then
	echo "Event sent successfully to $EVENT_BUS_NAME."
	echo "Allow ~3 minutes (buffer flush) before checking Manhattan SCALE staging or"
	echo "tail-logs.sh --lambda buffer / --lambda sender for the result."
else
	echo "PutEvents reported a failure:"
	echo "$RESULT"
	exit 1
fi
