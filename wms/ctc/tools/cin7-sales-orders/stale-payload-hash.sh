#!/usr/bin/env bash
# Makes a real, unchanged Cin7 order look edited, so the poller's own logic can be tested.
#
# The problem this solves: Cin7 is production, so an order's content cannot be changed to test an
# update. `invoke-so-revision.sh` gets round that by publishing the transaction directly — but that
# skips the poller entirely, and the poller is where the interesting decisions live: the echo guard,
# the eligibility gate, the create-vs-update inference.
#
# The lever is the echo guard itself, used backwards. The poller skips a modified order whose mapped
# payload hashes the same as `lastEmittedPayloadHash` on the persisted order. Overwrite that field
# with a value the payload cannot hash to, and the very next poll of that order reads it as a
# genuine edit and emits an UPDATE_ORDER — without Cin7 changing at all.
#
# Pair it with `cin7-watermark.sh --poller so` set back far enough to re-read the order, then
# `invoke-so-poller.sh`.
#
# Usage:
#   ./stale-payload-hash.sh --stage <stage> --profile <profile> --reference <ref> [--restore]
#
#   --reference  the normalised Cin7 reference (no leading '#')
#   --restore    put the original hash back, so the order stops looking edited
#   --show       print the current hash and exit
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ WRITES one attribute on one order row. <stage> only.                                    │
# │                                                                                          │
# │ The original hash is saved to ./.stale-hash-backups/ before it is overwritten, so         │
# │ --restore is always possible. Do not delete that directory mid-test.                      │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${HERE}/.stale-hash-backups"

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
REFERENCE=""
MODE="stale"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		--restore) MODE="restore"; shift ;;
		--show) MODE="show"; shift ;;
		-h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFERENCE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --reference <ref> [--restore|--show]" >&2
	echo "Example: $0 --stage staging --profile staging --reference 261068" >&2
	exit 1
fi

if [[ "$STAGE" != "kian-dev" && "$STAGE" != "staging" && "$MODE" != "show" ]]; then
	echo "Refusing to write to '${STAGE}'. This script mutates an order row; it is for kian-dev and staging." >&2
	exit 1
fi

# A leading '#' is what Cin7 sends but not what is stored: the mapper strips it so the origin key
# splits on a predictable number of segments. Accept either and normalise, rather than silently
# querying a key that cannot match.
REFERENCE="${REFERENCE#\#}"

TABLE="${STAGE}-orders-v2"
ORIGIN="CTC#CIN7_SO#${REFERENCE}"

if ! ROW=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
	--query 'Items[?SK.S==`ORDER`] | [0]' \
	--output json 2>&1); then
	echo "Could not read ${TABLE}:" >&2
	echo "${ROW}" >&2
	exit 1
fi

read -r ORDER_ID CURRENT_HASH LAST_MODIFIED < <(python3 -c "
import json
raw='''${ROW}'''.strip()
d = json.loads(raw) if raw and raw != 'null' else None
if not d:
    print('  ')
else:
    print(
        d.get('PK', {}).get('S', ''),
        d.get('lastEmittedPayloadHash', {}).get('S', '<none>'),
        d.get('lastModified', {}).get('S', '<none>'),
    )
")

if [[ -z "${ORDER_ID:-}" ]]; then
	echo "No order found for reference ${REFERENCE} in ${TABLE}." >&2
	echo "Create one first: ./invoke-so-revision.sh --scenario 01-baseline ..." >&2
	exit 1
fi

echo "Order:          ${ORDER_ID}"
echo "Reference:      ${REFERENCE}"
echo "lastModified:   ${LAST_MODIFIED}"
echo "Current hash:   ${CURRENT_HASH}"
echo

BACKUP_FILE="${BACKUP_DIR}/${STAGE}-${REFERENCE}.hash"

case "$MODE" in
	show)
		exit 0
		;;

	restore)
		if [[ ! -f "$BACKUP_FILE" ]]; then
			echo "No backup at ${BACKUP_FILE} — nothing to restore." >&2
			echo "If the hash was never staled, the order is already in its real state." >&2
			exit 1
		fi
		ORIGINAL=$(cat "$BACKUP_FILE")
		if [[ "$ORIGINAL" == "<none>" ]]; then
			# The order genuinely had no hash before — remove the attribute rather than writing
			# an empty string, which would read as "hashed to nothing" and never match.
			aws dynamodb update-item --profile "$PROFILE" --region "$REGION" \
				--table-name "$TABLE" \
				--key "{\"PK\":{\"S\":\"${ORDER_ID}\"},\"SK\":{\"S\":\"ORDER\"}}" \
				--update-expression 'REMOVE lastEmittedPayloadHash' \
				>/dev/null
			echo "Restored: attribute removed (it did not exist before)."
		else
			aws dynamodb update-item --profile "$PROFILE" --region "$REGION" \
				--table-name "$TABLE" \
				--key "{\"PK\":{\"S\":\"${ORDER_ID}\"},\"SK\":{\"S\":\"ORDER\"}}" \
				--update-expression 'SET lastEmittedPayloadHash = :h' \
				--expression-attribute-values "{\":h\":{\"S\":\"${ORIGINAL}\"}}" \
				>/dev/null
			echo "Restored: ${ORIGINAL}"
		fi
		rm -f "$BACKUP_FILE"
		;;

	stale)
		if [[ -f "$BACKUP_FILE" ]]; then
			echo "This order is already staled (backup exists at ${BACKUP_FILE})." >&2
			echo "Run with --restore first, or --show to see the current state." >&2
			exit 1
		fi
		mkdir -p "$BACKUP_DIR"
		printf '%s' "$CURRENT_HASH" > "$BACKUP_FILE"

		# Deliberately not a random value: 'stale' is unmistakable in a log line and in the table,
		# so nobody mistakes it for a real hash. It is 8 chars like a real one, and no SHA-256
		# prefix can equal it.
		STALE_VALUE='stale000'

		aws dynamodb update-item --profile "$PROFILE" --region "$REGION" \
			--table-name "$TABLE" \
			--key "{\"PK\":{\"S\":\"${ORDER_ID}\"},\"SK\":{\"S\":\"ORDER\"}}" \
			--update-expression 'SET lastEmittedPayloadHash = :h' \
			--expression-attribute-values "{\":h\":{\"S\":\"${STALE_VALUE}\"}}" \
			>/dev/null

		echo "Hash staled to '${STALE_VALUE}'. Original saved to:"
		echo "  ${BACKUP_FILE}"
		echo
		echo "The next poll that reads this order will treat it as edited and emit UPDATE_ORDER."
		echo "To make the poller read it, wind the watermark back past its lastModified:"
		echo
		echo "  ../common/cin7-watermark.sh --poller so --stage ${STAGE} --profile ${PROFILE} \\"
		echo "      --set '${LAST_MODIFIED}' --confirm"
		echo "  ./invoke-so-poller.sh --stage ${STAGE} --profile ${PROFILE}"
		echo
		echo "Afterwards, put the real hash back:"
		echo "  $0 --stage ${STAGE} --profile ${PROFILE} --reference ${REFERENCE} --restore"
		;;
esac
