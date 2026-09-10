#!/usr/bin/env bash
# Sweeps the full retained history of the faulty-sale downstream worker
# (staging-inventory-check-order-faulty-sale), splits invocations into CTC and non-CTC by the
# `origin` field on the input record it logs, and reports warm-only Duration as counts and
# percentiles per group. Extracts the `origin` value only -- never prints a full log line.
#
# Ticket:      RETEST-1158-1159
# Slice:       R11, Gate D1
# Asserts:     the duration distribution (count, p50, p90, max) of this worker's invocations, split
#              CTC vs non-CTC by origin prefix, warm invocations only (Init Duration absent from the
#              REPORT line for that request).
# Does NOT:    say what the worker does with the time, only how long it takes. Does NOT determine
#              whether a CTC invocation executes real business logic versus an instant bail --
#              duration is a proxy signal, not a mechanism read.
# Does NOT:    print customer name, email or address. The only field extracted from the record body
#              is `origin` (an internal routing key, e.g. CTC#CIN7_SO#<ref> or
#              US#SHOPIFY_ECOM#<ref>), via a narrow regex anchored on the literal field name. No
#              width-based truncation is used anywhere.
# Side effects: read only. Two aws logs filter-log-events sweeps (REPORT lines, origin lines), each
#              paginated. No AWS writes, no Cin7 calls, no invoke.
#
# Usage: ./faulty-sale-worker-duration-distribution.sh --profile <profile> \
#          [--log-group <name>] [--start-time <ISO8601>] [--end-time <ISO8601>]
set -euo pipefail

PROFILE=""
REGION="ap-southeast-2"
LOG_GROUP="/aws/lambda/staging-inventory-check-order-faulty-sale"
START_TIME=""
END_TIME=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--log-group) LOG_GROUP="$2"; shift 2 ;;
		--start-time) START_TIME="$2"; shift 2 ;;
		--end-time) END_TIME="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$PROFILE" ]]; then
	echo "Usage: $0 --profile <profile> [--log-group <name>] [--start-time <ISO8601>] [--end-time <ISO8601>]" >&2
	exit 1
fi

to_epoch_ms() {
	python3 -c "
from datetime import datetime, timezone
t = datetime.strptime('$1', '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
print(int(t.timestamp()*1000))
"
}

if [[ -z "$START_TIME" ]]; then
	START_MS=$(aws logs describe-log-streams --profile "$PROFILE" --region "$REGION" \
		--log-group-name "$LOG_GROUP" --order-by LastEventTime --output json \
		| python3 -c "
import json,sys
d=json.load(sys.stdin)
firsts=[s.get('firstEventTimestamp') for s in d.get('logStreams',[]) if s.get('firstEventTimestamp')]
print(min(firsts) if firsts else 0)
")
else
	START_MS=$(to_epoch_ms "$START_TIME")
fi

if [[ -z "$END_TIME" ]]; then
	END_MS=$(date -u +%s000)
else
	END_MS=$(to_epoch_ms "$END_TIME")
fi

echo "Log group: $LOG_GROUP"
echo "Window (ms): $START_MS to $END_MS"
echo

OUT_DIR="${OUT_DIR:-/tmp}"
mkdir -p "$OUT_DIR"

# Messages in this log group are multi-line (a pretty-printed object), so each event's message is
# kept as ONE JSON string per event -- never flattened to a line-oriented text file, which would
# make an embedded newline indistinguishable from an event boundary (the R1 incident's root cause,
# in a different shape: this is the same "log messages contain embedded newlines" hazard CLAUDE.md
# names, encountered here as a parsing bug rather than a redaction one).
fetch_json() {
	local pattern="$1"
	local outfile="$2"
	> "$outfile"
	local next_token=""
	while true; do
		if [[ -n "$next_token" ]]; then
			PAGE=$(aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
				--log-group-name "$LOG_GROUP" --filter-pattern "$pattern" \
				--start-time "$START_MS" --end-time "$END_MS" --next-token "$next_token" --output json)
		else
			PAGE=$(aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
				--log-group-name "$LOG_GROUP" --filter-pattern "$pattern" \
				--start-time "$START_MS" --end-time "$END_MS" --output json)
		fi
		echo "$PAGE" > "${outfile}.page.json"
		python3 -c "
import json
d = json.load(open('${outfile}.page.json'))
with open('${outfile}', 'a') as out:
    for e in d.get('events', []):
        out.write(json.dumps({'message': e['message']}) + '\n')
"
		next_token=$(python3 -c "
import json
d = json.load(open('${outfile}.page.json'))
print(d.get('nextToken',''))
")
		rm -f "${outfile}.page.json"
		if [[ -z "$next_token" ]]; then
			break
		fi
	done
}

echo "Fetching REPORT lines..."
fetch_json "REPORT RequestId" "${OUT_DIR}/fsw-reports.jsonl"
echo "  $(wc -l < "${OUT_DIR}/fsw-reports.jsonl" | tr -d ' ') events"

echo "Fetching origin-bearing events..."
fetch_json "origin" "${OUT_DIR}/fsw-origins.jsonl"
echo "  $(wc -l < "${OUT_DIR}/fsw-origins.jsonl" | tr -d ' ') events"
echo

python3 - "${OUT_DIR}/fsw-reports.jsonl" "${OUT_DIR}/fsw-origins.jsonl" <<'PY'
import json, re, sys
import statistics

reports_path, origins_path = sys.argv[1], sys.argv[2]

# REPORT RequestId: <id>\tDuration: X ms\tBilled Duration: Y ms\t...[\tInit Duration: Z ms]
# (always single-line; the Lambda platform REPORT line itself never wraps.) Duration and the cold
# marker are matched independently rather than in one combined pattern -- an earlier version tried
# to capture Init Duration inside the same regex as an optional trailing group, and a lazy `.*?`
# ahead of it silently swallowed the "Init Duration: ms" text itself before the group ever got a
# chance to match it, so cold starts never registered. Presence of the literal marker is all Gate
# D1 needs (the marker's own value is not used), so check it as a plain substring instead.
report_re = re.compile(r'REPORT RequestId:\s*([0-9a-f-]+)\s*\tDuration:\s*([\d.]+)\s*ms')

durations = {}  # requestId -> (duration_ms, is_cold)
with open(reports_path) as fh:
    for line in fh:
        if not line.strip():
            continue
        msg = json.loads(line)['message']
        m = report_re.search(msg)
        if not m:
            continue
        reqid, dur = m.group(1), float(m.group(2))
        is_cold = 'Init Duration' in msg
        durations[reqid] = (dur, is_cold)

# Extract only the `origin` field's value -- never the surrounding record. Safe by construction:
# the captured group is bounded by single quotes immediately after the literal key `origin:`, and
# real origin values are short routing keys (e.g. CTC#CIN7_SO#261115), never free-text PII.
# The requestId comes from the message's own leading "<ts>\t<reqid>\t<level>\t" prefix -- matched
# on the whole message (not per physical line), since this log group's input-echo objects are
# pretty-printed across multiple physical lines within one CloudWatch event.
origin_re = re.compile(r"origin:\s*'([^']*)'")
prefix_re = re.compile(r'^(\S+)\t([0-9a-f-]+)\t')

origins = {}  # requestId -> origin value
with open(origins_path) as fh:
    for line in fh:
        if not line.strip():
            continue
        msg = json.loads(line)['message']
        pm = prefix_re.match(msg)
        if not pm:
            continue
        reqid = pm.group(2)
        om = origin_re.search(msg)
        if om:
            origins[reqid] = om.group(1)

print(f'REPORT lines parsed: {len(durations)}')
print(f'Origin values extracted: {len(origins)}')
print()

def classify(origin):
    if origin is None:
        return 'unknown (no origin line matched for this requestId)'
    return 'CTC' if origin.startswith('CTC#') else 'non-CTC'

groups = {}
cold_excluded = {'CTC': 0, 'non-CTC': 0, 'unknown (no origin line matched for this requestId)': 0}
for reqid, (dur, is_cold) in durations.items():
    origin = origins.get(reqid)
    group = classify(origin)
    if is_cold:
        cold_excluded[group] = cold_excluded.get(group, 0) + 1
        continue
    groups.setdefault(group, []).append(dur)

print('Cold invocations excluded (Init Duration present), by group:')
for g, c in cold_excluded.items():
    print(f'  {g}: {c}')
print()

def pct(data, p):
    if not data:
        return None
    data = sorted(data)
    k = (len(data) - 1) * (p / 100)
    f = int(k)
    c = min(f + 1, len(data) - 1)
    if f == c:
        return data[f]
    return data[f] + (data[c] - data[f]) * (k - f)

print(f'{"group":<50} {"n":>6} {"p50":>10} {"p90":>10} {"max":>10} {"min":>10}')
for g in sorted(groups.keys()):
    data = groups[g]
    print(f'{g:<50} {len(data):>6} {pct(data,50):>10.2f} {pct(data,90):>10.2f} {max(data):>10.2f} {min(data):>10.2f}')
PY
