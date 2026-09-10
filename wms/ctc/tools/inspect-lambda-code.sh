#!/usr/bin/env bash
# Downloads a deployed Lambda's own code package and greps it for one or more search terms,
# printing a short context window around each match. Deletes the downloaded code afterward.
#
# Ticket:      none, promoted to the tools root (first used BUSY-1160 slice 06)
# Cases:       BUSY-1160 TC1b / Q40 (where the 25-char ShipTo truncation lives), reusable for
#              BUSY-1065 Q29 (does staging-shipping-v2-dc-packing-shipment-create resolve `company`
#              from an explicit field or from `brand`) and any other "which deployed function
#              actually does X" question this account's functions can answer without monorepo access
# Asserts:     the search term is present or absent in the code package currently running for the
#              given function, with the surrounding lines as context
# Does NOT:    prove behaviour at runtime -- a string's presence/absence in the bundle is not the
#              same as it being reachable or correct. Does not replace reading a real invocation's
#              logs when one is available. Works only for functions whose deployed package is a
#              single-file JS bundle (esbuild/webpack) or otherwise text-greppable; will not find
#              anything meaningful in a compiled or binary artifact.
# Side effects: read only. Downloads to a temp directory and deletes it before exiting, success or
#              failure. Never writes anything AWS-side. This is NOT monorepo/build access -- it
#              inspects the artifact already running in the target account under existing
#              credentials, not a source repository.
#
# Usage: ./inspect-lambda-code.sh --stage <stage> --profile <profile> --function <name> \
#          --search <term>[,<term>...] [--context <chars>] [--region <region>] [--max-hits <n>]
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
FUNCTION=""
SEARCH=""
CONTEXT=150
MAX_HITS=15

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--function) FUNCTION="$2"; shift 2 ;;
		--search) SEARCH="$2"; shift 2 ;;
		--context) CONTEXT="$2"; shift 2 ;;
		--max-hits) MAX_HITS="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STAGE" || -z "$PROFILE" || -z "$FUNCTION" || -z "$SEARCH" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> --function <name> --search <term>[,<term>...] [--context <chars>] [--region <region>] [--max-hits <n>]" >&2
	echo "--function is the full deployed function name, e.g. staging-shipping-manhattan-send-shipment" >&2
	exit 1
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Function: $FUNCTION"
aws lambda get-function --profile "$PROFILE" --region "$REGION" --function-name "$FUNCTION" \
	--query '{CodeUrl:Code.Location,Runtime:Configuration.Runtime,LastModified:Configuration.LastModified,CodeSize:Configuration.CodeSize}' \
	--output json > "$WORKDIR/meta.json"
cat "$WORKDIR/meta.json"

CODE_URL=$(python3 -c "import json; print(json.load(open('$WORKDIR/meta.json'))['CodeUrl'])")
curl -s -o "$WORKDIR/code.zip" "$CODE_URL"
mkdir -p "$WORKDIR/code"
unzip -oq "$WORKDIR/code.zip" -d "$WORKDIR/code"

FILE_COUNT=$(find "$WORKDIR/code" -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.cjs" \) | wc -l | tr -d ' ')
echo "JS files found: $FILE_COUNT"
echo

python3 - "$WORKDIR/code" "$SEARCH" "$CONTEXT" "$MAX_HITS" <<'PY'
import sys, os

root, search_arg, context_arg, max_hits_arg = sys.argv[1:5]
context = int(context_arg)
max_hits = int(max_hits_arg)
terms = [t for t in search_arg.split(",") if t]

js_files = []
for dirpath, _, filenames in os.walk(root):
	for fn in filenames:
		if fn.endswith((".js", ".mjs", ".cjs")):
			js_files.append(os.path.join(dirpath, fn))

for term in terms:
	print(f"=== '{term}' ===")
	total = 0
	for path in js_files:
		data = open(path, encoding="utf-8", errors="replace").read()
		idx = 0
		while True:
			idx = data.find(term, idx)
			if idx == -1 or total >= max_hits:
				break
			start = max(0, idx - context)
			end = idx + len(term) + context
			rel = os.path.relpath(path, root)
			print(f"[{rel}] {data[start:end]!r}")
			print("---")
			idx += len(term)
			total += 1
		if total >= max_hits:
			break
	if total == 0:
		print("(no matches)")
	elif total >= max_hits:
		print(f"(stopped at --max-hits {max_hits}, more may exist)")
	print()
PY

echo "Downloaded code deleted (temp dir cleaned up on exit)."
