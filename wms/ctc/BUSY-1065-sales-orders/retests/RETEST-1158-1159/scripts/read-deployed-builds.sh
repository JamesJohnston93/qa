#!/usr/bin/env bash
# Reads LastModified, CodeSha256 and Version for a fixed list of order/shipment
# consumer lambdas, and flags whether each changed after a baseline date.
#
# Ticket:      RETEST-1158-1159, slice R0 (Gate B)
# Cases:       none directly, feeds every later R1-R6 scope decision
# Asserts:     what LastModified/CodeSha256/Version each named function reports right now
# Does NOT:    prove a function's behaviour changed, only that its deployed artifact's
#              metadata did (or did not) move since the baseline. Does not prove a
#              function existed or did not exist on the baseline date, only whether it
#              has been touched since. Env var values are never read by this script.
# Side effects: read only
#
# Usage: ./read-deployed-builds.sh --stage <stage> --profile <profile> [--baseline 2026-09-02]
set -euo pipefail

STAGE=""
PROFILE=""
BASELINE="2026-09-02T23:59:59Z"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --baseline) BASELINE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$STAGE" || -z "$PROFILE" ]]; then
  echo "Usage: $0 --stage <stage> --profile <profile> [--baseline <ISO8601>]" >&2
  exit 1
fi

REGION="ap-southeast-2"

FUNCTIONS=(
  "${STAGE}-orders-cin7-so-poller"
  "${STAGE}-orders-v2-create-order"
  "${STAGE}-orders-v2-create-transaction"
  "${STAGE}-orders-v2-update-transaction"
  "${STAGE}-orders-cin7-cancel-order"
  "${STAGE}-orders-cin7-cancel-order-eda-queue-handler"
  "${STAGE}-orders-cin7-cancel-order-eda-queue-populator"
  "${STAGE}-shipping-manhattan-send-shipment"
  "faulty-sale-worker-queue-handler"
  "${STAGE}-shipping-v2-dc-packing-eda-queue-handler"
  "${STAGE}-shipping-v2-dc-packing-shipment-create"
  "${STAGE}-shipping-v2-dc-packing-shipment-delete"
  "${STAGE}-shipping-v2-dc-packing-shipment-hold-update"
  "${STAGE}-shipping-v2-dc-packing-shipment-address-update"
  "${STAGE}-shipping-v2-generate-pickslip"
  "${STAGE}-orders-v2-segment-eda-queue-handler"
  "${STAGE}-orders-v2-order-reporting-stream"
  "${STAGE}-shipping-v2-shipment-reporting-stream"
  "${STAGE}-inventory-core-shipment-inventory-eda-queue-handler"
  "ShipmentItemRejectedEventWorker-queue-handler"
  "${STAGE}-orders-dn-rec-eda-queue-handler"
  "${STAGE}-shipping-v2-shopify-move-fulfilment-orders"
  "${STAGE}-orders-v2-orders-futura-eda-queue-handler"
  "${STAGE}-shipping-v2-shipment-futura-eda-queue-handler"
)

baseline_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$BASELINE" "+%s" 2>/dev/null || date -d "$BASELINE" "+%s")

printf '%-55s %-30s %-14s %-8s %s\n' "Function" "LastModified" "Sha(12)" "Version" "ChangedSince${BASELINE}"
printf '%-55s %-30s %-14s %-8s %s\n' "--------" "------------" "-------" "-------" "----------------------"

for fn in "${FUNCTIONS[@]}"; do
  raw=$(aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
    --function-name "$fn" \
    --query '{LastModified:LastModified,Sha:CodeSha256,Version:Version}' \
    --output json 2>/dev/null) || {
      printf '%-55s %-30s %-14s %-8s %s\n' "$fn" "NOT FOUND" "-" "-" "-"
      continue
    }

  lm=$(echo "$raw" | python3 -c "import json,sys; print(json.load(sys.stdin)['LastModified'])")
  sha=$(echo "$raw" | python3 -c "import json,sys; print(json.load(sys.stdin)['Sha'])")
  ver=$(echo "$raw" | python3 -c "import json,sys; print(json.load(sys.stdin)['Version'])")
  sha12="${sha:0:12}"

  lm_norm=$(echo "$lm" | sed -E 's/\.[0-9]+\+0000$/Z/; s/\+0000$/Z/')
  lm_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$lm_norm" "+%s" 2>/dev/null || date -d "$lm_norm" "+%s" 2>/dev/null || echo 0)

  if [[ "$lm_epoch" -gt "$baseline_epoch" ]]; then
    changed="yes"
  else
    changed="no"
  fi

  printf '%-55s %-30s %-14s %-8s %s\n' "$fn" "$lm" "$sha12" "$ver" "$changed"
done
