#!/usr/bin/env bash
# Dry-runs one Cin7 poller cycle against a candidate watermark, WITHOUT touching the real
# watermark or emitting anything — so you can see exactly what a given `cin7-watermark.sh --set`
# would actually produce before committing to it. Mirrors the poller's real logic exactly
# (see services/catalog/lambda/manhattan/cin7-item-poller.ts, refreshed for BUSY-1115):
#   - same primary query: where=modifiedDate>='<since>' (inclusive, matches the real connector
#     since 2026-07-28), order=modifiedDate ASC, rows=250, full pagination
#   - same /ProductOptions trigger-fan-in: pages modifiedDate>='<since>' on /ProductOptions too,
#     collects distinct parent productIds NOT already covered by the primary /Products fetch, and
#     re-fetches those in full via where=id in (...) — a record from the trigger path is tagged
#     [trigger] below so you can confirm it came from a full product read, never the options
#     response itself
#   - same active-status gate: only Product.status=Public AND ProductOption.status=Primary would
#     actually be emitted as a Manhattan item; everything else is a Cin7InactiveSkip
#   - same full field mapping as buildRecord(): item_code/size from the option; colour from
#     customFields.products_1011; barcode -> ean; weight from optionWeight; height/length/width
#     from the product; conversion_rate from the option's first uomOptions quantity; brand from
#     the product; sub_group_id from categoryIdArray[0] — each shown alongside which fields would
#     be reported as defaulted (missing_fields), matching the real default-and-report behaviour
#   - same watermark-advance rule: the max modifiedDate across every fetched product (primary AND
#     triggered) is what the real watermark would move to after a real cycle
#
# Talks to Cin7 directly (not via AWS) — same credential model as find-cin7-item.sh: a `.env`
# file next to this script (auto-loaded — see find-cin7-item.sh's header for details), or
# CIN7_USERNAME / CIN7_API_KEY env vars, or --username/--api-key flags.
#
# GET-ONLY, ALWAYS. Cin7 is a real production system for CTC — this script must never issue a
# POST/PUT/PATCH/DELETE against it. Only ever add a plain `curl` GET (no -X, no -d/--data) if
# extending this script. This script never touches the watermark parameter itself — pair it
# with cin7-watermark.sh once you're happy with the preview.
#
# Usage:
#   ./preview-cin7-sync.sh --since <UTC-ISO8601> [--max-pages N]
#
# --max-pages applies per endpoint (Products, ProductOptions, and the triggered Products-by-id
# fetch each page independently, mirroring MAX_PAGES_PER_RUN in the real poller).
#
# Example:
#   CIN7_USERNAME=... CIN7_API_KEY=... ./preview-cin7-sync.sh --since 2026-07-20T00:00:00.000Z
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
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

USERNAME="${CIN7_USERNAME:-}"
API_KEY="${CIN7_API_KEY:-}"
SINCE=""
MAX_PAGES=20

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--since) SINCE="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials." >&2
	echo "Set CIN7_USERNAME and CIN7_API_KEY env vars, or pass --username/--api-key." >&2
	exit 1
fi

if [[ -z "$SINCE" ]]; then
	echo "Usage: $0 --since <UTC-ISO8601> [--max-pages N]" >&2
	echo "Example: $0 --since 2026-07-20T00:00:00.000Z" >&2
	exit 1
fi

if ! [[ "$SINCE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$ ]]; then
	echo "Invalid --since value: \"$SINCE\"" >&2
	echo "Must be UTC ISO 8601 (e.g. 2026-07-20T00:00:00.000Z) — remember this is UTC, not local time." >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# GET with 429-retry-once, matching the real connector's rate-limit/retry behaviour closely
# enough for a QA preview (not a byte-for-byte reimplementation of Retry-After honouring).
cin7_get() {
	local url="$1"
	local response status_code body
	response=$(curl -s -w '\n%{http_code}' -u "${USERNAME}:${API_KEY}" -H "Accept: application/json" "$url")
	status_code=$(echo "$response" | tail -n1)
	body=$(echo "$response" | sed '$d')
	if [[ "$status_code" == "429" ]]; then
		echo "Rate limited by Cin7 — waiting 1s and retrying once..." >&2
		sleep 1
		response=$(curl -s -w '\n%{http_code}' -u "${USERNAME}:${API_KEY}" -H "Accept: application/json" "$url")
		status_code=$(echo "$response" | tail -n1)
		body=$(echo "$response" | sed '$d')
	fi
	if [[ "$status_code" != "200" ]]; then
		echo "Cin7 request failed: HTTP $status_code" >&2
		echo "$body" >&2
		exit 1
	fi
	echo "$body"
}

url_encode() {
	python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

# --- Phase 1: primary /Products poll, same as fetchAllProducts() ---
WHERE_ENCODED=$(url_encode "modifiedDate>='${SINCE}'")
PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	BODY=$(cin7_get "${CIN7_BASE_URL}/api/v1/Products?where=${WHERE_ENCODED}&order=modifiedDate%20ASC&rows=${PAGE_SIZE}&page=${PAGE}")
	echo "$BODY" > "${WORKDIR}/products-page-${PAGE}.json"
	PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/products-page-${PAGE}.json'))))")
	echo "Fetched /Products page $PAGE: $PAGE_COUNT product(s)" >&2
	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then break; fi
	if [[ $PAGE -eq $MAX_PAGES ]]; then
		echo "Hit --max-pages ($MAX_PAGES) on /Products — raise --max-pages to see it all." >&2
	fi
	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

# --- Phase 2: /ProductOptions trigger poll, same as fetchAllProductOptionTriggers() ---
PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	BODY=$(cin7_get "${CIN7_BASE_URL}/api/v1/ProductOptions?where=${WHERE_ENCODED}&order=modifiedDate%20ASC&rows=${PAGE_SIZE}&page=${PAGE}")
	echo "$BODY" > "${WORKDIR}/options-page-${PAGE}.json"
	PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/options-page-${PAGE}.json'))))")
	echo "Fetched /ProductOptions page $PAGE: $PAGE_COUNT row(s)" >&2
	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then break; fi
	if [[ $PAGE -eq $MAX_PAGES ]]; then
		echo "Hit --max-pages ($MAX_PAGES) on /ProductOptions — raise --max-pages to see it all." >&2
	fi
	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

# --- Compute the trigger-only missing product IDs (not already covered by phase 1) ---
MISSING_IDS_JSON=$(WORKDIR="$WORKDIR" python3 -c "
import glob, json, os

workdir = os.environ['WORKDIR']

fetched_ids = set()
for path in sorted(glob.glob(os.path.join(workdir, 'products-page-*.json'))):
    with open(path) as f:
        for p in json.load(f):
            fetched_ids.add(p['id'])

triggered_ids = set()
for path in sorted(glob.glob(os.path.join(workdir, 'options-page-*.json'))):
    with open(path) as f:
        for o in json.load(f):
            pid = o.get('productId')
            if pid is not None:
                triggered_ids.add(pid)

missing = sorted(triggered_ids - fetched_ids)
print(json.dumps(missing))
")

MISSING_COUNT=$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$MISSING_IDS_JSON")
echo "Distinct productIds referenced only via /ProductOptions (not in the primary /Products fetch): $MISSING_COUNT" >&2

# --- Phase 3: fetch the missing products in full, same as fetchProductsByIds() ---
# Chunked at CIN7_ID_FILTER_BATCH_SIZE (matches libs/cin7/src/connector/cin7-connector.ts) — Cin7
# has no documented limit on where=id in (...) length, but a single query built from a few hundred
# ids returns a flat HTTP 404 in practice (found 2026-07-30, see architecture-notes.md). Each batch
# is smaller than PAGE_SIZE, so it always resolves in one page — the inner page loop is defensive,
# not expected to iterate more than once per batch.
CIN7_ID_FILTER_BATCH_SIZE=100
if [[ "$MISSING_COUNT" -gt 0 ]]; then
	ID_BATCHES=$(python3 -c "
import json, sys
ids = json.loads(sys.argv[1])
batch_size = int(sys.argv[2])
for i in range(0, len(ids), batch_size):
    print(','.join(str(x) for x in ids[i:i + batch_size]))
" "$MISSING_IDS_JSON" "$CIN7_ID_FILTER_BATCH_SIZE")

	BATCH=0
	while IFS= read -r ID_BATCH; do
		BATCH=$((BATCH + 1))
		WHERE_IDS_ENCODED=$(url_encode "id in (${ID_BATCH})")
		PAGE=1
		while [[ $PAGE -le $MAX_PAGES ]]; do
			BODY=$(cin7_get "${CIN7_BASE_URL}/api/v1/Products?where=${WHERE_IDS_ENCODED}&rows=${PAGE_SIZE}&page=${PAGE}")
			echo "$BODY" > "${WORKDIR}/triggered-page-${BATCH}-${PAGE}.json"
			PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/triggered-page-${BATCH}-${PAGE}.json'))))")
			echo "Fetched triggered /Products batch $BATCH page $PAGE: $PAGE_COUNT product(s)" >&2
			if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then break; fi
			PAGE=$((PAGE + 1))
			sleep "$RATE_LIMIT_SECONDS"
		done
	done <<< "$ID_BATCHES"
fi

echo ""
WORKDIR="$WORKDIR" SINCE="$SINCE" python3 -c "
import glob, json, os

workdir = os.environ['WORKDIR']
since = os.environ['SINCE']

products = []  # (product, source)
for path in sorted(glob.glob(os.path.join(workdir, 'products-page-*.json'))):
    with open(path) as f:
        for p in json.load(f):
            products.append((p, 'primary'))
for path in sorted(glob.glob(os.path.join(workdir, 'triggered-page-*.json'))):
    with open(path) as f:
        for p in json.load(f):
            products.append((p, 'trigger'))

emitted = []
skipped = []
max_modified = since

for p, source in products:
    modified_date = p.get('modifiedDate', '')
    if modified_date > max_modified:
        max_modified = modified_date
    product_active = p.get('status') == 'Public'
    category = (p.get('categoryIdArray') or [None])[0]
    sub_group_id = str(category).zfill(3) if category is not None else ''
    colour = (p.get('customFields') or {}).get('products_1011') or ''
    brand = p.get('brand') or ''
    height = p.get('height') or 0
    length = p.get('length') or 0
    width = p.get('width') or 0

    for o in (p.get('productOptions') or []):
        option_active = o.get('status') == 'Primary'
        item_code = o.get('code')
        if not product_active or not option_active:
            skipped.append({
                'item_code': item_code, 'product': p.get('name'), 'productId': p.get('id'),
                'productStatus': p.get('status'), 'optionStatus': o.get('status'),
            })
            continue
        if not item_code:
            skipped.append({
                'item_code': '(missing productOptionCode)', 'product': p.get('name'),
                'productId': p.get('id'), 'productStatus': p.get('status'),
                'optionStatus': o.get('status'), 'reason': 'missing_item_code',
            })
            continue

        weight = o.get('optionWeight') or 0
        conversion_rate = ((o.get('uomOptions') or [{}])[0]).get('quantity') or 0
        missing_fields = ['dimension_uom', 'qty_uom']
        for name, val in [('colour', colour), ('weight', weight), ('height', height),
                          ('length', length), ('width', width),
                          ('conversion_rate', conversion_rate), ('brand', brand),
                          ('sub_group_id', sub_group_id)]:
            if not val:
                missing_fields.append(name)

        emitted.append({
            'item_code': item_code, 'size': o.get('size') or '', 'colour': colour,
            'ean': o.get('barcode') or '', 'weight': weight, 'height': height, 'length': length,
            'width': width, 'conversion_rate': conversion_rate, 'brand': brand,
            'sub_group_id': sub_group_id, 'product': p.get('name'), 'productId': p.get('id'),
            'modifiedDate': modified_date, 'source': source, 'missing_fields': missing_fields,
        })

print('=' * 78)
print(f'Preview for watermark = {since}')
print('=' * 78)
print()
print(f'Would emit {len(emitted)} record(s) to Manhattan as Company=CTC:')
print('-' * 78)
for e in emitted:
    tag = '[trigger]' if e['source'] == 'trigger' else '[primary]'
    print(f\"  {tag} {e['item_code']!r:16} <- product {e['productId']} {e['product']!r} (modified {e['modifiedDate']})\")
    print(f\"           size={e['size']!r} colour={e['colour']!r} ean={e['ean']!r} brand={e['brand']!r} sub_group_id={e['sub_group_id']!r}\")
    print(f\"           weight={e['weight']} height={e['height']} length={e['length']} width={e['width']} conversion_rate={e['conversion_rate']}\")
    if e['missing_fields']:
        print(f\"           would default-and-report (missing_fields): {e['missing_fields']}\")
if not emitted:
    print('  (none)')

print()
print(f'Would SKIP {len(skipped)} option(s):')
print('-' * 78)
for s in skipped:
    reason = s.get('reason', 'inactive (Cin7InactiveSkip)')
    print(f\"  {s['item_code']!r:28} <- product {s['productId']} {s['product']!r}  (productStatus={s['productStatus']}, optionStatus={s['optionStatus']}, reason={reason})\")
if not skipped:
    print('  (none)')

triggered_count = sum(1 for _, source in products if source == 'trigger')
print()
print(f'{triggered_count} product(s) above came ONLY from the /ProductOptions trigger path — a full')
print('product read (never from the options response itself), per BUSY-1115.')

print()
print(f'If this watermark were set for real, the poller would advance it to: {max_modified}')
print('(the max modifiedDate seen across every fetched product, primary and triggered, per the real poller logic)')
"
