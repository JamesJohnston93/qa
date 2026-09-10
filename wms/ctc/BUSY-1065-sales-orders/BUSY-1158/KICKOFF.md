# BUSY-1158 IDE kick-off prompts

Open the IDE with `BUSY-1065-sales-orders/BUSY-1158` as the working folder, not the tooling root, or the `../../`
paths in the slices will not resolve.

Run `aws sso login --profile staging` first if the session has expired. It is a browser device-code
flow and needs a human.

## Slice 01, wiring and guard shape

    We are doing QA on BUSY-1158. Read CLAUDE.md, then STATE.md, then run slice 01
    (slices/01-wiring-and-guard-shape.md). Do not read the other slices. Write
    results/01-wiring-and-guard-shape.md and update STATE.md before you finish.

Needs: nothing. No live order, no writes, no poller schedule.

## Slice 02, consumer stance on a live order

    We are doing QA on BUSY-1158. Read CLAUDE.md, then STATE.md, then run slice 02
    (slices/02-consumer-stance-live-order.md). Do not read the other slices. Write
    results/02-consumer-stance-live-order.md and update STATE.md before you finish.

Needs: slice 01 done, because its subscriber list is what this slice sweeps against. Also a CTC
reference that exists in the orders table. `261115` and `WOR19261` from `../BUSY-1159/fixtures.md`
are the best documented, and nothing here creates a record, so an old order is fine as long as its
log window is inside the 30 day retention.

## Slice 03, Universal Store regression

    We are doing QA on BUSY-1158. Read CLAUDE.md, then STATE.md, then run slice 03
    (slices/03-universal-store-regression.md). Do not read the other slices. Write
    results/03-universal-store-regression.md and update STATE.md before you finish.

Needs: a genuinely warehouse fulfilled Universal Store order in staging, on the Shopify or M2
channel, that reaches the shipments table. Every real order found so far is NEWSTORE and never gets
there. Nobody has been asked for one yet. The slice searches first and stops early if nothing is
found, so it is safe to paste before the fixture exists, it just will not get past the search.

## Slice 04, CTC shipment state map

    We are doing QA on BUSY-1158. Read CLAUDE.md, then STATE.md, then run slice 04
    (slices/04-ctc-shipment-state-map.md). Do not read the other slices. Write
    results/04-ctc-shipment-state-map.md and update STATE.md before you finish.

Needs: nothing, and it must not create anything. It is one read that decides whether TC4e is runnable
without accepting or fulfilling a shipment. Ten minutes, not a full session.
