#!/usr/bin/env bash
# Emulates a real NetSuite payload arriving at Layer A (the erp-update Lambda) for BUSY-1045's
# dimension/UOM/product-group/sub-group/displayname fields — end-to-end testing of the FULL chain
# (NetSuite payload -> rules.ts extraction -> mappings-table filter -> Catalog write -> Layer B ->
# Manhattan), not just Layer B on its own like trigger-test-change.sh does.
#
# This is a fundamentally different kind of write than trigger-test-change.sh: that script does a
# single, surgical DynamoDB update-item on one attribute. This one invokes the real erp-update
# Lambda with a synthetic NetSuite event, which re-runs EVERY rule in productRules/variantRules
# against whatever the payload contains. Any rule whose source data is missing from the payload
# resolves to `undefined` — and CatalogDb.setProductAttributes() does NOT special-case that: it
# writes an ATT#<key> row with an undefined Value regardless. Left unhandled, that would silently
# wipe out real attributes (weight, size, colour, ean, etc.) on the shared test-skus.txt variants
# that other tasks' tests also rely on.
#
# So before building the payload, this script reads the target variant's AND its real parent
# product's CURRENT attribute values from DynamoDB, and reconstructs a raw NetSuite payload that
# reproduces every one of them (reversing the handful of rules.ts transforms where needed —
# category's text<->code table, capitaliseText/stripHTML idempotency, etc.) — so re-running the
# extraction is a safe no-op for every field except the ones under test, which get set to your
# supplied (or sensible default) values on top.
#
# Safety: same allowlist as trigger-test-change.sh (test-skus.txt, shared across both stores) —
# refuses any SKU not listed there; make sure the SKU actually exists on the store you pass via
# --store. Defaults to a dry run (prints the reconstructed payload + a before/after summary of
# the fields under test, no Lambda invocation) — pass --confirm to actually invoke.
#
# Usage:
#   ./trigger-netsuite-update.sh --stage <stage> --profile <profile> --sku <VAR#id> [--store <us|ps>] [options] [--confirm]
#
# Options (all optional — sensible defaults are used for anything not passed):
#   --store <us|ps>         (default: us)
#   --height <n>            (default: 99.9)
#   --length <n>            (default: 88.8)
#   --width <n>             (default: 77.7)
#   --dimension-uom <s>     (default: CM)
#   --conversion-rate <n>   (default: 2)
#   --qty-uom <s>           (default: EA)
#   --weight-uom <s>        (default: KG)
#   --product-group-id <n>  (default: 42)   raw NetSuite id, pre-padding — rules.ts pads to 3 digits
#   --sub-group-id <n>      (default: 7)    raw NetSuite id, pre-padding — rules.ts pads to 3 digits
#   --displayname <s>       (default: "QA E2E Test <sku> <timestamp>")
#
# Example (dry run):     ./trigger-netsuite-update.sh --stage staging --profile staging --sku VAR#34157244
# Example (real send):   ./trigger-netsuite-update.sh --stage staging --profile staging --sku VAR#34157244 --height 15.2 --confirm
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST=""

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
STORE="us"
SKU=""
CONFIRM="false"

HEIGHT="99.9"
LENGTH="88.8"
WIDTH="77.7"
DIMENSION_UOM="CM"
CONVERSION_RATE="2"
QTY_UOM="EA"
WEIGHT_UOM="KG"
PRODUCT_GROUP_ID="42"
SUB_GROUP_ID="7"
DISPLAYNAME=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		--sku) SKU="$2"; shift 2 ;;
		--allowlist) ALLOWLIST="$2"; shift 2 ;;
		--height) HEIGHT="$2"; shift 2 ;;
		--length) LENGTH="$2"; shift 2 ;;
		--width) WIDTH="$2"; shift 2 ;;
		--dimension-uom) DIMENSION_UOM="$2"; shift 2 ;;
		--conversion-rate) CONVERSION_RATE="$2"; shift 2 ;;
		--qty-uom) QTY_UOM="$2"; shift 2 ;;
		--weight-uom) WEIGHT_UOM="$2"; shift 2 ;;
		--product-group-id) PRODUCT_GROUP_ID="$2"; shift 2 ;;
		--sub-group-id) SUB_GROUP_ID="$2"; shift 2 ;;
		--displayname) DISPLAYNAME="$2"; shift 2 ;;
		--confirm) CONFIRM="true"; shift 1 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$SKU" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --sku <VAR#id> [--store <us|ps>] [options] [--confirm]" >&2
	echo "Run with no arguments... actually see the top of this script for the full option list." >&2
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

[[ -z "$ALLOWLIST" ]] && ALLOWLIST="${SCRIPT_DIR}/test-skus.txt"

if [[ ! -f "$ALLOWLIST" ]]; then
	echo "No allowlist file found at $ALLOWLIST — refusing to run." >&2
	exit 1
fi

if ! grep -qxF "$SKU" <(grep -v '^\s*#' "$ALLOWLIST" | grep -v '^\s*$'); then
	echo "'$SKU' is not in the allowlist ($ALLOWLIST) — refusing to run." >&2
	echo "This script only simulates NetSuite updates for SKUs you've explicitly listed as safe test data." >&2
	exit 1
fi

FUTURA_REF="${SKU#VAR#}"
TABLE="${STAGE}-${STORE}-catalog"
FUNCTION_NAME="${STAGE}-${STORE}-catalog-erp-update"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -z "$DISPLAYNAME" ]]; then
	DISPLAYNAME="QA E2E Test ${SKU} ${TIMESTAMP}"
fi

echo "Reading current attributes for ${SKU} (table: ${TABLE})..."
VARIANT_ATTRS_JSON=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--index-name product-attribute-index \
	--key-condition-expression "SKU = :sku" \
	--expression-attribute-values "{\":sku\":{\"S\":\"${SKU}\"}}" \
	--output json)

PARENT_SKU=$(echo "$VARIANT_ATTRS_JSON" | python3 -c "
import json, sys
items = json.load(sys.stdin).get('Items', [])
for item in items:
    id_val = item['ID']['S']
    if not id_val.startswith('ATT#'):
        print(f'PRD#{id_val}')
        sys.exit(0)
sys.stderr.write('No root row found for ${SKU} — is it a real variant?\n')
sys.exit(1)
")

echo "Resolved parent product: ${PARENT_SKU}"
echo "Reading current attributes for ${PARENT_SKU}..."
PRODUCT_ATTRS_JSON=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$TABLE" \
	--index-name product-attribute-index \
	--key-condition-expression "SKU = :sku" \
	--expression-attribute-values "{\":sku\":{\"S\":\"${PARENT_SKU}\"}}" \
	--output json)

PARENT_ID="${PARENT_SKU#PRD#}"

VARIANT_ATTRS_FILE="$(mktemp)"
PRODUCT_ATTRS_FILE="$(mktemp)"
echo "$VARIANT_ATTRS_JSON" > "$VARIANT_ATTRS_FILE"
echo "$PRODUCT_ATTRS_JSON" > "$PRODUCT_ATTRS_FILE"

# Everything from here is built in Python — reconstructing a raw NetSuite payload precisely
# enough to round-trip every existing rules.ts field losslessly (or via a known reverse-transform)
# is too fiddly to get right in bash string-building, and getting it wrong risks corrupting real
# shared test data. See the file header for why this reconstruction exists at all.
PAYLOAD_JSON=$(python3 - "$FUTURA_REF" "$PARENT_ID" "$TIMESTAMP" "$HEIGHT" "$LENGTH" "$WIDTH" \
	"$DIMENSION_UOM" "$CONVERSION_RATE" "$QTY_UOM" "$WEIGHT_UOM" "$PRODUCT_GROUP_ID" "$SUB_GROUP_ID" \
	"$DISPLAYNAME" "$VARIANT_ATTRS_FILE" "$PRODUCT_ATTRS_FILE" <<'PYEOF'
import json, sys

(futura_ref, parent_id, timestamp, height, length, width, dimension_uom, conversion_rate,
 qty_uom, weight_uom, product_group_id, sub_group_id, displayname,
 variant_attrs_file, product_attrs_file) = sys.argv[1:16]

with open(variant_attrs_file) as f:
	variant_attrs = json.load(f)
with open(product_attrs_file) as f:
	product_attrs = json.load(f)


def attr_map(query_result):
	"""ID (ATT#<name>) -> Value, for every attribute row in a product-attribute-index result.
	Handles both scalar (S/N/BOOL) and list (L) DynamoDB shapes."""
	out = {}
	for item in query_result.get('Items', []):
		id_val = item['ID']['S']
		if not id_val.startswith('ATT#'):
			continue
		name = id_val[len('ATT#'):]
		value = item.get('Value', {})
		if 'L' in value:
			out[name] = [v.get('S', v.get('N')) for v in value['L']]
		elif 'S' in value:
			out[name] = value['S']
		elif 'N' in value:
			out[name] = value['N']
		elif 'BOOL' in value:
			out[name] = value['BOOL']
	return out


v = attr_map(variant_attrs)
p = attr_map(product_attrs)

custom_fields = {}


def set_text(field, value):
	if value is not None:
		custom_fields[field] = {"text": value}


# --- Variant-level fields: reproduce current values for everything NOT under test ---
data = {
	"recordType": "inventoryitem",
	"id": v.get("netsuite_id", futura_ref),
	"itemId": f"{parent_id}-QATEST",
	"matrixType": "CHILD",
	"parent": parent_id,
	"vendorName": p.get("vendor_name", ""),
	"createdDate": v.get("netsuite_created_at", f"{timestamp[:4]}-{timestamp[4:6]}-{timestamp[6:8]}T00:00:00.000Z"),
	"upcCode": v.get("ean", ""),
	"inventory_policy": v.get("inventory_policy", ""),
	# --- Fields under test (BUSY-1045 Layer A) — always overridden, never reproduced ---
	"conversionRate": float(conversion_rate),
	"abbreviation": qty_uom,
	"customFields": custom_fields,
}

if "supplier_id" in v:
	data["vendors"] = [{"vendorItemCode": v["supplier_id"]}]

pricing_aud = []
if "price" in v:
	pricing_aud.append({"name": "Original Price", "price": float(v["price"])})
	pricing_aud.append({"name": "Base Price", "price": float(v["price"])})
if "sale_price" in v:
	pricing_aud.append({"name": "Selling Price", "price": float(v["sale_price"])})
if pricing_aud:
	data["pricing"] = {"AUD": pricing_aud}
if "nzd_price" in v:
	data.setdefault("pricing", {})["NZD"] = [{"name": "Selling Price", "price": float(v["nzd_price"])}]

set_text("custitem_supplier_size_name", v.get("size"))
if "cost_price" in v:
	set_text("custitem_cost_price", v["cost_price"])
if "weight" in v:
	set_text("custitem_packing_weight", v["weight"])
if "additional_eans" in v:
	eans = v["additional_eans"] if isinstance(v["additional_eans"], list) else [v["additional_eans"]]
	custom_fields["custitem_barcodes"] = {"text": "\n".join(eans)}

custom_fields["custitem_futura_ref"] = {"text": int(futura_ref)}

# The under-test dimension/UOM fields — always the supplied/default value, never the current one.
custom_fields["custitem_id_height"] = {"text": height}
custom_fields["custitem_id_length"] = {"text": length}
custom_fields["custitem_id_width"] = {"text": width}
custom_fields["custitem_id_uom"] = {"text": dimension_uom}
custom_fields["custitem_packing_weight_uom"] = {"text": weight_uom}
# qty_uom sources a top-level `abbreviation` field (see `data`, above), not customFields.uomList —
# rules.ts moved off the nested uomList[0].abbreviation shape during BUSY-1045's code review.

# --- Product-level fields: reproduce current values for everything NOT under test ---
data["displayName"] = displayname  # under test

if "tax_free" in p:
	data["taxSchedule"] = {"name": "non-taxable" if p["tax_free"] in (True, "true", "True") else "taxable"}

set_text("custitem_fibre", p.get("fibre"))
set_text("custitem_image_url", p.get("futura_image"))
set_text("custitem_wash_type", p.get("wash_type"))
set_text("custitem_extra_description", p.get("description"))
set_text("custitem_sales_area", p.get("sales_area"))
set_text("custitem_material_description", p.get("material_description"))
set_text("custitem_supplier_colour_name", p.get("detailed_colour"))

if "vendor" in p:
	custom_fields["custitem_brand"] = {"selected": {"text": p["vendor"]}}
if "gender" in p:
	custom_fields["custitem_gender"] = {"selected": {"text": p["gender"]}}
if "colour" in p:
	custom_fields["custitem_matrix_colour"] = {"selected": [{"name": p["colour"]}]}

# category is a text<->code lookup (rules.ts's own transformValue table) — reverse it so the
# existing category is reproduced faithfully rather than lost. "Accessories" is ambiguous
# (footwear and accessories & gifts both can map there) — "accessories" is the chosen reverse.
CATEGORY_REVERSE = {"Clothing": "apparel", "Shoes": "footwear", "Accessories": "accessories"}
division_text = CATEGORY_REVERSE.get(p.get("category"))

# sub_group / sub_group_id and product_group / product_group_id share one raw NetSuite field each
# (custitem_sub_category / custitem_product_group) — .text is the existing display text
# (reproduced), .id is this task's actual field under test (always overridden).
sub_category = {"selected": {"id": sub_group_id}}
if "sub_group" in p:
	sub_category["selected"]["text"] = p["sub_group"]
custom_fields["custitem_sub_category"] = sub_category

product_group = {"selected": {"id": product_group_id}}
if "product_group" in p:
	product_group["selected"]["text"] = p["product_group"]
custom_fields["custitem_product_group"] = product_group

if division_text:
	custom_fields["custitem_division"] = {"selected": {"text": division_text}}

payload = {
	"events": [
		{
			"name": "item.updated",
			"published_at": f"{timestamp[:4]}-{timestamp[4:6]}-{timestamp[6:8]}T{timestamp[9:11]}:{timestamp[11:13]}:{timestamp[13:15]}.000Z",
			"account": "QA-E2E-TEST",
			"data": data,
		}
	]
}

summary = {
	"variant_current": {
		k: v[k] for k in ("height", "length", "width", "dimension_uom", "conversion_rate", "qty_uom", "weight_uom") if k in v
	},
	"variant_new": {
		"height": height, "length": length, "width": width, "dimension_uom": dimension_uom,
		"conversion_rate": conversion_rate, "qty_uom": qty_uom, "weight_uom": weight_uom,
	},
	"product_current": {
		k: p[k] for k in ("product_group_id", "sub_group_id", "displayname") if k in p
	},
	"product_new": {
		"product_group_id_raw": product_group_id, "sub_group_id_raw": sub_group_id, "displayname": displayname,
	},
}

sys.stderr.write(json.dumps(summary, indent=2) + "\n")
print(json.dumps(payload, indent=2))
PYEOF
)
rm -f "$VARIANT_ATTRS_FILE" "$PRODUCT_ATTRS_FILE"

echo ""
echo "=== Reconstructed synthetic NetSuite payload ==="
echo "$PAYLOAD_JSON"
echo ""

if [[ "$CONFIRM" != "true" ]]; then
	echo "=== DRY RUN — no Lambda invoked ==="
	echo "The summary above (on stderr) shows current vs. new values for the fields under test."
	echo "Every other field the rules produce has been reconstructed from ${SKU}/${PARENT_SKU}'s"
	echo "current real attributes, so re-running extraction should be a safe no-op for them."
	echo "Re-run with --confirm to actually invoke ${FUNCTION_NAME}."
	exit 0
fi

echo "=== Invoking ${FUNCTION_NAME} ==="
TMPFILE="$(mktemp)"
echo "$PAYLOAD_JSON" > "$TMPFILE"
RESPONSE_FILE="$(mktemp)"

aws lambda invoke --profile "$PROFILE" --region "$REGION" \
	--function-name "$FUNCTION_NAME" \
	--cli-binary-format raw-in-base64-out \
	--payload "file://${TMPFILE}" \
	"$RESPONSE_FILE"

echo ""
echo "=== erp-update response ==="
cat "$RESPONSE_FILE"
echo ""
rm -f "$TMPFILE" "$RESPONSE_FILE"

echo ""
echo "Done. This fires the same enrich -> buffer -> sender chain as trigger-test-change.sh —"
echo "check with tail-logs.sh --lambda enrich --store ${STORE} (should fire within seconds), then"
echo "wait up to 3 minutes and check tail-logs.sh --lambda sender for the outgoing XML and"
echo "Manhattan's response. Confirm nothing's stuck afterward with check-status.sh."