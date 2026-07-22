"""
NewStore order injection via the Order Injection API.

Supports two order types, both targeted at the staging environment only:

  Ship From Store (SFS):
    The order is placed as a store channel order and routed to the active
    brand's fulfilment node. A store associate picks the item and ships it
    to the customer's address. NewStore manages the routing and fulfilment.

  Over the Counter (OTC):
    Simulates a completed in-store purchase — the customer walked in, paid,
    and left with the item. Marked as immediately fulfilled so NewStore skips
    routing. Requires an associate ID (the staff member who processed the sale).

Both types use:
  - Cash payment (no real payment processor involved on staging)
  - Real Shopify prices fetched via orders_processor.get_shopify_prices()
  - GST tax lines (required by the NewStore schema — omitting them causes a
    schema_validation_error)
  - A unique external_id so each injected order can be traced back to this tool

API reference: POST /v0/d/fulfill_order
Docs: https://docs.newstore.net/api/integration/order-management/order_injection_api

Brand switching:
    Call set_brand("US") or set_brand("PS") to switch between Universal Store
    and Perfect Stranger. This changes the shop ID, store ID, and store address.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from newstore_client import staging_client
import orders_processor


# ---------------------------------------------------------------------------
# Brand / store config
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Associates
#
# The associate_id field links an order to a specific store staff member.
# Required for OTC orders; optional but included on SFS orders too for
# traceability. Associate IDs are the UUID from the staff profile URL in
# NewStore Manager.
# ---------------------------------------------------------------------------

NS_ASSOCIATES: dict[str, str] = {
    "Jared Davis":                 "834f3c4de5ae50c787c5ad9b937f80bf",
    "Sanjana Mallikarjun Dhabadi": "e32e0a69de63513fb9d017849e135c3f",
}

# The currently active associate — all orders use this until changed via set_associate().
ACTIVE_ASSOCIATE_ID:   str = "834f3c4de5ae50c787c5ad9b937f80bf"
ACTIVE_ASSOCIATE_NAME: str = "Jared Davis"


def set_associate(name: str):
    """
    Sets the active associate for all subsequent SFS and OTC orders.

    Args:
        name: Display name key from NS_ASSOCIATES (e.g. "Jared Davis").
    """
    global ACTIVE_ASSOCIATE_ID, ACTIVE_ASSOCIATE_NAME
    if name not in NS_ASSOCIATES:
        raise ValueError(f"Unknown associate '{name}'. Valid options: {list(NS_ASSOCIATES)}")
    ACTIVE_ASSOCIATE_ID   = NS_ASSOCIATES[name]
    ACTIVE_ASSOCIATE_NAME = name


# ---------------------------------------------------------------------------
# NewStore shop identifiers — the `shop` field in the order payload.
# These are the tenant-level identifiers for each brand within NewStore.
SHOP_IDS: dict[str, str] = {
    "US": "us-store",
    "PS": "ps-store",
}

# NewStore store IDs — the BRANCH_{number} identifiers for physical stores.
# Used as `store_id` in all orders, and as `channel_name` in OTC orders.
# "BRANCH_407" = Universal Store Chermside, "BRANCH_640" = Perfect Stranger Chermside.
STORE_IDS: dict[str, str] = {
    "US": "BRANCH_407",
    "PS": "BRANCH_640",
}

# Fulfilment node ID for SFS orders.
# Confirmed from a real NewStore delivery payload: the platform expects the
# literal string "ORDER_FULFILLMENT_NODE" here, not a store UUID or branch ID.
# This tells NewStore to route the order through the standard fulfilment flow.
FULFILLMENT_NODE_IDS: dict[str, str] = {
    "US": "ORDER_FULFILLMENT_NODE",
    "PS": "ORDER_FULFILLMENT_NODE",
}

# Active brand — changed via set_brand() or the Settings menu in main.py.
BRAND: str = "US"


def set_brand(brand: str):
    """
    Switches the active NewStore brand for all subsequent order calls.

    Args:
        brand: "US" (Universal Store) or "PS" (Perfect Stranger).
    """
    global BRAND
    if brand not in SHOP_IDS:
        raise ValueError(f"Unknown brand '{brand}'. Valid options: {list(SHOP_IDS)}")
    BRAND = brand


# Convenience accessors — always resolve from the current BRAND value.
# Defined as functions (not variables) so they reflect BRAND changes immediately.
def _active_shop_id()          -> str: return SHOP_IDS[BRAND]
def _active_store_id()         -> str: return STORE_IDS[BRAND]
def _active_fulfillment_node() -> str: return FULFILLMENT_NODE_IDS[BRAND]


# ---------------------------------------------------------------------------
# Shared order config
#
# These defaults apply to both SFS and OTC orders. Most can be adjusted
# at runtime via the Settings menu without restarting the tool.
# ---------------------------------------------------------------------------

NS_CONFIG: dict = {
    # BCP-47 locale tag attached to every order.
    "shop_locale": "en-AU",

    # All NewStore staging orders are in AUD.
    "currency": "AUD",

    # "tax_included" tells NewStore that item prices already contain GST.
    # This is the Australian standard — prices are GST-inclusive, not ex-GST.
    "price_method": "tax_included",

    # Service level for Ship From Store orders (maps to a carrier config in NewStore).
    "sfs_service_level": "sl_EXPRESS",

    # Service level for OTC orders. "IN_STORE_HANDOVER" is the NewStore
    # service level that triggers immediate fulfilment — confirmed from the
    # order.opened webhook payload of a real in-store purchase.
    "otc_service_level": "IN_STORE_HANDOVER",

    # Fallback item price used when a SKU's real price can't be fetched from
    # Shopify (e.g. the SKU isn't in the VARIANTS map). Set low so it's obvious
    # in the NewStore UI that it's a fallback and not a real price.
    "fallback_item_price": 1.00,

    # Shipping charge applied to SFS orders. Should match the rate that
    # would appear in a real checkout for the active service level.
    "default_shipping_price": 9.99,

}


# ---------------------------------------------------------------------------
# Product ID mapping
#
# In NewStore staging, product_id == SKU (e.g. "33203669"). This was confirmed
# by comparing the order.opened webhook payload against the SKUs we know.
# The function is defined as an abstraction in case the mapping changes.
# ---------------------------------------------------------------------------

def sku_to_product_id(sku: str) -> str:
    """Returns the NewStore product ID for a SKU (currently a 1:1 passthrough)."""
    return sku


# ---------------------------------------------------------------------------
# Mock customer and store addresses
# ---------------------------------------------------------------------------

# Customer details used on all NewStore test orders — dedicated QA-automation
# identity per brand, matching the Shopify convention (config.ts BASELINE_CUSTOMERS).
# NOTE: `ns_id` below still points at the old Jared Davis NewStore customer profile —
# it needs a real profile ID for this identity before these orders are actually
# injected live (see CLAUDE.md: NS cases 7-8 injection is on hold pending review).
NS_MOCK_CUSTOMERS: dict[str, dict] = {
    "US": {
        "name":  "JJQA AutoNS",
        "email": "QAauto@universalstore.com.au",
        "ns_id": "2bf9c32f-6e43-408a-b5f8-1a86981c00c4",
    },
    "PS": {
        "name":  "JJQA AutoNS",
        "email": "QAauto@perfectstranger.com.au",
        "ns_id": "2bf9c32f-6e43-408a-b5f8-1a86981c00c4",
    },
}


def _active_customer() -> dict:
    """Returns the QA-automation customer identity for the active brand."""
    return NS_MOCK_CUSTOMERS[BRAND]


# Kept for backward compatibility with any code still referencing the old flat dict.
NS_MOCK_CUSTOMER = NS_MOCK_CUSTOMERS["US"]

# The delivery address used as shipping_address on SFS orders.
NS_MOCK_CUSTOMER_ADDRESS: dict = {
    "first_name":     "JJQA",
    "last_name":      "AutoNS",
    "address_line_1": "42 William Farrior Place",
    "address_line_2": "",
    "zip_code":       "4009",
    "city":           "Eagle Farm",
    "state":          "QLD",
    "country":        "AU",
    "phone":          "0414 697 063",
}

# Store addresses — used as shipping_address on OTC orders.
#
# Why the store's address instead of the customer's?
#   For in-store handover orders, NewStore records the STORE location as the
#   shipping destination (the customer collected from the store, so that's
#   where the "shipment" went). This was confirmed by comparing a real
#   in-store order.opened webhook payload against a web order payload.
#
# NOTE: These are placeholder addresses. Update with real store addresses
# for BRANCH_407 and BRANCH_640 if address accuracy matters for your tests.
NS_STORE_ADDRESSES: dict[str, dict] = {
    "US": {
        "first_name":     "BRANCH_407",
        "last_name":      "",
        "address_line_1": "BRANCH_407, Westfield Chermside, 395 Hamilton Road",
        "address_line_2": "",
        "zip_code":       "4032",
        "city":           "Chermside",
        "state":          "QLD",
        "country":        "AU",
        "phone":          "",
    },
    "PS": {
        "first_name":     "BRANCH_640",
        "last_name":      "",
        "address_line_1": "BRANCH_640, Westfield Chermside, 395 Hamilton Road",
        "address_line_2": "",
        "zip_code":       "4032",
        "city":           "Chermside",
        "state":          "QLD",
        "country":        "AU",
        "phone":          "",
    },
}

# Alias kept for backward compatibility — some older code may reference NS_MOCK_ADDRESS.
NS_MOCK_ADDRESS = NS_MOCK_CUSTOMER_ADDRESS


def _active_store_address() -> dict:
    """Returns the store's physical address for the active brand (used in OTC payloads)."""
    return NS_STORE_ADDRESSES[BRAND]


# ---------------------------------------------------------------------------
# Internal payload builders
# ---------------------------------------------------------------------------

_COUNTER_FILE = Path(__file__).parent / "order_counter.json"


def _next_order_number() -> int:
    """Read, increment, and persist the sequential order counter."""
    if _COUNTER_FILE.exists():
        n = json.loads(_COUNTER_FILE.read_text()).get("counter", 0) + 1
    else:
        n = 1
    _COUNTER_FILE.write_text(json.dumps({"counter": n}))
    return n


def _external_id(prefix: str) -> str:
    """
    Generates a sequential external order ID for NewStore injection.

    Format:  JD000000001, JD000000002, ...
    The counter persists in order_counter.json between runs.
    The prefix argument is kept for compatibility but not used in the ID.
    """
    return f"JD{_next_order_number():09d}"


def _placed_at() -> str:
    """
    Returns the current UTC time in ISO 8601 format.

    NewStore requires placed_at on every order to set the order creation time.
    UTC is used to avoid timezone ambiguity.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _lookup_prices(skus: list[str]) -> dict[str, float]:
    """
    Fetches real item prices from Shopify for the given SKUs.

    Calls orders_processor.get_shopify_prices() which does a single batch
    GraphQL lookup. Falls back to NS_CONFIG["fallback_item_price"] for any
    SKU not found in the Shopify variant map (e.g. NewStore-only products).

    Why use real prices?
        If the injected order total doesn't match the payment amount, NewStore
        may flag a discrepancy. Using real prices keeps the order consistent
        with what a customer would actually pay.
    """
    try:
        prices = orders_processor.get_shopify_prices(skus)
    except Exception as e:
        # Shopify call failed entirely — fall back for all SKUs.
        print(f"    [price lookup] Shopify price fetch failed ({e}) — using fallback for all SKUs")
        prices = {}

    result: dict[str, float] = {}
    for sku in skus:
        if sku in prices:
            result[sku] = prices[sku]
        else:
            # SKU not in the Shopify variant map — use the configured fallback.
            fallback = NS_CONFIG["fallback_item_price"]
            print(f"    [price lookup] {sku}: not found in Shopify → using fallback ${fallback:.2f}")
            result[sku] = fallback
    return result


def _gst_amount(price: float) -> float:
    """
    Extracts the GST component from a tax-included (GST-inclusive) price.

    Australian GST is 10%. For a tax-included price, the formula is:
        GST = price / 11

    Why divide by 11?
        If price = $110 (GST-inclusive), then:
          - Ex-GST amount = $100
          - GST = $10
          - $110 / 11 = $10  ✓

    NewStore requires this value in the item_tax_lines field. Omitting tax
    lines causes a schema_validation_error from the Order Injection API.
    """
    return round(price / 11, 2)


def _build_items(skus: list[str], prices: dict[str, float]) -> list[dict]:
    """
    Builds the `items` list for a NewStore shipment payload.

    Each item needs:
      - external_item_id: unique identifier for this line item
      - product_id: the SKU (confirmed to match NewStore's product_id field)
      - price block with the item price, list price, and GST tax line

    The item_list_price is set equal to item_price (no discount applied).
    Adjust if you need to test discount or markdown scenarios.
    """
    return [
        {
            "external_item_id": f"ITEM_{i + 1}_{sku}",  # e.g. "ITEM_1_33203669"
            "product_id":       sku_to_product_id(sku),
            "price": {
                "item_price":      prices[sku],
                "item_list_price": prices[sku],  # same as price — no markdown
                "item_tax_lines": [
                    {
                        "name":         "GST",
                        "amount":       _gst_amount(prices[sku]),
                        "rate":         0.1,        # 10% GST rate
                        "country_code": "AU",
                    }
                ],
            },
        }
        for i, sku in enumerate(skus)
    ]


def _build_cash_payment(total_amount: float) -> dict:
    """
    Builds a cash payment record for the NewStore order payload.

    All test orders use cash — no real payment processor is involved.
    The correlation_ref must be unique per payment to prevent NewStore from
    rejecting it as a duplicate transaction.
    """
    return {
        "processor":       "cash",
        "correlation_ref": f"CASH_{uuid.uuid4().hex[:12]}",  # unique per payment
        "type":            "captured",   # "captured" = payment already received
        "amount":          round(total_amount, 2),
        "method":          "cash",
        "processed_at":    _placed_at(),
    }


def _calculate_total(skus: list[str], prices: dict[str, float], include_shipping: bool = False) -> float:
    """
    Calculates the total order amount (items + optional shipping).

    The total must match the payment amount exactly, otherwise NewStore will
    flag a payment discrepancy error.

    Args:
        skus:             Ordered list of SKUs (preserves duplicates — the same SKU
                          can appear multiple times if ordered in qty > 1).
        prices:           {sku: price} dict — NOTE: this is a dict so duplicate SKUs
                          only have one entry. We must sum over `skus` (not prices.values())
                          so duplicate line items are counted the correct number of times.
        include_shipping: True for SFS orders (customer pays shipping).
                          False for OTC (no shipping charge for counter pickup).
    """
    # Sum price for each entry in the skus list, not each unique SKU in the dict.
    # If skus = ["33413679", "33413679"], this correctly counts $140 twice.
    item_total = sum(prices[sku] for sku in skus)
    shipping   = NS_CONFIG["default_shipping_price"] if include_shipping else 0.0
    return round(item_total + shipping, 2)


# ---------------------------------------------------------------------------
# Order creation — Ship From Store
# ---------------------------------------------------------------------------

def create_sfs_order(skus: list[str]) -> dict:
    """
    Injects a Ship From Store order into NewStore staging.

    What happens after injection:
      1. NewStore receives the order and validates the payload.
      2. It routes the order to the fulfilment node (ORDER_FULFILLMENT_NODE).
      3. A store associate picks and ships the item to the customer address.

    is_preconfirmed=False and is_fulfilled=False tell NewStore to handle
    the full fulfilment lifecycle — routing, picking, shipping, tracking.

    Args:
        skus: List of SKUs to include as line items.

    Returns:
        NewStore response dict containing 'id' (NewStore order ID) and
        'external_id' (the jaredScriptTesting_SFS_... value we set).
    """
    prices      = _lookup_prices(skus)
    total       = _calculate_total(skus, prices, include_shipping=True)  # customer pays shipping
    external_id = _external_id("SFS")

    payload = {
        "external_id":  external_id,
        "placed_at":    _placed_at(),
        "shop":         _active_shop_id(),
        "shop_locale":  NS_CONFIG["shop_locale"],
        "channel_type": "store",
        "channel_name": "QA Ship From Store",   # descriptive label — visible in NewStore UI
        "currency":     NS_CONFIG["currency"],
        "store_id":     _active_store_id(),
        "associate_id": ACTIVE_ASSOCIATE_ID,  # the staff member placing/processing the order
        "customer_name":        _active_customer()["name"],
        "customer_email":       _active_customer()["email"],
        "external_customer_id": _active_customer()["ns_id"],  # links order to the NewStore profile
        "is_preconfirmed": False,  # NewStore will handle routing and confirmation
        "is_fulfilled":    False,  # NewStore will handle picking and shipping
        "price_method":    NS_CONFIG["price_method"],
        "shipping_address": NS_MOCK_CUSTOMER_ADDRESS,  # where the item is delivered
        "billing_address":  NS_MOCK_CUSTOMER_ADDRESS,
        "shipments": [
            {
                "items": _build_items(skus, prices),
                "shipping_option": {
                    "fulfillment_node_id":      _active_fulfillment_node(),
                    "service_level_identifier": NS_CONFIG["sfs_service_level"],
                    "price": NS_CONFIG["default_shipping_price"],
                    # Shipping tax = GST on the shipping charge (same 1/11 formula)
                    "tax":   round(NS_CONFIG["default_shipping_price"] / 11, 2),
                },
            }
        ],
        "payments": [_build_cash_payment(total)],
    }

    return staging_client.post("/v0/d/fulfill_order", payload)


# ---------------------------------------------------------------------------
# Order creation — Over the Counter
# ---------------------------------------------------------------------------


def create_otc_order(skus: list[str]) -> dict:
    """
    Injects an Over the Counter (in-store, immediately fulfilled) order.

    This simulates a customer walking into a store, buying something, and
    leaving with it. Key differences from SFS:

      is_fulfilled=True, is_preconfirmed=True:
          The transaction is already complete — no routing or shipping needed.
          NewStore records it as a closed sale immediately.

      channel_name = store ID (e.g. "BRANCH_407"):
          For OTC, channel_name must be the store ID rather than a descriptive
          label. Confirmed from the order.opened webhook of a real in-store sale.

      associate_id:
          Required for in-store purchases to identify the staff member.
          NewStore rejects OTC orders without this field.

      shipping_address = store address (not customer address):
          For in-store handover, NewStore records the store's address as the
          shipping destination (the item was "shipped" to the store counter).
          Using the customer's home address here causes incorrect routing.

      shipping_option price = 0.0:
          No delivery charge for counter pickup. The shipping_option field is
          still required by the schema even though the price is zero.

    Args:
        skus: List of SKUs sold over the counter.

    Returns:
        NewStore response dict containing 'id' and 'external_id'.
    """
    prices        = _lookup_prices(skus)
    total         = _calculate_total(skus, prices, include_shipping=False)  # no shipping charge
    external_id   = _external_id("OTC")
    store_address = _active_store_address()

    payload = {
        "external_id":  external_id,
        "placed_at":    _placed_at(),
        "shop":         _active_shop_id(),
        "shop_locale":  NS_CONFIG["shop_locale"],
        "channel_type": "store",
        # OTC channel_name must be the store ID — confirmed from order.opened webhook.
        "channel_name": _active_store_id(),
        "currency":     NS_CONFIG["currency"],
        "store_id":     _active_store_id(),
        "associate_id": ACTIVE_ASSOCIATE_ID,  # required for OTC; set via set_associate()
        "customer_name":        _active_customer()["name"],
        "customer_email":       _active_customer()["email"],
        "external_customer_id": _active_customer()["ns_id"],  # links order to the NewStore profile
        "is_preconfirmed": True,  # sale already confirmed at the register
        "is_fulfilled":    True,  # item already handed to the customer
        "price_method":    NS_CONFIG["price_method"],
        # OTC uses the store's address — confirmed from order.opened webhook.
        "shipping_address": store_address,
        "billing_address":  NS_MOCK_CUSTOMER_ADDRESS,
        "shipments": [
            {
                "items": _build_items(skus, prices),
                # shipping_option is required by the schema even for OTC.
                # Price and tax are both 0.0 — no delivery charge for counter pickup.
                "shipping_option": {
                    "fulfillment_node_id":      _active_fulfillment_node(),
                    "service_level_identifier": NS_CONFIG["otc_service_level"],
                    "price": 0.0,
                    "tax":   0.0,
                },
            }
        ],
        "payments": [_build_cash_payment(total)],
    }

    return staging_client.post("/v0/d/fulfill_order", payload)


# ---------------------------------------------------------------------------
# Order lookup
# ---------------------------------------------------------------------------

def get_display_id(external_id: str) -> str:
    """
    Returns the display identifier for an injected order.

    NewStore only generates ST.../GD... display IDs for orders placed natively
    through its own checkout flow. Orders injected via POST /v0/d/fulfill_order
    use the external_id we supplied as their display identifier — it is what
    appears in NewStore Manager and what the order retrieval API returns as `id`.
    """
    return external_id
