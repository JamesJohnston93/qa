#!/usr/bin/env bash
# Looks up real Cin7 products/options by status, so you have a known reference item before
# testing. Cin7 test data can't be created to order (no platform access, API-only, read-only) —
# every test uses whatever genuinely exists in Cin7. With no filters, just lists recent products
# so you can eyeball what's available. Read-only: this only ever GETs from Cin7.
#
# Talks to Cin7 directly (not via AWS) — this is the same API the poller itself calls, using
# Basic auth. Credentials are NOT AWS-managed for this script. Recommended: put
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
# NOTE ON FILTERING: Cin7's API supports a generic `where` clause, but only its modifiedDate
# filtering is confirmed working in practice. Status filtering here is done client-side,
# against whatever the most-recently-modified page(s) return — it will not find a matching
# item that isn't within the last (--max-pages * 250) most-recently-modified products. If you
# need to go further back, raise --max-pages.
#
# Usage:
#   ./find-cin7-item.sh [--product-status <status>] [--option-status <status>] [--limit N] [--max-pages N]
#
# Product status values (per Cin7): Public, Inactive, ShowInB2B, Internal — only Public counts as
# active for this pipeline.
# Option status values (per Cin7): Primary, Active, Disabled — only Primary counts as active.
#
# Example (browse recent):               CIN7_USERNAME=... CIN7_API_KEY=... ./find-cin7-item.sh
# Example (find an active reference):    ./find-cin7-item.sh --product-status Public --option-status Primary
# Example (find an inactive product):    ./find-cin7-item.sh --product-status Inactive
# Example (find a disabled option):      ./find-cin7-item.sh --option-status Disabled --max-pages 3
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

USERNAME="${CIN7_USERNAME:-}"
API_KEY="${CIN7_API_KEY:-}"
PRODUCT_STATUS=""
OPTION_STATUS=""
LIMIT=5
MAX_PAGES=1

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--product-status) PRODUCT_STATUS="$2"; shift 2 ;;
		--option-status) OPTION_STATUS="$2"; shift 2 ;;
		--limit) LIMIT="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials." >&2
	echo "Set CIN7_USERNAME and CIN7_API_KEY env vars, or pass --username/--api-key." >&2
	echo "Usage: $0 [--product-status <status>] [--option-status <status>] [--limit N] [--max-pages N]" >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	RESPONSE=$(curl -s -w '\n%{http_code}' \
		-u "${USERNAME}:${API_KEY}" \
		-H "Accept: application/json" \
		"${CIN7_BASE_URL}/api/v1/Products?order=modifiedDate%20DESC&rows=${PAGE_SIZE}&page=${PAGE}")
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

	# Cin7 returns fewer than a full page once we've reached the end of the catalogue.
	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then
		break
	fi

	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

PRODUCT_STATUS="$PRODUCT_STATUS" OPTION_STATUS="$OPTION_STATUS" LIMIT="$LIMIT" WORKDIR="$WORKDIR" python3 -c "
import glob, json, os

product_status = os.environ.get('PRODUCT_STATUS', '')
option_status = os.environ.get('OPTION_STATUS', '')
limit = int(os.environ['LIMIT'])
workdir = os.environ['WORKDIR']

matches = []
for path in sorted(glob.glob(os.path.join(workdir, 'page-*.json'))):
    with open(path) as f:
        page = json.load(f)
    for p in page:
        if product_status and p.get('status') != product_status:
            continue
        options = p.get('productOptions') or []
        if option_status:
            options = [o for o in options if o.get('status') == option_status]
            if not options:
                continue
        matches.append({
            'id': p.get('id'),
            'name': p.get('name'),
            'status': p.get('status'),
            'modifiedDate': p.get('modifiedDate'),
            'options': [{'code': o.get('code'), 'status': o.get('status')} for o in options],
        })
        if len(matches) >= limit:
            break
    if len(matches) >= limit:
        break

if not matches:
    print('No matching products found in the pages checked. Try --max-pages higher, or loosen the filters.')
else:
    print(f'{len(matches)} match(es):')
    print('-' * 60)
    for m in matches:
        print(f\"Product {m['id']} — {m['name']}\")
        print(f\"  status: {m['status']}   modifiedDate: {m['modifiedDate']}\")
        for o in m['options']:
            print(f\"  option {o['code']!r} — status: {o['status']}\")
        print()
"
