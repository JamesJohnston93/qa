"""
Order lifecycle orchestration: inventory seeding, snapshots, and headless
order creation that returns every identifier verification needs.

Reuses the existing creation modules (orders_processor, aws_inventory) but
bypasses main.py entirely — no input(), no CLI globals.
"""

import sys
import os
from dataclasses import dataclass, field

import boto3
from boto3.dynamodb.conditions import Key

# The tool modules live one directory up from the regression package.
_TOOL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _TOOL_DIR not in sys.path:
    sys.path.insert(0, _TOOL_DIR)


@dataclass
class OrderRecord:
    """Everything created for one order — the input to all verification."""
    store: str
    order_id: str = ""                 # gid://shopify/Order/...
    order_name: str = ""               # "#1234"
    draft_id: str = ""
    created_at: str = ""
    skus: dict = field(default_factory=dict)          # sku -> quantity ordered
    seed_plan: dict = field(default_factory=dict)     # sku -> {location: qty}
    inventory_before: dict = field(default_factory=dict)  # sku -> {location: qty|None}

    @property
    def order_id_tail(self) -> str:
        return self.order_id.rsplit("/", 1)[-1] if self.order_id else ""


# ---------------------------------------------------------------------------
# Inventory seeding
# ---------------------------------------------------------------------------

def _inventory_table(config):
    session = boto3.Session(profile_name=config.aws_profile, region_name=config.aws_region)
    return session.resource("dynamodb").Table(config.inventory_table)


def get_all_locations_for_sku(config, sku: str) -> dict[str, int]:
    """
    Returns every ATP location row that exists for a SKU: {store_key: qty}.

    The inventory table's PK is the SKU, so one Query surfaces every location —
    including stores beyond the four the CLI knows about. Critical for
    undeliverable cases: zeroing only known locations is not enough if some
    other store row still holds stock.
    """
    table = _inventory_table(config)
    resp = table.query(KeyConditionExpression=Key("sku").eq(sku))
    return {item["store"]: int(item.get("quantity", 0)) for item in resp.get("Items", [])}


def seed_inventory(config, seed_plan: dict[str, dict[str, int]]):
    """
    Applies an explicit seed plan: {sku: {location: qty}}.

    Every write goes through aws_inventory.set_stock, which raises on failure
    (no silent-skip path exists on set_stock — only ensure/split swallow).
    """
    import aws_inventory
    for sku, locations in seed_plan.items():
        for location, qty in locations.items():
            aws_inventory.set_stock(sku, qty, store_key=location)


def zero_everywhere(config, sku: str):
    """
    Sets quantity to 0 at EVERY location row that exists for this SKU.
    Forces the undeliverable path deterministically.
    """
    import aws_inventory
    for location in get_all_locations_for_sku(config, sku):
        aws_inventory.set_stock(sku, 0, store_key=location)


def snapshot_inventory(config, skus: list[str]) -> dict[str, dict[str, int]]:
    """Current quantity at every existing location for each SKU."""
    return {sku: get_all_locations_for_sku(config, sku) for sku in skus}


# ---------------------------------------------------------------------------
# Shopify order creation (headless)
# ---------------------------------------------------------------------------

def create_shopify_order(config, sku_quantities: dict[str, int]) -> OrderRecord:
    """
    Places a Shopify order for the given {sku: quantity} map and returns a
    fully-populated OrderRecord. Raises on any failure — silent paths are
    treated as hard failures per the design.

    NOTE: orders_processor holds the active store in module globals, so runs
    are single-threaded by design. set_store() is called explicitly here to
    make the record self-consistent regardless of prior state.
    """
    import orders_processor

    orders_processor.set_store(config.store)
    variants = orders_processor.VARIANTS

    unknown = [sku for sku in sku_quantities if sku not in variants]
    if unknown:
        raise ValueError(
            f"SKUs not in {config.store} variant map: {unknown}. "
            f"Known: {list(variants)}"
        )

    line_items = [
        {"variantId": variants[sku], "quantity": qty}
        for sku, qty in sku_quantities.items()
    ]

    customer = config.customer()
    draft_id = orders_processor.create_draft_order(
        customer["id"], customer["email"], line_items,
        customer["first_name"], customer["last_name"],
    )
    completed = orders_processor.complete_draft_order(draft_id)

    return OrderRecord(
        store=config.store,
        order_id=completed["order_id"],
        order_name=completed["order_name"],
        draft_id=draft_id,
        created_at=completed["created_at"],
        skus=dict(sku_quantities),
    )
