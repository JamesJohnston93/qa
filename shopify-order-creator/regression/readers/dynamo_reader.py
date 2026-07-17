"""
DynamoDB read-only access to staging-orders-v2 and staging-shipments.

!! SCHEMA CONFIRMATION REQUIRED !!
The exact key formats of these two tables were not visible from the CLI code
(it only writes staging-inventory-v2). The TABLE_SCHEMAS block below is the
single place to fix once confirmed. Run the probe to see real rows:

    python -m regression.schema_probe --order <recent-shopify-order-number>

then update TABLE_SCHEMAS and delete the UNCONFIRMED flags. Everything else
in the package works against the normalized shapes returned by this module,
so no other file should need to change.
"""

import boto3
from boto3.dynamodb.conditions import Key, Attr


# ---------------------------------------------------------------------------
# Schema assumptions — CONFIRM AGAINST REAL ROWS BEFORE FIRST RUN
# ---------------------------------------------------------------------------

TABLE_SCHEMAS = {
    "orders": {
        "UNCONFIRMED": True,
        # Assumed: partition key holds an order reference. Common patterns are
        # the raw Shopify numeric id, "ORDER#<id>", or the order name ("#1234").
        "pk_attr": "pk",
        "pk_formats": ["{order_id}", "ORDER#{order_id}", "{order_name}"],
        # Attribute that lists order items (list of maps with sku/quantity),
        # and the transactions attribute/rows (order-finalised, order-item-refunded).
        "items_attr": "items",
    },
    "shipments": {
        "UNCONFIRMED": True,
        # Assumed: partition key is an order reference; ITEM# rows are sort-key
        # entries, one per unit ("one ITEM# row per unit" — design doc).
        "pk_attr": "pk",
        "pk_formats": ["{order_id}", "ORDER#{order_id}"],
        "sk_attr": "sk",
        "item_sk_prefix": "ITEM#",
        # Attribute names on an ITEM# row:
        "sku_attr": "sku",
        "store_attr": "store",              # allocated store number or "UNDELIVERABLE"
        "status_attr": "status",
        "rejected_stores_attr": "rejectedStores",
        "undeliverable_value": "UNDELIVERABLE",
    },
}


class SchemaUnconfirmed(Exception):
    """Raised when a reader is used before TABLE_SCHEMAS has been confirmed."""


def _check_confirmed(which: str):
    if TABLE_SCHEMAS[which].get("UNCONFIRMED"):
        raise SchemaUnconfirmed(
            f"TABLE_SCHEMAS['{which}'] has not been confirmed against real "
            f"staging rows. Run: python -m regression.schema_probe "
            f"--order <recent-order-number>, update regression/readers/"
            f"dynamo_reader.py, and remove the UNCONFIRMED flag."
        )


# ---------------------------------------------------------------------------
# Table access (per-config session; no module-global boto3 state)
# ---------------------------------------------------------------------------

def _table(config, name: str):
    session = boto3.Session(profile_name=config.aws_profile, region_name=config.aws_region)
    return session.resource("dynamodb").Table(name)


def _query_first_match(table, pk_attr: str, pk_formats: list[str], refs: dict) -> list[dict]:
    """Tries each candidate key format until a query returns items."""
    for fmt in pk_formats:
        key_value = fmt.format(**refs)
        resp = table.query(KeyConditionExpression=Key(pk_attr).eq(key_value))
        if resp.get("Items"):
            return resp["Items"]
    return []


# ---------------------------------------------------------------------------
# Public API — normalized shapes
# ---------------------------------------------------------------------------

def get_order_rows(config, order_id: str, order_name: str) -> list[dict]:
    """
    Raw rows for an order from staging-orders-v2 (order record + transactions).
    Empty list = order has not landed in the table (yet).
    """
    _check_confirmed("orders")
    s = TABLE_SCHEMAS["orders"]
    table = _table(config, config.orders_table)
    return _query_first_match(
        table, s["pk_attr"], s["pk_formats"],
        {"order_id": order_id, "order_name": order_name},
    )


def get_order_sku_quantities(config, order_id: str, order_name: str) -> dict[str, int]:
    """SKU → total quantity for the order as recorded in staging-orders-v2."""
    _check_confirmed("orders")
    s = TABLE_SCHEMAS["orders"]
    rows = get_order_rows(config, order_id, order_name)
    out: dict[str, int] = {}
    for row in rows:
        for item in row.get(s["items_attr"], []) or []:
            sku = str(item.get("sku", ""))
            qty = int(item.get("quantity", 1))
            if sku:
                out[sku] = out.get(sku, 0) + qty
    return out


def get_shipment_items(config, order_id: str, order_name: str) -> list[dict]:
    """
    ITEM# rows for an order from staging-shipments, normalized:

        [{"sku": "...", "store": "407" | "UNDELIVERABLE" | None,
          "status": "...", "rejected_stores": [...], "raw": <row>}, ...]

    One entry per unit. Empty list = shipments not created (yet) OR rows
    removed (undeliverable cleanup) — callers distinguish by pipeline stage.
    """
    _check_confirmed("shipments")
    s = TABLE_SCHEMAS["shipments"]
    table = _table(config, config.shipments_table)
    rows = _query_first_match(
        table, s["pk_attr"], s["pk_formats"],
        {"order_id": order_id, "order_name": order_name},
    )
    items = []
    for row in rows:
        sk = str(row.get(s["sk_attr"], ""))
        if not sk.startswith(s["item_sk_prefix"]):
            continue  # shipment-level or metadata row, not an item row
        items.append({
            "sku": str(row.get(s["sku_attr"], "")),
            "store": row.get(s["store_attr"]),
            "status": row.get(s["status_attr"]),
            "rejected_stores": row.get(s["rejected_stores_attr"], []) or [],
            "raw": row,
        })
    return items


def allocation_summary(shipment_items: list[dict], undeliverable_value: str = None) -> dict:
    """
    Summarizes normalized shipment items for assertions:

        {
            "total_units": 5,
            "by_store": {"407": ["sku1", "sku2"], "UNDELIVERABLE": ["sku3"]},
            "sku_units": {"sku1": 2, ...},
            "unallocated": 0,     # items with no store value yet
        }
    """
    undie = undeliverable_value or TABLE_SCHEMAS["shipments"]["undeliverable_value"]
    by_store: dict[str, list] = {}
    sku_units: dict[str, int] = {}
    unallocated = 0
    for item in shipment_items:
        store = item["store"]
        if store is None or store == "":
            unallocated += 1
            store = "(unallocated)"
        by_store.setdefault(str(store), []).append(item["sku"])
        sku_units[item["sku"]] = sku_units.get(item["sku"], 0) + 1
    return {
        "total_units": len(shipment_items),
        "by_store": by_store,
        "sku_units": sku_units,
        "unallocated": unallocated,
        "undeliverable_key": undie,
    }
