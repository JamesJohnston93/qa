# Result: Slice 06, wholesale mapping and the blocked remainder

**Ticket:** BUSY-1160
**Verdict:** TC2 written, not run: no wholesale record family is in use, MEASURED at full-history
strength by R14. TC1, TC1b, TC3, TC4 BLOCKED on Q35 (wholesale orders silently dropped before
reaching AWS, open with Kian). TC17 BLOCKED on a design gap (no discriminator between a retryable and
a permanent SCALE rejection) plus no waved shipment existing. **One real check ran, and it surfaced
more than the slice expected**: the 25-character `ShipTo` truncation lives entirely downstream, in
the Manhattan sender, not the poller -- settling P2 and clearing TC1b to run off the synthetic
harness with no wholesale order needed. But the same read found the sender never actually maps a
wholesale order's delivery company into `ShipTo` at all, only ever a person's name. **New question
raised: Q40, `BUSY-1065-OPEN-QUESTIONS.md`, CONFIRMED by source read, raisable with Kian.**

Read only. No AWS write of any kind this slice. Poller schedule stayed DISABLED, SO watermark stayed
UNSET -- unchanged, this slice does not touch either (W1c, the one thing in this thread that needs
them, runs from the RETEST plan, not here).

## TC2 -- written, not run

**Case:** compare records written for a wholesale order. **Expected:** outbound records only, no
native shipment rows.

**MEASURED, R14 (`../retests/RETEST-1158-1159/results/R14-wholesale-shape-and-bundling.md`), full-table
scans:** `orderType` has held exactly one value, `ECOM`, across the complete retained history of
both `staging-orders-v2` (90 of 13,054 header rows) and `staging-shipments` (88 of 30,802 header
rows). No table matching `outbound`/`transfer`/`wholesale`/`rtv`/`bt-` exists anywhere in the account
(137 tables swept). **Verdict: no wholesale record family is in use, because no wholesale order has
ever reached AWS.** Not restated in full here per the slice's own instruction -- R14's result file is
the citation.

Both wholesale drift rows would be marked "unresolved by the build" against this -- see the note
below on why there is now only one such row in `QA-DOC.md`.

## TC1, TC1b, TC3, TC4 -- BLOCKED, and the blocker changed

**Old blocker:** "a wholesale order in the polled window, population unmeasured." **New blocker, and
it is stronger:** wholesale orders are being silently dropped before they reach AWS at all, which is
Q35, open with Kian. There is nothing to hunt a fixture for -- R14 already proved the population is
empty at full-history strength, and the confound (stage vs type) is what W1c exists to separate, not
this slice.

Two things carried into these rows per the slice's own instruction:

* **Contact group is the only reliable order-type signal.** A company name in the shipping fields is
  not: R13's `#262210` looked wholesale by company name and resolved to genuine `Retail - Ecomm`. Any
  future case identifying a wholesale order by company name alone is testing nothing.
* **The `Approved` versus `Dispatched` asymmetry is the sharp end of Q38.** One cycle counted 4
  confirmed-wholesale `Approved` orders correctly in `skippedStages`; 43 confirmed-wholesale
  `Dispatched` orders produced no counter, no log line, no metric at all. Now `TRIED 2, negative`,
  raisable with Kian per the register.

## TC1b -- the one real check, and it found more than expected

**Question:** does the 25-character `ShipTo` truncation live in the poller (in which case TC1b stays
blocked behind the same wholesale-fixture wall as TC1/TC3/TC4) or downstream in the materialiser or
sender (in which case it runs off the synthetic harness with a long `deliveryCompany` and needs no
wholesale order at all -- P2, `PROPOSALS.md`)?

**Method.** Neither monorepo nor build access exists for this epic (Q10, assumed absent). A different
avenue was available: both functions are already deployed, and this account's `PowerUserAccess` role
can read a deployed Lambda's own code package directly via `aws lambda get-function` --
`Code.Location` returns a pre-signed, time-limited S3 URL to the exact artifact currently running in
staging. This is not source-repository access; it is inspecting an artifact already running under
credentials this plan already has. Checked `staging-orders-cin7-so-poller` and
`staging-shipping-manhattan-send-shipment` (both single-file esbuild/webpack bundles, matching the
`/var/task/index.js:NNNNN` stack traces seen in every error log this plan has read). **Promoted to
`~/Desktop/QA/wms/ctc/inspect-lambda-code.sh`** (downloads, greps, deletes the code
afterward, reusable across the epic -- Q29 needs the identical technique against a different
function), unreviewed; re-ran the same check through the saved script and confirmed it reproduced
the finding identically before trusting the promotion. Nothing kept beyond the short excerpts quoted
here and in `BUSY-1065-OPEN-QUESTIONS.md` Q40.

**MEASURED: truncation lives entirely in the sender.** `ShipTo` appears zero times in the poller's
bundle. The sender defines `SHIP_TO_MAX_LENGTH = 25` and a `truncateShipTo(customer)` function
(`console.warn` then `.slice(0, 25)`) called unconditionally from `serializeShipmentDownload` on
whatever ends up in `Customer.ShipTo`. **P2 settled: TC1b is downstream. It runs off the synthetic
harness and needs no wholesale order.** Per the slice's own instruction this is now a proposal to
move TC1b into slice 04's territory, not a case to run here.

**But `ShipTo` never reads the delivery company at all, in the currently deployed sender.** There is
exactly one construction site: `ShipTo: fullName(address)`, where `fullName` reads only
`address.firstName`/`address.lastName` and throws (`"refusing to send a shipment with an empty ShipTo
to SCALE"`) if both are empty. It never reads `address.company`. Separately confirmed in the poller:
`order.deliveryCompany` **is** carried through, as a conditional `addressChanges.shipping.company`
field -- so the data reaches the orders side under the exact name the sender's own schema already
expects (`company: { type: String, required: false }` sits beside `lastName` with a comment
acknowledging wholesale addresses don't require a first name) -- and then nothing downstream ever
reads it.

**This means TC1b as written cannot pass today, independent of the fixture problem.** Even a
synthetic `WHOLESALE` emit with a long `deliveryCompany` would not exercise "truncate the company
name" -- it would either throw the empty-`ShipTo` error (if the synthetic address carries no person
name, which is the realistic wholesale shape) or silently send a person's name instead (if one is
present), never the company. **Raised as Q40**, `BUSY-1065-OPEN-QUESTIONS.md`, `TRIED 1, CONFIRMED`
by source read -- full code excerpts there, not repeated a third time here. Recommended to Kian: is
this a known gap awaiting a follow-up PR, or does the intended mapping live somewhere this read did
not reach.

**Not run as a live emit this slice**, deliberately -- slice 06 is read-only, and TC1b's actual run
belongs wherever P2 sends it. This entry is the evidence that run would need, not a substitute for
running it.

## TC17 -- stays BLOCKED, unchanged by R14

Two independent blockers, the second the real one:

1. **No waved shipment exists.** All 79 CTC shipments in SCALE staging are `OPEN`; the DC team is not
   yet looking at Manhattan.
2. **No defined pass.** A retryable and a permanent rejection both arrive as an HTTP 200 carrying
   `rejectedTransactions > 0`, and nothing in the ticket or the LLD names a discriminator.
   BUSY-1159's AC8 treats that exact response as retryable and redrives it; this ticket's AC5 wants
   the same response classified permanent. Contradictory requirements against an identical
   observable. BUSY-1162 owns the taxonomy and is still To Do.

No workaround attempted, per the slice's own instruction -- a synthetic post-wave rejection would need
SCALE in a state this plan cannot put it in, and there is no agreed correct answer to compare against
even if it could. Recorded BLOCKED with both reasons; this is a design gap, so Lachlan rather than
Kian, and it is fair to raise since it is new, not a re-ask of anything already answered.

## Correction: "both wholesale drift rows" is stale

The slice's own write-results instruction says to update "both wholesale drift rows" in `QA-DOC.md`.
Checked: `QA-DOC.md`'s current Design Drift table (and its pre-cleanup predecessor,
`QA-DOC.md.pre-cleanup`) both carry exactly **one** wholesale-family drift row, already updated by the
previous session's wrap-up cleanup to read "Unresolved by the build." There were never two rows in
either the current or the immediately-prior version of the file -- this looks like leftover language
from an earlier draft of the slice, predating the 2026-09-08 QA-DOC cleanup pass. No second row exists
to update. Not treated as a stop condition; noted here so the next reader does not go looking for a
row that is not there.

## Stop and ask JJ

None of the three listed conditions were hit: the deployed system did not turn out to route wholesale
anywhere R14's scans would not have seen (R14's negative stands, nothing here contradicts it); nothing
in this slice touched the poller schedule or a watermark. **TC1b's truncation did turn out to be
downstream**, which the slice itself names as worth flagging rather than an alarming stop -- flagged
above, in `PROPOSALS.md` (P2, now settled) and in the new Q40. The finding underneath it (ShipTo never
reads delivery company) goes beyond what the slice asked for; raised as its own question rather than
folded silently into P2's close, since it changes what TC1b would show if it ran.

## Scripts written

`inspect-lambda-code.sh`, promoted straight to the tools root (`~/Desktop/QA/wms/ctc/`, row in
`../../SCRIPTS-INDEX.md`) rather than this ticket's own `scripts/`, since it is reusable across the
epic -- Q29 needs the identical technique against a different function. **Unreviewed**, review
deferred by design per the standing rule. Ran the underlying check inline once before saving it,
against CLAUDE.md's own rule; corrected and re-verified through the saved script afterward, see
`TOOL-NOTES.md`.

## Data handling

No customer data was read this slice -- everything above came from R14's own citations and two
Lambda code packages, which carry no order or customer data, only application logic. Code excerpts
quoted above and in Q40 are the minimum needed to support the finding, not full function dumps; both
downloaded packages were deleted after the check completed.
