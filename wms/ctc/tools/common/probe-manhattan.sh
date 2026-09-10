#!/usr/bin/env bash
# POSTs a hand-written ShippingDownload document straight to Manhattan SCALE and prints its reply.
#
# Why this exists: the sender always rebuilds the whole detail set from the persisted rows, so it
# cannot be made to send an arbitrary document. Any question of the form "how does SCALE actually
# behave if we send X" is unanswerable through the pipeline — you would have to change production
# code to find out, then change it back if the answer is no.
#
# It exists because of one such question. SCALE rejected a two-size order with:
#
#   Cannot modify more than one line with erp order line num "3477826" in a single transaction.
#
# The obvious workaround is one document per line. But that only helps if a second document *adds*
# a line rather than *replacing* the first — and nothing in the interface documentation says which.
# This tool answers that in two POSTs instead of a deploy.
#
# Usage:
#   ./probe-manhattan.sh --stage <stage> --profile <profile> --file <doc.xml> [--send]
#   ./probe-manhattan.sh --stage <stage> --profile <profile> --withdraw <reference> [--send]
#
#   --file      an XML document, or `-` to read stdin
#   --withdraw  build a header DELETE for one shipment reference instead of reading a file —
#               the reset lever for the SCALE side, mirroring clean-ctc-order.sh on the AWS side.
#   --send      actually POST. Without it, the document is printed and validated locally only.
#
# Why --withdraw exists: `clean-ctc-order.sh` empties our tables but cannot touch SCALE, and a
# detail SAVE is an upsert rather than a replace — lines absent from a payload survive. So a
# re-seeded fixture lands on the *previous* scenario's shipment and its leftover details persist.
# On 1 Sep 2026 that put two details for the same option on one shipment and read like a
# middleware defect. Clear both sides, always.
#
# Credentials come from the `{stage}/manhattan/oauth2` secret, which must carry the full shape:
# base_url, token_url, client_id, client_secret, resource. All five are required.
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ `--send` REACHES A REAL SCALE. Whatever `base_url` in the secret points at will be        │
# │ modified — creating or changing shipments. Agree the target and the document first.       │
# │ Everything it sends is echoed to stdout, so there is always a record of what was sent.    │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
set -euo pipefail

STAGE=""
PROFILE=""
REGION="ap-southeast-2"
FILE=""
WITHDRAW=""
SEND="false"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--file) FILE="$2"; shift 2 ;;
		--withdraw) WITHDRAW="$2"; shift 2 ;;
		--send) SEND="true"; shift ;;
		-h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -n "$FILE" && -n "$WITHDRAW" ]]; then
	echo "Pass --file or --withdraw, not both." >&2
	exit 1
fi

if [[ -z "$STAGE" || -z "$PROFILE" ]] || [[ -z "$FILE" && -z "$WITHDRAW" ]]; then
	echo "Usage: $0 --stage <stage> --profile <profile> (--file <doc.xml|-> | --withdraw <ref>) [--send]" >&2
	exit 1
fi

if [[ -n "$WITHDRAW" ]]; then
	# Same normalised reference clean-ctc-order.sh takes — no leading '#'. SCALE keys the
	# shipment on ShipmentId, which the sender sets to that reference.
	if [[ ! "$WITHDRAW" =~ ^[A-Za-z0-9_-]+$ ]]; then
		echo "REFUSED: --withdraw takes the normalised reference, no '#' and no wildcards." >&2
		echo "Got '${WITHDRAW}'." >&2
		exit 1
	fi
	# Header only, no Details — the shape mapShipmentDeleteToDownload builds: the lines go with
	# the header. Elements are alphabetical, as every Manhattan document must be.
	XML="<WMWROOT xsi:schemaLocation=\"http://www.manh.com/ILSNET/Interface ShippingDownload.xsd\" xmlns=\"http://www.manh.com/ILSNET/Interface\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><WMWDATA><Shipments><Shipment><Action>DELETE</Action><ErpOrder>${WITHDRAW}</ErpOrder><ShipmentId>${WITHDRAW}</ShipmentId><Warehouse>CTC-QDC</Warehouse></Shipment></Shipments></WMWDATA></WMWROOT>"
	echo "Withdrawing shipment ${WITHDRAW} from ${STAGE}'s SCALE (header DELETE, no details)." >&2
elif [[ "$FILE" == "-" ]]; then
	XML=$(cat)
else
	[[ -f "$FILE" ]] || { echo "No such file: $FILE" >&2; exit 1; }
	XML=$(cat "$FILE")
fi

# Cheap sanity checks, so an obvious mistake is caught before it reaches SCALE rather than coming
# back as an opaque rejection.
python3 - "$XML" <<'PY'
import sys, re
xml = sys.argv[1]
problems = []
if '<WMWROOT' not in xml:
	problems.append('no <WMWROOT> root element')
if '<ShipmentId>' not in xml:
	problems.append('no <ShipmentId> — SCALE keys the shipment on it')
# ErpOrderLineNum is decimal(19,5) in SCALE, so a fractional discriminator is legal and must
# be matched here — an integer-only pattern reads a decimal document as having no lines at
# all, and the duplicate check below then passes vacuously.
lines = re.findall(r'<ErpOrderLineNum>([0-9.]+)</ErpOrderLineNum>', xml)
# Compare on value, so 3477826 and 3477826.00000 are recognised as the same line.
lines = [str(float(n)) for n in lines]
dupes = {n for n in lines if lines.count(n) > 1}
if dupes:
	problems.append(
		'more than one detail shares ErpOrderLineNum '
		+ ', '.join(sorted(dupes))
		+ ' — SCALE refuses that in a single transaction, which is the whole reason this '
		'tool exists. Split them into separate documents.'
	)
if problems:
	print('Document looks wrong:', file=sys.stderr)
	for p in problems:
		print(f'  - {p}', file=sys.stderr)
	sys.exit(1)
print(f'Document OK: {len(lines)} detail line(s), erp line num(s) {sorted(set(lines))}', file=sys.stderr)
PY

echo
echo "--- document ---"
echo "$XML"
echo

if [[ "$SEND" != "true" ]]; then
	echo "Not sent. Pass --send to POST this to ${STAGE}'s Manhattan target."
	exit 0
fi

if ! SECRET=$(aws secretsmanager get-secret-value --profile "$PROFILE" --region "$REGION" \
	--secret-id "${STAGE}/manhattan/oauth2" --query SecretString --output text 2>&1); then
	echo "Could not read the ${STAGE}/manhattan/oauth2 secret:" >&2
	echo "${SECRET}" >&2
	exit 1
fi

# The token exchange happens inside Python rather than as a curl line for two reasons: the
# client_secret never becomes a shell variable (so it cannot leak through `set -x` or a crash
# dump), and the secret's values are read by key rather than by splitting a line on spaces.
if ! CREDENTIALS=$(SECRET="$SECRET" python3 - <<'PY'
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# The full shape of a Manhattan OAuth secret. All five are required — `resource` included: SCALE
# issues a token scoped to that resource, and a token obtained without it is refused by the
# interface endpoint rather than failing at the token step, which makes it look like a bad document.
REQUIRED = ('base_url', 'token_url', 'client_id', 'client_secret', 'resource')

try:
	secret = json.loads(os.environ['SECRET'])
except json.JSONDecodeError as exc:
	sys.exit(f'The secret is not valid JSON: {exc}')

missing = [key for key in REQUIRED if not secret.get(key)]
if missing:
	sys.exit(
		'The secret is missing: ' + ', '.join(missing) + '\n'
		'A Manhattan OAuth secret carries all of: ' + ', '.join(REQUIRED)
	)

body = urllib.parse.urlencode(
	{
		'grant_type': 'client_credentials',
		'client_id': secret['client_id'],
		'client_secret': secret['client_secret'],
		'resource': secret['resource'],
	}
).encode()

try:
	with urllib.request.urlopen(
		urllib.request.Request(
			secret['token_url'],
			data=body,
			headers={'Content-Type': 'application/x-www-form-urlencoded'},
		),
		timeout=30,
	) as response:
		payload = json.load(response)
except urllib.error.HTTPError as exc:
	detail = exc.read().decode('utf-8', errors='replace')
	sys.exit(f'Token request rejected: {exc.code} {exc.reason}\n{detail}')
except urllib.error.URLError as exc:
	sys.exit(f'Could not reach the token endpoint: {exc.reason}')

token = payload.get('access_token')
if not token:
	sys.exit('The token response carried no access_token: ' + json.dumps(payload))

print(secret['base_url'].rstrip('/'))
print(token)
PY
); then
	# Python reports its own failure on stderr, so this only adds anything if it died silently.
	[[ -n "${CREDENTIALS}" ]] && echo "${CREDENTIALS}" >&2
	exit 1
fi

BASE_URL=$(sed -n 1p <<<"$CREDENTIALS")
TOKEN=$(sed -n 2p <<<"$CREDENTIALS")

# The XML travels string-escaped inside a JSON envelope, exactly as the sender posts it.
BODY=$(XML="$XML" python3 -c "
import json, os
print(json.dumps({'xmlData': os.environ['XML']}))
")

# Accept and Accept-Language are both required. Manhattan rejects a wildcard on either, and curl
# defaults Accept to */* — which comes back as "The Accept HTTP header does not contain a supported
# media type", not as anything to do with the document. ManhattanOAuthClient sets the same two.
echo "--- POST ${BASE_URL}/general/interfaces/shipments-Downloaded ---"
# Captured before parsing, not piped into the parser: a non-JSON body used to be swallowed by
# json.tool and the message claimed it had been printed when it never was. A degraded SCALE
# answers with something other than the accepted/rejected envelope, and that body is the evidence.
RESPONSE_FILE=$(mktemp)
HTTP_CODE=$(curl -sS -X POST "${BASE_URL}/general/interfaces/shipments-Downloaded" \
	-H "Authorization: Bearer ${TOKEN}" \
	-H 'Content-Type: application/json' \
	-H 'Accept: application/json' \
	-H 'Accept-Language: en-US' \
	--data "$BODY" \
	-o "$RESPONSE_FILE" -w '%{http_code}' -D "${RESPONSE_FILE}.headers")
echo "HTTP ${HTTP_CODE}, $(wc -c < "$RESPONSE_FILE" | tr -d ' ') byte body"
echo "--- response headers ---"
cat "${RESPONSE_FILE}.headers"
echo "--- response body ---"
python3 -m json.tool < "$RESPONSE_FILE" 2>/dev/null || cat "$RESPONSE_FILE"
echo
rm -f "$RESPONSE_FILE" "${RESPONSE_FILE}.headers"
