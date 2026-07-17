"""
QA Order Tool — interactive CLI for placing test orders on staging.

Supports two platforms:
  - Shopify:   Places draft orders via the Admin GraphQL API.
  - NewStore:  Injects Ship From Store (SFS) or Over the Counter (OTC) orders
               via the NewStore Order Injection API.

Before every order, the tool automatically checks DynamoDB inventory and tops
up stock for the ordered SKUs so the order won't be blocked downstream.
Alternatively, use split shipment mode to spread qty=1 across four ATP locations
for NewStore split-shipment routing tests.

Setup — environment variables required before running:
    US_ACCESS_TOKEN          Shopify Admin API token for Universal Store staging
    PS_ACCESS_TOKEN          Shopify Admin API token for Perfect Stranger staging
    NS_STAGING_CLIENT_ID     NewStore OAuth2 client ID
    NS_STAGING_CLIENT_SECRET NewStore OAuth2 client secret

AWS credentials are loaded from the "staging" named profile in ~/.aws.
Run `aws sso login --profile staging` if your credentials have expired.

Usage:
    python main.py
"""

import os
import random
import orders_processor
import newstore_orders
import aws_inventory
import receipt_service


# ---------------------------------------------------------------------------
# Shopify customer pools
#
# Each entry is a customer that already exists in the corresponding staging
# store. Their ID (GID) is used in every draft order call.
#
# To add more customers: uncomment an existing entry or add a new dict.
# Customer IDs can be found in the Shopify admin under Customers.
# ---------------------------------------------------------------------------

US_CUSTOMERS = [
    {"id": "gid://shopify/Customer/8997370954001", "email": "jared.davis@universalstore.com.au", "first_name": "Jared", "last_name": "Davis"},
    # {"id": "gid://shopify/Customer/10208491897105", "email": "jared.davis+75@universalstore.com.au", "first_name": "Ryland", "last_name": "Grace"},
    # {"id": "gid://shopify/Customer/10208491995409", "email": "jared.davis+76@universalstore.com.au", "first_name": "Carol", "last_name": "Jones"},
    # {"id": "gid://shopify/Customer/10208492126481", "email": "jared.davis+77@universalstore.com.au", "first_name": "Blake", "last_name": "Brown"},
    # {"id": "gid://shopify/Customer/10208492192017", "email": "jared.davis+78@universalstore.com.au", "first_name": "Geoff", "last_name": "Grace"},
    # {"id": "gid://shopify/Customer/10208492290321", "email": "jared.davis+79@universalstore.com.au", "first_name": "Anne", "last_name": "Jones"},
    # {"id": "gid://shopify/Customer/10208492519697", "email": "jared.davis+80@universalstore.com.au", "first_name": "Carol", "last_name": "Grace"},
    # {"id": "gid://shopify/Customer/10208492618001", "email": "jared.davis+81@universalstore.com.au", "first_name": "Carol", "last_name": "Jones"},
    # {"id": "gid://shopify/Customer/10208492814609", "email": "jared.davis+82@universalstore.com.au", "first_name": "Anne", "last_name": "Jones"},
    # {"id": "gid://shopify/Customer/10208493076753", "email": "jared.davis+83@universalstore.com.au", "first_name": "Blake", "last_name": "Smith"},
    # {"id": "gid://shopify/Customer/10208493207825", "email": "jared.davis+834@universalstore.com.au", "first_name": "Blake", "last_name": "Grace"},
]

PS_CUSTOMERS = [
    {"id": "gid://shopify/Customer/22959422669092", "email": "jared.davis@universalstore.com.au", "first_name": "Jared", "last_name": "Davis"},
]

# The active customer list — replaced by switch_store() when the store changes.
CUSTOMERS = US_CUSTOMERS if orders_processor.STORE == "US" else PS_CUSTOMERS


# ---------------------------------------------------------------------------
# Order run defaults
# All of these can be changed at runtime from the Settings menu (option S).
# ---------------------------------------------------------------------------

NUM_ORDERS_PER_CUSTOMER = 10    # orders placed per customer in a standard run
NUM_OF_CUSTOMERS        = 1     # new customers to create during stress testing
min_line_items          = 1     # minimum number of line items per random order
max_line_items          = 3     # maximum number of line items per random order
SAVE_RECEIPTS_LOCALLY   = False # when True, also saves receipt PDF to receipts/


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------

def clr():
    """Clears the terminal screen. Works on both Windows (cls) and Mac/Linux (clear)."""
    os.system("cls" if os.name == "nt" else "clear")


def ask(label: str, default=None) -> str:
    """
    Prompts the user for input, returning a default if they press Enter.

    The default value is shown in square brackets so the user knows what
    they'll get without typing anything:  "  Label [default]: "
    """
    suffix = f" [{default}]" if default is not None else ""
    val    = input(f"  {label}{suffix}: ").strip()
    return val if val else (str(default) if default is not None else "")


def pause():
    """Blocks until the user presses Enter — used after a run completes."""
    input("\n  Done — press Enter to return to menu...")


def _sku_for(variant_id: str) -> str:
    """
    Converts a Shopify variant GID back to its human-readable SKU string.

    Example: "gid://shopify/ProductVariant/51753513943313" → "31616669"

    Falls back to the numeric tail of the GID if the variant isn't found in
    the active VARIANTS map (can happen briefly after switching stores before
    presets are rebuilt).
    """
    for sku, vid in orders_processor.VARIANTS.items():
        if vid == variant_id:
            return sku
    return variant_id.split("/")[-1]  # e.g. "51753513943313" as a last resort


def _shipping_category(title: str) -> str:
    """
    Classifies a shipping rate title into a short display category label.

    Used in the delivery method picker to group rates visually so they're
    easier to scan. The keyword matching is intentionally broad.
    """
    t = title.lower()
    if any(k in t for k in ("express", "overnight", "same day", "same-day")):
        return "EXPRESS"
    if any(k in t for k in ("click", "collect", "pickup", "pick up", "in-store", "instore")):
        return "CLICK & COLLECT"
    if any(k in t for k in ("standard", "regular", "economy")):
        return "STANDARD"
    return "OTHER"


# ---------------------------------------------------------------------------
# Shared preset selection helper
# ---------------------------------------------------------------------------

def _pick_by_number_or_name(options: dict, prompt: str = "Selection") -> str:
    """
    Prompts the user to choose a key from a dict, either by number or by name.

    Given a dict like {"single": [...], "multi": [...], "unique": [...]},
    the user can type "1" (first entry), "2" (second), "multi" (by name), etc.

    Used by both pick_preset() and pick_ns_preset() to avoid duplicating this
    selection logic. Returns the selected key string.

    Raises ValueError if the input doesn't match any number or key.
    """
    keys   = list(options.keys())
    choice = ask(prompt).strip()
    # Check if the user typed a valid 1-based index number.
    if choice.isdigit() and 1 <= int(choice) <= len(keys):
        return keys[int(choice) - 1]
    # Check if the user typed the key name directly (e.g. "multi").
    if choice in options:
        return choice
    raise ValueError(f"Unknown selection: '{choice}'")


# ---------------------------------------------------------------------------
# Shopify — line item builders
# ---------------------------------------------------------------------------

def _build_presets() -> dict:
    """
    Builds the three standard Shopify order presets from the active variant map.

    Called at startup and whenever the store is switched, so presets always
    use the correct variant GIDs for the current store.

    Presets:
      single — one unit of the first variant (quick single-item order)
      multi  — three units of the last variant (tests multi-quantity handling)
      unique — one unit each of the first three variants (tests multi-line orders)
    """
    v = list(orders_processor.VARIANTS.values())
    return {
        "single": [{"variantId": v[0], "quantity": 1}],
        "multi":  [{"variantId": v[-1], "quantity": 3}],
        "unique": [{"variantId": x, "quantity": 1} for x in v[:3]],
    }

# Built at startup; rebuilt by switch_store() when the active store changes.
ORDER_PRESETS = _build_presets()


def build_random_line_items() -> list[dict]:
    """
    Generates a random list of line items within the configured min/max range.

    Picks a random count between min_line_items and max_line_items, then
    randomly selects variants for each slot. The same variant can appear
    more than once (sampling with replacement).
    """
    count = random.randint(min_line_items, max_line_items)
    return [{"variantId": random.choice(orders_processor.VARIANT_IDS), "quantity": 1} for _ in range(count)]


def build_specific_line_items() -> list[dict]:
    """
    Prompts the user to type specific SKUs and returns them as Shopify line items.

    Each SKU must exist in the active store's VARIANTS map. Raises ValueError
    if any entered SKU is unknown (prevents silent failures downstream).
    """
    # Print the available SKUs so the user knows what to type.
    for i, sku in enumerate(orders_processor.VARIANTS.keys(), 1):
        print(f"    {i}.  {sku}")
    chosen   = input("\n  SKUs (comma-separated): ").strip()
    selected = [s.strip() for s in chosen.split(",")]
    invalid  = [s for s in selected if s not in orders_processor.VARIANTS]
    if invalid:
        raise ValueError(f"Unknown SKUs: {invalid}")
    return [{"variantId": orders_processor.VARIANTS[sku], "quantity": 1} for sku in selected]


def _skus_from_line_items(line_items: list[dict]) -> list[str]:
    """
    Extracts the SKU string for each line item.

    Used to get the SKU list for inventory checks before placing an order,
    since aws_inventory works with SKUs while Shopify uses variant GIDs.
    """
    return [_sku_for(item["variantId"]) for item in line_items]


# ---------------------------------------------------------------------------
# Shopify — order placement
# ---------------------------------------------------------------------------

def place_an_order(
    customer_id: str,
    customer_email: str,
    first_name: str,
    last_name: str,
    line_items: list[dict] | None = None,
    split: bool = False,
):
    """
    Places a single Shopify draft order for a given customer.

    Full sequence:
      1. Build line items (random if not provided)
      2. Update DynamoDB inventory (ensure_stock or split_stock)
      3. Create a draft order in Shopify (draftOrderCreate)
      4. Complete the draft, turning it into a real order (draftOrderComplete)

    Args:
        customer_id:    Shopify customer GID (from the CUSTOMERS pool).
        customer_email: Customer email address.
        first_name:     Used for billing/shipping address name fields.
        last_name:      Used for billing/shipping address name fields.
        line_items:     Specific items to order. If None, random items are used.
        split:          If True, spreads qty=1 across all four ATP split
                        locations instead of topping up one location.
    """
    if line_items is None:
        line_items = build_random_line_items()

    # Print a compact summary of what's being ordered before making API calls.
    detail = "  ".join(
        f"{_sku_for(item['variantId'])} x{item['quantity']}" for item in line_items
    )
    print(f"      -> {detail}")

    skus = _skus_from_line_items(line_items)
    if split:
        aws_inventory.split_stock(skus)   # qty=1 at each of four ATP locations
    else:
        aws_inventory.ensure_stock(skus)  # top up to 99 at the default ATP location

    # Create and immediately complete the draft order.
    draft_order_id = orders_processor.create_draft_order(
        customer_id, customer_email, line_items, first_name, last_name
    )
    orders_processor.complete_draft_order(draft_order_id)


def place_orders_for_existing_customers(
    line_items: list[dict] | None = None,
    orders_count: int | None = None,
    split: bool = False,
):
    """
    Places multiple orders for every customer in the active CUSTOMERS list.

    Iterates over each customer and places orders_count orders for them.
    If line_items is None, each individual order gets its own random set.

    Args:
        line_items:   Fixed items for all orders. None = random per order.
        orders_count: Orders per customer. Defaults to NUM_ORDERS_PER_CUSTOMER.
        split:        Passed through to place_an_order for inventory handling.
    """
    if orders_count is None:
        orders_count = NUM_ORDERS_PER_CUSTOMER

    for customer in CUSTOMERS:
        print(f"\n  {customer['first_name']} {customer['last_name']}  <{customer['email']}>")
        for j in range(1, orders_count + 1):
            print(f"    Order {j}/{orders_count}")
            place_an_order(
                customer["id"],
                customer["email"],
                customer["first_name"],
                customer["last_name"],
                line_items,
                split=split,
            )


def perform_stress_testing():
    """
    Creates new Shopify customers and places NUM_ORDERS_PER_CUSTOMER orders each.

    Email scheme:
        Iterates through jared.davis+1@, jared.davis+2@, etc., skipping any
        that already have a Shopify account. This lets the test be re-run without
        manually cleaning up previously created customers.

    Phone scheme:
        Generates a unique Australian mobile number per customer by zero-padding
        the counter (e.g. n=1 → "+61497100001", n=99 → "+61497100099").
        Uses E.164 format as required by Shopify. If a phone is already taken
        (rare collision), that counter is skipped and we try the next one.
    """
    customers_created = 0
    n = 1  # counter used for both the email suffix and phone number

    while customers_created < NUM_OF_CUSTOMERS:
        customer_email = f"jared.davis+{n}@universalstore.com.au"

        # Skip this email if the customer already has an account.
        if orders_processor.customer_exists(customer_email):
            n += 1
            continue

        # Zero-pad n to 5 digits to keep phone numbers a consistent length.
        # e.g. n=1 → "+61497100001" (11 digits total, valid Australian mobile format)
        phone_number = f"+614971{n:05d}"
        first_name   = orders_processor.get_first_name()
        last_name    = orders_processor.get_last_name()

        print(f"\n  [{customers_created + 1}/{NUM_OF_CUSTOMERS}]  {first_name} {last_name}  <{customer_email}>")
        try:
            customer_id = orders_processor.create_customer(
                customer_email, phone_number, first_name, last_name
            )
        except Exception as e:
            if "Phone has already been taken" in str(e):
                # Phone collision — skip and increment to get a different number.
                print(f"    -> {phone_number} taken, skipping")
                n += 1
                continue
            raise  # unexpected error — propagate to the caller

        customers_created += 1
        for j in range(1, NUM_ORDERS_PER_CUSTOMER + 1):
            print(f"    Order {j}/{NUM_ORDERS_PER_CUSTOMER}")
            place_an_order(customer_id, customer_email, first_name, last_name)
        n += 1


# ---------------------------------------------------------------------------
# NewStore — presets and SKU selection
# ---------------------------------------------------------------------------

# Populated at startup (by the _build_ns_presets() call below) and refreshed
# whenever switch_store() is called. Sourced from orders_processor.VARIANTS so
# they always contain valid SKUs for the active store.
NS_ORDER_PRESETS: dict[str, list[str]] = {}


def _build_ns_presets():
    """
    Builds the three standard NewStore order presets from the active SKU list.

    Must be called after any store switch since the available SKUs differ
    between US and PS. Called automatically by switch_store().

    Presets:
      single — one unit of the first SKU
      multi  — three units of the last SKU (tests multi-quantity)
      unique — one each of the first three SKUs (tests multi-line orders)
    """
    global NS_ORDER_PRESETS
    skus = list(orders_processor.VARIANTS.keys())
    NS_ORDER_PRESETS = {
        "single": [skus[0]],
        "multi":  [skus[-1]] * 3,  # same SKU three times
        "unique": skus[:3],         # three different SKUs
    }

# Build presets immediately at import time.
_build_ns_presets()


def build_ns_random_skus() -> list[str]:
    """
    Returns a random list of SKUs within the min/max line item range.

    Sampling is done with replacement so the same SKU can appear multiple times,
    which is valid for NewStore (unlike Shopify which merges duplicate line items).
    """
    count = random.randint(min_line_items, max_line_items)
    return [random.choice(list(orders_processor.VARIANTS.keys())) for _ in range(count)]


def pick_preset() -> list[dict]:
    """
    Displays the Shopify preset menu and returns the chosen line items.

    Presets are shown with their SKU details so the user knows exactly what
    they're selecting before confirming.
    """
    keys = list(ORDER_PRESETS.keys())
    print("\n  Presets:")
    for i, key in enumerate(keys, 1):
        # Format each preset as "SKU x qty  SKU x qty  ..."
        detail = "  ".join(
            f"{_sku_for(item['variantId'])} x{item['quantity']}"
            for item in ORDER_PRESETS[key]
        )
        print(f"    {i}  {key:<10} {detail}")
    # _pick_by_number_or_name handles "1"/"2"/"single"/"multi" etc.
    key = _pick_by_number_or_name(ORDER_PRESETS, "Preset")
    return ORDER_PRESETS[key]


def pick_ns_preset() -> list[str]:
    """
    Displays the NewStore preset menu and returns the chosen list of SKUs.

    Same selection UX as pick_preset() but returns raw SKU strings instead
    of Shopify line item dicts (NewStore uses SKUs directly).
    """
    keys = list(NS_ORDER_PRESETS.keys())
    print("\n  Presets:")
    for i, key in enumerate(keys, 1):
        detail = "  ".join(NS_ORDER_PRESETS[key])  # just the SKU strings
        print(f"    {i}  {key:<10} {detail}")
    key = _pick_by_number_or_name(NS_ORDER_PRESETS, "Preset")
    return list(NS_ORDER_PRESETS[key])  # return a copy so callers can't mutate the preset


def pick_ns_skus() -> list[str]:
    """
    Prompts the user to manually type one or more SKUs for a NewStore order.

    Unknown SKUs (not in the Shopify VARIANTS map) are allowed because NewStore
    may carry products that aren't listed in the Shopify staging config. A note
    is printed when this happens so it's visible in the output.
    """
    print("\n  Available SKUs (from Shopify config):")
    for i, sku in enumerate(orders_processor.VARIANTS.keys(), 1):
        print(f"    {i}.  {sku}")
    chosen   = input("\n  SKUs (comma-separated): ").strip()
    selected = [s.strip() for s in chosen.split(",")]
    invalid  = [s for s in selected if s not in orders_processor.VARIANTS]
    if invalid:
        # Don't block — just warn. The SKU might be valid in NewStore even if
        # it's not in our Shopify variant map (e.g. NewStore-exclusive products).
        print(f"  Note: {invalid} not found in Shopify VARIANTS — proceeding anyway.")
    return selected


def pick_ns_sku_method() -> list[str]:
    """
    Submenu for choosing how SKUs are selected for a NewStore order.

    Options:
      1 — Random:  picks random SKUs within the min/max line item range
      2 — Preset:  choose from pre-built single / multi / unique sets
      3 — By SKU:  type in specific SKU codes manually
    """
    print("\n  SKU selection:")
    print("  1  Random")
    print("  2  Preset  (single / multi / unique)")
    print("  3  By SKU")
    choice = input("  > ").strip()
    if choice == "1":
        skus = build_ns_random_skus()
        print(f"  -> {', '.join(skus)}")
        return skus
    elif choice == "2":
        return pick_ns_preset()
    else:
        # Default to manual entry for anything other than 1 or 2.
        return pick_ns_skus()


def ask_split_shipment() -> bool:
    """
    Asks the user to choose between standard and split inventory mode.

    Standard mode:
        Tops up stock to 99 at a single ATP location (ATP#100 by default).
        Use this for most test orders — sufficient stock at one location.

    Split mode:
        Sets qty=1 at ATP#100, ATP#99, ATP#407, and ATP#640.
        Use this when testing NewStore Ship From Store split-shipment routing.
        With only 1 unit at each location, NewStore is forced to route each
        item to a different fulfilment node, producing a split shipment.

    Returns True if the user chose split mode, False for standard.
    """
    print("\n  Inventory mode:")
    print("  [N] Standard — top up stock to 99 at one ATP location")
    print("  [Y] Split    — set qty=1 at each of four ATP locations (split shipment test)")
    return input("\n  Split shipment? [y/N]: ").strip().lower() == "y"


# ---------------------------------------------------------------------------
# NewStore — shared order placement flow
# ---------------------------------------------------------------------------

def place_ns_orders(order_fn, label: str, order_type: str = "SFS"):
    """
    Shared order placement flow used by both SFS and OTC menu options.

    Walks the user through:
      1. SKU selection (random / preset / manual)
      2. Inventory mode (standard top-up or split shipment)
      3. How many orders to place
      4. Places each order, printing the result or error for each one

    Errors on individual orders are caught and printed rather than aborting
    the entire run — useful when placing multiple orders in one go.

    Args:
        order_fn: The order creation function to call for each order.
                  Either newstore_orders.create_sfs_order or create_otc_order.
        label:    Display name for the header (e.g. "Ship From Store").
    """
    clr()
    print(f"  NewStore — {label}\n")
    ns_header()

    skus  = pick_ns_sku_method()
    split = ask_split_shipment()
    count = int(ask("Number of orders", 1))
    print()

    for i in range(1, count + 1):
        print(f"  Order {i}/{count}")
        if split:
            aws_inventory.split_stock(skus)   # qty=1 at each of four locations
        else:
            aws_inventory.ensure_stock(skus)  # top up at the default location
        try:
            result      = order_fn(skus)
            external_id = result.get("external_id", "?")
            order_uuid  = result.get("id", "")   # internal UUID for notes API
            print(f"    -> {external_id}")
        except Exception as e:
            # First failure cancels the entire run — no point continuing if
            # the payload is broken.
            print(f"    -> Error: {e}")
            print("\n  Run cancelled after first failure.")
            break

        # Generate receipt and attach as an order note. Non-fatal.
        if order_uuid:
            prices = newstore_orders._lookup_prices(skus)
            total  = newstore_orders._calculate_total(
                skus, prices, include_shipping=(order_type == "SFS")
            )
            receipt_service.generate_and_attach_receipt(
                order_uuid=order_uuid,
                external_id=external_id,
                skus=skus,
                prices=prices,
                total=total,
                associate_id=newstore_orders.ACTIVE_ASSOCIATE_ID,
                associate_name=newstore_orders.ACTIVE_ASSOCIATE_NAME,
                order_type=order_type,
                save_locally=SAVE_RECEIPTS_LOCALLY,
            )

    pause()


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def switch_store(store: str):
    """
    Switches the active Shopify store and rebuilds all store-dependent state.

    Calling set_store() in orders_processor also resets shipping preferences,
    so we only need to rebuild the preset maps and customer list here.

    Args:
        store: "US" or "PS".
    """
    global ORDER_PRESETS, CUSTOMERS
    orders_processor.set_store(store)   # updates active client + resets delivery prefs
    ORDER_PRESETS = _build_presets()    # rebuild Shopify presets with new store's variants
    _build_ns_presets()                 # rebuild NewStore presets with new store's SKUs
    CUSTOMERS = US_CUSTOMERS if store == "US" else PS_CUSTOMERS


def pick_shipping_rate():
    """
    Fetches shipping rates and pickup locations for the active store and lets
    the user pin one for all subsequent Shopify orders.

    Uses the first customer in the CUSTOMERS pool to calculate rates (Shopify
    needs a customer context to determine applicable rates).

    Option 0 resets to auto-selecting the first available rate.
    """
    customer = CUSTOMERS[0]
    print("\n  Fetching shipping rates and pickup locations...")
    try:
        rates     = orders_processor.get_available_shipping_rates(
            customer["id"], customer["email"], customer["first_name"], customer["last_name"]
        )
        locations = orders_processor.get_pickup_locations()
    except Exception as e:
        print(f"\n  Error: {e}")
        pause()
        return

    print("\n  Available options:\n")
    print("    0  First available shipping rate (auto)")
    for i, rate in enumerate(rates, 1):
        category = _shipping_category(rate["title"])
        price    = f"{rate['price']['amount']} {rate['price']['currencyCode']}"
        print(f"    {i}  [{category:<15}]  {rate['title']}  ({price})")
    # Pickup locations are numbered after the shipping rates.
    offset = len(rates)
    for j, loc in enumerate(locations, 1):
        print(f"    {offset + j}  [PICKUP          ]  {loc['name']}")
    total  = offset + len(locations)
    choice = ask("\n  Select option", 0).strip()

    if choice == "0" or choice == "":
        orders_processor.set_preferred_shipping_rate("")
        print("\n  -> Using first available shipping rate")
    elif choice.isdigit() and 1 <= int(choice) <= len(rates):
        # User selected a shipping rate.
        selected = rates[int(choice) - 1]
        orders_processor.set_preferred_shipping_rate(selected["title"])
        print(f"\n  -> Set to: {selected['title']}")
    elif choice.isdigit() and len(rates) < int(choice) <= total:
        # User selected a pickup location (numbered after the shipping rates).
        loc = locations[int(choice) - offset - 1]
        orders_processor.set_preferred_pickup_location(loc["id"], loc["name"])
        print(f"\n  -> Set to pickup: {loc['name']}")
    else:
        print("\n  Invalid choice, no change.")
    pause()


def settings_menu():
    """
    Settings menu — runtime configuration for both Shopify and NewStore.

    All changes take effect immediately and last for the session only.
    Restart the tool to reset everything back to the defaults defined at
    the top of this file.
    """
    global NUM_ORDERS_PER_CUSTOMER, NUM_OF_CUSTOMERS, min_line_items, max_line_items, SAVE_RECEIPTS_LOCALLY
    while True:
        clr()
        print("  Settings\n")

        # --- Shopify section ---
        other_store = "PS" if orders_processor.STORE == "US" else "US"
        if orders_processor.PREFERRED_PICKUP_LOCATION_ID:
            delivery_label = f"Pickup — {orders_processor.PREFERRED_PICKUP_LOCATION_NAME}"
        else:
            delivery_label = orders_processor.PREFERRED_SHIPPING_RATE or "first available"
        print("  Shopify")
        print(f"  1  Orders per customer      {NUM_ORDERS_PER_CUSTOMER}")
        print(f"  2  Random item range        {min_line_items} - {max_line_items}")
        print(f"  3  Stress test customers    {NUM_OF_CUSTOMERS}")
        print(f"  4  Switch store             {orders_processor.STORE} -> {other_store}")
        print(f"  5  Delivery method          {delivery_label}")
        print()

        # --- NewStore section ---
        other_ns_brand = "PS" if newstore_orders.BRAND == "US" else "US"
        print("  NewStore")
        print(f"  6  Switch brand             {newstore_orders.BRAND} -> {other_ns_brand}  (store: {newstore_orders._active_store_id()})")
        print(f"  7  Fallback item price       ${newstore_orders.NS_CONFIG['fallback_item_price']:.2f}  (used when Shopify price unavailable)")
        print(f"  8  Inventory store key       {aws_inventory.AWS_CONFIG['store_key']}")
        print(f"  9  Associate                 {newstore_orders.ACTIVE_ASSOCIATE_NAME}")
        print(f" 10  Save receipts locally      {'On' if SAVE_RECEIPTS_LOCALLY else 'Off'}")
        print()
        print("  0  Back\n")

        choice = input("  > ").strip()

        if choice == "1":
            NUM_ORDERS_PER_CUSTOMER = int(ask("Orders per customer", NUM_ORDERS_PER_CUSTOMER))
        elif choice == "2":
            min_line_items = int(ask("Min items", min_line_items))
            max_line_items = int(ask("Max items", max_line_items))
        elif choice == "3":
            NUM_OF_CUSTOMERS = int(ask("New customers", NUM_OF_CUSTOMERS))
        elif choice == "4":
            switch_store(other_store)
        elif choice == "5":
            clr()
            print("  Shipping Rate\n")
            pick_shipping_rate()
        elif choice == "6":
            # Toggle the NewStore brand between US and PS.
            newstore_orders.set_brand("PS" if newstore_orders.BRAND == "US" else "US")
        elif choice == "7":
            val = ask("Fallback item price", newstore_orders.NS_CONFIG["fallback_item_price"])
            newstore_orders.NS_CONFIG["fallback_item_price"] = float(val)
        elif choice == "8":
            # Changing the store key affects where ensure_stock looks for inventory.
            val = ask("Inventory store key", aws_inventory.AWS_CONFIG["store_key"])
            aws_inventory.AWS_CONFIG["store_key"] = val
        elif choice == "9":
            names = list(newstore_orders.NS_ASSOCIATES.keys())
            print("\n  Associates:")
            for i, name in enumerate(names, 1):
                marker = " <-- active" if name == newstore_orders.ACTIVE_ASSOCIATE_NAME else ""
                print(f"    {i}  {name}{marker}")
            val = ask("Select").strip()
            if val.isdigit() and 1 <= int(val) <= len(names):
                newstore_orders.set_associate(names[int(val) - 1])
            elif val in newstore_orders.NS_ASSOCIATES:
                newstore_orders.set_associate(val)
            else:
                print(f"  Unknown selection: '{val}'")
        elif choice == "10":
            SAVE_RECEIPTS_LOCALLY = not SAVE_RECEIPTS_LOCALLY
            print(f"  -> Save receipts locally: {'On' if SAVE_RECEIPTS_LOCALLY else 'Off'}")
        elif choice == "0":
            break


# ---------------------------------------------------------------------------
# Menu headers — status lines printed at the top of each submenu screen
# ---------------------------------------------------------------------------

def shopify_header():
    """Prints the active Shopify configuration as a compact status line."""
    if orders_processor.PREFERRED_PICKUP_LOCATION_ID:
        delivery_label = f"Pickup — {orders_processor.PREFERRED_PICKUP_LOCATION_NAME}"
    else:
        delivery_label = orders_processor.PREFERRED_SHIPPING_RATE or "first available"
    print(f"  Store: {orders_processor.STORE}   Customers: {len(CUSTOMERS)}   Orders/customer: {NUM_ORDERS_PER_CUSTOMER}")
    print(f"  Delivery: {delivery_label}")
    print(f"  {'─' * 44}")


def ns_header():
    """Prints the active NewStore configuration as a compact status line."""
    brand = newstore_orders.BRAND
    print(f"  Env: staging   Brand: {brand}   Store: {newstore_orders._active_store_id()}")
    print(f"  Shop: {newstore_orders._active_shop_id()}   Currency: {newstore_orders.NS_CONFIG['currency']}")
    print(f"  {'─' * 44}")


# ---------------------------------------------------------------------------
# Submenus
# ---------------------------------------------------------------------------

def shopify_menu():
    """
    Shopify orders submenu.

    Options 1–3 place orders for customers already in the CUSTOMERS pool.
    Option 4 (stress test) creates brand-new Shopify customers first.
    """
    while True:
        clr()
        print("  Shopify Orders\n")
        shopify_header()
        print()
        print("  1  Random orders      existing customers")
        print("  2  Preset orders      existing customers")
        print("  3  Orders by SKU      existing customers")
        print("  4  Stress test        create new customers")
        print()
        print("  0  Back")
        print()
        choice = input("  > ").strip().lower()

        if choice == "1":
            clr()
            print("  Random Orders\n")
            shopify_header()
            split = ask_split_shipment()
            place_orders_for_existing_customers(split=split)
            pause()

        elif choice == "2":
            clr()
            print("  Preset Orders\n")
            shopify_header()
            line_items = pick_preset()
            count = int(ask("Orders per customer", NUM_ORDERS_PER_CUSTOMER))
            split = ask_split_shipment()
            print()
            place_orders_for_existing_customers(line_items, count, split=split)
            pause()

        elif choice == "3":
            clr()
            print("  Orders by SKU\n")
            shopify_header()
            print("\n  Available SKUs:")
            line_items = build_specific_line_items()
            count = int(ask("Orders per customer", NUM_ORDERS_PER_CUSTOMER))
            split = ask_split_shipment()
            print()
            place_orders_for_existing_customers(line_items, count, split=split)
            pause()

        elif choice == "4":
            clr()
            print("  Stress Test\n")
            shopify_header()
            print(f"\n  Creating {NUM_OF_CUSTOMERS} customers, {NUM_ORDERS_PER_CUSTOMER} orders each...\n")
            perform_stress_testing()
            pause()

        elif choice == "0":
            break


def newstore_menu():
    """NewStore orders submenu — choose between SFS and OTC order types."""
    while True:
        clr()
        print("  NewStore Orders\n")
        ns_header()
        print()
        print("  1  Ship From Store")
        print("  2  Over the Counter")
        print()
        print("  0  Back")
        print()
        choice = input("  > ").strip().lower()

        if choice == "1":
            place_ns_orders(newstore_orders.create_sfs_order, "Ship From Store", order_type="SFS")
        elif choice == "2":
            place_ns_orders(newstore_orders.create_otc_order, "Over the Counter", order_type="OTC")
        elif choice == "0":
            break


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    """Top-level loop — choose between Shopify, NewStore, Settings, or Quit."""
    while True:
        clr()
        print("  QA Order Tool\n")
        # Show the active store/brand so the user always knows the current context.
        print(f"  Shopify: {orders_processor.STORE}   NewStore: {newstore_orders.BRAND} (staging)")
        print(f"  {'─' * 44}")
        print()
        print("  1  Shopify orders")
        print("  2  NewStore orders")
        print()
        print("  s  Settings")
        print("  q  Quit")
        print()
        choice = input("  > ").strip().lower()

        if choice == "1":
            shopify_menu()
        elif choice == "2":
            newstore_menu()
        elif choice == "s":
            settings_menu()
        elif choice == "q":
            clr()
            break


if __name__ == "__main__":
    main()
