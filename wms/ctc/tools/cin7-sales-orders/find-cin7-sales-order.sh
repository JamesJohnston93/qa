#!/usr/bin/env bash
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ CLEARED TO RUN — 2026-08-23, by Kian, for BUSY-1159 Gate 1 (find an eligible ECOM order). │
# │ Read-only against Cin7 by design. The standing constraint that remains: Cin7 is CTC's     │
# │ production system, so this script must never issue anything but a GET. Manhattan is NOT   │
# │ cleared — nothing here touches it.                                                        │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# Pulls real Cin7 Sales Orders, and optionally resolves each order's contact group, so the
# BUSY-1065 build has genuine payloads to write fixtures from. Cin7 test data can't be created
# to order (no platform access, API-only, read-only) — every test uses whatever genuinely
# exists in Cin7. Read-only: this only ever GETs from Cin7.
#
# Why this exists: order type is derived from the ordering customer's contact group, not from
# the order itself, so "find me an ECOM order" needs two calls — SalesOrders, then Contacts per
# memberId. --group does both and filters on the result.
#
# Talks to Cin7 directly (not via AWS) — the same API the poller itself calls, using Basic
# auth. Credentials are NOT AWS-managed for this script. Recommended: put
#   CIN7_USERNAME=...
#   CIN7_API_KEY=...
# in a `.env` file at the toolset root (auto-loaded, never printed, not a git repo so nothing
# gets committed) — or export them as env vars yourself, or pass --username/--api-key flags
# (least preferred — these land in shell history and `ps` output).
#
# GET-ONLY, ALWAYS. Cin7 is a real production system for CTC — this script must never issue a
# POST/PUT/PATCH/DELETE against it. Only ever add a plain `curl` GET (no -X, no -d/--data) if
# extending this script.
#
# NOTE ON FILTERING: branch and approval are pushed into Cin7's `where` clause (the same filter
# the poller uses). Contact group is resolved client-side, one extra GET per distinct memberId,
# cached in-process exactly as the poller caches it — so --group over a wide --max-pages costs
# real API calls against the shared daily budget. Keep --max-pages small.
#
# Usage:
#   ./find-cin7-sales-order.sh [--reference REF] [--group GROUP] [--branch ID] [--any-branch]
#                              [--limit N] [--max-pages N] [--raw] [--with-contact]
#
# Contact groups (per Cin7): 'Retail - Ecomm' → ECOM; 'Retail - Shop' → skipped (POS); Distributor,
# Promo, Retailer - Domestic, Retailer - International, Retailer - Majors, Sales Reps, Staff →
# WHOLESALE; Supplier → RTV.
#
# CTC fulfilment branches: 51909 (Main Warehouse → CTC-QDC), 51908 (Wholesale Warehouse → CTC-WH).
# Both are filtered by default; --any-branch drops the filter, --branch narrows to one.
#
# Example (browse recent CTC orders):    CIN7_USERNAME=... CIN7_API_KEY=... ./find-cin7-sales-order.sh
# Example (find an ECOM order):          ./find-cin7-sales-order.sh --group 'Retail - Ecomm'
# Example (dump one as a fixture):       ./find-cin7-sales-order.sh --reference SO-12345 --raw
# Example (ECOM order + its contact):    ./find-cin7-sales-order.sh --group 'Retail - Ecomm' --raw --with-contact
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="${SCRIPT_DIR}/../.env"
if [[ -f "$ENV_FILE" ]]; then
	while IFS='=' read -r key value; do
		[[ -z "$key" || "$key" == \#* ]] && continue
		# Don't clobber a value already exported in the real shell environment.
		if [[ -z "${!key:-}" ]]; then
			export "$key=$value"
		fi
	done < "$ENV_FILE"
fi

CIN7_BASE_URL="https://api.cin7.com"
PAGE_SIZE=250
RATE_LIMIT_SECONDS="0.35"
CTC_BRANCHES="51908,51909"

USERNAME="${CIN7_USERNAME:-}"
API_KEY="${CIN7_API_KEY:-}"
REFERENCE=""
GROUP=""
BRANCH=""
ANY_BRANCH=0
LIMIT=5
MAX_PAGES=1
RAW=0
WITH_CONTACT=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		--group) GROUP="$2"; WITH_CONTACT=1; shift 2 ;;
		--branch) BRANCH="$2"; shift 2 ;;
		--any-branch) ANY_BRANCH=1; shift ;;
		--limit) LIMIT="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		--raw) RAW=1; shift ;;
		--with-contact) WITH_CONTACT=1; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials." >&2
	echo "Set CIN7_USERNAME and CIN7_API_KEY env vars, or pass --username/--api-key." >&2
	echo "Usage: $0 [--reference REF] [--group GROUP] [--branch ID] [--limit N] [--max-pages N] [--raw] [--with-contact]" >&2
	exit 1
fi

# The poller's own server-side filter: approved only, restricted to the CTC fulfilment branches.
# `isApproved = true` is what keeps DRAFT orders out — the same reason the poller relies on it.
build_where() {
	local clauses=()
	if [[ -n "$REFERENCE" ]]; then
		# A specific order is fetched by reference regardless of branch/approval, so a DRAFT or
		# out-of-scope order can still be inspected — useful for confirming it IS being skipped.
		clauses+=("reference='${REFERENCE}'")
	else
		clauses+=("isApproved=true")
		if [[ -n "$BRANCH" ]]; then
			clauses+=("branchId IN (${BRANCH})")
		elif [[ $ANY_BRANCH -eq 0 ]]; then
			clauses+=("branchId IN (${CTC_BRANCHES})")
		fi
	fi
	# Joined explicitly: IFS holds single characters, so "${clauses[*]}" cannot join on " AND ".
	local joined="${clauses[0]}"
	local i
	for (( i = 1; i < ${#clauses[@]}; i++ )); do
		joined+=" AND ${clauses[i]}"
	done
	echo "$joined"
}

urlencode() {
	python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

# Single GET with one 429 retry, mirroring the connector's rate-limit handling.
cin7_get() {
	local path_and_query="$1"
	local attempt=1
	while true; do
		local response status body
		response=$(curl -s -w '\n%{http_code}' \
			-u "${USERNAME}:${API_KEY}" \
			-H "Accept: application/json" \
			"${CIN7_BASE_URL}${path_and_query}")
		status=$(echo "$response" | tail -n1)
		body=$(echo "$response" | sed '$d')

		if [[ "$status" == "429" && $attempt -eq 1 ]]; then
			echo "Rate limited by Cin7 — waiting 1s and retrying once..." >&2
			sleep 1
			attempt=2
			continue
		fi
		if [[ "$status" != "200" ]]; then
			echo "Cin7 request failed: HTTP $status" >&2
			echo "$body" >&2
			return 1
		fi
		echo "$body"
		return 0
	done
}

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

WHERE=$(build_where)
WHERE_ENCODED=$(urlencode "$WHERE")

PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	BODY=$(cin7_get "/api/v1/SalesOrders?where=${WHERE_ENCODED}&order=modifiedDate%20DESC&rows=${PAGE_SIZE}&page=${PAGE}")
	echo "$BODY" > "${WORKDIR}/page-${PAGE}.json"
	PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/page-${PAGE}.json'))))")

	# Cin7 returns fewer than a full page once we've reached the end of the result set.
	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then
		break
	fi

	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

# Contact resolution runs here rather than in the python block so each GET keeps going through
# cin7_get's retry/rate-limit path. Cached by memberId, as the poller caches it.
if [[ $WITH_CONTACT -eq 1 ]]; then
	MEMBER_IDS=$(python3 -c "
import glob, json, os
seen = []
for path in sorted(glob.glob(os.path.join('${WORKDIR}', 'page-*.json'))):
    with open(path) as f:
        for o in json.load(f):
            mid = o.get('memberId')
            if mid and mid not in seen:
                seen.append(mid)
print('\n'.join(str(m) for m in seen))
")
	echo '{}' > "${WORKDIR}/contacts.json"
	for MEMBER_ID in $MEMBER_IDS; do
		# The LLD specifies GET /v1/Contacts/<memberId>; older Cin7 tenants only answer the
		# generic where-clause form, so fall back to it rather than reporting a missing contact.
		CONTACT=$(cin7_get "/api/v1/Contacts/${MEMBER_ID}" 2>/dev/null || true)
		if [[ -z "$CONTACT" || "$CONTACT" == "null" ]]; then
			ID_WHERE=$(urlencode "id=${MEMBER_ID}")
			CONTACT=$(cin7_get "/api/v1/Contacts?where=${ID_WHERE}&rows=1" 2>/dev/null || true)
		fi
		[[ -z "$CONTACT" ]] && CONTACT="null"
		MEMBER_ID="$MEMBER_ID" CONTACT="$CONTACT" WORKDIR="$WORKDIR" python3 -c "
import json, os
path = os.path.join(os.environ['WORKDIR'], 'contacts.json')
with open(path) as f:
    cache = json.load(f)
raw = os.environ['CONTACT']
try:
    parsed = json.loads(raw)
except json.JSONDecodeError:
    parsed = None
# Both response shapes collapse to one contact object.
if isinstance(parsed, list):
    parsed = parsed[0] if parsed else None
cache[os.environ['MEMBER_ID']] = parsed
with open(path, 'w') as f:
    json.dump(cache, f)
"
		sleep "$RATE_LIMIT_SECONDS"
	done
fi

GROUP="$GROUP" LIMIT="$LIMIT" WORKDIR="$WORKDIR" RAW="$RAW" WITH_CONTACT="$WITH_CONTACT" python3 -c "
import glob, json, os

group_filter = os.environ.get('GROUP', '')
limit = int(os.environ['LIMIT'])
workdir = os.environ['WORKDIR']
raw = os.environ['RAW'] == '1'
with_contact = os.environ['WITH_CONTACT'] == '1'

contacts = {}
contacts_path = os.path.join(workdir, 'contacts.json')
if os.path.exists(contacts_path):
    with open(contacts_path) as f:
        contacts = json.load(f)

# Matched exactly, spaces included — the same literals contact-group.ts uses. The LLD's
# 'Retail-Ecomm' is the erratum; Cin7's real value has spaces around the dash.
GROUP_TO_TYPE = {
    'Retail - Ecomm': 'ECOM',
    'Retail - Shop': 'SKIPPED (POS)',
    'Distributor': 'WHOLESALE',
    'Promo': 'WHOLESALE',
    'Retailer - Domestic': 'WHOLESALE',
    'Retailer - International': 'WHOLESALE',
    'Retailer - Majors': 'WHOLESALE',
    'Sales Reps': 'WHOLESALE',
    'Staff': 'WHOLESALE',
    'Supplier': 'RTV',
}

# Mirrors carrier.ts: one mapped entry; absent and unrecognised both resolve to UNASSIGNED and
# the ShipmentDownload omits the Carrier element, so the carrier never gates an order.
CARRIER_TO_CODE = {
    'Australia Post': 'AUSPOST',
}

def contact_for(order):
    return contacts.get(str(order.get('memberId'))) or {}

matches = []
for path in sorted(glob.glob(os.path.join(workdir, 'page-*.json'))):
    with open(path) as f:
        page = json.load(f)
    for o in page:
        if group_filter and contact_for(o).get('group') != group_filter:
            continue
        matches.append(o)
        if len(matches) >= limit:
            break
    if len(matches) >= limit:
        break

if not matches:
    msg = 'No matching sales orders found in the pages checked.'
    if group_filter:
        msg += f' No order resolved to contact group {group_filter!r} — try --max-pages higher.'
    else:
        msg += ' Try --max-pages higher, or --any-branch to drop the CTC branch filter.'
    print(msg)
    raise SystemExit(0)

if raw:
    # Full payloads, ready to lift into a fixture. Contacts are emitted alongside rather than
    # merged in, so the fixture mirrors what each endpoint actually returns.
    out = {'salesOrders': matches}
    if with_contact:
        out['contacts'] = {str(o.get('memberId')): contact_for(o) for o in matches}
    print(json.dumps(out, indent=2))
    raise SystemExit(0)

print(f'{len(matches)} match(es):')
print('-' * 72)
for o in matches:
    contact = contact_for(o)
    group = contact.get('group')
    print(f\"SO {o.get('reference')} — id {o.get('id')}\")
    print(f\"  status: {o.get('status')}   stage: {o.get('stage')}   isApproved: {o.get('isApproved')}\")
    print(f\"  branchId: {o.get('branchId')}   modifiedDate: {o.get('modifiedDate')}\")
    print(f\"  memberId: {o.get('memberId')}   projectName: {o.get('projectName')!r}\")
    carrier = o.get('logisticsCarrier')
    print(f\"  logisticsCarrier: {carrier!r} -> {CARRIER_TO_CODE.get(carrier, 'UNASSIGNED (expected pre-dispatch; no Carrier element sent)')}\")
    tax_status = o.get('taxStatus')
    tax_flag = '' if tax_status in ('Incl', 'Excl') else '   <- UNRECOGNISED (hard error)'
    print(f\"  taxStatus: {tax_status!r}   taxRate: {o.get('taxRate')}   currencyCode: {o.get('currencyCode')!r}{tax_flag}\")
    print(f\"  estimatedDeliveryDate: {o.get('estimatedDeliveryDate')!r}\")
    if with_contact:
        print(f\"  contact group: {group!r} -> orderType {GROUP_TO_TYPE.get(group, 'UNMAPPED (permanent error)')}\")
    lines = o.get('lineItems') or []
    print(f\"  lineItems: {len(lines)}\")
    for line in lines[:3]:
        sizes = line.get('sizes') or []
        if sizes:
            rendered = ', '.join(f\"{s.get('code')}x{s.get('qty')}\" for s in sizes[:6])
            print(f\"    line {line.get('id')}: {len(sizes)} size(s) — {rendered}\")
        else:
            print(f\"    line {line.get('id')}: single-size — {line.get('code')}x{line.get('qty')}\")
    if len(lines) > 3:
        print(f'    ... and {len(lines) - 3} more line(s)')
    print()
print('Re-run with --raw to dump full payloads for use as test fixtures.')
"
