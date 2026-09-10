# Result: Slice 03, synthetic injection harness and fidelity gate

**Ticket:** BUSY-1160
**Verdict:** Harness built (`scripts/emit-synthetic-revision.sh`, **unreviewed**). Gate A PASSES, with
one named, explained exception (the payload-hash algorithm is not replicated). Gate B / **TC12
PASSES**, all three sub-cases MEASURED with a strong named attribution instrument found on the
reconciliation handler itself. Poller schedule stayed DISABLED and the SO watermark stayed UNSET
throughout; nothing in this slice touched either. One synthetic order created and registered,
`QASYN-01-TC12`, reference `9d37be2e-2381-4f43-b838-08058cefd72b`.

**Two process incidents this session, both corrected in-session, neither reaching a written file
or affecting the verdict below:**
1. Two PII-print mistakes while reading the seed order (a top-level-only redactor missed a nested
   `addressChanges.shipping` object). See `TOOL-NOTES.md`.
2. The harness's first real emit was accepted onto the bus but then rejected 20 times by the
   handler with a type error, dead-lettering a poison message into the existing
   `staging-orders-v2-dlq.fifo`. Root cause, fix and verification below and in `TOOL-NOTES.md`.

## Part 1, the harness

`scripts/emit-synthetic-revision.sh`. Reads a seed order's current persisted rows from
`staging-orders-v2` (`origin_index`), constructs an EventBridge entry matching the poller's own
measured shape, and either prints it (`--dry-run`, the default) or calls `events:put-events`
(`--emit`). Hard-refuses to `--emit` unless `--out-reference` starts with `QASYN-`, independent of
every other flag.

**Before building it, read `SCRIPTS.md` and `../../SCRIPTS-INDEX.md`** per CLAUDE.md's rule: no
existing script constructs or emits an EventBridge entry from a seed record. `putevents-vs-populator.sh`
(BUSY-1159) compares counts after the fact; nothing builds one.

### The routing contract is two stages, not one -- corrects a gap in slice 01's own Gate B

Slice 01's Gate B recorded routing for `TRANS_UPDATE_ORDER` and `TRANS_CANCEL_ORDER`, the domain
events a *later* stage re-emits. It did not record what the poller itself actually puts on the bus,
because nothing had ever needed to. This slice needed exactly that, to build a faithful harness, and
found it directly from a real log line rather than assuming CLAUDE.md's shared-populator description
covered it (it does, just for a different hop):

**MEASURED**, from `/aws/lambda/staging-orders-cin7-so-poller`'s real "Pushed ... to EventBridge" line
for order `#262208` (`RequestId f624e53d`, 2026-09-07): the poller's own `PutEvents` call carries
`Source: "orders-cin7.cin7-so-poller.lambda"`, `DetailType: "CREATE_TRANSACTION"`,
`EventBusName: "staging-orders-v2-event-bus"`. This routes (MEASURED, `events:list-targets-by-rule`)
to `staging-orders-v2-eda-queue-populator` -- the **shared** populator, exactly as CLAUDE.md's
original description said, and exactly the function slice 01's result file wrongly said was
corrected away. That populator forwards to `staging-orders-v2-eda-queue-handler`, the shared
transaction-chain handler, which persists the `TRANSACTION` audit row, enforces idempotency, applies
the version guard, and **re-emits** a second, domain-specific event
(`TRANS_CREATE_ORDER`/`TRANS_UPDATE_ORDER`/`TRANS_CANCEL_ORDER`) that routes to the cin7-specific
populator slice 01 measured. **Both descriptions were correct all along, about two different hops.**
Slice 01's "correction" conflated them. `../../BUSY-1160/STATE.md` and
`results/01-deployment-gate.md` should be read with this in mind; not rewritten this session, since
slice 01 is closed and this note is the correction on record.

This is exactly the class of gap Gate A exists to catch: had the harness been built to inject
directly at `TRANS_UPDATE_ORDER` (skipping the shared transaction chain), every later case would
have bypassed the idempotency_index and the TRANSACTION audit trail entirely, and would not have
been "what the poller actually emits" in any sense. The harness emits `CREATE_TRANSACTION` from the
same `Source` the poller uses, for all three event types (`CREATE_ORDER`/`UPDATE_ORDER`/`CANCEL_ORDER`
travel in `Detail.event`, not `DetailType`) -- INFERRED for update/cancel specifically (no real
emit of either exists yet to measure directly), but well supported: it matches CLAUDE.md's own prose
("emits one CREATE_TRANSACTION -- CREATE_ORDER when absent, UPDATE_ORDER when present, CANCEL_ORDER
when no longer eligible") and no rule on the bus lists a `CANCEL_TRANSACTION` detail-type at all,
which a truly per-verb `DetailType` scheme would need.

### Two bugs the fidelity gate caught before they reached slices 04/05

**Bug 1, item SK leakage.** The first draft copied a template item's real `SK` verbatim into a
freshly-seeded synthetic order, so a `QASYN-` order would have carried the same `ITEM#<uuid>` key as
the real order it borrowed shape from. Caught on inspection of the first dry run, before anything was
emitted. Fixed: template mode (out-reference != seed-reference) always mints a fresh item `SK`.

**Bug 2, payment field types, the one that actually reached the bus.** MEASURED, from the real
Pushed line: `Detail.paymentChanges.shipping/subtotal/grandTotal/taxPaid` and
`Detail.orderInfo.cin7Id` are **numbers**. The persisted `ORDER` row stores every one of them as a
DynamoDB string attribute. The harness's first version passed the persisted string values straight
through for these five fields (it *did* convert the equivalent `itemChanges` fields to numbers
correctly, just not these). The first `--emit` for `QASYN-01-TC12` was accepted by EventBridge
(`FailedEntryCount: 0`) but `staging-orders-v2-eda-queue-handler` rejected it on every one of its 20
receive attempts:

```
TypeMismatch: Expected paymentChanges.shipping to be of type number, instead found type string.
  at checkTypeFunction ... at Item.objectFromSchema ... at Item.toDynamo ...
```

**Blast radius, checked directly rather than assumed:** the message never persisted anything (it
fails before the schema's `toDynamo` step), and it carried a synthetic order's own unique
`message_group_id`, so it occupied its own FIFO message group and did not block any other group on
the shared `staging-orders-v2.fifo` queue (`0 waiting, 0 in-flight` confirmed on every other group
throughout). It did exhaust its own `maxReceiveCount` of 20 and land in `staging-orders-v2-dlq.fifo`:
MEASURED depth 2 before this slice, 3 checked at the end of this session -- the one extra message is
this poison message, confirmed dead-lettered rather than left retrying forever, in an already-existing,
already-monitored DLQ. No real order was affected. Left in the DLQ, not purged: this queue is shared
with real UNI traffic and this plan does not touch shared infrastructure destructively; JJ's call
whether to clear it.

Fixed by wrapping the five fields in `float()`/`int()`. **Verified the fix with a type-aware
structural diff against the real measured payload** (`scratchpad/type-diff.py`, not kept -- a
throwaway diagnostic, not a deliverable script), rather than eyeballing the JSON a second time, since
the first Gate A pass had been an eyeball comparison and had missed this exact class of bug. Result:
no structural or type differences beyond the pre-identified, explained list (the hash fields,
`orderId`/`message_group_id` being fresh by design, `origin` differing by design in template mode).

## Part 2, the fidelity gate

### Gate A, faithful replay

Replayed `#262208`'s own real emit: seed and out-reference both `262208` (a real reference, kept
deliberately for this comparison only -- never emitted, dry-run only, since the harness hard-refuses
`--emit` under a non-`QASYN-` reference regardless of any other flag). Compared field-by-field
against the real measured Pushed line.

**MEASURED: every field matches** -- `Source`, `DetailType`, `EventBusName`, and every key and value
in `Detail` including nested `itemChanges.added[0]`, `paymentChanges`, `addressChanges.shipping`
(key set and types; PII values not compared, by design) and `orderInfo` -- **except the trailing hash
segment of `idempotencyId`.**

**That one difference is named, not waved past.** The real order's `idempotencyId` hash segment
(`04175d3c`) does not equal its own `orderInfo.lastEmittedPayloadHash` (`91daeb25`) -- checked once
more, thinking it might be a transcription slip, then **confirmed against three more independent real
orders from the same cycle** (`#262210`, `#262211`, `#262216`): in all four, the two fields are
different values, every time. **These are two independently-computed hashes, not the same value
carried twice**, contrary to what CLAUDE.md's and this plan's own prior notes implied ("a payload
hash is computed on every emit... carried as the trailing segment of idempotencyId" reads as if one
hash serves both roles). The harness does not attempt to replicate either algorithm (unknown, needs a
code read); it keeps both fields equal to whatever `--hash` value it is given, a simplification
flagged in the script's own header. **Gate A PASSES** on this basis: the one difference is fully
explained, does not affect what TC12 or any reconciliation handler checks (idempotency keys on the
whole `idempotencyId` string; the version guard keys on `orderInfo.lastModified`; neither reads
`lastEmittedPayloadHash` from an *incoming* transaction), and is recorded here rather than patched
around.

### Gate B, TC12, the version guard in isolation

Seed order: `262208` (real, ECOM, THRILLS, 1 item). Synthetic order: `QASYN-01-TC12`,
`9d37be2e-2381-4f43-b838-08058cefd72b`, registered in `SYNTHETIC-REGISTER.md` before the first emit.

**Seed create** (event `CREATE_ORDER`, mutation `none`, `lastModified 2026-09-08T03:00:00Z`).
First attempt hit Bug 2 above and dead-lettered; second attempt, fixed, landed cleanly: 4 rows in
`staging-orders-v2` (ORDER, ITEM, ADDRESS, TRANSACTION), full trickle-down to a shipment header and
item in `staging-shipments`, `wmsSentAt` set (`2026-09-08T04:01:55.723Z`) -- **the synthetic order
reached Manhattan SCALE staging**, as the plan's synthetic-records rule anticipates.

Three emits against this one seeded order, `event UPDATE_ORDER`, `mutation bump-modified` (content
unchanged, only `lastModified` and hash vary), spaced 5+ minutes apart per the slice's own design:

| # | modifiedDate sent | vs stored (03:00:00Z) | Result | Attribution |
|---|---|---|---|---|
| 1 | `2026-09-08T02:59:59Z` | older | **No write.** ORDER `lastModified` unchanged, no new outward shipment event | MEASURED: `{"metric":"SalesOrderStaleRevision","event":"UPDATE_ORDER","orderId":"9d37be2e...","incomingLastModified":"2026-09-08T02:59:59Z","storedLastModified":"2026-09-08T03:00:00Z"}` |
| 2 | `2026-09-08T03:00:00Z` | equal | **Applied.** `lastEmittedPayloadHash` updated (write confirmed), TRANSACTION row count 2->3 | MEASURED: `{"metric":"SalesOrderUpdated","orderId":"9d37be2e...","added":0,"removed":0,"addressChanged":false}` |
| 3 | `2026-09-08T03:00:05Z` | newer | **Applied.** `lastModified` now `03:00:05Z`, hash updated, TRANSACTION row count 3->4 | MEASURED: same `SalesOrderUpdated` shape |

**TC12 PASS**, all three sub-cases MEASURED, not inferred from absence. Each emit carried a fresh
random hash (new each time, distinct from anything stored), so the idempotency index and the FIFO
content dedup could not have been what stopped test 1 -- by construction, only the version guard
could, and its own log line names itself, with both timestamps, removing any doubt.

**Establishing the attribution instrument, as the slice asks.** The reconciliation handler log
groups did not exist before this slice (MEASURED, slice 01: `NO LOG GROUP` for all three of
`staging-orders-cin7-update-order`, its `-eda-queue-handler` and `-eda-queue-populator`). This
slice's first injection created them. **The handler publishes its own named metric-shaped log line
on every outcome** -- `SalesOrderStaleRevision` (with both the incoming and stored timestamps
inline) on a version-guard rejection, `SalesOrderUpdated` (with `added`/`removed`/`addressChanged`
counts) on an applied revision. This is a strictly better instrument than the poller-side
`staleSkipped`/`echoSkipped` counters the slice warned would not move for an injected transaction
(correct -- they did not; they belong to the poller, which a synthetic emit bypasses entirely).
**Slices 04 and 05 should read this handler's own log group for attribution on every case, by
request ID, rather than reaching for a poller-side counter.** No control-based fallback was needed;
route 1 and 2 of the slice's three suggested routes were not required once route "whatever the
handler side offers" turned out to hold both an unambiguous rejection line and an unambiguous
application line.

**One thing this gate could not confirm, flagged for TC11 in slice 04:** none of the three test
emits produced a new outward event on the shipping side (`wmsSentAt` stayed at the create's own
timestamp throughout, MEASURED). All three mutations were deliberately content-neutral
(`added:0, removed:0, addressChanged:false`, that being the point of isolating the version guard).
Whether the reconciliation handler emits an outward event only when content actually changes, or
whether it should emit one on every applied revision regardless (AC7 says "exactly one outward event
per revision"), is not settled by this slice and needs a case with a real content mutation
(add-line/remove-line/change-address) to separate. **Not a TC12 finding, a note for whoever runs
TC11.**

## Part 3, the ceiling

Stated plainly, for slices 04 and 05 to read before they claim more than this supports:

* This proves **handler behaviour given an input it was actually sent**, via the same code path
  (`CREATE_TRANSACTION` on the shared bus, through the shared transaction chain, to the cin7-specific
  reconciliation handler) the poller itself uses for its first stage. It does not prove this input
  occurs in real Cin7 traffic. Say "the version guard rejects an older revision and applies an equal
  or newer one," never "revisions work."
* It does not exercise the poller at all. Nothing here speaks to contact-group resolution, the stage
  eligibility gate, the watermark, or the echo guard -- all BUSY-1159 territory, all bypassed by
  construction.
* `itemChanges.added` is assumed (INFERRED, not measured for a genuine revision) to always carry the
  full current line set, never a delta. TC12's own mutations never tested this assumption (content
  was deliberately unchanged); slice 04's add-line/remove-line cases are what will actually exercise
  it, and should watch for a surprise here specifically.
* The payload-hash algorithm is not replicated. Any case that depends on the *value* of a hash
  matching something specific (rather than merely being new/different) is out of this harness's
  reach.
* Financial totals (`subtotal`/`grandTotal`/`taxPaid`) pass through from the seed unchanged
  regardless of mutation. A case that asserts on totals reconciling against a line-item mutation will
  need the harness extended first.

## Standing constraints, confirmed

Poller schedule DISABLED and SO watermark UNSET throughout (checked before and after, via
`cin7-watermark.sh --poller so` and `check-ctc-status.sh`; unchanged from slice 01). No Cin7 call
made. No production credential touched or needed.

## Stop and ask JJ

None of the slice's own stop conditions were hit: Gate A's one field difference is fully explained
(above), Gate B attributed every suppression to a named mechanism, nothing needed a production Cin7
credential, and the synthetic record reached SCALE in the state intended (an `OPEN` shipment, not
sent to a waved shipment, no unexpected side effect). The two process incidents above were each
caught and corrected within the session and are disclosed rather than treated as a stop condition,
since neither left the environment in an unknown state (checked: DLQ depths, queue depths, and the
synthetic order's own row counts all accounted for above).

## Open questions register

None raised. The two-stage routing correction and the idempotencyId/lastEmittedPayloadHash finding
are corrections to this plan's own documentation, recorded above, not questions for dev.

## Scripts written

* `scripts/emit-synthetic-revision.sh`, **unreviewed**. Row added to `SCRIPTS.md`. Per JJ's
  2026-09-08 call recorded in `SCRIPTS.md`, review is deferred by design until the bulk of testing is
  done -- this is the expected state, not an open item. Two bugs found and fixed during this
  session's own use are described above; both are now covered by Gate A's rigorous re-check
  (`type-diff.py`, not kept) rather than left as a hoped-for fix.
* No other script promoted. The type-diff comparison and the debug-dump env var
  (`EMIT_DEBUG_DUMP`) built into `emit-synthetic-revision.sh` for that comparison are diagnostic
  aids for this session, not deliverables; the env var stays in the script (harmless, undocumented
  in `--help`-equivalent usage, only used when explicitly set) since a future session re-verifying
  fidelity after a script change will want it.

## Data handling

Two PII-print incidents this session while reading the seed order, both corrected in-session, full
detail in `TOOL-NOTES.md`. Every DynamoDB read after the second incident went through a
recursive-redaction allowlist (`scratchpad/safe-read-order.py`), verified against known-PII strings
before being trusted. Every CloudWatch log excerpt shown in this file, and every one used to decide
PASS/FAIL above, was checked for PII field-name presence before display and redacted where present;
none of the synthetic order's own placeholder fields needed it (they are fake by construction) but
the check was applied uniformly regardless.
