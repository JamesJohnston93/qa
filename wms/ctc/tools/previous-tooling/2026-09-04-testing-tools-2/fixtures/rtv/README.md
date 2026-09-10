# RTV scenarios — empty, deliberately

There is no RTV baseline to derive scenarios from, so this directory holds no fixtures.

Cin7 contains **four `Supplier`-group contacts and all four are overseas**. Paging `SalesOrders`
for a `Supplier`-group order returns nothing — 12 pages across all branches on 2026-08-28, and
again 6 pages on 2026-09-03. The single RTV order that exists at all, `TOPG51689-1`, was found by
surveying contacts rather than orders and is kept at
`_shared/BUSY-1065/fixtures/variants/rtv-observed-topgrowth.json` — design evidence, held
outside this bundle rather than shipped with it.

That order cannot flow through the pipeline as built, at four independent points: `branchId` 3 is
outside the poller's filter and unmapped for warehouse, `deliveryCountry` `China` and an empty
`deliveryState` both hard-error in the Australia-only address map, and `stage` `Dispatched` is
terminal. It also carries one line and one size, so it would not exercise line numbering.

**Do not fill this directory by hand.** A synthetic RTV order would have to be given an Australian
address on a CTC branch to pass, which is exactly the shape no observed RTV has — the fixture would
assert the mapping works while hiding the reason it does not.

What unblocks it is the scoping answer in `../../open-questions.md` → OQ-1161-05: whether CTC
intends RTV to flow through this integration at all, and on which branches. If yes-including-this,
the branch filter and the address map both need work well beyond fixtures.

Capture command, for when an in-scope RTV order does appear:

    ./find-cin7-sales-order.sh --group Supplier --raw
    ./redact-cin7-payload.py raw.json --as-test-order <ref>

Note the redactor replaces `deliveryFirstName` with a person's first name, which destroys the
company-in-first-name shape an RTV order depends on. Hand-correct after redacting, or teach the
redactor about it first.
