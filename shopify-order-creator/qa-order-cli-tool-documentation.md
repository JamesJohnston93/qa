# QA Order CLI — Tool Documentation

An interactive command-line tool for placing test orders on the Universal Store / Perfect Stranger staging environments. Supports both **Shopify** (draft orders via Admin GraphQL API) and **NewStore** (Ship From Store and Over the Counter order injection). Automatically manages DynamoDB inventory before every order and generates a PDF sales receipt attached as an order note in NewStore Manager.

**Originally built by:** Jared Davis (jared.davis@universalstore.com.au)
**Repo owner:** JJ (james.johnston@universalstore.com.au)
**Location:** [JamesJohnston93/qa](https://github.com/JamesJohnston93/qa) → `shopify-order-creator/` *(moved Jul 2026 from UniversalStore/python-scripts; will move to an org repo later)*
**Run with:** `python main.py`

> **Related — automated regression harness:** this CLI is the *interactive* tool. The automated, headless verification of the same pipeline (order → allocation → shipments → inventory across Shopify, AWS, and NewStore) lives in the same repo under `shopify-order-creator/ts/` (TypeScript, active — see TAA-13) with a Python reference under `regression/`. See the "Regression Package Design" and "TS Rewrite Dev Doc" pages under QA Automation Tool.

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

---

## Main Menu

The tool opens to a top-level menu showing the active Shopify store and NewStore brand:

```
  QA Order Tool

  Shopify: US   NewStore: US (staging)
  ────────────────────────────────────────────

  1  Shopify orders
  2  NewStore orders

  s  Settings
  q  Quit
```

---

## Shopify Orders

Places draft orders via the Shopify Admin GraphQL API against the active store (US or PS). All orders use existing customers from the configured customer pool.

### Order Modes

| Option | Description |
| --- | --- |
| **Random orders** | Generates random line items within the configured min/max range (default 1–3 items) |
| **Preset orders** | Choose from _single_ (1 item), _multi_ (3× same item), or _unique_ (3 different items) |
| **Orders by SKU** | Type specific SKUs manually (comma-separated) |
| **Stress test** | Creates new Shopify customers (`jared.davis+N@...`) and places orders for each |

### Order Flow

1. Build line items (random, preset, or manual)
2. Update DynamoDB inventory (ensure stock or split shipment)
3. `draftOrderCreate` — saves a draft in Shopify
4. `draftOrderComplete` — finalises into a real paid order (now also returns the created order's id and name — used by the regression harness; no CLI behaviour change)

---

## NewStore Orders

Injects orders directly into the NewStore staging environment via the Order Injection API. Two order types are supported:

| Type | Key | Description |
| --- | --- | --- |
| **Ship From Store (SFS)** | `SHIPPING` | Standard shipped order; includes shipping cost in receipt total |
| **Over the Counter (OTC)** | `IN_STORE_HANDOVER` | In-store handover order; no shipping cost |

### SKU Selection Modes

| Mode | Description |
| --- | --- |
| **Random** | Picks random SKUs within the min/max line item range |
| **Preset** | Choose from _single_, _multi_ (3× same), or _unique_ (3 different SKUs) |
| **By SKU** | Manually enter comma-separated SKU codes; unknown SKUs warn but proceed |

### Inventory Modes

| Mode | Description |
| --- | --- |
| **Standard** | Tops up stock to 99 at a single ATP location (ATP#100). Use for most tests. |
| **Split shipment** | Sets qty=1 at ATP#100, ATP#99, ATP#407, and ATP#640. Forces NewStore to route each item to a different fulfilment node — use to test split-shipment routing. |

> **Staging inventory note (Jul 2026 finding):** a SKU can have ~194 location rows in staging, not just the four listed above, and aggregate locations (`ATP#INTERNATIONAL`, `ATP#STUDIO`, `ATP#ALL`) mirror stock asynchronously. Fine for interactive use; matters if you're reasoning about exact stock states.

### Order IDs

NewStore orders are assigned sequential external IDs in the format `JD000000001`, `JD000000002`, etc. The counter is persisted to `order_counter.json` in the project directory and increments across runs. *(Not concurrency-safe — don't run two instances simultaneously.)*

---

## Receipt Generation

After every NewStore order is placed, the tool automatically generates a PDF sales receipt and attaches it as an order note. This works around the fact that injected orders don't go through the NOM app checkout, so NewStore never creates a receipt natively.

### Process

1. **Catalog lookup** — fetches product name and EAN barcode for each SKU from the NewStore Customer API (`GET /v0/c/products/sku={sku}?locale=en-AU&shop=us-store`). Non-fatal — falls back to raw SKU if the lookup fails.
2. **Template render** — renders the `sales_receipt` template to PDF via the NewStore Template Service (`POST /v0/d/templates/templates/{id}/render`). Uses the template's own sample data as a base, overlaid with real order values.
3. **Local save** (optional) — downloads the PDF to `receipts/{external_id}.pdf` in the project directory. Controlled by the _Save receipts locally_ toggle in Settings.
4. **Order note** — posts the permanent PDF link as a note on the order in NewStore Manager. Note text: `Sales Receipt: https://...`. Author shows as the active associate.

### Technical Notes

- Payment instrument uses `payment_method: "credit_card"` with `brand: "Cash"` — the template's native cash code path has a Jinja2 rendering bug that causes a 422 error, so this is the working workaround.
- The QR code field is omitted from the render payload intentionally — the template expects a base64 PNG, not a URL string.
- NewStore Manager notes are plain text only — no clickable hyperlinks are possible at the platform level.
- Prices are GST-inclusive (10% VAT). Tax is back-calculated as `price / 11`.
- Store name, address, and phone are fetched live from the NewStore locations API (`GET /v0/d/config/v1/ops/stores/{store_id}`) and cached per store ID for the session. On failure, the store ID string (e.g. `BRANCH_407`) is used as a fallback.
- Known inconsistencies (accepted for now): receipt shows shipping $10.00 vs $9.99 actually charged, and "Universal Store" as store name even for PS orders.

---

## Settings Menu

Accessible from the main menu via **S**. All changes are session-only — restart the tool to reset to defaults.

| Option | Setting | Default |
| --- | --- | --- |
| 1 | Orders per customer (Shopify runs) | 10 |
| 2 | Random item range (min – max line items) | 1 – 3 |
| 3 | Stress test — number of new customers to create | 1 |
| 4 | Switch Shopify store (US ↔ PS) | US |
| 5 | Delivery method — pin a specific shipping rate or pickup location | First available |
| 6 | Switch NewStore brand (US ↔ PS) | US |
| 7 | Fallback item price — used when Shopify price lookup fails | $29.99 |
| 8 | Inventory store key — DynamoDB location key for stock top-up | ATP#100 |
| 9 | Active associate — choose from configured associates | Jared Davis |
| 10 | Save receipts locally (On/Off toggle) | Off |

> Note: the Shopify store (option 4) and NewStore brand (option 6) are **separate toggles** — switching one does not switch the other. Keep them aligned when placing NS orders, since NS price lookups use the active Shopify store.

---

## Associate Configuration

Associates are defined in `newstore_orders.py` in the `NS_ASSOCIATES` dict, mapping a display name to a NewStore associate UUID. The active associate is used as the note author on receipt notes posted to NewStore Manager.

To switch associate mid-session: Settings → option 9.

---

## Brand / Store Switching

| Platform | Brands | How to switch |
| --- | --- | --- |
| Shopify | US (Universal Store), PS (Perfect Stranger) | Settings → option 4 |
| NewStore | US, PS | Settings → option 6 |

Switching store also rebuilds the preset maps and customer pool for the new store automatically.

---

## File Structure

| File | Purpose |
| --- | --- |
| `main.py` | CLI entry point, menus, Shopify order flow |
| `newstore_orders.py` | NewStore order injection (SFS & OTC), price lookups, associate config |
| `receipt_service.py` | Receipt PDF generation and order note posting |
| `orders_processor.py` | Shopify GraphQL calls (draft orders, customers, shipping rates) |
| `graphql_scripts.py` | GraphQL query/mutation strings |
| `aws_inventory.py` | DynamoDB stock management (ensure_stock, split_stock; both accept `strict=True` for the regression harness — CLI behaviour unchanged) |
| `newstore_client.py` | NewStore staging HTTP client (OAuth2, GET/POST helpers) |
| `order_counter.json` | Persists the sequential JD order ID counter |
| `receipts/` | Downloaded receipt PDFs (when "Save receipts locally" is On) |
| `regression/` | Python regression package (reference spec for the TS harness — not part of the interactive CLI) |
| `ts/` | TypeScript regression harness (active — see TAA-13) |

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-07-17 | Repo moved to [JamesJohnston93/qa](https://github.com/JamesJohnston93/qa) (`shopify-order-creator/`). Additive module changes for the regression harness: `complete_draft_order` now returns the created order's id/name; `ensure_stock`/`split_stock` accept `strict=True`. No interactive CLI behaviour changes. Documentation ownership: JJ. |
| 2026-07-03 | Dynamic store location lookup — store name, address, and phone are now fetched live from the NewStore locations API (`GET /v0/d/config/v1/ops/stores/{store_id}`) and cached per session. Previously these were hardcoded values. |
| 2026-07-03 | Receipt PDF generation via NewStore Template Service; product names and EANs from NewStore catalog; order note posts permanent PDF link; save-locally toggle (Settings option 10); fixed cash payment instrument workaround; associate name shown as note author |
| 2026-07-03 | Initial documentation created |
