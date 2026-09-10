#!/usr/bin/env bash
# Sweeps every Cin7SOPollerCycleComplete line in the poller's full retained CloudWatch history and
# checks whether ordersFetched equals the sum of every printed disposition counter for that cycle.
#
# Ticket:      RETEST-1158-1159
# Slice:       R11, Gate A
# Asserts:     For each cycle, ordersFetched - sum(disposition counters) == 0. Prints the residual,
#              the cycle timestamp, ordersFetched, and the exact list of counter names summed, so the
#              arithmetic is auditable and a counter added by a later deploy shows up as a new column
#              rather than being silently absorbed into the total.
# Does NOT:    Explain a non-zero residual. Does not attribute a residual to any specific order or
#              order type; that needs a second read (Gate B/B0). Does not distinguish a counter that
#              is genuinely new from a typo in a field name; both show up the same way, as an
#              "unexpected field" note.
# Side effects: read only. One aws logs filter-log-events call, paginated. No AWS writes, no Cin7
#              calls, no invoke.
#
# Usage: ./reconcile-poller-cycles.sh --stage <stage> --profile <profile> \
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
RAW="${OUT_DIR}/reconcile-poller-cycles.raw.log"
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

echo "Raw cycle-complete lines fetched: $(wc -l < "$RAW" | tr -d ' ')"
echo

python3 - "$RAW" <<'PY'
import json, sys, re

path = sys.argv[1]

# Fields that are not order-disposition counters: identify the metric, the fetch total itself,
# watermark bookkeeping, and pagination/request bookkeeping. packingBrandMisses is a data-quality
# flag on already-CREATED orders (per inspect-ctc-order.sh), not an independent disposition, so it
# is excluded from the sum on purpose -- counting it would double-count orders already in `created`.
NON_DISPOSITION = {
    'metric', 'ordersFetched', 'watermarkAdvanced', 'newWatermark',
    'pageCapHit', 'requestsThisCycle', 'packingBrandMisses',
}

rows = []
unexpected_fields = set()

with open(path) as fh:
    for line in fh:
        line = line.rstrip('\n')
        if not line or 'Cin7SOPollerCycleComplete' not in line:
            continue
        # log line shape: "<ts>\t<request-id>\t<level>\t<json>"
        parts = line.split('\t')
        ts = parts[0] if parts else ''
        json_part = parts[-1]
        try:
            rec = json.loads(json_part)
        except json.JSONDecodeError:
            print(f'!! could not parse JSON on line starting {line[:60]!r}', file=sys.stderr)
            continue

        counters = {}
        skipped_stages_total = 0
        skipped_stages_detail = {}
        for key, value in rec.items():
            if key in NON_DISPOSITION:
                continue
            if key == 'skippedStages':
                skipped_stages_detail = value or {}
                skipped_stages_total = sum(value.values()) if isinstance(value, dict) else 0
                continue
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                counters[key] = value
            else:
                unexpected_fields.add((key, type(value).__name__))

        ordersFetched = rec.get('ordersFetched', 0)
        summed_names = sorted(counters.keys()) + (['skippedStages(sum)'] if skipped_stages_detail or 'skippedStages' in rec else [])
        total = sum(counters.values()) + skipped_stages_total
        residual = ordersFetched - total

        rows.append({
            'ts': ts,
            'ordersFetched': ordersFetched,
            'counters': counters,
            'skippedStages_detail': skipped_stages_detail,
            'skippedStages_total': skipped_stages_total,
            'summed_names': summed_names,
            'total': total,
            'residual': residual,
        })

if not rows:
    print('No Cin7SOPollerCycleComplete lines found in this window.')
    sys.exit(0)

print(f'Counter names summed on every cycle (fixed set, auditable):')
fixed_names = sorted(rows[0]['counters'].keys())
print('  ' + ', '.join(fixed_names) + ', skippedStages(sum of dict values)')
print()

if unexpected_fields:
    print('!! Unexpected non-numeric, non-skippedStages fields seen (not summed, flagged for a human):')
    for name, typ in sorted(unexpected_fields):
        print(f'   {name} ({typ})')
    print()

# Detect if the set of counter names is not stable across all cycles (a new counter appearing).
all_name_sets = {tuple(sorted(r['counters'].keys())) for r in rows}
if len(all_name_sets) > 1:
    print('!! Counter name set is NOT identical across every cycle -- a counter was added or removed')
    print('   partway through this window. Sets observed:')
    for s in all_name_sets:
        print('   ', s)
    print()

DEPLOY_TS = '2026-09-03T00:00:00.000Z'  # everything at/after this date is post-deploy

# Full per-cycle table goes to a file, not stdout -- 582 rows is not something a human reads inline.
detail_path = path.rsplit('.raw.log', 1)[0] + '.per-cycle.tsv' if path.endswith('.raw.log') else path + '.per-cycle.tsv'
with open(detail_path, 'w') as out:
    out.write('timestamp\tordersFetched\tsummed_total\tresidual\n')
    for r in rows:
        out.write(f'{r["ts"]}\t{r["ordersFetched"]}\t{r["total"]}\t{r["residual"]}\n')
print(f'Full per-cycle table ({len(rows)} rows): {detail_path}')
print()

nonzero = [r for r in rows if r['residual'] != 0]
pre = [r for r in rows if r['ts'] < DEPLOY_TS]
post = [r for r in rows if r['ts'] >= DEPLOY_TS]
pre_nonzero = [r for r in pre if r['residual'] != 0]
post_nonzero = [r for r in post if r['residual'] != 0]

print(f'Total cycles: {len(rows)}. Cycles with non-zero residual: {len(nonzero)}.')
print(f'Pre-deploy (before {DEPLOY_TS}): {len(pre)} cycles, {len(pre_nonzero)} non-zero.')
print(f'Post-deploy (at/after {DEPLOY_TS}): {len(post)} cycles, {len(post_nonzero)} non-zero.')
print()

print('Ten largest-magnitude residual cycles (candidates for Gate B sampling):')
top = sorted(nonzero, key=lambda r: abs(r['residual']), reverse=True)[:10]
for r in top:
    print(f'  {r["ts"]:<28} ordersFetched={r["ordersFetched"]:<6} summed={r["total"]:<6} residual={r["residual"]}')
print()

# R5's own cycle, named explicitly so its arithmetic can be checked against this independent sweep.
r5 = [r for r in rows if r['ts'].startswith('2026-09-04T01:33:3')]
if r5:
    r = r5[0]
    print(f"R5's own cycle ({r['ts']}): ordersFetched={r['ordersFetched']}, summed={r['total']}, "
          f"residual={r['residual']} (R5's own text: 'at most 7 accounted, 8 fetched' -> residual 1)")
PY
