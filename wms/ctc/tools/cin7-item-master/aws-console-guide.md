# Manhattan sync — testing via the AWS Console

If you'd rather click through the AWS web console than run scripts, this covers the same steps
as `README.md`, in the same order. Replace `<stage>` with the environment you're testing (e.g.
`staging`) and `<store>` with `us` or `ps` throughout — every resource name follows this pattern.

**Two stores, one shared back half.** The Manhattan stack (as of 2026-07-15) reads attribute
changes from both the `us` and `ps` catalog tables. Each store has its own DynamoDB table, its
own `erp-update` Lambda, and its own `enrich-item` Lambda/queue — but there's only ONE shared
`item-sender` Lambda and ONE shared buffer queue/DLQ for both stores combined. Wherever a step
below says "per store," do it once for each store you're testing; wherever it says "shared,"
there's only one to look at regardless of which store's item you triggered.

## 1. Check queue status (equivalent of `check-status.sh`)

1. Go to the **SQS** console (search "SQS" in the top search bar, or navigate directly).
2. Make sure the region selector (top right) is set to **Asia Pacific (Sydney) — ap-southeast-2**.
3. In the queue list search box, type `<stage>-catalog-manhattan` to filter to these 6 queues:
   - `<stage>-catalog-manhattan-us-item-eda-queue.fifo` (per store)
   - `<stage>-catalog-manhattan-us-item-eda-dlq.fifo` (per store)
   - `<stage>-catalog-manhattan-ps-item-eda-queue.fifo` (per store)
   - `<stage>-catalog-manhattan-ps-item-eda-dlq.fifo` (per store)
   - `<stage>-catalog-manhattan-item-buffer-buffer.fifo` (shared)
   - `<stage>-catalog-manhattan-item-buffer-dlq.fifo` (shared)
4. The **Messages Available** and **Messages in Flight** columns show directly in the list —
   no need to click into each queue. A clean/idle state is 0 in both columns for all 6 queues.
5. Any `-dlq.fifo` queue showing a number above 0 means an item exhausted all its retries —
   click into that queue, then **Send and receive messages** → **Poll for messages** to see the
   actual item that got stuck.

## 2. Find a test variant (equivalent of `find-test-variant.sh`)

`test-skus.txt` (in this folder) already has a confirmed set of products for testing on
staging/manhattan from Chris — all on the `us` store. Use this as the default — it should cover
almost everything for `us` testing. This same file is shared across both stores (not split
per-store), so if you add a `ps` entry, note in the file which store it belongs to. Only fall
back to browsing below if it genuinely doesn't cover what you need.

1. Go to the **DynamoDB** console, region **ap-southeast-2**.
2. Click **Tables** in the left sidebar, then open `<stage>-<store>-catalog` (there's a separate
   table per store — `<stage>-us-catalog` and `<stage>-ps-catalog`).
3. Click **Explore table items**.
4. In the query box, set the partition key filter to a product ID you want to inspect, or use
   **Scan** with a filter of `SKU begins_with PRD#` to browse products.
5. Once you have a product's ID (e.g. `411843`), query again with partition key `ID = 411843` (no
   filter) to see that product's row plus all its `VAR#<variant-id>` rows — pick any variant SKU
   from there.
6. To see a variant's current attribute values: switch to the **product-attribute-index** index
   (dropdown near the query box) and query with partition key `SKU = VAR#<variant-id>` — this
   lists every `ATT#<name>` row for that variant.

### Finding a variant's parent product (needed for Task 2's product-level attributes)

`product_group_id`, `sub_group_id`, and `is_giftcard` live on the *parent product* row, not the
variant — to edit one of these for a variant already in `test-skus.txt`, you need that variant's
parent `PRD#<id>`. The same **product-attribute-index** query from step 6 above already returns
it: alongside the `ATT#<name>` rows, one result is the variant's own root row — its `ID` field
does **not** start with `ATT#`, and that `ID` value is the parent product's numeric ID (variants
share their parent's partition key). That row's `ID`, prefixed with `PRD#`, is the SKU to use in
step 3 below. (The equivalent CLI script, `find-parent-product.sh`, automates this lookup.)

## 3. Trigger a test change (equivalent of `trigger-test-change.sh`)

**Only do this for a variant you've confirmed is safe, disposable test data** — this writes
directly to the target store's catalog table.

1. In the DynamoDB console, on the `<stage>-<store>-catalog` table (make sure you're on the right
   store's table), use **Explore table items** and query with partition key `ID = ATT#weight`
   (or whichever attribute you're testing) and sort key `SKU = VAR#<variant-id>`.
2. Click the row, then **Edit item**.
3. Change the `Value` field to your new test value, and **Save changes**.
4. Only attributes on the Manhattan allowlist actually trigger a sync: `size`, `colour`,
   `weight`, `height`, `length`, `width`, `dimension_uom`, `conversion_rate`, `qty_uom`,
   `ean`, `additional_eans`, `displayname`, `vendor_name`, `product_group_id`, `sub_group_id`,
   `is_giftcard`. Editing anything else (e.g. `price`) is a valid negative test — it should
   trigger nothing.
5. Both kinds of change count as a valid positive test: setting an attribute that doesn't
   already exist on the variant (a `create_attribute` event) and changing one that does (an
   `update_attribute` event) — the enrich worker is subscribed to both.
6. `additional_eans` needs a DynamoDB **List** value, not a String — in the item editor, switch
   that field's type to `List` and add one `String` entry per barcode.
7. **Product-level attributes** (`product_group_id`, `sub_group_id`, `vendor_name`,
   `is_giftcard`) use sort key `SKU = PRD#<parent-id>` instead of `VAR#<variant-id>` — see
   "Finding a variant's parent product" above for how to get that ID. Since Task 4 (BUSY-1047),
   this write alone fans out immediately to every one of that product's variants — see "Testing
   category/sub-category fan-out" below for the full walkthrough. You no longer need to trigger a
   separate variant-level change afterward.

## 4. Watch it flow through (equivalent of `tail-logs.sh`)

1. Go to the **CloudWatch** console → **Log groups** (left sidebar, under Logs), region
   **ap-southeast-2**.
2. Search for `<stage>-catalog-manhattan` to find the relevant log groups:
   - `/aws/lambda/<stage>-catalog-manhattan-us-enrich-item` (per store — match whichever store
     you triggered the change on)
   - `/aws/lambda/<stage>-catalog-manhattan-ps-enrich-item` (per store)
   - `/aws/lambda/<stage>-catalog-manhattan-item-sender` (shared — one for both stores)
   - `/aws/lambda/<stage>-catalog-manhattan-item-buffer-buffer-handler` (shared — one for both stores)
3. Open the **enrich-item** log group for the store you triggered the change on, click the most
   recent log stream (sorted by last event time). You should see a log line starting `Enriched
   item record for variant ...` within a few seconds of your change — that confirms the change
   was picked up and enriched. For a PRD#-level change (Task 4 fan-out), look for `Fanning
   PRD#<id> out to N variant record(s).` followed by one `Enriched item record for variant ...`
   line per variant instead.
   - If instead you see `Ignoring non-allowlisted attribute`, `Ignoring non-parent-sourced
     attribute`, or `Ignoring unrecognised SKU`, that's the expected outcome for a negative test
     (an attribute not on the relevant allowlist, or a SKU that's neither `VAR#` nor `PRD#`).
4. **Wait up to 3 minutes** — changes are batched before sending, not sent instantly.
5. Open the **buffer-handler** log group (shared, no store to pick), most recent log stream. Since
   it's shared, its stream interleaves sends from both stores — look for the entry matching your
   test's timing. Look for:
   - `Sent 1 messages to processor.` followed by `Deleted 1 messages from the queue.` — this is
     the clearest confirmation a send succeeded.
   - `Deleted 0 messages from the queue.` — the send attempt failed and will retry automatically
     (up to 10 times over roughly 30 minutes) before landing in the DLQ.
6. The **item-sender** log group (shared, no store — its stream interleaves both stores' sends)
   logs, on **every** attempt (success or failure):
   - `Sending N item(s) to Manhattan SCALE (M before coalescing).` — `N` and `M` differ when
     several rapid edits to the same variant collapsed into a single send (Task 2's coalescing
     behavior): `M` is the raw count of events in this invocation, `N` the count after collapsing
     to one record per variant.
   - `Manhattan ItemDownload payload: <xml>` — the actual outgoing XML, one line per group once
     packed into ≤1MB payloads (usually just one line, unless enough items were batched to need
     more than one payload). Grep this for Task 2 fields to confirm they landed correctly, e.g.
     `<Color>`, `<XRefItem>` (barcodes), `<SerialNumTrackOutbound>` (gift card flag),
     `<Height>`/`<Length>`/`<Width>`.
   - `Manhattan ItemDownload response: accepted=X rejected=Y message="..."` — the definitive
     success/failure signal. `rejected=0` means Manhattan accepted it; `rejected>0` means a
     business-level rejection, with the reason in `message`. Manhattan always returns HTTP 200,
     so this line — not an HTTP status — is what actually tells you whether the send worked.
   - On a rejection, an `ERROR` line follows immediately: `Rejected group of X item(s) out of Y
     in this invocation (Z before coalescing).` — `X` is the size of the specific group that got
     rejected; `Y`/`Z` give the full invocation's scope in case the batch was packed into
     multiple groups (so a rejection in one group doesn't read as if it were the whole batch).
   - A separate `ERROR` line (`Failed to send batch to Manhattan SCALE: ...`) means the request
     never got a response from Manhattan at all (auth/network failure), distinct from a
     business-level rejection above.

## 5. Confirm nothing's left stuck

Repeat step 1 (queue status) — everything back to 0 means the test item was delivered
successfully and cleaned up. Anything sitting in a `-dlq.fifo` queue needs investigation before
you consider that test case complete.

## 6. Testing Layer A — NetSuite → Catalog (equivalent of `trigger-netsuite-update.sh`)

Everything above tests Layer B (Catalog → Manhattan) only, by editing a Catalog attribute
directly. Layer A is the other end of the pipeline — a real NetSuite payload arriving at the
`erp-update` Lambda, running through `rules.ts`'s extraction rules and the mappings-table filter
before it ever reaches the Catalog. There's no sensible way to hand-build that payload safely
through the console (it has to reproduce every one of the target SKU's *existing* attributes, or
re-running the rules blanks them out) — instead, generate it with the script and paste it in:

1. Run `./trigger-netsuite-update.sh --stage <stage> --profile <profile> --sku VAR#<id> --store
   <store>` **without** `--confirm` — this only reads from DynamoDB and prints the reconstructed
   payload; it invokes nothing.
2. Copy the JSON block under `=== Reconstructed synthetic NetSuite payload ===`.
3. Go to the **Lambda** console, region **ap-southeast-2**, and open
   `<stage>-<store>-catalog-erp-update` (per store — this Lambda exists once per store, matching
   whichever store's table the SKU is on).
4. Click the **Test** tab → **Create new event** → paste the copied JSON as the event JSON → **Test**.
5. Check the response at the top for `"processed": 1, "missing_info": []` — anything in
   `missing_info` means a validation error (check the message).
6. Continue from step 4 above (**Watch it flow through**) exactly as for a Layer B test — the
   `<store>-enrich-item` log group fires first, then the shared `sender`/`buffer-handler` groups
   after the 3-minute window.

**Current limitation:** `--product-group-id`/`--sub-group-id`/`--displayname` build a payload
with `custitem_product_group`/`custitem_sub_category`/`displayName` set, but `rules.ts` has no
extraction rule producing `product_group_id`, `sub_group_id`, or `displayname` on this branch yet
(that's Task 3 / BUSY-1045, code-complete but not yet merged forward) — those three fields won't
actually land in the Catalog from a Layer A test until it is. Test them via Layer B
(`trigger-test-change.sh`/step 3 above) in the meantime.

## 7. Testing category/sub-category fan-out (Task 4 / BUSY-1047)

Changing a product's `product_group_id`/`sub_group_id` (or `vendor_name`/`is_giftcard`) is a
product-level (`PRD#`) write — no variant event fires for it on its own, so before this task
nothing synced until some other, unrelated variant-level change happened to fire later. Task 4
adds fan-out: the `enrich-item` Lambda now reacts to `PRD#` events for these four attributes
directly, reads the product's current variants, and emits one fresh record per variant.

1. Pick any variant from `test-skus.txt`, resolve its parent (see "Finding a variant's parent
   product" above), then find that product's full variant set on that same store's table —
   either query the table directly with partition key `ID = <numeric-id>` and sort key `SKU
   begins_with VAR#`, or run `./find-product-variants.sh --stage <stage> --profile <profile>
   --store <store> --sku PRD#<id>`. If it only has one variant, the fan-out will still work but
   won't demonstrate the "every variant" part of the feature — pick a product with 2+ variants if
   you want that visible.
2. Edit `ATT#product_group_id` (or `sub_group_id`) on the `PRD#<id>` row directly (step 3 above,
   but with `SKU = PRD#<id>`).
3. Open the **`<store>`-enrich-item** log group immediately — look for `Fanning PRD#<id> out to N
   variant record(s).` where `N` matches the variant count from step 1, followed by one `Enriched
   item record for variant ...` line per variant.
4. Wait up to 3 minutes, then check the shared **item-sender** log group's logged XML for each
   variant — every one should show the same new `<ItemClass><ItemClass>PPP-SSS</ItemClass></ItemClass>`
   (zero-padded product/sub-group codes), proving the category change reached all of them, not
   just the variant you happened to start from.
5. Confirm nothing's stuck afterward with the queue-status check (step 1).

## 8. Testing resilience & observability (Task 5 / BUSY-1048)

Task 5 doesn't change what's sent to Manhattan — it adds a validation gate before enrichment, more
structured metrics on the sender, one shared CloudWatch dashboard, and CloudWatch alarms (DLQ
depth + validation-failure rate) with an SNS alert topic. `check-status.sh`'s CLI equivalent
already covers alarm states and the dashboard link — this section is the click-through version.

### Viewing the dashboard

1. Go to the **CloudWatch** console → **Dashboards** (left sidebar), region **ap-southeast-2**.
2. Open `<stage>-catalog-manhattan-dashboard`.
3. Throughput, queue depth, and DLQ-depth widgets are duplicated once per store — look for `[us]`/
   `[ps]` in the widget titles. Everything downstream of the shared buffer (SCALE request outcome,
   items sent/delivered, sync lag, payload size, coalescing ratio) is one shared widget set
   regardless of which store's item triggered it.

### Checking alarm states

1. Go to the **CloudWatch** console → **Alarms** → **All alarms**, region **ap-southeast-2**.
2. Search for `<stage>-catalog-manhattan` to find all 5:
   - `<stage>-catalog-manhattan-us-enrich-dlq-depth` / `-ps-enrich-dlq-depth`
   - `<stage>-catalog-manhattan-us-validation-failures` / `-ps-validation-failures`
   - `<stage>-catalog-manhattan-send-dlq-depth` (shared)
3. All should show **OK** in a healthy stage. See the README's Task 5 section for why actually
   forcing one of these into `ALARM` isn't a realistic QA action with normal test data — the DLQ
   alarms need the same message to fail 10 times in a row, and the validation-failure alarm needs
   11+ genuine failures inside one 15-minute window, for one store.
4. To confirm the **SNS notification wiring** itself (without needing to actually break anything):
   open the alarm → **Actions** → **Set alarm state** (or use `aws cloudwatch set-alarm-state`,
   see the README) → set to `ALARM` → confirm the subscriber received a notification → set back to
   `OK` afterward.

### Testing the validation/eligibility skip

1. The enrich worker (not the sender) checks each record before it's ever emitted — an item
   missing `desc` (falls back through `displayname` → `vendor_name`+`colour`+`size`) gets logged
   and silently dropped, never reaching the buffer/sender. Clear all four of those fields on one
   test variant/product (step 3 in section 3 above, applied to each field) to trigger it for real.
2. Open the **`<store>`-enrich-item** log group — look for a JSON log line with
   `"metric":"ManhattanValidationFailure"` and `"reason":"missing_desc"`.
3. Confirm the item never appears in a later **item-sender** batch — its absence, not an error, is
   the signal.

### Testing the defaulted-weight metric

1. Pick (or edit) a test variant with no `ATT#weight` row at all, then change any other
   allowlisted attribute on it (step 3 in section 3 above).
2. Open the **item-sender** log group (not enrich) — look for
   `"metric":"ManhattanDefaultedWeight"` with `weight` listed in `missing_fields`. The item still
   sends normally — weight defaults to `0`, it isn't skipped.

### SCALE request outcome buckets

The sender classifies every send attempt (success / rejected / client_error / server_error /
network_error / unknown_error) with its own dashboard line. Only `success` (any normal test) and
`client_error` (temporarily corrupting the Manhattan OAuth secret's `client_secret`) are
realistically triggerable on demand — and the latter affects every store's sends until fixed, not
just the one under test, so treat it as a deliberate, disruptive action rather than a routine
check. `rejected` only shows up if Manhattan's real staging endpoint actually rejects a
transaction; `server_error`/`network_error`/`unknown_error` aren't realistically QA-triggerable at
all — leave those as dashboard/alarm safety nets, not test targets.
