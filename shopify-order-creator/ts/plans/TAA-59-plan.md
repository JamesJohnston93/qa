# TAA-59 plan: orders-service assertions on the undeliverable cases (TC26), TC25 closed as a null result

Written 2026-08-30 by this session. **Note on provenance:** the session prompt pointed
at this file expecting it to already exist; it did not (no commit, no branch, nothing
in git history under any name), and the `taa-59-shipping-alignment` worktree it was
meant to live in had never received a commit — its `.git/worktrees` admin dir still
read `initializing`, and its working directory doesn't exist on this machine (stale
registration, pruned during this session). Treat everything below as freshly written
against the real repo state today, not recovered from a prior session.

Baseline: branch `taa-59-shipping-alignment` @ `010f1fa` (== `main`, level with
`origin/main`), working tree clean apart from untracked `_to_delete/` (pre-existing,
unrelated — leftover stale git-lock files from a previous session's crashed worktree
setup, not this ticket's concern). Build clean, **456/456** offline tests green.

Ticket: https://universalstore.atlassian.net/browse/TAA-59 (parent workstream TAA-49)
Dependencies discharged: TAA-48 (transaction reader) and TAA-52 (verify modules for
holds/finalisation/transactions) are both merged into `main` already.

## Goal in one sentence

Close TC25 as a documented null result (no code), and add orders-service-level
assertions to the *existing* `undeliverable`/`partial_undeliverable` cases proving the
refund shape TC26 actually cares about — item status, the REFUND_ITEM transaction's
per-sku status, and whether REFUND_SHIPPING/ORDER-finalisation happens — without adding
any new case, SKU slot, or order.

## TC25 — null result, no code, recorded here per the ticket's own instruction

The ticket already confirms this from committed fixtures (`US-fulfil-9929/9932/9935`,
`PS-taa52-finalised-3329`): every fulfilled order carries exactly one `TRANSACTION#`
row, `CREATE_ORDER`/`CHARGE` — no fulfil-shaped event exists on `staging-orders-v2`
under any spelling. `SHIPMENT_FULFILLED` is a `staging-shipments` name, not an
orders-v2 one. The item-status half is already covered:
`assertOrderItemsFulfilled` (`verify/fulfilment.ts:96`, check name
`orders_table.fulfilled`) already runs inside `fulfilment_verify`
(`runner.ts:459-478`) on both `fulfil_single`/`fulfil_split`, and confirms `ITEM#`
rows read `FULFILLED`. Nothing to build. This plan does not touch fulfilment at all.

## Verified against the repo today

- The two fixtures the ticket's TC26 argument rests on are already committed:
  `fixtures/orders-v2/US-undeliverable-9865.json` (fully undeliverable, single item)
  and `US-undeliverable-9866.json` (partial — one item undeliverable, one open).
  Read both in full. They confirm the ticket's claims exactly:
  - `9865`: `ITEM#` row `status: "REFUNDED"`; `ORDER` row `status: "REFUNDED"`;
    transactions are `CREATE_ORDER`, `REFUND_SHIPPING`, `REFUND_ITEM` — the
    `REFUND_ITEM` row's `itemChanges.refunded[0]` carries `sku: "33788579"`,
    `status: "UNDELIVERABLE"`.
  - `9866`: undeliverable item's `ITEM#` row `status: "REFUNDED"`; the *other* item's
    `ITEM#` row stays `status: "OPEN"`; `ORDER` row `status: "OPEN"`; transactions are
    only `CREATE_ORDER` and `REFUND_ITEM` — **no** `REFUND_SHIPPING` row at all. The
    `REFUND_ITEM` row's `itemChanges.refunded[0]` carries `sku: "33946269"`,
    `status: "UNDELIVERABLE"`, same shape as 9865's.
  - No live order is needed to build or offline-test this ticket — both fixtures
    already exist, use them exactly as `tests/finalisation.test.js`/
    `tests/transactions.test.js` already use their own fixtures (`loadFixture` +
    `orderRecordFromRows`/`orderItemRowsFromRows`/`transactionRowsFromRows`).
- `verify/finalisation.ts` already exports a fully generic
  `assertOrderStatus(record: OrderRecord | null, expectedStatus: string, orderName:
  string)` (check name `orders_table.status`) — grep confirms **it is not yet imported
  by `runner.ts`**. Reuse it as-is for both the `REFUNDED` and `OPEN` cases; do not
  write a new status-check function.
- `verify/transactions.ts` already exports `assertTransactionPresent`/
  `assertTransactionAbsent(transactions, event, orderName, matcher?)` — a matcher is
  `(t: TransactionRow) => boolean`, and `t.raw` is the escape hatch for
  event-specific payload (confirmed pattern: `tests/transactions.test.js`'s
  `carriesFraud`/`carriesOutstanding` closures read `t.raw.onHoldChanges.added`).
  `REFUND_SHIPPING` present/absent needs no matcher, just the event name.
  `REFUND_ITEM`'s per-sku-status check needs one: `t.raw.itemChanges?.refunded` is an
  array of `{sku, status, ...}` (confirmed shape in both fixtures above) — write one
  small reusable matcher-builder in `transactions.ts`, do not inline an anonymous
  closure in `runner.ts` (this project's convention: pure helpers in `verify/*.ts`,
  offline-tested, `runner.ts` only calls them).
- No `ITEM#`-row-status assertion exists yet for `staging-orders-v2` (as opposed to
  `staging-shipments`, which already has `assertItemsRemoved` in `verify/shipments.ts`
  checking a *different* table's *different* terminal status — `REMOVED`, not
  `REFUNDED`). `verify/orders.ts` is the right home: it already owns other
  `ITEM#`-row checks on this exact table (`assertItemDelivery`). One new function,
  same shape as `assertItemDelivery`.
- `readers/dynamoReader.ts:488` already exposes `DynamoReader.getOrderItemRows(store,
  orderIdTail): Promise<OrderItemRow[]>` — composed off the same `getOrderRows` query
  `runner.ts` already calls for `orders_table`/`allocation` (`runner.ts:267`), so this
  is a normal reader call, not a new query shape. `OrderItemRow.status` and `.sku`
  are both already on the interface (`dynamoReader.ts:351-362`).
- `DynamoReader.getOrderTransactions(store, orderIdTail): Promise<TransactionRow[]>`
  (`dynamoReader.ts:504`) is the read this stage needs for the transaction checks —
  already built and tested (TAA-48), no new reader method needed.
- `runner.ts`'s refund branch (`:393-414`) is the one to extend: `refund` (Shopify)
  → `cleanup` (staging-shipments rows → REMOVED) already exist; the new stage goes
  immediately after `cleanup`, inside the same `if (Object.keys(caseDef.
  expectedRefundSkus).length > 0)` block.
- **The gating question the ticket flags ("decide whether `reject_undeliverable` gets
  the new stage") has a clean answer already available in the data the runner already
  has, no new `CaseDefinition` field needed:** `reject_undeliverable`
  (`cases/baselineCases.ts:230-243`) also carries a non-empty `expectedRefundSkus`
  (`hasRefund` is `true` for it too), but it also carries `rejectMode: "undeliverable"`
  — `undeliverable`/`partial_undeliverable` both leave `rejectMode` `undefined`. Gate
  the new stage on `hasRefund && !caseDef.rejectMode`. This also matches the plain
  English of the ticket ("added to the existing undeliverable and partial_undeliverable
  cases") and the ticket's own explicit scope line, "Case definitions are not changed
  here, only what the existing cases assert" — no new field, no case-name string
  match, derived from data the case already declares.
  **Decision, recorded here per the checklist item:** `reject_undeliverable` does NOT
  get the new stage. It reaches its refund through the reject endpoint's own pathway
  (`RejectClient`/`rejectFlow.ts`), not a plain Shopify `refundCreate` the way
  `undeliverable`/`partial_undeliverable` do — whether it produces the same
  `REFUND_ITEM`/`REFUND_SHIPPING` orders-v2 shape is unconfirmed, no fixture exists for
  it, and the ticket's own text scopes TC26 to "the existing undeliverable and
  partial_undeliverable cases" by name. Extending to `reject_undeliverable` without
  evidence would be exactly the guessed-spelling failure mode this project's
  assert-observed-spellings rule exists to prevent — leave it uncovered, note it as
  open if TAA-31's reject work ever wants this evidence later.
- **"Fully vs. partially undeliverable" is already derivable from the case
  definition, no new field needed either:** compare `Object.keys(caseDef.
  expectedRefundSkus)` against `Object.keys(caseDef.skuQuantities)` — when every
  requested SKU is also a refunded SKU, the whole order went undeliverable
  (`undeliverable`: `{sku7:1}` vs `{sku7:1}`, equal); when only some did, it's the
  partial case (`partial_undeliverable`: `{sku8:1,sku9:1}` vs `{sku9:1}`, not equal).
  This reads directly off data `runner.ts` already has in scope at that point in the
  function — no string match on `caseDef.name`.
- `progress.ts`'s `stageSequenceFor` is hand-maintained (its own doc comment already
  warns of this) and takes `rejectMode` as a parameter already — the new stage slots in
  next to the existing `hasRefund ? ["refund", "cleanup"] : ["no_refund"]` line, gated
  the same way runner.ts is gated (`hasRefund && !rejectMode`), so both stay in sync by
  construction rather than by two separately-maintained conditions.
- `config.ts`'s `PollWindows` has no field for this yet. `ordersService` (120s) exists
  but is a different pipeline's stage (`holdFlow.ts`/`editFlow.ts`'s webhook-settle
  window, TAA-57 — not wired into `runner.ts` at all, confirmed by grep) — reusing it
  here would conflate two different settle paths under one tunable number for no
  reason. Add a new field instead, following this file's own established pattern for a
  brand-new stage with no live timing yet (`rejectTransactions`'s doc comment: "this
  stage has never actually been timed against a fresh reject, so 30s is a conservative
  first estimate ... pending real numbers"). Same posture here: guess conservatively,
  then replace the guess with a measured number in slice B and say so in the comment.
- `report.ts`'s `stableSignature()` is generic over check names (no hardcoded list) —
  no change needed there for the new checks to feed `--repeat`'s variance diff.

## Open questions

None blocking — both real open items above (gating `reject_undeliverable`, "fully vs
partial") are resolved by data the case definitions already expose, recorded above
rather than left for a slice to discover. The only genuine unknown is the new stage's
real settle time, which slice B measures rather than guesses permanently.

## Slices

| Slice | Done when | Owns | Shared resources |
| --- | --- | --- | --- |
| A | New assertions built, wired into `runner.ts` for `undeliverable`/`partial_undeliverable` only, fixture-driven offline tests green against the two committed fixtures, build+test green | `verify/orders.ts`, `verify/transactions.ts`, `runner.ts`, `progress.ts`, `config.ts`, new `tests/*.test.js` additions | none — no live orders, fixtures only |
| B | One live run of the full default 12-case set on each store, both `undeliverable`/`partial_undeliverable` passing the new stage, the new poll window replaced with a measured number, sign-off written | `ts/signoffs/TAA-59.md`, `config.ts`'s `ordersTableRefund` comment, `CLAUDE.md` | two live full-set runs, one per store — real orders, same as every other ticket's live-confirm step |

---

## Slice A: build the assertions and wire them into the two existing cases

Branch: continue on `taa-59-shipping-alignment` (already checked out)
You own: `verify/orders.ts`, `verify/transactions.ts`, `runner.ts`, `progress.ts`,
`config.ts`, new test coverage in `tests/orders.test.js`/`tests/transactions.test.js`
(or new files if that reads cleaner)

### Contract detail

1. **`verify/orders.ts`** — add `assertOrderItemStatus(item: OrderItemRow,
   expectedStatus: string, orderName: string): void`, same shape as
   `assertItemDelivery` immediately above it, check name `orders_table.item_status`.
   Caller finds the right `OrderItemRow` by `sku` from `getOrderItemRows`'s result.

2. **`verify/transactions.ts`** — add a matcher-builder,
   `refundedSkuStatusMatcher(sku: string, expectedStatus: string): TransactionMatcher`,
   reading `t.raw.itemChanges?.refunded` (an array — guard for it being absent/not an
   array, same defensiveness `orderRecordFromRows` already uses for
   `row.paymentMethod`) and returning true if any entry has `sku === sku &&
   status === expectedStatus`. Use it as the `matcher` argument to the existing
   `assertTransactionPresent(transactions, "REFUND_ITEM", orderName,
   refundedSkuStatusMatcher(sku, "UNDELIVERABLE"))` — no new assert function needed,
   the existing one already does everything once it has the right matcher.

3. **`runner.ts`** — inside the existing
   `if (Object.keys(caseDef.expectedRefundSkus).length > 0) { ... }` block
   (`:393-414`), immediately after the `cleanup` stage's `stageDone` call and only
   when `!caseDef.rejectMode`:
   - `t0 = Date.now()`
   - Poll (new `pollVerify` call, stage name `orders_table_refund`, timeout
     `poll.ordersTableRefund`, `dynamoInterval`) fetching
     `{ items: await dynamoReader.getOrderItemRows(config.store, oidTail), transactions:
     await dynamoReader.getOrderTransactions(config.store, oidTail), order: await
     dynamoReader.getOrderRecord(config.store, oidTail) }` (check `getOrderRecord`'s
     exact signature at `dynamoReader.ts:469` before wiring — it wraps
     `orderRecordFromRows(getOrderRows(...))`, reuse it rather than calling
     `getOrderRows` a third time and re-deriving).
   - Verify function, for each `sku` in `Object.keys(caseDef.expectedRefundSkus)`:
     - find the matching `OrderItemRow` by `sku` (throw the existing "not found yet"
       shape if absent, matching every other stage's not-yet-landed convention — or
       simply let `assertOrderItemStatus` fail naturally if the caller passes a
       not-found sentinel; decide the cleanest fit while writing, following
       `assertShipmentItemsFulfilled`'s "no items found -> throw, don't special-case"
       precedent)
     - `assertOrderItemStatus(item, "REFUNDED", oname)`
     - `assertTransactionPresent(transactions, "REFUND_ITEM", oname,
       refundedSkuStatusMatcher(sku, "UNDELIVERABLE"))`
   - Then, once per case (not per sku): compute `fullyUndeliverable =
     Object.keys(caseDef.skuQuantities).every((s) => s in caseDef.expectedRefundSkus)`
     and branch:
     - fully undeliverable: `assertTransactionPresent(transactions,
       "REFUND_SHIPPING", oname)` and `assertOrderStatus(order, "REFUNDED", oname)`
       (import from `verify/finalisation.ts` — not yet imported by `runner.ts`, add it)
     - partial: `assertTransactionAbsent(transactions, "REFUND_SHIPPING", oname)` and
       `assertOrderStatus(order, "OPEN", oname)`
   - `stageDone("orders_table_refund", (Date.now() - t0) / 1000)` — model the timing
     capture on the existing `reject_transactions` block just above this one for
     poll+stageDone shape.

4. **`progress.ts`** — in `stageSequenceFor`, change the refund line from
   ```ts
   ...(hasRefund ? ["refund", "cleanup"] : ["no_refund"]),
   ```
   to insert `orders_table_refund` after `cleanup` only when `hasRefund &&
   !rejectMode` — since `rejectMode` is already a parameter here, this is a small
   conditional next to the existing one, not a new parameter.

5. **`config.ts`** — add `ordersTableRefund: number` to `PollWindows`, doc comment
   modeled on `rejectTransactions`'s ("never measured yet, conservative first
   estimate"). Initial value: **90s** — same order of magnitude as `refund` (90s),
   since this stage's data lands via the same Shopify-refund-triggered webhook chain
   `refund`/`cleanup` already wait on, just a different table. `DEFAULT_POLL_WINDOWS`
   gets the new key.

### Sharp edges, all real

- **Do not touch `reject_undeliverable`.** It shares SKU slot 13 with
  `reject_reallocate` and is out of scope per the ticket's own text — see the gating
  reasoning above. Confirm after wiring that its stage list is unchanged (no
  `orders_table_refund` in its `stageSequenceFor` output).
- **Strict by default, this project's only mode.** No fallback for a missing
  `REFUND_ITEM` row or a missing sku match — if either isn't found yet, the stage
  should keep polling (via `VerificationError`), not synthesize a pass or a silent
  skip.
- `pollVerify`'s contract (`runner.ts:85-114`) needs its verify function to throw
  `VerificationError` on any not-yet-true condition and nothing else — reuse the
  existing throw shapes from `assertOrderItemStatus`/`assertTransactionPresent`/
  `assertTransactionAbsent`/`assertOrderStatus` rather than adding new try/catch
  plumbing.
- `cli.ts`'s `--help`/`--list-cases` are unaffected by this slice (no case, no flag
  changes) — confirm output is unchanged as a sanity check, per this project's
  standing rule that those two must be updated in the same commit as any change that
  *would* affect them, which this one doesn't.
- Offline tests must use the two already-committed fixtures
  (`US-undeliverable-9865.json`/`-9866.json`) exactly as-is — do not hand-write a new
  fixture for this; the real ones already prove the shape.

### Checklist

- [ ] `assertOrderItemStatus` added to `verify/orders.ts` (check name
      `orders_table.item_status`)
- [ ] `refundedSkuStatusMatcher` added to `verify/transactions.ts`
- [ ] `runner.ts` wires the new `orders_table_refund` stage into the refund branch,
      gated on `hasRefund && !caseDef.rejectMode`
- [ ] `assertOrderStatus` imported from `verify/finalisation.ts` into `runner.ts`
- [ ] `progress.ts`'s `stageSequenceFor` updated with matching gating logic
- [ ] `config.ts` gains `ordersTableRefund` (initial guess 90s, comment states it is
      unmeasured)
- [ ] Offline tests, fixture-driven against `US-undeliverable-9865.json` (fully
      undeliverable: item REFUNDED, REFUND_SHIPPING present, ORDER REFUNDED,
      REFUND_ITEM carries UNDELIVERABLE for its sku) and `-9866.json` (partial: undie
      item REFUNDED, other item still OPEN, REFUND_SHIPPING absent, ORDER OPEN)
- [ ] `reject_undeliverable`'s stage sequence confirmed unchanged
- [ ] `--list-cases`/`--help` output confirmed unchanged
- [ ] npm run build + npm test green

Deliberately not doing: no live orders, no change to `reject_undeliverable`, no new
`CaseDefinition` field, no touching fulfilment/TC25 code (there is none to write), no
change to the default case count (stays 12).

---

## Slice B: live confirm, measure the settle time, sign off

Branch: same, continue on `taa-59-shipping-alignment`
You own: `ts/signoffs/TAA-59.md` (new), `config.ts`'s `ordersTableRefund` comment,
`CLAUDE.md`

### Contract detail

Run the full default 12-case set on **both** stores (`node dist/index.js --store US`
/ `--store PS`, no `--cases` filter — per this project's convention that `--help`/
`--list-cases` and the default set are the user-facing contract, exercise it as a real
user would). Confirm:

- All 12 cases still pass on both stores (this ticket must not regress anything else).
- `undeliverable` and `partial_undeliverable` both show the new `orders_table_refund`
  stage in their reported stage list, passing, with a real elapsed time.
- Record the measured elapsed time for `orders_table_refund` across however many live
  cases you get (at minimum: one `undeliverable` + one `partial_undeliverable` per
  store, four data points total) in the sign-off.
- Replace `config.ts`'s `ordersTableRefund` guessed value and comment with the real
  measured number, keeping this project's established headroom convention (2-5x
  observed max, not just p90 — see the `PollWindows` module doc comment's own stated
  rule) rather than shrinking to the exact observed value.

### Sharp edges, all real

- Staging is shared — record every order number placed, don't reuse anyone else's.
- Do not transition the ticket. Propose the acceptance criteria as met in the
  sign-off; leave the actual transition to JJ, matching this project's standing
  convention (see TAA-46 slice D).
- If a live run surfaces a genuine backend gap (e.g. the same intermittent
  refund-automation miss documented elsewhere in `CLAUDE.md`), log it as a finding —
  do not silently retry until it passes, and do not open a new ticket for it (per JJ's
  standing instruction: file only if it's a new, distinct defect; this project already
  has a documented policy of deferring chasing such gaps — [[defer-backend-bugs-prioritize-coverage]]
  from memory).

### Checklist

- [ ] Full 12-case set run on US, all 12 pass, order numbers recorded
- [ ] Full 12-case set run on PS, all 12 pass, order numbers recorded
- [ ] `orders_table_refund` measured elapsed time recorded for both cases, both stores
      (or as many as a single pass yields)
- [ ] `config.ts`'s `ordersTableRefund` updated from guess to measured value with
      appropriate headroom, comment rewritten to state it as measured, not guessed
- [ ] TC25's null result and TC26's settled evidence appended to `CLAUDE.md` as a dated
      entry (append-only, per this project's convention)
- [ ] npm run build + npm test still green after any config.ts change
- [ ] Evidence written to `ts/signoffs/TAA-59.md`
- [ ] Ticket acceptance criteria proposed as met, transition left to JJ

Deliberately not doing: no new cases, no SKU pool changes, no `reject_undeliverable`
coverage (see slice A's recorded decision), no chasing any backend gap found live
beyond logging it.
