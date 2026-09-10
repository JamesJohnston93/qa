# Cin7 item master → Manhattan SCALE Items — testing tools

Tools for the **item master** pipeline: Cin7 item master → SCALE Items, and the older UNI
`us`/`ps` catalog sync. A separate flow from the sales-order tools in `../cin7-sales-orders/`,
kept alongside them because the two share a Cin7 source and a SCALE target.

Task numbering below (Task 2–5) refers to the item-master epic's own tasks.

Cin7 credentials, where a tool needs them, come from a `.env` at the toolset root — see
`../.env.example`. Shared tools live in `../common/`.

## Manhattan sync — QA testing tools

**Provenance:** copied from `~/UniversalStore/manhattan-qa-tools/` on 2026-07-17 as the starting
point for BUSY-1067 (CTC/Cin7) testing tools — this epic is a continuation of the same Manhattan
item-sync pipeline the UNI epic (BUSY-1052) built, so the tooling continues from here rather than
starting over. **As written, every script below is UNI/us-ps-specific** (table names, Lambda
names, `--store <us|ps>` flag, queue names all assume the two existing catalog-backed stores).
CTC is explicitly *not* a catalog-backed store (per the main LLD, `lld-ctc-item-master-sync.md`,
§2) — it's a separate Cin7 poller feeding the same shared buffer/sender. **Update (BUSY-1114):**
`../common/cin7-watermark.sh` and `find-cin7-item.sh` are the first CTC-specific companions — see the
"Cin7 / CTC" section below. Everything else in this file is still UNI/us-ps-specific as
described above; extend with further Cin7-specific scripts as BUSY-1115–1117 land, rather than
editing the `us`/`ps` behaviour these already cover.

---

Scripts for testing the Catalog → Manhattan SCALE WMS sync (BUSY-1044, BUSY-1046's fuller item
payloads, BUSY-1045's Layer A NetSuite→Catalog fields, BUSY-1047's category/sub-category
fan-out, and BUSY-1048's resilience/observability additions) without needing deep AWS/CLI
familiarity. These live outside the codebase on purpose — they're QA tooling, not shipped code.

**Prerequisites:** AWS CLI installed and configured with a profile that has access to the target
stage/account, and `python3` on your PATH (used for parsing JSON output — already on macOS by
default).

### Two stores: us and ps

The Manhattan stack is store-independent as of 2026-07-15 — it reads attribute changes from
**both** the `us` and `ps` catalog tables and funnels them into one shared buffer/sender. Every
script that touches a specific catalog table or the per-store enrich Lambda now takes a `--store
<us|ps>` flag, defaulting to `us` if omitted (so every example below still works unchanged for
`us` testing). The shared back half (buffer + sender) is store-independent, so `tail-logs.sh
--lambda sender`/`--lambda buffer` ignore `--store` entirely — there's only one of each,
regardless of which store's item triggered the send. `check-status.sh` with no `--store` shows
both stores' enrich queues plus the one shared buffer. `test-skus.txt` is a single, shared
allowlist across both stores (not split per-store) — when adding a new entry, note which store it
actually lives on and always pass the matching `--store`.

### Cin7 / CTC (BUSY-1114)

CTC has no Cin7 Omni platform access and no catalog-backed table to write test data into — the
Cin7 poller reads Cin7's API directly (read-only), so there's no `trigger-*`-style script for it.
Testing means controlling what the poller re-reads, not creating data:

**Credentials, once (this directory isn't a git repo, so nothing gets committed):** create a
file named `.env` right here in `testing-tools/`:
```
CIN7_USERNAME=your-username-here
CIN7_API_KEY=your-api-key-here
```
Both `find-cin7-item.sh` and `preview-cin7-sync.sh` auto-load it — no need to `export`/`source`
anything yourself. (`--username`/`--api-key` flags still work too, but avoid them day-to-day —
they land in shell history and `ps` output.)

1. **`find-cin7-item.sh`** — look up a real reference item first (an active Public/Primary one,
   and — if one exists — an Inactive product or Disabled option). **GET-only, always** — Cin7 is
   a real production system for CTC; this script must never write to it.
2. **`preview-cin7-sync.sh`** — before touching the real watermark, dry-run what a candidate
   value would actually do: makes the *exact same request* the poller makes (`where=modifiedDate>`,
   `order=modifiedDate ASC`, full pagination), then applies the same active-status gate to show
   you precisely which item codes would be emitted to Manhattan, which would be skipped as
   inactive, and what the watermark would advance to — all without changing anything. Same
   credential model and GET-only guarantee as `find-cin7-item.sh`.
3. **`../common/cin7-watermark.sh --poller item`** — once you're happy with the preview, set the watermark to that same
   **UTC** timestamp for real (defaults to a dry run; pass `--confirm` to actually write). The
   poller re-reads on its next scheduled cycle (every 3 minutes); allow ~10 minutes total
   including the buffer flush before checking Manhattan SCALE staging.
4. **`check-option-modified-date.sh`** (BUSY-1115) — answers OQ-2 (does editing a ProductOption
   bump its parent Product's own `modifiedDate`?) without editing anything: pulls real
   recently-modified `/ProductOptions`, resolves each one's parent `/Products` row, and compares
   modifiedDate values. Run this **before** building BUSY-1115's `/ProductOptions` trigger-fan-in —
   if it turns out edits do always bump the parent, that entire trigger source is unnecessary and
   the poller can stay `/Products`-only.

All four scripts are independent of the `us`/`ps` scripts above — no `--store` flag, no catalog
table access, no shared queue interaction. See the BUSY-1114 QA Handover doc (linked from the
ticket) for full test cases built around this workflow.

**Open gaps, not yet built:**
* No way to look up a specific item's Manhattan SCALE state directly (QA currently uses SCALE's
  own UI/search) — so `preview-cin7-sync.sh` can tell you what *should* land, but not yet confirm
  it actually did.
* Cin7 status-based filtering in `find-cin7-item.sh` is client-side against the most-recently-
  modified page(s) only — it can't filter server-side by status, and won't find a matching item
  outside the pages it checks (`--max-pages` extends this at the cost of more requests).
* No script surfaces the poller's own *actual* recent cycle history (fetched/emitted/skipped
  counts from a real run) — `preview-cin7-sync.sh` simulates what a cycle *would* do, but reading
  what already happened is still only visible via raw CloudWatch Logs.

### What each script does

| Script | Purpose | Writes anything? |
| --- | --- | --- |
| `check-status.sh` | Shows queue depths (both stores' enrich queues + the shared buffer), CloudWatch alarm states, and the dashboard URL | No — read-only |
| `find-test-variant.sh` | Last resort: finds a real product/variant outside the confirmed set in `test-skus.txt` | No — read-only |
| `find-parent-product.sh` | Resolves a variant's parent product SKU (`PRD#<id>`) — needed for Task 2's product-level attributes | No — read-only |
| `find-product-variants.sh` | Lists every variant SKU under a product — needed for Task 4's fan-out verification | No — read-only |
| `trigger-test-change.sh` | Bumps an attribute on a variant or product to trigger a sync (Layer B only — writes directly to the Catalog) | **Yes** — only for SKUs in `test-skus.txt` (or a product reached via one, see below) |
| `trigger-netsuite-update.sh` | Simulates a real NetSuite payload hitting Layer A (`erp-update`) — the full chain, not just Layer B | **Yes** (unless run without `--confirm`, the default) — only for SKUs in `test-skus.txt` |
| `tail-logs.sh` | Streams recent logs from one of the 3 Lambdas, with hints on what success/failure looks like | No — read-only |
| `../common/cin7-watermark.sh --poller item` | Views or sets the **item** poller's watermark (BUSY-1114) — the actual test lever for CTC, since Cin7 test data can't be created/edited. `--poller` defaults to `item`, but pass it explicitly so the intent is visible | View: no. Set: **yes**, only with `--confirm` (dry run otherwise) |
| `find-cin7-item.sh` | Looks up real Cin7 products/options by status (BUSY-1114) — finds a reference item before testing, since data can't be created to order | No — read-only, GET-only against Cin7 always |
| `preview-cin7-sync.sh` | Dry-runs a candidate watermark against the poller's exact query + active-status logic (BUSY-1114) — shows what would emit/skip and what the watermark would advance to, before you commit to it | No — read-only, GET-only against Cin7 always; never touches the real watermark |
| `check-option-modified-date.sh` | Answers OQ-2 (BUSY-1115) — compares real ProductOptions' modifiedDate against their parent Product's, to test whether option edits bump the parent | No — read-only, GET-only against Cin7 always |

All scripts take `--stage <stage>` and `--profile <profile>` (your AWS CLI profile name for that
account); table/Lambda-scoped scripts also take `--store <us|ps>` (default: `us`). Run any script
with no arguments to see its usage.

### A typical test walkthrough

1. **Check you're starting clean:**
   ```
   ./check-status.sh --stage staging --profile staging
   ```
   All queues (both stores' enrich queues plus the one shared buffer) should show 0 waiting / 0
   in-flight. If not, something from a previous test run may still be in flight — wait a few
   minutes and check again, or ask an engineer. Pass `--store us`/`--store ps` to narrow to just
   one store's enrich queue plus the shared buffer.

2. **Pick a test variant from `test-skus.txt`.** This is the default, and should cover almost
   everything — it's a confirmed set of ~100 real staging variants (sourced from
   `wms_testing_products.txt`) already verified present with real attributes. Reach for
   `find-test-variant.sh` only if this set genuinely doesn't cover what you need (e.g. testing at
   a larger scale than it has, or a specific attribute combination it doesn't include):
   ```
   ./find-test-variant.sh --stage staging --profile staging
   ```
   Any newly-found SKU still needs adding to `test-skus.txt` before `trigger-test-change.sh` will
   accept it — the allowlist doesn't grow itself.

3. **Trigger a change** (any variant/attribute from `test-skus.txt` works — the example below is
   illustrative, not prescriptive):
   ```
   ./trigger-test-change.sh --stage staging --profile staging \
     --sku VAR#34157244 --attribute weight --value 0.5
   ```
   Worth knowing: setting an attribute that doesn't already exist on the variant (a
   `create_attribute` event) and changing one that does (an `update_attribute` event) both
   trigger the sync — the enrich worker is subscribed to both event types, so either is a valid
   test.

4. **Watch it flow through**, in order:
   ```
   ./tail-logs.sh --stage staging --profile staging --lambda enrich --store us
   ```
   (`--store` matters here — there's a separate enrich Lambda per store; match whichever store
   you triggered the change on.) This should fire almost immediately. Then **wait up to 3
   minutes** (the sync batches changes on a fixed schedule before sending) and check:
   ```
   ./tail-logs.sh --stage staging --profile staging --lambda sender
   ```
   or
   ```
   ./tail-logs.sh --stage staging --profile staging --lambda buffer
   ```
   The `buffer` log's `"Deleted 1 messages from the queue."` line is the clearest single
   confirmation that an item was actually delivered.

5. **Confirm nothing's stuck:**
   ```
   ./check-status.sh --stage staging --profile staging
   ```
   Back to all zeros means it went through cleanly. A message sitting in a `*-dlq.fifo` queue
   means it failed all 10 retry attempts — check the sender log for why.

**Testing the PS store instead of US:** every command above works identically with `--store ps`
added — e.g. `./trigger-test-change.sh --stage staging --profile staging --store ps --sku
VAR#<id> --attribute weight --value 0.5` and `./tail-logs.sh --lambda enrich --store ps`. The
buffer/sender steps (4's second half, and step 5) don't need `--store` at all — they're shared
across both stores. Make sure any SKU you use with `--store ps` actually exists on the `ps`
table (add it to `test-skus.txt` after confirming with `find-test-variant.sh --store ps`).

### Task 2 (BUSY-1046) test scenarios

Task 2 fills out the rest of the item payload (colour, barcodes, real weight/dimensions, the
gift-card flag) and keeps send volume sane (coalescing repeat edits, packing several items per
payload). The `item-sender` Lambda now logs the full outgoing XML, the raw Manhattan response, and
an `accepted=.../rejected=.../message="..."` summary on **every** send attempt, not just
failures — that's the main new tool for verifying these scenarios: no DynamoDB console round-trip
needed to see what was actually sent.

- **New fields land correctly.** Trigger a `colour`, `height`, `length`, or `width` change on any
  `test-skus.txt` variant, then `tail-logs.sh --lambda sender` and grep the logged XML for the
  matching tag (`<Color>`, `<Height>`, etc.) once the 3-minute buffer window has passed.

- **Barcodes.** `additional_eans` is a DynamoDB list, not a string —
  `trigger-test-change.sh` handles this automatically:
  ```
  ./trigger-test-change.sh --stage staging --profile staging \
    --sku VAR#34157244 --attribute additional_eans --value "9312345678901,9312345678902"
  ```
  Confirm the sender's logged XML has one `<XRef>` block per barcode (plus one more for `ean`
  itself, if set).

- **Gift-card flag.** `is_giftcard` (and `product_group_id`/`sub_group_id`/`vendor_name`) live on
  the *parent product*, not the variant — resolve a safe parent from any allowlisted variant
  first:
  ```
  ./find-parent-product.sh --stage staging --profile staging --sku VAR#34157244
  # → PRD#<id>
  ./trigger-test-change.sh --stage staging --profile staging \
    --sku PRD#<id> --via-variant VAR#34157244 --attribute is_giftcard --value true
  ```
  **Since Task 4 (BUSY-1047), this write alone fans out immediately** to every variant of
  `PRD#<id>` — see the Task 4 section below for the full walkthrough. Check any of the sender's
  logged XML for that product for `<SerialNumTrackOutbound>Y</SerialNumTrackOutbound>`.

- **Coalescing.** Trigger two different attribute changes on the *same* variant within the
  3-minute buffer window (e.g. `colour` then `weight`, a minute apart). The sender log's
  `Sending N item(s) to Manhattan SCALE (M before coalescing).` line should show `N < M` —
  proof the repeat edits collapsed into a single send rather than two.

- **Packing/volume** (a smoke check, not a boundary test — forcing the real 1MB payload cap this
  way isn't practical, and that boundary is already covered by unit tests). Loop
  `trigger-test-change.sh` across several `test-skus.txt` entries inside one 3-minute window, then
  confirm the sender log shows all of them landing across one or more grouped payloads.

### Task 3 (BUSY-1045) test scenarios — Layer A end-to-end

Task 3 is the *other end* of the pipeline: NetSuite → Catalog (not Catalog → Manhattan). Every
scenario above uses `trigger-test-change.sh`, which writes a Catalog attribute directly — that
tests Layer B only, and never exercises `rules.ts`'s extraction rules or the mappings-table
enabled-origins filter that Layer A actually adds. `trigger-netsuite-update.sh` closes that gap: it
invokes the real `erp-update` Lambda with a synthetic-but-realistic NetSuite payload, so a test run
covers the **full** chain — NetSuite payload → `rules.ts` → mappings filter → Catalog write → Layer
B → Manhattan — in one go.

**Why this script reads before it writes.** Re-running the real extraction rules against a
hand-built payload means *every* field `rules.ts` produces gets re-evaluated, not just the one
you're testing — a field your payload doesn't include resolves to nothing and would silently blank
out that variant's real, currently-stored value otherwise. So before building the payload, the
script reads the target variant's and its real parent product's *current* attributes and
reconstructs a raw NetSuite payload that reproduces every one of them (reversing the few `rules.ts`
transforms where needed — `category`'s text/code table, etc.) — the fields you're actually testing
are the only ones deliberately overridden. Re-running it against the same SKU repeatedly is safe.

**Defaults to a dry run.** Without `--confirm`, it prints the reconstructed payload and a
before/after summary of the fields under test, and invokes nothing. Always look at this first.

```
./trigger-netsuite-update.sh --stage staging --profile staging --sku VAR#34157244
```

Once it looks right, re-run with `--confirm` to actually invoke `erp-update`:

```
./trigger-netsuite-update.sh --stage staging --profile staging --sku VAR#34157244 \
  --height 15.2 --length 22.0 --width 8.5 --confirm
```

All of the new fields have sensible defaults if you don't pass them — see the script's header
comment for the full list (`--height`/`--length`/`--width`/`--dimension-uom`/`--conversion-rate`/
`--qty-uom`/`--weight-uom`/`--product-group-id`/`--sub-group-id`/`--displayname`).

- **New dimension/UOM fields land correctly.** Run with defaults (or your own values), then
  `tail-logs.sh --lambda enrich` (fires within seconds) and, after the 3-minute buffer window,
  `tail-logs.sh --lambda sender` — grep the logged XML for `<Height>`, `<Length>`, `<Width>`,
  `<DimensionUm>`, `<ConvQty>`, `<QtyUm>`, `<WeightUm>`.

- **Zero-padding.** `--product-group-id 5` and `--sub-group-id 42` should come through the Catalog
  as `'005'`/`'042'` — confirm directly: `aws dynamodb get-item ... --key
  '{"ID":{"S":"ATT#product_group_id"},"SKU":{"S":"PRD#<id>"}}'` (the script prints the resolved
  `PRD#<id>` for you).

- **Enabled-origins filter (the other half of Layer A).** If a field isn't showing up in the
  Catalog after a run, check whether it actually has an ENABLED `ERP`/`ORIGIN` mappings row for
  this stage — Layer A's extraction rule producing a value is necessary but not sufficient; see
  the `libs/mapping-engine` gate in the main LLD. This is a mappings-service question, not
  something this script can fix — it can only tell you the rule ran.

- **`displayname`.** Defaults to a timestamped, obviously-synthetic string
  (`QA E2E Test VAR#<id> <timestamp>`) so it's unambiguous in the Catalog which value came from a
  test run — pass `--displayname` to set your own.

**Current limitation, worth knowing before you spend time debugging it:** `--product-group-id`,
`--sub-group-id`, and `--displayname` build a payload with `custitem_product_group`/
`custitem_sub_category`/`displayName` set correctly, but `rules.ts` has no extraction rule
producing `product_group_id`, `sub_group_id`, or `displayname` on this branch yet — that's Task 3
/ BUSY-1045's own work, code-complete but deliberately not yet merged into this branch. Until it
is, a Layer A run with those flags invokes `erp-update` successfully but the three fields simply
won't appear in the Catalog afterward (no rule consumes the payload field you set). Test them via
Layer B (`trigger-test-change.sh`) in the meantime — see the Task 4 section below.

Once Task 3 *is* merged forward, note that a real NetSuite `item.updated` payload writes
`product_group_id`/`sub_group_id`/`vendor_name` to the *parent product* row, same as any other
product-level write — so a `trigger-netsuite-update.sh --product-group-id ...` run will also
trigger Task 4's fan-out (below), emitting a record for every variant of that product, not just
the one `--sku` you targeted. That's expected, not a bug.

### Task 4 (BUSY-1047) test scenarios — category/sub-category fan-out

Almost everything Manhattan needs lives on the variant, so ordinary variant edits already cover
it — except `ItemClass` (category/sub-category), which is product-level. Before this task, a
`product_group_id`/`sub_group_id` change on a `PRD#<id>` row didn't sync to Manhattan until some
unrelated variant-level change happened to fire later. Task 4 makes the enrich worker react to
`PRD#` events for `product_group_id`, `sub_group_id`, `vendor_name`, and `is_giftcard` directly,
reading the product's current variants and emitting one fresh record per variant — immediately,
not on the next incidental variant edit.

- **Confirm the fan-out reaches every variant.** Pick any `test-skus.txt` variant, resolve its
  parent, then find its full sibling set:
  ```
  ./find-parent-product.sh --stage staging --profile staging --sku VAR#34157244
  # → PRD#<id>
  ./find-product-variants.sh --stage staging --profile staging --sku PRD#<id>
  # → one VAR#<id> per line, plus a count on stderr
  ```
  A product with only one variant will still exercise the fan-out code path correctly, but won't
  visibly demonstrate the "every variant" part of the feature — pick one with 2+ variants if you
  want that visible in the logs.

- **Trigger the change:**
  ```
  ./trigger-test-change.sh --stage staging --profile staging \
    --sku PRD#<id> --via-variant VAR#34157244 --attribute product_group_id --value 5
  ```
  `find-parent-product.sh`/`trigger-test-change.sh`'s own re-derivation still requires
  `--via-variant` to be an allowlisted variant — but the fan-out itself reaches *every real*
  variant of that product, allowlisted or not. Don't be surprised to see more variants in the logs
  than the one you used to unlock access; nothing is being mutated for those siblings, they're
  just being re-read and re-sent to Manhattan with the new category.

- **Watch it fan out**, immediately (no 3-minute wait for this part):
  ```
  ./tail-logs.sh --stage staging --profile staging --lambda enrich
  ```
  Look for `Fanning PRD#<id> out to N variant record(s).`, where `N` matches the count from
  `find-product-variants.sh`, followed by one `Enriched item record for variant ...` line per
  variant.

- **Confirm `ItemClass` landed on all of them.** After the usual 3-minute buffer window:
  ```
  ./tail-logs.sh --stage staging --profile staging --lambda sender
  ```
  Every one of that product's variants should show the same new
  `<ItemClass><ItemClass>005-000</ItemClass></ItemClass>`-style value (zero-padded
  `product_group_id`-`sub_group_id`, each side independently defaulting to `000` if blank) in its
  logged XML — proof the category change reached the whole product, not just one variant.

- **Negative test — a non-parent-sourced attribute on a `PRD#` row triggers nothing.** `colour`,
  `tags`, and similar variant-sourced display attributes can also appear on a `PRD#` row in real
  data, but changing one shouldn't fan out (their product-level value is never read into any
  record):
  ```
  ./trigger-test-change.sh --stage staging --profile staging \
    --sku PRD#<id> --via-variant VAR#34157244 --attribute colour --value Grey
  ```
  Confirm with `tail-logs.sh --lambda enrich`: you should see `Ignoring non-parent-sourced
  attribute "colour" for PRD#<id>.` and nothing further.

- **Coalescing still applies per variant.** If a fanned-out variant also has its own pending
  variant-level edit inside the same 3-minute window, the sender's coalesce collapses them the
  same way Task 2's coalescing does for repeat edits on one variant — no separate verification
  needed beyond the Task 2 coalescing scenario above.

### Task 5 (BUSY-1048) test scenarios — resilience & observability

Task 5 doesn't change what gets sent to Manhattan — it adds a validation/eligibility gate at
enrich time, extra structured metrics on the sender, a shared CloudWatch dashboard, and
CloudWatch alarms (DLQ depth + validation-failure rate) with an SNS alert topic. `check-status.sh`
already prints alarm states and the dashboard URL as part of its normal output (see the walkthrough
above) — this section covers what's actually worth deliberately testing versus what isn't.

- **Dashboard.** `check-status.sh`'s last line prints a direct console URL
  (`.../cloudwatch/home?region=...#dashboards:name=<stage>-catalog-manhattan-dashboard`). Open it
  after running a few of the scenarios above/below — throughput, queue depth, and DLQ depth are
  duplicated per store (look for `[us]`/`[ps]` in the widget titles); everything downstream of the
  shared buffer (SCALE request outcome, items sent/delivered, sync lag, payload size) is one
  shared set of widgets regardless of which store's item you triggered.

- **Validation/eligibility skip.** The enrich worker checks each record before ever emitting it
  (`enrich-item.ts`, not the sender) — an item missing `item_code` (not realistically
  triggerable; it comes from the DynamoDB key, not an attribute) or missing `desc` gets logged and
  silently dropped, never reaching the buffer/sender at all. `desc` falls back through
  `displayname` → `vendor_name + colour + size`, so triggering `missing_desc` for real means
  clearing **all four** of those on one test variant/product — genuinely awkward to set up, but
  possible:
  ```
  ./trigger-test-change.sh --stage staging --profile staging \
    --sku VAR#<id> --attribute displayname --value ""
  ```
  (repeat for `colour`/`size` on the variant and `vendor_name` on its parent via `--via-variant`).
  Confirm with `tail-logs.sh --lambda enrich --store <store>`: look for a
  `{"metric":"ManhattanValidationFailure","company":"UNI","item_code":"...","reason":"missing_desc"}` line, and
  confirm the item **never** shows up in a later `tail-logs.sh --lambda sender` batch — its
  absence, not an error, is the signal here.

- **Defaulted-weight metric.** Easier to trigger than the eligibility skip. Pick (or make) a test
  variant with no `ATT#weight` row at all, then change any other allowlisted attribute on it:
  ```
  ./trigger-test-change.sh --stage staging --profile staging \
    --sku VAR#<id> --attribute colour --value Grey
  ```
  Check the **sender's** log (not enrich's) for
  `{"metric":"ManhattanDefaultedField","field":"weight","company":"UNI","item_code":"..."}` — one
  line per defaulted field — and the item still sends normally (weight defaults to `0`, not
  skipped).

- **Coalescing / batch metrics.** Same test as Task 2's coalescing scenario above — the sender now
  also emits a `{"metric":"ManhattanBatch","received":M,"coalesced":N}` line every 3-minute flush,
  visible on the dashboard's "Coalescing ratio" widget.

- **SCALE request outcome buckets.** The sender classifies every send attempt into one of
  `success`/`rejected`/`client_error`/`server_error`/`network_error`/`unknown_error`
  (`{"metric":"ManhattanRequestOutcome","outcome":"...",...}`), each with its own dashboard line.
  Realistic QA coverage:
  - **`success`** — any normal test above with working credentials.
  - **`client_error`** (4xx) — the only outcome bucket worth deliberately forcing, and even this
    is disruptive: temporarily corrupting the `${stage}/manhattan/oauth2` secret's `client_secret`
    causes real send attempts to fail auth. **This affects every store's sends until fixed, not
    just the one you're testing** — same caution as the credential-invalidation step used earlier
    when seeding test data, and worth a heads-up to whoever else might be testing against the same
    stage at the same time.
  - **`rejected`** — needs Manhattan's real SCALE staging endpoint to actually reject a
    transaction (e.g. `rejectedTransactions != 0` in its response) — not something the catalog
    side can force on demand; only observable if/when a real send happens to get rejected.
  - **`server_error`**/**`network_error`**/**`unknown_error`** — not realistically QA-triggerable
    without controlling Manhattan's endpoint or the network path to it. Leave these as
    dashboard/alarm safety nets rather than test targets.

- **Alarms — check state, don't try to trigger for real.** `check-status.sh` already prints all 5
  alarms' current state (2 enrich-DLQ + 2 validation-failure, one per store, plus 1 shared
  send-DLQ). All should read `OK` in a healthy stage. Actually forcing one to fire isn't a
  reasonable QA action:
  - The **validation-failure alarm** needs 11+ genuine `missing_desc` failures inside one 15-minute
    window, for one store — each one independently as awkward to set up as the single scenario
    above.
  - The **DLQ alarms** need the enrich or sender Lambda to throw on **every** retry (10x) for the
    *same* message — realistically only achievable by deliberately breaking shared infra (IAM, the
    OAuth secret) for an extended period, which — same as the `client_error` case above — takes
    down sends/enrichment for every store, not just the one under test.
  - If you specifically need to confirm the **SNS wiring** works (does a subscriber actually get
    notified?) without any of the above, force an alarm into `ALARM` state directly and put it back
    afterward:
    ```
    aws cloudwatch set-alarm-state --profile <profile> --region ap-southeast-2 \
      --alarm-name <stage>-catalog-manhattan-us-enrich-dlq-depth \
      --state-value ALARM --state-reason "Manual test of SNS wiring"
    # ...confirm the notification arrived, then:
    aws cloudwatch set-alarm-state --profile <profile> --region ap-southeast-2 \
      --alarm-name <stage>-catalog-manhattan-us-enrich-dlq-depth \
      --state-value OK --state-reason "Reverting manual test"
    ```

### Raw AWS CLI equivalents (if you'd rather not use the scripts, or need something they don't cover)

Replace `<store>` with `us` or `ps` throughout — everywhere a table or a per-store Lambda is
named. The buffer/sender resources (marked below) have no `<store>` segment; there's only one of
each, shared across both stores.

**Check queue depth (per-store enrich queue):**
```
aws sqs get-queue-attributes --profile <profile> --region ap-southeast-2 \
  --queue-url $(aws sqs get-queue-url --profile <profile> --region ap-southeast-2 \
    --queue-name <stage>-catalog-manhattan-<store>-item-eda-queue.fifo --query QueueUrl --output text) \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

**Check queue depth (shared buffer, no store):**
```
aws sqs get-queue-attributes --profile <profile> --region ap-southeast-2 \
  --queue-url $(aws sqs get-queue-url --profile <profile> --region ap-southeast-2 \
    --queue-name <stage>-catalog-manhattan-item-buffer-buffer.fifo --query QueueUrl --output text) \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

**Trigger a change directly:**
```
aws dynamodb update-item --profile <profile> --region ap-southeast-2 \
  --table-name <stage>-<store>-catalog \
  --key '{"ID":{"S":"ATT#weight"},"SKU":{"S":"VAR#<id>"}}' \
  --update-expression "SET #v = :v" \
  --expression-attribute-names '{"#v":"Value"}' \
  --expression-attribute-values '{":v":{"N":"0.5"}}' \
  --return-values ALL_NEW
```

**Tail a Lambda's logs (sender — shared, no store):**
```
aws logs tail /aws/lambda/<stage>-catalog-manhattan-item-sender --profile <profile> --region ap-southeast-2 --since 10m --format short
```

**Tail a Lambda's logs (enrich — per-store):**
```
aws logs tail /aws/lambda/<stage>-catalog-manhattan-<store>-enrich-item --profile <profile> --region ap-southeast-2 --since 10m --format short
```

**Resolve a variant's parent product (for Task 2's product-level attributes):**
```
aws dynamodb query --profile <profile> --region ap-southeast-2 \
  --table-name <stage>-<store>-catalog \
  --index-name product-attribute-index \
  --key-condition-expression "SKU = :sku" \
  --expression-attribute-values '{":sku":{"S":"VAR#<id>"}}'
```
This returns every `ATT#<name>` row for that variant plus its own root row — the one result whose
`ID` does *not* start with `ATT#` has the parent product's numeric ID, i.e. `PRD#<that ID>`.

**List every variant under a product (for Task 4's fan-out verification):**
```
aws dynamodb query --profile <profile> --region ap-southeast-2 \
  --table-name <stage>-<store>-catalog \
  --key-condition-expression "#id = :id AND begins_with(#sku, :prefix)" \
  --expression-attribute-names '{"#id":"ID","#sku":"SKU"}' \
  --expression-attribute-values '{":id":{"S":"<numeric-product-id>"},":prefix":{"S":"VAR#"}}'
```
This is a plain query on the table's primary key (no GSI) — product/variant root rows share
their parent's partition key, so this returns every `VAR#<id>` row under that product.

The queue names, in full, are:
- `<stage>-catalog-manhattan-<store>-item-eda-queue.fifo` (enrich worker's own queue, per store)
- `<stage>-catalog-manhattan-<store>-item-eda-dlq.fifo` (enrich worker's dead-letter queue, per store)
- `<stage>-catalog-manhattan-item-buffer-buffer.fifo` (batches records before sending — shared, no store)
- `<stage>-catalog-manhattan-item-buffer-dlq.fifo` (buffer's dead-letter queue — shared, no store)

The Layer B Lambda function names, in full:
- `<stage>-catalog-manhattan-<store>-enrich-item` (per store)
- `<stage>-catalog-manhattan-item-sender` (shared, no store)
- `<stage>-catalog-manhattan-item-buffer-buffer-handler` (shared, no store)

The Layer A (NetSuite ingestion) Lambda `trigger-netsuite-update.sh` invokes directly (per store):
- `<stage>-<store>-catalog-erp-update`

The Task 5 (BUSY-1048) alarm names, in full:
- `<stage>-catalog-manhattan-<store>-enrich-dlq-depth` (per store)
- `<stage>-catalog-manhattan-<store>-validation-failures` (per store)
- `<stage>-catalog-manhattan-send-dlq-depth` (shared, no store)

Check an alarm's state directly:
```
aws cloudwatch describe-alarms --profile <profile> --region ap-southeast-2 \
  --alarm-names <stage>-catalog-manhattan-<store>-enrich-dlq-depth \
  --query "MetricAlarms[0].StateValue" --output text
```

The dashboard (shared, no store): `<stage>-catalog-manhattan-dashboard`, URL pattern
`https://<region>.console.aws.amazon.com/cloudwatch/home?region=<region>#dashboards:name=<stage>-catalog-manhattan-dashboard`.
The SNS alert topic (shared, no store): `<stage>-catalog-manhattan-alerts`.

See `aws-console-guide.md` in this folder for the same actions via the AWS web console instead
of the CLI.

