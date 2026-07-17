"""
Case execution: seed → order → poll each pipeline stage → assert.

Every stage records its elapsed time (feeds PollWindows tuning); every
assertion failure carries expected-vs-actual from the systems involved.
"""

import time
import traceback

from regression import flows
from regression.cases import UNDELIVERABLE, build_cases
from regression.polling import StageTimeout, poll_until
from regression.readers import dynamo_reader, shopify_reader
from regression.verify import VerificationError
from regression.verify import inventory as v_inventory
from regression.verify import orders as v_orders
from regression.verify import refunds as v_refunds
from regression.verify import shipments as v_shipments


def _poll_verify(fetch, verify_fn, timeout, interval, stage, verbose):
    """
    Polls until verify_fn(value) stops raising VerificationError.
    On timeout, re-raises the final VerificationError (full evidence) rather
    than a bare timeout.
    """
    def predicate(value):
        try:
            verify_fn(value)
            return True
        except VerificationError:
            return False

    try:
        return poll_until(fetch, predicate, timeout, interval, stage, verbose)
    except StageTimeout as timeout_error:
        verify_fn(timeout_error.last_value)  # raises the detailed error
        raise  # unreachable unless state changed between last poll and here


def run_case(config, case) -> dict:
    """Executes one CaseSpec. Returns a result dict (never raises)."""
    result = {
        "case": case.name,
        "store": config.store,
        "description": case.description,
        "passed": False,
        "order_id": "",
        "order_name": "",
        "stages": [],
        "error": None,
    }

    def stage_done(name: str, elapsed: float):
        result["stages"].append({"name": name, "elapsed": round(elapsed, 1)})
        if config.verbose:
            print(f"    [stage] {name}: ok ({elapsed:.1f}s)")

    poll = config.poll
    try:
        # --- 1. Seed inventory deterministically -------------------------
        t0 = time.monotonic()
        for sku in case.skus:
            flows.zero_everywhere(config, sku)
        flows.seed_inventory(config, case.seed)
        before = flows.snapshot_inventory(config, case.skus)
        stage_done("seed_inventory", time.monotonic() - t0)

        # --- 2. Create the Shopify order ---------------------------------
        t0 = time.monotonic()
        record = flows.create_shopify_order(config, case.sku_quantities)
        record.seed_plan = case.seed
        record.inventory_before = before
        result["order_id"] = record.order_id
        result["order_name"] = record.order_name
        stage_done("create_order", time.monotonic() - t0)

        oid, oname = record.order_id_tail, record.order_name

        # --- 3. Shopify read-back: exists, paid, items match --------------
        res = _poll_verify(
            fetch=lambda: shopify_reader.get_order(record.order_id),
            verify_fn=lambda snap: v_orders.assert_shopify_order(snap, case.sku_quantities),
            timeout=60, interval=poll.interval, stage="shopify_readback",
            verbose=config.verbose,
        )
        stage_done("shopify_readback", res.elapsed)

        # --- 4. staging-orders-v2 row lands and matches --------------------
        res = _poll_verify(
            fetch=lambda: dynamo_reader.get_order_sku_quantities(config, oid, oname),
            verify_fn=lambda q: v_orders.assert_orders_table_alignment(q, case.sku_quantities, oname),
            timeout=poll.orders_table, interval=poll.interval, stage="orders_table",
            verbose=config.verbose,
        )
        stage_done("orders_table", res.elapsed)

        # --- 5. Shipment ITEM# rows: unit counts, then terminal allocation -
        def check_allocation(items):
            summary = dynamo_reader.allocation_summary(items)
            v_shipments.assert_unit_counts(summary, case.sku_quantities, oname)
            v_shipments.assert_allocation(summary, case.expected_allocation, oname)

        res = _poll_verify(
            fetch=lambda: dynamo_reader.get_shipment_items(config, oid, oname),
            verify_fn=check_allocation,
            timeout=poll.shipments_table + poll.allocation,
            interval=poll.interval, stage="allocation",
            verbose=config.verbose,
        )
        stage_done("allocation", res.elapsed)

        # --- 6. Refund path (undeliverable cases) or no-refund check -------
        if case.expected_refund_skus:
            res = _poll_verify(
                fetch=lambda: shopify_reader.get_order(record.order_id),
                verify_fn=lambda snap: v_refunds.assert_refund_for_skus(snap, case.expected_refund_skus),
                timeout=poll.refund, interval=poll.interval, stage="refund",
                verbose=config.verbose,
            )
            stage_done("refund", res.elapsed)

            res = _poll_verify(
                fetch=lambda: dynamo_reader.get_shipment_items(config, oid, oname),
                verify_fn=lambda items: v_shipments.assert_items_removed(items, case.cleanup_skus, oname),
                timeout=poll.cleanup, interval=poll.interval, stage="cleanup",
                verbose=config.verbose,
            )
            stage_done("cleanup", res.elapsed)
        else:
            snap = shopify_reader.get_order(record.order_id)
            v_refunds.assert_no_refund(snap)
            stage_done("no_refund", 0.0)

        # --- 7. Inventory decremented exactly as expected ------------------
        res = _poll_verify(
            fetch=lambda: flows.snapshot_inventory(config, case.skus),
            verify_fn=lambda after: v_inventory.assert_decrements(
                before, after, case.expected_decrements, oname
            ),
            timeout=poll.inventory, interval=poll.interval, stage="inventory",
            verbose=config.verbose,
        )
        stage_done("inventory", res.elapsed)

        result["passed"] = True

    except VerificationError as e:
        result["error"] = e.to_dict()
    except StageTimeout as e:
        result["error"] = {
            "check": f"timeout.{e.stage}",
            "expected": f"state within {e.timeout:.0f}s",
            "actual": repr(e.last_value),
            "detail": "",
        }
    except Exception as e:  # creation/reader/config failures — hard fail with trace
        result["error"] = {
            "check": "unexpected_error",
            "expected": "",
            "actual": f"{type(e).__name__}: {e}",
            "detail": traceback.format_exc(limit=5),
        }

    return result


def run(config, case_names: list[str] | None = None) -> dict:
    """
    Runs the selected cases (default: all) sequentially. Returns:
        {"store", "cases": [case results], "passed": bool}
    """
    config.validate()
    all_cases = build_cases(config)
    names = case_names or list(all_cases)
    unknown = [n for n in names if n not in all_cases]
    if unknown:
        raise ValueError(f"unknown case(s): {unknown}. Available: {list(all_cases)}")

    results = []
    for name in names:
        if config.verbose:
            print(f"\n=== case: {name} ({config.store}) ===")
        results.append(run_case(config, all_cases[name]))

    return {
        "store": config.store,
        "cases": results,
        "passed": all(r["passed"] for r in results),
    }
