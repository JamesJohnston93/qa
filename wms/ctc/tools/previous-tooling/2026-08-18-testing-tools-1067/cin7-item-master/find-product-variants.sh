#!/usr/bin/env bash
# Read-only: lists every variant SKU under a given parent product — the reverse of
# find-parent-product.sh. Needed for Task 4 (BUSY-1047) testing: fanning out a PRD#-level
# change (product_group_id, sub_group_id, vendor_name, is_giftcard) emits one fresh record per
# variant of that product, so confirming the fan-out actually reached "all of its variants"
# means knowing what that full set is first.
#
# Product/variant root rows share their parent's partition key (ID = the product's numeric id) —
# the product's own root row has SKU=PRD#<id>, each variant's has SKU=VAR#<variant-id>. This is
# a plain query on the table's primary key (ID = :id AND begins_with(SKU, "VAR#")), the same
# query CatalogDb.getProductVariants() runs — no GSI involved, unlike find-parent-product.sh.
#
# Usage: ./find-product-variants.sh --stage <stage> --profile <profile> --sku <PRD#id> [--store <us|ps>]
# Example: ./find-product-variants.sh --stage staging --profile staging --sku PRD#411843
# Example (PS store): ./find-product-variants.sh --stage staging --profile staging --store ps --sku PRD#98765
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
	echo "Usage: $0 --stage <stage> --profile <profile> --sku <PRD#id> [--store <us|ps>]" >&2
	echo "Example: $0 --stage staging --profile staging --sku PRD#411843" >&2
	exit 1
fi

if [[ "$STORE" != "us" && "$STORE" != "ps" ]]; then
	echo "--store must be 'us' or 'ps' — got: $STORE" >&2
	exit 1
fi

if [[ "$SKU" != PRD#* ]]; then
	echo "SKU must start with PRD# (a product) — got: $SKU" >&2
	echo "Have a VAR#<id> instead? Run find-parent-product.sh first to resolve its PRD#<id>." >&2
	exit 1
fi

PRODUCT_ID="${SKU#PRD#}"
TABLE="${STAGE}-${STORE}-catalog"

RESULT=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--key-condition-expression "#id = :id AND begins_with(#sku, :prefix)" \
	--expression-attribute-names '{"#id":"ID","#sku":"SKU"}' \
	--expression-attribute-values "{\":id\":{\"S\":\"${PRODUCT_ID}\"},\":prefix\":{\"S\":\"VAR#\"}}" \
	--output json)

echo "$RESULT" | python3 -c "
import json, sys
items = json.load(sys.stdin).get('Items', [])
skus = sorted(item['SKU']['S'] for item in items)
if not skus:
	sys.stderr.write('No VAR# rows found under $SKU on $TABLE — is the product id right?\n')
	sys.exit(1)
for sku in skus:
	print(sku)
sys.stderr.write(f'{len(skus)} variant(s) found under $SKU.\n')
"
