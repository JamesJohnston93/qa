#!/usr/bin/env bash
# Counts CTC order modifications per hour over the last 72 hours, split weekday vs weekend, and
# flags every dispatch-batch signature (a burst of 10+ orders inside about 90 seconds).
# Extends R10 Gate C's method (paginated GET, fields=modifiedDate only, cheap) over a shorter,
# more recent window that happens to span a weekend.
#
# Ticket:      RETEST-1158-1159
# Slice:       R11, Gate E
# Asserts:     the per-hour order-modification rate over the last 72 hours, split weekday vs
#              weekend, and every minute-bucket with 10+ orders (a dispatch-batch signature),
#              with its timestamp.
# Does NOT:    prove next weekend will look the same as this one. Does NOT distinguish which order
#              type or stage each modification belongs to -- volume only, per R10 Gate C's own
#              scope.
# Side effects: read only. Paginated Cin7 GET, fields=modifiedDate only, no other fields fetched.
#
# Usage: ./dispatch-batch-weekday-weekend.sh [--hours N] [--max-pages N]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi

HOURS=72
MAX_PAGES=30
ROWS=250

while [[ $# -gt 0 ]]; do
	case "$1" in
		--hours) HOURS="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "${CIN7_USERNAME:-}" || -z "${CIN7_API_KEY:-}" ]]; then
	echo "Missing Cin7 credentials. Set CIN7_USERNAME and CIN7_API_KEY, or provide .env at the tools root." >&2
	exit 1
fi

SINCE=$(python3 -c "
from datetime import datetime, timezone, timedelta
print((datetime.now(timezone.utc) - timedelta(hours=${HOURS})).strftime('%Y-%m-%dT%H:%M:%SZ'))
")

WHERE="isApproved=true AND branchId IN (51908,51909) AND modifiedDate>='${SINCE}'"
WHERE_ENC=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$WHERE")

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Window: last ${HOURS}h, modifiedSince=${SINCE}"

PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	curl -s -u "${CIN7_USERNAME}:${CIN7_API_KEY}" -H "Accept: application/json" \
		"https://api.cin7.com/api/v1/SalesOrders?where=${WHERE_ENC}&fields=modifiedDate&order=modifiedDate%20ASC&rows=${ROWS}&page=${PAGE}" \
		> "${WORKDIR}/page-${PAGE}.json"
	COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/page-${PAGE}.json'))))")
	echo "  page ${PAGE}: ${COUNT} rows"
	if [[ "$COUNT" -lt "$ROWS" ]]; then
		break
	fi
	if [[ "$PAGE" -eq "$MAX_PAGES" ]]; then
		echo "!! page cap ($MAX_PAGES) hit -- window may not be fully captured" >&2
	fi
	PAGE=$((PAGE + 1))
	sleep 0.35
done
echo

python3 -c "
import glob, json
from datetime import datetime, timezone
from collections import defaultdict

dates = []
for path in sorted(glob.glob('${WORKDIR}/page-*.json')):
    with open(path) as f:
        page = json.load(f)
    for o in page:
        md = o.get('modifiedDate')
        if md:
            dates.append(datetime.strptime(md, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc))

print(f'Total orders in window: {len(dates)}')
print()

# Per-hour, split weekday (Mon-Fri, weekday()<5) vs weekend (Sat/Sun).
by_day_hour = defaultdict(int)
weekday_counts = defaultdict(int)
weekend_counts = defaultdict(int)
for d in dates:
    key = (d.date().isoformat(), d.hour)
    by_day_hour[key] += 1
    if d.weekday() >= 5:
        weekend_counts[d.hour] += 1
    else:
        weekday_counts[d.hour] += 1

print('Per-day, per-hour (UTC) counts:')
for (day, hour), count in sorted(by_day_hour.items()):
    dow = datetime.fromisoformat(day).strftime('%a')
    print(f'  {day} ({dow}) {hour:02d}:00  {count}')
print()

total_weekday_hours = len({d.date() for d in dates if d.weekday() < 5}) * 24 or 1
total_weekend_hours = len({d.date() for d in dates if d.weekday() >= 5}) * 24 or 1
weekday_total = sum(weekday_counts.values())
weekend_total = sum(weekend_counts.values())
print(f'Weekday total: {weekday_total} orders')
print(f'Weekend total: {weekend_total} orders')
print()

# Minute-bucket dispatch-batch signature: 10+ orders inside one minute.
by_minute = defaultdict(int)
for d in dates:
    key = d.strftime('%Y-%m-%dT%H:%M')
    by_minute[key] += 1

print('Minute-buckets with 10+ orders (dispatch-batch signature):')
batches = [(m, c) for m, c in sorted(by_minute.items()) if c >= 10]
if not batches:
    print('  none found in this window')
for m, c in batches:
    print(f'  {m}Z  {c} orders')
"
