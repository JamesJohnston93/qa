#!/usr/bin/env bash
# Tails CloudWatch logs for one of the Manhattan sync Lambdas, or the Cin7 item poller (BUSY-1115).
# The enrich Lambda is deployed once per store (its own queue/DLQ each) — pass --store to pick
# which. sender and buffer are shared across both stores (one buffer/sender for the whole
# pipeline), so --store is ignored for those. cin7-poller is a singleton, no store dimension at
# all — CTC isn't a store in this repo — so --store is ignored for it too.
# populator sits upstream of the shared buffer SQS queue (between the EventBridge rule and the
# queue itself) and is a singleton, shared across both stores like sender/buffer. It is
# undocumented in the LLD and absent from every QA doc's Services table — added here 2026-08-10
# (BUSY-1115/CS5) because it's the only place evidence exists for a populator-side throw (e.g.
# invalid MessageGroupId), which happens before the message ever reaches the buffer queue or its
# DLQ, so it's invisible to --lambda buffer.
# Usage: ./tail-logs.sh --stage <stage> --profile <profile> --lambda <enrich|sender|buffer|populator|cin7-poller> [--store <us|ps>] [--since <duration>]
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
	echo "Usage: $0 --stage <stage> --profile <profile> --lambda <enrich|sender|buffer|populator|cin7-poller> [--store <us|ps>] [--since <duration>]" >&2
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
	populator)
		FUNCTION_NAME="${STAGE}-catalog-manhattan-item-buffer-buffer-populator"
		SUCCESS_HINT='Clean pass-through logs a successful SendMessage to the buffer FIFO queue with no ERROR/throw line — the record then shows up in --lambda buffer next. This Lambda is shared across both stores.'
		DROP_HINT='"InvalidParameterValue: Value CTC#<item_code> for parameter MessageGroupId is invalid. Reason: MessageGroupId can only include alphanumeric and punctuation characters..." is the confirmed CS5/ERR5 throw (whitespace in item_code). This happens BEFORE the message reaches the SQS queue, so it never lands in the buffer DLQ and is invisible to --lambda buffer — this log group is the only place the evidence exists. No DeadLetterConfig/RetryPolicy is configured on this Lambda (confirmed BUSY-1115), so after Lambdas default async retries exhaust, the record vanishes with no trace anywhere else. Also check the populator Errors CloudWatch metric for a delta even when nothing prints here.'
		;;
	cin7-poller)
		FUNCTION_NAME="${STAGE}-catalog-cin7-cin7-item-poller"
		SUCCESS_HINT='{"metric":"Cin7PollerCycleComplete","productsFetched":N,"recordsEmitted":M,...,"watermarkAdvanced":true} is the definitive per-cycle success signal. Before it: {"metric":"Cin7ProductsFetched","page":P,"count":C} per page of the primary /Products poll; {"metric":"Cin7ProductOptionsFetched",...} and {"metric":"Cin7TriggeredProductsFetched","count":N} show the BUSY-1115 trigger-fan-in at work — a non-zero triggered count with a record whose fields clearly came from a fresh product read (not just the option) proves the trigger path, not the primary poll, supplied that record. {"metric":"Cin7RecordEmitted","item_code":"..."} logs once per emitted record.'
		DROP_HINT='{"metric":"Cin7ItemPollerInactive",...} means the watermark is still the UNSET sentinel — set one with cin7-watermark.sh first. {"metric":"Cin7InactiveSkip",...} is an expected per-option skip (status not Public/Primary), not a failure. {"metric":"ManhattanValidationFailure","reason":"missing_item_code",...} is the expected INFO-level skip for an option with no productOptionCode (BUSY-1115 AC) — no throw, cycle continues. A "Cin7PollerCycleFailed" line (Lambda error, watermark untouched) means the whole cycle aborted — check the message for the underlying Cin7RequestError/timeout.'
		;;
	*)
		echo "Unknown --lambda value: $LAMBDA (expected enrich, sender, buffer, populator, or cin7-poller)" >&2
		exit 1
		;;
esac

if [[ "$LAMBDA" == "sender" || "$LAMBDA" == "buffer" || "$LAMBDA" == "populator" ]]; then
	echo "Note: --lambda ${LAMBDA} is shared across both stores — --store is ignored for it."
elif [[ "$LAMBDA" == "cin7-poller" ]]; then
	echo "Note: --lambda cin7-poller is a singleton (CTC has no store dimension) — --store is ignored for it."
fi

echo "Tailing $FUNCTION_NAME (last $SINCE)..."
echo "Look for: $SUCCESS_HINT"
echo "Also watch for: $DROP_HINT"
echo "--------------------------------------------------"

aws logs tail "/aws/lambda/${FUNCTION_NAME}" --profile "$PROFILE" --region "$REGION" --since "$SINCE" --format short
