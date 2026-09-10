#!/usr/bin/env bash
# Plan A residual scan — whitespace in the BARE product/option code fields.
#
# WHY: Plan A closed as a harness artefact because the poller builds message_group_id as
# {company}#{productOptionCode}_{size} from separate CLEAN fields, so whitespace in the
# size-suffixed productOptions[].code can never reach the group id by construction.
# The ONE residual shape that could still reach the buffer-populator's raw-concat path is a
# product whose BARE code field itself carries whitespace. This scan looks for exactly that.
#
# GET-ONLY, ALWAYS. Same credential model as preview-cin7-sync.sh / find-cin7-item.sh: a .env
# file next to this script, or CIN7_USERNAME / CIN7_API_KEY env vars, or --username/--api-key.
# This script issues plain curl GETs against /api/v1/Products only. It writes nothing to Cin7,
# nothing to AWS, and does not touch the watermark.
#
# Usage:
#   ./scan-bare-code-whitespace.sh                 # scan every product, all pages
#   ./scan-bare-code-whitespace.sh --max-pages 5   # cap it while smoke-testing
#   ./scan-bare-code-whitespace.sh --keep          # keep the raw JSON pages for evidence
#
# Cost: ~14 requests for the full CTC catalogue (~3,257 records at 250/page). Well inside the
# shared 5,000/day cap. Rate-limited to ~3 req/s like the other scripts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
	while IFS='=' read -r key value; do
		[[ -z "$key" || "$key" == \#* ]] && continue
		if [[ -z "${!key:-}" ]]; then
			export "$key=$value"
		fi
	done < "$ENV_FILE"
fi

CIN7_BASE_URL="https://api.cin7.com"
PAGE_SIZE=250
RATE_LIMIT_SECONDS="0.35"

USERNAME="${CIN7_USERNAME:-}"
API_KEY="${CIN7_API_KEY:-}"
MAX_PAGES=1000
KEEP=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		--keep) KEEP=1; shift ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Missing Cin7 credentials. Set CIN7_USERNAME / CIN7_API_KEY, or use .env, or pass --username/--api-key." >&2
	exit 1
fi

WORKDIR="$(mktemp -d)"
if [[ "$KEEP" == "1" ]]; then
	WORKDIR="${SCRIPT_DIR}/bare-code-scan-$(date -u +%Y%m%dT%H%M%SZ)"
	mkdir -p "$WORKDIR"
	echo "Keeping raw pages in: $WORKDIR" >&2
else
	trap 'rm -rf "$WORKDIR"' EXIT
fi

cin7_get() {
	local url="$1"
	local response status_code body
	response=$(curl -sS -w $'\n%{http_code}' -u "${USERNAME}:${API_KEY}" -G "$url" \
		--data-urlencode "order=id ASC" \
		--data-urlencode "rows=${PAGE_SIZE}" \
		--data-urlencode "page=${2}")
	status_code=$(echo "$response" | tail -n1)
	body=$(echo "$response" | sed '$d')
	if [[ "$status_code" == "429" ]]; then
		echo "Rate limited by Cin7 — waiting 1s and retrying once..." >&2
		sleep 1
		response=$(curl -sS -w $'\n%{http_code}' -u "${USERNAME}:${API_KEY}" -G "$url" \
			--data-urlencode "order=id ASC" \
			--data-urlencode "rows=${PAGE_SIZE}" \
			--data-urlencode "page=${2}")
		status_code=$(echo "$response" | tail -n1)
		body=$(echo "$response" | sed '$d')
	fi
	if [[ "$status_code" != "200" ]]; then
		echo "Cin7 request failed: HTTP $status_code" >&2
		echo "$body" >&2
		exit 1
	fi
	echo "$body"
}

PAGE=1
TOTAL=0
while (( PAGE <= MAX_PAGES )); do
	BODY=$(cin7_get "${CIN7_BASE_URL}/api/v1/Products" "$PAGE")
	COUNT=$(echo "$BODY" | jq 'length')
	[[ "$COUNT" == "0" ]] && break
	echo "$BODY" > "${WORKDIR}/products-page-${PAGE}.json"
	TOTAL=$(( TOTAL + COUNT ))
	echo "Fetched /Products page $PAGE: $COUNT product(s)  [running total: $TOTAL]" >&2
	(( COUNT < PAGE_SIZE )) && break
	PAGE=$(( PAGE + 1 ))
	sleep "$RATE_LIMIT_SECONDS"
done

echo "" >&2
echo "Scanning $TOTAL product(s) for whitespace in code fields..." >&2
echo "" >&2

python3 - "$WORKDIR" <<'PY'
import json, glob, os, re, sys

workdir = sys.argv[1]
products = []
for f in sorted(glob.glob(os.path.join(workdir, "products-page-*.json"))):
    with open(f) as fh:
        products.extend(json.load(fh))

WS = re.compile(r"\s")

def vis(s):
    return (s.replace("\t", "\\t")
             .replace("\r", "\\r")
             .replace("\n", "\\n")
             .replace(" ", "·"))

def code_fields(obj):
    """Any string field whose key looks like a code."""
    out = {}
    for k, v in obj.items():
        if isinstance(v, str) and v and re.search(r"code$", k, re.I):
            out[k] = v
    return out

bare_hits = []       # whitespace in a NON-size-suffixed code field  <-- the residual we care about
suffixed_hits = []   # whitespace in productOptions[].code           <-- known, benign by construction
keys_seen_product = set()
keys_seen_option = set()
eligible_bare = 0
opts_total = 0

for p in products:
    pid = p.get("id")
    pname = p.get("name")
    pstatus = p.get("status")
    pfields = code_fields(p)
    keys_seen_product.update(pfields.keys())
    for k, v in pfields.items():
        if WS.search(v):
            hit = {
                "level": "product", "field": k, "value": v, "productId": pid,
                "product": pname, "productStatus": pstatus, "optionStatus": None,
                "optionId": None,
            }
            bare_hits.append(hit)
            if pstatus == "Public":
                eligible_bare += 1

    for o in (p.get("productOptions") or []):
        opts_total += 1
        ofields = code_fields(o)
        keys_seen_option.update(ofields.keys())
        ostatus = o.get("status")
        for k, v in ofields.items():
            if not WS.search(v):
                continue
            hit = {
                "level": "option", "field": k, "value": v, "productId": pid,
                "product": pname, "productStatus": pstatus, "optionStatus": ostatus,
                "optionId": o.get("id"),
            }
            # productOptions[].code is the SIZE-SUFFIXED code -> known, benign by construction.
            if k.lower() == "code":
                suffixed_hits.append(hit)
            else:
                bare_hits.append(hit)
                if pstatus == "Public" and ostatus == "Primary":
                    eligible_bare += 1

print("=" * 78)
print("PLAN A RESIDUAL SCAN — whitespace in bare product/option code fields")
print("=" * 78)
print(f"Products scanned : {len(products)}")
print(f"Options scanned  : {opts_total}")
print(f"Product-level code fields present : {sorted(keys_seen_product) or '(none)'}")
print(f"Option-level code fields present  : {sorted(keys_seen_option) or '(none)'}")
print()

print("-" * 78)
print(f"A) BARE code fields carrying whitespace — THE RESIDUAL: {len(bare_hits)}")
print("-" * 78)
if not bare_hits:
    print("  NONE. No product or option carries whitespace in any non-size-suffixed code field.")
else:
    for h in bare_hits:
        elig = ("ELIGIBLE" if h["productStatus"] == "Public"
                and (h["optionStatus"] in (None, "Primary")) else "not eligible")
        print(f"  [{elig:12}] {h['level']}.{h['field']} = '{vis(h['value'])}'")
        print(f"                 product {h['productId']} {h['product']!r} "
              f"(productStatus={h['productStatus']}, optionStatus={h['optionStatus']})")
print()

print("-" * 78)
print(f"B) Size-suffixed productOptions[].code carrying whitespace "
      f"(known, benign by construction): {len(suffixed_hits)}")
print("-" * 78)
if not suffixed_hits:
    print("  NONE.")
else:
    shown = {}
    for h in suffixed_hits:
        shown.setdefault(h["productId"], []).append(h)
    for pid, hits in sorted(shown.items()):
        h0 = hits[0]
        print(f"  product {pid} {h0['product']!r} (productStatus={h0['productStatus']}) — {len(hits)} option(s):")
        for h in hits:
            print(f"      '{vis(h['value'])}'  (optionStatus={h['optionStatus']})")
print()

print("=" * 78)
print("VERDICT")
print("=" * 78)
if not bare_hits:
    print("  ZERO bare-code whitespace in the entire catalogue.")
    print("  -> The populator's missing raw-concat containment is UNREACHABLE from the poller,")
    print("     not merely unexercised. Plan A closes fully: LATENT fragility, low-severity note")
    print("     for any FUTURE producer that raw-concats. No defect ticket.")
elif eligible_bare == 0:
    print(f"  {len(bare_hits)} bare-code whitespace hit(s) found, but NONE are poller-eligible")
    print("  (need productStatus=Public AND optionStatus=Primary). The poller will never emit them.")
    print("  -> Still latent, but no longer purely theoretical. Record the ids; re-check if any of")
    print("     those products is ever made eligible.")
else:
    print(f"  {eligible_bare} POLLER-ELIGIBLE bare-code whitespace hit(s) — see section A.")
    print("  -> The raw-concat path IS reachable in production. Escalate: this converts the")
    print("     populator containment gap from a latent note into a real defect. Confirm by")
    print("     checking whether these item_codes ever reached SCALE, then raise it.")
print()
PY

echo "" >&2
echo "Done. GET-only; nothing was written to Cin7, AWS or the watermark." >&2
