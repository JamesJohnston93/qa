#!/usr/bin/env bash
# Answers OQ-2 (LLD §12): does editing a Cin7 ProductOption bump its parent Product's own
# modifiedDate? If yes, BUSY-1115's planned /ProductOptions trigger-fan-in is unnecessary
# complexity — the poller could go /Products-only. This script is a read-only, non-invasive way
# to gather evidence WITHOUT editing anything in Cin7 (CTC has no platform access to create/edit
# test data anyway, per this directory's README).
#
# Method: pull real, recently-modified ProductOptions directly, resolve each one's parent Product,
# and compare the option's own modifiedDate against its parent's. If the parent's modifiedDate is
# always >= the option's (and close in time), that's evidence edits DO bump the parent. If we find
# an option whose modifiedDate is clearly newer than its parent's, that's direct proof they don't
# — that option changed without the parent record being touched.
#
# BONUS: this also tests two things BUSY-1115's plan currently treats as unconfirmed guesses:
#   1. Which field on a /ProductOptions row actually references its parent product (guessed
#      `productID`).
#   2. Whether a ProductOptions row even carries its own `modifiedDate` at all.
# The script prints the raw first result so you can eyeball real field names rather than trusting
# the guesses below — if PARENT_ID_KEY/MODIFIED_KEY guesses are wrong, the "raw sample" output
# will make the real key names obvious.
#
# GET-ONLY, ALWAYS. Cin7 is a real production system for CTC — this script must never issue a
# POST/PUT/PATCH/DELETE against it. Only ever add a plain `curl` GET (no -X, no -d/--data) if
# extending this script.
#
# Same credential model as find-cin7-item.sh / preview-cin7-sync.sh: a `.env` file next to this
# script (auto-loaded), or CIN7_USERNAME / CIN7_API_KEY env vars, or --username/--api-key flags.
#
# Usage:
#   ./check-option-modified-date.sh [--limit N] [--max-pages N]
#
# Example:
#   ./check-option-modified-date.sh --limit 30
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
LIMIT=20
MAX_PAGES=1

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--limit) LIMIT="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials." >&2
	echo "Set CIN7_USERNAME and CIN7_API_KEY env vars, or pass --username/--api-key." >&2
	echo "Usage: $0 [--limit N] [--max-pages N]" >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Fetching recently-modified ProductOptions..." >&2

PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	RESPONSE=$(curl -s -w '\n%{http_code}' \
		-u "${USERNAME}:${API_KEY}" \
		-H "Accept: application/json" \
		"${CIN7_BASE_URL}/api/v1/ProductOptions?order=modifiedDate%20DESC&rows=${PAGE_SIZE}&page=${PAGE}")
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

	echo "$BODY" > "${WORKDIR}/options-page-${PAGE}.json"
	PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/options-page-${PAGE}.json'))))")
	echo "Fetched ProductOptions page $PAGE: $PAGE_COUNT row(s)" >&2

	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then
		break
	fi
	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

echo "" >&2
echo "Raw sample (first ProductOptions row — check real field names here if the guesses below look wrong):" >&2
python3 -c "
import json
page = json.load(open('${WORKDIR}/options-page-1.json'))
print(json.dumps(page[0], indent=2) if page else '(no rows returned)')
" >&2
echo "" >&2

# Extracts distinct parent product IDs from the first LIMIT options, trying a few candidate key
# names since the real one isn't confirmed (BUSY-1115's plan guesses `productID`).
PRODUCT_IDS_JSON=$(LIMIT="$LIMIT" WORKDIR="$WORKDIR" python3 -c "
import glob, json, os

limit = int(os.environ['LIMIT'])
workdir = os.environ['WORKDIR']
candidate_keys = ['productID', 'productId', 'ProductID', 'parentProductID', 'parentProductId', 'product_id']

options = []
for path in sorted(glob.glob(os.path.join(workdir, 'options-page-*.json'))):
    with open(path) as f:
        options.extend(json.load(f))
options = options[:limit]

resolved_key = None
for key in candidate_keys:
    if options and key in options[0]:
        resolved_key = key
        break

if not resolved_key:
    print(json.dumps({'error': 'none of the candidate parent-id keys were found', 'candidates': candidate_keys}))
else:
    ids = sorted({o[resolved_key] for o in options if o.get(resolved_key) is not None})
    print(json.dumps({'key': resolved_key, 'ids': ids, 'optionCount': len(options)}))
")

RESOLVED_KEY=$(echo "$PRODUCT_IDS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('key',''))")
if [[ -z "$RESOLVED_KEY" ]]; then
	echo "Could not find a parent-product-id field on a ProductOptions row using any candidate key." >&2
	echo "$PRODUCT_IDS_JSON" >&2
	echo "Check the raw sample above and adjust this script's candidate_keys list." >&2
	exit 1
fi
echo "Resolved parent-product-id field: '$RESOLVED_KEY'" >&2

IDS_CSV=$(echo "$PRODUCT_IDS_JSON" | python3 -c "import json,sys; print(','.join(str(i) for i in json.load(sys.stdin)['ids']))")
echo "Distinct parent product IDs to resolve: $IDS_CSV" >&2
echo "" >&2

# Fetch every parent product in one request — the same where=id in (...) shape BUSY-1115 plans
# for its own getProductsByIds connector method, so this doubles as an early sanity check of that.
WHERE="id in (${IDS_CSV})"
WHERE_ENCODED=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$WHERE")

RESPONSE=$(curl -s -w '\n%{http_code}' \
	-u "${USERNAME}:${API_KEY}" \
	-H "Accept: application/json" \
	"${CIN7_BASE_URL}/api/v1/Products?where=${WHERE_ENCODED}&rows=${PAGE_SIZE}&page=1")
STATUS_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$STATUS_CODE" != "200" ]]; then
	echo "Cin7 request for parent products failed: HTTP $STATUS_CODE" >&2
	echo "$BODY" >&2
	exit 1
fi
echo "$BODY" > "${WORKDIR}/parent-products.json"

RESOLVED_KEY="$RESOLVED_KEY" LIMIT="$LIMIT" WORKDIR="$WORKDIR" python3 -c "
import glob, json, os

resolved_key = os.environ['RESOLVED_KEY']
limit = int(os.environ['LIMIT'])
workdir = os.environ['WORKDIR']

options = []
for path in sorted(glob.glob(os.path.join(workdir, 'options-page-*.json'))):
    with open(path) as f:
        options.extend(json.load(f))
options = options[:limit]

with open(os.path.join(workdir, 'parent-products.json')) as f:
    products = json.load(f)
products_by_id = {p['id']: p for p in products}

rows = []
for o in options:
    parent_id = o.get(resolved_key)
    parent = products_by_id.get(parent_id)
    option_modified = o.get('modifiedDate')
    parent_modified = parent.get('modifiedDate') if parent else None
    rows.append({
        'optionCode': o.get('code'),
        'parentId': parent_id,
        'optionModified': option_modified,
        'parentModified': parent_modified,
        'parentFound': parent is not None,
    })

print('=' * 100)
print(f'{len(rows)} option(s) checked against their resolved parent product')
print('=' * 100)
print()
newer_than_parent = []
missing_parent = []
missing_option_modified = []
for r in rows:
    flag = ''
    if not r['parentFound']:
        flag = '  <-- PARENT NOT FOUND'
        missing_parent.append(r)
    elif r['optionModified'] is None:
        flag = '  <-- option has no modifiedDate field'
        missing_option_modified.append(r)
    elif r['optionModified'] > r['parentModified']:
        flag = '  <-- OPTION NEWER THAN PARENT (evidence: edits do NOT bump the parent)'
        newer_than_parent.append(r)
    print(f\"option {r['optionCode']!r:20} (parent {r['parentId']})  option.modifiedDate={r['optionModified']}  parent.modifiedDate={r['parentModified']}{flag}\")

print()
print('-' * 100)
print('VERDICT')
print('-' * 100)
if missing_option_modified:
    print(f'{len(missing_option_modified)} option(s) have no modifiedDate field at all on /ProductOptions —')
    print('check the raw sample printed above; this script\'s modifiedDate assumption may be wrong.')
elif newer_than_parent:
    print(f'{len(newer_than_parent)}/{len(rows)} option(s) have a modifiedDate NEWER than their parent product\'s.')
    print('This is direct evidence that editing a ProductOption does NOT always bump the parent')
    print('Product\'s modifiedDate — the /ProductOptions trigger-fan-in in the BUSY-1115 plan is')
    print('likely still needed (OQ-2 resolves to \"no\").')
else:
    print(f'All {len(rows)} option(s) checked have a parent modifiedDate >= the option\'s own.')
    print('Consistent with (but not proof of) editing a ProductOption always bumping the parent')
    print('Product\'s modifiedDate — re-run with a higher --limit/--max-pages for more confidence')
    print('before deciding to drop the /ProductOptions trigger-fan-in (OQ-2\'s \"yes\" branch).')
if missing_parent:
    print(f'({len(missing_parent)} option(s) had no matching parent product in the batch — worth')
    print(' investigating separately, may indicate a deleted/inaccessible product.)')
"