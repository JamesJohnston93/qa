"""Allocation-state checks against staging-shipments ITEM# rows."""

from regression.verify import VerificationError


def assert_unit_counts(summary: dict, expected_skus: dict[str, int], order_name: str):
    """
    One ITEM# row per unit: total shipment units per SKU must equal the
    ordered quantity (DynamoDB does NOT merge duplicates like Shopify does).
    """
    if summary["sku_units"] != expected_skus:
        raise VerificationError(
            "shipments.unit_counts", expected_skus, summary["sku_units"],
            detail=f"order {order_name}; by_store={summary['by_store']}",
        )


def assert_allocation(summary: dict, expected_allocation: dict[str, str], order_name: str):
    """
    Each SKU landed where the seed plan forced it.

    expected_allocation: {sku: store_number_or_UNDELIVERABLE}, e.g.
        {"32625134": "100"} or {"33413679": "UNDELIVERABLE"}.
    """
    if summary["unallocated"]:
        raise VerificationError(
            "shipments.allocated", "all items allocated or undeliverable",
            f"{summary['unallocated']} item(s) with no store value",
            detail=f"order {order_name}; by_store={summary['by_store']}",
        )

    # Build actual sku -> set of stores from the by_store map.
    actual: dict[str, set] = {}
    for store, skus in summary["by_store"].items():
        for sku in skus:
            actual.setdefault(sku, set()).add(str(store))

    for sku, expected_store in expected_allocation.items():
        stores = actual.get(sku)
        if not stores:
            raise VerificationError(
                "shipments.allocation", {sku: expected_store}, {sku: None},
                detail=f"order {order_name}: no ITEM# rows for sku",
            )
        if stores != {str(expected_store)}:
            raise VerificationError(
                "shipments.allocation", {sku: str(expected_store)}, {sku: sorted(stores)},
                detail=f"order {order_name}",
            )


def assert_items_removed(shipment_items: list[dict], removed_skus: list[str], order_name: str):
    """
    After undeliverable cleanup, the refunded SKUs' ITEM# rows are removed.

    LIVE FINDING (Jul 17, TS runs #9706/#9707): staging-shipments rows are
    never physically deleted — cleanup flips the row status to "REMOVED".
    Accept either absence or status == "REMOVED". (TS harness has the same
    fix; keep both in sync.)
    """
    remaining = sorted({
        i["sku"] for i in shipment_items
        if i["sku"] in removed_skus and str(i.get("status", "")).upper() != "REMOVED"
    })
    if remaining:
        raise VerificationError(
            "shipments.cleanup",
            f"rows absent or status REMOVED for {sorted(removed_skus)}",
            f"active rows still present for {remaining}",
            detail=f"order {order_name}",
        )
