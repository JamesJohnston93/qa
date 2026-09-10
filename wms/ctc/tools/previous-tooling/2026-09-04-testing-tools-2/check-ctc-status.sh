#!/usr/bin/env bash
# Pipeline status for the CTC sales-order flow: Cin7 -> Order -> Shipment -> Manhattan SCALE.
#
# The sales-order counterpart to check-status.sh, which only knows the item-master queues.
# Walks the stages a CTC order passes through and prints, for each, the queue depths and
# whether anything has fallen into a dead-letter queue — the native ECOM path (1-5) and, since
# WHOLESALE/RTV branch off the same poller, the outbound path alongside it (2d, 3b, 4b). Then the
# poller's watermark, its schedule state, and the alarms.
#
# Read-only: no writes, no Cin7 calls, no lambda invokes.
#
# Usage: ./check-ctc-status.sh --stage <stage> --profile <profile>
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> [--region <region>]" >&2
	echo "Example: $0 --stage staging --profile staging" >&2
	exit 1
fi

PROBLEMS=0
RESOLVED=0

# Prints one queue's depth. $2 is the role label, $3 is "dlq" when a non-zero depth is a failure
# rather than just work in flight.
queue_row() {
	local queue="$1" label="$2" kind="${3:-queue}"
	local url visible in_flight

	url=$(aws sqs get-queue-url --profile "$PROFILE" --region "$REGION" \
		--queue-name "$queue" --query "QueueUrl" --output text 2>/dev/null) || {
		printf '    %-52s %s\n' "$queue" "NOT FOUND (deployed?)"
		return
	}
	RESOLVED=$((RESOLVED + 1))

	local attrs
	attrs=$(aws sqs get-queue-attributes --profile "$PROFILE" --region "$REGION" \
		--queue-url "$url" \
		--attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
		--query "join(' ', [Attributes.ApproximateNumberOfMessages, Attributes.ApproximateNumberOfMessagesNotVisible])" \
		--output text 2>/dev/null) || attrs=""
	if [[ -z "$attrs" ]]; then
		printf '    %-52s %s\n' "$queue" "could not read depth (permissions?)"
		return
	fi
	read -r visible in_flight <<< "$attrs"

	if [[ "$kind" == "dlq" && "$visible" != "0" ]]; then
		printf '    %-52s %s\n' "$queue" "** $visible DEAD-LETTERED ** ($label)"
		PROBLEMS=$((PROBLEMS + 1))
	else
		printf '    %-52s %s\n' "$queue" "$visible waiting, $in_flight in-flight  ($label)"
	fi
}

echo "CTC sales-order pipeline — stage: $STAGE"
echo "=================================================================="
echo
echo "1. Poll — Cin7 sales orders into the orders service"
queue_row "${STAGE}-orders-cin7-so-poller-schedule-dlq" "EventBridge failed to invoke the poller" dlq
echo
echo "2. Order chain — TRANS_CREATE_ORDER -> Order + items"
queue_row "${STAGE}-orders-v2.fifo" "shared with every UNI order"
queue_row "${STAGE}-orders-v2-dlq.fifo" "order never materialised" dlq
echo
echo "2b. Revisions — TRANS_UPDATE_ORDER -> line reconciliation + address merge"
queue_row "${STAGE}-orders-cin7-update-order-queue.fifo" "CTC-only; own queue so revisions cannot overtake"
queue_row "${STAGE}-orders-cin7-update-order-dlq.fifo" "a revision was never applied" dlq
echo
echo "2c. Cancellations — TRANS_CANCEL_ORDER -> order flipped, lines cancelled"
queue_row "${STAGE}-orders-cin7-cancel-order-queue.fifo" "CTC-only"
queue_row "${STAGE}-orders-cin7-cancel-order-dlq.fifo" "a cancellation was never applied" dlq
echo
echo "3. Order -> shipment handoff — ORDER_CREATED -> SHIPMENT_ITEM_CREATE"
queue_row "${STAGE}-shipping-v2-orders.fifo" "no DLQ on this queue"
echo
echo "4. Shipment chain — SHIPMENT_ITEM_CREATE / SHIPMENT_CREATE -> header + units"
queue_row "${STAGE}-shipping-v2.fifo" "no DLQ on this queue"
echo
echo "2d. Outbound order chain — TRANS_*_OUTBOUND_ORDER -> outbound order + items (WHOLESALE/RTV)"
queue_row "${STAGE}-orders-cin7-outbound-orders-queue.fifo" "shared by create/update/cancel — one FIFO queue so revisions cannot overtake"
queue_row "${STAGE}-orders-cin7-outbound-orders-dlq.fifo" "a revision was never applied" dlq
echo
echo "3b. Outbound bridge — OUTBOUND_ORDER_* -> shipping's own transaction chain"
queue_row "${STAGE}-shipping-inbound-outbound-bridge.fifo" "fed by the orders bus, not the shipping bus"
queue_row "${STAGE}-shipping-inbound-outbound-bridge-dlq.fifo" "a revision never reached shipping" dlq
echo
echo "4b. Outbound materialiser — TRANS_OUTBOUND_SHIPMENT_* -> OUTBOUND_SHIPMENT header + lines"
queue_row "${STAGE}-shipping-inbound-outbound.fifo" "emits OUTBOUND_SHIPMENT_READY on a successful SAVE or DELETE"
queue_row "${STAGE}-shipping-inbound-outbound-dlq.fifo" "a materialisation was never applied" dlq
echo
echo "5. Send — SHIPMENT_CREATED -> Manhattan SCALE (CTC only)"
queue_row "${STAGE}-shipping-manhattan-sender.fifo" "company=CTC; shared with the outbound sender (worker key SEND_OUTBOUND_SHIPMENT)"
queue_row "${STAGE}-shipping-manhattan-sender-dlq.fifo" "send failed 20 times" dlq

echo
echo "Poller state:"
echo "------------------------------------------------------------------"
WATERMARK=$(aws ssm get-parameter --profile "$PROFILE" --region "$REGION" \
	--name "/${STAGE}/orders/cin7-so-watermark" --query "Parameter.Value" --output text 2>/dev/null) \
	|| WATERMARK="(parameter not found — deployed?)"
echo "    watermark        ${WATERMARK}"
if [[ "$WATERMARK" == "UNSET" ]]; then
	echo "                     ^ poller is INACTIVE and will not call Cin7 at all."
	echo "                       Set it: ./cin7-watermark.sh --stage ${STAGE} --profile ${PROFILE} --poller so --set <UTC-ISO8601> --confirm"
fi

RULE_STATE=$(aws events describe-rule --profile "$PROFILE" --region "$REGION" \
	--name "${STAGE}-orders-cin7-so-poller-rule" --query "State" --output text 2>/dev/null) \
	|| RULE_STATE="(rule not found)"
echo "    schedule         ${RULE_STATE}  (every 2 minutes when ENABLED)"

echo
echo "Alarm status:"
echo "------------------------------------------------------------------"
ALARMS=(
	"${STAGE}-orders-cin7-so-poller-errors"
	"${STAGE}-orders-cin7-so-poller-stalled"
	"${STAGE}-orders-cin7-so-poller-page-cap-hit"
	"${STAGE}-orders-cin7-so-poller-alert"
	"${STAGE}-orders-cin7-update-order-errors"
	"${STAGE}-orders-cin7-cancel-order-errors"
	# A withheld cancellation is not a failure — it is a decision a human has to make in SCALE,
	# because the warehouse already fulfilled the order Cin7 is asking us to withdraw.
	"${STAGE}-orders-cin7-sales-order-cancel-withheld"
	"${STAGE}-orders-cin7-create-outbound-order-errors"
	"${STAGE}-orders-cin7-update-outbound-order-errors"
	"${STAGE}-orders-cin7-cancel-outbound-order-errors"
	# Same withheld-cancellation shape as the native alarm above, for WHOLESALE/RTV orders.
	"${STAGE}-orders-cin7-outbound-order-cancel-withheld"
)
for alarm in "${ALARMS[@]}"; do
	state=$(aws cloudwatch describe-alarms --profile "$PROFILE" --region "$REGION" \
		--alarm-names "$alarm" --query "MetricAlarms[0].StateValue" --output text 2>/dev/null) || state=""
	if [[ -z "$state" || "$state" == "None" ]]; then
		printf '    %-52s %s\n' "$alarm" "NOT FOUND (deployed?)"
	else
		printf '    %-52s %s\n' "$alarm" "$state"
		if [[ "$state" == "ALARM" ]]; then
			PROBLEMS=$((PROBLEMS + 1))
		fi
	fi
done

cat <<EOF

Reading it:
  * A clean idle state is every queue at 0 waiting / 0 in-flight, the schedule ENABLED, and a
    watermark that is a real timestamp rather than UNSET.
  * Stages 2 and 3 are SHARED with every UNI order — a non-zero depth there is usually other
    people's traffic, not your test. Stages 1, 2b, 2c, 2d, 3b, 4b and 5 are CTC-only, so anything
    sitting in those is yours. 2d/3b/4b are the WHOLESALE/RTV path — ECOM never touches them.
  * Anything in a *-dlq queue means that step exhausted its retries. Stage 5's DLQ is the one
    that means "SCALE rejected it or was unreachable" — read the sender log for why:
      ./invoke-shipment-sender.sh --stage ${STAGE} --profile ${PROFILE} --reference <ref>

Known observability gaps — absence of an alarm here does NOT mean absence of a problem:
  * Stages 3 and 4 have no dead-letter queue at all, so a shipment that dies mid-chain leaves
    no trace in any queue. inspect-ctc-order.sh is the check: an Order with no Shipment header.
  * ${STAGE}-shipping-manhattan (stage 5) declares NO alarms — neither its DLQ depth nor a send
    failure raises one. The DLQ row above is the only signal.
  * ${STAGE}-shipping-inbound (stages 3b/4b) declares NO alarms either — the bridge and the
    outbound materialiser have DLQs, but nothing watches them. The DLQ rows above are the only
    signal there too.
  * The poller's schedule DLQ (stage 1) has no alarm either.
  * The alarms above cover the POLLER and the outbound order handlers only, not either send leg
    or the bridge/materialiser.

Dashboard (poller metrics, orders service):
  https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=${STAGE}-orders-cin7-dashboard
EOF

echo
if [[ "$RESOLVED" -eq 0 ]]; then
	echo "No queues resolved at all — wrong --stage, wrong --profile, or this stage is not deployed."
	echo "Nothing above should be read as a pass."
	exit 1
fi
if [[ "$PROBLEMS" -gt 0 ]]; then
	echo "${PROBLEMS} thing(s) above need attention."
	exit 1
fi
echo "Nothing dead-lettered, no alarms firing."
