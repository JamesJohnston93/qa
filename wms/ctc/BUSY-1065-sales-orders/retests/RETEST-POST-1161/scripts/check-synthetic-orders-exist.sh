#!/usr/bin/env bash
# Checks that a list of QASYN- synthetic order references still return rows on the orders table's
# origin_index, so a purge or teardown can be told apart from "nothing changed".
#
# Ticket:      RETEST-POST-1161
# Cases:       R0 Gate D
# Asserts:     row count on origin_index for each given QASYN- reference, so an unexpected drop to
#              zero (a purge) is visible against the register's own last-recorded state
# Does NOT:    prove the content of those rows is unchanged, only that they still exist. Does not
#              check SYNTHETIC-REGISTER.md itself; the caller must compare row counts by hand.
# Side effects: read only
#
# Usage: ./check-synthetic-orders-exist.sh --stage <stage> --profile <profile> --store <store> --origin <origin> --refs <ref1,ref2,...>
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
STORE="CTC"
ORIGIN="CIN7_SO"
REFS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		--origin) ORIGIN="$2"; shift 2 ;;
		--refs) REFS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$REFS" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --store <store> --origin <origin> --refs <ref1,ref2,...>" >&2
	echo "Example: $0 --stage staging --profile staging --refs QASYN-01-TC12,QASYN-02-TC11" >&2
	exit 1
fi

IFS=',' read -ra REF_ARRAY <<< "$REFS"
for ref in "${REF_ARRAY[@]}"; do
	origin_key="${STORE}#${ORIGIN}#${ref}"
	count=$(aws dynamodb query --profile "$PROFILE" --region "$REGION" \
		--table-name "${STAGE}-orders-v2" --index-name origin_index \
		--key-condition-expression "origin = :o" \
		--expression-attribute-values "{\":o\":{\"S\":\"${origin_key}\"}}" \
		--query "Count" --output text 2>&1) || {
		echo "$ref | ERROR | $count"
		continue
	}
	echo "$ref | rows: $count"
done
