# QA Order Tool — shopify-order-creator

TypeScript CLI + regression harness (`ts/`) for placing test orders on Universal Store / Perfect Stranger **staging** and verifying omni-channel alignment across Shopify, AWS (DynamoDB), and NewStore. Two entry points from the same build: `node dist/index.js order ...` places one ad-hoc test order on demand (TAA-15); `node dist/index.js` with no subcommand runs the automated regression suite (TAA-13/14/17).

**Owner:** JJ (james.johnston@universalstore.com.au). Tool originally by Jared Davis (as a Python CLI — see "TS rewrite complete" below).
**Tracking:** Jira project TAA (current: TAA-21 fulfilment — slice A **TAA-34** in flight, built but not live-confirmed; TAA-40 owns the outstanding PS live run; TAA-31/32/33 queued behind TAA-21). Docs: Confluence QD space → "QA Automation Tool" page tree — see `regression-package-design.md` and `scope-of-work-reworked.md` in this folder, and `qa-order-cli-tool-documentation.md` for the `order` command's user-facing docs.

## ⚠ NEXT SESSION — FINISH TAA-34 (fulfilment slice A) LIVE

**Step 0 — push first; nothing below is real until this happens.** Four commits
on `taa-22-ps` are local-only, including the parallel-by-default flip:
`d595eba`, `0082604`, `30f2367`, `fdaa31b`. Push, merge to `main`, then rebase
the `taa-34-fulfil-client` worktree onto it — that branch was cut from
`origin/main` and does not carry the flip.

**Step 1 — TAA-34 live confirm.** Slice A is **built and committed** already
(`829db11`, worktree `../qa-taa-34`): `clients/fulfilment.ts`, `cli-fulfil.ts`,
wired into `index.ts`, plus `tests/fulfilment.test.js` and
`tests/cli-fulfil.test.js`. What it has never had is the one thing the ticket
actually asks for — a real call against staging:

```
node dist/index.js fulfil --shipment <bare-uuid> --item ITEM#<uuid>
```

200 + a tracking number closes it. Needs `FULFIL_BASE_URL` / `FULFIL_API_KEY`
in env and a freshly allocated order to fulfil. **Fulfilment is irreversible** —
a fulfilled staging shipment stays fulfilled, so place two or three spare orders
before starting. Re-firing the same shipment is the cheap negative test: the 400
body (`"can't fulfill shipment with status fulfilled"`) must surface in the
thrown error, not a bare status code.

Then tick TAA-34, record the shipment id + tracking number here, and move to
**TAA-35** (widen `ShipmentItem` with `shipmentItemId` / `shipmentId`).

**Deferred, now owned by TAA-40:** `--store PS --parallel --repeat 3`. It is
TAA-22's last unticked acceptance item *and* the only live confirmation of the
parallel-by-default flip (`defaultConfig()` set `parallel: true` on 2026-08-06;
no live run since, proven equivalent offline at 169/169 but never on staging).
It sat in a comment on a closed ticket for two weeks — as of 2026-08-21 it has
its own ticket. TAA-22 stays Done. If that run fails, the two live risks — the
~29 min staging slowdown, and the isolated PS `split` inventory-decrement miss
(order #3297, `33948010@ATP#99` never dropped 99→98 in the window) — are real
backend findings, not harness defects.

**Gotcha:** a shell predating TAA-22 may still export the retired
`PS_ACCESS_TOKEN` and lack `PS_CLIENT_ID`/`PS_CLIENT_SECRET`. The failure
message doesn't point back at the stale token.

**The full slice plan.** TAA-21 is now an
umbrella **Workstream**; the work is six child tasks, each sized for one
sitting. Do them in order — each builds on the last. Point a session at one
ticket rather than at TAA-21, to keep context small.

| Slice | Ticket | Done when |
| --- | --- | --- |
| A | **TAA-34** | Paste a shipment id + item ids by hand → 200 + tracking number |
| B | **TAA-35** | Payload built from the shipment's real rows, any item count |
| C | **TAA-36** | One command fulfils a whole order end to end |
| D | **TAA-37** | Fulfilled state asserted in shipments + orders tables |
| E | **TAA-38** | Shopify's fulfilment view checked against the allocation |
| F | **TAA-39** | `fulfil_single` / `fulfil_split` green on both stores under `--repeat` |

**Start with TAA-34.** It touches no DynamoDB and asserts nothing — it exists
to prove the endpoint contract against real staging before three more slices
get built on top of it. If the contract differs from what's documented, that's
far cheaper to find in A than in D.

A–C are the walking skeleton. D–E make it a test rather than a script. F folds
it into the regression suite. C on its own gives an operator-facing "fulfil
this order" command, useful even if the rest slips.

Full contract and design detail: dev doc
https://universalstore.atlassian.net/wiki/spaces/QD/pages/1866727460

**This project is staging-only. Production endpoints, hosts and keys stay out
of this repo and out of the docs entirely — by design, not by omission.**

Endpoint: `POST /staging/fulfil` on
`celmqip2md.execute-api.ap-southeast-2.amazonaws.com`, `X-API-KEY` auth.
Base URL + key from env (`FULFIL_BASE_URL`, `FULFIL_API_KEY`), never
committed. The client asserts its host is the staging host and throws
otherwise.

Payload facts worth not re-deriving:
- `shipment_id` = the `SHIPMENT#<id>` sort key with the prefix **stripped**
  (bare UUID).
- `shipment_item_id` = the `ITEM#<uuid>` sort key with the prefix
  **retained**, verbatim. The asymmetry is real, not a typo — pin it in a test.
- One package per item; multi-item packages are legal but not exercised.
- Weights (`weight` / `final_weight` / `packaging_weight`) are unvalidated
  pass-through constants. Nothing asserts on them.
- `fulfiller` = `"QA auto fulfilment"`.
- `fulfilled_at` = `YYYY-MM-DD HH:MM:SS`, **Australia/Brisbane**, second
  precision, no milliseconds. Format explicitly via `Intl.DateTimeFormat` with
  `timeZone: "Australia/Brisbane"` — NOT host local time.
- 200 = success; Auspost returns a tracking number the backend writes onto the
  shipment row (assert it). 400 = failure with a message worth surfacing
  ("can't fulfill shipment with status fulfilled", "shipment is on hold",
  "contact dev support"). Carry the response body into the thrown error.
- Any shipment that isn't already fulfilled is fulfillable.

**Item settling — a case-design consideration, not a defect.** Allocation
writes the `SHIPMENT#` row first, then updates `ITEM#` rows one at a time. The
item count in the payload must equal the number of items carrying that
`shipmentId`. Fulfilling on first sight of a shipment id would send a short
payload — that's a flaw in how the case was built, not a finding. TAA-36 owns
waiting for the counts to settle. Whether that's a formal poll stage or handled
inline is worth deciding with real timings in front of you; split it out if it
grows.

**Wiring traps (mostly TAA-39's problem, but know them now):**
`stageSequenceFor` (`progress.ts:11`) must gain any new stage name or run
progress/ETA silently drift — it is NOT derived from the runner's actual
`stageDone()` calls. `cli.ts:107` indexes `allCases[name]` unguarded, so a
pipeline case outside `buildCases()`'s return throws there. `hasRefund` is
computed in three places (`runner.ts:159`, `runner.ts:463`, `cli.ts:107`).
`printHelp()`/`printCases()` hardcode "all 8".

Poll windows proposed: `fulfilment` 150s (TAA-37). Deliberately not 300s —
JJ's ">5 min = probable bug" threshold is a triage signal, not a wait-it-out
budget. Tune from live data.

**Fulfilment is irreversible on staging** (same class as `zeroEverywhere`) and
a 200 produces a real Auspost staging shipment. Repeat runs need fresh orders —
have a couple of spare allocated orders ready before starting TAA-34.

## Board split made 2026-08-07 (JJ's calls)

TAA-21 was rescoped, converted to an umbrella **Workstream** with six child
slices (TAA-34..39, see Step 2 above), and three separate tickets split out of
it. It previously read "verification only" on the assumption the fulfil call
was already wired in — wrong: **nothing fulfilment-related exists in `ts/src`
at all**, so it is build + verify, and that is why it needed slicing.

- **TAA-21** — fulfilment: wire the call, verify fulfilled state, allocation
  reflection. Next up.
- **TAA-7 — CLOSED**, folded into TAA-21. The call is one HTTP POST built from
  data the harness already reads; splitting it meant two tickets editing the
  same modules. Correction for the record: the fulfil call **predates Kian** —
  it's an existing US service sent via RapidAPI, not his work.
- **TAA-31** — rejection & reallocation (was phase 4 of TAA-21). Blocked on JJ
  supplying the reject call.
- **TAA-32** — click & collect fulfilment. Pickup has no carrier and no
  tracking number, so it needs its own definition of done.
- **TAA-33** — order-finalised transaction. Fires when the last open item
  closes, by fulfilment **or** by going undeliverable and being refunded — so
  it spans TAA-21 and the existing refund cases. Owns building the
  `TRANSACTION#` row reader (nothing reads transaction rows today). Note the
  refund half is already driven every run by `undeliverable` /
  `partial_undeliverable` and is entirely unasserted — could be verified early.

Allocation reflection (Scope-of-Work workstream 2) stays on TAA-21.
Futura / Delivery Note verification remains out of scope everywhere.

## Housekeeping — do this before any review or handover (as at 2026-08-07)

Branch state is the first thing a reviewer looks at, and right now it does not
read well:

- On `taa-22-ps` at `30f2367`, **3 commits ahead of `origin/taa-22-ps`** —
  unpushed. `main` is itself 1 ahead of `origin/main`.
- **`taa-22-ps` is not merged to `main`.** All the TAA-22 + TAA-14 parallel-by-
  default + report-retention + doc-accuracy work lives only on that branch.
- `taa-14-speedup`, `taa-15-cli-port` and `taa-17-newstore` are merged into
  `main` and are prunable leftovers.
- Untracked in the working tree: `.claude/` and `_to_delete/`.

Push, land `taa-22-ps`, prune the three stale branches.

Everything below this block is historical rewrite context, not the live task list.

**Report retention (JJ, 2026-08-06):** run reports are disposable — the verdict
matters at the time of the run, and anything worth keeping gets written up here
or on the ticket. `report.ts` now prunes `ts/reports/` back to the **10 most
recent runs** after every run (`REPORT_RETENTION`, `pruneReports()`; pure
`reportsToPrune()` is offline-tested). It only ever touches files matching
`regression_<STORE>_<stamp>.{md,json}`, so the old `regression-report.md`
dry-run sample and anything hand-saved there survive. Best-effort: a report it
can't delete warns and is skipped, never failing an otherwise-passing run.

**Doc accuracy pass (2026-08-06):** README, the four docs in this folder, the
six Confluence pages under "QA Automation Tool", and the TAA tickets were
reconciled against the real repo state ahead of a senior-dev review. Two
long-standing doc defects fixed in code at the same time: `cli.ts`'s
`printHelp()` was omitting `unique` and `partial_undeliverable` from its case
list (a reviewer running `--help` would have seen 6 of 8 cases), and
`staging-sku-setup.md` step 5 said `--list` instead of `--list-cases`.
## Decisions JJ made 2026-08-06 (all applied)

- **`--parallel` is now the default; `--sequential` is the opt-out.** TAA-14's
  2026-08-04 decision, finally implemented. `defaultConfig()` sets
  `parallel: true`; `cli.ts` gained `--sequential`; `--parallel` still accepted
  so existing scripts/docs keep working; later flag wins if both are passed.
  Rationale is on `RegressionConfig.parallel` — both stores have 14-SKU pools
  with fully disjoint per-case assignment, so the wave scheduler has nothing to
  race on, and parallel runs are byte-identical to sequential on both stores.
  Sequential is now the *debugging* mode: readable one-case-at-a-time logs, or
  ruling out concurrency when triaging. New `tests/cli.test.js` pins the
  contract; suite green at **169/169**.
  **Not yet done:** no live staging run since the flip. A bare
  `node dist/index.js` now runs parallel where it used to run sequentially —
  expected and proven equivalent, but re-confirm live on the next run.
- **Scope-of-Work workstream 2 (allocation reflection, Shopify ↔ DynamoDB)
  folded into TAA-21.** Nothing was built for it (no fulfilment-order querying,
  no store→Shopify-location mapping in `ts/src/`, confirmed by grep) and it
  verifies the same surface as workstream 3's fulfilment verification, needing
  the same two missing pieces — separate tickets would mean building both twice.
- **TAA-3 closed.** The design deliverable is done and published; implementation
  lives on TAA-13/14/15/17 and the remaining phases on TAA-21/22, so holding it
  open added nothing.
- **TAA-15 closed: the operator surface is a CLI, not a GUI.** The remaining
  order-builder scope (settings menu, presets/random orders, stress test,
  associate switching for OTC, fire-and-verify) split out to **TAA-29** so
  closing the parent didn't lose it. These extend the `order` subcommand — the
  CLI-vs-GUI question is settled, don't reopen it.
- **TAA-30 raised for the QA customer pool.** Removes the last Jared Davis
  reference (the NewStore `ns_id` still points at his real profile — a live-use
  blocker, left behind because it needs a real NewStore profile created rather
  than just a string change), adds a usable way to create fake customers on both
  Shopify and NewStore, and builds a pool of 10 selected at random per run. The
  driver: `--parallel` is now the default and every concurrent case still shares
  one QA customer per store. No interference was seen across the ~30 orders in
  TAA-14's proving, but that's absence of evidence, not proof — and a customer
  pool is the prerequisite for address-change propagation cases.
  `NS_ASSOCIATES`/`ACTIVE_ASSOCIATE_ID` stay out of scope: real staff accounts,
  and OTC orders need a real associate.

Still open for JJ: **TAA-7** — is it build work (wire Kian's fulfilment call
into the harness) or subsumed by TAA-21's verification-only scope? Its
description states the ambiguity rather than guessing.

## ✅ TS REWRITE COMPLETE (2026-08-04) — zero Python remains

The tool started as an interactive Python CLI (`main.py` + 6 supporting modules) and has been fully ported to TypeScript in three overlapping efforts: the automated regression baseline (TAA-13), NewStore SFS/OTC support + receipts (TAA-17), and the ad-hoc order-placement command that replaced the Python CLI's daily-use path (TAA-15). `find shopify-order-creator -name '*.py'` returns nothing. See "TAA-15 step 3 sign-off" below for the retirement details, and "Definition of rewrite complete" for what was required to get here. The sections immediately below are kept as the historical record of that port — genuinely useful context (what broke, what was decided and why) for anyone extending the TS harness, not a live task list.

### What was ported (historical — the rewrite is done)

1. ~~**NewStore client — `newstore_client.py`** → `ts/src/clients/newstore.ts`~~ — **done 2026-07-22 (TAA-17 step 1).** Real OAuth2 client-credentials flow (Keycloak, `id.p.newstore.net`), token cache with pre-expiry refresh (30s buffer), retry on network/5xx (2s/4s backoff, 3 tries), raises immediately on 4xx with the response body. 5 offline tests (`tests/newstore.test.js`: token caching, token refresh near expiry, 5xx-then-success, 4xx no-retry, retries-exhausted). Confirmed live: a real token fetch against staging Keycloak returned a valid JWT. `newstore_client.py` can now be `git rm`'d once injection (`newstore_orders.py`) ports too — kept for now since the port isn't finished.
2. ~~**NewStore order injection — `newstore_orders.py`** → new `ts/src/flows/newstoreOrders.ts`~~ — **done 2026-07-31 (TAA-17 step 2).** SFS + OTC payload builders ported faithfully (GST = price/11 tax-included, SFS charges 9.99 shipping, OTC preconfirmed/fulfilled with store-address shipping and no shipping charge), real prices via a new `ShopifyClient.fetchVariantPrices` (nodes batch query) — strict, no `$1.00` fallback for an unpriceable SKU (hard failure instead, per the "no fallbacks" rule). External IDs are collision-free (`QA{SFS|OTC}_{timestamp}_{random}`) — `order_counter.json`'s sequential-counter scheme was **not** ported at all; its confirmed bug (a reused id silently returns an existing unrelated order) made it a non-starter, not just a concurrency risk. 11 offline tests (`tests/newstoreOrders.test.js`: payload shape SFS vs OTC, GST calc, totals incl. duplicate SKUs, external-id uniqueness/format, strict price-lookup failures) — `npm run build` + `npm test` green (51/51). **Confirmed live (US, staging):** one real SFS injection and one real OTC injection via `POST /v0/d/fulfill_order`, both returned real NewStore order UUIDs (SFS `bab24823-5bcc-5924-98c4-8526a845858b`, OTC `cc37529e-6f6a-5d67-aa9b-adcddcf4096c`) plus per-item ids — no fallback/synthetic data path was exercised. `newstore_orders.py` is kept for now (not yet `git rm`'d) — per JJ's instruction, deletion of ported Python waits until read-back (step 3) also lands.
3. ~~**NewStore read-back + cases 7–8** → `ts/src/readers/newstoreReader.ts` + verify + wire the two NS cases~~ — **done 2026-07-31 (TAA-17 step 3).** `readers/newstoreReader.ts` hits the confirmed endpoint (`GET /v0/d/external_orders/{external_id}`); a 404 during the ~2s propagation window resolves to `null` (mirrors `DynamoReader`'s "empty = not landed yet" convention) so `pollVerify` retries instead of hard-failing, while any other error propagates immediately. `verify/newstore.ts` asserts the read-back SKU/quantity map matches exactly. `cases/newstoreCases.ts` defines `ns_sfs`/`ns_otc` (design-doc cases 7–8) — these never touch Shopify or `staging-inventory-v2` at all, so they run through a new, much shorter `runNewStoreCase()` path in `runner.ts` (inject → read back → assert) rather than the 7-stage Shopify/Dynamo pipeline; wired into `run()`/`--list-cases` alongside the baseline set. New `PollWindows.newstoreReadback`/`newstoreInterval` (30s/2s) reflect the fast confirmed propagation. 14 new offline tests — `npm run build` + `npm test` green (68/68 after the fix below).
   **Live-confirmed (2026-07-31):** `node dist/index.js --store US --cases ns_sfs,ns_otc` — **PASS**, both cases landed and read back correctly (`newstore_readback` 6.8s/6.5s, well inside the 30s window). Report `regression_US_20260731T053306Z.md`.
   **PS blocked (2026-07-31), not a code defect:** the same run on PS fails at the injection price lookup. Confirmed live root cause: `PS_ACCESS_TOKEN` lacks the `read_products` Admin API scope — the `nodes` price query returns `errors: [{message: "Access denied for ProductVariant object...", extensions: {code: "ACCESS_DENIED"}}]` alongside `data.nodes: [null]`. Fix: Perfect Stranger admin → Settings → Apps and sales channels → Develop apps → the staging custom app → Configuration → Admin API scopes → enable `read_products` → API credentials → reveal/reissue the token. Report `regression_PS_20260731T053503Z.md`. **Found and fixed while confirming this:** `ShopifyClient.fetchVariantPrices` was silently treating a GraphQL-error-caused null node the same as a genuinely-missing SKU, discarding the real `ACCESS_DENIED` reason — now any top-level `errors` array is surfaced immediately (4 new tests, `tests/shopify.test.js` — this file didn't exist yet on this branch). PS cases 7–8 will pass once the token's scope is fixed and reissued — no harness change needed on that side.
4. ~~**Receipt generation — `receipt_service.py`** → decide first: port to TS, or drop it~~ — **decision: PORT (2026-07-31, per JJ).** Done as `ts/src/flows/receipts.ts`. Standalone utility, **not** wired into the automated `ns_sfs`/`ns_otc` regression cases — those stay side-effect-free on every run/repeat (per JJ); this is called on demand, e.g. from the future operator surface (TAA-15). Kept **non-fatal by design** like the Python original (a render failure falls back to a text-only order note rather than throwing) — deliberately not held to this harness's usual strict-by-default rule, since a receipt decorates an already-successful order rather than checking correctness. Template-id/sample-data caching is instance-scoped (`ReceiptService` class), not a module global.
   Fixed three stale/hardcoded values while porting (gotcha #5 below plus one more found along the way): shipping was hardcoded `10.0` instead of the real `9.99` charged; `store_name` was hardcoded `"Universal Store"` even for Perfect Stranger orders; `customer_name` was hardcoded to the old `"Jared Davis"` identity, stale since that rename landed everywhere else in the codebase 2026-07-22 — this module was missed at the time.
   12 offline tests (template matching/caching, catalog lookup, render-data shape incl. the three fixed values, full success/render-failure/note-failure paths) — `npm run build` + `npm test` green (80/80). **Live-confirmed (2026-07-31, US):** fresh SFS injection (`QASFS_1785476635884_3d5e6dacff`) → real PDF rendered (21KB, valid PDF 1.7) and saved locally, real order note posted with the PDF's permanent link. `receipts/*.pdf` is gitignored (existing root `*.pdf` rule already covered it).
5. ~~**Interactive CLI — `main.py`** (+ its Python-only deps `orders_processor.py`, `aws_inventory.py`, `graphql_scripts.py`, which the TS harness already replaced with its own clients)~~ — **done 2026-08-04 (TAA-15).** Ported as the minimal `order` subcommand (`ts/src/cli-order.ts`) — not the full operator-UX rework (settings menus, presets, stress-test, fire-and-verify, GUI stay deferred, see TAA-15's own ticket), just enough to cover `main.py`'s actual daily use: placing one ad-hoc test order on demand. See "TAA-15 step 1 + step 2 sign-off" and "TAA-15 step 3 sign-off" below for the full build/live-confirm/retirement record.
   **Scope correction found 2026-07-31, while starting Python retirement:** `main.py` also directly imports and uses `newstore_orders` (brand switching, associate management, fallback-price config, `place_ns_orders` → `create_sfs_order`/`create_otc_order`) and `receipt_service.generate_and_attach_receipt` — transitively pulling in `newstore_client` too. Neither the original file-map table nor TAA-17's "out of scope" list called these three out as `main.py` dependencies (only `orders_processor.py`/`aws_inventory.py`/`graphql_scripts.py` were named) — that was an oversight. In reality **`newstore_client.py`, `newstore_orders.py`, and `receipt_service.py` cannot be deleted yet**, even though their TS replacements are built and live-verified (items 1, 2, 4 above): doing so would break `main.py`'s NS order-placement and receipt features right now. Full removal of these three is gated on TAA-15 the same as `orders_processor.py`/`aws_inventory.py`/`graphql_scripts.py` — not a separate, earlier milestone as the original retire-order plan assumed. (Resolved: all six removed together in the TAA-15 step 3 batch below.)

### Retire order (corrected 2026-07-31)

~~NS client → NS injection (collision-free IDs) → NS read-back + cases 7–8 → receipt decision → CLI/operator surface (TAA-15). Each step: build + verify in TS, then `git rm` the corresponding Python.~~ — the "git rm as each TS piece lands" plan didn't account for `main.py` importing `newstore_client`/`newstore_orders`/`receipt_service` directly (see item 5's correction above). Actual order: NS client → NS injection → NS read-back + cases 7–8 → receipt decision (all four **done and TS-verified** 2026-07-31) → **`git rm` the retired `regression/` package** (done 2026-07-31 — it was the one piece with zero remaining dependents) → everything else (`main.py` + `orders_processor.py`/`aws_inventory.py`/`graphql_scripts.py`/`newstore_client.py`/`newstore_orders.py`/`receipt_service.py`) waits on **TAA-15** as one batch, since `main.py` is the sole remaining consumer of all of them.

### Consolidation before TAA-15 (2026-08-04)

`main` was stale at TAA-17 step 1 while `taa-14-speedup` (run-time optimisation)
and `taa-17-newstore` (NewStore rewrite) both diverged from it independently.
Per JJ, consolidated onto `main` before branching `taa-15-cli-port`:

1. **`taa-14-speedup` → `main`**: clean merge, no conflicts (both branches
   forked from the same tip). Build + 78/78 offline tests green. Live-confirmed
   `--store US --cases single` — order #9859-line PASS with the new adaptive-poll
   progress line working end to end.
2. **`taa-17-newstore` → `main`**: conflicts in `src/runner.ts`/`src/cli.ts`
   (both branches touched them — TAA-14 added the progress tracker + `--parallel`
   wave scheduler; TAA-17 added the NewStore case path). Neither side's code knew
   about the other's cases, so this needed a real design decision, not a textual
   pick: `CaseDefinition`/`NewStoreCaseDefinition` now both carry a `kind:
   "pipeline" | "newstore"` discriminator, and `runner.ts`'s `run()` partitions on
   it rather than on hardcoded names or map membership — future pipeline-shaped
   cases (e.g. TAA-21 fulfilment/rejection) get tracker+`--parallel` support for
   free. `"pipeline"` cases route through the unchanged TAA-14 tracker/scheduler;
   `"newstore"` cases always run sequentially via the unchanged TAA-17
   `runNewStoreCase()` loop (logged as a note under `--parallel`, since they're a
   2-stage NewStore-only round trip with no Shopify/Dynamo state for the wave
   scheduler to reason about) — both result sets concatenate before the
   report/variance diff, so `--repeat` still catches NS variance. `tests/shopify.test.js`
   was an add/add conflict (both branches created it independently for different
   tests) — merged to keep every test from both. Build + 118/118 offline tests
   green. Live-confirmed `--store US --cases single,ns_sfs`: order #9859 (pipeline,
   full progress-tracker line) + NewStore SFS `QASFS_1785817688000_34a4c42ae3`
   (sequential, no tracker) both **PASS** in the same run — report
   `regression_US_20260804T042813Z.md`.

`main` is now current with both feature sets; `taa-15-cli-port` branches from
here.

### TAA-15 step 1 + step 2 sign-off (2026-08-04)

**Step 1 (build) — done.** New `order` subcommand (`ts/src/cli-order.ts`,
`node dist/index.js order ...`) is the minimal TS replacement for `main.py`'s
daily-use path: place one ad-hoc Shopify order (`--store`, `--items
SKUxQTY,...`, `--seed standard|split|zero|none` porting `aws_inventory.py`'s
`ensure_stock`/`split_stock`/zero-everywhere semantics, `--delivery
rate:<title>|pickup:<name>` porting `orders_processor.py`'s delivery-method
selection, `--email` override) or one ad-hoc NewStore SFS/OTC order (`--ns
sfs|otc --items ...` via the existing `flows/newstoreOrders.ts`, receipt
auto-generated and attached via `flows/receipts.ts`, non-fatal by design,
`--save-receipt` to also save the PDF locally). Reuses the harness clients
as-is — no logic re-port — with two thin additive extensions needed to make
`--delivery` meaningful: `ShopifyClient.createDraftOrder` takes an optional
delivery override (named rate or resolved pickup location id) and gained
`fetchPickupLocations()`; `newstoreOrders.ts`'s already-existing
`lookupPrices`/`calculateTotal` are now exported for receipt-total
calculation. Prints identifiers immediately, before the best-effort receipt
step. 32 new offline tests (arg parsing, item composition incl.
duplicate-SKU summing, NS quantity expansion) — `npm run build` + `npm test`
green (150/150).

**Step 2 (live confirm) — done, both PASS.** `node dist/index.js order
--store US --items 32625134x1` → real Shopify order **#9860**
(`gid://shopify/Order/7819764564241`), standard inventory seed ran, default
delivery, identifiers printed immediately. `node dist/index.js order --ns
sfs --items 33006246x1` → real NewStore SFS order, external id
`QASFS_1785818538240_6e9e1ee470`, order UUID
`703d37b8-91ef-509e-a3d6-ef40aaf47ad7`, receipt generated and order note
posted with the PDF link. Both confirmed live by JJ directly in Shopify
admin / NewStore Manager. This clears the gate for step 3 (retiring the
Python) below.

### TAA-15 step 3 sign-off (2026-08-04) — Python retired, rewrite complete

Confirmed nothing under `ts/` imports any Python module (only historical
doc-comments like "ports orders_processor.py's..." reference the old
filenames — no actual imports). `git rm`'d all seven remaining Python files:
`main.py`, `orders_processor.py`, `aws_inventory.py`, `graphql_scripts.py`,
`newstore_client.py`, `newstore_orders.py`, `receipt_service.py`. `find
shopify-order-creator -name '*.py'` returns nothing.

Docs updated: `requirements.txt` removed (no Python dependencies remain);
`qa-order-cli-tool-documentation.md` rewritten to describe the `order`
subcommand instead of the retired interactive menus, with an explicit "not
yet ported" list (settings menu, presets, stress-test, associate switching,
fire-and-verify, GUI — all later TAA-15 scope, not lost);
`scope-of-work-reworked.md`'s stale "where it stands today" paragraph
annotated with a status pointer back to this file rather than rewritten
(kept as historical context for the scope it was written against). This
file's "Stack & environment", "File map", "Known gotchas", and "Conventions
for new work" sections below are updated accordingly.

### Definition of "rewrite complete" — ✅ met 2026-08-04

No `.py` files remain under `shopify-order-creator/` (confirmed above), the
TS harness covers Shopify + AWS + NewStore end to end (regression baseline
+ NS cases 7–8 pass live, TAA-13/14/17), and the operator's daily-use path
(ad-hoc order placement) is ported and live-confirmed (TAA-15 steps 1-2
above). The full TAA-15 operator-UX rework (settings, presets, stress-test,
fire-and-verify, GUI) remains open as later, separately-scoped work — it
was never part of this definition.

### TAA-22 — PS OAuth unblock (2026-08-04, branch `taa-22-ps`)

**Background:** Shopify retired static custom-app tokens Jan 1 2026. US's
existing `US_ACCESS_TOKEN` predates the cutover and keeps working, untouched.
PS's static token stopped working — PS now authenticates via a CLI/Dev-Dashboard
app ("QA PS App") using the OAuth client-credentials grant.

**Step 1 — PS OAuth in `clients/shopify.ts` — done, live-confirmed.**
`ShopifyClient` now has a `getPsOAuthToken()` provider, same shape as
`clients/newstore.ts`'s token cache: `POST
https://perfect-stranger-staging.myshopify.com/admin/oauth/access_token`
(form-urlencoded `grant_type=client_credentials`, `client_id`, `client_secret`
— confirmed against shopify.dev's client-credentials-grant doc before
writing any code, not guessed), token cached on the instance, refreshed 5
min ahead of the ~24h (`expires_in` ≈86399s) expiry. Store selection:
US = static `US_ACCESS_TOKEN` (unchanged), PS = OAuth via `PS_CLIENT_ID` /
`PS_CLIENT_SECRET` — no fallback to a static PS token, since that auth model
no longer works at all. 6 new offline tests (token obtained/cached/refetched
near expiry, missing-creds throws without calling fetch, a failed token
request surfaces its body, US path proven unaffected) — `npm run build` +
`npm test` green (156/156). **Live-confirmed:** a real token fetch against
PS staging, then `currentAppInstallation` via the harness's own
`ShopifyClient.execute()` — app title **"QA PS App"**, scopes include
`read_products` (plus `read/write_orders`, `read/write_inventory`,
`read/write_fulfillments`, etc.).

**Step 2 — PS SKU pool — done.** `node scripts/fetch-sku-gids.js PS` (the
`ACCESS_DENIED` block from 2026-07-31 is gone now that the token has
`read_products`) resolved 180/200 SKUs into `sku-lists/ps-skus.json` (20
unresolved, logged — same shape as US's 191/200, plenty of headroom, not
worth chasing). The script itself was refactored to `require()` the
compiled `ShopifyClient` instead of its own raw-fetch/static-token logic —
it now gets PS's OAuth grant (and US's static token, and Shopify's throttle
retry) for free instead of needing its own auth path kept in sync
separately. `variants.ts`'s `PS_VARIANTS`/`PS_SKU_ORDER` grown from 4 to 14
entries (10 new, taken in list order from `ps-skus.json`, GIDs cross-checked
programmatically against the source JSON before committing — same
transcription-error guard used for US's Phase B pool growth). `PS_SKU_ORDER`
now has enough entries for `baselineCases.ts`'s existing 10-slot disjoint
assignment (`single`=0, `multi`=1, `unique`=2-4, `split`=5-6,
`undeliverable`=7, `partial_undeliverable`=8-9) to apply to PS automatically
— no case-file changes needed, `sku(i) = pool[i % pool.length]` was already
generic. PS's old 4-SKU modulo-wraparound behaviour (multiple cases silently
sharing a SKU) is gone; PS is now SKU-isolated the same as US, which is what
makes `--parallel` safe on PS too.

**Step 3 — prove PS — PARTIAL, one item still open.**

- `--store PS --cases single` (smoke): **PASS**.
- Full 8-case default set (6 baseline + `ns_sfs`/`ns_otc`), sequential:
  **PASS**, wall-clock **4:13.41**. `ns_sfs`/`ns_otc` — previously hard-blocked
  on the `read_products` `ACCESS_DENIED` — both passed cleanly (read-back
  2.9s/3.5s). Report `regression_PS_20260804T062615Z.md`.
- Same full 8-case set, `--parallel`: **PASS**, wall-clock **1:35.94**.
  Stable signature (pass/fail + failing check per case, via `report.ts`'s
  `stableSignature()`) diffed programmatically against the sequential run
  above — **byte-identical**, all 8 cases pass either way. Report
  `regression_PS_20260804T062806Z.md`.
- **`--store PS --repeat 3` — killed by JJ before completion, not yet clean.**
  Repeat 1/3 passed all 6 baseline cases and was mid-`ns_sfs` (~20 min
  elapsed) when killed. Staging ran markedly slower this session than the
  single-pass runs just above — e.g. `allocation` 52.0s and `cleanup` 26.4s
  for `partial_undeliverable`, versus ~11–17s/~20–30s historical — and the
  live progress tracker's own ETA had grown from an initial ~11 min estimate
  to **~29 min projected total**. JJ killed the run at that point: **a ~30min
  `--repeat 3` for one store is ~5x longer than acceptable** (per JJ,
  2026-08-04) — for comparison, US's `--parallel --repeat 3` full-set gate
  is the ~4 min figure the TAA-14 Phase B headline result is built on (see
  below), and even a fully-sequential `--repeat 3` shouldn't be 5-7x that.
  **Not diagnosed as a code defect** — the OAuth/SKU-pool changes above are
  proven clean at the single-run level (both sequential and parallel, byte
  identical signatures); this looks like a staging-side slowdown during this
  particular session (same category as the historical intermittent
  refund-automation miss elsewhere in this file), but it was not
  investigated further before being killed. **Next step, before closing
  TAA-22:** re-run `--store PS --repeat 3` (ideally `--parallel --repeat 3`
  to match how US is actually gated) at a time when staging responds at its
  normal speed, and if the slowdown recurs, escalate it the same way the
  refund-automation gap was — a real backend/staging finding, not a harness
  problem, but not yet confirmed to be a one-off.
- **Follow-up single-pass re-run (2026-08-04, later session) — confirms the
  slowdown above was a one-off, surfaces a new isolated finding.**
  `--store PS --parallel --cases single,multi,unique,split,undeliverable,partial_undeliverable`
  (6 baseline cases, no NS): staging responded at normal speed throughout —
  every stage's timing sat in the historical range (e.g. `allocation` 16.6-46.8s,
  `cleanup` 16.2-31.4s, `refund` 8.4-14.0s), nothing close to a poll-window
  timeout, unlike the killed run above. Result: **5/6 pass** — `single` #3296,
  `multi` #3295, `unique` #3294, `undeliverable` #3298, `partial_undeliverable`
  #3299 all clean. **`split` (#3297) failed:** `inventory` stage timed out —
  SKU `33948010@ATP#99` expected to decrement 99→98 after allocation, never
  did within the poll window. Every stage through `no_refund` passed for this
  case; only the final inventory-decrement read-back never landed. Report
  `regression_PS_20260804T072758Z.md`. **Treated as an isolated finding, not
  escalated to a ticket** (same category/threshold as the historical
  `partial_undeliverable` refund-automation gap elsewhere in this file) —
  `split` passed cleanly, byte-identical, in both the sequential and
  `--parallel` full-set runs earlier the same day (reports above), so this
  reads as a one-off staging-side miss rather than a `--parallel`/SKU-pool
  regression. Re-run `split` again (or watch for a recurrence) before treating
  it as a real backend gap worth escalating.
- **Gotcha hit while re-running the above:** this session's shell had the
  old, retired `PS_ACCESS_TOKEN` already exported (from before TAA-22) but was
  missing the new `PS_CLIENT_ID`/`PS_CLIENT_SECRET` — the harness fails at
  runtime with `Missing PS_CLIENT_ID/PS_CLIENT_SECRET environment variables`
  rather than anything referencing the stale token, which isn't an obvious
  trail back to "you're still set up the old way." Anyone whose shell profile
  predates TAA-22 will hit this the first time they run against PS — add the
  two new vars (see "Stack & environment" below) alongside/instead of the old
  `PS_ACCESS_TOKEN`.

**Docs updated:** `qa-order-cli-tool-documentation.md`'s env var table,
`README.md`'s prereqs line — both now say `PS_CLIENT_ID`/`PS_CLIENT_SECRET`
instead of `PS_ACCESS_TOKEN`. This file's own "Stack & environment" section
below is updated the same way.

---

## Regression baseline (done — TAA-13)

Headless regression baseline proving order → allocation → shipments → inventory correctness across all three systems (Shopify, AWS/DynamoDB, NewStore). "These always need to work and behave exactly the same way." The baseline now **lives and runs in TypeScript** (`ts/`) — green on both US and PS at `--repeat 3` (2026-07-22). Read `regression-package-design.md` for the architecture/case-set/assertions this was built against, and `ts-rewrite-dev-doc.md` for the porting history.

**Python `regression/` v0.1 package removed (`git rm`'d 2026-07-31, TAA-17)** — it served as the executable spec the TS harness was ported from and verified against; that porting is done and signed off, and nothing outside the package ever imported it (confirmed via grep before removal). Still available in git history if the original Python needs referencing. `main.py` and the rest of the interactive Python CLI are unaffected (separate scope — the operator-CLI refresh is a later phase, not part of this baseline).

**TS state (`ts/`, commits 9279f00 / 435fe42 / in progress):** runnable scaffold, now gaining real logic per TAA-13. Done: CLI (`src/cli.ts` + `run-regression.sh`), cases 1–6 declared per-store from real variant pools (`src/cases/baselineCases.ts`, `src/variants.ts`), real Shopify client (`src/clients/shopify.ts` — real `draftOrderCalculate` shipping-rate fetch, no fallback/synthetic IDs, throws on any `userErrors`), reports, `src/polling.ts` (`pollUntil`/`StageTimeout`), real `clients/dynamo.ts` (inventory ops), **real readers** (`readers/shopifyReader.ts`, `readers/dynamoReader.ts`) and **`verify/{orders,refunds,shipments,inventory}.ts`** (ports of `regression/verify/*.py`, replacing the old placeholder `verification/` module).

**Schema confirmed (2026-07-17)** by placing a live US order (#9699) and probing `staging-orders-v2`/`staging-shipments` directly — the real shape differs from the original guess in three ways, now documented at the top of `readers/dynamoReader.ts`: (1) the table PK is an opaque internal order UUID, not the Shopify order id/name; (2) `staging-orders-v2` has an `origin_index` GSI keyed on `origin = "{STORE}#SHOPIFY_ECOM#{shopifyOrderIdTail}"` — the real correlation key (`staging-shipments` has no such GSI; its PK is the *same* UUID as the matching `staging-orders-v2` row, so the PK is resolved via the orders table first); (3) both tables are one-row-per-unit, and allocation lives on a sibling `SHIPMENT#<id>` row's `allocatedStore` attribute (plain store number, e.g. `"100"`), not on the `ITEM#` row itself.

`src/runner.ts` now wires the full stage chain matching `regression/runner.py`: seed_inventory → create_order → shopify_readback → orders_table → allocation → (refund → cleanup) or no_refund → inventory, every stage polled via `pollVerify` (pollUntil + a verify function that retries until it stops throwing `VerificationError`, then surfaces the detailed error on timeout instead of a bare timeout). `src/report.ts` now ports `report.py`'s `stable_signature`/`diff_repeats` (`--repeat N` actually loops N times in `cli.ts` now and diffs the identical runs; variance in pass/fail or failing-check across repeats = flagged, order ids/timings excluded as volatile) and CLI exit codes match the Python contract (0 = pass, 1 = failure/variance). Offline test suite (`npm test` / `node --test tests/*.test.js`) now covers 34 cases: polling (resolve/timeout/error-propagation), allocation summarization + unit-count/allocation/cleanup assertions, refund assertions (incl. summing across multiple refunds), Shopify order assertions incl. duplicate-line-item merging, orders-table alignment, repeat-variance diffing, and aggregate-location exclusion in decrement checks. **Stubs — not real yet:** `clients/newstore.ts` (hardcoded IDs — NS cases 7–8 still unwired). `ts/reports/` now contains REAL staging runs (`regression_US_20260717T*.md`) alongside the older dry-run sample (`regression-report.md`) — check timestamps.

**First live run (2026-07-17, `--store US --cases single`) — FAIL, 2 real findings, both fixed:**

1. **`zeroEverywhere` blast radius.** Querying "every location that exists for a SKU" (by design — see dynamo.ts/dynamo_reader.py docstrings, needed so stale stock elsewhere can't silently block an UNDELIVERABLE case) hit **194 real rows** per SKU in staging (the whole `ATP#`/`ABS#` branch network, not just the 4 documented web/DC locations) and zeroed 193 of them. Confirmed acceptable with JJ: zeroing one SKU's stock entirely is *the* mechanism for forcing undeliverable outcomes and is scoped to one SKU from a small pool per case — not changed. Kept in mind for the future: this is genuinely destructive and not easily reversible (no prior-value capture before overwrite), so treat any change that broadens `zeroEverywhere`'s scope (e.g. more SKUs per case) as a real risk, not just a test concern.
2. **False decrement failures from aggregate/pool locations.** `ATP#INTERNATIONAL` picked up the seeded `ATP#100` quantity ~30–60s after seeding — a downstream mirror/aggregate, not real independent stock, and not something any seed/order action touched. Fixed: `AGGREGATE_LOCATIONS` (`config.ts`: `ATP#INTERNATIONAL`, `ATP#STUDIO`, `ATP#ALL`) is now excluded from `assertDecrements` (`verify/inventory.ts`).

**Also fixed while investigating:** `cases/baselineCases.ts` built its SKU pool via `Object.keys(variantsFor(store))` — since every SKU is a canonical-integer string (e.g. `"32625134"`), JS enumerates those keys in ascending numeric order regardless of declaration order (unlike Python dicts, which preserve insertion order), so `sku(0)` silently resolved to the numerically-smallest SKU instead of the first-declared one. Fixed with explicit `US_SKU_ORDER`/`PS_SKU_ORDER` arrays in `variants.ts` (`skuPoolFor()`), matching the Python reference's case-to-SKU assignment.

**Re-run `--cases single`: PASS.** Full 6-case set: **4/6 passed** (single, multi, unique, split); `undeliverable`/`partial_undeliverable` both timed out on the `cleanup` stage (300s). Root cause: **staging-shipments never deletes the refunded SKU's `ITEM#` row** — confirmed live (orders #9706/#9707) that its `status` instead flips `UNDELIVERABLE` → `REMOVED` roughly 40–60s after the Shopify refund lands, plus a `SHIPMENT_ITEM_REMOVED` transaction row is appended. `assertItemsRemoved` (`verify/shipments.ts`) was checking for row *absence*, which never happens — fixed to check `status === REMOVED` (new constant in `readers/dynamoReader.ts`) instead.

**`REMOVED`-status fix confirmed (2026-07-17, TAA-13 step 1 re-run):** `--store US --cases undeliverable,partial_undeliverable`. `undeliverable` (#9734) **PASS** end to end — real timings: seed_inventory=4.7s, create_order=10.0s, shopify_readback=0.3s, orders_table=25.7s, allocation=30.3s, refund=16.6s, **cleanup=50.6s**, inventory=0.1s. Confirms the `status === REMOVED` check works live and gives a real cleanup timing to tune `PollWindows.cleanup` from (currently 300s default — see poll-window tuning task).

**Isolated finding — one `partial_undeliverable` run never got a refund (2026-07-17, order #9735):** timed out on `refund` at 300s. Direct read (Shopify GraphQL + `staging-orders-v2` + `staging-shipments`, minutes after the timeout, well past any polling window) confirms this is not a slow-but-eventual refund: order #9735 is `PAID` with zero Shopify refunds; the `staging-shipments`/`staging-orders-v2` `ITEM#` row for SKU `32357875` is `UNDELIVERABLE`; and — the key signal — `staging-orders-v2` has only a single `TRANSACTION#...` row for this order (`event: "CREATE_ORDER"`), no refund-related transaction was ever appended. The refund automation never started for this order, it isn't just running long. **Not a systemic gap**: the same case passed with a refund landing in 16–17s in 5 of the 6 other historical `partial_undeliverable` runs (#9709, #9715, #9721, #9727, #9733 all PASS; only the pre-REMOVED-fix #9707 and this #9735 failed, for two different reasons). Treated as an isolated staging-side automation miss on this one order — logged here per JJ's instruction to document surprises rather than work around them silently. If it recurs on a future run, escalate as a real backend defect rather than a harness flake.

**RECURRED (2026-07-22, order #9771).** A US full-set `--repeat 3` re-run (validating the newly-tuned PollWindows) failed the same way: `partial_undeliverable` timed out on `refund` at the new 90s window. Direct Shopify GraphQL check well after the timeout confirms it's genuinely missing, not just slow: order #9771 is `PAID`, `refunds: []`, only the original `SALE` transaction present — identical signature to #9735. **Not a PollWindows tuning artifact**: 90s is ~5.4x the historical observed max (16.7s) for this stage, and the direct check shows zero refunds even minutes later. That's 2 misses out of ~14 `partial_undeliverable` runs (~15%) — a real intermittent gap in the undeliverable→refund backend automation, not a harness issue. **Per JJ (2026-07-22): no ticket for now** — focus stays on finishing the TS rewrite; he'll triage/raise backend defects himself once that's done. Logged here for the record only.

**Full 6-case set × `--repeat 3` — US, PASS, zero variance (2026-07-22, orders #9740–#9757):** all 3 repeats of all 6 cases (single, multi, unique, split, undeliverable, partial_undeliverable) passed identically — `report.ts`'s stable-signature diff found no variance across repeats. `undeliverable` cleanup timings across the 3 repeats: 25.3s / 20.2s / 15.2s (well inside the 300s window, trending down as staging warmed up). All 3 `partial_undeliverable` refunds landed in 5.7s — the isolated #9735 refund-miss above did **not** recur across these 3 fresh runs, reinforcing that it was a one-off staging automation miss rather than a systemic gap. Report: `ts/reports/regression_US_20260722T050946Z.md`. This closes TAA-13 checklist item 7's "full set + repeat 3" step for US; PS is the same set still to run.

**Full 6-case set × `--repeat 3` — PS, PASS, zero variance (2026-07-22, orders #3252–#3269):** same clean result as US — all 3 repeats of all 6 cases passed identically, no stable-signature variance. Timings were tighter than US throughout (PS `seed_inventory` 1.2–6.7s vs US 4–8.8s, `undeliverable` cleanup 10.1–20.2s, `partial_undeliverable` refund 5.7s all 3 runs). Report: `ts/reports/regression_PS_20260722T052237Z.md`. Both stores are now green at `--repeat 3` — the "full set + repeat 3" step of checklist item 7 is done for both stores.

**First full run of the 8-case default set (baseline 1–6 + NS cases 7–8) — US, PASS (2026-07-31):** `node dist/index.js --store US` (no `--cases` filter — since TAA-17 step 3, `ns_sfs`/`ns_otc` are part of the default set alongside the 6 baseline cases). All 8 cases passed: `single`/`multi`/`unique`/`split`/`undeliverable`/`partial_undeliverable` all in line with historical timings (`undeliverable` cleanup 30.4s, `partial_undeliverable` refund 16.5s, both well inside their windows), plus `ns_sfs`/`ns_otc` each landing and reading back in 11.2s/3.9s (well inside the 30s `newstoreReadback` window). Report `regression_US_20260731T060147Z.md`. This is the first time the harness has run true end-to-end — Shopify + AWS + NewStore injection — as a single default invocation rather than baseline and NS cases being exercised separately. PS not run this pass (per JJ, since `ns_sfs`/`ns_otc` are known-blocked there on the `read_products` token scope — see TAA-17 step 3 above); PS's baseline cases 1–6 are unaffected by that blocker and still pass on their own (confirmed 2026-07-22, `--repeat 3`).

**Full 8-case default set re-run post-TAA-15/comment-pass — US, PASS (2026-08-04):** `node dist/index.js --store US`, requested directly by JJ as a general health check after the TAA-15 CLI port + Python retirement + comment-quality pass all landed on `main`. All 8 cases passed, wall-clock ~5:30, no variance flags: `single` #9861, `multi` #9862, `unique` #9863, `split` #9864, `undeliverable` #9865 (refund 19.1s, cleanup 26.4s), `partial_undeliverable` #9866 (refund 5.1s, cleanup 21.3s), `ns_sfs` `QASFS_1785821043922_f3efcb9ea6` (read-back 6.1s), `ns_otc` `QAOTC_1785821055371_408ff450d4` (read-back 3.1s) — every stage comfortably inside its tuned poll window. Report `regression_US_20260804T052421Z.md`. Confirms the consolidated `main` (TAA-14 + TAA-17 merge, TAA-15 CLI port, Python removal, comment pass) is still fully green end to end, not just at the offline-test level.

**Customer identity changed (JJ, 2026-07-17):** no pre-existing Shopify customer GID is used anymore — orders are placed with just an email + name, and Shopify creates/attaches the customer automatically on first use of that email. `BASELINE_CUSTOMERS` (`config.ts`) replaced the previous staff identity (Jared Davis) with a dedicated QA-automation identity per store: US = `JJQA AutoUS` / `QAauto@universalstore.com.au`, PS = `JJQA AutoPS` / `QAauto@perfectstranger.com.au` (confirmed against live order data 2026-07-17, matches `config.ts`). `ShopifyClient.createDraftOrder` (`clients/shopify.ts`) no longer takes/sends `customerId`.

**Next priorities (in order — everything else is blocked on 1–2):**

1. ~~Port `regression/polling.py` → TS~~ — done (`src/polling.ts`).
2. ~~Real `clients/dynamo.ts` (inventory ops)~~ — done.
3. ~~Real readers + schema confirmation~~ — done (`readers/shopifyReader.ts`, `readers/dynamoReader.ts`, `verify/*.ts`).
4. ~~Wire the full stage chain in `runner.ts`~~ — done.
5. ~~`--repeat` variance diff~~ — done (`report.ts`, `cli.ts`).
6. ~~Extend offline tests~~ — done (35 tests, `npm test`).
7. ~~Re-run `undeliverable`/`partial_undeliverable` to confirm the `REMOVED`-status fix~~ — done, `undeliverable` PASS with real `cleanup=50.6s`. ~~Full 6-case set, then `--repeat 3`, both stores~~ — done 2026-07-22, US and PS both PASS with zero variance (see findings above). ~~Tune `PollWindows`~~ — done 2026-07-22 from 71 case runs across 10 reports: `ordersTable` 120→60s, `shipmentsTable+allocation` 420→90s (40/50 split), `refund` 300→90s, `cleanup` 300→120s, `inventory` 240→60s (see `config.ts` comment for the p90/max data behind each); re-validated live post-tune (every stage passed well inside the new windows; the one failure that run was the known refund-automation gap above, unrelated to tuning).

**NewStore read-back endpoint confirmed (2026-07-22):** `GET /v0/d/external_orders/{external_id}` — not `/v0/d/orders/{uuid}` (404s; "no static resource"). Response includes `order_uuid`, `order_id` (`ST...` display id), and `ordered_products[]` with `product_sku`/`quantity`/`item_id`. Propagation delay after injection ≈2s (confirmed via a freshly-injected probe order, `product_id 33006246`), much faster than the Shopify/Dynamo pipeline stages — poll accordingly rather than reusing the longer windows. Unblocks `readers/newstore_reader.py`/TS `newstoreReader.ts` and wiring cases 7–8.

**Confirmed real bug in `order_counter.json` (2026-07-22):** injected a test SFS order reusing the file-based counter (`JD000000022`) and NewStore's `POST /v0/d/fulfill_order` silently returned an **existing, unrelated order** under that external_id (different SKUs than requested) instead of creating a new one or erroring. This is worse than the previously-documented "not concurrency-safe" framing — a stale/reset counter file can silently collide with a real historical order and serve its data instead of failing loudly. Confirms the TS rewrite's planned collision-free external-ID scheme (timestamp + random suffix, per `ts-rewrite-dev-doc.md`) is required, not just a nice-to-have. Do not port `order_counter.json`'s logic as-is.

**NewStore customer identity renamed away from Jared Davis (2026-07-22):** `newstore_orders.py`'s `NS_MOCK_CUSTOMER` (a single flat dict, name "Jared Davis" / `jared.davis@universalstore.com.au`) is now `NS_MOCK_CUSTOMERS` — a per-brand dict (`_active_customer()`) matching the Shopify convention: US = `JJQA AutoNS` / `QAauto@universalstore.com.au`, PS = `JJQA AutoNS` / `QAauto@perfectstranger.com.au`. The `ns_id` (NewStore customer profile UUID) still points at Jared's real profile — needs a real profile for this identity before live use. `NS_ASSOCIATES`/`ACTIVE_ASSOCIATE_ID` (the staff member placing the order) intentionally left untouched — those are real NewStore staff accounts, not a customer identity to rename, and OTC orders require a real one.
8. NS cases 7–8: **APPROVED and IN PROGRESS under [TAA-17](https://universalstore.atlassian.net/browse/TAA-17)** (superseded the earlier "on hold" note). Build the real `clients/newstore.ts` + injection + reader + verify + case wiring per the "FINISH THE TS REWRITE" section at the top of this file. Order creation stays via API injection (`POST /v0/d/fulfill_order`); only the webhook/real-checkout path is parked. Read-back endpoint confirmed: `GET /v0/d/external_orders/{external_id}`.
9. ~~Parity sign-off~~ — done 2026-07-22. Baseline reproduces the Python `regression/` v0.1 spec's case set and assertions in TS, green on both stores at `--repeat 3` (the one known gap, the intermittent refund-automation miss, is a backend defect the harness correctly detects, not a TS/Python parity gap — see above). NS cases 7-8 explicitly excluded from this sign-off per item 8. Python `regression/` package is now retired/historical-reference-only — the TS harness under `ts/` is the live regression suite going forward. `main.py` and the rest of the interactive Python CLI are untouched by this (separate scope, not part of the regression baseline).
10. **AFTER TAA-13 parity sign-off → [TAA-14](https://universalstore.atlassian.net/browse/TAA-14) run-time optimisation (queued — do NOT start mid-validation):** ~20 min `--repeat 3` is serialisation, not staging latency. Phase A quick wins: batch `zeroEverywhere` writes (~194 serial PutItems → BatchWrite), adaptive poll interval (1s→2s→3s→cap 5s; Shopify polls ≥2s), composite stage checks (advance multiple stages per poll tick), live progress line (repeat/case/stage/% + ETA from recorded stage averages). Phase B: **grow variant pools to ≥12 SKUs per store** (also unblocks richer undie/split permutations and future modifier cases — discounts, address changes, new product types), fully disjoint SKUs per case, parallel case scheduler behind `--parallel` (waves derived from declared case SKUs; never two concurrent cases on one SKU; repeats stay serial). Target ≤7 min with identical stable signatures vs sequential.

**TAA-14 Phase A in progress (branch `taa-14-speedup`, started 2026-07-31, no-new-SKU quick wins only — Phase B is separately gated on new staging SKUs).**

- ✅ **Step 1 — batch seed writes (2026-07-31):** `zeroEverywhere` (`clients/dynamo.ts`) now writes in bounded-concurrency batches of 25 (`chunk()` helper, offline-tested in `tests/dynamo.test.js`) instead of one `setStock` at a time; batches run sequentially so a failed write still throws immediately (strict-failure unchanged). Live-confirmed `--store US --cases single`: `seed_inventory` dropped to 1.5s (vs 4.7–8.8s historical for US single-case), rest of the run unaffected, PASS.
- ✅ **Step 2 — adaptive poll interval (2026-07-31):** `pollUntil` (`polling.ts`) now ramps its sleep 1s→2s→3s→cap (the stage's configured `poll.interval`, still 5s) instead of sleeping a fixed 5s every tick, via a new `PollIntervalConfig` + pure `resolveInterval()` (offline-tested in `tests/polling.test.js`). Shopify-touching stages (`shopify_readback`, `refund` in `runner.ts`) keep a 2s floor even on the first poll to stay clear of rate limits. Per-stage timeout windows (`config.ts`) unchanged. Live-confirmed `--store US --cases single`: ramp visible in the log (`next in 1.0s/2.0s/3.0s/5.0s`), `allocation` landed in 16.3s, PASS.
- ✅ **Step 3 — composite orders_table+allocation poll (2026-07-31):** `runner.ts` merged the two stages' separate poll loops into one — each tick fetches staging-orders-v2 rows once, checks `orders_table`'s assertion, resolves the order PK from those same rows (once, not every tick), and checks `allocation`'s assertion via a new `DynamoReader.getShipmentItemsByPk`. Either stage advances the moment its own assertion passes, on its own timeout budget, without waiting for a fresh poll cycle once the other finishes. `orderSkuQuantitiesFromRows`/`orderPkFromRows` split out of `dynamoReader.ts` as pure, offline-tested functions (`tests/dynamoReader.test.js`) to support this. Live-confirmed `--store US --cases single`: log shows `orders_table` done at 16.9s while the same loop kept polling for `allocation` (done at 32.1s) — no fresh restart in between, PASS.
- ✅ **Step 4 — live progress line (2026-07-31):** new `progress.ts` (pure, offline-tested in `tests/progress.test.js`) — `stageSequenceFor` (7 stages, or 8 for refund cases), `buildRunPlan`/`flattenPlan` (the whole `--repeat N` run's stage plan), rolling per-stage-name averages, and `estimateRemainingSeconds` (rest of the current stage + every pending stage, each at its rolling average or a 9s fallback until real samples exist). `pollUntil`/`pollVerify` gained an optional `onWaiting` hook so `runner.ts` renders a line every poll tick instead of the old raw `[poll] stage: waiting...` text, e.g. `[repeat 2/3 · case 4/6 split · stage 5/7 allocation · 14s in stage · run 58% · 2:10/3:50]`. `cli.ts` builds one tracker for the whole CLI invocation so "run %"/ETA span all repeats, not just the current one. Live-confirmed `--store US --cases single`: line rendered correctly through orders_table→allocation, `run %` tracked stage completion accurately, PASS.

**Phase A sign-off — full 6-case set, US, single run (2026-07-31):** `--store US` (all 6 cases, no repeat) — **PASS**, wall-clock **3:44.96** (224.96s), report `regression_US_20260731T034537Z.md` (orders #9805–#9811). Baseline: pre-Phase-A `regression_US_20260722T062227Z.md` Run 1 — PASS, 359.0s (sum of per-stage timings; every stage ran strictly sequentially back then, so that sum *is* the wall-clock). **~37% faster (359.0s → 224.96s, ~1.6x), same pass/fail semantics.** Caveat for anyone reading the new report's per-stage numbers: since Step 3, `orders_table` and `allocation` timings both measure from the same composite-poll start (not sequentially), so their sum overstates real elapsed time — use the measured wall-clock for the top-line comparison, not a sum of the reported per-stage numbers. Phase A quick wins are done; the bigger jump toward the ~5 min target needs Phase B (SKU pool growth + `--parallel`), gated on JJ setting up new staging SKUs separately.

**Phase B SKU pool prep — done for US, PS deferred (2026-07-31):** JJ is building a large (~1000-target, 200 pasted so far per store) staging QA-SKU pool per `staging-sku-setup.md`, well beyond the ≥12 Phase B needs — headroom for TAA-21 fulfilment/rejection cases and future modifier cases (discounts, address changes). Raw SKU lists live in `sku-lists/{store}-skus.txt` (one SKU per line, pasted by JJ). New script `ts/scripts/fetch-sku-gids.js <US|PS>` (standalone, not part of the harness build/tests) resolves each list to `sku-lists/{store}-skus.json` (`sku`, `gid`, `title`, `price`) via the Admin GraphQL `productVariants` query, batched 50/request; read-only, safe to re-run whenever a list changes. **US done:** 191/200 resolved into `sku-lists/us-skus.json`; the 9 unresolved SKUs were removed from `us-skus.txt` by JJ (plenty of headroom, not worth chasing why they didn't resolve). Note for the record: these are ordinary staging-catalog products (real product titles), not dedicated "QA TEST — do not sell" items as `staging-sku-setup.md` recommends — JJ selected/pasted this specific list himself, so treated as an accepted choice, not flagged further. **PS blocked:** `PS_ACCESS_TOKEN` lacks the `read_products` Admin API scope (`ACCESS_DENIED` on `productVariants`) — needs the PS staging custom app's scopes updated and the token reissued (Perfect Stranger admin → Settings → Apps and sales channels → Develop apps → the app → Configuration → Admin API scopes → enable `read_products` → API credentials → reveal/reissue token). Deferred by JJ (2026-07-31) — re-run `node scripts/fetch-sku-gids.js PS` once fixed. **PS skipped entirely for Phase B** — all Phase B work below is US-only until PS is unblocked.

**TAA-14 Phase B in progress (branch `taa-14-speedup`, started 2026-07-31, US only).**

- ✅ **Step 1 — wire US SKU pool (2026-07-31):** `variants.ts`'s `US_VARIANTS`/`US_SKU_ORDER` extended from 5 to 14 SKUs (9 new, from `sku-lists/us-skus.json`). Every new GID was cross-checked programmatically against the source JSON before committing — a first manual-transcription pass had 6 wrong GIDs, caught by that check rather than shipped. PS untouched. Live-confirmed `--store US --cases single`: PASS, no regression (this case still uses the original `sku(0)`, unaffected by the pool growth itself).
- ✅ **Step 2 — disjoint SKU assignment (2026-07-31):** `baselineCases.ts` reassigned so all 6 cases use 10 fully distinct pool slots — `single`=0, `multi`=1, `unique`=2-4, `split`=5-6, `undeliverable`=7, `partial_undeliverable`=8-9 (slots 10-13 unused headroom). Case semantics unchanged, only which SKU each case touches. This is the prerequisite for safe concurrent execution (step 3) — no two cases can race on the same SKU's stock. PS keeps its old 4-SKU modulo-wraparound behavior, unaffected. Live-confirmed full US 6-case set sequential: PASS, same stable signature (all 6 pass, no failures) as the Phase A baseline — report `regression_US_20260731T043418Z.md`. Wall-clock 4:39 this run (vs ~225s Phase A baseline) was normal staging variance (individual poll timings ran slow across the board this round), not a regression from the SKU reassignment.
- ✅ **Step 3 — `--parallel` scheduler + Shopify throttle retry (2026-07-31):** new `scheduler.ts` — pure `buildWaves()` greedily groups cases into SKU-disjoint waves computed from each case's declared `skuQuantities` (never assumed from names/order), and `runBounded()` caps concurrent execution within a wave (default 4, `--concurrency <n>` override) instead of an unbounded `Promise.all`; both offline-tested (`tests/scheduler.test.js`). `runner.ts`'s `run()` branches on `config.parallel`: sequential (default) is the untouched original loop, parallel runs `buildWaves()` output through `runBounded()` with results re-sorted back to case-name order so reports read the same either way. Repeats still loop serially in `cli.ts` regardless of `--parallel` — only cases within one repeat run concurrently. `ShopifyClient.execute()` now retries on HTTP 429 or a GraphQL `THROTTLED` error with backoff (1s/2s/4s/8s default, or a 429's `Retry-After` header if present) before failing — infra-level resilience for concurrent `draftOrderCreate`/`Complete` calls hitting the Admin API's cost throttle; non-throttle failures (plain 5xx, other GraphQL errors) still fail immediately, unchanged. Offline-tested with a mocked `fetch` (`tests/shopify.test.js`), same overridable-retry-delay pattern as `clients/newstore.ts`. Live-confirmed `--store US --cases single` sequential (no `--parallel`): PASS, confirming the `run()` refactor didn't touch the default path. Actual `--parallel` live proving is step 4.
- Process note: the last two commits (steps 1-2) shipped `.ts` changes without their compiled `dist/*.js` — caught and fixed in the step 3 commit (no code difference, `npm run build` output was already correct locally, just hadn't been `git add`ed). Worth double-checking `git status` for stray `dist/` changes before every commit going forward.
- ✅ **Step 4 — equivalence proof + measurement (2026-07-31), Phase B DONE for US:**
  - Full US 6-case set, sequential vs `--parallel` (single pass each): stable signatures programmatically diffed via `report.ts`'s `stableSignature()` — **byte-identical** (all 6 cases pass, no failures, either mode). Reports `regression_US_20260731T043418Z.md` (sequential) vs `regression_US_20260731T045329Z.md` (parallel).
  - `--parallel` single-pass wall-clock: **3:13.88** (193.88s) vs sequential's 4:39 (279.15s) that same session (both slower than the 225s Phase A baseline — staging was running broadly slower all afternoon, not a regression).
  - `--store US --parallel --repeat 3` (18 real orders, #9826-#9843): **PASS, 3 repeats, consistent** — `repeatConsistent: true`, zero variance keys, confirmed both from the rendered report and directly off the JSON. Wall-clock **4:04.10** (244.10s) for the *entire* 3-repeat run.
  - **Headline result: the ticket's documented ~20 min (1200s) pre-TAA-14 baseline for a full `--repeat 3` gate is now ~4 min — a ~4.9x speedup, well under the ≤7 min acceptance target** (and close to the ~5 min aspirational one) — achieved without Phase B's own next steps (further SKU growth beyond 14, PS). All from Phase A (batching/adaptive-poll/composite-poll/progress-line) + Phase B (disjoint SKUs + wave-scheduled concurrency).
  - No Shopify throttle/429 errors surfaced in any of these runs at the default concurrency cap of 4 — the retry path in `ShopifyClient.execute()` exists for when the pool/concurrency grows, but wasn't exercised here. No evidence of interference from the shared per-store QA customer identity (`BASELINE_CUSTOMERS`) across concurrent `draftOrderCreate` calls — all 18+6+6 = 30 orders this step passed cleanly. Flagging per the original ask: not proof of long-term safety at higher concurrency/SKU-pool scale, just no issue observed in what was actually run.
  - PS not attempted (skipped entirely this pass per JJ's instruction — blocked on the `PS_ACCESS_TOKEN` `read_products` scope).

**TAA-14 Phase B: DONE for US** (Phase B's own next-level scope — PS, further SKU growth beyond 14, `--parallel` at higher concurrency — is optional follow-up, not required to hit the ticket's acceptance target, which is already met).

Track progress on [TAA-13](https://universalstore.atlassian.net/browse/TAA-13) — its checklist mirrors this list; tick items as they land.

## Stack & environment

- **Staging only.** Shopify Admin GraphQL 2025-10: `universal-store-staging.myshopify.com` (US), `perfect-stranger-staging.myshopify.com` (PS).
- **Shopify auth (TAA-22):** US = static `US_ACCESS_TOKEN` (predates Shopify's Jan 1 2026 retirement of static custom-app tokens, still works). PS = OAuth client-credentials grant against `https://perfect-stranger-staging.myshopify.com/admin/oauth/access_token` (`PS_CLIENT_ID`/`PS_CLIENT_SECRET`, "QA PS App"), token cached and refreshed ~5 min ahead of its ~24h expiry — see `clients/shopify.ts`.
- **NewStore:** `universalstore-staging.p.newstore.net`, OAuth2 client-credentials via `id.p.newstore.net` (Keycloak). Order injection: `POST /v0/d/fulfill_order`.
- **AWS:** region `ap-southeast-2`, boto3 named profile `staging` (`aws sso login --profile staging` when expired).
- **Env vars (required at import):** `US_ACCESS_TOKEN`, `PS_CLIENT_ID`, `PS_CLIENT_SECRET`, `NS_STAGING_CLIENT_ID`, `NS_STAGING_CLIENT_SECRET`. Optional: `AWS_REGION`, `AWS_PROFILE`, `NS_INVENTORY_STORE_KEY`.
- Build once per checkout: `cd ts && npm install && npm run build`. Place an ad-hoc order: `node dist/index.js order --help` (see `qa-order-cli-tool-documentation.md`). Run the regression suite: `node dist/index.js --help`. No Python, no `requirements.txt` — the tool is 100% TypeScript (Node.js).

## DynamoDB tables (staging)

- `staging-inventory-v2` — PK `sku` (str), SK `store` (str, format `ATP#<storeNo>`), attrs `quantity`, `updatedAt`, `updatedReason`. Known locations: `ATP#100` (web DC), `ATP#99`, `ATP#407` (Chermside / BRANCH_407 / US), `ATP#640` (BRANCH_640 / PS).
- `staging-orders-v2` — order records + transactions (order-finalised, order-item-refunded).
- `staging-shipments` — one `ITEM#` row per unit; allocated to a store or `UNDELIVERABLE`; items carry a rejected-stores array that excludes stores from allocation.

## Allocation levers (determinism)

Allocator reads `ATP#<store>` rows per SKU; store with all SKUs = single shipment; SKUs spread across stores = split; zero stock everywhere (or all in-stock stores in rejected-stores) = undeliverable → Shopify refund → shipment ITEM# rows flip status to `REMOVED` (~40–60s after refund; rows are NEVER deleted — live finding Jul 17) + `SHIPMENT_ITEM_REMOVED` transaction appended; inventory decrements at allocated stores. Never rely on ambient staging stock — seed inventory explicitly per test case, with SKUs isolated per case (concurrent async pipelines interfere otherwise).

## File map

Current (TS, `ts/src/`) — see `qa-order-cli-tool-documentation.md`'s own file-structure table for the `order`-command-relevant subset:

| File | Role |
| --- | --- |
| `cli.ts` / `cli-order.ts` | Entry points — regression suite vs. ad-hoc `order` subcommand (dispatched in `index.ts`) |
| `runner.ts` | Regression case execution — partitions `"pipeline"` vs `"newstore"` cases (see "Consolidation before TAA-15" above) |
| `clients/shopify.ts`, `clients/dynamo.ts`, `clients/newstore.ts` | Shopify Admin GraphQL, DynamoDB, NewStore staging clients |
| `flows/newstoreOrders.ts`, `flows/receipts.ts`, `flows/orderFlow.ts`, `flows/inventoryFlow.ts` | Order-placement/receipt orchestration reused by both entry points |
| `cases/`, `readers/`, `verify/` | Regression-suite case definitions, read-back, and assertions |

<details>
<summary>Historical Python file map (removed 2026-08-04, TAA-15 — kept for archaeology, git history has the full source)</summary>

| File | Role |
| --- | --- |
| `main.py` | CLI menus, customer pools, presets, Shopify order flow (`place_an_order`) — interactive, bypass for regression work |
| `orders_processor.py` | Shopify GraphQL layer: draft→complete flow, customers, prices, `US_VARIANTS`/`PS_VARIANTS` SKU→GID maps |
| `graphql_scripts.py` | GraphQL query/mutation strings |
| `newstore_orders.py` | NS SFS/OTC payload builders + injection; `JD#########` external IDs via `order_counter.json` |
| `newstore_client.py` | Retrying OAuth2 HTTP client (`staging_client` singleton) |
| `aws_inventory.py` | `get_stock` / `set_stock` / `ensure_stock` (top-up to 99) / `split_stock` (qty 1 across 4 ATP locations) |
| `receipt_service.py` | PDF receipt via NS Template Service, attached as order note (all failures non-fatal by design) |

</details>

## Known gotchas (historical — found during the Jul 2026 Python code review, all since fixed/ported into the TS harness; kept because the *reasons* still explain why the TS side works the way it does)

1. **Order IDs are discarded** — `complete_draft_order` returns None; `draftOrderComplete` GraphQL doesn't select `draftOrder { order { id name } }`. First fix for regression work. TS: `ShopifyClient.createDraftOrder` always returns `{orderId, orderName, createdAt}`.
2. **Silent failures:** `ensure_stock`/`split_stock` swallow AWS errors and return `{}` (order proceeds anyway); `get_shopify_prices` silently skips unknown SKUs; NS price lookup falls back to $1.00. TS: every client throws on failure — no `strict` toggle needed, strict is the only mode.
3. **Import-time side effects:** `orders_processor` and `newstore_client` build clients at import (KeyError without env vars). Mutable module globals hold store/brand state. TS: every client takes `store`/config as a constructor/call argument, never a module global; env vars are only read when a client method actually needs them.
4. **Shopify merges duplicate line items; DynamoDB/NewStore do not** — cross-system item-count assertions must account for this. Still true in TS — `verify/orders.ts` and `cli-order.ts`'s NS SKU expansion both handle it explicitly.
5. `order_counter.json` isn't concurrency-safe. TS: collision-free `QA{SFS|OTC}_{timestamp}_{random}` external IDs, no shared counter file. Receipt hardcoded shipping 10.0 vs 9.99 charged, and "Universal Store" name even for PS — both fixed in `flows/receipts.ts`.
6. Presets are built positionally from variant dicts — reordering the dicts silently changes preset contents. No longer applicable — presets themselves aren't ported (deferred TAA-15 scope, see "Not yet ported" in `qa-order-cli-tool-documentation.md`).

## Conventions for new work

- The TS harness (`ts/`) is the whole tool now — there is no Python to keep in sync with. Extend it directly.
- Strict by default: every client throws on failure, no silent fallbacks or synthetic data. Only the receipt flow (`flows/receipts.ts`) is deliberately non-fatal, and that's a documented, narrow exception (a receipt decorates an already-successful order; it isn't a correctness check) — don't generalize it elsewhere.
- No module-global state: config is an explicit object built by the caller (`config.ts`'s `RegressionConfig` for the regression suite, `cli-order.ts`'s `OrderCliConfig` for ad-hoc orders) and passed down — never a mutable module-level toggle.
- Every creation call returns identifiers; every assertion failure reports expected-vs-actual from each system involved.
- `--repeat N` (regression suite only) diffs JSON results between identical runs — variance is a flagged inconsistency (race-condition signal); don't break this contract when touching `runner.ts`/`report.ts`.
- Prefer reuse over re-porting: the `order` command's build (TAA-15) added new capability to existing clients (e.g. `ShopifyClient.fetchPickupLocations`) rather than duplicating logic — follow that pattern for future ad-hoc-command capability.
- `npm run build` (tsc) + `npm test` (`node --test tests/*.test.js`) must stay green — offline tests cover pure logic (arg parsing, payload shape, assertions); live staging runs are the separate, explicit confirm step for anything network-facing.
- Update `qa-order-cli-tool-documentation.md`'s changelog when `order`-command-facing behaviour changes; update this file (`CLAUDE.md`) when harness-internal behaviour, decisions, or live-run findings change. Track build progress on the relevant TAA ticket (currently TAA-22's last item, then TAA-15's remaining scope).
- Run reports are disposable and auto-pruned to the 10 most recent (see "Report retention" at the top). Never cite a report filename as durable evidence without also recording the substance — the numbers, order ids and verdict — here or on the ticket.
- `cli.ts`'s `--help` and `--list-cases` are user-facing documentation. When cases or flags change, update them in the same commit — `printHelp()` silently drifted two cases out of date once already.

## TypeScript rewrite handoff (Jul 17, 2026) — HISTORICAL, superseded by "TS state" above

<details>
<summary>The original scaffold-era handoff note, kept for archaeology. Every "next" in it has shipped, and several filenames it lists no longer exist — <code>src/verification/verification.ts</code> and <code>src/verification/assertions.ts</code> became <code>src/verify/{orders,refunds,shipments,inventory,newstore}.ts</code>, and the scaffold runner was replaced wholesale. Do not read this as current state.</summary>

A TypeScript rewrite scaffold for the QA regression harness is now present under `ts/` and is aligned to the Python baseline in `regression-package-design.md` and `scope-of-work-reworked.md`.

### What exists now

- `ts/package.json` and `ts/tsconfig.json` to build/run a minimal TS harness.
- `ts/src/config.ts` with baseline config + case selection and report-dir support.
- `ts/src/cli.ts` with CLI parsing for `--store`, `--cases`, `--repeat`, `--report-dir`, `--quiet`, `--list-cases`, and `--help`.
- `ts/src/runner.ts` with a runnable case runner that emits a structured stage list including inventory preparation, order creation, Shopify verification, allocation verification, and inventory decrement checks.
- `ts/src/flows/orderFlow.ts` and `ts/src/flows/inventoryFlow.ts` implementing the first-order flow for inventory prep before order placement.
- `ts/src/clients/shopify.ts`, `ts/src/clients/dynamo.ts`, and `ts/src/clients/newstore.ts` as module boundaries for the rewrite.
- `ts/src/verification/verification.ts` and `ts/src/report.ts` for evidence output and reporting.
- `ts/tests/verification.test.js` with offline tests for the new inventory decrement assertion.
- `run-regression.sh` at the repo root as a wrapper that builds/runs the TS harness from the repository root.

### Verified status

The scaffold was verified locally with:

- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm install`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && npm run build`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator/ts && node --test tests/verification.test.js`
- `cd /Users/james.johnston/Documents/GitHub/qa/shopify-order-creator && ./run-regression.sh --store US --cases single,multi --repeat 1 --report-dir ./reports`

Observed result: the TypeScript build succeeded, the offline verification tests passed, and the harness executed successfully, generating:

- `ts/reports/regression-report.md`
- `ts/reports/regression-report.json`

### Next implementation focus

The next implementation slice should continue porting the real regression baseline logic from the Python package into the TS structure:

1. Full baseline case definitions (single, multi, unique, split, undeliverable, partial-undeliverable) now available in `ts/src/cases/baselineCases.ts`.
2. Inventory seeding plus deeper polling logic and live read-back readers.
3. Readers and verification modules for Shopify, AWS/DynamoDB, and NewStore should be tightened further against the live staging schemas.
4. Repeat-run variance reporting and CLI flags matching the Python parity contract should be iterated after schema confirmation.

This scaffold is a runnable starting point for the TAA rewrite work and should be treated as the initial handoff artifact for follow-on co-working/admin work.

</details>

*(The repo-root `ts-rewrite-handoff.txt` was a standalone copy of this same note. It's been reduced to a pointer at this file and is safe to delete.)*
