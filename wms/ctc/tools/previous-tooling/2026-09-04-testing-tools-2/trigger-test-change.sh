#!/usr/bin/env bash
# Bumps a single attribute on a variant or product to trigger the Manhattan sync pipeline — the
# exact mechanism used to verify this live. Only attributes on the Manhattan allowlist actually
# trigger anything (size, colour, weight, height, length, width, dimension_uom,
# conversion_rate, qty_uom, ean, additional_eans, displayname, vendor_name, product_group_id,
# sub_group_id, is_giftcard) — anything else (e.g. price) is a valid negative test: it should
# trigger nothing.
#
# vendor_name / product_group_id / sub_group_id / is_giftcard live on the parent PRODUCT
# (PRD#<id>), not the variant — use --sku PRD#<id> --via-variant VAR#<id> for those (see
# find-parent-product.sh to resolve a variant's parent). Everything else, including
# displayname, is a variant-level attribute (--sku VAR#<id>).
#
# Since Task 4 (BUSY-1047), a PRD#-level write to one of those four parent attributes fans out
# immediately to every real variant of that product (not just an allowlisted one) — see
# find-product-variants.sh to see the full set before you trigger the write.
#
# additional_eans is a DynamoDB list, not a plain string — pass comma-separated values and the
# script writes it as a list automatically (see the additional_eans example below).
#
# Safety: this writes directly to the target store's catalog table, so it refuses to touch any
# SKU that isn't explicitly listed in test-skus.txt (next to this script) — the same allowlist
# file is shared across both stores, so make sure the SKU you're testing actually exists on the
# store you pass via --store. Add known-safe, disposable test variants there first — see that
# file for instructions. A PRD# target is permitted only via an allowlisted variant's own
# confirmed parent (--via-variant) — there's no separate PRD# allowlist to maintain.
#
# Usage: ./trigger-test-change.sh --stage <stage> --profile <profile> --sku <VAR#id|PRD#id> --attribute <name> --value <value> [--store <us|ps>] [--type list] [--via-variant <VAR#id>]
# Example (variant attribute): ./trigger-test-change.sh --stage staging --profile staging --sku VAR#34024140 --attribute weight --value 0.5
# Example (barcode list):      ./trigger-test-change.sh --stage staging --profile staging --sku VAR#34024140 --attribute additional_eans --value "9312345678901,9312345678902"
# Example (product attribute): ./trigger-test-change.sh --stage staging --profile staging --sku PRD#411843 --via-variant VAR#34024140 --attribute is_giftcard --value true
# Example (PS store):          ./trigger-test-change.sh --stage staging --profile staging --store ps --sku VAR#12345678 --attribute weight --value 0.5
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST=""

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
STORE="us"
SKU=""
ATTRIBUTE=""
VALUE=""
TYPE=""
VIA_VARIANT=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		--sku) SKU="$2"; shift 2 ;;
		--attribute) ATTRIBUTE="$2"; shift 2 ;;
		--value) VALUE="$2"; shift 2 ;;
		--type) TYPE="$2"; shift 2 ;;
		--via-variant) VIA_VARIANT="$2"; shift 2 ;;
		--allowlist) ALLOWLIST="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$SKU" || -z "$ATTRIBUTE" || -z "$VALUE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --sku <VAR#id|PRD#id> --attribute <name> --value <value> [--store <us|ps>] [--type list] [--via-variant <VAR#id>]" >&2
	echo "Example: $0 --stage staging --profile staging --sku VAR#34024140 --attribute weight --value 0.5" >&2
	exit 1
fi

if [[ "$STORE" != "us" && "$STORE" != "ps" ]]; then
	echo "--store must be 'us' or 'ps' — got: $STORE" >&2
	exit 1
fi

if [[ "$SKU" != VAR#* && "$SKU" != PRD#* ]]; then
	echo "SKU must start with VAR# (a variant) or PRD# (a product) — got: $SKU" >&2
	exit 1
fi

[[ -z "$ALLOWLIST" ]] && ALLOWLIST="${SCRIPT_DIR}/test-skus.txt"

if [[ ! -f "$ALLOWLIST" ]]; then
	echo "No allowlist file found at $ALLOWLIST — refusing to run." >&2
	echo "Create it (see test-skus.txt in this folder) and add the SKUs you're allowed to test with." >&2
	exit 1
fi

if [[ "$SKU" == PRD#* ]]; then
	# product_group_id / sub_group_id / is_giftcard live on the parent product — only reachable
	# by proving the given PRD# really is the parent of an already-allowlisted variant, re-derived
	# live on every run rather than trusted from a second static list (which could go stale if a
	# variant's parent ever changes, or drift via a typo).
	if [[ -z "$VIA_VARIANT" || "$VIA_VARIANT" != VAR#* ]]; then
		echo "Writing to a PRD# SKU requires --via-variant VAR#<id> naming an allowlisted variant whose parent is this product." >&2
		echo "Use find-parent-product.sh --sku VAR#<id> to find the right PRD# for a variant you already have allowlisted." >&2
		exit 1
	fi

	if ! grep -qxF "$VIA_VARIANT" <(grep -v '^\s*#' "$ALLOWLIST" | grep -v '^\s*$'); then
		echo "'$VIA_VARIANT' is not in the allowlist ($ALLOWLIST) — refusing to run." >&2
		echo "This script only mutates SKUs (or SKUs reached via) variants you've explicitly listed as safe test data." >&2
		exit 1
	fi

	echo "Confirming '$VIA_VARIANT' is really the parent of '$SKU'..."
	DERIVED_PARENT="$("${SCRIPT_DIR}/find-parent-product.sh" --stage "$STAGE" --profile "$PROFILE" --region "$REGION" --store "$STORE" --sku "$VIA_VARIANT")"
	if [[ "$DERIVED_PARENT" != "$SKU" ]]; then
		echo "Parent of '$VIA_VARIANT' is '$DERIVED_PARENT', not '$SKU' — refusing to run." >&2
		exit 1
	fi
else
	if ! grep -qxF "$SKU" <(grep -v '^\s*#' "$ALLOWLIST" | grep -v '^\s*$'); then
		echo "'$SKU' is not in the allowlist ($ALLOWLIST) — refusing to run." >&2
		echo "This script only mutates SKUs you've explicitly listed as safe test data." >&2
		echo "Add it to $ALLOWLIST first if you're sure it's a safe, disposable test variant." >&2
		exit 1
	fi
fi

# Auto-detect DynamoDB attribute type: additional_eans (or anything passed --type list) becomes a
# comma-split list of strings, a number stays a number, everything else is a plain string.
# List-mode is decided by attribute name / explicit --type, never by sniffing the value for
# commas — a legitimate string value could itself contain one.
LIST_ATTRIBUTES=("additional_eans")
is_list_attribute() {
	local attr="$1"
	for a in "${LIST_ATTRIBUTES[@]}"; do
		[[ "$attr" == "$a" ]] && return 0
	done
	return 1
}

if [[ "$TYPE" == "list" ]] || is_list_attribute "$ATTRIBUTE"; then
	IFS=',' read -ra ITEMS <<< "$VALUE"
	VALUE_JSON="{\"L\":["
	first=true
	for item in "${ITEMS[@]}"; do
		trimmed="$(echo -n "$item" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
		$first || VALUE_JSON+=","
		VALUE_JSON+="{\"S\":\"${trimmed}\"}"
		first=false
	done
	VALUE_JSON+="]}"
elif [[ "$VALUE" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
	VALUE_JSON="{\"N\":\"$VALUE\"}"
else
	VALUE_JSON="{\"S\":\"$VALUE\"}"
fi

TABLE="${STAGE}-${STORE}-catalog"
KEY="{\"ID\":{\"S\":\"ATT#${ATTRIBUTE}\"},\"SKU\":{\"S\":\"${SKU}\"}}"

echo "Setting ATT#${ATTRIBUTE} on ${SKU} (table: ${TABLE}) to: ${VALUE}"

aws dynamodb update-item --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--key "$KEY" \
	--update-expression "SET #v = :v" \
	--expression-attribute-names '{"#v":"Value"}' \
	--expression-attribute-values "{\":v\":${VALUE_JSON}}" \
	--return-values ALL_NEW \
	--output json

echo ""
if [[ "$SKU" == PRD#* ]]; then
	echo "Done. Since Task 4 (BUSY-1047), this alone fans out immediately to every real variant of"
	echo "${SKU} — check with tail-logs.sh --lambda enrich --store ${STORE} for a 'Fanning ${SKU} out"
	echo "to N variant record(s).' line within a few seconds. Run find-product-variants.sh --store"
	echo "${STORE} --sku ${SKU} first if you want to know N ahead of time. Each of those variants (not"
	echo "just ${VIA_VARIANT}) then sits in the shared buffer for up to 3 minutes before the sender"
	echo "attempts delivery — check with check-status.sh or tail-logs.sh --lambda sender after that wait."
else
	echo "Done. If '${ATTRIBUTE}' is on the Manhattan allowlist, this fires within a few seconds —"
	echo "check with tail-logs.sh --lambda enrich --store ${STORE}. It then sits in the shared buffer"
	echo "for up to 3 minutes before the sender attempts to deliver it — check with check-status.sh or"
	echo "tail-logs.sh --lambda sender after that wait."
fi
