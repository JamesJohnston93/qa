#!/usr/bin/env bash
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ CLEARED TO RUN — read-only against Cin7. GET-only, always: Cin7 is CTC's production      │
# │ system. Only ever add a plain `curl` GET (no -X, no -d/--data) if extending this script.  │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# Population survey of CTC sales orders: distributions rather than examples.
#
# Why this exists: `find-cin7-sales-order.sh` answers "show me an order". This answers "what does
# the population look like" — which stage values exist, how many orders actually carry a
# logisticsCarrier, which projectName literals are in use. Those are the questions that decide
# whether a mapping table is complete, and they cannot be answered from a handful of examples.
#
# It is cheap: one GET per page, 250 orders per page, no contact lookups. A single page is usually
# enough to see a distribution.
#
# The cross-tabulation is the point. Carrier-by-stage is what shows *when* Cin7 populates a field,
# which two independent count lists cannot tell you.
#
# Credentials: same model as find-cin7-sales-order.sh — a `.env` at the toolset root holding
#   CIN7_USERNAME=...
#   CIN7_API_KEY=...
# (auto-loaded, never printed), or the same env vars exported yourself.
#
# Usage:
#   ./survey-cin7-orders.sh [--max-pages N] [--branch ID] [--any-branch] [--json]
#
#   --max-pages N   pages of 250 to fetch (default 1). Each page is one Cin7 GET.
#   --branch ID     narrow to one branch instead of both CTC warehouses
#   --any-branch    drop the branch filter entirely
#   --json          emit the aggregates as JSON instead of tables
#
# Examples:
#   ./survey-cin7-orders.sh                      # 250 orders, 1 API call
#   ./survey-cin7-orders.sh --max-pages 4        # 1000 orders, 4 API calls
#   ./survey-cin7-orders.sh --any-branch --json  # unfiltered, machine-readable
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
MAX_PAGES=1
BRANCH=""
ANY_BRANCH=0
AS_JSON=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		--branch) BRANCH="$2"; shift 2 ;;
		--any-branch) ANY_BRANCH=1; shift ;;
		--json) AS_JSON=1; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials." >&2
	echo "Set CIN7_USERNAME and CIN7_API_KEY env vars, or pass --username/--api-key." >&2
	echo "Usage: $0 [--max-pages N] [--branch ID] [--any-branch] [--json]" >&2
	exit 1
fi

urlencode() {
	python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

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

# `isApproved=true` keeps DRAFT orders out — the same filter the poller relies on.
build_where() {
	local clauses=("isApproved=true")
	if [[ -n "$BRANCH" ]]; then
		clauses+=("branchId IN (${BRANCH})")
	elif [[ $ANY_BRANCH -eq 0 ]]; then
		clauses+=("branchId IN (${CTC_BRANCHES})")
	fi
	local joined="${clauses[0]}"
	local i
	for (( i = 1; i < ${#clauses[@]}; i++ )); do
		joined+=" AND ${clauses[i]}"
	done
	echo "$joined"
}

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

WHERE_ENCODED=$(urlencode "$(build_where)")

PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	echo "Fetching page ${PAGE} (up to ${PAGE_SIZE} orders)..." >&2
	BODY=$(cin7_get "/api/v1/SalesOrders?where=${WHERE_ENCODED}&order=modifiedDate%20DESC&rows=${PAGE_SIZE}&page=${PAGE}")
	echo "$BODY" > "${WORKDIR}/page-${PAGE}.json"
	PAGE_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/page-${PAGE}.json'))))")

	# Cin7 returns fewer than a full page once the result set is exhausted.
	if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then
		break
	fi

	PAGE=$((PAGE + 1))
	sleep "$RATE_LIMIT_SECONDS"
done

WORKDIR="$WORKDIR" AS_JSON="$AS_JSON" python3 -c "
import glob, json, os
from collections import Counter, defaultdict

workdir = os.environ['WORKDIR']
as_json = os.environ['AS_JSON'] == '1'

orders = []
for path in sorted(glob.glob(os.path.join(workdir, 'page-*.json'))):
    with open(path) as f:
        orders.extend(json.load(f))

total = len(orders)
if not total:
    print('No orders returned.')
    raise SystemExit(0)

def carrier_of(o):
    # '' and absent both mean 'not assigned yet' and are counted apart, since they are distinct
    # states in the payload even though every consumer treats them the same.
    c = o.get('logisticsCarrier')
    if c is None:
        return '(absent)'
    if c == '':
        return \"('' empty string)\"
    return c

stages   = Counter(o.get('stage') for o in orders)
statuses = Counter(o.get('status') for o in orders)
carriers = Counter(carrier_of(o) for o in orders)
projects = Counter(o.get('projectName') for o in orders)
branches = Counter(o.get('branchId') for o in orders)
members  = {o.get('memberId') for o in orders}

# The cross-tab: does a carrier appear only at certain stages? Two flat lists cannot answer this.
by_stage = defaultdict(lambda: [0, 0])   # stage -> [with carrier, without]
for o in orders:
    c = o.get('logisticsCarrier')
    by_stage[o.get('stage')][0 if c else 1] += 1

no_lines = sum(1 for o in orders if not (o.get('lineItems') or []))

# Line shape. A Cin7 lineItem fans out into one SCALE detail per size, but every size inherits the
# lineItem's own id as ErpOrderLineNum — and SCALE keys a detail on ErpOrderLineNum alone (probed
# 27 Aug 2026: a second document reusing the number REPLACED the first line rather than adding to
# it). So any line carrying more than one shippable size loses all but one of them in SCALE. This
# counts how much of the real population that is.
#
# Only sizes with qty > 0 count: expandLineItems skips a zero-qty size, so it never becomes a
# detail and cannot collide.
def shippable_sizes(line):
    sizes = line.get('sizes') or []
    if not sizes:
        # No sizes[] means a single-size item, carried on the line itself.
        return 1 if (line.get('qty') or 0) > 0 else 0
    return sum(1 for s in sizes if (s.get('qty') or 0) > 0)

sizes_per_line = Counter()
worst_line_per_order = Counter()
affected_orders = 0
affected_lines = 0
lost_details = 0

# The sizes[] SHAPE, kept separate from the shippable-size count above, which folds an absent
# array and a one-entry array into the same bucket. expandLineItems falls back to lineItems[].code
# when sizes[] is empty -- and lineItems[].code is the STYLE code, not the product option code
# SCALE's item master is keyed on. So whether that branch ever fires on real data decides whether
# it is correct handling, dead code, or a live path that sends an unrecognised item to SCALE.
sizes_shape = Counter()
example_missing = []
example_empty = []
for o in orders:
    worst = 0
    for line in (o.get('lineItems') or []):
        raw_sizes = line.get('sizes')
        if 'sizes' not in line or raw_sizes is None:
            sizes_shape['absent (no sizes key, or null)'] += 1
            if len(example_missing) < 40:
                example_missing.append((o.get('reference'), line.get('id'), line.get('code'), line.get('qty'), o.get('stage'), o.get('branchId'), o.get('status')))
        elif len(raw_sizes) == 0:
            sizes_shape['present but empty []'] += 1
            if len(example_empty) < 40:
                example_empty.append((o.get('reference'), line.get('id'), line.get('code'), line.get('qty'), o.get('stage'), o.get('branchId'), o.get('status')))
        elif len(raw_sizes) == 1:
            sizes_shape['exactly one size entry'] += 1
        else:
            n_sizes = len(raw_sizes)
            sizes_shape[str(n_sizes) + ' size entries'] += 1

        n = shippable_sizes(line)
        sizes_per_line[n] += 1
        worst = max(worst, n)
        if n > 1:
            affected_lines += 1
            lost_details += n - 1
    worst_line_per_order[worst] += 1
    if worst > 1:
        affected_orders += 1


if as_json:
    print(json.dumps({
        'total': total,
        'stages': stages,
        'statuses': statuses,
        'carriers': carriers,
        'projectNames': projects,
        'branchIds': {str(k): v for k, v in branches.items()},
        'distinctMemberIds': len(members),
        'ordersWithNoLineItems': no_lines,
        'lineShape': {
            'ordersWithAMultiSizeLine': affected_orders,
            'ordersTotal': total,
            'multiSizeLines': affected_lines,
            'detailsLostToLineNumCollision': lost_details,
            'shippableSizesPerLine': dict(sorted(sizes_per_line.items())),
            'worstLinePerOrder': dict(sorted(worst_line_per_order.items())),
            'sizesArrayShape': dict(sorted(sizes_shape.items())),
            'examplesSizesAbsent': example_missing,
            'examplesSizesEmpty': example_empty,
        },
        'carrierByStage': {str(k): {'withCarrier': v[0], 'withoutCarrier': v[1]}
                           for k, v in by_stage.items()},
    }, indent=2, default=str))
    raise SystemExit(0)

def table(title, counter, width=46):
    print()
    print(title)
    print('-' * (width + 8))
    for value, count in counter.most_common():
        label = repr(value) if value is not None else '(absent)'
        if len(label) > width:
            label = label[:width - 1] + '…'
        print(f'  {label:<{width}} {count:>5}')

print()
print(f'{total} orders surveyed across {len(glob.glob(os.path.join(workdir, \"page-*.json\")))} page(s).')
print(f'{len(members)} distinct memberId(s).')
if no_lines:
    print(f'!! {no_lines} order(s) returned with NO lineItems — the list endpoint may be omitting them.')
else:
    print('All orders returned populated lineItems.')

table('stage', stages)
table('status', statuses)
table('logisticsCarrier', carriers)
table('branchId', branches)
table('projectName', projects)

print()
print('line shape — sizes per line that SCALE would receive as one ErpOrderLineNum')
print('-' * 72)
pct = (100.0 * affected_orders / total) if total else 0.0
print(f'  orders with a multi-size line   {affected_orders:>5} of {total}  ({pct:.1f}%)')
print(f'  multi-size lines                {affected_lines:>5}')
print(f'  detail lines lost to collision  {lost_details:>5}')
print()
for n, count in sorted(sizes_per_line.items()):
    flag = '  <-- collides in SCALE' if n > 1 else ''
    print(f'  {n} shippable size(s) on a line: {count:>5}{flag}')

print()
print('sizes[] array shape -- does the single-size fallback in expandLineItems ever fire?')
print('-' * 72)
for shape, count in sorted(sizes_shape.items(), key=lambda kv: -kv[1]):
    fallback = '  <-- falls back to lineItems[].code (the STYLE code)' if shape.startswith(('absent', 'present but empty')) else ''
    print(f'  {shape:<28} {count:>6}{fallback}')
_fallback_lines = sizes_shape['absent (no sizes key, or null)'] + sizes_shape['present but empty []']
print()
if _fallback_lines == 0:
    print('  NO line in this sample has an absent or empty sizes[].')
    print('  The fallback branch is dead code on this population: every line carries at least one')
    print('  size entry, so the sku is always the product option code and never the style code.')
else:
    print(f'  {_fallback_lines} line(s) WOULD take the fallback and send lineItems[].code as SKU.Item.')
    for label, examples in (('absent', example_missing), ('empty', example_empty)):
        for ref, lid, code, qty, stage, branch, status in examples:
            print(f'    {label}: order {str(ref):<16} line {lid} code {str(code):<14} qty {qty:<6} stage={str(stage):<14} branch={branch} status={status}')

print()
print('logisticsCarrier by stage — shows WHEN Cin7 populates the field')
print('-' * 54)
print(f'  {\"stage\":<24} {\"with\":>6} {\"without\":>8}')
for stage, (withc, without) in sorted(by_stage.items(), key=lambda kv: -(kv[1][0] + kv[1][1])):
    print(f'  {str(stage):<24} {withc:>6} {without:>8}')
print()
"