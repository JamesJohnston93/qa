#!/usr/bin/env bash
# Builds and (optionally) emits a synthetic Cin7-shaped CREATE_OUTBOUND_ORDER transaction onto
# staging-orders-v2-event-bus, seeded from a real persisted ECOM order's current rows for shape,
# with the header re-typed as WHOLESALE/RTV and a delivery-company or person-name address.
#
# Ticket:      BUSY-1160
# Cases:       TC2 (record family), TC3 (multi-size per-row quantity), Q40 (does ShipTo actually
#              carry the delivery company at runtime)
# Asserts:     the constructed EventBridge entry (Source, DetailType, EventBusName, Detail key set)
#              matches the shape the poller's own buildOutboundOrderCommand/deriveShipTo/
#              deriveShipToAddress/expandLineItems2 construct for a WHOLESALE/RTV order, MEASURED
#              by direct source read of staging-orders-cin7-so-poller (slice 08, results/08). This
#              is a DIFFERENT command shape from emit-synthetic-revision.sh's CREATE_ORDER --
#              outboundOrderInfo/outboundItemInfo/category:"OUTBOUND" instead of orderInfo/
#              itemChanges/category:"CHARGE" -- because that is what the real poller actually sends
#              for these order types (isOutboundOrderType routes WHOLESALE/RTV through
#              createOutboundOrder, never through the native create-order path).
# Does NOT:    prove the poller itself would ever construct this from a real Cin7 order (that is
#              Q35/TC4, upstream of injection's reach -- contact-group resolution happens inside
#              the poller). Does NOT replicate the real hashPayload/hashMappedPayload2 algorithms
#              (unknown without a code read of their implementation, only their call sites were
#              read) -- --hash is a fresh random 8-hex string, never a real hash of the payload.
#              Does NOT construct the "empty ShipTo" refusal case: that guard
#              (deriveShipTo throwing when neither deliveryCompany nor a person name exists) fires
#              INSIDE the poller before any transaction is built, so no downstream injection can
#              reach it -- it can only be confirmed by the code read already in
#              results/08-final-sweep-before-dev.md, never by emitting.
# Side effects: read only when --dry-run (the default, and the only mode without --emit). Writes to
#              staging-orders-v2-event-bus, and can reach Manhattan SCALE staging if the downstream
#              outbound pipeline sends it, when --emit is passed.
#              --emit is hard-refused unless --out-reference starts with "QASYN-".
#
# Usage: ./emit-synthetic-outbound-order.sh --stage <stage> --profile <profile> \
#          --seed-reference <real ECOM ref, shape only> --out-reference <QASYN-...> \
#          --order-type WHOLESALE|RTV [--delivery-company "<name>"] [--multi-size] \
#          --modified-date <ISO8601> [--hash <8hex>] [--emit] [--region <region>]
#
# --delivery-company sets outboundOrderInfo.shipTo to that literal string, matching
# deriveShipTo(order)'s first branch (checked before any person name). Omit it to fall back to a
# placeholder person name instead, matching deriveShipTo's second branch.
# --multi-size builds two outboundItemInfo rows sharing one lineId with different size codes and
# quantities (SK: ITEM#<lineId>#<code>), for TC3's "one row per size with a quantity" assertion.
# Without it, one item row is built from the seed's own first item.
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
SEED_REFERENCE=""
OUT_REFERENCE=""
ORDER_TYPE=""
DELIVERY_COMPANY=""
WAREHOUSE_OVERRIDE=""
MULTI_SIZE=false
MODIFIED_DATE=""
HASH_OVERRIDE=""
DO_EMIT=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--seed-reference) SEED_REFERENCE="$2"; shift 2 ;;
		--out-reference) OUT_REFERENCE="$2"; shift 2 ;;
		--order-type) ORDER_TYPE="$2"; shift 2 ;;
		--delivery-company) DELIVERY_COMPANY="$2"; shift 2 ;;
		--warehouse) WAREHOUSE_OVERRIDE="$2"; shift 2 ;;
		--multi-size) MULTI_SIZE=true; shift ;;
		--modified-date) MODIFIED_DATE="$2"; shift 2 ;;
		--hash) HASH_OVERRIDE="$2"; shift 2 ;;
		--emit) DO_EMIT=true; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$SEED_REFERENCE" || -z "$OUT_REFERENCE" || -z "$ORDER_TYPE" || -z "$MODIFIED_DATE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --seed-reference <ref> --out-reference <QASYN-ref> --order-type <WHOLESALE|RTV> --modified-date <ISO8601> [--delivery-company <name>] [--multi-size] [--hash <8hex>] [--emit]" >&2
	exit 1
fi

case "$ORDER_TYPE" in
	WHOLESALE|RTV) ;;
	*) echo "--order-type must be WHOLESALE or RTV" >&2; exit 1 ;;
esac

if [[ ${#OUT_REFERENCE} -ge 25 ]]; then
	echo "Refusing: --out-reference '$OUT_REFERENCE' is ${#OUT_REFERENCE} characters, at or over the 25-char SCALE ShipmentId ceiling." >&2
	exit 1
fi

if [[ "$DO_EMIT" == "true" && "$OUT_REFERENCE" != QASYN-* ]]; then
	echo "Refusing to emit: --out-reference '$OUT_REFERENCE' does not start with QASYN-." >&2
	echo "Emitting under a real-looking reference is exactly what the register exists to prevent." >&2
	exit 1
fi

RAW_FILE=$(mktemp)
trap 'rm -f "$RAW_FILE"' EXIT

SEED_ORIGIN="CTC#CIN7_SO#${SEED_REFERENCE}"
aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "${STAGE}-orders-v2" --index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${SEED_ORIGIN}\"}}" \
	--output json > "$RAW_FILE"

python3 - "$RAW_FILE" "$SEED_REFERENCE" "$OUT_REFERENCE" "$ORDER_TYPE" "$DELIVERY_COMPANY" "$MULTI_SIZE" "$MODIFIED_DATE" "$HASH_OVERRIDE" "$DO_EMIT" "$STAGE" "$PROFILE" "$REGION" "$WAREHOUSE_OVERRIDE" <<'PY'
import json
import random
import subprocess
import sys
import uuid

(raw_path, seed_reference, out_reference, order_type, delivery_company, multi_size_str,
 modified_date, hash_override, do_emit_str, stage, profile, region, warehouse_override) = sys.argv[1:14]
multi_size = multi_size_str == "true"
do_emit = do_emit_str == "true"

WAREHOUSE_BY_ORDER_TYPE = {"WHOLESALE": "CTC-WH", "RTV": "CTC-QDC"}

PLACEHOLDER_PERSON = {
    "firstName": "Qasyn",
    "lastName": "Synthetic",
}
PLACEHOLDER_ADDRESS = {
    "street1": "1 Synthetic Street",
    "city": "Testville",
    "state": "NSW",
    "postalCode": "0000",
    "country": "Australia",
    "countryCode": "AU",
}


def unwrap(v):
    if "S" in v:
        return v["S"]
    if "N" in v:
        return v["N"]
    if "BOOL" in v:
        return v["BOOL"]
    if "NULL" in v:
        return None
    if "M" in v:
        return {k: unwrap(x) for k, x in v["M"].items()}
    if "L" in v:
        return [unwrap(x) for x in v["L"]]
    return v


raw = json.load(open(raw_path))
rows = [{k: unwrap(v) for k, v in it.items()} for it in raw.get("Items", [])]

order_rows = [r for r in rows if r.get("SK") == "ORDER"]
item_rows = [r for r in rows if str(r.get("SK", "")).startswith("ITEM#")]

if not order_rows:
    print(f"No ORDER row found for origin CTC#CIN7_SO#{seed_reference}. Nothing to seed shape from.",
          file=sys.stderr)
    sys.exit(1)
if not item_rows:
    print(f"No ITEM rows found for origin CTC#CIN7_SO#{seed_reference}. Need at least one to seed an item shape.",
          file=sys.stderr)
    sys.exit(1)

seed_order = order_rows[0]
template_item = item_rows[0]

order_id = str(uuid.uuid4())
origin = f"CTC#CIN7_SO#{out_reference}"

# --- ShipTo, matching deriveShipTo(order)'s own priority: deliveryCompany first, else a person
# name. The "neither present" refusal branch fires inside the poller before any transaction is
# built, so it cannot be constructed here -- see the script header.
if delivery_company:
    ship_to = delivery_company
else:
    ship_to = f"{PLACEHOLDER_PERSON['firstName']} {PLACEHOLDER_PERSON['lastName']}"

ship_to_address = {
    "name": ship_to,
    "street1": PLACEHOLDER_ADDRESS["street1"],
    "city": PLACEHOLDER_ADDRESS["city"],
    "state": PLACEHOLDER_ADDRESS["state"],
    "postalCode": PLACEHOLDER_ADDRESS["postalCode"],
    "country": PLACEHOLDER_ADDRESS["country"],
    "countryCode": PLACEHOLDER_ADDRESS["countryCode"],
}

# --- items, matching expandLineItems2's SK: ITEM#<lineItems[].id>#<size code> shape.
line_id = template_item.get("lineItemId") or "9199199"
if multi_size:
    items = [
        {"SK": f"ITEM#{line_id}#M", "lineId": str(line_id), "sku": template_item.get("sku", "QASYN-SKU"), "quantity": 2},
        {"SK": f"ITEM#{line_id}#L", "lineId": str(line_id), "sku": template_item.get("sku", "QASYN-SKU"), "quantity": 1},
    ]
else:
    items = [
        {"SK": f"ITEM#{line_id}#M", "lineId": str(line_id), "sku": template_item.get("sku", "QASYN-SKU"), "quantity": 3},
    ]

if hash_override:
    payload_hash = hash_override
else:
    payload_hash = "".join(random.choice("0123456789abcdef") for _ in range(8))

warehouse = warehouse_override or WAREHOUSE_BY_ORDER_TYPE[order_type]
carrier = seed_order.get("carrier", "UNASSIGNED")
cin7_id = int(seed_order.get("cin7Id", "0") or 0)

order_info = {
    "store": "CTC",
    "originSystem": "CIN7_SO",
    "originId": out_reference,
    "cin7Id": cin7_id,
    "orderType": order_type,
    "warehouse": warehouse,
    "carrier": carrier,
    "allocateComplete": "Y" if order_type == "WHOLESALE" else "N",
    "shipTo": ship_to,
    "shipToAddress": ship_to_address,
    "orderedAt": seed_order.get("orderedAt", modified_date),
    "sourceStatus": "APPROVED",
    "sourceStage": "New",
    "lastModified": modified_date,
    "lastEmittedPayloadHash": payload_hash,
}

idempotency_id = f"CREATE_OUTBOUND_ORDER#{origin}#{modified_date}#{payload_hash}"

customer_email = "qasyn-synthetic@example.invalid"

detail = {
    "orderId": order_id,
    "origin": origin,
    "idempotencyId": idempotency_id,
    "message_group_id": order_id,
    "customerEmail": customer_email,
    "outboundOrderInfo": order_info,
    "outboundItemInfo": items,
    "category": "OUTBOUND",
    "event": "CREATE_OUTBOUND_ORDER",
}

entry = {
    "Source": "orders-cin7.cin7-so-poller.lambda",
    "DetailType": "CREATE_TRANSACTION",
    "EventBusName": f"{stage}-orders-v2-event-bus",
    "Detail": json.dumps(detail),
}

print(f"Seed: {seed_reference} (shape only)  Out: {out_reference}  orderType: {order_type}")
print(f"orderId/message_group_id: {order_id}")
print(f"shipTo: {ship_to!r}  multi_size: {multi_size}  items: {len(items)}")
print(f"idempotencyId: {idempotency_id}")
print()
print("Constructed Entry (customer fields are placeholders, safe to show as-is):")
print(json.dumps({
    "Source": entry["Source"],
    "DetailType": entry["DetailType"],
    "EventBusName": entry["EventBusName"],
    "Detail": detail,
}, indent=2))

if not do_emit:
    print()
    print("DRY RUN. Nothing sent. Pass --emit to actually PutEvents.")
    sys.exit(0)

print()
print("EMITTING...")
put_events_input = json.dumps({"Entries": [entry]})
result = subprocess.run(
    ["aws", "events", "put-events", "--profile", profile, "--region", region,
     "--cli-input-json", put_events_input],
    capture_output=True, text=True,
)
print("aws events put-events exit code:", result.returncode)
print(result.stdout)
if result.stderr:
    print(result.stderr, file=sys.stderr)
if result.returncode != 0:
    sys.exit(result.returncode)
try:
    resp = json.loads(result.stdout)
    if resp.get("FailedEntryCount", 0) > 0:
        print("FailedEntryCount > 0 -- see Entries[0] above for the error code/message.",
              file=sys.stderr)
        sys.exit(1)
except json.JSONDecodeError:
    pass
PY
