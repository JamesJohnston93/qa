"""
Receipt generation and order note attachment for NewStore injected orders.

NewStore only creates receipts in its Documents section via the NOM app checkout
flow — injected orders don't trigger that pipeline. This module works around it:

  1. Discovers the sales receipt template via the Template Service API.
  2. Renders the template to PDF using the order's data.
  3. Posts the resulting permanent link as an order note, making it visible
     on the order page in NewStore Manager under the Notes section.
  4. Optionally saves the PDF locally to receipts/<order_id>.pdf.

All steps after order injection are non-fatal — errors are caught, printed,
and a fallback text-only note is posted so the order page still shows something.
"""

import os
import requests
from datetime import datetime, timezone
from pathlib import Path

from newstore_client import staging_client
import orders_processor


# ---------------------------------------------------------------------------
# Template discovery — cached after first call
# ---------------------------------------------------------------------------

_RECEIPT_TEMPLATE_ID:   str  | None = None
_RECEIPT_SAMPLE_DATA:   dict | None = None


def _find_receipt_template_id() -> str:
    """
    Lists all templates and returns the ID of the sales receipt template.
    Caches the result so only one API call is made per session.
    """
    global _RECEIPT_TEMPLATE_ID
    if _RECEIPT_TEMPLATE_ID:
        return _RECEIPT_TEMPLATE_ID

    data      = staging_client.get("/v0/d/templates/templates")
    templates = data.get("data", [])
    ids       = [t.get("id", "") for t in templates]

    # Match on common NewStore sales receipt template IDs.
    for candidate in ("sales_receipt", "sales-receipt", "pos_sales_receipt", "receipt"):
        for tid in ids:
            if candidate in tid.lower():
                _RECEIPT_TEMPLATE_ID = tid
                return tid

    raise ValueError(
        f"Could not find a sales receipt template. "
        f"Available templates: {ids}\n"
        f"Update _find_receipt_template_id() with the correct ID."
    )


def _get_sample_data(template_id: str) -> dict:
    """
    Fetches the template's sample data and caches it.
    Used as the base render payload so all fields the template expects are
    present with valid defaults — we then overlay our order's real values.
    Logs top-level keys on first fetch to aid schema debugging.
    """
    global _RECEIPT_SAMPLE_DATA
    if _RECEIPT_SAMPLE_DATA is not None:
        return _RECEIPT_SAMPLE_DATA

    try:
        data = staging_client.get(f"/v0/d/templates/templates/{template_id}/sample_data")
        _RECEIPT_SAMPLE_DATA = data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"    [receipt] Could not fetch sample data: {e}")
        _RECEIPT_SAMPLE_DATA = {}


    return _RECEIPT_SAMPLE_DATA


# ---------------------------------------------------------------------------
# NewStore catalog lookup — product names and EANs
# ---------------------------------------------------------------------------

def _lookup_catalog_info(skus: list[str]) -> dict[str, dict]:
    """
    Fetches product name and EAN for each SKU from the NewStore Customer API.

    Endpoint: GET /v0/c/products/sku={sku}?locale=en-AU&shop=us-store
    Docs: /api/integration/catalog-sfcc/consumer-api_api  (Get product details)

    The `type` path segment takes the form `sku=` — NewStore uses this pattern
    to resolve a product by any external identifier type (sku, gtin, ean13…).

    Returns:
        {sku: {"name": str, "ean": str}}
        Missing/failed SKUs are omitted; callers fall back to raw SKU as label.
    """
    import newstore_orders  # local import — avoids circular dependency at module load

    shop   = newstore_orders._active_shop_id()       # e.g. "us-store"
    locale = newstore_orders.NS_CONFIG["shop_locale"] # e.g. "en-AU"

    info: dict[str, dict] = {}
    for sku in set(skus):
        try:
            data = staging_client.get(
                f"/v0/c/products/sku={sku}",
                params={"locale": locale, "shop": shop},
            )
            title = data.get("title") or sku
            # EAN is stored in external_identifiers as ean13, gtin, or top-level gtin.
            ext   = data.get("external_identifiers") or {}
            ean   = ext.get("ean13") or ext.get("gtin") or data.get("gtin") or ""
            info[sku] = {"name": title, "ean": ean}
        except Exception as e:
            print(f"    [receipt] Catalog lookup failed for {sku}: {e}")
    return info


# ---------------------------------------------------------------------------
# Render data builder
# ---------------------------------------------------------------------------

def _build_render_data(
    skus: list[str],
    prices: dict[str, float],
    total: float,
    external_id: str,
    fulfillment_group: str,
    include_shipping: bool,
    associate_name: str = "",
    product_info: dict | None = None,
) -> dict:
    """
    Maps our order data to the shape the receipt template expects.

    Field names are derived from the template's sample data keys:
      customer_name, associate_name, store_name, order_number, external_id,
      currency_code, flat_items, items, amounts, instruments, ...

    Product names default to the SKU — a catalog lookup would improve this
    but would add latency to every order.
    """
    now = datetime.now(timezone.utc).isoformat()

    flat_items = []
    for sku in skus:
        price = prices.get(sku, 0.0)
        tax   = round(price / 11, 2)
        net   = round(price - tax, 2)
        info  = (product_info or {}).get(sku, {})
        name  = info.get("name") or sku   # fall back to SKU if Shopify lookup missed
        ean   = info.get("ean")  or ""
        flat_items.append({
            "product_name":               name,
            "product_id":                 sku,
            "fulfillment_group_type":     fulfillment_group,
            "external_identifier":        {"epc": ean, "sku": sku},
            "amount":                     price,
            "product_attributes":         {"variation_size_value": ""},
            "price_net":                  net,
            "price_gross":                price,
            "price_tax":                  tax,
            "price_catalog":              price,
            "price_override_reason":      "",
            "price_override_reason_type": "",
            "item_discount":              0,
            "item_order_discount":        0,
            "product_image_url":          "",
            "tax_method":                 "vat_included",
            "discounts":                  [],
            "group_id":                   "",
            "extended_attributes":        [],
            "addons":                     [],
        })

    shipping  = 10.0 if include_shipping else 0.0
    total_tax = round(total / 11, 2)
    total_net = round(total - total_tax, 2)

    tax_lines = [{"name": "GST", "rate": 0.1, "amount": total_tax}]

    return {
        # Order identity
        "order_number":          external_id,
        "external_id":           external_id,
        "created_at":            now,
        "currency_code":         "AUD",
        "timezone":              "Australia/Brisbane",
        "tax_exempt":            False,

        # People / location
        "customer_name":         "Jared Davis",
        "associate_name":        associate_name or "QA Tool",
        "store_name":            "Universal Store",
        "tenant_address":        "Level 2, 100 Market St, Sydney NSW 2000",
        "store_address":         "Chermside Shopping Centre, 395 Hamilton Rd, Chermside QLD 4032",
        "store_phone_number":    "",

        # Items — both flat_items and items share the same schema
        "flat_items":            flat_items,
        "items":                 flat_items,
        "discounts":             [],
        "extended_attributes":   [],
        "order_notes":           [],
        "shipping_method":       "in_store_handover" if not include_shipping else "shipping",

        # Payment — field names from sample data
        "payment_method_label":  "Cash",
        # payment_method must be "credit_card" — the template has a cash-specific
        # code path that crashes (Jinja2 dict attribute error). Brand label is set
        # to "Cash" so the rendered receipt still reads correctly for QA purposes.
        "instruments": [
            {
                "instrument_id":    "00000000-0000-0000-0000-000000000000",
                "payment_provider": "cash",
                "payment_method":   "credit_card",
                "currency_code":    "AUD",
                "metadata": {
                    "instrument_details": {
                        "last4":  "0000",
                        "brand":  "Cash",
                    },
                },
                "amount": total,
            }
        ],

        # Totals — field names from sample data
        "amounts": {
            "shipping_and_handling": shipping,
            "taxes":                 total_tax,
            "grand_total":           total,
            "sub_total":             total_net,
            "tax_lines":             tax_lines,
            "gift_wrapping":         0,
        },
        "fulfillment_group_amounts": {
            fulfillment_group: {
                "tax_lines":             tax_lines,
                "sub_total":             total_net,
                "grand_total":           total,
                "taxes":                 total_tax,
                "shipping_and_handling": shipping,
            }
        },

        # Addresses
        "billing_address":  None,
        "shipping_address": None,

        # qr_code intentionally omitted — template expects base64 PNG,
        # not a plain string. Sample data's placeholder image passes through.
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def generate_and_attach_receipt(
    order_uuid:      str,
    external_id:     str,
    skus:            list[str],
    prices:          dict[str, float],
    total:           float,
    associate_id:    str,
    associate_name:  str,
    order_type:      str,   # "SFS" or "OTC"
    save_locally:    bool = False,
) -> None:
    """
    Renders the sales receipt template and posts a link as an order note.

    If the render step fails for any reason (wrong template ID, schema mismatch,
    etc.), a fallback text-only note is posted instead so the order page still
    has a record. The order placement itself is never affected.

    Args:
        order_uuid:   Internal NewStore UUID (the 'id' field from the injection
                      response) — required by the Order Notes API.
        external_id:  Our human-readable order ID (e.g. JD000000001).
        skus:         List of SKUs on the order.
        prices:       Dict mapping SKU → price (AUD, GST-inclusive).
        total:        Total amount charged (items + shipping if SFS).
        associate_id: UUID of the associate posting the note.
        order_type:   "SFS" or "OTC" — determines fulfillment group and shipping.
        save_locally: If True, downloads the rendered PDF and saves it to
                      receipts/<external_id>.pdf in the project directory.
    """
    now               = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    include_shipping  = (order_type == "SFS")
    fulfillment_group = "SHIPPING" if order_type == "SFS" else "IN_STORE_HANDOVER"
    permanent_link    = None

    # ------------------------------------------------------------------
    # Step 1: fetch product names and EANs from NewStore catalog (non-fatal)
    # ------------------------------------------------------------------
    product_info: dict = {}
    try:
        product_info = _lookup_catalog_info(skus)
    except Exception as e:
        print(f"    [receipt] Catalog lookup failed ({e}) — using SKUs as names")

    # ------------------------------------------------------------------
    # Step 2: render the receipt template to PDF
    # ------------------------------------------------------------------
    try:
        template_id  = _find_receipt_template_id()
        sample_data  = _get_sample_data(template_id)
        our_data     = _build_render_data(
            skus, prices, total, external_id, fulfillment_group, include_shipping,
            associate_name=associate_name,
            product_info=product_info,
        )
        # Use sample data as the base so all template-required fields are
        # present, then override with our real order values.
        render_data  = {**sample_data, **our_data}
        render_result = staging_client.post(
            f"/v0/d/templates/templates/{template_id}/render",
            {
                "locale":       "en_AU",
                "data":         render_data,
                "content_type": "pdf",
            },
        )
        permanent_link = render_result.get("permanent_link") or render_result.get("output")
        if not permanent_link:
            raise ValueError(f"Render succeeded but returned no link. Response: {render_result}")

    except Exception as e:
        print(f"    [receipt] Render failed: {e}")

    # ------------------------------------------------------------------
    # Step 3: optionally save PDF locally
    # ------------------------------------------------------------------
    if save_locally and permanent_link:
        try:
            receipts_dir = Path(__file__).parent / "receipts"
            receipts_dir.mkdir(exist_ok=True)
            pdf_path = receipts_dir / f"{external_id}.pdf"
            pdf_bytes = requests.get(permanent_link, timeout=15).content
            pdf_path.write_bytes(pdf_bytes)
            print(f"    [receipt] Saved → receipts/{external_id}.pdf")
        except Exception as e:
            print(f"    [receipt] Local save failed: {e}")

    # ------------------------------------------------------------------
    # Step 4: post as an order note (always attempted)
    # ------------------------------------------------------------------
    if permanent_link:
        note_text = f"Sales Receipt:\n{permanent_link}"
    else:
        note_text = f"Sales Receipt ({order_type}): PDF could not be generated — check receipt_service.py logs."

    try:
        staging_client.post(
            f"/v0/d/orders/{order_uuid}/notes",
            {
                "text":        note_text,
                "source":      associate_name or "QA Tool",
                "source_type": "app",
                "tags":        ["sales_receipt", "qa_tool"],
            },
        )
        status = "with PDF link" if permanent_link else "text-only (render failed)"
        print(f"    [receipt] Note posted ({status})")
    except Exception as e:
        print(f"    [receipt] Note post failed: {e}")
