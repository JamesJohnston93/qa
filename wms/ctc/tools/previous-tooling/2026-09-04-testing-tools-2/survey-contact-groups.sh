#!/usr/bin/env bash
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ CLEARED TO RUN — read-only against Cin7. GET-only, always: Cin7 is CTC's production      │
# │ system. Only ever add a plain `curl` GET (no -X, no -d/--data) if extending this script.  │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
#
# Distribution of contact `group` values across Cin7 contacts.
#
# Why this exists: order type is derived from the ordering customer's contact group, and the group
# decides the record family, the grain, the materialiser, the sender and the confirmation branch.
# The mapped literals were copied from a document that has already been caught wrong once
# ('Retail-Ecomm' against the real 'Retail - Ecomm'), and a wrong literal is a total, silent
# failure for that order type. One paged read gives every value actually in use, which is the only
# way to check the table rather than trust it.
#
# It also answers a narrower question cheaply: whether any contact is in a given group at all.
# Paging SalesOrders and resolving a contact per order cannot prove absence — this can.
#
# Usage:
#   ./survey-contact-groups.sh [--max-pages N] [--rows N] [--group GROUP] [--json]
#
#   --max-pages  pages of contacts to read (default 8, 250 per page)
#   --rows       contacts per page (default 250, Cin7's maximum)
#   --group      also list the contacts in this exact group, so one can be used as a fixture source
#   --json       emit the distribution as JSON instead of a table
#
# Example (what groups exist at all):   ./survey-contact-groups.sh
# Example (is anyone a Supplier):       ./survey-contact-groups.sh --group 'Supplier'
#
# Credentials come from .env beside this script, as with every Cin7-facing tool here.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIN7_BASE_URL="https://api.cin7.com"

MAX_PAGES=8
ROWS=250
GROUP=""
AS_JSON=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--max-pages) MAX_PAGES="$2"; shift 2 ;;
		--rows) ROWS="$2"; shift 2 ;;
		--group) GROUP="$2"; shift 2 ;;
		--json) AS_JSON=1; shift ;;
		--username) USERNAME="$2"; shift 2 ;;
		--api-key) API_KEY="$2"; shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -f "${HERE}/.env" ]]; then
	set -a; . "${HERE}/.env"; set +a
fi
USERNAME="${USERNAME:-${CIN7_USERNAME:-}}"
API_KEY="${API_KEY:-${CIN7_API_KEY:-}}"

if [[ -z "$USERNAME" || -z "$API_KEY" ]]; then
	echo "Cin7 credentials missing. Create a .env beside this script:" >&2
	echo "  CIN7_USERNAME=..." >&2
	echo "  CIN7_API_KEY=..." >&2
	exit 1
fi

# Single GET with one 429 retry, mirroring the connector's rate-limit handling.
cin7_get() {
	local path_and_query="$1"
	local attempt=1
	while true; do
		local response status body
		response=$(curl -s -w '\n%{http_code}' \
			-u "${USERNAME}:${API_KEY}" \
			-H "Accept: application/json" \
			"${CIN7_BASE_URL}${path_and_query}")
		status=$(echo "$response" | tail -n1)
		body=$(echo "$response" | sed '$d')

		if [[ "$status" == "429" && $attempt -eq 1 ]]; then
			echo "Rate limited by Cin7 — waiting 1s and retrying once..." >&2
			sleep 1
			attempt=2
			continue
		fi
		if [[ "$status" != "200" ]]; then
			echo "Cin7 returned ${status} for ${path_and_query}" >&2
			echo "$body" >&2
			return 1
		fi
		echo "$body"
		return 0
	done
}

ALL="${TMPDIR:-/tmp}/cin7-contact-groups.$$.json"
trap 'rm -f "$ALL"' EXIT
echo '[]' > "$ALL"

page=1
total=0
while (( page <= MAX_PAGES )); do
	echo "Reading contacts page ${page}/${MAX_PAGES}..." >&2
	BODY=$(cin7_get "/api/v1/Contacts?page=${page}&rows=${ROWS}") || exit 1
	COUNT=$(BODY="$BODY" ALL="$ALL" python3 -c "
import json, os
body = json.loads(os.environ['BODY'])
rows = body if isinstance(body, list) else body.get('contacts', body.get('Contacts', []))
existing = json.load(open(os.environ['ALL']))
existing.extend(rows)
json.dump(existing, open(os.environ['ALL'], 'w'))
print(len(rows))
")
	total=$(( total + COUNT ))
	# Cin7 pages are full until the last one, so a short page is the end of the data.
	if (( COUNT < ROWS )); then break; fi
	page=$(( page + 1 ))
done

GROUP="$GROUP" AS_JSON="$AS_JSON" TOTAL="$total" ALL="$ALL" python3 <<'PY'
import collections, json, os

contacts = json.load(open(os.environ['ALL']))
wanted = os.environ['GROUP']
counts = collections.Counter((c.get('group') or '(none)') for c in contacts)

# The literals the code maps. Anything in Cin7 outside this set reaches a mapped order type only
# by accident, and anything here missing from Cin7 is a mapping that can never fire.
MAPPED = {
    'Retail - Ecomm': 'ECOM',
    'Distributor': 'WHOLESALE',
    'Promo': 'WHOLESALE',
    'Retailer - Domestic': 'WHOLESALE',
    'Retailer - International': 'WHOLESALE',
    'Retailer - Majors': 'WHOLESALE',
    'Sales Reps': 'WHOLESALE',
    'Staff': 'WHOLESALE',
    'Supplier': 'RTV',
    'Retail - Shop': 'skipped (POS)',
}

if os.environ['AS_JSON'] == '1':
    print(json.dumps({'contacts': len(contacts), 'groups': counts.most_common()}, indent=2))
else:
    print(f"\n{len(contacts)} contacts read\n")
    print(f"{'group':<30} {'count':>6}  maps to")
    print('-' * 62)
    for group, n in counts.most_common():
        print(f"{group:<30} {n:>6}  {MAPPED.get(group, '** UNMAPPED — permanent error **')}")

    missing = [g for g in MAPPED if g not in counts]
    if missing:
        print("\nMapped in code but absent from every contact read:")
        for g in missing:
            print(f"  {g:<30} -> {MAPPED[g]}")
        print("An absent group is a mapping that can never fire. Either the literal is wrong, or")
        print("no contact is in that group — those need different answers, so check before assuming.")

if wanted:
    hits = [c for c in contacts if (c.get('group') or '') == wanted]
    print(f"\nContacts in group {wanted!r}: {len(hits)}")
    for c in hits[:15]:
        name = c.get('company') or f"{c.get('firstName','')} {c.get('lastName','')}".strip()
        print(f"  id={c.get('id')}  {name}")
    if len(hits) > 15:
        print(f"  … and {len(hits) - 15} more")
PY
