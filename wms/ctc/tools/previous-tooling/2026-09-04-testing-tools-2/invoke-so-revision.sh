#!/usr/bin/env bash
# Puts a synthetic CTC sales-order transaction on the orders bus, built from a scenario fixture.
#
# Why this exists: Cin7 is CTC's production system, so we cannot edit an order there to test an
# update, and no CTC order is ever `On Hold`, so a cancellation cannot be observed at all. This
# script manufactures the revision instead — everything downstream of the poller (the transaction
# chain, the order handlers, the shipping materialisation and the Manhattan senders) then runs
# exactly as it does in production.
#
# What it does NOT test: the poller's own inference — which stage counts as ineligible, which
# revision is an echo. That is `stale-payload-hash.sh` plus a real poll. Use both.
#
# Usage:
#   ./invoke-so-revision.sh --stage <stage> --profile <profile> --scenario <name> [--event auto]
#
#   --scenario   a file in fixtures/ecom, fixtures/wholesale or fixtures/rtv (with or
#                without the .json), or a path
#   --family     native | outbound | auto. Default `auto`: inferred from which scenario
#                directory the name resolves in. Only needed explicitly for a scenario passed
#                as a path outside all three directories.
#   --order-type WHOLESALE | RTV. Inferred from the directory, so it is only needed for a
#                scenario passed as a path. Given explicitly, it must agree with the directory.
#                Five basenames exist in BOTH directories with unrelated content — 01-baseline,
#                06-address-changed, 07-echo-stage-only, 08-ineligible-declined and
#                09-dispatched-terminal. Auto resolution checks the native directory first, so
#                any of those five with no --family passed silently runs native. Pass
#                --family outbound explicitly for the outbound one of these five.
#   --order-type WHOLESALE | RTV. Outbound family only, default `WHOLESALE` (the baseline's own
#                shape). The mapping is generic to both — pass RTV to exercise `AllocateComplete
#                = N` and the dropped customer email against the same fixture set.
#   --event      auto | CREATE_ORDER | UPDATE_ORDER | CANCEL_ORDER (native), or
#                auto | CREATE_OUTBOUND_ORDER | UPDATE_OUTBOUND_ORDER | CANCEL_OUTBOUND_ORDER
#                (outbound). Default `auto`:
#                  the order is absent locally      -> a CREATE
#                  present and the scenario is eligible -> an UPDATE
#                  present and the scenario is not      -> a CANCEL
#                which mirrors the poller's own decision, so `auto` is the honest default.
#   --dry-run    print the transaction and exit without publishing
#
# Examples:
#   ./invoke-so-revision.sh --stage kian-dev --profile dev --scenario 02-line-qty-increased
#   ./invoke-so-revision.sh --stage kian-dev --profile dev --scenario 08-ineligible-declined
#   ./invoke-so-revision.sh --stage kian-dev --profile dev --scenario 01-baseline --dry-run
#   ./invoke-so-revision.sh --stage kian-dev --profile dev \
#     --scenario 02-size-qty-increased --order-type RTV
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ WRITES. Publishing a transaction creates or mutates real rows in the target stage, and   │
# │ can reach Manhattan if the senders are wired. kian-dev only — every other stage needs    │
# │ --i-know-what-im-doing, and there is no good reason to pass it.                          │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECOM_SCENARIO_DIR="${HERE}/fixtures/ecom"
WHOLESALE_SCENARIO_DIR="${HERE}/fixtures/wholesale"
RTV_SCENARIO_DIR="${HERE}/fixtures/rtv"

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
SCENARIO=""
FAMILY="auto"
ORDER_TYPE=""
EVENT="auto"
DRY_RUN="false"
OVERRIDE="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--scenario) SCENARIO="$2"; shift 2 ;;
		--family) FAMILY="$2"; shift 2 ;;
		--order-type) ORDER_TYPE="$2"; shift 2 ;;
		--event) EVENT="$2"; shift 2 ;;
		--dry-run) DRY_RUN="true"; shift ;;
		--i-know-what-im-doing) OVERRIDE="true"; shift ;;
		-h|--help) sed -n '2,49p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$SCENARIO" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --scenario <name> [--family auto|native|outbound] [--order-type WHOLESALE|RTV] [--event auto|...] [--dry-run]" >&2
	echo "Example: $0 --stage kian-dev --profile dev --scenario 02-line-qty-increased" >&2
	echo >&2
	for pair in "ECOM (native):${ECOM_SCENARIO_DIR}" \
		"WHOLESALE (outbound):${WHOLESALE_SCENARIO_DIR}" \
		"RTV (outbound):${RTV_SCENARIO_DIR}"; do
		echo "${pair%%:*} scenarios (${pair#*:}):" >&2
		ls -1 "${pair#*:}" 2>/dev/null | sed 's/\.json$//' | sed 's/^/  /' >&2
		echo >&2
	done
	exit 1
fi

if [[ "$FAMILY" != "auto" && "$FAMILY" != "native" && "$FAMILY" != "outbound" ]]; then
	echo "--family must be auto, native or outbound — got '${FAMILY}'." >&2
	exit 1
fi

if [[ -n "$ORDER_TYPE" && "$ORDER_TYPE" != "WHOLESALE" && "$ORDER_TYPE" != "RTV" ]]; then
	echo "--order-type must be WHOLESALE or RTV — got '${ORDER_TYPE}'." >&2
	exit 1
fi
ORDER_TYPE_GIVEN="$ORDER_TYPE"

if [[ "$STAGE" != "kian-dev" && "$OVERRIDE" != "true" && "$DRY_RUN" != "true" ]]; then
	echo "Refusing to publish to '${STAGE}'. This script writes; it is for kian-dev." >&2
	echo "Use --dry-run to see the transaction, or --i-know-what-im-doing to override." >&2
	exit 1
fi

# Accept a bare name, a name with .json, or a path. Which directory it resolves in decides both
# --family and --order-type when they are left unset: a scenario under fixtures/rtv IS an RTV
# outbound scenario, so asking the caller to say so again would only be a second place to get it
# wrong. Basenames repeat across all three directories — same name, different reference, different
# grain — so an explicit --family or --order-type narrows the search rather than relabelling
# whatever resolved first.
find_scenario() {
	local dir="$1" family="$2" order_type="$3"
	for candidate in "${dir}/${SCENARIO}" "${dir}/${SCENARIO}.json"; do
		if [[ -f "$candidate" ]]; then
			SCENARIO_FILE="$candidate"
			RESOLVED_FAMILY="$family"
			RESOLVED_ORDER_TYPE="$order_type"
			return 0
		fi
	done
	return 1
}

# An explicit --order-type moves its directory to the front of the search rather than restricting
# it, so a basename present in both resolves to the one asked for while a name present only in the
# other still resolves — and then fails the agreement check below with a message that says why.
find_outbound() {
	if [[ "$ORDER_TYPE_GIVEN" == "RTV" ]]; then
		find_scenario "$RTV_SCENARIO_DIR" outbound RTV ||
			find_scenario "$WHOLESALE_SCENARIO_DIR" outbound WHOLESALE
	else
		find_scenario "$WHOLESALE_SCENARIO_DIR" outbound WHOLESALE ||
			find_scenario "$RTV_SCENARIO_DIR" outbound RTV
	fi
}

SCENARIO_FILE=""
RESOLVED_FAMILY=""
RESOLVED_ORDER_TYPE=""
if [[ -f "$SCENARIO" ]]; then
	SCENARIO_FILE="$SCENARIO"
elif [[ "$FAMILY" == "outbound" ]]; then
	find_outbound || true
elif [[ "$FAMILY" == "native" ]]; then
	find_scenario "$ECOM_SCENARIO_DIR" native ECOM || true
else
	find_scenario "$ECOM_SCENARIO_DIR" native ECOM || find_outbound || true
fi

if [[ -z "$SCENARIO_FILE" ]]; then
	echo "No such scenario: ${SCENARIO}" >&2
	echo "Looked in:" >&2
	if [[ "$FAMILY" != "outbound" ]]; then
		echo "  ${ECOM_SCENARIO_DIR}" >&2
	fi
	if [[ "$FAMILY" != "native" ]]; then
		echo "  ${WHOLESALE_SCENARIO_DIR}" >&2
		echo "  ${RTV_SCENARIO_DIR}" >&2
	fi
	exit 1
fi

if [[ "$FAMILY" == "auto" ]]; then
	if [[ -z "$RESOLVED_FAMILY" ]]; then
		echo "'${SCENARIO}' is a path outside all three scenario directories — pass --family explicitly." >&2
		exit 1
	fi
	FAMILY="$RESOLVED_FAMILY"
fi

# The directory is the order type. An explicit --order-type that disagrees with it is a
# contradiction, not a preference: silently honouring either one sends a document whose order type
# does not match the fixture it was built from.
if [[ "$FAMILY" == "outbound" ]]; then
	if [[ -z "$ORDER_TYPE" && -n "$RESOLVED_ORDER_TYPE" ]]; then
		ORDER_TYPE="$RESOLVED_ORDER_TYPE"
	fi
	if [[ -n "$RESOLVED_ORDER_TYPE" && -n "$ORDER_TYPE_GIVEN" && "$ORDER_TYPE_GIVEN" != "$RESOLVED_ORDER_TYPE" ]]; then
		echo "--order-type ${ORDER_TYPE_GIVEN} contradicts '${SCENARIO}', which lives in the ${RESOLVED_ORDER_TYPE} directory." >&2
		exit 1
	fi
	if [[ -z "$ORDER_TYPE" ]]; then
		echo "'${SCENARIO}' is a path, so its order type cannot be inferred — pass --order-type." >&2
		exit 1
	fi
fi

# Five scenario basenames exist in both directories, and the native one resolves first. An explicit
# --event naming the other family is therefore a contradiction, not a preference: without this the
# run proceeds on the wrong fixture and reports a family the caller did not ask for.
if [[ "$EVENT" == *OUTBOUND* && "$FAMILY" != "outbound" ]]; then
	echo "--event ${EVENT} is an outbound event but '${SCENARIO}' resolved to the ${FAMILY} family." >&2
	echo "Pass --family outbound to search the wholesale and rtv directories instead." >&2
	exit 1
fi
if [[ "$EVENT" != "auto" && "$EVENT" != *OUTBOUND* && "$FAMILY" == "outbound" ]]; then
	echo "--event ${EVENT} is a native event but '${SCENARIO}' resolved to the outbound family." >&2
	echo "Pass --family native, or use the matching *_OUTBOUND_ORDER event." >&2
	exit 1
fi

BUS="${STAGE}-orders-v2-event-bus"
ORDERS_TABLE="${STAGE}-orders-v2"

REFERENCE=$(python3 -c "
import json,sys
o=json.load(open('${SCENARIO_FILE}'))
ref=o['reference']
print(ref[1:] if ref.startswith('#') else ref)
")

echo "Scenario:   $(basename "$SCENARIO_FILE")"
echo "Family:     ${FAMILY}$( [[ "$FAMILY" == "outbound" ]] && echo "  (order-type ${ORDER_TYPE})" )"
echo "Reference:  ${REFERENCE}"
echo "Bus:        ${BUS}"
echo

# The poller decides create vs update vs cancel from the existence read plus eligibility, so this
# script asks the same two questions rather than guessing. `origin_index` is the GSI the repository
# queries.
ORIGIN="CTC#CIN7_SO#${REFERENCE}"
# `--dry-run` reaches AWS only when it has to. The existence read is what `--event auto` infers
# from, so an auto run cannot answer offline; an explicit --event needs no such answer, and a QA
# reading "dry run" reasonably expects nothing to be touched.
if [[ "$DRY_RUN" == "true" && "$EVENT" != "auto" ]]; then
	EXISTING=""
	echo "Order:      not read — --dry-run with an explicit --event touches nothing"
	SKIP_EXISTENCE_READ="true"
elif [[ "$DRY_RUN" == "true" ]]; then
	echo "Note:       --event auto must read ${ORDERS_TABLE} to tell a create from an update."
	echo "            Pass an explicit --event to keep a dry run entirely offline."
	echo
fi

# Never swallow a failure here. If the query errors — bad profile, no credentials, missing table
# — an "absent" answer would send this down the CREATE_ORDER path and mint a second order for a
# reference that already has one. Fail loudly instead.
if [[ "${SKIP_EXISTENCE_READ:-false}" != "true" ]] && ! EXISTING=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
	--table-name "$ORDERS_TABLE" \
	--index-name origin_index \
	--key-condition-expression 'origin = :o' \
	--expression-attribute-values "{\":o\":{\"S\":\"${ORIGIN}\"}}" \
	--query 'Items[?SK.S==`ORDER`] | [0]' \
	--output json 2>&1); then
	echo "Could not read ${ORDERS_TABLE} to check whether this order already exists:" >&2
	echo "${EXISTING}" >&2
	echo >&2
	echo "Refusing to continue: without that answer this script cannot tell a create from an" >&2
	echo "update, and guessing create would mint a duplicate order." >&2
	exit 1
fi

ORDER_ID=$(python3 -c "
import json,sys
raw='''${EXISTING}'''.strip()
try:
    d=json.loads(raw)
except Exception:
    d=None
print(d['PK']['S'] if d and 'PK' in d else '')
")

if [[ "${SKIP_EXISTENCE_READ:-false}" != "true" ]]; then
	if [[ -n "$ORDER_ID" ]]; then
		echo "Order:      present (${ORDER_ID})"
	else
		echo "Order:      absent — nothing has been created for this reference yet"
	fi
fi

if [[ "$FAMILY" == "outbound" ]]; then
	TRANSACTION=$(EVENT="$EVENT" ORDER_ID="$ORDER_ID" ORDER_TYPE="$ORDER_TYPE" SCENARIO_FILE="$SCENARIO_FILE" python3 - <<'PY'
import json, os, hashlib, uuid

order = json.load(open(os.environ['SCENARIO_FILE']))
requested = os.environ['EVENT']
order_id = os.environ['ORDER_ID']
order_type = os.environ['ORDER_TYPE']

STORE = 'CTC'
ORIGIN_SYSTEM = 'CIN7_SO'
CREATE_EVENT = 'CREATE_OUTBOUND_ORDER'
UPDATE_EVENT = 'UPDATE_OUTBOUND_ORDER'
CANCEL_EVENT = 'CANCEL_OUTBOUND_ORDER'

# Mirrors the poller's gate — shared with the native path below, since eligibility is generic to
# every Cin7 sales order regardless of which family it resolves to.
ELIGIBLE_STAGES = {'New', 'Processing', 'Fully Picked', 'Partially Picked'}
TERMINAL_STAGE = 'Dispatched'
# CTC fulfils every order from one warehouse; branchId does not select it.
CTC_WAREHOUSE = 'CTC-QDC'
# Cin7 populates logisticsCarrier at dispatch only; absent or unmapped both resolve to the
# sentinel rather than blocking the order.
CARRIER_BY_LOGISTICS_CARRIER = {'Australia Post': 'AUSPOST'}
STATE_CODE_BY_NAME = {
    'Australian Capital Territory': 'ACT', 'New South Wales': 'NSW',
    'Northern Territory': 'NT', 'Queensland': 'QLD', 'South Australia': 'SA',
    'Tasmania': 'TAS', 'Victoria': 'VIC', 'Western Australia': 'WA',
}
COUNTRY_CODE_BY_NAME = {'Australia': 'AU'}

reference = order['reference']
reference = reference[1:] if reference.startswith('#') else reference
stage = order.get('stage')
eligible = order.get('status', '').upper() == 'APPROVED' and stage in ELIGIBLE_STAGES

if requested == 'auto':
    if stage == TERMINAL_STAGE:
        raise SystemExit(
            f'Scenario is at the terminal stage ({stage}), which produces nothing at all — '
            'not a cancel, not an update. There is no transaction to publish. Pass --event '
            'explicitly if you mean to force one.'
        )
    if not order_id:
        if not eligible:
            raise SystemExit(
                f'Scenario is ineligible (stage {stage}) and no order exists for '
                f'{reference}. The poller skips this: there is nothing to cancel.'
            )
        event = CREATE_EVENT
    else:
        event = UPDATE_EVENT if eligible else CANCEL_EVENT
else:
    event = requested

if event != CREATE_EVENT and not order_id:
    raise SystemExit(
        f'{event} needs an existing order. None found for {reference} — run a '
        '01-baseline CREATE_OUTBOUND_ORDER first.'
    )

order_id = order_id or str(uuid.uuid4())

def carrier_for(logistics_carrier):
    if not logistics_carrier:
        return 'UNASSIGNED'
    return CARRIER_BY_LOGISTICS_CARRIER.get(logistics_carrier, 'UNASSIGNED')

warehouse = CTC_WAREHOUSE
carrier = carrier_for(order.get('logisticsCarrier'))

# Same rule the mapper applies: an unmapped Australian state/country is a hard error, never a
# best-effort guess — a mis-coded address fails the whole shipment silently otherwise.
def code_for(value, table, label):
    trimmed = value.strip()
    if trimmed in table:
        return table[trimmed]
    if trimmed.upper() in table.values():
        return trimmed.upper()
    raise SystemExit(f'Unmapped Cin7 delivery {label}: "{value}"')

def derive_ship_to(order):
    if order.get('deliveryCompany'):
        return order['deliveryCompany']
    name = f"{order.get('deliveryFirstName') or ''} {order.get('deliveryLastName') or ''}".strip()
    if not name:
        raise SystemExit(
            f'Cin7 SO {order["reference"]} carries no deliveryCompany, deliveryFirstName or '
            'deliveryLastName — refusing to map an empty ShipTo to SCALE.'
        )
    return name

def derive_ship_to_address(order, order_type):
    address = {'name': derive_ship_to(order)}
    address['street1'] = order.get('deliveryAddress1')
    if order.get('deliveryAddress2'):
        address['street2'] = order['deliveryAddress2']
    address['city'] = order.get('deliveryCity')
    if order.get('deliveryState'):
        address['state'] = code_for(order['deliveryState'], STATE_CODE_BY_NAME, 'state')
    if order.get('deliveryPostalCode'):
        address['postalCode'] = order['deliveryPostalCode']
    if order.get('deliveryCountry'):
        address['country'] = order['deliveryCountry']
        address['countryCode'] = code_for(
            order['deliveryCountry'], COUNTRY_CODE_BY_NAME, 'country'
        )
    # RTV never carries a customer email, even when Cin7 supplies one.
    if order_type == 'WHOLESALE' and order.get('email'):
        address['email'] = order['email']
    return address

ship_to = derive_ship_to(order)
ship_to_address = derive_ship_to_address(order, order_type)

if not isinstance(order.get('lineItems'), list):
    raise SystemExit(
        f'Cin7 SO {order["reference"]} carries no lineItems array — the payload is '
        'header-only or truncated.'
    )

# One item per SIZE, carrying its own quantity — the outbound grain, distinct from the native
# per-unit explosion below. Cin7 can send the same size code twice on one line (a merged order);
# this does not dedupe them, so a duplicate collapses onto one SK exactly as production does.
items = []
skipped_zero = 0
for line in order['lineItems']:
    sizes = line.get('sizes') or []
    units = (
        [(s['code'], s['qty']) for s in sizes]
        if sizes else [(line['code'], line['qty'])]
    )
    for code, qty in units:
        if qty == 0:
            skipped_zero += 1
            continue
        items.append({
            'SK': f'ITEM#{line["id"]}#{code}',
            'lineId': str(line['id']),
            'sku': code,
            'quantity': qty,
        })

if not items:
    raise SystemExit(
        'Every size is qty 0, so the order has nothing to ship. The poller skips this as a '
        'zero-unit order rather than emitting an empty revision.'
    )

allocate_complete = 'Y' if order_type == 'WHOLESALE' else 'N'
customer_email = order.get('email') if order_type == 'WHOLESALE' else None

order_info = {
    'store': STORE,
    'originSystem': ORIGIN_SYSTEM,
    'originId': reference,
    'cin7Id': order['id'],
    'orderType': order_type,
    'warehouse': warehouse,
    'carrier': carrier,
    'allocateComplete': allocate_complete,
    'shipTo': ship_to,
    'shipToAddress': ship_to_address,
    'orderDate': order['createdDate'],
    'sourceStatus': order['status'],
    'sourceStage': stage,
    'lastModified': order['modifiedDate'],
}
if order.get('estimatedDeliveryDate'):
    order_info['scheduledShipDate'] = order['estimatedDeliveryDate']
if order.get('customerOrderNo'):
    order_info['customerOrderNo'] = order['customerOrderNo']

# The echo guard's hash, over the mapped fields only — the same set the mapper hashes, so a
# synthetic revision leaves the order in the state a real one would.
mapped = {
    'orderType': order_info['orderType'],
    'warehouse': order_info['warehouse'],
    'carrier': order_info['carrier'],
    'allocateComplete': order_info['allocateComplete'],
    'shipTo': order_info['shipTo'],
    'shipToAddress': order_info['shipToAddress'],
    'scheduledShipDate': order_info.get('scheduledShipDate'),
    'customerOrderNo': order_info.get('customerOrderNo'),
    'customerEmail': customer_email,
    'lines': sorted(f'{i["lineId"]}::{i["sku"]}::{i["quantity"]}' for i in items),
}
order_info['lastEmittedPayloadHash'] = hashlib.sha256(
    json.dumps(mapped, sort_keys=True).encode()
).hexdigest()[:8]

payload_hash = hashlib.sha256(json.dumps(order, sort_keys=False).encode()).hexdigest()[:8]

command = {
    'orderId': order_id,
    'idempotencyId': f'{event}#{STORE}#{reference}#{order["modifiedDate"]}#{payload_hash}',
    'category': 'OUTBOUND',
    'event': event,
    'origin': f'{STORE}#{ORIGIN_SYSTEM}#{reference}',
    'message_group_id': order_id,
    'outboundOrderInfo': order_info,
    'outboundItemInfo': items,
}
if customer_email:
    command['customerEmail'] = customer_email

print(json.dumps({
    'command': command,
    'meta': {
        'event': event,
        'units': len(items),
        'skippedZeroQty': skipped_zero,
        'eligible': eligible,
    },
}))
PY
	)
else
	TRANSACTION=$(EVENT="$EVENT" ORDER_ID="$ORDER_ID" SCENARIO_FILE="$SCENARIO_FILE" python3 - <<'PY'
import json, os, hashlib, uuid

order = json.load(open(os.environ['SCENARIO_FILE']))
requested = os.environ['EVENT']
order_id = os.environ['ORDER_ID']

# Mirrors the poller's gate. Kept here rather than imported because these scripts are standalone
# and must run without the monorepo's toolchain.
ELIGIBLE_STAGES = {'New', 'Processing', 'Fully Picked', 'Partially Picked'}
TERMINAL_STAGE = 'Dispatched'
# CTC fulfils every order from one warehouse; branchId does not select it.
CTC_WAREHOUSE = 'CTC-QDC'
PACKING_BRAND = {
    'ShopifyV2_thrills': 'THRILLS',
    'ShopifyV2_thrillsusa': 'THRILLS',
    'Shopify V2_Worship': 'WORSHIP',
}

reference = order['reference']
reference = reference[1:] if reference.startswith('#') else reference
stage = order.get('stage')
eligible = order.get('status', '').upper() == 'APPROVED' and stage in ELIGIBLE_STAGES

if requested == 'auto':
    if stage == TERMINAL_STAGE:
        raise SystemExit(
            f'Scenario is at the terminal stage ({stage}), which produces nothing at all — '
            'not a cancel, not an update. There is no transaction to publish. Pass --event '
            'explicitly if you mean to force one.'
        )
    if not order_id:
        if not eligible:
            raise SystemExit(
                f'Scenario is ineligible (stage {stage}) and no order exists for '
                f'{reference}. The poller skips this: there is nothing to cancel.'
            )
        event = 'CREATE_ORDER'
    else:
        event = 'UPDATE_ORDER' if eligible else 'CANCEL_ORDER'
else:
    event = requested

if event != 'CREATE_ORDER' and not order_id:
    raise SystemExit(
        f'{event} needs an existing order. None found for {reference} — run a '
        '01-baseline CREATE_ORDER first, or use invoke-so-poller.sh.'
    )

order_id = order_id or str(uuid.uuid4())

if order.get('taxStatus') not in ('Incl', 'Excl'):
    raise SystemExit(f'Unrecognised taxStatus {order.get("taxStatus")!r}')

header_rate = order.get('taxRate') or 0
tax_incl = order['taxStatus'] == 'Incl'

items = []
skipped_zero = 0
for line in order['lineItems']:
    sizes = line.get('sizes') or []
    units = (
        [(s['code'], s['qty']) for s in sizes]
        if sizes else [(line['code'], line['qty'])]
    )
    unit_price = line.get('unitPrice') or 0
    grand = unit_price if tax_incl else unit_price * (1 + header_rate)
    tax = grand - grand / (1 + header_rate) if header_rate else 0
    for sku, qty in units:
        if qty == 0:
            skipped_zero += 1
            continue
        for _ in range(int(round(qty))):
            item = {
                'SK': f'ITEM#{uuid.uuid4()}',
                'sku': sku,
                'lineItemId': str(line['id']),
                'status': 'OPEN',
                'deliveryMethod': 'STANDARD',
                'subtotal': grand - tax,
                'grandTotal': grand,
                'taxPaid': tax,
            }
            if line.get('unitCost') is not None:
                item['costPrice'] = line['unitCost']
            items.append(item)

if not items:
    raise SystemExit(
        'Every size is qty 0, so the order has nothing to ship. The poller skips this as a '
        'zero-unit order rather than emitting an empty revision.'
    )

warehouse = CTC_WAREHOUSE

packing_brand = PACKING_BRAND.get(order.get('projectName'))

# The idempotency key and the echo hash both come from the mapper in production. Reproduced here so
# a replay of the same scenario dedupes exactly as a real one would.
#
# Both hash a JSON string, so the string has to be byte-identical to what `JSON.stringify` would
# produce or the digests never match and every guard reading them is inert. Python's defaults
# differ in four ways:
#
#   * it pads separators (`", "` / `": "`)                      -> separators=(',', ':')
#   * it escapes non-ASCII                                      -> ensure_ascii=False
#   * JSON has no int/float split, so 53.0 stays "53.0" here
#     where JS prints "53"                                      -> integral floats coerced to int
#   * it renders None as `null`, where JSON.stringify OMITS an
#     undefined-valued key                                      -> drop_undefined, opt-in
#
# The first three always apply. The fourth only where the TypeScript field is optional (and so
# `undefined` rather than null when absent), which is why it is per call site: the raw Cin7
# payload's nulls are genuine JSON nulls and JS keeps them.
def js_stringify(value, drop_undefined=False):
    def norm(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, float) and v.is_integer() and abs(v) < 1e21:
            return int(v)
        if isinstance(v, dict):
            return {
                k: norm(x) for k, x in v.items()
                if not (drop_undefined and x is None)
            }
        if isinstance(v, (list, tuple)):
            return [norm(x) for x in v]
        return v
    return json.dumps(norm(value), separators=(',', ':'), ensure_ascii=False)

# The raw Cin7 payload: its nulls are genuine JSON nulls, which JSON.stringify keeps, so nothing
# is pruned here.
payload_hash = hashlib.sha256(
    js_stringify(order).encode()
).hexdigest()[:8]

order_info = {
    'cin7Id': order['id'],
    'orderType': 'ECOM',
    'warehouse': warehouse,
    'carrier': order.get('logisticsCarrier') or 'UNASSIGNED',
    'sourceStatus': order['status'],
    'sourceStage': stage,
    'lastModified': order['modifiedDate'],
    'allocatedStore': str(order['branchId']),
}
if order.get('estimatedDeliveryDate'):
    order_info['scheduledShipDate'] = order['estimatedDeliveryDate']
if packing_brand:
    order_info['packingBrand'] = packing_brand
def code(name, table):
    return table.get(name, name)

STATES = {
    'Western Australia': 'WA', 'New South Wales': 'NSW', 'Victoria': 'VIC',
    'Queensland': 'QLD', 'South Australia': 'SA', 'Tasmania': 'TAS',
    'Northern Territory': 'NT', 'Australian Capital Territory': 'ACT',
}
COUNTRIES = {'Australia': 'AU', 'New Zealand': 'NZ', 'United States': 'US'}

# Key ORDER is load-bearing, not cosmetic: it feeds the echo hash through JSON.stringify, which
# serialises in insertion order. This mirrors the mapper's spread order (firstName before
# lastName) — see sales-order-mapper.ts, addressChanges.shipping.
shipping = {}
if order.get('deliveryFirstName'):
    shipping['firstName'] = order['deliveryFirstName']
shipping['lastName'] = order.get('deliveryLastName')
if order.get('deliveryCompany'):
    shipping['company'] = order['deliveryCompany']
shipping['street1'] = order.get('deliveryAddress1')
shipping['city'] = order.get('deliveryCity')
if order.get('deliveryState'):
    shipping['state'] = code(order['deliveryState'], STATES)
if order.get('deliveryPostalCode'):
    shipping['postalCode'] = order['deliveryPostalCode']
if order.get('deliveryCountry'):
    shipping['country'] = order['deliveryCountry']
    shipping['countryCode'] = code(order['deliveryCountry'], COUNTRIES)

totals = {
    'subtotal': sum(i['subtotal'] for i in items),
    'grandTotal': sum(i['grandTotal'] for i in items),
    'taxPaid': sum(i['taxPaid'] for i in items),
}

# The echo guard's hash, over the mapped fields only — the same set the mapper hashes. Carried so a
# synthetic revision leaves the order in the state a real one would; without it the next real poll
# sees a missing hash, treats the order as changed, and emits an update nobody asked for.
mapped_lines = {}
for item in items:
    key = f'{item["lineItemId"]}::{item["sku"]}'
    mapped_lines[key] = mapped_lines.get(key, 0) + 1
# `scheduledShipDate`, `packingBrand` and `customerEmail` are optional in the mapper, so an
# absent one is `undefined` there and the key is omitted — hence drop_undefined.
order_info['lastEmittedPayloadHash'] = hashlib.sha256(
    js_stringify({
        'orderType': order_info['orderType'],
        'warehouse': order_info['warehouse'],
        'carrier': order_info['carrier'],
        'scheduledShipDate': order_info.get('scheduledShipDate'),
        'packingBrand': order_info.get('packingBrand'),
        'customerEmail': order.get('email'),
        'address': shipping,
        'lines': sorted(mapped_lines.items()),
    }, drop_undefined=True).encode()
).hexdigest()[:8]

command = {
    'orderId': order_id,
    'category': 'CHARGE' if event == 'CREATE_ORDER' else 'UPDATE',
    'event': event,
    'origin': f'CTC#CIN7_SO#{reference}',
    'idempotencyId': f'{event}#CTC#{reference}#{order["modifiedDate"]}#{payload_hash}',
    'message_group_id': order_id,
    'itemChanges': {'added': items},
    'paymentChanges': {
        'currency': order.get('currencyCode'),
        'shipping': 0,
        'payments': [],
        **totals,
    },
    'addressChanges': {'shipping': shipping},
    'orderInfo': order_info,
}
if order.get('email'):
    command['customerEmail'] = order['email']

print(json.dumps({
    'command': command,
    'meta': {
        'event': event,
        'units': len(items),
        'skippedZeroQty': skipped_zero,
        'eligible': eligible,
    },
}))
PY
	)
fi

EVENT_RESOLVED=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read())['meta']['event'])" <<<"$TRANSACTION")
UNITS=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read())['meta']['units'])" <<<"$TRANSACTION")
SKIPPED=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read())['meta']['skippedZeroQty'])" <<<"$TRANSACTION")

echo "Event:      ${EVENT_RESOLVED}"
echo "Units:      ${UNITS}  (zero-qty sizes skipped: ${SKIPPED})"
echo

COMMAND=$(python3 -c "import json,sys; print(json.dumps(json.loads(sys.stdin.read())['command']))" <<<"$TRANSACTION")

if [[ "$DRY_RUN" == "true" ]]; then
	echo "--- transaction (not published) ---"
	python3 -m json.tool <<<"$COMMAND"
	exit 0
fi

ENTRY=$(python3 -c "
import json,sys
detail=sys.stdin.read()
print(json.dumps([{
    'Source': 'testing-tools.invoke-so-revision',
    'DetailType': 'CREATE_TRANSACTION',
    'EventBusName': '${BUS}',
    'Detail': detail,
}]))
" <<<"$COMMAND")

RESULT=$(aws events put-events --profile "$PROFILE" --region "$REGION" \
	--entries "$ENTRY" --output json)

FAILED=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read())['FailedEntryCount'])" <<<"$RESULT")

if [[ "$FAILED" != "0" ]]; then
	echo "put-events reported ${FAILED} failed entr(ies):" >&2
	python3 -m json.tool <<<"$RESULT" >&2
	exit 1
fi

echo "Published. Follow it with:"
echo "  ./inspect-ctc-order.sh --stage ${STAGE} --profile ${PROFILE} --reference ${REFERENCE}"
echo "  ./check-ctc-status.sh --stage ${STAGE} --profile ${PROFILE}"
