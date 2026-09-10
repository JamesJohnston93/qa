#!/usr/bin/env bash
# Sweeps every Cin7SOPollerCycleComplete line in the poller's full retained CloudWatch history and
# lists every cycle where skippedStages is non-empty, with its timestamp and contents.
#
# Ticket:      RETEST-1158-1159
# Slice:       R11, Gate C
# Asserts:     the full timeline of every cycle in retained history where the skippedStages counter
#              fired (non-empty), so the last non-empty occurrence can be dated against the
#              2026-09-03 deploy.
# Does NOT:    say why skippedStages stopped or started firing, or attribute any specific order to
#              it. Does NOT prove the underlying stage gate changed -- only the counter's own
#              behaviour, which is a separate question from what the gate itself does.
# Side effects: read only. One aws logs filter-log-events call, paginated. No AWS writes, no Cin7
#              calls, no invoke.
#
# Usage: ./skipped-stages-timeline.sh --stage <stage> --profile <profile> \
#          [--start-time <ISO8601>] [--end-time <ISO8601>]
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
echo "Counter swept: skippedStages (non-empty occurrences only)"
echo

OUT_DIR="${OUT_DIR:-/tmp}"
RAW="${OUT_DIR}/skipped-stages-timeline.raw.log"
> "$RAW"
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
	if [[ -z "$NEXT_TOKEN" ]]; then
		break
	fi
done

python3 - "$RAW" <<'PY'
import json, sys

path = sys.argv[1]
DEPLOY_TS = '2026-09-03T00:00:00.000Z'

rows = []
with open(path) as fh:
    for line in fh:
        line = line.rstrip('\n')
        if 'Cin7SOPollerCycleComplete' not in line:
            continue
        parts = line.split('\t')
        ts = parts[0] if parts else ''
        try:
            rec = json.loads(parts[-1])
        except json.JSONDecodeError:
            continue
        stages = rec.get('skippedStages') or {}
        if stages:
            rows.append((ts, rec.get('ordersFetched'), stages))

print(f'Total cycles swept: (see reconcile-poller-cycles.sh for the full count)')
print(f'Cycles with non-empty skippedStages: {len(rows)}')
print()
for ts, fetched, stages in rows:
    print(f'{ts:<28} ordersFetched={fetched:<6} skippedStages={stages}')

print()
if rows:
    last = rows[-1]
    print(f'Last non-empty occurrence: {last[0]}  skippedStages={last[2]}')
    print(f'That is {"before" if last[0] < DEPLOY_TS else "at/after"} the 2026-09-03 deploy.')
else:
    print('No non-empty skippedStages occurrence found anywhere in this window.')
PY
