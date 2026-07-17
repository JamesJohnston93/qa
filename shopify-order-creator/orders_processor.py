"""
Shopify order placement via the Admin GraphQL API.

Handles the full draft-order lifecycle for Universal Store (US) and Perfect
Stranger (PS) staging environments:
  1. Optionally calculate shipping rates (draftOrderCalculate)
  2. Create a draft order (draftOrderCreate)
  3. Complete/finalise the draft (draftOrderComplete)

Also provides customer creation helpers used by the stress-test flow, and a
price-lookup function used by newstore_orders to fetch real Shopify prices.

Store switching:
    Call set_store("US") or set_store("PS") to switch the active store.
    This updates the Shopify client, variant map, and resets any saved
    delivery preferences (since rates and locations are store-specific).

Delivery method:
    By default, the first available shipping rate is used automatically.
    Call set_preferred_shipping_rate(title) to pin a specific rate name,
    or set_preferred_pickup_location(id, name) to switch to click-and-collect.
"""

import os
import random
from python_graphql_client import GraphqlClient

# Import only the specific query/mutation functions needed — avoids polluting
# the namespace with everything in graphql_scripts.
from graphql_scripts import (
    get_create_customer,
    get_customer_by_email,
    get_create_draft_order,
    get_complete_draft_order,
    get_calculate_draft_order,
    get_locations,
    get_variant_prices,
)


# ---------------------------------------------------------------------------
# Shopify API clients
#
# Each store has its own Shopify instance with a separate access token.
# Tokens are read from environment variables so they're never hardcoded.
# The active client (us_client or ps_client) is selected by set_store().
# ---------------------------------------------------------------------------

us_client = GraphqlClient(
    endpoint="https://universal-store-staging.myshopify.com/admin/api/2025-10/graphql.json",
    headers={
        "Content-Type": "application/json",
        # Token must be set in the environment before running the tool.
        "X-Shopify-Access-Token": os.environ["US_ACCESS_TOKEN"],
    },
)

ps_client = GraphqlClient(
    endpoint="https://perfect-stranger-staging.myshopify.com/admin/api/2025-10/graphql.json",
    headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": os.environ["PS_ACCESS_TOKEN"],
    },
)


# ---------------------------------------------------------------------------
# Variant maps  (SKU → Shopify variant GID)
#
# Shopify identifies product variants by GID (Global ID), not SKU.
# These dicts map from the SKU (the human-readable product code) to the
# corresponding GID for each store's staging environment.
#
# To add new test products: find the variant GID in Shopify admin or via the
# GraphQL API, then add the SKU → GID pair to the appropriate dict.
# ---------------------------------------------------------------------------

US_VARIANTS: dict[str, str] = {
    "32625134": "gid://shopify/ProductVariant/51763546423569",
    "32357875": "gid://shopify/ProductVariant/51760210739473",
    "33006246": "gid://shopify/ProductVariant/51764543422737",
    "33660301": "gid://shopify/ProductVariant/51764570456337",
    "33413679": "gid://shopify/ProductVariant/51764606599441",
}

PS_VARIANTS: dict[str, str] = {
    "33203669": "gid://shopify/ProductVariant/50773867888932",
    "33801421": "gid://shopify/ProductVariant/50774177186084",
    "34012956": "gid://shopify/ProductVariant/50913560035620",
    "33487854": "gid://shopify/ProductVariant/50774175940900",
}


# ---------------------------------------------------------------------------
# Active state
#
# These module-level variables track the current store and delivery settings.
# They're updated via the setter functions below — don't modify them directly.
# ---------------------------------------------------------------------------

STORE: str = "US"                        # "US" or "PS"
active_client = us_client                # the GraphQL client for the active store
VARIANTS: dict[str, str] = US_VARIANTS  # SKU → GID map for the active store
VARIANT_IDS: list[str] = list(US_VARIANTS.values())  # pre-extracted GID list

# Preferred shipping rate title, e.g. "Express Shipping".
# Empty string means "use whatever rate Shopify returns first".
PREFERRED_SHIPPING_RATE: str = ""

# When set, orders use click-and-collect instead of shipping.
PREFERRED_PICKUP_LOCATION_ID: str | None = None
PREFERRED_PICKUP_LOCATION_NAME: str = ""  # display name shown in the settings header


# ---------------------------------------------------------------------------
# Store and delivery setters
# ---------------------------------------------------------------------------

def set_store(store: str):
    """
    Switches the active Shopify store and resets all delivery preferences.

    Args:
        store: "US" (Universal Store) or "PS" (Perfect Stranger).

    Why reset delivery preferences?
        Shipping rates and pickup locations are store-specific. If you switch
        from US to PS while a US Express rate is pinned, every PS order would
        fail because that rate doesn't exist in the PS store's rate list.
        Resetting forces the user to re-select a rate for the new store.
    """
    global STORE, active_client, VARIANTS, VARIANT_IDS
    global PREFERRED_SHIPPING_RATE, PREFERRED_PICKUP_LOCATION_ID, PREFERRED_PICKUP_LOCATION_NAME

    STORE         = store
    active_client = us_client if store == "US" else ps_client
    VARIANTS      = US_VARIANTS if store == "US" else PS_VARIANTS
    VARIANT_IDS   = list(VARIANTS.values())

    # Clear delivery preferences — they're only valid for the previous store.
    PREFERRED_SHIPPING_RATE        = ""
    PREFERRED_PICKUP_LOCATION_ID   = None
    PREFERRED_PICKUP_LOCATION_NAME = ""


def set_preferred_shipping_rate(rate_title: str):
    """
    Pins a shipping rate by its display title for all subsequent orders.

    Pass an empty string to revert to auto-selecting the first available rate.
    Setting a shipping rate also clears any active pickup location, since the
    two delivery methods are mutually exclusive.
    """
    global PREFERRED_SHIPPING_RATE, PREFERRED_PICKUP_LOCATION_ID, PREFERRED_PICKUP_LOCATION_NAME
    PREFERRED_SHIPPING_RATE        = rate_title
    PREFERRED_PICKUP_LOCATION_ID   = None  # can't have both shipping and pickup active
    PREFERRED_PICKUP_LOCATION_NAME = ""


def set_preferred_pickup_location(location_id: str, location_name: str):
    """
    Switches to click-and-collect (local pickup) at a specific location.

    Clears any pinned shipping rate at the same time. Pass the Shopify
    location GID and its display name (the name is used in the settings header).
    """
    global PREFERRED_SHIPPING_RATE, PREFERRED_PICKUP_LOCATION_ID, PREFERRED_PICKUP_LOCATION_NAME
    PREFERRED_PICKUP_LOCATION_ID   = location_id
    PREFERRED_PICKUP_LOCATION_NAME = location_name
    PREFERRED_SHIPPING_RATE        = ""  # can't have both pickup and shipping active


# ---------------------------------------------------------------------------
# Locations and shipping rate helpers
# ---------------------------------------------------------------------------

def get_pickup_locations() -> list[dict]:
    """
    Returns all fulfilment locations for the active store (up to 20).

    Each location dict has "id" (GID) and "name". Used by the settings menu
    to let the user choose a click-and-collect location.
    """
    result = active_client.execute(query=get_locations())
    edges  = result.get("data", {}).get("locations", {}).get("edges", [])
    return [edge["node"] for edge in edges]


def get_available_shipping_rates(
    customer_id: str,
    customer_email: str,
    first_name: str,
    last_name: str,
) -> list[dict]:
    """
    Returns all shipping rates available for a sample single-item order.

    Uses the first variant in VARIANT_IDS as a representative product.
    The rates returned are specific to the active store and the mock
    shipping address — they may differ from production rates.

    Used by the settings menu to show available rates before the user pins one.
    """
    # A single item is enough for Shopify to calculate available rates.
    return _calculate_shipping_rates(
        customer_id, customer_email, first_name, last_name,
        line_items=[{"variantId": VARIANT_IDS[0], "quantity": 1}],
    )


def _calculate_shipping_rates(
    customer_id: str,
    customer_email: str,
    first_name: str,
    last_name: str,
    line_items: list[dict],
) -> list[dict]:
    """
    Calls draftOrderCalculate and returns the availableShippingRates list.

    This is the internal helper shared by get_available_shipping_rates() (for
    the settings UI) and fetch_shipping_rates() (during order placement).
    It does NOT create or save any order — the calculate mutation is read-only.

    Raises Exception on API errors or if no data is returned.
    """
    order_info = {
        "customerId":      customer_id,
        "email":           customer_email,
        "shippingAddress": get_mock_address(first_name, last_name),
        "lineItems":       line_items,
    }
    result = active_client.execute(
        query=get_calculate_draft_order(),
        variables={"input": order_info},
    )
    calculate = result.get("data", {}).get("draftOrderCalculate", {})
    errors     = calculate.get("userErrors") or result.get("errors")
    if errors:
        raise Exception(f"draftOrderCalculate failed: {errors}")
    calculated = calculate.get("calculatedDraftOrder")
    if not calculated:
        raise Exception(f"draftOrderCalculate returned no data: {result}")
    return calculated["availableShippingRates"]


def fetch_shipping_rates(
    customer_id: str,
    customer_email: str,
    first_name: str,
    last_name: str,
    line_items: list[dict],
) -> str:
    """
    Returns the handle string for the preferred (or first available) shipping rate.

    A "handle" is an opaque Shopify identifier for a specific rate — it's what
    draftOrderCreate needs in the shippingLine field.

    If PREFERRED_SHIPPING_RATE is set, it must match a rate in the list exactly
    (case-sensitive) — raises if not found. Otherwise returns the first rate.
    """
    rates = _calculate_shipping_rates(
        customer_id, customer_email, first_name, last_name, line_items
    )
    if not rates:
        raise Exception("No shipping rates available for this order")

    if PREFERRED_SHIPPING_RATE:
        # Find the rate whose title matches the user's saved preference.
        match = next((r for r in rates if r["title"] == PREFERRED_SHIPPING_RATE), None)
        if not match:
            available = [r["title"] for r in rates]
            raise Exception(
                f"Preferred rate '{PREFERRED_SHIPPING_RATE}' not found. "
                f"Available: {available}"
            )
        return match["handle"]

    # No preference set — just take whatever Shopify returns first.
    return rates[0]["handle"]


# ---------------------------------------------------------------------------
# Customer helpers
# ---------------------------------------------------------------------------

def customer_exists(email: str) -> bool:
    """
    Returns True if a Shopify customer with the given email already exists.

    Used by the stress test to skip email addresses that already have accounts,
    preventing "email has already been taken" errors from Shopify.
    """
    result = active_client.execute(
        query=get_customer_by_email(),
        variables={"query": f"email:{email}"},
    )
    edges = result["data"]["customers"]["edges"]
    return len(edges) > 0  # non-empty means the customer was found


def create_customer(
    email: str,
    phone_number: str,
    first_name: str,
    last_name: str,
) -> str:
    """
    Creates a new Shopify customer and returns their GID.

    The GID (e.g. "gid://shopify/Customer/123") is used as the customer
    identifier in all subsequent draft order calls.

    Args:
        email:        Customer email (must be unique in the store).
        phone_number: E.164 format (e.g. "+61497100001"). Must be unique.
        first_name:   Customer first name.
        last_name:    Customer last name.

    Raises:
        Exception: If Shopify returns userErrors (duplicate email, duplicate phone, etc.)
    """
    customer = {
        "email":      email,
        "phone":      phone_number,
        "firstName":  first_name,
        "lastName":   last_name,
        "addresses":  [get_mock_address(first_name, last_name)],
    }
    result = active_client.execute(
        query=get_create_customer(),
        variables={"input": customer},
    )
    errors = result["data"]["customerCreate"]["userErrors"]
    if errors:
        raise Exception(f"customerCreate failed: {errors}")
    return result["data"]["customerCreate"]["customer"]["id"]


# ---------------------------------------------------------------------------
# Order placement
# ---------------------------------------------------------------------------

def create_draft_order(
    customer_id: str,
    customer_email: str,
    line_items: list[dict],
    first_name: str,
    last_name: str,
) -> str:
    """
    Creates a Shopify draft order and returns its GID.

    Selects shipping or local pickup based on the active delivery preference:
      - If PREFERRED_PICKUP_LOCATION_ID is set → local pickup (click & collect)
      - Otherwise → fetches and applies a shipping rate

    The draft is not yet finalised — call complete_draft_order() next.

    Args:
        customer_id:    Shopify customer GID (from create_customer or US_CUSTOMERS).
        customer_email: Email attached to the order record in Shopify.
        line_items:     List of {"variantId": GID, "quantity": int} dicts.
        first_name:     Used to build the billing/shipping address.
        last_name:      Used to build the billing/shipping address.

    Returns:
        Draft order GID — pass this to complete_draft_order().
    """
    # Fields common to both shipping and pickup orders.
    base = {
        "customerId":     customer_id,
        "note":           "Jared order for QA",
        "email":          customer_email,
        "taxExempt":      False,
        "tags":           ["foo", "bar"],
        "billingAddress": get_mock_address(first_name, last_name),
        "lineItems":      line_items,
    }

    if PREFERRED_PICKUP_LOCATION_ID:
        # Local pickup: customer collects from a store location.
        # No shippingAddress or shippingLine needed for pickup orders.
        order_info = {
            **base,
            "deliveryMethod": {
                "methodType": "LOCAL",
                "locationId": PREFERRED_PICKUP_LOCATION_ID,
            },
        }
    else:
        # Standard shipping: fetch a rate handle and attach it to the order.
        shipping_handle = fetch_shipping_rates(
            customer_id, customer_email, first_name, last_name, line_items
        )
        order_info = {
            **base,
            "shippingLine":    {"shippingRateHandle": shipping_handle},
            "shippingAddress": get_mock_address(first_name, last_name),
        }

    result = active_client.execute(
        query=get_create_draft_order(),
        variables={"input": order_info},
    )
    errors = result["data"]["draftOrderCreate"]["userErrors"]
    if errors:
        raise Exception(f"draftOrderCreate failed: {errors}")
    return result["data"]["draftOrderCreate"]["draftOrder"]["id"]


def complete_draft_order(draft_order_id: str) -> dict:
    """
    Completes (finalises) a draft order, converting it into a real Shopify order.

    This is the last step in the order placement flow. After this call the
    order appears in the Shopify admin and triggers any configured webhooks.

    Returns:
        Dict with the created order's identifiers:
            {
                "order_id":   "gid://shopify/Order/123..."  (GID),
                "order_name": "#1234"                        (display name),
                "created_at": "2026-07-17T...Z",
            }
        The CLI ignores this return value; the regression package relies on it
        to read the order back and correlate it across Shopify / AWS / NewStore.

    Raises Exception if Shopify returns userErrors (e.g. inventory issues) or
    if the completed draft does not contain an order (payment not processed).
    """
    result = active_client.execute(
        query=get_complete_draft_order(),
        variables={"id": draft_order_id},
    )
    errors = result["data"]["draftOrderComplete"]["userErrors"]
    if errors:
        raise Exception(f"draftOrderComplete failed: {errors}")

    draft = result["data"]["draftOrderComplete"]["draftOrder"] or {}
    order = draft.get("order") or {}
    if not order.get("id"):
        raise Exception(
            f"draftOrderComplete returned no order for draft {draft_order_id}: {result}"
        )
    return {
        "order_id":   order["id"],
        "order_name": order.get("name", ""),
        "created_at": draft.get("createdAt", ""),
    }


# ---------------------------------------------------------------------------
# Price lookup (used by newstore_orders)
# ---------------------------------------------------------------------------

def get_shopify_prices(skus: list[str]) -> dict[str, float]:
    """
    Returns the current Shopify price for each SKU as {sku: float}.

    Uses the nodes batch query to fetch all variant prices in a single API
    call rather than one request per SKU. Only SKUs that exist in the active
    store's VARIANTS map can be looked up — others are silently omitted.

    Why not just hardcode prices?
        Real prices are fetched so the NewStore order total matches the actual
        RRP. This avoids mismatches between the injected order and what the
        customer would see at checkout.

    Returns:
        Dict of {sku: price_as_float}. SKUs not in VARIANTS are excluded —
        callers should fall back to a default price for those.
    """
    # Filter to only the SKUs we have GIDs for in the current store.
    known = {sku: VARIANTS[sku] for sku in skus if sku in VARIANTS}
    if not known:
        return {}  # nothing to look up — caller will use fallback prices

    result = active_client.execute(
        query=get_variant_prices(),
        variables={"ids": list(known.values())},
    )
    # `nodes` returns items in the same order as the input IDs, but may include
    # null entries for IDs that don't exist — filter those out.
    nodes = result.get("data", {}).get("nodes") or []

    prices: dict[str, float] = {}
    for node in nodes:
        if not node:
            continue  # null node = variant GID not found in Shopify
        variant_gid = node["id"]
        price       = float(node["price"])
        # Reverse-lookup: find the SKU that corresponds to this GID.
        sku = next((s for s, v in known.items() if v == variant_gid), None)
        if sku:
            prices[sku] = price
    return prices


# ---------------------------------------------------------------------------
# Mock data generators
# ---------------------------------------------------------------------------

def get_mock_address(first_name: str, last_name: str) -> dict:
    """
    Returns a fixed QA delivery/billing address in Brisbane.

    All test orders ship to this address regardless of which customer is used.
    The Shopify API requires firstName and lastName inside the address object,
    which is why this is a function rather than a module-level constant.

    Update the address values here if you need a different test destination
    (e.g. for testing specific shipping zone rates).
    """
    return {
        "firstName":    first_name,
        "lastName":     last_name,
        "address1":     "42 William Farrior Place",
        "address2":     None,
        "city":         "Eagle Farm",
        "zip":          "4009",
        "province":     "Queensland",
        "provinceCode": "QLD",
        "country":      "Australia",
        "countryCode":  "AU",
        "phone":        "0414 697 063",
        "company":      None,
    }


def get_first_name() -> str:
    """Returns a random first name for stress-test customer creation."""
    return random.choice(["Ryland", "Blake", "Anne", "Carol", "Geoff"])


def get_last_name() -> str:
    """Returns a random last name for stress-test customer creation."""
    return random.choice(["Grace", "Jones", "Smith", "Williams", "Brown"])
