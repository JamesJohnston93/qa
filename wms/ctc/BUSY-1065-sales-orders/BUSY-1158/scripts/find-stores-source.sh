#!/usr/bin/env bash
# Finds where a given lambda's IAM role actually lets it read data from, cheapest candidate first:
# a DynamoDB table with 'store' in the name, an SSM parameter, or (by elimination) a constant
# baked into the function's own code.
#
# Ticket:      BUSY-1158
# Cases:       TC9 (Gate A)
# Asserts:     which DynamoDB tables and SSM parameter paths the function's execution role can read.
#              If nothing 'store'-shaped shows up, that rules out a table and an SSM parameter as the
#              source of a 'Stores' list this function might gate on, by IAM permission rather than
#              by guessing from behaviour.
# Does NOT:    read the function's code, so it cannot confirm a hardcoded constant exists, only that
#              nothing external is reachable. Does NOT say whether the function actually uses any of
#              the resources it is permitted to read. Does NOT check resource-based policies (e.g. an
#              SSM parameter shared account-wide with no explicit grant needed) — IAM role policy only.
# Side effects: read only (iam:Get*/List*, no writes)
#
# Usage: ./find-stores-source.sh --stage <stage> --profile <profile> --function <lambda-name>
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
FUNCTION=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--function) FUNCTION="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$FUNCTION" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --function <lambda-name>" >&2
	echo "Example: $0 --stage staging --profile staging --function staging-orders-v2-list-orders" >&2
	exit 1
fi

echo "== Function: ${FUNCTION} =="
aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
	--function-name "$FUNCTION" \
	--query '{EnvKeys:Environment.Variables,Role:Role}' --output json

ROLE_ARN=$(aws lambda get-function-configuration --profile "$PROFILE" --region "$REGION" \
	--function-name "$FUNCTION" --query 'Role' --output text)
ROLE_NAME=$(basename "$ROLE_ARN")

echo
echo "== Role: ${ROLE_NAME} =="
echo "-- inline policies --"
INLINE_NAMES=$(aws iam list-role-policies --profile "$PROFILE" --role-name "$ROLE_NAME" \
	--query 'PolicyNames' --output text)

for POLICY_NAME in $INLINE_NAMES; do
	echo "policy: ${POLICY_NAME}"
	aws iam get-role-policy --profile "$PROFILE" --role-name "$ROLE_NAME" \
		--policy-name "$POLICY_NAME" --query 'PolicyDocument.Statement' --output json
done

echo
echo "-- attached managed policies (names only, not expanded) --"
aws iam list-attached-role-policies --profile "$PROFILE" --role-name "$ROLE_NAME" \
	--query 'AttachedPolicies[].PolicyName' --output text

echo
echo "== Reading the above: =="
echo "Any 'dynamodb:*' Resource naming a table with 'store' in it is a MEASURED table source."
echo "Any 'ssm:GetParameter*' Resource naming a store-shaped path is a MEASURED SSM source."
echo "If neither appears, the role cannot reach either candidate, and the source (if any) is a"
echo "constant in the function's own code — record Gate A as UNKNOWN, not inferred."
