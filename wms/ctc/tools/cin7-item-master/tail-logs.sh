#!/usr/bin/env bash
# Tails CloudWatch logs for one of the Manhattan sync Lambdas.
# The enrich Lambda is deployed once per store (its own queue/DLQ each) — pass --store to pick
# which. sender and buffer are shared across both stores (one buffer/sender for the whole
# pipeline), so --store is ignored for those.
# Usage: ./tail-logs.sh --stage <stage> --profile <profile> --lambda <enrich|sender|buffer> [--store <us|ps>] [--since <duration>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
LAMBDA=""
STORE="us"
SINCE="10m"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--lambda) LAMBDA="$2"; shift 2 ;;
		--store) STORE="$2"; shift 2 ;;
		--since) SINCE="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$LAMBDA" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --lambda <enrich|sender|buffer> [--store <us|ps>] [--since <duration>]" >&2
	exit 1
fi

if [[ "$STORE" != "us" && "$STORE" != "ps" ]]; then
	echo "--store must be 'us' or 'ps' — got: $STORE" >&2
	exit 1
fi

case "$LAMBDA" in
	enrich)
		FUNCTION_NAME="${STAGE}-catalog-manhattan-${STORE}-enrich-item"
		SUCCESS_HINT='"Enriched item record for variant ..." followed by "Pushed {...} to EventBridge" — the change was allowlisted and got enriched. For a PRD#-level change (Task 4 fan-out), look for "Fanning PRD#<id> out to N variant record(s)." first, followed by N of the above pairs, one per variant.'
		DROP_HINT='"Ignoring non-allowlisted attribute", "Ignoring non-parent-sourced attribute", or "Ignoring unrecognised SKU" — expected for a negative test (an attribute not on the relevant allowlist, or a SKU that is neither VAR# nor PRD#).'
		;;
	sender)
		FUNCTION_NAME="${STAGE}-catalog-manhattan-item-sender"
		SUCCESS_HINT='"Manhattan ItemDownload response: accepted=N rejected=0 message=..." is the definitive success signal (logged on every attempt, not just failures). The "Sending N item(s) to Manhattan SCALE (M before coalescing)" line above it shows the coalesce count — N < M proves several rapid edits to the same variant collapsed into one send. The full outgoing XML is logged just before that ("Manhattan ItemDownload payload: ...") — grep it for Task 2 fields, e.g. <Color>, <XRefItem> (barcodes), <SerialNumTrackOutbound> (gift card), <Height>/<Length>/<Width>. This Lambda is shared across both stores — its log stream interleaves us and ps sends, so grep for the SKU/futura_ref you triggered if you need to isolate one.'
		DROP_HINT='"...rejected=N..." with N > 0 in the same response line means Manhattan rejected the item — the message field names the reason. Just before the ERROR line, look for "Rejected group of X item(s) out of Y in this invocation (Z before coalescing)." — X is the size of the specific group that failed, Y/Z give the full invocation context if the batch spanned multiple groups. A separate ERROR line ("Failed to send batch to Manhattan SCALE: ...") instead means it never reached Manhattan at all (auth/network failure) — the rejected=/accepted= summary is the authoritative signal, not just the absence of an ERROR line.'
		;;
	buffer)
		FUNCTION_NAME="${STAGE}-catalog-manhattan-item-buffer-buffer-handler"
		SUCCESS_HINT='"Sent 1 messages to processor." followed by "Deleted 1 messages from the queue." — this is the definitive proof a send succeeded. This Lambda is shared across both stores.'
		DROP_HINT='"Deleted 0 messages from the queue." means the send attempt failed and will retry (up to 10 times) before landing in the DLQ.'
		;;
	*)
		echo "Unknown --lambda value: $LAMBDA (expected enrich, sender, or buffer)" >&2
		exit 1
		;;
esac

if [[ "$LAMBDA" != "enrich" ]]; then
	echo "Note: --lambda ${LAMBDA} is shared across both stores — --store is ignored for it."
fi

echo "Tailing $FUNCTION_NAME (last $SINCE)..."
echo "Look for: $SUCCESS_HINT"
echo "Also watch for: $DROP_HINT"
echo "--------------------------------------------------"

aws logs tail "/aws/lambda/${FUNCTION_NAME}" --profile "$PROFILE" --region "$REGION" --since "$SINCE" --format short
