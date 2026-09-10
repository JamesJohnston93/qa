#!/usr/bin/env bash
# Watches for five naturally-occurring Cin7 fixture shapes that unpark parked test cases.
# Cin7 is read only for everyone, so none of these five shapes can be manufactured; this
# script finds them if and when they occur on their own.
#
# Ticket:      RETEST-1158-1159 (BUSY-1158, BUSY-1159)
# Cases:       TC4, the line reconciliation shapes, the version guard's second half, R2's
#              cancellation path (checks 1 and 2), TC6 (check 3), TC9 (check 4), TC15 (check 5)
# Asserts:     which of the five fixture shapes exist in Cin7 right now
# Does NOT:    prove any test case. A hit is a candidate fixture to run a slice against, not a
#              verified result. Check 4 only checks the two known-absent SKUs, not the full SCALE
#              item master (no cheap programmatic access to that exists, see Q9). Checks 1 and 2
#              only cover CTC shipments allocated to store 51909 (see note below); a genuinely
#              CTC shipment allocated elsewhere would be missed. Checks 3, 4 and 5 tag each hit
#              ELIGIBLE or PAST: this environment's orders can move from Processing to Dispatched
#              within 1-3 hours, faster than a daily run, so a hit already at a non-eligible stage
#              (PAST) was real but the poller can no longer create it; only ELIGIBLE hits are
#              actually runnable today. This does not mean the check ran too late, it means the
#              shape existed and is worth knowing about even once it has passed.
# Side effects: read only throughout. GET only against Cin7. No AWS writes. No Cin7 writes. No poll.
#
# Usage: ./watch-for-fixtures.sh --stage <stage> --profile <profile> [--recent-days N] [--sent-window-days N]
#   --recent-days       window for checks 3/4/5's Cin7 GET (default 1, paginated, capped at 20 pages)
#   --sent-window-days  window for checks 1/2's "already sent by us" set (default 14)
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
RECENT_DAYS=1
SENT_WINDOW_DAYS=14
CTC_BRANCHES="51908,51909"
KNOWN_ABSENT_SKUS=("TH25-318B-28" "WPR25-104A-10")

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--recent-days) RECENT_DAYS="$2"; shift 2 ;;
		--sent-window-days) SENT_WINDOW_DAYS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--recent-days N] [--sent-window-days N]" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi
if [[ -z "${CIN7_USERNAME:-}" || -z "${CIN7_API_KEY:-}" ]]; then
	echo "Missing Cin7 credentials. Set CIN7_USERNAME and CIN7_API_KEY, or provide .env at the tools root." >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

urlencode() {
	python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

cin7_get() {
	curl -s -u "${CIN7_USERNAME}:${CIN7_API_KEY}" -H "Accept: application/json" "$1"
}

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SENT_CUTOFF_ISO=$(python3 -c "
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(days=${SENT_WINDOW_DAYS})).strftime('%Y-%m-%dT%H:%M:%SZ'))
")
RECENT_CUTOFF_ISO=$(python3 -c "
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(days=${RECENT_DAYS})).strftime('%Y-%m-%dT%H:%M:%SZ'))
")

echo "=== watch-for-fixtures, stage=${STAGE}, run at ${NOW_ISO} ==="
echo "sent-window: ${SENT_WINDOW_DAYS} days (since ${SENT_CUTOFF_ISO})"
echo "recent-window: ${RECENT_DAYS} days (since ${RECENT_CUTOFF_ISO})"
echo

# --- Shared data for checks 1 and 2: CTC shipments we have already sent -----------------------
#
# Bounded via the allocated_store_index GSI (allocatedStore = a CTC branch), never a full scan of
# staging-shipments. Every CTC shipment observed in this plan carries allocatedStore 51908 or
# 51909; a header whose allocatedStore is something else would be missed by this method, which is
# the limit named in the header above, not a scan substitute.
echo "--- building the already-sent set (staging-shipments, allocated_store_index) ---"
: > "${WORKDIR}/sent_origins.txt"
for store in 51908 51909; do
	aws dynamodb query --profile "$PROFILE" --region "$REGION" --table-name "${STAGE}-shipments" \
		--index-name allocated_store_index \
		--key-condition-expression "allocatedStore = :s" \
		--expression-attribute-values "{\":s\":{\"S\":\"${store}\"}}" \
		--output json > "${WORKDIR}/shipments-${store}.json"
done

python3 - "$WORKDIR" "$SENT_CUTOFF_ISO" << 'PYEOF'
import json, sys
workdir, cutoff = sys.argv[1], sys.argv[2]
rows = []
for store in ("51908", "51909"):
    d = json.load(open(f"{workdir}/shipments-{store}.json"))
    rows.extend(d["Items"])
hits = []
for r in rows:
    if "wmsSentAt" not in r:
        continue
    sent_at = r["wmsSentAt"]["S"]
    if sent_at < cutoff:
        continue
    origin = r.get("origin", {}).get("S")
    if not origin:
        continue
    hits.append((origin, sent_at))
with open(f"{workdir}/sent_origins.txt", "w") as f:
    for origin, sent_at in sorted(set(hits)):
        f.write(f"{origin}\t{sent_at}\n")
print(f"{len(set(hits))} CTC shipment(s) sent within the {cutoff} window")
PYEOF

SENT_COUNT=$(wc -l < "${WORKDIR}/sent_origins.txt" | tr -d ' ')
echo "already-sent set: ${SENT_COUNT} reference(s)"
echo

# --- Resolve each origin's stored lastModified from staging-orders-v2 (origin_index) ------------
: > "${WORKDIR}/stored.tsv"
while IFS=$'\t' read -r origin sent_at; do
	[[ -z "$origin" ]] && continue
	ROW=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" --table-name "${STAGE}-orders-v2" \
		--index-name origin_index \
		--key-condition-expression "origin = :o AND SK = :sk" \
		--expression-attribute-values "{\":o\":{\"S\":\"${origin}\"},\":sk\":{\"S\":\"ORDER\"}}" \
		--output json)
	python3 -c "
import json, sys
d = json.loads(sys.argv[1])
items = d.get('Items', [])
if items:
    it = items[0]
    lm = it.get('lastModified', {}).get('S', '')
    print(f\"${origin}\t{lm}\")
" "$ROW" >> "${WORKDIR}/stored.tsv"
done < "${WORKDIR}/sent_origins.txt"

echo "resolved stored lastModified for $(wc -l < "${WORKDIR}/stored.tsv" | tr -d ' ') reference(s)"
echo

# --- One (or a few) Cin7 GET(s) for current state of every already-sent reference ---------------
# Cin7's reference field requires the literal '#' prefix in the filter, even for references that
# display or store elsewhere without one (e.g. our own origin field strips it). Confirmed by direct
# test this session: reference='261115' returns nothing, reference='#261115' returns the order.
REFS_FILE="${WORKDIR}/refs.txt"
python3 -c "
lines = open('${WORKDIR}/stored.tsv').read().splitlines()
for line in lines:
    origin, lm = line.split('\t', 1)
    ref = origin.split('#')[-1]
    print(ref)
" > "$REFS_FILE"

BATCH_SIZE=20
ALL_REFS=()
while IFS= read -r line; do
	[[ -n "$line" ]] && ALL_REFS+=("$line")
done < "$REFS_FILE"
echo "[]" > "${WORKDIR}/cin7_current.json"
for (( i=0; i<${#ALL_REFS[@]}; i+=BATCH_SIZE )); do
	BATCH=("${ALL_REFS[@]:i:BATCH_SIZE}")
	CLAUSE_LIST=""
	for ref in "${BATCH[@]}"; do
		esc="${ref//\'/\'\'}"
		CLAUSE_LIST+="'#${esc}',"
	done
	CLAUSE_LIST="${CLAUSE_LIST%,}"
	WHERE="reference IN (${CLAUSE_LIST})"
	WHERE_ENC=$(urlencode "$WHERE")
	cin7_get "https://api.cin7.com/api/v1/SalesOrders?where=${WHERE_ENC}&rows=100&page=1" > "${WORKDIR}/batch_${i}.json"
	python3 -c "
import json
existing = json.load(open('${WORKDIR}/cin7_current.json'))
new = json.load(open('${WORKDIR}/batch_${i}.json'))
if isinstance(new, list):
    existing.extend(new)
json.dump(existing, open('${WORKDIR}/cin7_current.json', 'w'))
"
	sleep 0.3
done

echo "--- Check 1, second-revision orders (a naturally occurring revision on something we already sent) ---"
python3 - "$WORKDIR" << 'PYEOF'
import json, sys
workdir = sys.argv[1]
stored = {}
for line in open(f"{workdir}/stored.tsv"):
    origin, lm = line.rstrip("\n").split("\t", 1)
    stored[origin] = lm
current = json.load(open(f"{workdir}/cin7_current.json"))
by_ref = {o.get("reference", "").lstrip("#"): o for o in current if isinstance(o, dict)}

hits = []
for origin, lm in stored.items():
    ref = origin.split("#")[-1]
    o = by_ref.get(ref)
    if not o:
        continue
    current_modified = o.get("modifiedDate", "")
    if current_modified and lm and current_modified > lm:
        hits.append((ref, lm, current_modified, o.get("stage"), o.get("status")))

if not hits:
    print("0 candidates. No already-sent reference shows a Cin7 modifiedDate later than what we stored.")
else:
    print(f"{len(hits)} candidate(s):")
    for ref, stored_lm, cur_lm, stage, status in hits:
        print(f"  {ref}\tstored={stored_lm}\tcurrent={cur_lm}\tstage={stage}\tstatus={status}")
PYEOF
echo

echo "--- Check 2, cancelled or voided after send ---"
python3 - "$WORKDIR" << 'PYEOF'
import json, sys
workdir = sys.argv[1]
stored = {}
for line in open(f"{workdir}/stored.tsv"):
    origin, lm = line.rstrip("\n").split("\t", 1)
    stored[origin] = lm
current = json.load(open(f"{workdir}/cin7_current.json"))
by_ref = {o.get("reference", "").lstrip("#"): o for o in current if isinstance(o, dict)}

hits = []
for origin in stored:
    ref = origin.split("#")[-1]
    o = by_ref.get(ref)
    if not o:
        continue
    if o.get("isVoid") or o.get("cancellationDate"):
        hits.append((ref, o.get("status"), o.get("isVoid"), o.get("cancellationDate")))

if not hits:
    print("0 candidates. No already-sent reference is void or carries a cancellationDate.")
else:
    print(f"{len(hits)} candidate(s):")
    for ref, status, is_void, cancel_date in hits:
        print(f"  {ref}\tstatus={status}\tisVoid={is_void}\tcancellationDate={cancel_date}")
PYEOF
echo

# --- Shared data for checks 3, 4, 5: recent CTC orders, paginated, lineItems included ------------
# Capped at MAX_PAGES (2000 orders) so a volume spike on a daily run cannot blow the shared Cin7
# budget. Both branches together ran about 230 orders/day (3 pages) at the time this was written;
# a capped run is noted explicitly rather than silently under-reporting.
echo "--- fetching recent CTC orders for checks 3, 4, 5 (branchId IN (${CTC_BRANCHES}), since ${RECENT_CUTOFF_ISO}) ---"
WHERE="branchId IN (${CTC_BRANCHES}) AND modifiedDate>='${RECENT_CUTOFF_ISO}'"
WHERE_ENC=$(urlencode "$WHERE")
MAX_PAGES=20
echo "[]" > "${WORKDIR}/recent.json"
PAGE=1
while [[ $PAGE -le $MAX_PAGES ]]; do
	cin7_get "https://api.cin7.com/api/v1/SalesOrders?where=${WHERE_ENC}&order=modifiedDate%20DESC&rows=100&page=${PAGE}" > "${WORKDIR}/recent_page.json"
	PAGE_COUNT=$(python3 -c "import json; d=json.load(open('${WORKDIR}/recent_page.json')); print(len(d) if isinstance(d, list) else 0)")
	python3 -c "
import json
existing = json.load(open('${WORKDIR}/recent.json'))
new = json.load(open('${WORKDIR}/recent_page.json'))
if isinstance(new, list):
    existing.extend(new)
json.dump(existing, open('${WORKDIR}/recent.json', 'w'))
"
	if [[ "$PAGE_COUNT" -lt 100 ]]; then
		break
	fi
	PAGE=$((PAGE + 1))
	sleep 0.3
done
if [[ $PAGE -ge $MAX_PAGES ]]; then
	echo "NOTE: hit the ${MAX_PAGES}-page cap, the recent set may be incomplete for this window"
fi
RECENT_COUNT=$(python3 -c "import json; print(len(json.load(open('${WORKDIR}/recent.json'))))")
echo "recent set: ${RECENT_COUNT} order(s)"
echo

echo "--- Check 3, repeated option code (TC6 fixture) ---"
python3 -c "
import json
ELIGIBLE = {'New', 'Processing', 'Partially Picked', 'Fully Picked'}
orders = json.load(open('${WORKDIR}/recent.json'))
hits = []
for o in orders:
    codes = []
    for li in o.get('lineItems', []):
        for s in li.get('sizes', []):
            c = s.get('code')
            if c:
                codes.append(c)
    dupes = sorted(set(c for c in codes if codes.count(c) > 1))
    if dupes:
        hits.append((o.get('reference'), o.get('stage'), dupes))
if not hits:
    print('0 candidates. No order in the recent window repeats an option code across its own lines.')
else:
    print(f'{len(hits)} candidate(s), ELIGIBLE means the poller can still create this order today, PAST means the stage window has already closed:')
    for ref, stage, dupes in hits:
        flag = 'ELIGIBLE' if stage in ELIGIBLE else 'PAST'
        print(f'  {ref}\tstage={stage}\t[{flag}]\trepeated={dupes}')
"
echo

echo "--- Check 4, item-master-absent SKU (TC9 fixture, two known codes only) ---"
python3 - "$WORKDIR" "${KNOWN_ABSENT_SKUS[@]}" << 'PYEOF'
import json, sys
ELIGIBLE = {"New", "Processing", "Partially Picked", "Fully Picked"}
workdir = sys.argv[1]
known = set(sys.argv[2:])
orders = json.load(open(f"{workdir}/recent.json"))
hits = []
for o in orders:
    found = set()
    for li in o.get("lineItems", []):
        for s in li.get("sizes", []):
            c = s.get("code")
            if c in known:
                found.add(c)
    if found:
        hits.append((o.get("reference"), o.get("stage"), sorted(found)))
if not hits:
    print(f"0 candidates. Neither known-absent code ({sorted(known)}) appears on a recent order. Only the two known codes were checked, not the full SCALE item master (no cheap programmatic access, see Q9).")
else:
    print(f"{len(hits)} candidate(s), ELIGIBLE means the poller can still create this order today, PAST means the stage window has already closed:")
    for ref, stage, found in hits:
        flag = "ELIGIBLE" if stage in ELIGIBLE else "PAST"
        print(f"  {ref}\tstage={stage}\t[{flag}]\tabsent_sku={found}")
PYEOF
echo

echo "--- Check 5, over-25-character reference (TC15 fixture) ---"
python3 -c "
import json
ELIGIBLE = {'New', 'Processing', 'Partially Picked', 'Fully Picked'}
orders = json.load(open('${WORKDIR}/recent.json'))
hits = []
for o in orders:
    ref = (o.get('reference') or '').lstrip('#')
    if len(ref) > 25:
        hits.append((ref, len(ref), o.get('stage')))
if not hits:
    print('0 candidates. No order in the recent window has a reference over 25 characters.')
else:
    print(f'{len(hits)} candidate(s), ELIGIBLE means the poller can still hard-error on this today, PAST means the stage window has already closed:')
    for ref, length, stage in hits:
        flag = 'ELIGIBLE' if stage in ELIGIBLE else 'PAST'
        print(f'  {ref}\tlength={length}\tstage={stage}\t[{flag}]')
"
echo

echo "=== summary ==="
echo "Read results above. Any non-zero check is a parked case runnable today:"
echo "  check 1 -> TC4, line reconciliation shapes, version guard second half, R2 update half"
echo "  check 2 -> cancellation path, R2"
echo "  check 3 -> TC6"
echo "  check 4 -> TC9"
echo "  check 5 -> TC15"
