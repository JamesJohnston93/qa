# BUSY-1161 tool notes

Bugs found in the testing scripts themselves, and what was changed. A failing test is not a system defect until the tool has been ruled out.

Carried in from BUSY-1160, still true:

- `emit-synthetic-outbound-order.sh`'s `WAREHOUSE_BY_ORDER_TYPE` default for WHOLESALE is `CTC-WH`, a value the deployed poller can no longer produce. Override with `--warehouse CTC-QDC` or the emit reproduces a fixed defect.
- `cin7-watermark.sh` defaults to the item master poller. The wrong flag rewinds the item master feed.
- The real Lambda timeout marker is `Status: timeout`. The `REPORT.*Task timed out` pattern returns nothing on this runtime.
- Reading a DLQ with `--visibility-timeout 0` still increments `ApproximateReceiveCount`. Snapshot first.
- On a wide watermark window, `aws lambda invoke` can report a client-side throttling error while the real invocation is still running and completes normally minutes later.
- `lambda:list-event-source-mappings` must be queried by `--event-source-arn`, not by function name. Querying by function name returns nothing and reads as an unmapped queue.

Found and fixed this ticket, slice 02 (tool fidelity gate), in `../../tools/cin7-sales-orders/invoke-so-revision.sh`:

- **`CANCEL_OUTBOUND_ORDER` was built from the same template as `CREATE`/`UPDATE`.** The
  deployed `buildCancelOutboundOrderCommand` sends a materially smaller shape: `outboundItemInfo`
  is always `[]`, and `outboundOrderInfo` omits `shipTo`, `shipToAddress`, `scheduledShipDate`,
  `customerOrderNo` and `lastEmittedPayloadHash` entirely; the command carries no `customerEmail`
  key at all. Confirmed by direct code read (`inspect-lambda-code.sh` against
  `staging-orders-cin7-so-poller`) and by dry-running the old tool against `08-ineligible-declined`
  with the order already created: the tool sent all 13 line items and the full address block on
  what should have been a bare cancel. **Fixed 2026-09-10**, JJ's explicit call (slice 02 asked
  before changing it): added a dedicated `CANCEL_EVENT` branch matching the deployed shape exactly.
  Re-run after the fix against the same scenario, output now matches field for field (see
  `results/02-tool-fidelity-gate.md`). **Any cancel-shaped assumption from before this fix landed
  is not to be trusted** — there is no prior BUSY-1161 case run against the old cancel path, so
  nothing needs retracting, but a session reading an older transcript should know the fix line.
- **`orderDate` should have been `orderedAt`.** The deployed builder's field is `orderedAt:
  order.createdDate`; the tool sent `orderDate`, an unrecognised key the handler's
  `saveUnknown:false` schema drops silently on save. Confirmed against the persisted `ORDER` row
  for the synthetic order this slice created (`982409Aug26`, `orderId
  23adfe1c-b10a-4122-b5e7-bc7cbb4a52fb`): neither `orderDate` nor `orderedAt` is present on it,
  because it was created before the fix. **Fixed 2026-09-10** in the same edit, same branch and the
  create/update branch both now write `orderedAt`. Not re-emitted onto the existing order (no case
  in this plan checks `orderedAt`, so backfilling it was judged not worth a third revision against
  that reference); a session that does need to check `orderedAt` on this specific order should know
  it predates the fix.
- **The tool's own header example is broken.** Line ~44 of its usage comment shows
  `--scenario 02-size-qty-increased --order-type RTV` as a working example (no `--family`). Run
  verbatim, it fails: `--order-type RTV contradicts '02-size-qty-increased', which lives in the
  WHOLESALE directory.` The validation logic (`"the directory is the order type. An explicit
  --order-type that disagrees with it is a contradiction, not a preference"`) refuses `--order-type`
  to override a bare scenario name's resolved directory, full stop — `--family outbound` does not
  change this. **The only way to force the substitution TC5d needs is to pass the scenario as an
  explicit file path** (e.g. `--scenario fixtures/wholesale/02-size-qty-increased.json --order-type
  RTV`), which the same validation block happens to skip (the path branch never calls
  `find_scenario`, so `RESOLVED_ORDER_TYPE` stays empty and the contradiction check never fires).
  Confirmed this path produces a clean diff against the same scenario as WHOLESALE: only
  `orderType`, `allocateComplete` and the derived `lastEmittedPayloadHash`/`orderId` differ, nothing
  else that reaches SCALE. **Not fixed** — this is a genuinely useful escape hatch, not a bug to
  patch out, but the header comment's own example needs correcting to show the path form. Flagged
  for Kian rather than changed here, since it is his usage-comment wording, not broken logic. TC5d
  must be driven this way (by path), not by the bare scenario name the header currently shows.
- **`orderId` is a random UUID4 on every `CREATE`** (`order_id = order_id or str(uuid.uuid4())`),
  not the deployed poller's deterministic `uuid5('order:CTC:<reference>')`. `UPDATE`/`CANCEL`
  correctly read back and reuse whichever `orderId` a prior `CREATE` actually persisted, so one
  synthetic order stays internally consistent across its own revisions. JJ's call (slice 02): note
  and move on, not fixed. No case in this plan asserts `orderId`'s value or derivation.
- **Registering an emit from this toolset needs a different pattern from BUSY-1160's.** There is no
  `--reference` override; the reference comes from the fixture JSON's own `reference` field, fixed
  per fixture set. All 19 `fixtures/wholesale/*.json` share one reference (`982409Aug26`), one
  continuous order narrative revised fixture-by-fixture, not 19 separate orders; both
  `fixtures/rtv/*.json` share `RTV1161Sep26`. See the note added to
  `../BUSY-1160/SYNTHETIC-REGISTER.md`'s register section, seq 17.
