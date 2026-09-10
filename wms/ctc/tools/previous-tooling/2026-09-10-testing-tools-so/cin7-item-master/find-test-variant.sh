#!/usr/bin/env bash
# Read-only helper: scans a store's catalog table for a real product/variant pair to use as a
# test target, and prints its current allowlisted attributes so you know what you're starting
# from. This does NOT add anything to test-skus.txt for you — do that yourself once you've picked
# one, so the allowlist stays a deliberate, reviewed list rather than something a script
# maintains. test-skus.txt is shared across both stores — note which store each entry belongs to.
#
# Usage: ./find-test-variant.sh --stage <stage> --profile <profile> [--store <us|ps>] [--limit <n>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
STORE="us"
LIMIT=5

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		--limit) LIMIT="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--store <us|ps>] [--limit <n>]" >&2
	exit 1
fi

if [[ "$STORE" != "us" && "$STORE" != "ps" ]]; then
	echo "--store must be 'us' or 'ps' — got: $STORE" >&2
	exit 1
fi

TABLE="${STAGE}-${STORE}-catalog"

echo "Scanning $TABLE for a product with at least one variant (read-only, no writes)..."
echo ""

# Find genuine PRD# root rows. Attribute rows are stored with ID=ATT#<name> and
# SKU=<owner's key> — a product-level attribute row also has SKU starting with PRD#, so it must
# be explicitly excluded here or it gets mistaken for the product root row itself.
products_json=$(aws dynamodb scan --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--filter-expression "begins_with(SKU, :prd) AND NOT begins_with(ID, :att)" \
	--expression-attribute-values '{":prd":{"S":"PRD#"},":att":{"S":"ATT#"}}' \
	--max-items "$LIMIT" \
	--output json)

echo "$products_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data.get('Items', []):
    sku = item.get('SKU', {}).get('S', '')
    pid = item.get('ID', {}).get('S', '')
    if sku and pid:
        print(f'Product {sku} (ID {pid})')
"

echo ""
echo "For any product ID above, list its variants with:"
echo "  aws dynamodb query --profile $PROFILE --region $REGION --table-name $TABLE \\"
echo "    --key-condition-expression 'ID = :id' --expression-attribute-values '{\":id\":{\"S\":\"<product-id>\"}}'"
echo ""
echo "Then confirm a variant's current attributes with:"
echo "  aws dynamodb query --profile $PROFILE --region $REGION --table-name $TABLE \\"
echo "    --index-name product-attribute-index --key-condition-expression 'SKU = :sku' \\"
echo "    --expression-attribute-values '{\":sku\":{\"S\":\"VAR#<variant-id>\"}}'"
echo ""
echo "Once you've picked a variant to reuse for testing, add its VAR#<id> to test-skus.txt (make sure to note which store it belongs to, since the file is shared across both)."
