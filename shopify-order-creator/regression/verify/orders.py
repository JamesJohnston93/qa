"""Shopify order ↔ staging-orders-v2 alignment checks."""

from regression.verify import VerificationError


def assert_shopify_order(order_snapshot: dict, expected_skus: dict[str, int]):
    """
    The Shopify order exists, is paid, and its line items exactly match the
    requested {sku: quantity} map (duplicate-line-item safe).
    """
    from regression.readers.shopify_reader import sku_quantities

    status = order_snapshot.get("financial_status")
    if status != "PAID":
        raise VerificationError(
            "shopify.financial_status", "PAID", status,
            detail=f"order {order_snapshot.get('name')}",
        )

    actual = sku_quantities(order_snapshot)
    if actual != expected_skus:
        raise VerificationError(
            "shopify.line_items", expected_skus, actual,
            detail=f"order {order_snapshot.get('name')}",
        )


def assert_orders_table_alignment(aws_sku_quantities: dict[str, int], expected_skus: dict[str, int], order_name: str):
    """staging-orders-v2 item content matches the order exactly."""
    if aws_sku_quantities != expected_skus:
        raise VerificationError(
            "orders_table.items", expected_skus, aws_sku_quantities,
            detail=f"order {order_name}",
        )
