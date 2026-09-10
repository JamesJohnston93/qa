#!/usr/bin/env bash
# Dry-runs one Cin7 poller cycle against a candidate watermark, WITHOUT touching the real
# watermark or emitting anything — so you can see exactly what a given `cin7-watermark.sh --set`
# would actually produce before committing to it. Mirrors the poller's real logic exactly
# (see services/catalog/lambda/manhattan/cin7-item-poller.ts):
#   - same query: where=modifiedDate>'<since>' (strict, not >=), order=modifiedDate ASC, rows=250
#   - same full pagination (loops while a page returns exactly 250 rows)
#   - same active-status gate: only Product.status=Public AND ProductOption.status=Primary
#     would actually be emitted as a Manhattan item; everything else is a Cin7InactiveSkip
#   - same watermark-advance rule: the max modifiedDate across every fetched product is what the
#     real watermark would move to after a real cycle
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

# URL-encode the where clause exactly as the connector does (modifiedDate>'<since>').
WHERE="modifiedDate>'${SINCE}'"
WHERE_ENCODED=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$WHERE")

PAGE=1
TOTAL_PRODUCTS=0
while [[ $PAGE -le $MAX_PAGES ]]; do
	RESPONSE=$(curl -s -w '\n%{http_code}' \
		-u "${USERNAME}:${API_KEY}" \
		-H "Accept: application/json" \
		"${CIN7_BASE_URL}/api/v1/Products?where=${WHERE_ENCODED}&order=modifiedDate%20ASC&rows=${PAGE_SIZE}&page=${PAGE}")
	STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
	BODY=$(echo "$RESPONSE" | sed '$d')

	if [[ "$STATUS_CODE" == "429" ]]; then
		echo "Rate limited by Cin7 — waiting 1s and retrying this page once..." >&2
		sleep 1
		continue
	fi
	if [[ "$STATUS_CODE" != "200" ]]; then
		echo "Cin7 request failed: HTTP $STATUS_CODE" >&2
		echo "$BODY" >&2
		exit 1
	fi

	echo "$BODY" > "${WORKDIR}/page-${PAGE}.json"
	PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/page-${PAGE}.json'))))")
	TOTAL_PRODUCTS=$((TOTAL_PRODUCTS + PAGE_COUNT))
	echo "Fetched page $PAGE: $PAGE_COUNT product(s)" >&2

	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then
		break
	fi
	if [[ $PAGE -eq $MAX_PAGES ]]; then
		echo "Hit --max-pages ($MAX_PAGES) — there may be more data than this preview shows. Raise --max-pages to see it all." >&2
	fi

	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

echo ""
WORKDIR="$WORKDIR" SINCE="$SINCE" python3 -c "
import glob, json, os

workdir = os.environ['WORKDIR']
since = os.environ['SINCE']

emitted = []
skipped = []
max_modified = since

for path in sorted(glob.glob(os.path.join(workdir, 'page-*.json')), key=lambda p: int(p.split('-')[-1].split('.')[0])):
    with open(path) as f:
        page = json.load(f)
    for p in page:
        modified_date = p.get('modifiedDate', '')
        if modified_date > max_modified:
            max_modified = modified_date
        product_active = p.get('status') == 'Public'
        for o in (p.get('productOptions') or []):
            option_active = o.get('status') == 'Primary'
            item_code = o.get('code')
            if product_active and option_active:
                emitted.append({
                    'item_code': item_code,
                    'product': p.get('name'),
                    'productId': p.get('id'),
                    'modifiedDate': modified_date,
                })
            else:
                skipped.append({
                    'item_code': item_code,
                    'product': p.get('name'),
                    'productId': p.get('id'),
                    'productStatus': p.get('status'),
                    'optionStatus': o.get('status'),
                })

print('=' * 70)
print(f'Preview for watermark = {since}')
print('=' * 70)
print()
print(f'Would emit {len(emitted)} record(s) to Manhattan as Company=CTC:')
print('-' * 70)
for e in emitted:
    print(f\"  {e['item_code']!r:16} <- product {e['productId']} {e['product']!r} (modified {e['modifiedDate']})\")
if not emitted:
    print('  (none)')

print()
print(f'Would SKIP {len(skipped)} option(s) — inactive (Cin7InactiveSkip):')
print('-' * 70)
for s in skipped:
    print(f\"  {s['item_code']!r:16} <- product {s['productId']} {s['product']!r}  (productStatus={s['productStatus']}, optionStatus={s['optionStatus']})\")
if not skipped:
    print('  (none)')

print()
print(f'If this watermark were set for real, the poller would advance it to: {max_modified}')
print('(the max modifiedDate seen across every fetched product, per the real poller logic)')
"
