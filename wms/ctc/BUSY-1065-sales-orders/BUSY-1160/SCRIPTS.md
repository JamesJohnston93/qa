# BUSY-1160 scripts

Scripts written during this ticket's testing. Ticket specific ones live in `scripts/` beside this file. Anything that turns out to be useful to another ticket gets promoted to `../../tools/` and moved to `../../tools/SCRIPTS-INDEX.md`.

**Check this file and the root index before writing anything new.** The shared toolset already covers most of this, and BUSY-1158, BUSY-1159 and RETEST-1158-1159 each have their own `SCRIPTS.md`.

| Script | TC | Purpose | What it does NOT check | Read only | Reviewed by |
|---|---|---|---|---|---|
| `check-cin7-order-handler-deploy.sh` | Slice 01 Gate A | `LastModified` for the poller, update/cancel reconciliation handlers, their eda-queue pairs and list-orders against an expected deploy date | Correctness of the deployed code, only that it deployed on the expected date | yes | not yet |
| `check-cin7-log-recency.sh` | Slice 01 Gate A | Last log event per handler log group, so a silent handler is told apart from one never invoked | Why a log group is silent, e.g. schedule/watermark state | yes | not yet |
| `check-bus-routing-contract.sh` | Slice 01 Gate B | Every rule's event pattern and target list on a given event bus, verbatim | Whether the target Lambda does its own validation beyond what the rule pattern filters on | yes | not yet |
| `emit-synthetic-outbound-order.sh` | TC2, TC3, Q40 (slice 08 Part 3) | Constructs and (optionally) emits the poller's real `CREATE_OUTBOUND_ORDER` transaction shape (`outboundOrderInfo`/`outboundItemInfo`/`category:"OUTBOUND"`) for a WHOLESALE/RTV order, seeded from a real ECOM order for shape only. Supports `--delivery-company`, `--warehouse` override, `--multi-size` (two size rows sharing one lineId) | Whether the poller itself would ever construct WHOLESALE/RTV input from real Cin7 data (Q35/TC4, upstream). Does not replicate the real hash algorithms. Cannot construct the empty-ShipTo refusal case, since that guard fires inside the poller before any transaction exists | no, writes to `staging-orders-v2-event-bus` when `--emit` is passed, reaching Manhattan SCALE staging via a dedicated outbound sender | not yet |
| `emit-synthetic-revision.sh` | TC12, foundation for slices 04/05 | Seeds from a real persisted CTC order (or an existing `QASYN-` order, for a revision), constructs an EventBridge `CREATE_TRANSACTION` entry matching the poller's own measured shape, and either prints it (`--dry-run`, default) or emits it (`--emit`). Hard-refuses `--emit` under a non-`QASYN-` `--out-reference`, independent of every other flag | Whether a mutation-carrying emit produces a correct downstream result, only that it is constructed and routed the way the poller's real emit is measured to be. Does not replicate the real payload-hash algorithm. Does not recompute financial totals for a line mutation | no, writes to `staging-orders-v2-event-bus` when `--emit` is passed, reaching Manhattan SCALE staging | not yet |

## Built, 2026-09-08, slice 03

`scripts/emit-synthetic-revision.sh` is built and used (TC12). See
`results/03-synthetic-harness-and-fidelity.md` for the fidelity gate, the two bugs it caught, and
the correction to slice 01's routing description that building it turned up. No longer planned.

## Fixed, 2026-09-09, slice 08

`scripts/emit-synthetic-revision.sh`'s self-revise item construction no longer copies a persisted
`CANCELLED` item status through into `itemChanges.added[].status` (mapped to `OPEN` instead, since
`CANCELLED` is a local-only flip the shared handler's schema never accepts and Cin7 never reports).
Found while running TC18 Form B against the already-cancelled `QASYN-09-TC15`. See `TOOL-NOTES.md`.

## Built, 2026-09-09, slice 08

`scripts/emit-synthetic-outbound-order.sh` -- built after Part 1b found the poller routes WHOLESALE/
RTV through a dedicated `CREATE_OUTBOUND_ORDER` path, entirely separate from `emit-synthetic-
revision.sh`'s `CREATE_ORDER` shape. Verified against the real schema before first use, then verified
by two real emits with materially different, fully-attributed outcomes (Manhattan rejection on an
invalid warehouse code; full acceptance on a valid one). See `results/08-final-sweep-before-dev.md`.

## Extended, 2026-09-08, slice 05

`scripts/emit-synthetic-revision.sh` gained `--source-stage <value>`, overriding only
`orderInfo.sourceStage` on the constructed payload (every other mutation still passes it through
from the seed unchanged). Needed for TC16 (comparing a `Dispatched` revision against one claiming
another stage) and Q30's picked-stage arm, neither of which the harness could construct before.
See `TOOL-NOTES.md`.

## Promoted to the shared toolset, 2026-09-09, slice 06

`inspect-lambda-code.sh` -- downloads a deployed Lambda's own code package and greps it for search
terms, then deletes the download. Used for TC1b/Q40 (where the 25-char `ShipTo` truncation and the
delivery-company mapping live). Reusable beyond this ticket (Q29 needs the same technique against a
different function), so it went straight to `~/Desktop/QA/wms/ctc/inspect-lambda-code.sh` and
`../../tools/SCRIPTS-INDEX.md` rather than living here. See `TOOL-NOTES.md` for a process note: it was run
inline once before being saved, against CLAUDE.md's own rule, and re-verified through the saved
script afterward.

**Reused unchanged, slice 07** (Q30's poller source read). No changes needed; confirms the tool
generalises past the one function it was built for.

**Reused unchanged again, slice 02** (TC22's `taxStatus` mapping, same poller function slice 07
already partly read). Third use, no changes needed.

## Notes

A row here is not a claim that the script is correct. The Reviewed column is the only thing that says a human has read it. Until that column is filled, a passing run proves the script ran, not that the system behaved.

**Review is deferred by design.** JJ's call: nothing here gets a second reader until the bulk of testing is done. These scripts exist to be re-used when a case has to be revisited, not to be signed off one at a time. An empty Reviewed column is the expected state, not an open item, and no session should chase one or hold a verdict waiting for it. Keep stating the caveat in result files anyway, since it is what stops a green run being over read.

An emitting script carries one extra obligation over a read-only one: its `Does NOT` header line must say that a clean run proves the handler behaved given that input, not that the input occurs in real traffic.
