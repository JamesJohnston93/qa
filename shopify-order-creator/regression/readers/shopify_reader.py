"""
Shopify order read-back for verification.

The creation layer places orders; this reads them back so assertions can
compare Shopify state against DynamoDB and NewStore. Uses the same GraphQL
client as orders_processor (imported lazily so this module can be imported
without env vars set).
"""

ORDER_QUERY = """
query getOrder($id: ID!) {
    node(id: $id) {
        ... on Order {
            id
            name
            createdAt
            displayFinancialStatus
            lineItems(first: 50) {
                edges {
                    node {
                        sku
                        quantity
                        originalUnitPriceSet { shopMoney { amount } }
                    }
                }
            }
            refunds {
                id
                createdAt
                totalRefundedSet { shopMoney { amount } }
                refundLineItems(first: 50) {
                    edges {
                        node {
                            quantity
                            lineItem { sku }
                        }
                    }
                }
            }
        }
    }
}
"""


def _client():
    # Lazy import: orders_processor builds its GraphQL clients at import time
    # and needs US_ACCESS_TOKEN / PS_ACCESS_TOKEN in the environment.
    import orders_processor
    return orders_processor.active_client


def get_order(order_gid: str) -> dict:
    """
    Reads an order back from Shopify and returns a normalized snapshot:

        {
            "id": "...", "name": "#1234",
            "financial_status": "PAID",
            "line_items": [{"sku": "...", "quantity": 2, "unit_price": 49.99}, ...],
            "refunds": [{"id": "...", "total": 12.34,
                         "items": [{"sku": "...", "quantity": 1}]}, ...],
            "raw": <full node>,
        }

    NOTE: Shopify merges duplicate line items (3× same SKU = one line item
    with quantity 3). DynamoDB and NewStore keep one row per unit. Assertions
    must compare SKU→total-quantity maps, never line counts. Use sku_quantities().
    """
    result = _client().execute(query=ORDER_QUERY, variables={"id": order_gid})
    if result.get("errors"):
        raise Exception(f"order read-back failed for {order_gid}: {result['errors']}")
    node = (result.get("data") or {}).get("node")
    if not node:
        raise Exception(f"order {order_gid} not found in Shopify: {result}")

    line_items = [
        {
            "sku": e["node"]["sku"],
            "quantity": int(e["node"]["quantity"]),
            "unit_price": float(e["node"]["originalUnitPriceSet"]["shopMoney"]["amount"]),
        }
        for e in node["lineItems"]["edges"]
    ]
    refunds = [
        {
            "id": r["id"],
            "created_at": r.get("createdAt"),
            "total": float(r["totalRefundedSet"]["shopMoney"]["amount"]),
            "items": [
                {
                    "sku": (e["node"].get("lineItem") or {}).get("sku"),
                    "quantity": int(e["node"]["quantity"]),
                }
                for e in r["refundLineItems"]["edges"]
            ],
        }
        for r in node.get("refunds", [])
    ]
    return {
        "id": node["id"],
        "name": node["name"],
        "financial_status": node.get("displayFinancialStatus"),
        "line_items": line_items,
        "refunds": refunds,
        "raw": node,
    }


def sku_quantities(order_snapshot: dict) -> dict[str, int]:
    """SKU → total quantity map (duplicate-line-item safe)."""
    out: dict[str, int] = {}
    for li in order_snapshot["line_items"]:
        out[li["sku"]] = out.get(li["sku"], 0) + li["quantity"]
    return out


def order_id_tail(order_gid: str) -> str:
    """Numeric tail of a Shopify order GID ('gid://shopify/Order/123' → '123')."""
    return order_gid.rsplit("/", 1)[-1]
