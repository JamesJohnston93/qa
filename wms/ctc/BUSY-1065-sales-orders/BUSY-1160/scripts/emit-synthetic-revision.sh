#!/usr/bin/env bash
# Builds and (optionally) emits a synthetic Cin7-shaped transaction onto staging-orders-v2-event-bus,
# seeded from a real persisted CTC order's current rows in staging-orders-v2.
#
# Ticket:      BUSY-1160
# Cases:       TC12, foundation for slices 04 and 05
# Asserts:     the constructed EventBridge entry (Source, DetailType, EventBusName, Detail key set
#              and values) matches the shape a real poller emit uses, measured directly from one
#              real "Pushed ... to EventBridge" CloudWatch log line for a CREATE_ORDER (RequestId
#              f624e53d, order #262208, 2026-09-07) -- not assumed from the LLD or from CLAUDE.md's
#              simplified prose. See results/03-synthetic-harness-and-fidelity.md Gate A for the
#              full field-by-field comparison this measurement is based on.
# Does NOT:    prove a mutation-carrying emit produces a correct downstream result -- only that it
#              is constructed and routed the way the poller's own real emit is measured to be. A
#              clean run proves the handler behaved given this input, not that this input occurs in
#              real Cin7 traffic.
#              Does NOT replicate the real poller's payloadHash algorithm (unknown, would need a
#              code read) -- --hash is either a caller-supplied value or a fresh random 8-hex
#              string, never a real hash of the payload content.
#              itemChanges.added is assumed to always carry the FULL current line set for that
#              revision (per CLAUDE.md/LLD: "the poller does no diffing"), not a delta -- this is
#              INFERRED, not measured: the one real Pushed line available is a CREATE, where "the
#              full set" and "only what's added" are indistinguishable (everything is new on first
#              sight). No real UPDATE_ORDER/CANCEL_ORDER emit exists yet to settle this directly.
#              Does NOT recompute subtotal/grandTotal/taxPaid to reflect a line mutation -- totals
#              pass through from the seed order unchanged regardless of --mutation.
#              Does NOT fabricate a distinct fake Cin7 numeric id -- cin7Id passes through from the
#              seed order, so it is not unique to the synthetic record the way the reference is.
# Side effects: read only when --dry-run (the default, and the only mode without --emit). Writes to
#              staging-orders-v2-event-bus, reaching Manhattan SCALE staging, when --emit is passed.
#              --emit is hard-refused unless --out-reference starts with "QASYN-".
#
# Usage: ./emit-synthetic-revision.sh --stage <stage> --profile <profile> \
#          --seed-reference <ref> --event CREATE_ORDER|UPDATE_ORDER|CANCEL_ORDER \
#          --mutation none|add-line|remove-line|change-qty|change-address|cancel|bump-modified \
#          [--out-reference <ref>] [--modified-date <ISO8601>] [--hash <8hex>] \
#          [--source-stage <value>] [--emit] [--region <region>]
#
# --out-reference defaults to --seed-reference (a "self-revise": seed and target are the same
# already-synthetic order, used for TC12's second and later emits). Pass a QASYN-<seq>-<case>
# value explicitly the first time a new synthetic order is created from a real seed.
#
# --source-stage overrides orderInfo.sourceStage on the constructed payload only (added slice 05,
# for TC16 and the Q30 picked-stage arm). Every other mutation still passes sourceStage through
# from the seed order unchanged; this is the only flag that can diverge from it, since a real
# poller emit always carries the order's actual current Cin7 stage and there is no other way to
# construct a payload claiming a different one. Independent of --mutation: combine with
# --mutation none to send a stage-only revision with no item/address change.
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
SEED_REFERENCE=""
OUT_REFERENCE=""
EVENT=""
MUTATION=""
MODIFIED_DATE=""
HASH_OVERRIDE=""
SOURCE_STAGE_OVERRIDE=""
DO_EMIT=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--seed-reference) SEED_REFERENCE="$2"; shift 2 ;;
		--out-reference) OUT_REFERENCE="$2"; shift 2 ;;
		--event) EVENT="$2"; shift 2 ;;
		--mutation) MUTATION="$2"; shift 2 ;;
		--modified-date) MODIFIED_DATE="$2"; shift 2 ;;
		--hash) HASH_OVERRIDE="$2"; shift 2 ;;
		--source-stage) SOURCE_STAGE_OVERRIDE="$2"; shift 2 ;;
		--emit) DO_EMIT=true; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$SEED_REFERENCE" || -z "$EVENT" || -z "$MUTATION" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --seed-reference <ref> --event <CREATE_ORDER|UPDATE_ORDER|CANCEL_ORDER> --mutation <none|add-line|remove-line|change-qty|change-address|cancel|bump-modified> [--out-reference <ref>] [--modified-date <ISO8601>] [--hash <8hex>] [--emit]" >&2
	exit 1
fi

if [[ -z "$OUT_REFERENCE" ]]; then
	OUT_REFERENCE="$SEED_REFERENCE"
fi

case "$EVENT" in
	CREATE_ORDER|UPDATE_ORDER|CANCEL_ORDER) ;;
	*) echo "--event must be CREATE_ORDER, UPDATE_ORDER or CANCEL_ORDER" >&2; exit 1 ;;
esac

case "$MUTATION" in
	none|add-line|remove-line|change-qty|change-address|cancel|bump-modified) ;;
	*) echo "--mutation must be one of none|add-line|remove-line|change-qty|change-address|cancel|bump-modified" >&2; exit 1 ;;
esac

if [[ "$MUTATION" == "cancel" && "$EVENT" != "CANCEL_ORDER" ]]; then
	echo "--mutation cancel requires --event CANCEL_ORDER" >&2
	exit 1
fi

# Hard safety guard, independent of every other flag: nothing emits under a non-QASYN reference.
if [[ "$DO_EMIT" == "true" && "$OUT_REFERENCE" != QASYN-* ]]; then
	echo "Refusing to emit: --out-reference '$OUT_REFERENCE' does not start with QASYN-." >&2
	echo "Emitting under a real-looking reference is exactly what the register exists to prevent." >&2
	echo "Drop --emit to see the constructed (dry-run) payload instead." >&2
	exit 1
fi

if [[ ${#OUT_REFERENCE} -ge 25 ]]; then
	echo "Refusing: --out-reference '$OUT_REFERENCE' is ${#OUT_REFERENCE} characters, at or over the 25-char SCALE ShipmentId ceiling." >&2
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

python3 - "$RAW_FILE" "$SEED_REFERENCE" "$OUT_REFERENCE" "$EVENT" "$MUTATION" "$MODIFIED_DATE" "$HASH_OVERRIDE" "$DO_EMIT" "$STAGE" "$PROFILE" "$REGION" "$SOURCE_STAGE_OVERRIDE" <<'PY'
import json
import random
import subprocess
import sys
import uuid

(raw_path, seed_reference, out_reference, event, mutation, modified_date_arg,
 hash_override, do_emit_str, stage, profile, region, source_stage_override) = sys.argv[1:13]
do_emit = do_emit_str == "true"
self_revise = out_reference == seed_reference

PLACEHOLDER = {
    "customerEmail": "qasyn-synthetic@example.invalid",
    "firstName": "Qasyn",
    "lastName": "Synthetic",
    "street1": "1 Synthetic Street",
    "city": "Testville",
    "postalCode": "0000",
    "state": "NSW",
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
addr_rows = [r for r in rows if r.get("SK") == "ADDRESS#SHIPPING"]

if not order_rows:
    print(f"No ORDER row found for origin CTC#CIN7_SO#{seed_reference}. Nothing to seed from.",
          file=sys.stderr)
    sys.exit(1)

order = order_rows[0]

if self_revise:
    order_id = order["PK"]
else:
    order_id = str(uuid.uuid4())

out_origin = f"CTC#CIN7_SO#{out_reference}"

if modified_date_arg:
    modified_date = modified_date_arg
elif self_revise and mutation in ("none",):
    modified_date = order["lastModified"]
else:
    print("--modified-date is required unless replaying an unmutated self-revise "
          "(mutation=none with out-reference==seed-reference).", file=sys.stderr)
    sys.exit(1)

if hash_override:
    payload_hash = hash_override
elif self_revise and mutation == "none" and modified_date == order["lastModified"]:
    # Gate A fidelity replay: compare against the seed's own stored hash, flagged separately in
    # the result file as a known, expected difference (the real hash algorithm is not replicated).
    payload_hash = order.get("lastEmittedPayloadHash", "00000000")
else:
    payload_hash = "".join(random.choice("0123456789abcdef") for _ in range(8))

# --- item construction -------------------------------------------------
def item_to_change(row, sku_override=None, line_id_override=None):
    # itemChanges.added.status must be one of the shared handler's own schema values
    # (OPEN/FULFILLED/FULFILLED_B2B/REFUNDED/RETURNED/UNDELIVERABLE/DELIVERED/PENDING_SEND/
    # PENDING_CREATE) -- "CANCELLED" is not among them, since that is a local-only flip this
    # system applies itself, never a status Cin7 reports back in a revision's full line set.
    # Self-revising an already-cancelled synthetic order would otherwise copy "CANCELLED"
    # straight through and fail schema validation at the shared transaction handler.
    row_status = row["status"]
    status = "OPEN" if row_status == "CANCELLED" else row_status
    return {
        "SK": row["SK"],
        "sku": sku_override or row["sku"],
        "lineItemId": line_id_override or row["lineItemId"],
        "status": status,
        "deliveryMethod": row["deliveryMethod"],
        "subtotal": float(row["subtotal"]),
        "grandTotal": float(row["grandTotal"]),
        "taxPaid": float(row["taxPaid"]),
        "costPrice": float(row["costPrice"]),
    }


if self_revise:
    base_items = [item_to_change(r) for r in item_rows]
else:
    # Template mode: this is a fresh synthetic order, not a copy of the real seed's own item rows.
    # Give each carried-over item a fresh SK so nothing in the synthetic record's key space ties
    # back to the real seed order it borrowed its shape from.
    fresh_rows = []
    for r in item_rows:
        fr = dict(r)
        fr["SK"] = f"ITEM#{uuid.uuid4()}"
        fresh_rows.append(fr)
    base_items = [item_to_change(r) for r in fresh_rows]

if mutation == "add-line":
    if not item_rows:
        print("No existing item to base a synthetic add-line item's pricing on.", file=sys.stderr)
        sys.exit(1)
    template = item_rows[0]
    new_sku = f"QASYN-SKU-{uuid.uuid4().hex[:6]}"
    # lineItemId must be numeric-shaped: the Manhattan-side handler explicitly refuses to send a
    # unit whose lineItemId does not parse as a number ("refusing to send a corrupted
    # ErpOrderLineNum to SCALE"), and a QASYN-prefixed string tripped that guard in testing. Real
    # Cin7 lineItemIds observed so far sit in the low 3.4-3.5 million range; 9xxxxxx stays
    # numeric-shaped (so it passes the real system's own validation) while staying visibly outside
    # that range.
    new_line_id = str(random.randint(9000000, 9999999))
    new_row = dict(template)
    new_row["SK"] = f"ITEM#{uuid.uuid4()}"
    items = base_items + [item_to_change(new_row, sku_override=new_sku, line_id_override=new_line_id)]
elif mutation == "change-qty":
    if not item_rows:
        print("No existing item to duplicate for a synthetic change-qty unit.", file=sys.stderr)
        sys.exit(1)
    template = item_rows[0]
    new_line_id = str(random.randint(9000000, 9999999))
    new_row = dict(template)
    new_row["SK"] = f"ITEM#{uuid.uuid4()}"
    items = base_items + [item_to_change(new_row, line_id_override=new_line_id)]
elif mutation == "remove-line":
    if len(item_rows) < 2:
        print("remove-line needs at least 2 existing items so one can remain after removal.",
              file=sys.stderr)
        sys.exit(1)
    items = base_items[:-1]
else:
    items = base_items

# --- address construction -----------------------------------------------
if self_revise and addr_rows:
    addr = addr_rows[0]
    shipping_address = {
        "firstName": addr["firstName"],
        "lastName": addr["lastName"],
        "street1": addr["street1"],
        "city": addr["city"],
        "state": addr["state"],
        "postalCode": addr["postalCode"],
        "country": addr["country"],
        "countryCode": addr["countryCode"],
    }
else:
    shipping_address = {
        "firstName": PLACEHOLDER["firstName"],
        "lastName": PLACEHOLDER["lastName"],
        "street1": PLACEHOLDER["street1"],
        "city": PLACEHOLDER["city"],
        "state": PLACEHOLDER["state"],
        "postalCode": PLACEHOLDER["postalCode"],
        "country": PLACEHOLDER["country"],
        "countryCode": PLACEHOLDER["countryCode"],
    }

if mutation == "change-address":
    shipping_address = dict(shipping_address)
    shipping_address["street1"] = "2 Changed Synthetic Street"
    shipping_address["city"] = "ChangedTestville"

customer_email = (order.get("customerEmail") if self_revise else None) or PLACEHOLDER["customerEmail"]

# --- assemble Detail ------------------------------------------------------
order_info = {
    "orderedAt": order["orderedAt"],
    "sourceStage": source_stage_override or order["sourceStage"],
    "sourceStatus": order["sourceStatus"],
    "allocatedStore": order["allocatedStore"],
    "lastEmittedPayloadHash": payload_hash,
    "carrier": order["carrier"],
    "orderType": order["orderType"],
    "scheduledShipDate": order["scheduledShipDate"],
    "packingBrand": order["packingBrand"],
    "lastModified": modified_date,
    "cin7Id": int(order["cin7Id"]),
    "warehouse": order["warehouse"],
}

idempotency_id = f"{event}#CTC#{out_reference}#{modified_date}#{payload_hash}"

detail = {
    "orderId": order_id,
    "origin": out_origin,
    "idempotencyId": idempotency_id,
    "message_group_id": order_id,
    "customerEmail": customer_email,
    "itemChanges": {"added": items},
    "paymentChanges": {
        "payments": [],
        "shipping": float(order.get("shipping", "0")),
        "subtotal": float(order.get("subtotal", "0")),
        "grandTotal": float(order.get("grandTotal", "0")),
        "taxPaid": float(order.get("taxPaid", "0")),
        "currency": order.get("currency", "AUD"),
    },
    "addressChanges": {"shipping": shipping_address},
    "orderInfo": order_info,
    "category": "CHARGE",
    "event": event,
}

entry = {
    "Source": "orders-cin7.cin7-so-poller.lambda",
    "DetailType": "CREATE_TRANSACTION",
    "EventBusName": f"{stage}-orders-v2-event-bus",
    "Detail": json.dumps(detail),
}

import os
if os.environ.get("EMIT_DEBUG_DUMP"):
    with open(os.environ["EMIT_DEBUG_DUMP"], "w") as fh:
        json.dump(detail, fh, indent=2)

print(f"Seed: {seed_reference} (self-revise={self_revise})  Out: {out_reference}")
print(f"orderId/message_group_id: {order_id}")
print(f"event: {event}  mutation: {mutation}  items: {len(items)}")
if source_stage_override:
    print(f"sourceStage OVERRIDE: {order['sourceStage']!r} -> {source_stage_override!r}")
print(f"idempotencyId: {idempotency_id}")
print()
# Display-time redaction is keyed on whether the OUTPUT reference is already a synthetic QASYN-
# record (its stored customer fields are placeholders from its own earlier creation, safe to show
# as-is), never on self_revise alone -- self_revise is also true for Gate A's real-reference replay,
# where the fields being reused really are a live customer's, and must stay redacted for display
# even though the script internally needs them to construct a faithful comparison payload.
is_synthetic_output = out_reference.startswith("QASYN-")
redacted_detail = dict(detail)
redacted_detail["customerEmail"] = customer_email if is_synthetic_output else f"<{len(customer_email)} chars>"
addr_shown = dict(redacted_detail["addressChanges"]["shipping"])
if not is_synthetic_output:
    for f in ("firstName", "lastName", "street1", "city", "postalCode"):
        addr_shown[f] = f"<{len(str(addr_shown[f]))} chars>"
redacted_detail["addressChanges"] = {"shipping": addr_shown}
print("Constructed Entry (customer fields shown redacted unless --out-reference is already a")
print("synthetic QASYN- record, whose stored fields are placeholders from its own creation):")
print(json.dumps({
    "Source": entry["Source"],
    "DetailType": entry["DetailType"],
    "EventBusName": entry["EventBusName"],
    "Detail": redacted_detail,
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
