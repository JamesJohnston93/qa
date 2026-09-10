#!/usr/bin/env bash
# One Cin7 GET for CTC sales orders at New or Processing, modified inside one poller cycle's own
# window, printing the fast company-name proxy per order (not a resolved contact group).
#
# Ticket:      RETEST-1158-1159
# Slice:       R11, Gate B
# Asserts:     which orders, if any, were sitting at New or Processing inside a given historical
#              poller cycle window, and reads as a candidate for "should the cycle's counters have
#              accounted for this order."
# Does NOT:    resolve contact group (company name is a fast proxy only, per
#              find-picked-stage-orders.sh's own convention) or say whether the cycle actually
#              processed the order -- that comparison is made by hand against the cycle's own
#              printed counters, read separately from CloudWatch.
# Side effects: read only, one Cin7 GET (paginated if the window is wide).
#
# Usage: ./gate-b-window-check.sh --modified-since <ISO8601> --modified-before <ISO8601> [--rows N]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi

MODIFIED_SINCE=""
MODIFIED_BEFORE=""
ROWS=250

while [[ $# -gt 0 ]]; do
	case "$1" in
		--modified-since) MODIFIED_SINCE="$2"; shift 2 ;;
		--modified-before) MODIFIED_BEFORE="$2"; shift 2 ;;
		--rows) ROWS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$MODIFIED_SINCE" || -z "$MODIFIED_BEFORE" ]]; then
	echo "Usage: $0 --modified-since <ISO8601> --modified-before <ISO8601> [--rows N]" >&2
	exit 1
fi

if [[ -z "${CIN7_USERNAME:-}" || -z "${CIN7_API_KEY:-}" ]]; then
	echo "Missing Cin7 credentials. Set CIN7_USERNAME and CIN7_API_KEY, or provide .env at the tools root." >&2
	exit 1
fi

WHERE="isApproved=true AND branchId IN (51908,51909) AND modifiedDate>='${MODIFIED_SINCE}' AND modifiedDate<'${MODIFIED_BEFORE}'"
WHERE_ENC=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$WHERE")

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

PAGE=1
while true; do
	curl -s -u "${CIN7_USERNAME}:${CIN7_API_KEY}" -H "Accept: application/json" \
		"https://api.cin7.com/api/v1/SalesOrders?where=${WHERE_ENC}&order=modifiedDate%20DESC&rows=${ROWS}&page=${PAGE}" \
		> "${WORKDIR}/page-${PAGE}.json"
	COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/page-${PAGE}.json'))))")
	if [[ "$COUNT" -lt "$ROWS" ]]; then
		break
	fi
	PAGE=$((PAGE + 1))
	sleep 0.35
done

echo "Window: modifiedSince=${MODIFIED_SINCE} modifiedBefore=${MODIFIED_BEFORE}"
python3 -c "
import glob, json
total = 0
for path in sorted(glob.glob('${WORKDIR}/page-*.json')):
    with open(path) as f:
        page = json.load(f)
    total += len(page)
    for o in page:
        print(f\"  {o.get('reference'):<24} stage={o.get('stage'):<16} status={o.get('status'):<10} branch={o.get('branchId')}  company={o.get('company')!r:<30}  modified={o.get('modifiedDate')}\")
print(f'{total} order(s) in this window (branches 51908/51909, any stage).')
"
