#!/usr/bin/env bash
# Probes E and F — is a persisted per-(lineItemId, sku) ordinal needed, or can the fractional
# discriminator be assigned at map time from the document's own sorted sku set?
#
# Every line-affecting send restates the shipment's complete line set: SEND_SHIPMENT sends every
# unit, SEND_SHIPMENT_LINES sends every survivor plus a DELETE per pair that lost all its units,
# and SEND_SHIPMENT_ADDRESS sends no details at all. Under full restatement the line number is a
# slot index within one document rather than an identity that has to survive between sends, so it
# could be derived from persisted rows (survivors plus REMOVED ones) with no new state — which
# removes a schema change and a cross-ticket reach into the create path.
#
# Probe B already proved the half that makes that work: a later SAVE reusing a line number
# replaces the line, item and quantity both. So a reshuffled numbering self-corrects, because
# everything is restated. Two things are unproven, and this tool settles them:
#
#   E — does DELETE work on a real slot, and is a DELETE for a slot SCALE does not hold
#       tolerated or rejected? Map-time numbering emits empty-slot DELETEs routinely, so a
#       rejection kills the approach outright. E2 also tests today's buildRemovedDetails, which
#       has never been exercised against SCALE.
#
#   F — does the whole scheme converge on the hardest shape: a revision that removes a size,
#       adds one sorting ahead of the survivors, and so renumbers every slot at once?
#
# ANSWERED 28 Aug 2026. E2 accepted and removed only its own slot, so a detail DELETE works and
# honours the fraction. E3 was REJECTED — "The Shipment ID and ERP Order Line Num specified does
# not correspond to any existing Shipment Detail" — so a DELETE must name a slot SCALE holds, and
# map-time numbering is dead: the number must be persisted per (lineItemId, sku). F2 showed that
# rejection is atomic, discarding two valid SAVEs travelling with one bad DELETE.
#
# Probe G is the follow-up, and it is deploy-blocking rather than design-blocking:
#
#   G — shipments already in SCALE carry BARE INTEGER line numbers, because that is what the
#       sender emits today. SCALE stores them in a decimal(19,5) column, so 3477826 is held as
#       3477826.00000. Nothing has proven that a *sent* "3477826.00000" addresses that same slot.
#       If it does, the first sku on each line takes ordinal 0 and every pre-existing line keeps
#       its slot untouched. If it does not, every live shipment gains a duplicate line on its
#       first post-deploy update, with the original orphaned and no DELETE emitted to clean it up
#       (our rows are not REMOVED, so nothing would even try).
#
#       G2 reads the answer out of the RESPONSE rather than out of SCALE, by using E3's rejection
#       as an oracle: a DELETE naming an unheld slot is rejected loudly, so if DELETE .00000
#       succeeds against a line saved as a bare integer, they are the same slot.
#
# Probe H — 28 Aug 2026, NOT YET RUN. Is ErpOrderLineNum required at all?
#
# Everything above assumes the middleware must supply the number. Nothing has tested omitting it.
# If SCALE accepts a detail with no ErpOrderLineNum and keys the line on SKU.Item instead, detail
# identity is (shipment, item) — which is what LLD §5 claimed all along, reached by omission rather
# than by pairing — and the persisted ordinal, its eight copy sites, the decimal-string wire format
# and the cross-ticket reach into the create path are all unnecessary.
#
# Accepting the FIRST document proves almost nothing: SCALE keys identity on ErpOrderLineNum, so
# with none supplied an upsert has nothing to match on. h2 is the step that decides, and h3 exists
# because an upsert that holds for one revision and appends on the next is the worst possible thing
# to discover after building on it.
#
#   h1 — is the element optional in the XSD? Probe C proved a schema violation is loud.
#   h2 — THE QUESTION: does a re-send update the two lines, or append two more?
#   h3 — does it still hold on a third document?
#   h4 — can a line be DELETEd by SKU.Item alone, with no number to name?
#
# Record what line numbers SCALE assigns itself — the response carries only four fields, so that is
# a manual read in SCALE. If they come back 1, 2, 3 it also settles whether the column tolerates
# small integers operationally, which is the open half of OQ-1160-10.
#
# The header is byte-identical across every document below and every SKU is a real size of a style
# SCALE has already accepted. Only the detail block changes, so a rejection is attributable to
# the details and nothing else.
#
# Usage:
#   ./probe-line-number-slots.sh --step <e1|e2|e3|f1|f2|g1|g2|g3|h1|h2|h3|h4> [--stage <stage> --profile <profile>] [--send]
#
#   --step   which document to build (see the table below)
#   --send   hand the document to probe-manhattan.sh --send. Requires --stage and --profile.
#            Without it the document is printed and nothing leaves the machine.
#
# Run the steps in order and read SCALE between them — each depends on the state the previous
# one left, and the answer is what SCALE holds afterwards, not only what it replies.
#
# ┌──────────────────────────────────────────────────────────────────────────────────────────┐
# │ `--send` REACHES A REAL SCALE and creates/modifies shipments 260006-260010. Agree the     │
# │ shipment ids are free before running — a collision silently probes someone else's         │
# │ shipment. Everything sent is echoed by probe-manhattan.sh.                                │
# └──────────────────────────────────────────────────────────────────────────────────────────┘
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STEP=""
STAGE=""
PROFILE=""
REGION="ap-southeast-2"
SEND="false"

# Overridable so a rerun after a spoiled attempt does not reuse dirty state — SCALE keeps
# whatever the previous run left, and probes E and F both start from a two-line seed.
SHIPMENT_E="${SHIPMENT_E:-260006}"
SHIPMENT_F="${SHIPMENT_F:-260007}"
SHIPMENT_G1="${SHIPMENT_G1:-260008}"
SHIPMENT_G2="${SHIPMENT_G2:-260009}"
# Probe H runs as one four-step sequence on a single shipment.
SHIPMENT_H="${SHIPMENT_H:-260010}"

# One Cin7 style line id, and four real sizes of it. -10 and -12 are the pair probes A, B and D
# used, so SCALE is known to accept them; -14 and -8 appear in the same fixtures.
LINE_ID="3477826"
SKU_08="WTA26-225C-8"
SKU_10="WTA26-225C-10"
SKU_12="WTA26-225C-12"
SKU_14="WTA26-225C-14"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--step) STEP="$2"; shift 2 ;;
		--stage) STAGE="$2"; shift 2 ;;
		--profile) PROFILE="$2"; shift 2 ;;
		--region) REGION="$2"; shift 2 ;;
		--send) SEND="true"; shift ;;
		-h|--help) sed -n '2,84p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ -z "$STEP" ]]; then
	echo "Usage: $0 --step <e1|e2|e3|f1|f2|g1|g2|g3|h1|h2|h3|h4> [--stage <stage> --profile <profile>] [--send]" >&2
	exit 1
fi

if [[ "$SEND" == "true" && ( -z "$STAGE" || -z "$PROFILE" ) ]]; then
	echo "--send needs --stage and --profile." >&2
	exit 1
fi

# A detail block. `num` travels as a literal string, never through a shell or Python float —
# 3477826.00001 has no exact double representation and the trailing digits are the whole point.
detail() {
	local action="$1" num="$2" item="$3" qty="$4"
	printf '<ShipmentDetail><Action>%s</Action><ErpOrderLineNum>%s</ErpOrderLineNum>' "$action" "$num"
	printf '<SKU><Item>%s</Item><Quantity>%s</Quantity><QuantityUm>EA</QuantityUm></SKU></ShipmentDetail>' "$item" "$qty"
}

# The same block with ErpOrderLineNum omitted entirely — probe H. FIELD_ORDER is a real
# xs:sequence, so a missing middle element is legal only if the schema declares it minOccurs=0;
# if it does not, SCALE answers with a schema violation naming the element.
detail_no_num() {
	local action="$1" item="$2" qty="$3"
	printf '<ShipmentDetail><Action>%s</Action>' "$action"
	printf '<SKU><Item>%s</Item><Quantity>%s</Quantity><QuantityUm>EA</QuantityUm></SKU></ShipmentDetail>' "$item" "$qty"
}

# Element order follows FIELD_ORDER in libs/manhattan/src/mapper/shipment-download-serializer.ts
# — the real xs:sequence, not alphabetical. `Details` sorts mid-Shipment alphabetically but the
# schema appends it last. Header values mirror buildHeaderAndCustomer's ECOM output so the only
# thing that differs from a document the pipeline itself would send is the detail block.
document() {
	local shipment_id="$1" details="$2"
	cat <<XML
<WMWROOT xsi:schemaLocation="http://www.manh.com/ILSNET/Interface ShippingDownload.xsd" xmlns="http://www.manh.com/ILSNET/Interface" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><WMWDATA><Shipments><Shipment><Action>SAVE</Action><UserDef3>THRILLS</UserDef3><AllocateComplete>Y</AllocateComplete><ConsolidationAllowed>N</ConsolidationAllowed><Customer><Company>CTC</Company><ShipTo>Probe Slots</ShipTo><ShipToAddress><Address1>1 Probe Street</Address1><City>Southport</City><Country>AU</Country><Name>Probe Slots</Name><PostalCode>4215</PostalCode><State>QLD</State></ShipToAddress></Customer><ErpOrder>${shipment_id}</ErpOrder><OrderDate>2026-08-28T00:00:00.000Z</OrderDate><OrderType>ECOM</OrderType><Priority>5</Priority><ScheduledShipDate>2026-08-31T00:00:00Z</ScheduledShipDate><ShipmentId>${shipment_id}</ShipmentId><Warehouse>CTC-QDC</Warehouse><Details>${details}</Details></Shipment></Shipments></WMWDATA></WMWROOT>
XML
}

case "$STEP" in
	# ── E: the DELETE primitive, on shipment 260006 ──────────────────────────────────────────
	e1)
		WHAT="seed — two sizes of one style, distinguished only by the fraction"
		EXPECT="accepted=1. SCALE holds two lines: ${SKU_10} qty 2 at .00001, ${SKU_12} qty 3 at .00002.
If this alone fails, stop — probe D's result did not reproduce and nothing below is interpretable."
		DOC=$(document "$SHIPMENT_E" "$(detail SAVE "${LINE_ID}.00001" "$SKU_10" 2)$(detail SAVE "${LINE_ID}.00002" "$SKU_12" 3)")
		;;
	e2)
		WHAT="DELETE a slot SCALE really holds — does DELETE work at all?"
		EXPECT="accepted=1, and ${SKU_12} gone from SCALE, ${SKU_10} qty 2 untouched.
A rejection here, or a line that survives its own DELETE, means buildRemovedDetails does not work
today either — a bigger finding than the numbering question, and it blocks both approaches."
		DOC=$(document "$SHIPMENT_E" "$(detail DELETE "${LINE_ID}.00002" "$SKU_12" 0)")
		;;
	e3)
		WHAT="THE QUESTION — DELETE a slot that never existed, alone in its document"
		EXPECT="Tolerated: accepted=1 (or accepted=1 with a benign message), ${SKU_10} still qty 2.
  -> map-time numbering is viable; no persisted ordinal, no schema change.
Rejected: accepted=0 with a message naming the line number.
  -> every DELETE must target a real slot, so the number must be persisted per (lineItemId, sku).
Watch for a third outcome: accepted=1 but ${SKU_10} also gone. That would mean the DELETE aliased
onto a line it does not name, and is worse than either — persist the ordinal and say so loudly."
		DOC=$(document "$SHIPMENT_E" "$(detail DELETE "${LINE_ID}.00009" "$SKU_14" 0)")
		;;

	# ── F: the whole scheme, on shipment 260007 ──────────────────────────────────────────────
	f1)
		WHAT="seed for the renumbering case — sizes -12 and -14"
		EXPECT="accepted=1. SCALE holds ${SKU_12} qty 2 at .00001 and ${SKU_14} qty 3 at .00002."
		DOC=$(document "$SHIPMENT_F" "$(detail SAVE "${LINE_ID}.00001" "$SKU_12" 2)$(detail SAVE "${LINE_ID}.00002" "$SKU_14" 3)")
		;;
	f2)
		WHAT="the revision that renumbers every slot at once"
		EXPECT="This is the shape map-time numbering actually emits. ${SKU_14} is removed and ${SKU_10} is
added; sorted over every sku ever seen on the line — ${SKU_10}, ${SKU_12}, ${SKU_14} — every slot
moves. SCALE holds .00001=${SKU_12}, .00002=${SKU_14}; the document says .00001=${SKU_10},
.00002=${SKU_12}, DELETE .00003=${SKU_14} (a slot that was never created).

Converged: accepted=1 and SCALE holds exactly two lines, ${SKU_10} qty 1 and ${SKU_12} qty 2, no
${SKU_14}. -14 disappears because its slot was overwritten by -12, not because the DELETE landed.
  -> renumbering is harmless under full restatement; the scheme holds on its hardest shape.
Anything else — a surviving -14, a wrong quantity, three lines, a rejection — is a fail, and the
persisted ordinal is the answer."
		DOC=$(document "$SHIPMENT_F" "$(detail SAVE "${LINE_ID}.00001" "$SKU_10" 1)$(detail SAVE "${LINE_ID}.00002" "$SKU_12" 2)$(detail DELETE "${LINE_ID}.00003" "$SKU_14" 0)")
		;;
	# ── G: does .00000 address a slot saved as a bare integer? ───────────────────────────────
	g1)
		WHAT="seed in TODAY'S format — a bare integer line number, exactly what the sender emits now"
		EXPECT="accepted=1. SCALE holds one line, ${SKU_10} qty 2, at line number ${LINE_ID}.
This stands in for every shipment already live in SCALE at the moment the ordinal ships."
		DOC=$(document "$SHIPMENT_G1" "$(detail SAVE "${LINE_ID}" "$SKU_10" 2)")
		;;
	g2)
		WHAT="THE QUESTION — DELETE .00000 against a line saved as a bare integer"
		EXPECT="The answer is in the RESPONSE, not in SCALE — E3 proved a DELETE naming an unheld slot is
rejected loudly, so DELETE is a clean oracle here and needs no manual check.

accepted=1  -> ${LINE_ID}.00000 IS the slot ${LINE_ID} was saved to. Pre-existing lines are
               addressable, so the first sku on each line takes ordinal 0 and migration is a no-op
               for every single-size line already in SCALE. Confirm with g3.
accepted=0, 'does not correspond to any existing Shipment Detail'
            -> they are DIFFERENT slots. Every live shipment would gain a duplicate line on its
               first post-deploy update, and the orphan is unreachable because our rows are not
               REMOVED so no DELETE is ever emitted for it. Migration needs its own plan — most
               likely a one-off reconciliation sweep, not just a numbering choice."
		DOC=$(document "$SHIPMENT_G1" "$(detail DELETE "${LINE_ID}.00000" "$SKU_10" 0)")
		;;
	g3)
		WHAT="migration rehearsal — a pre-deploy line, then the shape the new code would send"
		EXPECT="Run only if g2 was accepted; it confirms the whole migration end to end rather than the
primitive. Send g3 against a SECOND shipment seeded by hand first:

  1. seed it exactly as g1 does, but with SHIPMENT_G1=${SHIPMENT_G2} — a bare-integer line,
     ${SKU_10} qty 2, standing in for a live pre-deploy shipment
  2. then run this step, which is what the new sender emits once ${SKU_12} is added: ordinal 0 for
     the sku that was already there, ordinal 1 for the new one

accepted=1 and SCALE holds EXACTLY TWO lines — ${SKU_10} qty 2 and ${SKU_12} qty 3 — means the
pre-existing line was updated in place rather than duplicated, and the migration is clean.
Three lines, or ${SKU_10} appearing twice, means .00000 minted a new slot alongside the integer one
and g2's reading was wrong."
		DOC=$(document "$SHIPMENT_G2" "$(detail SAVE "${LINE_ID}.00000" "$SKU_10" 2)$(detail SAVE "${LINE_ID}.00001" "$SKU_12" 3)")
		;;
	# ── H: is ErpOrderLineNum required at all? One sequence on shipment 260010 ───────────────
	h1)
		WHAT="is ErpOrderLineNum optional — two sizes of one style, no line number on either detail"
		EXPECT="Rejected, 'XML Schema Validation failed' naming ErpOrderLineNum -> the element is mandatory.
  Probe H is closed here, at no cost, and the persisted ordinal stands. Do not run h2-h4.
accepted=1, TWO lines in SCALE (${SKU_10} qty 2, ${SKU_12} qty 3) -> the element is optional and
  SCALE assigned its own numbers. Continue to h2, and RECORD WHAT NUMBERS IT CHOSE — the response
  carries only four fields, so read them in SCALE. If they are 1 and 2, small integers are
  operationally acceptable in that column, which is the open half of OQ-1160-10.
accepted=1, ONE line -> both details defaulted to the same implicit number and collapsed, which is
  probe A's silent drop reached a different way. Closed; record it as a second instance."
		DOC=$(document "$SHIPMENT_H" "$(detail_no_num SAVE "$SKU_10" 2)$(detail_no_num SAVE "$SKU_12" 3)")
		;;
	h2)
		WHAT="THE QUESTION — re-send both details with changed quantities, still no line number"
		EXPECT="Run only if h1 held two lines. Quantities are 5 and 7, values no earlier probe used, so a stale
read cannot be mistaken for a fresh one.

TWO lines, ${SKU_10} qty 5 and ${SKU_12} qty 7 -> SCALE upserts on SKU.Item. Detail identity is
  (shipment, item), LLD §5 is right after all, and the persisted ordinal, the eight copy sites, the
  decimal-string format and the create-path reach are all unnecessary. Do not act on this before h3.
FOUR lines -> blind append. WORSE than today: silent duplicate lines instead of silent dropped ones.
  Closed; the persisted ordinal stands.
Rejected -> read the message. 'Cannot modify more than one line with erp order line num X in a
  single transaction' means both details defaulted to the same number, so omission cannot express a
  multi-size line at all. Also closed."
		DOC=$(document "$SHIPMENT_H" "$(detail_no_num SAVE "$SKU_10" 5)$(detail_no_num SAVE "$SKU_12" 7)")
		;;
	h3)
		WHAT="does the upsert still hold on a third document — the same detail set again, unchanged"
		EXPECT="Run only if h2 upserted. Byte-identical to h2 on purpose: an upsert that holds for one revision
and appends on the next is the worst thing to discover after building on it, and our sends restate
the full line set on every revision.

Still exactly TWO lines at qty 5 and 7 -> the upsert is idempotent. Only now is h2's reading safe.
Any growth in line count -> not idempotent, and the scheme is dead however h2 read."
		DOC=$(document "$SHIPMENT_H" "$(detail_no_num SAVE "$SKU_10" 5)$(detail_no_num SAVE "$SKU_12" 7)")
		;;
	h4)
		WHAT="can a line be DELETEd by SKU.Item alone, with no number to name?"
		EXPECT="Run only if h3 held. This is the half that actually decides the ticket: h2 settles SAVE, and E3
plus F2 already proved a DELETE we cannot express atomically rejects every valid SAVE travelling
with it.

accepted=1, ${SKU_12} gone and ${SKU_10} qty 5 untouched -> removal needs no line number either.
  Slices 06-09 are unnecessary in full.
Rejected -> removal needs the number SCALE assigned, which we never learn (the response carries no
  line numbers and there is no read-back path). Even with h2 upserting, a line removal is
  inexpressible, so the persisted ordinal stands for the DELETE path and therefore for both.
accepted=1 but BOTH lines gone -> the DELETE aliased onto the whole style line rather than one item.
  Worse than either outcome; record it loudly and stop."
		DOC=$(document "$SHIPMENT_H" "$(detail_no_num DELETE "$SKU_12" 0)")
		;;
	*)
		echo "Unknown step: $STEP (expected one of e1 e2 e3 f1 f2 g1 g2 g3 h1 h2 h3 h4)" >&2
		exit 1
		;;
esac

echo "=== step ${STEP}: ${WHAT} ==="
echo
echo "--- what to look for ---"
echo "$EXPECT"
echo

if [[ "$SEND" != "true" ]]; then
	echo "--- document (not sent) ---"
	echo "$DOC"
	echo
	echo "Pass --send --stage <stage> --profile <profile> to POST it."
	exit 0
fi

printf '%s' "$DOC" | "${HERE}/probe-manhattan.sh" \
	--stage "$STAGE" --profile "$PROFILE" --region "$REGION" --file - --send
