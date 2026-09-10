#!/usr/bin/env bash
# Walks the §6.5 consumer checklist in CloudWatch and reports ran/skipped per consumer.
#
# Our CREATE_ORDER goes onto the *shared* orders bus, so every UNI consumer sees it. BUSY-1158's
# whole job was guarding them, and a live CTC order is the first thing that ever proves it. This
# turns that manual checklist into one command.
#
# Three kinds of expectation, because the consumers signal differently:
#   RAN          the reference must appear in the log group      (it is our path)
#   SKIP-MARKER  a specific "skipping" line must appear          (guarded, and says so)
#   SKIP-SILENT  the reference must NOT appear at all            (guarded by filtering, says nothing)
#
# Read-only. Usage:
#   ./check-ctc-consumer-guards.sh --stage <stage> --profile <profile> --reference <ref> [--since-min N]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
REFERENCE=""
SINCE_MIN=30

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--reference) REFERENCE="$2"; shift 2 ;;
		--since-min) SINCE_MIN="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFERENCE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --reference <ref> [--since-min N]" >&2
	echo "Example: $0 --stage kian-dev --profile dev --reference 100234" >&2
	exit 1
fi

REFERENCE="${REFERENCE#\#}"
START_MS=$(( ($(date +%s) - SINCE_MIN * 60) * 1000 ))

echo "Reference: ${REFERENCE}   window: last ${SINCE_MIN} min"
echo

# name | kind | needle
# The needle is what we search the log group for. For SKIP-MARKER it is the guard's own line, which
# is stronger evidence than absence: it proves the guard fired rather than the event never arriving.
CONSUMERS=(
"${STAGE}-orders-v2-create-order|RAN|${REFERENCE}"
"${STAGE}-orders-v2-placed-order|SKIP-MARKER|CTC order - skipping Segment event."
"${STAGE}-orders-v2-validate-address|SKIP-MARKER|Skipping address validation for CTC order"
"${STAGE}-shipping-v2-order-created|RAN|${REFERENCE}"
"${STAGE}-orders-v2-order-reporting-stream|SKIP-MARKER|CTC record, excluded from reporting"
"${STAGE}-shipping-v2-shipment-reporting-stream|SKIP-MARKER|CTC record, excluded from reporting"
# Downstream of the reporting stream, which filters CTC rows first, so this guard is
# defence-in-depth and does not fire in a normal run. Absence is the only sound check here.
"${STAGE}-shipping-reporting-buffer-processor|SKIP-SILENT|${REFERENCE}"
# Its EventBridge rule carries no detailPattern, so it receives every CTC order. The guard
# returns before the log line on purpose, keeping CTC customer data out of this log group —
# which leaves absence as the only available check.
"${STAGE}-inventory-check-order-faulty-sale|SKIP-SILENT|${REFERENCE}"
)

FAILURES=0

for entry in "${CONSUMERS[@]}"; do
	IFS='|' read -r FN KIND NEEDLE <<< "$entry"
	LOG_GROUP="/aws/lambda/${FN}"

	HITS=$(aws logs filter-log-events --profile "$PROFILE" --region "$REGION" \
		--log-group-name "$LOG_GROUP" --start-time "$START_MS" \
		--filter-pattern "\"${NEEDLE}\"" \
		--limit 5 --no-paginate --query 'length(events)' --output text 2>/dev/null | head -1 \
		|| echo "NOGROUP")
	[[ -z "$HITS" ]] && HITS="NOGROUP"

	case "$KIND:$HITS" in
		*:NOGROUP)
			printf '  %-8s %-58s %s\n' "SKIP?" "$FN" "log group not found — deployed?"
			;;
		RAN:0)
			printf '  %-8s %-58s %s\n' "FAIL" "$FN" "expected to run, reference not found"
			FAILURES=$((FAILURES + 1))
			;;
		RAN:*)
			printf '  %-8s %-58s %s\n' "PASS" "$FN" "ran ($HITS matching lines)"
			;;
		SKIP-MARKER:0)
			printf '  %-8s %-58s %s\n' "FAIL" "$FN" "guard line absent — did it run unguarded, or has it not caught up?"
			FAILURES=$((FAILURES + 1))
			;;
		SKIP-MARKER:*)
			printf '  %-8s %-58s %s\n' "PASS" "$FN" "guard fired ($HITS lines)"
			;;
		SKIP-SILENT:0)
			printf '  %-8s %-58s %s\n' "PASS" "$FN" "reference absent, as expected"
			;;
		SKIP-SILENT:*)
			printf '  %-8s %-58s %s\n' "FAIL" "$FN" "reference PRESENT ($HITS lines) — CTC row not filtered"
			FAILURES=$((FAILURES + 1))
			;;
	esac
done

cat <<EOF

  not checked  transform-shipments-backup — runs as a Fargate task (FatLambda) on an S3
               backup-object event, not a Lambda, and not during a test run. Its CTC guard
               is covered by unit tests only.

Caveats worth knowing before trusting a PASS:
  * Skip rows are marker-based wherever the guard actually fires: the guard's own line must
    appear, which proves it ran rather than the event never arriving. The one exception is
    buffer-processor, which sits downstream of the stream and so never receives a CTC record to
    skip; absence of the reference is the only sound check for it, and it also "passes" if the
    consumer never ran, so read it alongside the RAN rows.
  * The skip markers carry origin=, so a marker can be traced to a reference. Shipment ITEM rows
    are the exception: they carry company rather than origin and read origin=n/a, so trace them
    by the PK the header marker prints.
  * A FAIL on any skip row is a real defect and a stop-and-report (§6.5) — but only once the
    consumers have caught up. Marker-based rows go true LATER than the poller cycle: the event has
    to reach the populator, the queue and the worker, and CloudWatch has to ingest the line. Within
    roughly 5-10 minutes of an invoke a FAIL is far more likely to be lag than a defect. Re-run
    before believing it. (Observed 2026-08-24: placed-order read FAIL at 6 minutes and PASS with 5
    markers shortly after.)
EOF

if [[ "$FAILURES" -gt 0 ]]; then
	echo
	echo "${FAILURES} consumer(s) behaved unexpectedly."
	echo "If the poller ran within the last ~10 minutes, re-run before treating this as a defect:"
	echo "consumers and CloudWatch both lag, and a marker row reads FAIL until its line lands."
	exit 1
fi
