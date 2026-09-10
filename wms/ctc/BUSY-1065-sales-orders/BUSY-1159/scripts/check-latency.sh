#!/usr/bin/env bash
# Computes the gap between a Cin7 order's modifiedDate and its wmsSentAt stamp, for TC1b.
#
# Ticket:      BUSY-1159
# Cases:       TC1b
# Asserts:     the elapsed time between the two given ISO 8601 UTC timestamps, and whether it
#              is within the 5 minute ceiling
# Does NOT:    know which log group the delay sits in. If this fails, read the poller and
#              sender cycle timestamps around both values by hand to say where the time went
# Side effects: read only, no AWS calls at all
#
# Usage: ./check-latency.sh --modified <iso8601-utc> --wms-sent-at <iso8601-utc>
set -euo pipefail

MODIFIED=""
WMS_SENT_AT=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--modified) MODIFIED="$2"; shift 2 ;;
		--wms-sent-at) WMS_SENT_AT="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$MODIFIED" || -z "$WMS_SENT_AT" ]]; then
	echo "Usage: $0 --modified <iso8601-utc> --wms-sent-at <iso8601-utc>" >&2
	echo "Example: $0 --modified 2026-08-27T23:48:03Z --wms-sent-at 2026-08-27T23:51:12.000Z" >&2
	exit 1
fi

python3 - "$MODIFIED" "$WMS_SENT_AT" <<'PY'
import sys, datetime

def parse(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))

modified = parse(sys.argv[1])
wms_sent_at = parse(sys.argv[2])
gap = (wms_sent_at - modified).total_seconds()

print(f"modifiedDate:  {sys.argv[1]}")
print(f"wmsSentAt:     {sys.argv[2]}")
print(f"gap:           {gap:.1f} seconds ({gap/60:.2f} minutes)")

if gap < 0:
    print("FAIL: wmsSentAt is before modifiedDate, negative gap")
elif gap > 300:
    print("FAIL: gap exceeds the 5 minute ceiling")
else:
    print("PASS: within the 5 minute ceiling" + (" (over the ~3 minute expectation, still within ceiling)" if gap > 180 else ""))
PY
