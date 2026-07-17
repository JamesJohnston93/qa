"""Undeliverable → Shopify refund checks."""

from regression.verify import VerificationError


def assert_refund_for_skus(order_snapshot: dict, expected_refund_skus: dict[str, int]):
    """
    A Shopify refund exists covering exactly the expected {sku: quantity}.

    Used for undeliverable (full or partial) cases: the undie item(s) must be
    refunded in Shopify before their rows are removed from the AWS tables.
    """
    refunded: dict[str, int] = {}
    for refund in order_snapshot.get("refunds", []):
        for item in refund["items"]:
            if item["sku"]:
                refunded[item["sku"]] = refunded.get(item["sku"], 0) + item["quantity"]

    if refunded != expected_refund_skus:
        raise VerificationError(
            "shopify.refund", expected_refund_skus, refunded,
            detail=f"order {order_snapshot.get('name')}; "
                   f"{len(order_snapshot.get('refunds', []))} refund(s) present",
        )


def assert_no_refund(order_snapshot: dict):
    """Fully-allocated orders must have no refunds."""
    refunds = order_snapshot.get("refunds", [])
    if refunds:
        raise VerificationError(
            "shopify.no_refund", [], [r["id"] for r in refunds],
            detail=f"order {order_snapshot.get('name')}",
        )
