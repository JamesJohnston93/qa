"""
Baseline case set v1 — "these always need to work and behave exactly the
same way." Declarative: each case states its inputs (SKUs, seed plan) and its
expected state in every system. The runner turns these into orders and
assertions.

SKU isolation caveat: the staging variant pools are small (5 US / 4 PS SKUs),
so full per-case SKU isolation is not possible within one run. Mitigations:
cases run sequentially and each is polled to a terminal state before the next
starts; SKU assignments below minimize immediate reuse. Growing the variant
pools (the data-pool workstream) removes this constraint — when SKUs are
added to orders_processor.US_VARIANTS / PS_VARIANTS, isolation improves
automatically.

NewStore SFS/OTC cases (7–8 in the design) are not yet wired into the runner:
order injection exists, but the NewStore read-back endpoint needs confirming
first. Tracked in TAA-3.
"""

from dataclasses import dataclass, field

from regression.config import WEB_DC, STORE_99


def _store_number(location: str) -> str:
    """'ATP#100' → '100'. Expected-allocation values use plain store numbers.

    NOTE: if schema probing shows staging-shipments stores allocation as e.g.
    'BRANCH_407' instead of '407', normalize in dynamo_reader (one place)
    rather than changing every case.
    """
    return location.split("#", 1)[1]


UNDELIVERABLE = "UNDELIVERABLE"


@dataclass
class CaseSpec:
    name: str
    description: str
    sku_quantities: dict            # {sku: qty} ordered
    seed: dict                      # {sku: {location: qty}} applied after zeroing
    expected_allocation: dict       # {sku: store_number | "UNDELIVERABLE"}
    expected_decrements: dict       # {sku: {location: units}}
    expected_refund_skus: dict = field(default_factory=dict)   # {} = no refund expected
    cleanup_skus: list = field(default_factory=list)           # ITEM# rows removed after refund

    @property
    def skus(self) -> list:
        return list(self.sku_quantities)


def build_cases(config) -> dict[str, CaseSpec]:
    """
    Builds the case set for the configured store. Imports orders_processor
    lazily (env vars required at its import time).
    """
    import orders_processor

    pool = list(
        orders_processor.US_VARIANTS if config.store == "US"
        else orders_processor.PS_VARIANTS
    )
    if len(pool) < 4:
        raise ValueError(f"variant pool for {config.store} too small: {pool}")

    def sku(i: int) -> str:
        return pool[i % len(pool)]

    primary, secondary = WEB_DC, STORE_99
    p_num, s_num = _store_number(primary), _store_number(secondary)
    TOP_UP = 99

    cases = [
        CaseSpec(
            name="single",
            description="Single item, stock at one location → one shipment there",
            sku_quantities={sku(0): 1},
            seed={sku(0): {primary: TOP_UP}},
            expected_allocation={sku(0): p_num},
            expected_decrements={sku(0): {primary: 1}},
        ),
        CaseSpec(
            name="multi",
            description="3× same SKU → one shipment, three ITEM# rows "
                        "(Shopify merges duplicate line items; Dynamo does not)",
            sku_quantities={sku(1): 3},
            seed={sku(1): {primary: TOP_UP}},
            expected_allocation={sku(1): p_num},
            expected_decrements={sku(1): {primary: 3}},
        ),
        CaseSpec(
            name="unique",
            description="3 different SKUs all stocked at one location → one combined shipment",
            sku_quantities={sku(2): 1, sku(3): 1, sku(4): 1},
            seed={
                sku(2): {primary: TOP_UP},
                sku(3): {primary: TOP_UP},
                sku(4): {primary: TOP_UP},
            },
            expected_allocation={sku(2): p_num, sku(3): p_num, sku(4): p_num},
            expected_decrements={
                sku(2): {primary: 1},
                sku(3): {primary: 1},
                sku(4): {primary: 1},
            },
        ),
        CaseSpec(
            name="split",
            description="Each SKU stocked at a different store only → one shipment per store",
            sku_quantities={sku(0): 1, sku(1): 1},
            seed={
                sku(0): {primary: TOP_UP},
                sku(1): {secondary: TOP_UP},
            },
            expected_allocation={sku(0): p_num, sku(1): s_num},
            expected_decrements={
                sku(0): {primary: 1},
                sku(1): {secondary: 1},
            },
        ),
        CaseSpec(
            name="undeliverable",
            description="Zero stock everywhere → UNDELIVERABLE, Shopify refund, "
                        "rows removed from both AWS tables",
            sku_quantities={sku(2): 1},
            seed={},  # zeroing everywhere IS the seed
            expected_allocation={sku(2): UNDELIVERABLE},
            expected_decrements={sku(2): {}},  # nothing to decrement
            expected_refund_skus={sku(2): 1},
            cleanup_skus=[sku(2)],
        ),
        CaseSpec(
            name="partial_undeliverable",
            description="One SKU stocked, one zero everywhere → mixed: allocated "
                        "shipment + refunded undeliverable",
            sku_quantities={sku(3): 1, sku(1): 1},
            seed={sku(3): {primary: TOP_UP}},   # sku(1) stays zeroed everywhere
            expected_allocation={sku(3): p_num, sku(1): UNDELIVERABLE},
            expected_decrements={sku(3): {primary: 1}},
            expected_refund_skus={sku(1): 1},
            cleanup_skus=[sku(1)],
        ),
    ]
    return {c.name: c for c in cases}
