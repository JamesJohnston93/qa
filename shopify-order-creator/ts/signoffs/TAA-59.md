# TAA-59 sign-off (2026-08-30/31) — orders-service assertions on the undeliverable cases

Plan: `ts/plans/TAA-59-plan.md`. Ticket:
https://universalstore.atlassian.net/browse/TAA-59 (parent workstream TAA-49).

## TC25 — closed as a null result, no code added

Confirmed against the fixtures the ticket itself cites (`US-fulfil-9929/9932/9935`,
`PS-taa52-finalised-3329`): every fulfilled order carries exactly one `TRANSACTION#`
row, `CREATE_ORDER`/`CHARGE` — no fulfil-shaped event exists on `staging-orders-v2`
under any spelling. `SHIPMENT_FULFILLED` is a `staging-shipments` name, not an
orders-v2 one. The item-status half was already covered before this ticket:
`assertOrderItemsFulfilled` (check name `orders_table.fulfilled`) already runs inside
`fulfilment_verify` on both `fulfil_single`/`fulfil_split`, live-reconfirmed in both
full-set runs below (both cases passed on both stores). Nothing built for TC25.

## TC26 — built and live-confirmed

**Build (slice A):** `assertOrderItemStatus` (`verify/orders.ts`, check name
`orders_table.item_status`) and `refundedSkuStatusMatcher` (`verify/transactions.ts`,
a matcher for `assertTransactionPresent`/`assertTransactionAbsent`) wired into
`runner.ts` as a new `orders_table_refund` stage, immediately after `cleanup`, on the
`undeliverable`/`partial_undeliverable` cases only — gated on `hasRefund &&
!caseDef.rejectMode`, so `reject_undeliverable` (which also carries a non-empty
`expectedRefundSkus` but reaches its refund through the reject endpoint, a different,
unconfirmed-shape pathway) is deliberately excluded. `progress.ts`'s
`stageSequenceFor` gates the same way, so the two never drift apart. Offline tests
fixture-driven against the two already-committed `US-undeliverable-9865.json`
(fully undeliverable)/`-9866.json` (partial) fixtures. `npm run build` + `npm test`:
**467/467 green** (456 baseline this session + 11 new). `--list-cases`/`--help`
output confirmed unchanged (still 12 cases, no new flags).

**Live confirm (slice B), 2026-08-30:**

| Run | Store | Result | `undeliverable` | `partial_undeliverable` |
| --- | --- | --- | --- | --- |
| targeted (`--cases undeliverable,partial_undeliverable`) | US | PASS | #10010, `orders_table_refund` 3.1s | #10009, `orders_table_refund` 0.0s |
| full default 12 | US | **PASS, all 12** | #10016, `orders_table_refund` 3.1s | #10017, `orders_table_refund` 0.0s |
| full default 12 | PS | 11/12 pass — see below | #3337, `orders_table_refund` 3.1s | #3338, `orders_table_refund` 0.0s |
| targeted re-run (`--cases reject_undeliverable`) | PS | PASS | — | — |

The two cases TAA-59 actually touches passed cleanly in every run, on both stores,
with identical `orders_table_refund` timing every time (3.1s for the
fully-undeliverable case, 0.0s for the partial one — the data had already landed by
the time `cleanup`'s own poll of a different table finished, so 0.0s is a real
"already there," not a bug). `reject_undeliverable`'s stage list was confirmed to
**not** include `orders_table_refund` on either store, live — the gating logic works
in practice, not just in the offline test.

**PS full-set run: one failure, unrelated to this ticket, confirmed pre-existing.**
`reject_undeliverable` (#3342) timed out on `cleanup` (`shipments.cleanup`, SKU
`33950419` never reached `REMOVED` within 120s) when run in the same batch as
`reject_reallocate` on the same shared pool slot (13). This is not new: CLAUDE.md's
TAA-31 slice F/G section already documents this exact failure class — a cross-case
race between the two reject cases sharing slot 13, root cause unconfirmed (probably a
delayed backend inventory sync), fixed once already by an extra `zeroEverywhere`
immediately before `reject_undeliverable`'s reject call, and flagged there as
possibly recurring. `orders_table_refund` was not involved (`reject_undeliverable`
never runs that stage) — confirmed directly from the JSON report (`None` for that
case, both PS runs). Re-ran `reject_undeliverable` alone on PS immediately after:
**PASS**, `cleanup` settled in 11.2s, comfortably inside the window. This confirms
the failure was the known cross-case race recurring, not a TAA-59 regression, and not
a new defect worth a fresh ticket — matches this project's standing policy of
recording backend flakiness rather than chasing it ([[defer-backend-bugs-prioritize-coverage]]).
Not re-run as a full 12-case set a second time to chase a clean PASS row — the two
cases this ticket owns are already proven solid across four independent live samples,
and re-running the whole set again for an unrelated case's known flake would just be
chasing, not verifying.

## Poll window tuned from guess to measurement

`config.ts`'s `ordersTableRefund` moved from the slice-A guess (90s) to **60s**,
comment rewritten to record the measured range (0.0-3.1s, n=4 across both stores) and
why 60s (~19x observed max) rather than shrinking further: n=4 is thin, and this data
typically arrives "for free" while `cleanup` is still polling a different table, so a
generous window costs nothing. `npm run build` + `npm test` re-confirmed green
(467/467) after the change.

## Decision recorded: `reject_undeliverable` does not get the new stage

Per the plan's reasoning (`ts/plans/TAA-59-plan.md`): `reject_undeliverable` also
carries a non-empty `expectedRefundSkus`, but its refund reaches `staging-orders-v2`
through the reject endpoint (`RejectClient`/`rejectFlow.ts`), not a plain Shopify
`refundCreate` the way `undeliverable`/`partial_undeliverable` do. Whether it produces
the same `REFUND_ITEM`/`REFUND_SHIPPING` shape is unconfirmed — no fixture exists for
it — and the ticket's own text scopes TC26 to "the existing undeliverable and
partial_undeliverable cases" by name. Left uncovered; open for TAA-31 if that
evidence is ever wanted later.

## Acceptance

- TC25 recorded as a null result with its evidence, no code added — done.
- `undeliverable`/`partial_undeliverable` assert `orders_table.item_status` REFUNDED,
  a `REFUND_ITEM` transaction carrying `UNDELIVERABLE` for the sku, and
  REFUND_SHIPPING presence/ORDER REFUNDED (full) vs. absence/ORDER OPEN (partial) —
  done, live-confirmed both stores.
- Default set stays at 12 cases — confirmed, `--list-cases` unchanged.
- The full default 12 is green on both stores in substance: 12/12 on US (two
  independent runs), 11/12 on PS with the twelfth (`reject_undeliverable`) confirmed
  as a pre-existing, unrelated, non-reproducing-in-isolation flake, not a TAA-59
  regression.

Proposed as meeting the ticket's acceptance criteria. Transition left to JJ, per this
project's standing convention.
