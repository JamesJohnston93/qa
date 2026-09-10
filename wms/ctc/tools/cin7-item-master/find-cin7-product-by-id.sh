#!/usr/bin/env bash
# Looks up one or more specific Cin7 products by id, in full (including every productOption, not
# just ones recently modified) — the same request shape the poller's own getProductsByIds makes
# (libs/cin7/src/connector/cin7-connector.ts). Complements find-cin7-item.sh, which browses
# recent products by status but can't target a known id directly.
#
# Built for BUSY-1117's dashboard verification: to tell whether "records emitted" matching
# "option rows fetched" for a cycle is a real bug or just this test data's shape, you need to
# know a triggered product's TOTAL active-option count, not just how many of its options showed
# up as "modified" in that cycle's /ProductOptions window (e.g. via the temp
# Cin7ProductOptionRowTemp per-row log). This script answers that directly.
#
# Talks to Cin7 directly (not via AWS) — same API the poller itself calls, using Basic auth.
# Credentials are NOT AWS-managed for this script. Recommended: put
#   CIN7_USERNAME=...
#   CIN7_API_KEY=...
# in a `.env` file next to this script (auto-loaded, never printed, not a git repo so nothing
# gets committed) — the same file find-cin7-item.sh already uses — or export them as env vars
# yourself, or pass --username/--api-key flags (least preferred — these land in shell history
# and `ps` output).
#
# GET-ONLY, ALWAYS. Cin7 is a real production system for CTC — this script must never issue a
# POST/PUT/PATCH/DELETE against it. Only ever add a plain `curl` GET (no -X, no -d/--data) if
# extending this script.
#
# Chunks ids at CIN7_ID_FILTER_BATCH_SIZE (100) per request, matching the connector's own
# getProductsByIds — Cin7's `where=id in (...)` has an undocumented size ceiling (see
# architecture-notes.md's "Cin7's `where=id in (...)` has an undocumented size ceiling" section).
# Unlikely to matter for a handful of ids, but keeps this script safe if ever passed more.
#
# Usage:
#   ./find-cin7-product-by-id.sh --id <productId> [--id <productId> ...]
#
# Example:
#   ./find-cin7-product-by-id.sh --id 47706 --id 49124
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
ID_FILTER_BATCH_SIZE=100

USERNAME="${CIN7_USERNAME:-}"
API_KEY="${CIN7_API_KEY:-}"
IDS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--id) IDS+=("$2"); shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials." >&2
	echo "Set CIN7_USERNAME and CIN7_API_KEY env vars, or pass --username/--api-key." >&2
	echo "Usage: $0 --id <productId> [--id <productId> ...]" >&2
	exit 1
fi

if [[ ${#IDS[@]} -eq 0 ]]; then
	echo "At least one --id is required." >&2
	echo "Usage: $0 --id <productId> [--id <productId> ...]" >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

BATCH_NUM=0
for ((i = 0; i < ${#IDS[@]}; i += ID_FILTER_BATCH_SIZE)); do
	BATCH_NUM=$((BATCH_NUM + 1))
	BATCH_IDS="${IDS[*]:i:ID_FILTER_BATCH_SIZE}"
	BATCH_IDS="${BATCH_IDS// /,}"

	RESPONSE=$(curl -s -w '\n%{http_code}' \
		-u "${USERNAME}:${API_KEY}" \
		-H "Accept: application/json" \
		-G "${CIN7_BASE_URL}/api/v1/Products" \
		--data-urlencode "where=id in (${BATCH_IDS})" \
		--data-urlencode "order=modifiedDate ASC" \
		--data-urlencode "rows=${PAGE_SIZE}" \
		--data-urlencode "page=1")
	STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
	BODY=$(echo "$RESPONSE" | sed '$d')

	if [[ "$STATUS_CODE" != "200" ]]; then
		echo "Cin7 request failed: HTTP $STATUS_CODE" >&2
		echo "$BODY" >&2
		exit 1
	fi

	echo "$BODY" > "${WORKDIR}/batch-${BATCH_NUM}.json"
done

WORKDIR="$WORKDIR" python3 -c "
import glob, json, os

workdir = os.environ['WORKDIR']
products = []
for path in sorted(glob.glob(os.path.join(workdir, 'batch-*.json'))):
    with open(path) as f:
        products.extend(json.load(f))

if not products:
    print('No matching products found for the given id(s).')
else:
    for p in products:
        opts = p.get('productOptions') or []
        primary = [o for o in opts if o.get('status') == 'Primary']
        print(f\"Product {p.get('id')} — {p.get('name')!r}\")
        print(f\"  status: {p.get('status')}   modifiedDate: {p.get('modifiedDate')}\")
        print(f\"  total options: {len(opts)}   Primary-status (active) options: {len(primary)}\")
        for o in opts:
            print(f\"    code={o.get('code')!r} status={o.get('status')!r} modifiedDate={o.get('modifiedDate')!r}\")
        print()
"