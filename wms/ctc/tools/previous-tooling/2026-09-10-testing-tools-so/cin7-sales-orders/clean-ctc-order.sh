#!/usr/bin/env bash
# DESTRUCTIVE. Deletes one CTC sales order and everything materialised from it, by origin key:
# the Order row, its ITEM#/ADDRESS#/TRANSACTION# rows, the Shipment header and its ShipmentItems.
#
# Why it exists: the SO poller creates on first sight only, so re-testing the create path is
# impossible without removing what the last run made. Reset the watermark afterwards.
#
# kian-dev ONLY. Every other stage hard-fails, and the AWS account is checked independently of
# the --stage argument so a stale AWS_PROFILE cannot point a "kian-dev" run at another account.
#
# Usage: ./clean-ctc-order.sh --stage kian-dev --profile <profile> --reference <ref>
#   --reference takes the normalised reference (no leading '#'), e.g. 100234
#
# There is deliberately no --all, no --force and no wildcard.
set -euo pipefail

readonly ALLOWED_STAGE="kian-dev"

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
REFERENCE=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFERENCE" ]]; then
	echo "Usage: $0 --stage kian-dev --profile <profile> --reference <ref>" >&2
	echo "Example: $0 --stage kian-dev --profile dev --reference 100234" >&2
	exit 1
fi

# Guard 1 — exact stage match. No prefix matching, no globbing.
if [[ "$STAGE" != "$ALLOWED_STAGE" ]]; then
	echo "REFUSED: this tool deletes data and only ever runs against '${ALLOWED_STAGE}'." >&2
	echo "Got --stage '${STAGE}'." >&2
	exit 1
fi

# Guard 2 — the reference must be a plain normalised reference. A '#' here would be a raw Cin7
# reference, which builds a different origin key than the one actually stored.
if [[ ! "$REFERENCE" =~ ^[A-Za-z0-9_-]+$ ]]; then
	echo "REFUSED: --reference must be the normalised reference, no '#' and no wildcards." >&2
	echo "Got '${REFERENCE}'." >&2
	exit 1
fi

ORIGIN="CTC#CIN7_SO#${REFERENCE}"
ORDERS_TABLE="${STAGE}-orders-v2"
SHIPMENTS_TABLE="${STAGE}-shipments"

# Guard 3 — the resolved account must be the one kian-dev lives in, established from the
# deployed stack rather than hardcoded, so this cannot drift.
ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" \
	--query 'Account' --output text)
EXPECTED_ACCOUNT=$(aws cloudformation describe-stacks --profile "$PROFILE" --region "$REGION" \
	--stack-name "${STAGE}-orders-v2" --query 'Stacks[0].StackId' --output text 2>/dev/null \
	| cut -d: -f5) || {
	echo "REFUSED: could not find stack '${STAGE}-orders-v2' in account ${ACCOUNT}." >&2
	echo "Either the profile points at the wrong account, or ${STAGE} is not deployed here." >&2
	exit 1
}

if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
	echo "REFUSED: profile '${PROFILE}' resolves to account ${ACCOUNT}," >&2
	echo "but ${STAGE}-orders-v2 lives in ${EXPECTED_ACCOUNT}." >&2
	exit 1
fi

echo "Stage:     ${STAGE}   (account ${ACCOUNT})"
echo "Origin:    ${ORIGIN}"
echo

# --- collect, print, then delete. Nothing is removed before the whole list is shown. ---

ORDER_ROWS=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$ORDERS_TABLE" --index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
	--query 'Items[].[PK.S,SK.S]' --output text 2>/dev/null || true)

# The shipments table has no origin index. Shipment rows share the order's partition key, so
# resolve it from the orders rows already fetched above.
ORDER_PK=$(echo "$ORDER_ROWS" | awk 'NF{print $1; exit}')

if [[ -n "$ORDER_PK" ]]; then
	SHIPMENT_ROWS=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
		--table-name "$SHIPMENTS_TABLE" \
		--key-condition-expression 'PK = :pk' \
		--expression-attribute-values "{\":pk\":{\"S\":\"${ORDER_PK}\"}}" \
		--query 'Items[].[PK.S,SK.S]' --output text 2>/dev/null || true)
else
	SHIPMENT_ROWS=""
fi

if [[ -z "$ORDER_ROWS" && -z "$SHIPMENT_ROWS" ]]; then
	echo "Nothing found for ${ORIGIN}. Nothing to delete."
	exit 0
fi

echo "${ORDERS_TABLE}:"
[[ -n "$ORDER_ROWS" ]] && echo "$ORDER_ROWS" | sed 's/^/  /' || echo "  (none)"
echo
echo "${SHIPMENTS_TABLE}:"
[[ -n "$SHIPMENT_ROWS" ]] && echo "$SHIPMENT_ROWS" | sed 's/^/  /' || echo "  (none)"
echo

# Guard 4 — typed confirmation of the reference itself, so a mistyped one cannot be
# rubber-stamped with a reflexive "yes".
read -r -p "Type the reference (${REFERENCE}) to delete all of the above: " TYPED
if [[ "$TYPED" != "$REFERENCE" ]]; then
	echo "Aborted — '${TYPED}' does not match." >&2
	exit 1
fi

delete_rows() {
	local table="$1" rows="$2"
	[[ -z "$rows" ]] && return 0
	while IFS=$'\t' read -r pk sk; do
		[[ -z "$pk" ]] && continue
		aws dynamodb delete-item --profile "$PROFILE" --region "$REGION" \
			--table-name "$table" \
			--key "{\"PK\":{\"S\":\"${pk}\"},\"SK\":{\"S\":\"${sk}\"}}"
		echo "  deleted ${pk} / ${sk}"
	done <<< "$rows"
}

echo
echo "${ORDERS_TABLE}:"
delete_rows "$ORDERS_TABLE" "$ORDER_ROWS"
echo "${SHIPMENTS_TABLE}:"
delete_rows "$SHIPMENTS_TABLE" "$SHIPMENT_ROWS"

echo
echo "Done. Reset the watermark before re-running the poller:"
echo "  ./cin7-watermark.sh --stage ${STAGE} --profile ${PROFILE} --poller so --set <ISO8601> --confirm"
