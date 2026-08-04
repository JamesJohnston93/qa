# QA Order CLI — Tool Documentation

A command-line tool for placing test orders on the Universal Store / Perfect Stranger staging environments. Supports both **Shopify** (draft orders via Admin GraphQL API) and **NewStore** (Ship From Store and Over the Counter order injection). Manages DynamoDB inventory before a Shopify order and generates a PDF sales receipt attached as an order note in NewStore Manager for NewStore orders.

**Originally built by:** Jared Davis (jared.davis@universalstore.com.au)
**Repo owner:** JJ (james.johnston@universalstore.com.au)
**Location:** [JamesJohnston93/qa](https://github.com/JamesJohnston93/qa) → `shopify-order-creator/`
**Run with:** `node dist/index.js order [options]` (from `shopify-order-creator/ts/`, after `npm run build`)

> **TypeScript rewrite complete (2026-08-04, TAA-15).** The tool is now 100% TypeScript — the original interactive Python CLI (`main.py` and its menus, presets, stress-test mode, and settings menu) has been retired. What replaced it is a minimal ad-hoc order-placement command (`order`), covering the tool's actual daily use: placing one custom test order on demand. It does not (yet) replicate every menu the Python CLI had — see "Not yet ported" below.

> **Related — automated regression harness:** the same repo's `shopify-order-creator/ts/` also runs the automated, headless verification suite (order → allocation → shipments → inventory across Shopify, AWS, and NewStore — see TAA-13). `node dist/index.js` with no subcommand runs that regression suite; `node dist/index.js order ...` places one ad-hoc order. See the "Regression Package Design" and "TS Rewrite Dev Doc" pages under QA Automation Tool for the regression suite's own docs.

---

## Setup & Prerequisites

The following environment variables must be set before running the tool:

| Variable | Purpose |
| --- | --- |
| `US_ACCESS_TOKEN` | Shopify Admin API token — Universal Store staging |
| `PS_ACCESS_TOKEN` | Shopify Admin API token — Perfect Stranger staging |
| `NS_STAGING_CLIENT_ID` | NewStore OAuth2 client ID |
| `NS_STAGING_CLIENT_SECRET` | NewStore OAuth2 client secret |

AWS credentials are loaded from the `staging` named profile. Run `aws sso login --profile staging` if credentials have expired.

Build once per checkout (or after pulling changes): `cd shopify-order-creator/ts && npm install && npm run build`.

---

## Placing a Shopify order

```
node dist/index.js order --store US --items 32625134x2,33006246x1
```

| Flag | Description | Default |
| --- | --- | --- |
| `--store <US\|PS>` | Target store | `US` |
| `--items <spec>` | `SKUxQTY,SKUxQTY,...` — a bare SKU implies quantity 1 | *(required)* |
| `--seed <mode>` | Inventory seed mode — see below | `standard` |
| `--delivery <spec>` | `rate:<exact shipping rate title>` or `pickup:<exact location name>` | first available shipping rate |
| `--email <email>` | Override the default QA-automation customer email | per-store QA identity |

### Inventory seed modes (`--seed`)

| Mode | Description |
| --- | --- |
| `standard` | Tops up stock to 99 at the default location (`ATP#100`) if it's currently below 10. Use for most test orders. |
| `split` | Sets qty=1 at each of `ATP#100`, `ATP#99`, `ATP#407`, and `ATP#640`. Forces the allocator to split the shipment across stores. |
| `zero` | Zeroes stock everywhere for each ordered SKU — forces an `UNDELIVERABLE` outcome (Shopify refund, no shipment). |
| `none` | Doesn't touch inventory at all — use when you've already seeded stock yourself, or don't care about the outcome. |

> **Staging inventory note:** a SKU can have ~194 location rows in staging, not just the four ATP locations listed above, and aggregate locations (`ATP#INTERNATIONAL`, `ATP#STUDIO`, `ATP#ALL`) mirror stock asynchronously. `zero` zeroes every location row that exists, not just the four named ones.

On success, prints the created order's Shopify name and GID immediately:

```
Shopify order placed (US):
  Order name: #9860
  Order id:   gid://shopify/Order/7819764564241
```

---

## Placing a NewStore order

```
node dist/index.js order --ns sfs --items 33006246x1
```

| Flag | Description | Default |
| --- | --- | --- |
| `--ns <sfs\|otc>` | Ship From Store or Over the Counter injection | *(required to enter NewStore mode)* |
| `--store <US\|PS>` | Target brand | `US` |
| `--items <spec>` | Same format as the Shopify command | *(required)* |
| `--save-receipt` | Also download the generated receipt PDF locally | off |

`--email`, `--delivery`, and a non-default `--seed` are not accepted with `--ns` — NewStore orders use a fixed per-store QA customer identity and never touch Shopify shipping or staging inventory (a NewStore-injected order never touches Shopify or `staging-inventory-v2` at all).

On success, prints the external ID and NewStore order UUID immediately, then attempts to attach a receipt (non-fatal — a receipt failure is logged but never blocks the order):

```
NewStore SFS order placed (US):
  External ID: QASFS_1785818538240_6e9e1ee470
  Order UUID:  703d37b8-91ef-509e-a3d6-ef40aaf47ad7
    [receipt] Note posted (with PDF link)
```

### Receipt generation

After a NewStore order is placed, a PDF sales receipt is automatically generated and attached as an order note. This works around the fact that injected orders don't go through the NOM app checkout, so NewStore never creates a receipt natively.

1. **Catalog lookup** — fetches product name and EAN barcode for each SKU from the NewStore Customer API. Non-fatal — falls back to the raw SKU if the lookup fails.
2. **Template render** — renders the `sales_receipt` template to PDF via the NewStore Template Service, using the template's own sample data as a base overlaid with real order values.
3. **Local save** (optional, `--save-receipt`) — downloads the PDF to `receipts/{external_id}.pdf` in the project directory (gitignored).
4. **Order note** — posts the permanent PDF link as a note on the order in NewStore Manager.

Known accepted quirks: payment instrument uses `payment_method: "credit_card"` with `brand: "Cash"` (the template's native cash code path has a rendering bug); the QR code field is intentionally omitted (template expects a base64 PNG, not a URL string); NewStore Manager notes are plain text only, no clickable hyperlinks.

---

## Not yet ported (deferred — later TAA-15 work)

The original Python CLI's interactive menus covered more ground than the current `order` command. These are explicitly out of scope for now, not forgotten:

- Settings menu (session-persisted delivery/associate/fallback-price preferences)
- Presets (single/multi/unique) and random-order generation
- Stress testing (bulk order runs across many new customers)
- Associate switching for NewStore OTC orders (currently a fixed real associate account)
- Fire-and-verify mode (running the regression harness's verification chain against an ad-hoc order)
- Any GUI

---

## File Structure

| Path | Purpose |
| --- | --- |
| `ts/src/cli-order.ts` | The `order` subcommand — ad-hoc Shopify/NewStore order placement |
| `ts/src/clients/shopify.ts` | Shopify Admin GraphQL client (draft orders, shipping rates, pickup locations, variant prices) |
| `ts/src/clients/newstore.ts` | NewStore staging HTTP client (OAuth2, GET/POST helpers) |
| `ts/src/clients/dynamo.ts` | DynamoDB stock management |
| `ts/src/flows/newstoreOrders.ts` | NewStore order injection (SFS & OTC) payload builders + price lookups |
| `ts/src/flows/receipts.ts` | Receipt PDF generation and order note posting |
| `ts/` (rest) | TypeScript regression harness — see TAA-13/TAA-14/TAA-17 in `CLAUDE.md` |

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-08-04 | **Python fully retired (TAA-15).** `main.py` and its remaining Python-only dependencies (`orders_processor.py`, `aws_inventory.py`, `graphql_scripts.py`, `newstore_client.py`, `newstore_orders.py`, `receipt_service.py`) deleted. Replaced by the minimal `order` subcommand described above — live-confirmed on staging (Shopify #9860, NewStore SFS `QASFS_1785818538240_6e9e1ee470`). Settings menu, presets, stress-test, and fire-and-verify remain deferred (see "Not yet ported"). `requirements.txt` removed — no Python dependencies remain. |
| 2026-07-17 | Repo moved to [JamesJohnston93/qa](https://github.com/JamesJohnston93/qa) (`shopify-order-creator/`). Additive module changes for the regression harness: `complete_draft_order` now returns the created order's id/name; `ensure_stock`/`split_stock` accept `strict=True`. No interactive CLI behaviour changes. Documentation ownership: JJ. |
| 2026-07-03 | Dynamic store location lookup — store name, address, and phone are now fetched live from the NewStore locations API and cached per session. Previously these were hardcoded values. |
| 2026-07-03 | Receipt PDF generation via NewStore Template Service; product names and EANs from NewStore catalog; order note posts permanent PDF link; save-locally toggle; fixed cash payment instrument workaround; associate name shown as note author |
| 2026-07-03 | Initial documentation created |
