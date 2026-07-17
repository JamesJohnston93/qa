"""
AWS DynamoDB inventory management for the QA order tool.

Before every test order (Shopify or NewStore) this module ensures the ordered
SKUs have enough stock in the staging inventory table so the order can be
fulfilled without hitting an out-of-stock error downstream.

Two inventory modes:
  - ensure_stock (default): Checks stock at a single ATP location and tops up
    any SKU that falls below the minimum threshold. Use this for standard orders
    where one location needs enough stock to fulfil everything.

  - split_stock: Sets qty=1 at each of four ATP locations simultaneously.
    Use this when testing NewStore Ship From Store split-shipment routing —
    each fulfilment node needs at least one unit so NewStore can route
    individual items to different stores.

DynamoDB table schema:
    Partition key : sku   (string)  e.g. "33203669"
    Sort key      : store (string)  e.g. "ATP#100"
    Other fields  :
        quantity      (number) — current stock level
        updatedAt     (string) — ISO 8601 timestamp of last change
        updatedReason (string) — free-text reason; this tool writes "PYTHON"

What is "ATP#100"?
    ATP stands for Available To Promise. Each ATP location corresponds to a
    fulfilment node (store or warehouse). The number after # is the store ID.
    The four split locations map to: ATP#100 (web DC), ATP#99, ATP#407, ATP#640.

AWS authentication:
    boto3 resolves credentials in this order:
      1. Environment variables  (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN)
      2. Named profile          (set AWS_PROFILE env var or change AWS_CONFIG["profile"] below)
      3. Default credential chain (~/.aws/credentials)

    For SSO profiles, run `aws sso login --profile staging` first, then set
    AWS_PROFILE=staging in your terminal (or rely on the hardcoded default below).

Failure behaviour:
    If AWS is unreachable or credentials are missing, the inventory step is
    skipped and a warning is printed. The order placement continues anyway —
    this allows the tool to be used even without AWS access configured.
"""

import os
import boto3
from botocore.exceptions import NoCredentialsError, ProfileNotFound, ClientError
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Config
# Change these values if the table name, AWS region, or default location changes.
# ---------------------------------------------------------------------------

AWS_CONFIG = {
    # AWS region where the staging DynamoDB table lives.
    "region": os.environ.get("AWS_REGION", "ap-southeast-2"),

    # Named AWS profile. Can be overridden by setting AWS_PROFILE in the shell.
    "profile": os.environ.get("AWS_PROFILE", "staging"),

    # DynamoDB table name for staging inventory.
    "table_name": "staging-inventory-v2",

    # Default sort key (ATP location) used when none is specified in a call.
    # Can be changed from the Settings menu at runtime without restarting.
    "store_key": os.environ.get("NS_INVENTORY_STORE_KEY", "ATP#100"),

    # Stock level written when a SKU needs topping up.
    "top_up_quantity": 99,

    # A top-up is triggered when quantity drops below this number.
    "min_quantity_threshold": 10,
}

# The four ATP store keys used for split-shipment testing.
# Defined as a module-level constant so it's easy to extend if more stores are added.
SPLIT_LOCATIONS: list[str] = ["ATP#100", "ATP#99", "ATP#407", "ATP#640"]


# ---------------------------------------------------------------------------
# DynamoDB client (lazy-initialised)
#
# We don't create the boto3 session at import time because:
#   1. If credentials are missing, importing this module would immediately crash.
#   2. AWS_CONFIG values can be changed at runtime (e.g. from the settings menu)
#      before the first inventory call is made.
# The client is created on first use and then cached for subsequent calls.
# ---------------------------------------------------------------------------

_dynamodb = None
_table = None


def _get_table():
    """
    Returns the DynamoDB Table resource, creating the boto3 session on first call.

    Uses a named profile so the correct staging credentials are loaded from
    ~/.aws/credentials without needing environment variables to be set manually.
    """
    global _dynamodb, _table
    if _table is None:
        session = boto3.Session(
            profile_name=AWS_CONFIG["profile"],
            region_name=AWS_CONFIG["region"],
        )
        _dynamodb = session.resource("dynamodb")
        _table = _dynamodb.Table(AWS_CONFIG["table_name"])
    return _table


def _reset_client():
    """
    Drops the cached DynamoDB client so the next call re-creates it.

    Call this after changing AWS_CONFIG["profile"] or AWS_CONFIG["region"]
    at runtime so the change takes effect immediately.
    """
    global _dynamodb, _table
    _dynamodb = None
    _table = None


def _credential_help() -> str:
    """
    Returns a formatted help message when AWS credentials are missing.

    Printed to the console so the user knows exactly what to run to fix it,
    without having to dig through boto3 documentation.
    """
    profile = AWS_CONFIG["profile"] or "default"
    return (
        "\n  AWS credentials not found. To fix this:\n"
        f"    Option A — SSO login:  aws sso login --profile {profile}\n"
        f"               then set:  export AWS_PROFILE={profile}\n"
        "    Option B — Env vars:   export AWS_ACCESS_KEY_ID=...\n"
        "                           export AWS_SECRET_ACCESS_KEY=...\n"
        "                           export AWS_SESSION_TOKEN=...\n"
        "  Inventory update will be skipped and the order will still be placed."
    )


def _format_client_error(e: ClientError) -> str:
    """
    Formats a boto3 ClientError into a readable one-line console message.

    Handles ResourceNotFoundException specifically because it's the most
    common error when the table name or region in AWS_CONFIG is wrong.
    All other ClientErrors fall through to a generic format.
    """
    code = e.response["Error"]["Code"]
    msg  = e.response["Error"]["Message"]
    if code == "ResourceNotFoundException":
        # Most likely cause: wrong table name or wrong region in AWS_CONFIG.
        return (
            f"Table '{AWS_CONFIG['table_name']}' not found in "
            f"region '{AWS_CONFIG['region']}'. Check AWS_CONFIG."
        )
    return f"AWS error ({code}): {msg}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_stock(sku: str, store_key: str | None = None) -> int | None:
    """
    Returns the current stock quantity for a SKU at a given ATP location.

    Args:
        sku:       Product SKU to look up (the DynamoDB partition key).
        store_key: ATP location sort key (e.g. "ATP#100"). Defaults to
                   AWS_CONFIG["store_key"] if not provided.

    Returns:
        Quantity as an int, or None if the SKU has no record at this location.
        None means "no record exists" — distinct from 0, which means out of stock.
    """
    store = store_key or AWS_CONFIG["store_key"]
    table = _get_table()
    resp  = table.get_item(Key={"sku": sku, "store": store})
    item  = resp.get("Item")
    if item is None:
        return None  # record doesn't exist yet at this location
    return int(item.get("quantity", 0))


def set_stock(sku: str, quantity: int, store_key: str | None = None) -> dict:
    """
    Sets the stock quantity for a SKU at a given ATP location.

    Uses DynamoDB UpdateItem (upsert) so the record is created if it doesn't
    exist, or updated if it does. Always stamps updatedAt and sets
    updatedReason to "PYTHON" so inventory changes from this tool can be
    identified in the table.

    Args:
        sku:       Product SKU (DynamoDB partition key).
        quantity:  Stock level to write.
        store_key: ATP location sort key. Defaults to AWS_CONFIG["store_key"].

    Returns:
        The DynamoDB UpdateItem response (contains the UPDATED_NEW attributes).
    """
    store = store_key or AWS_CONFIG["store_key"]
    table = _get_table()
    now   = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return table.update_item(
        Key={"sku": sku, "store": store},
        # SET overwrites the listed attributes; it creates them if they don't exist.
        UpdateExpression="SET quantity = :qty, updatedAt = :ts, updatedReason = :reason",
        ExpressionAttributeValues={
            ":qty":    quantity,
            ":ts":     now,
            ":reason": "PYTHON",
        },
        ReturnValues="UPDATED_NEW",  # returns only the attributes that were changed
    )


def ensure_stock(
    skus: list[str],
    store_key: str | None = None,
    min_quantity: int | None = None,
    top_up_to: int | None = None,
    verbose: bool = True,
    strict: bool = False,
) -> dict[str, int]:
    """
    Checks stock for each SKU and tops up any that are below the threshold.

    This is the standard inventory mode for most orders. It ensures there's
    enough stock at a single ATP location to cover the items being ordered.

    Logic per SKU:
      - No record → create it at top_up_to quantity
      - Quantity < min_quantity → update to top_up_to
      - Quantity >= min_quantity → leave it, just report the current value

    Args:
        skus:         List of SKUs to check and potentially top up.
        store_key:    ATP location to check. Defaults to AWS_CONFIG["store_key"].
        min_quantity: Threshold below which a top-up is triggered.
                      Defaults to AWS_CONFIG["min_quantity_threshold"].
        top_up_to:    Target quantity to set when topping up.
                      Defaults to AWS_CONFIG["top_up_quantity"].
        verbose:      If True, prints a status line for each SKU.
        strict:       If True, AWS failures raise instead of being swallowed.
                      The regression package always passes strict=True — a
                      silently skipped inventory step would make every
                      downstream assertion meaningless. The CLI keeps the
                      default (False) so casual use still works without AWS.

    Returns:
        Dict of {sku: final_quantity}. In non-strict mode, returns empty dict
        on AWS failure (the calling code continues with order placement
        regardless).
    """
    store      = store_key or AWS_CONFIG["store_key"]
    min_qty    = min_quantity if min_quantity is not None else AWS_CONFIG["min_quantity_threshold"]
    target_qty = top_up_to   if top_up_to   is not None else AWS_CONFIG["top_up_quantity"]
    results: dict[str, int] = {}

    try:
        for sku in skus:
            current = get_stock(sku, store_key=store)

            if current is None:
                # No DynamoDB record exists — create one at the target level.
                if verbose:
                    print(f"    [inventory] {sku}: no record found → setting to {target_qty}")
                set_stock(sku, target_qty, store_key=store)
                results[sku] = target_qty

            elif current < min_qty:
                # Stock is low — top it up so the order won't be blocked.
                if verbose:
                    print(f"    [inventory] {sku}: qty={current} (below {min_qty}) → topping up to {target_qty}")
                set_stock(sku, target_qty, store_key=store)
                results[sku] = target_qty

            else:
                # Stock is healthy — no action needed.
                if verbose:
                    print(f"    [inventory] {sku}: qty={current} ✓")
                results[sku] = current

    except (NoCredentialsError, ProfileNotFound):
        if strict:
            raise
        # AWS credentials aren't configured. Print help and carry on.
        print(_credential_help())
        print("    [inventory] Skipping — proceeding with order anyway.")
        return {}

    except ClientError as e:
        if strict:
            raise
        print(f"    [inventory] {_format_client_error(e)}")
        print("    [inventory] Skipping — proceeding with order anyway.")
        return {}

    return results


def split_stock(
    skus: list[str],
    locations: list[str] | None = None,
    quantity: int = 1,
    verbose: bool = True,
    strict: bool = False,
) -> dict[str, dict[str, int]]:
    """
    Sets each SKU to a small quantity at each of the split locations.

    Use this before placing a NewStore Ship From Store order when you want to
    test split-shipment routing. By giving each store exactly 1 unit, NewStore
    is forced to route each item independently to a different fulfilment node
    (rather than fulfilling everything from one place).

    For example: an order with 3 items might be split as ATP#100 → item 1,
    ATP#407 → item 2, ATP#640 → item 3, producing three separate shipments.

    Args:
        skus:      List of SKUs to update across all locations.
        locations: ATP sort keys to write. Defaults to SPLIT_LOCATIONS
                   (ATP#100, ATP#99, ATP#407, ATP#640).
        quantity:  Stock level to set at each location. Default is 1.
        verbose:   If True, prints a line for each SKU × location combination.
        strict:    If True, AWS failures raise instead of being swallowed.
                   Always used by the regression package; CLI default is False.

    Returns:
        Nested dict {sku: {location: quantity_set}}. In non-strict mode,
        returns empty dict on AWS failure (the calling code continues with
        order placement regardless).
    """
    locs = locations or SPLIT_LOCATIONS
    results: dict[str, dict[str, int]] = {}

    try:
        for sku in skus:
            results[sku] = {}
            for loc in locs:
                if verbose:
                    print(f"    [inventory] {sku} @ {loc} → {quantity}")
                set_stock(sku, quantity, store_key=loc)
                results[sku][loc] = quantity

    except (NoCredentialsError, ProfileNotFound):
        if strict:
            raise
        # AWS credentials aren't configured. Print help and carry on.
        print(_credential_help())
        print("    [inventory] Skipping — proceeding with order anyway.")
        return {}

    except ClientError as e:
        if strict:
            raise
        print(f"    [inventory] {_format_client_error(e)}")
        print("    [inventory] Skipping — proceeding with order anyway.")
        return {}

    return results
