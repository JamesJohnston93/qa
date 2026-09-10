#!/usr/bin/env bash
# Finds real CTC sales orders currently at Cin7 stage "Fully Picked" or "Partially Picked", and
# prints each one's company name so a wholesale account can be told apart from a genuine ECOM
# customer order at a glance, without a second per-order contact lookup.
#
# Ticket:      BUSY-1159
# Cases:       TC14
# Asserts:     which real orders, if any, are currently at one of these two stages, and whether
#              any of them look like an ECOM (individual customer) order rather than a wholesale
#              account. Company name is a fast proxy, not a resolved contact group: Cin7's own
#              `stage` field is server-side filterable, contact group is not, so a firm ECOM/
#              wholesale call still needs find-cin7-sales-order.sh --reference <ref> --with-contact
#              on any candidate this turns up.
# Does NOT:    resolve contact group. Does NOT create, edit or void anything, GET only.
# Side effects: read only, one Cin7 GET
#
# Usage: ./find-picked-stage-orders.sh --since <ISO8601> [--rows N]
#   --since   only orders modified on or after this timestamp (keep it narrow, shared API budget)
#   --rows    max orders to return, default 100
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi

SINCE=""
ROWS=100

while [[ $# -gt 0 ]]; do
	case "$1" in
		--since) SINCE="$2"; shift 2 ;;
		--rows) ROWS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$SINCE" ]]; then
	echo "Usage: $0 --since <ISO8601> [--rows N]" >&2
	echo "Example: $0 --since 2026-08-25T00:00:00Z" >&2
	exit 1
fi

if [[ -z "${CIN7_USERNAME:-}" || -z "${CIN7_API_KEY:-}" ]]; then
	echo "Missing Cin7 credentials. Set CIN7_USERNAME and CIN7_API_KEY, or provide .env at the tools root." >&2
	exit 1
fi

WHERE="isApproved=true AND branchId IN (51908,51909) AND stage IN ('Fully Picked','Partially Picked') AND modifiedDate>='${SINCE}'"
WHERE_ENC=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$WHERE")

curl -s -u "${CIN7_USERNAME}:${CIN7_API_KEY}" -H "Accept: application/json" \
	"https://api.cin7.com/api/v1/SalesOrders?where=${WHERE_ENC}&order=modifiedDate%20DESC&rows=${ROWS}&page=1" \
| python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'{len(data)} order(s) at Fully Picked or Partially Picked since ${SINCE}')
for o in data:
    print(f\"  {o.get('reference'):<20} stage={o.get('stage'):<16} branch={o.get('branchId')}  company={o.get('company')}  modified={o.get('modifiedDate')}\")
"
