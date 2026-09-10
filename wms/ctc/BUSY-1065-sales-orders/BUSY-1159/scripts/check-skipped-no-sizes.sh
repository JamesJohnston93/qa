#!/usr/bin/env bash
# Sweeps every Cin7SOPollerCycleComplete line in the poller's full retained CloudWatch history and
# reports the skippedNoSizes counter specifically: how many cycles, how many carried a non-zero
# value, the largest value seen, and (if any cycle is non-zero) that cycle's timestamp and
# ordersFetched/created so a follow-up read can find the specific order references.
#
# Ticket:      BUSY-1159
# Cases:       TC6d
# Asserts:     the distribution of skippedNoSizes across every retained cycle-complete line: cycle
#              count, non-zero count, largest value, and which cycles (if any) were non-zero
# Does NOT:    identify which order within a non-zero cycle triggered the counter (needs a separate
#              per-order log read of that cycle's window). Does not distinguish a genuinely new
#              counter from a typo in a field name. Only covers what CloudWatch has retained; this
#              log group's retention is confirmed unlimited (retentionInDays: null) but that is not
#              the same as "since the CTC build began", only "since the group has held data"
# Side effects: read only. Paginated aws logs filter-log-events, no writes, no invokes, no Cin7 calls.
#
# Usage: ./check-skipped-no-sizes.sh --stage <stage> --profile <profile> \
#          [--start-time <ISO8601>] [--end-time <ISO8601>]
# Defaults to the log group's full retained history if --start-time/--end-time are omitted.
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
START_TIME=""
END_TIME=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--start-time) START_TIME="$2"; shift 2 ;;
		--end-time) END_TIME="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--start-time <ISO8601>] [--end-time <ISO8601>]" >&2
	exit 1
fi

LOG_GROUP="/aws/lambda/${STAGE}-orders-cin7-so-poller"

to_epoch_ms() {
	python3 -c "
from datetime import datetime, timezone
t = datetime.strptime('$1', '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
print(int(t.timestamp()*1000))
"
}

RETENTION=$(aws logs describe-log-groups --profile "$PROFILE" --region "$REGION" \
	--log-group-name-prefix "$LOG_GROUP" \
	--query "logGroups[0].retentionInDays" --output text)
echo "Log group: $LOG_GROUP" >&2
echo "Retention: ${RETENTION} (None/null means unlimited, not 30 days)" >&2

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

echo "Window (ms): $START_MS to $END_MS" >&2
python3 -c "
from datetime import datetime, timezone
print('Window (UTC):', datetime.fromtimestamp($START_MS/1000, tz=timezone.utc), 'to', datetime.fromtimestamp($END_MS/1000, tz=timezone.utc))
" >&2
echo >&2

RAW=$(mktemp)
trap 'rm -f "$RAW"' EXIT
NEXT_TOKEN=""
while true; do
	if [[ -n "$NEXT_TOKEN" ]]; then
		PAGE=$(aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
			--log-group-name "$LOG_GROUP" --filter-pattern "Cin7SOPollerCycleComplete" \
			--start-time "$START_MS" --end-time "$END_MS" --next-token "$NEXT_TOKEN" --output json)
	else
		PAGE=$(aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
			--log-group-name "$LOG_GROUP" --filter-pattern "Cin7SOPollerCycleComplete" \
			--start-time "$START_MS" --end-time "$END_MS" --output json)
	fi
	echo "$PAGE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for e in d.get('events',[]):
    print(e['message'].rstrip())
" >> "$RAW"
	NEXT_TOKEN=$(echo "$PAGE" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('nextToken',''))
")
	[[ -z "$NEXT_TOKEN" ]] && break
done

echo "Raw cycle-complete lines fetched: $(wc -l < "$RAW" | tr -d ' ')"
echo

python3 -c "
import json, sys

rows = []
counter_absent = 0
with open('$RAW') as fh:
    for line in fh:
        line = line.rstrip('\n')
        if not line or 'Cin7SOPollerCycleComplete' not in line:
            continue
        parts = line.split('\t')
        ts = parts[0] if parts else ''
        json_part = parts[-1]
        try:
            rec = json.loads(json_part)
        except json.JSONDecodeError:
            continue
        if 'skippedNoSizes' not in rec:
            counter_absent += 1
            continue
        rows.append({
            'ts': ts,
            'ordersFetched': rec.get('ordersFetched', 0),
            'created': rec.get('created', 0),
            'skippedNoSizes': rec['skippedNoSizes'],
        })

print(f'Cycles with skippedNoSizes present in the summary: {len(rows)}')
print(f'Cycles missing the field entirely: {counter_absent}')
print()

if not rows:
    print('No cycle carried the skippedNoSizes field at all.')
else:
    nonzero = [r for r in rows if r['skippedNoSizes'] != 0]
    largest = max(r['skippedNoSizes'] for r in rows)
    print(f'Total cycles with the field: {len(rows)}')
    print(f'Cycles with non-zero skippedNoSizes: {len(nonzero)}')
    print(f'Largest skippedNoSizes value seen: {largest}')
    print(f'First cycle timestamp with the field: {rows[0][\"ts\"]}')
    print(f'Last cycle timestamp with the field: {rows[-1][\"ts\"]}')
    print()
    if nonzero:
        print('Non-zero cycles (timestamp, ordersFetched, created, skippedNoSizes):')
        for r in nonzero:
            print(f'  {r[\"ts\"]:<28} ordersFetched={r[\"ordersFetched\"]:<6} created={r[\"created\"]:<6} skippedNoSizes={r[\"skippedNoSizes\"]}')
    else:
        print('Zero across every cycle carrying the field.')
"
