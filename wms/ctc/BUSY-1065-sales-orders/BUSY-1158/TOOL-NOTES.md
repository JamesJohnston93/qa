# BUSY-1158 tool notes

Bugs found in the testing scripts themselves, and what was changed. A failing case is not a system
defect until the tool has been ruled out.

* `../../tools/cin7-sales-orders/check-ctc-consumer-guards.sh` extended in slice 02, TC4b: added
  `staging-shipping-v2-dc-packing-shipment-create` and `staging-shipping-v2-shopify-move-fulfilment-orders`,
  both SKIP-MARKER kind, using the exact guard lines observed live against reference `261115` (see
  `results/02-consumer-stance-live-order.md`). Purely additive, the seven pre-existing rows are
  unchanged, so no earlier BUSY-1159 or BUSY-1158 result is affected by this change. Not re-run against
  BUSY-1159's fixtures this session; the two new rows have only ever been checked against `261115`.

* `faulty-sale-worker-queue-handler` logs its whole incoming SQS record body at INFO level on every
  invocation, unredacted: `customerEmail`, full shipping name and address, all present in plain text
  in CloudWatch. Every other consumer log group read in slice 01 logs a short guard/skip line only, not
  the record. A broad `filter-log-events` pattern (e.g. `?"CTC" ?"skip"`) against this specific log
  group will return full PII in the match. Narrow the filter to something that cannot match the record
  dump (e.g. `"Successful invocation"` or `"Failed message IDs"`) before reading this group again, and
  never widen it to catch the `INFO\t{"Records":...}` line. Not a script this plan wrote, an existing
  behaviour of a consumer it now has to read logs from.

* `staging-shipping-v2-dc-packing-shipment-create` has the same shape of problem, confirmed slice 03:
  its object-dump log lines include the customer's name and other order detail in the clear (not just
  email/address). A reference/PK-scoped `filter-log-events` call still returns these lines in full;
  the fix used this session was a narrow post-hoc regex over the raw message text (extract only
  `company`/`brand` fragments) rather than printing whole lines. Treat any `dc-packing-*` log read the
  same way: extract the specific field needed, never print or pipe a whole matched line unfiltered.

## Carried in from BUSY-1159

* `check-ctc-consumer-guards.sh` under-scanned busy shared log groups and returned a false FAIL on
  both of its RAN-kind rows. Fixed during BUSY-1159 slice 03. **Any consumer guard result taken before
  that fix is unverified.** The carried rows in `QA-DOC.md` are all post fix.
* `cin7-watermark.sh` defaults to `--poller item`. Sales order work needs `--poller so` on every call,
  and the wrong flag rewinds the item master feed. `--set` without `--confirm` is a dry run, so read
  the value back.
* `tail-logs.sh` only knows the item master lambdas. It cannot tail anything on the sales order flow.
* `invoke-so-poller.sh` can report `TooManyRequestsException` on a wide window while the real
  invocation is still running and completes normally. Check CloudWatch for the `REPORT` line before
  retrying.
