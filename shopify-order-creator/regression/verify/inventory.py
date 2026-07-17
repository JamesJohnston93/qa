"""Inventory decrement checks against staging-inventory-v2."""

from regression.verify import VerificationError


def assert_decrements(
    before: dict[str, dict[str, int]],
    after: dict[str, dict[str, int]],
    expected_decrements: dict[str, dict[str, int]],
    order_name: str,
):
    """
    Inventory changed by exactly the expected amount at exactly the expected
    locations, and nowhere else.

    Args:
        before / after:       {sku: {store_key: qty}} snapshots.
        expected_decrements:  {sku: {store_key: units}} — e.g. an order of
                              2 units allocated at ATP#100 expects
                              {sku: {"ATP#100": 2}}.
    """
    for sku in before:
        exp = expected_decrements.get(sku, {})
        locations = set(before.get(sku, {})) | set(after.get(sku, {}))
        for location in sorted(locations):
            b = before.get(sku, {}).get(location, 0)
            a = after.get(sku, {}).get(location, 0)
            expected_after = b - exp.get(location, 0)
            if a != expected_after:
                raise VerificationError(
                    "inventory.decrement",
                    {f"{sku}@{location}": expected_after},
                    {f"{sku}@{location}": a},
                    detail=(
                        f"order {order_name}: before={b}, "
                        f"expected decrement={exp.get(location, 0)}"
                    ),
                )
