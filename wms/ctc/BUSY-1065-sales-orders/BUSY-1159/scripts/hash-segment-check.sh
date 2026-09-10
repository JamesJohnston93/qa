#!/usr/bin/env bash
# Harvests the trailing segment of idempotencyId across a set of references and reports its
# width, character set, presence rate, and whether it varies by order.
#
# Ticket:      BUSY-1159
# Cases:       TC13b
# Asserts:     whether the idempotencyId's trailing segment is a fixed-width, content-derived,
#              order-varying hash, by comparing widths/charsets/values across every TRANSACTION
#              row for the given references
# Does NOT:    prove stability (same content -> same hash). That needs two rows for the same
#              reference at the same modifiedDate; this script only reports whether any exist and
#              compares them if so, falling back to the weaker cross-order variance claim if not
# Side effects: read only, calls list-transaction-rows.sh once per reference
#
# Usage: ./hash-segment-check.sh --stage <stage> --profile <profile> --reference <ref> [--reference <ref> ...]
set -euo pipefail

STAGE=""
PROFILE=""
REFERENCES=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--reference) REFERENCES+=("$2"); shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || ${#REFERENCES[@]} -eq 0 ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --reference <ref> [--reference <ref> ...]" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW=$(mktemp)

for ref in "${REFERENCES[@]}"; do
	"${SCRIPT_DIR}/list-transaction-rows.sh" --stage "$STAGE" --profile "$PROFILE" --reference "$ref" \
		| grep 'idempotencyId=' \
		| sed -E "s/^.*idempotencyId=(.*)$/${ref} \1/" >> "$RAW"
done

python3 - "$RAW" <<'PY'
import sys, re

with open(sys.argv[1]) as fh:
    lines = [l.strip() for l in fh if l.strip()]

rows = []
for line in lines:
    ref, idem = line.split(' ', 1)
    parts = idem.split('#')
    modified_date = parts[-2] if len(parts) >= 2 else None
    segment = parts[-1] if parts else ''
    rows.append((ref, modified_date, segment))

print(f'Rows: {len(rows)}')
widths = sorted(set(len(seg) for _, _, seg in rows))
print(f'Widths seen: {widths}')

hex_re = re.compile(r'^[0-9a-f]+$')
non_hex = [(r, s) for r, _, s in rows if not hex_re.match(s)]
print(f'All hex lowercase: {not non_hex}' + (f'  non-hex: {non_hex}' if non_hex else ''))

present = [s for _, _, s in rows if s]
print(f'Present on {len(present)}/{len(rows)} rows')

segments = [s for _, _, s in rows]
print(f'Distinct segments: {len(set(segments))}/{len(segments)}')

# stability test: same reference, same modifiedDate, compare segments
by_ref_date = {}
for ref, md, seg in rows:
    by_ref_date.setdefault((ref, md), []).append(seg)

dupes = {k: v for k, v in by_ref_date.items() if len(v) > 1}
if dupes:
    print('Same reference + modifiedDate pairs found, comparing segments:')
    for (ref, md), segs in dupes.items():
        same = len(set(segs)) == 1
        print(f'  {ref} {md}: {segs}  same={same}')
else:
    print('No reference has two TRANSACTION rows at the same modifiedDate.')
    print('Falling back to the weaker claim: cross-order variance only.')
    print(f'  {len(set(segments))} distinct segments across {len(segments)} different orders'
          f' -> {"varies by order" if len(set(segments)) == len(segments) else "COLLISION"}')
PY

rm -f "$RAW"
