#!/usr/bin/env bash
# Read-only: resolves a variant's parent product SKU, given the variant's own SKU.
#
# product_group_id / sub_group_id / is_giftcard (new in Task 2 / BUSY-1046) live on the parent
# PRODUCT row, not the variant — trigger-test-change.sh needs a PRD#<id> for those, but
# test-skus.txt only lists safe VAR#<id> entries. This bridges the two: attribute rows are
# stored inverted (ID=ATT#<name>, SKU=<owner's key>), and the product-attribute-index GSI flips
# that around (partition key = the main table's SKU), so querying it with SKU = VAR#<id> returns
# every ATT# row for that variant PLUS the variant's own root row — and the root row's ID field
# IS the parent product's numeric ID (variants share their parent's partition key). This prints
# that root row's ID as PRD#<id>, ready to feed into trigger-test-change.sh --sku / --via-variant.
#
# Usage: ./find-parent-product.sh --stage <stage> --profile <profile> --sku <VAR#id> [--store <us|ps>]
# Example: ./find-parent-product.sh --stage staging --profile staging --sku VAR#34157244
# Example (PS store): ./find-parent-product.sh --stage staging --profile staging --store ps --sku VAR#12345678
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
STORE="us"
SKU=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		--sku) SKU="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$SKU" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --sku <VAR#id> [--store <us|ps>]" >&2
	echo "Example: $0 --stage staging --profile staging --sku VAR#34157244" >&2
	exit 1
fi

if [[ "$STORE" != "us" && "$STORE" != "ps" ]]; then
	echo "--store must be 'us' or 'ps' — got: $STORE" >&2
	exit 1
fi

if [[ "$SKU" != VAR#* ]]; then
	echo "SKU must start with VAR# (a variant) — got: $SKU" >&2
	exit 1
fi

TABLE="${STAGE}-${STORE}-catalog"

RESULT=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--index-name product-attribute-index \
	--key-condition-expression "SKU = :sku" \
	--expression-attribute-values "{\":sku\":{\"S\":\"${SKU}\"}}" \
	--output json)

echo "$RESULT" | python3 -c "
import json, sys
items = json.load(sys.stdin).get('Items', [])
for item in items:
	id_val = item['ID']['S']
	if not id_val.startswith('ATT#'):
		print(f'PRD#{id_val}')
		sys.exit(0)
sys.stderr.write('No root row (an ID without an ATT# prefix) found for $SKU on $TABLE — is it a real variant?\n')
sys.exit(1)
"
