# Cin7 ↔ Manhattan SCALE testing tools — agent guide

Read this before running anything here. It exists so you don't have to scan the directory to
work out what is safe.

**What this is:** a hand-maintained toolset for testing the Cin7 and Manhattan SCALE
integrations. It is not part of the application and is not in a git repository. It is commonly
handed to a QA engineer as a zip, so treat the person you are helping as someone testing a
feature, not developing one.

**Your job here** is usually one of: introduce a test order into a stage, read back what the
pipeline did with it, or explain why something didn't arrive. Prefer reading state over
re-running things.

## Layout

| Path | Contents |
| --- | --- |
| `cin7-sales-orders/` | Cin7 sales orders → SCALE Shipments. ECOM, WHOLESALE and RTV. Has `fixtures/` |
| `cin7-item-master/` | Cin7 item master → SCALE Items, and the older UNI `us`/`ps` catalog sync |
| `common/` | Tools serving every integration: `cin7-watermark.sh`, `probe-manhattan.sh` |

Each folder has its own `README.md` with a per-tool table. Read the folder README for the
integration you're working on before reaching for a script — the tables say what each tool does
and whether it writes.

**The two integrations are unrelated pipelines.** A sales-order question is never answered by an
`cin7-item-master/` tool, and vice versa. Check which folder a tool is in before suggesting it.

## Hard rules

1. **Never write to Cin7.** Cin7 is CTC's production system. Every tool here is GET-only against
   it, and it must stay that way. If a task seems to need a Cin7 write, stop and say so.
2. **Never run a destructive tool without being asked explicitly.** `clean-ctc-order.sh` deletes
   records. `probe-manhattan.sh --send` posts to SCALE. `cin7-watermark.sh --set --confirm`
   changes what the poller will re-read.
3. **Don't relax a stage guard.** Several scripts refuse to run outside the stages they are
   scoped to, and `clean-ctc-order.sh` additionally verifies the AWS account. These are
   deliberate. `--i-know-what-im-doing` exists but should not be suggested.
4. **Don't print credentials.** `.env` holds a live Cin7 credential. Never cat it, echo it, or
   include it in output. It is deliberately excluded when this directory is zipped.

## Credentials and access

* **Cin7:** `CIN7_USERNAME` / `CIN7_API_KEY` from a `.env` **at this root**. Every Cin7-facing
  script finds it from any subfolder. `.env.example` is the template. If `.env` is missing, the
  user needs to create it — only the three Cin7-facing sales-order tools and three item-master
  tools need it; most tools don't.
* **AWS:** every script takes `--stage <stage> --profile <profile>` and uses the user's own SSO
  session. None carry credentials. A `CredentialsProviderError` means the SSO session lapsed —
  the fix is for the user to log in again, not a change to the script.

## Which stages accept writes

| Tool | Accepts |
| --- | --- |
| `cin7-sales-orders/invoke-so-revision.sh` | `kian-dev`, `staging` (else needs an override flag; `--dry-run` always works) |
| `cin7-sales-orders/stale-payload-hash.sh` | `kian-dev`, `staging` (`--show` is read-only anywhere) |
| `cin7-sales-orders/clean-ctc-order.sh` | a development stage only, with an independent AWS account check. **Not usable on staging** — a QA reset needs an engineer |
| `common/cin7-watermark.sh` | any stage, but only writes with `--set --confirm` |

## Traps that have actually caused wasted time

**Scenario resolution is ambiguous by design.** Several scenario basenames (`01-baseline`,
`06-address-changed`, `07-echo-stage-only`, `08-ineligible-declined`, `09-dispatched-terminal`)
exist in **all three** of `fixtures/ecom`, `fixtures/wholesale` and `fixtures/rtv` with unrelated
content. Auto-detection resolves ECOM first.

* For an RTV scenario, always pass **both**: `--family outbound --order-type RTV`.
* `--order-type RTV` alone is not enough — it only reorders the search *within* the outbound
  family, which auto-detection never reaches.
* For wholesale, `--family outbound` is enough (wholesale is searched first within outbound).

**`invoke-so-revision.sh` reimplements the service's mapping rules in Python.** It manufactures
the transaction itself rather than calling the deployed code, so mapping logic exists twice. A
green end-to-end run proves the document SCALE accepts, **not** that the deployed mapper builds
it. If a mapping rule changes in the service, grep this script for the same rule — the two have
drifted before and produced failures that looked like service bugs.

**Always use an order reference that has never been pushed through before.** Transaction keys and
stored shipment fields changed shape; records left by an older build sit in a different place from
where current code looks, and an order can materialise then silently never send. There is no
self-service reset on staging.

**`cin7-watermark.sh` needs `--poller` every time** (`so` | `po` | `item`). It has a default, and
reading or resetting the wrong flow's parameter is silent.

**A successful send to SCALE is not logged.** The outbound sender logs nothing on success — no
payload, no reply. Confirming a shipment arrived correctly means looking in SCALE itself. Don't
conclude from silent logs that nothing happened.

**SCALE accepts or rejects a document atomically.** One line naming an unknown item fails the
*whole* shipment. "Nothing arrived" is often one bad product code.

**`invoke-shipment-sender.sh --family outbound` publishes and returns.** It does not invoke the
sender directly, so its log tail genuinely lags — the event has to pass a rule, a populator and a
shared queue first. Give it longer before concluding it failed.

## Fixtures

`cin7-sales-orders/fixtures/` holds scenario payloads, one file per scenario, each changing one
thing from the baseline:

* `ecom/` — 13 scenarios, derived from a redacted real ECOM order.
* `wholesale/` — 19 scenarios, derived from a redacted real wholesale order. The full set of
  line-level changes: quantity up/down, size added/removed/re-added, address changed, plus edge
  cases.
* `rtv/` — a baseline and one revision adding a supplier email. **These are composed, not
  captured:** no in-scope RTV exists in Cin7 to capture. The header shape comes from the one real
  RTV observed, the line structure from a real wholesale order, and three fields are substituted
  (Australian address, in-scope branch, open stage). See `fixtures/rtv/README.md` — it is explicit
  about what is real and what isn't. Don't present an RTV run as evidence about real RTV content.

The `make-*.py` generators rewrite these files from the captured baselines. They are offline —
no Cin7, no AWS — so they are safe to run, but they overwrite the fixture directory.

## Diagnosing "it didn't arrive"

In this order, stopping when you find the answer:

1. **Poller log** — was the order read at all? An out-of-scope branch is never fetched, so absence
   of any mention is expected, not a fault. Look for `Cin7SOPollerAlert` entries: a refused
   mapping (e.g. an unmapped country) is logged there and is contained to that one order.
2. **The DLQs** — one per hop. Anything parked means the hop failed and retried out.
3. **The stored header** in the shipments table — what status does it hold? `PENDING_OUTBOUND`
   means it materialised but the send hasn't succeeded; `SENT_OUTBOUND` means SCALE accepted it;
   `CANCELLED_OUTBOUND` means it was cancelled.
4. **SCALE itself** — the only place a success is observable.

`cin7-sales-orders/inspect-ctc-order.sh` prints most of steps 2–3 for one reference in a single
command; `check-ctc-status.sh` shows queue and DLQ depths. Prefer these over hand-rolled AWS CLI
calls.

## Extending this directory

It is a living toolset shared across the Cin7 and Manhattan integrations — **don't delete or
deprecate anything**. Add a new tool to the folder for the integration it serves, or to `common/`
if it genuinely serves all of them, and add a row to that folder's README table. Don't create a
scratch directory elsewhere.
